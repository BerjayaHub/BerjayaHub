// supabase/functions/send-shift-gap-alerts/index.ts
// Deploy: supabase functions deploy send-shift-gap-alerts
//
// Peringatan ke ADMIN kalau jadwal shift besok masih kosong di outlet yang
// memakai modul Shift.
//
// KENAPA ADA: sejak reminder clock in mengikuti jadwal shift, "tidak
// dijadwalkan" berarti "tidak diingatkan". Kalau admin lupa menyusun jadwal,
// seisi outlet tidak akan diingatkan besok — dan tidak ada satu pun tanda
// bahwa itu sedang terjadi. Fungsi ini yang memberi tandanya.
//
// Dipanggil pg_cron sekali sehari sore hari (lihat DEPLOY.md).

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const TIMEZONE = 'Asia/Jakarta';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** 'YYYY-MM-DD' di TIMEZONE, digeser sekian hari. */
function tanggalWIB(geserHari = 0) {
  const sekarang = new Date();
  const wib = new Date(sekarang.toLocaleString('en-US', { timeZone: TIMEZONE }));
  wib.setDate(wib.getDate() + geserHari);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${wib.getFullYear()}-${p(wib.getMonth() + 1)}-${p(wib.getDate())}`;
}

Deno.serve(async (req) => {
  if (CRON_SECRET) {
    if (req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'Unauthorized' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // tanpa body -> alur normal
  }
  // dry_run: hitung dan laporkan, TIDAK mengirim & TIDAK menandai terkirim.
  // Tanpa mode ini, satu-satunya cara menguji adalah dengan benar-benar
  // mengirim notifikasi ke orang sungguhan.
  const dryRun = body.dry_run === true;
  // Bisa diarahkan ke tanggal lain untuk pengujian.
  const target = typeof body.date === 'string' && body.date ? body.date : tanggalWIB(1);

  const { data: outlets, error: outletError } = await admin
    .from('outlets')
    .select('id, name, business_unit_id, shift_enabled, reminder_enabled, is_active')
    .eq('shift_enabled', true)
    .eq('reminder_enabled', true);
  if (outletError) return json({ error: outletError.message }, 500);

  const laporan: Array<Record<string, unknown>> = [];
  let terkirim = 0;

  for (const outlet of outlets ?? []) {
    if (outlet.is_active === false) continue;

    // Ada jadwal untuk tanggal itu? Satu baris pun sudah cukup — kalau admin
    // sudah mulai mengisi, dia jelas tidak lupa. Yang kita cari adalah outlet
    // yang benar-benar KOSONG, bukan yang setengah terisi; menegur orang yang
    // sedang bekerja adalah cara tercepat membuat peringatan diabaikan.
    const { count, error: cntErr } = await admin
      .from('shift_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('outlet_id', outlet.id)
      .eq('work_date', target);
    if (cntErr) {
      laporan.push({ outlet: outlet.name, error: cntErr.message });
      continue;
    }
    if ((count ?? 0) > 0) continue;

    // Sudah diperingatkan untuk tanggal ini?
    if (!dryRun) {
      const { data: sudah } = await admin
        .from('shift_gap_alerts_sent')
        .select('id')
        .eq('outlet_id', outlet.id)
        .eq('gap_date', target)
        .maybeSingle();
      if (sudah) {
        laporan.push({ outlet: outlet.name, dilewati: 'sudah diperingatkan' });
        continue;
      }
    }

    // ---- SIAPA YANG DIBERI TAHU ----
    //
    // Berjenjang, dan sengaja BERHENTI di jenjang pertama yang berisi orang.
    // Mengirim ke semua admin BU sekaligus terdengar aman, tapi hasilnya
    // peringatan yang tidak jelas jadi tanggung jawab siapa — dan sesuatu yang
    // menjadi tanggung jawab semua orang tidak dikerjakan siapa pun. Yang paling
    // mungkin bertindak adalah admin outlet itu sendiri.
    //
    // Jenjang berikutnya baru dipakai kalau jenjang sebelumnya KOSONG, supaya
    // outlet tanpa admin sendiri tidak berakhir tanpa siapa pun yang tahu.
    const { data: scopes } = await admin
      .from('membership_scopes')
      .select('user_id, role, outlet_id, business_unit_id, user_profiles(is_active)')
      .or(`outlet_id.eq.${outlet.id},business_unit_id.eq.${outlet.business_unit_id},role.eq.super_admin`);

    const aktif = (scopes ?? []).filter((s) => (s as { user_profiles?: { is_active?: boolean } }).user_profiles?.is_active !== false);
    const adminOutlet = aktif.filter((s) => s.role === 'outlet_admin' && s.outlet_id === outlet.id);
    const adminBu = aktif.filter((s) => s.role === 'bu_admin' && s.business_unit_id === outlet.business_unit_id);
    const superAdmin = aktif.filter((s) => s.role === 'super_admin');

    const dipilih = adminOutlet.length ? adminOutlet : adminBu.length ? adminBu : superAdmin;
    const jenjang = adminOutlet.length ? 'admin outlet' : adminBu.length ? 'admin BU' : 'super admin';
    const penerima = [...new Set(dipilih.map((s) => s.user_id))];

    if (!penerima.length) {
      laporan.push({ outlet: outlet.name, tanggal: target, masalah: 'tidak ada admin yang bisa diberi tahu' });
      continue;
    }

    if (dryRun) {
      laporan.push({ outlet: outlet.name, tanggal: target, akanDikirimKe: penerima.length, jenjang });
      continue;
    }

    const payload = JSON.stringify({
      title: 'Jadwal shift besok masih kosong',
      body: `Belum ada jadwal untuk ${outlet.name} pada ${target}. Staff tidak akan dapat pengingat clock in.`,
      url: './admin.html',
      tag: `shift-gap-${outlet.id}-${target}`
    });

    let berhasil = 0;
    for (const uid of penerima) {
      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth_key')
        .eq('user_id', uid);
      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, payload);
          berhasil++;
        } catch (err) {
          const e = err as { statusCode?: number };
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            await admin.from('push_subscriptions').delete().eq('id', sub.id);
          }
        }
      }
    }

    // Ditandai HANYA kalau benar-benar ada yang terkirim. Kalau ditandai walau
    // gagal semua, peringatannya hilang untuk selamanya pada tanggal itu —
    // gagal senyap yang justru menutupi gagal senyap lain.
    if (berhasil > 0) {
      terkirim++;
      await admin.from('shift_gap_alerts_sent').insert({ outlet_id: outlet.id, gap_date: target, penerima: penerima.length });
    }
    laporan.push({ outlet: outlet.name, tanggal: target, penerima: penerima.length, jenjang, push: berhasil });
  }

  return json({
    ok: true,
    dryRun,
    tanggalDiperiksa: target,
    outletShift: (outlets ?? []).length,
    outletDiperingatkan: terkirim,
    laporan
  });
});
