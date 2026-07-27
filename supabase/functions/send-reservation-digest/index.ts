// supabase/functions/send-reservation-digest/index.ts
// Deploy: supabase functions deploy send-reservation-digest
//
// Rekap harian reservasi lewat Web Push (PWA). Dijalankan cron sekali sehari.
//
// Siapa yang menerima: staff/admin di BU yang MENGAKTIFKAN modul Reservasi,
// dan isinya dibatasi ke outlet yang memang jadi scope orang itu. Prinsipnya:
// cakupan notifikasi = cakupan yang orang itu lihat di dalam app. Pembatasan
// per-user lewat `user_module_access` juga dihormati, supaya orang yang modul
// Reservasi-nya dicabut admin tidak ikut diberi tahu.
//
// Reservasi kosong TIDAK dikirim — pemberitahuan "hari ini tidak ada reservasi"
// setiap pagi hanya melatih orang mengabaikan notifikasi.
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const TIMEZONE = 'Asia/Jakarta';
const MAX_BARIS = 6; // sisanya diringkas "…dan N lainnya" — body notifikasi pendek

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/** 'YYYY-MM-DD' di WIB, plus/minus sejumlah hari. */
function dateWIB(offsetDays = 0) {
  const base = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(base);
}

Deno.serve(async (req) => {
  if (CRON_SECRET) {
    const provided = req.headers.get('x-cron-secret');
    if (provided !== CRON_SECRET) return json({ error: 'Unauthorized' }, 401);
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return json({ error: 'VAPID belum diset.' }, 500);

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;
  // offset_days: 0 = hari ini (default), 1 = besok — untuk rekap H-1 malam hari.
  const offset = Number.isInteger(body?.offset_days) ? body.offset_days : 0;
  const tanggal = body?.date ?? dateWIB(offset);
  const untukBesok = offset === 1;

  // Cegah dobel kirim kalau cron tidak sengaja jalan dua kali.
  if (!dryRun) {
    const { error: dupErr } = await admin
      .from('telegram_notifications_sent')
      .insert({ kind: 'reservation_digest', ref: `${tanggal}:${offset}` });
    if (dupErr?.code === '23505') return json({ ok: true, skipped: true, reason: `Sudah dikirim untuk ${tanggal}.` });
    if (dupErr) return json({ error: dupErr.message }, 500);
  }

  // ---- BU yang mengaktifkan modul Reservasi ----
  const { data: modRow } = await admin.from('modules').select('id').eq('code', 'reservation').maybeSingle();
  if (!modRow) return json({ error: "Modul 'reservation' belum ada di tabel modules." }, 500);

  const { data: buMods } = await admin
    .from('bu_modules')
    .select('business_unit_id')
    .eq('module_id', modRow.id)
    .eq('is_active', true);
  const buIds = (buMods ?? []).map((b) => b.business_unit_id);
  if (!buIds.length) return json({ ok: true, sent: 0, reason: 'Tidak ada BU yang mengaktifkan modul Reservasi.' });

  // ---- Reservasi pada tanggal itu ----
  const { data: reservasi } = await admin
    .from('reservations')
    .select('outlet_id, business_unit_id, customer_name, reserve_time, pax, status')
    .in('business_unit_id', buIds)
    .eq('reserve_date', tanggal)
    .in('status', ['pending', 'confirmed'])
    .order('reserve_time');
  if (!reservasi?.length) return json({ ok: true, sent: 0, reason: `Tidak ada reservasi pada ${tanggal}.` });

  const { data: outlets } = await admin.from('outlets').select('id, name').in('business_unit_id', buIds);
  const namaOutlet = new Map((outlets ?? []).map((o) => [o.id, o.name]));

  // ---- Penerima: scope + hormati pembatasan modul per user ----
  const { data: scopes } = await admin.from('membership_scopes').select('user_id, business_unit_id, outlet_id').in('business_unit_id', buIds);
  const userIds = [...new Set((scopes ?? []).map((s) => s.user_id))];
  if (!userIds.length) return json({ ok: true, sent: 0, reason: 'Tidak ada anggota di BU tersebut.' });

  const { data: akses } = await admin
    .from('user_module_access')
    .select('user_id, business_unit_id, module_id')
    .in('user_id', userIds)
    .in('business_unit_id', buIds);
  // Punya baris akses tapi tidak memuat modul Reservasi -> dikecualikan.
  const punyaWhitelist = new Set((akses ?? []).map((a) => `${a.user_id}|${a.business_unit_id}`));
  const bolehReservasi = new Set(
    (akses ?? []).filter((a) => a.module_id === modRow.id).map((a) => `${a.user_id}|${a.business_unit_id}`)
  );

  const { data: subs } = await admin.from('push_subscriptions').select('user_id, endpoint, p256dh, auth_key').in('user_id', userIds);
  if (!subs?.length) return json({ ok: true, sent: 0, reason: 'Belum ada perangkat yang berlangganan notifikasi.' });
  const subsByUser = new Map<string, typeof subs>();
  for (const s of subs) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, [] as typeof subs);
    subsByUser.get(s.user_id)!.push(s);
  }

  // ---- Susun pesan per user ----
  type Msg = { userId: string; title: string; body: string };
  const pesan: Msg[] = [];

  for (const uid of userIds) {
    if (!subsByUser.has(uid)) continue;
    const scopeUser = (scopes ?? []).filter((s) => s.user_id === uid);

    // Outlet yang boleh dilihat user ini, per BU yang modulnya aktif.
    const outletBoleh = new Set<string>();
    let semuaOutletBu = false;
    const buUser = new Set<string>();
    for (const sc of scopeUser) {
      const key = `${uid}|${sc.business_unit_id}`;
      if (punyaWhitelist.has(key) && !bolehReservasi.has(key)) continue; // modul dicabut untuk user ini
      buUser.add(sc.business_unit_id);
      if (sc.outlet_id) outletBoleh.add(sc.outlet_id);
      else semuaOutletBu = true; // scope level BU -> semua outlet BU itu
    }
    if (!buUser.size) continue;

    const milikDia = reservasi.filter(
      (r) => buUser.has(r.business_unit_id) && (semuaOutletBu || outletBoleh.has(r.outlet_id))
    );
    if (!milikDia.length) continue;

    const totalTamu = milikDia.reduce((t, r) => t + (Number(r.pax) || 0), 0);
    const belumOk = milikDia.filter((r) => r.status === 'pending').length;

    // Kalau lintas outlet, nama outlet disertakan supaya tidak membingungkan.
    const outletSet = new Set(milikDia.map((r) => r.outlet_id));
    const baris = milikDia
      .slice(0, MAX_BARIS)
      .map((r) => {
        const jam = String(r.reserve_time).slice(0, 5);
        const tempat = outletSet.size > 1 ? ` @${namaOutlet.get(r.outlet_id) ?? '-'}` : '';
        return `${jam} ${r.customer_name} (${r.pax})${tempat}`;
      })
      .join('\n');
    const sisa = milikDia.length - MAX_BARIS;

    const judulTempat = outletSet.size === 1 ? ` — ${namaOutlet.get([...outletSet][0]) ?? ''}` : '';
    pesan.push({
      userId: uid,
      title: `📅 Reservasi ${untukBesok ? 'besok' : 'hari ini'}${judulTempat}`,
      body:
        `${milikDia.length} reservasi · ${totalTamu} tamu` +
        (belumOk ? ` · ${belumOk} belum dikonfirmasi` : '') +
        `\n${baris}` +
        (sisa > 0 ? `\n…dan ${sisa} lainnya` : '')
    });
  }

  if (dryRun) return json({ ok: true, dry_run: true, tanggal, penerima: pesan.length, contoh: pesan.slice(0, 3) });

  // ---- Kirim ----
  let terkirim = 0;
  const gagal: Array<Record<string, unknown>> = [];
  for (const m of pesan) {
    const payload = JSON.stringify({
      title: m.title,
      body: m.body,
      url: './index.html',
      tag: `reservation-digest-${tanggal}`
    });
    for (const sub of subsByUser.get(m.userId) ?? []) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, payload);
        terkirim++;
      } catch (err) {
        const e = err as { statusCode?: number; body?: string; message?: string };
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
        gagal.push({ user_id: m.userId, statusCode: e?.statusCode, detail: e?.body ?? e?.message });
      }
    }
  }

  return json({ ok: true, tanggal, penerima: pesan.length, terkirim, gagal: gagal.length, detail_gagal: gagal.slice(0, 10) });
});
