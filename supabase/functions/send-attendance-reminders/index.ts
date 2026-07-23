// supabase/functions/send-attendance-reminders/index.ts
// Deploy: supabase functions deploy send-attendance-reminders
//
// Dipanggil terjadwal (tiap beberapa menit) oleh pg_cron + pg_net -- lihat
// README bagian "Push Notification Reminder" untuk setup cron-nya.
// Cek tiap outlet yang punya jam masuk & reminder aktif; kalau sudah lewat
// GRACE_PERIOD_MINUTES dari jam masuk dan staff belum clock in hari ini,
// kirim Web Push reminder (sekali per staff per outlet per hari).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
// Secret sederhana supaya endpoint ini tidak bisa dipicu sembarang orang dari
// internet (cron job mengirim header ini, lihat instruksi setup di README).
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const GRACE_PERIOD_MINUTES = 10; // reminder terkirim 10 menit setelah jam masuk lewat
const TIMEZONE = 'Asia/Jakarta'; // semua outlet diasumsikan 1 zona waktu -- lihat README kalau berbeda

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** "HH:MM" dan "YYYY-MM-DD" saat ini di TIMEZONE, tanpa dependensi eksternal. */
function nowInTimezone() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** Tambah menit ke "HH:MM:SS" atau "HH:MM", return "HH:MM". */
function addMinutes(hhmm: string, minutesToAdd: number) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutesToAdd;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const mm = String(wrapped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

Deno.serve(async (req) => {
  if (CRON_SECRET) {
    const provided = req.headers.get('x-cron-secret');
    if (provided !== CRON_SECRET) return json({ error: 'Unauthorized' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { date: today, time: nowTime } = nowInTimezone();

  const { data: outlets, error: outletError } = await admin
    .from('outlets')
    .select('id, name, business_unit_id, clock_in_time, reminder_enabled')
    .eq('reminder_enabled', true)
    .not('clock_in_time', 'is', null);

  if (outletError) return json({ error: outletError.message }, 500);

  let sentCount = 0;
  let checkedStaffCount = 0;

  for (const outlet of outlets ?? []) {
    const threshold = addMinutes(outlet.clock_in_time, GRACE_PERIOD_MINUTES);
    if (nowTime < threshold) continue; // belum waktunya reminder untuk outlet ini

    // Staff yang ditugaskan di outlet ini (langsung, bukan level BU)
    const { data: scopes, error: scopeError } = await admin
      .from('membership_scopes')
      .select('user_id, user_profiles(is_active)')
      .eq('outlet_id', outlet.id);
    if (scopeError) continue;

    for (const scope of scopes ?? []) {
      if (scope.user_profiles && scope.user_profiles.is_active === false) continue;
      checkedStaffCount++;

      // Sudah clock in hari ini di outlet ini?
      const { data: existingRecord } = await admin
        .from('attendance_records')
        .select('id')
        .eq('user_id', scope.user_id)
        .eq('outlet_id', outlet.id)
        .gte('clock_in_at', `${today}T00:00:00`)
        .lte('clock_in_at', `${today}T23:59:59`)
        .limit(1)
        .maybeSingle();
      if (existingRecord) continue;

      // Sudah dikirimi reminder hari ini untuk outlet ini?
      const { data: alreadySent } = await admin
        .from('attendance_reminders_sent')
        .select('id')
        .eq('user_id', scope.user_id)
        .eq('outlet_id', outlet.id)
        .eq('reminder_date', today)
        .maybeSingle();
      if (alreadySent) continue;

      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth_key')
        .eq('user_id', scope.user_id);
      if (!subs || subs.length === 0) continue; // belum aktifkan notifikasi di device manapun

      const payload = JSON.stringify({
        title: 'Pengingat Clock In',
        body: `Kamu belum clock in di ${outlet.name}. Jangan lupa absen ya!`,
        url: './index.html',
        tag: `clockin-reminder-${outlet.id}-${today}`
      });

      let sentToAny = false;
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            payload
          );
          sentToAny = true;
        } catch (err) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // Subscription sudah tidak valid (misal browser data dihapus) -> bersihkan
            await admin.from('push_subscriptions').delete().eq('id', sub.id);
          }
        }
      }

      if (sentToAny) {
        sentCount++;
        await admin
          .from('attendance_reminders_sent')
          .insert({ user_id: scope.user_id, outlet_id: outlet.id, reminder_date: today })
          .select()
          .maybeSingle();
      }
    }
  }

  return json({ ok: true, checked: checkedStaffCount, sent: sentCount, at: `${today} ${nowTime} ${TIMEZONE}` });
});
