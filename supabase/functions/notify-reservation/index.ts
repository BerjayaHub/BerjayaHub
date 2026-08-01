// supabase/functions/notify-reservation/index.ts
// Deploy: supabase functions deploy notify-reservation --no-verify-jwt
//
// Dipanggil trigger `trg_notify_reservations` (migration 0044) setiap ada
// reservasi baru. Mengirim DUA notifikasi sekaligus:
//   1. Telegram ke grup (rute event 'reservation' di tabel telegram_routes)
//   2. Web Push ke ADMIN outlet terkait, supaya yang berwenang menyetujui
//      langsung tahu tanpa harus memantau grup.
//
// Secrets: TELEGRAM_BOT_TOKEN, NOTIFY_SECRET, VAPID_PUBLIC_KEY,
//          VAPID_PRIVATE_KEY, VAPID_SUBJECT

import { createClient } from 'npm:@supabase/supabase-js@2'; // npm:, bukan esm.sh — lihat catatan di create-staff-user
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
const NOTIFY_SECRET = Deno.env.get('NOTIFY_SECRET');
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notify-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

/** Jumlah malam; tanggal check-out tidak dihitung sebagai malam menginap. */
const malamAntara = (a: string, b: string) =>
  Math.max(0, Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000));

async function resolveChat(buId: string | null) {
  const { data } = await admin
    .from('telegram_routes')
    .select('chat_id, business_unit_id')
    .eq('event_key', 'reservation')
    .eq('is_active', true);
  const rows = data ?? [];
  return (buId ? rows.find((r) => r.business_unit_id === buId)?.chat_id : null) ?? rows.find((r) => !r.business_unit_id)?.chat_id ?? CHAT_ID ?? null;
}

async function sendTelegram(text: string, chatId: string | null) {
  if (!BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN belum diset.' };
  if (!chatId) return { ok: false, error: "Grup tujuan untuk 'reservation' belum diatur." };
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) {
    let error = body?.description ?? `HTTP ${res.status}`;
    const idBaru = body?.parameters?.migrate_to_chat_id;
    if (idBaru) error += ` — grup sudah jadi supergroup, ID barunya: ${idBaru}.`;
    return { ok: false, error };
  }
  return { ok: true };
}

/**
 * Push ke SELURUH TIM outlet terkait — bukan cuma admin.
 *
 * Sebelumnya hanya admin yang dikirimi, dengan alasan "merekalah yang
 * menyetujui". Itu benar untuk reservasi cafe dari website, tapi salah untuk
 * dua hal lain:
 *   - Booking hotel diisi ADMIN dan langsung terkonfirmasi. Kalau hanya admin
 *     yang diberi tahu, orang yang justru perlu tahu — resepsionis dan staf
 *     yang menyiapkan kamar — tidak pernah dapat kabar.
 *   - Staff cafe juga perlu tahu ada tamu masuk, bukan sekadar menunggu
 *     diberitahu lisan.
 *
 * Penerimanya dibatasi sama seperti apa yang orang itu LIHAT di dalam app:
 * punya scope di outlet tersebut (atau scope level BU), dan modul Reservasi
 * tidak dicabut untuk dia lewat `user_module_access`.
 */
// deno-lint-ignore no-explicit-any
async function pushKeTim(r: any, outletName: string) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return { ok: false, error: 'VAPID belum diset.' };

  const { data: scopes } = await admin
    .from('membership_scopes')
    .select('user_id, role, outlet_id, business_unit_id')
    .eq('business_unit_id', r.business_unit_id);

  // Scope level BU (outlet_id null) mencakup semua outlet BU itu.
  const userIds = [
    ...new Set(
      (scopes ?? [])
        .filter((s) => s.outlet_id == null || s.outlet_id === r.outlet_id)
        .map((s) => s.user_id)
    )
  ];
  if (!userIds.length) return { ok: true, sent: 0, reason: 'Tidak ada anggota tim di outlet ini.' };

  // Hormati pencabutan modul per user — notifikasi tidak boleh lebih luas
  // daripada apa yang bisa dia buka di aplikasi.
  const { data: modRow } = await admin.from('modules').select('id').eq('code', 'reservation').maybeSingle();
  const { data: akses } = await admin
    .from('user_module_access')
    .select('user_id, module_id')
    .eq('business_unit_id', r.business_unit_id)
    .in('user_id', userIds);
  const punyaWhitelist = new Set((akses ?? []).map((a) => a.user_id));
  const bolehReservasi = new Set((akses ?? []).filter((a) => a.module_id === modRow?.id).map((a) => a.user_id));
  const penerima = userIds.filter((u) => !punyaWhitelist.has(u) || bolehReservasi.has(u));
  if (!penerima.length) return { ok: true, sent: 0, reason: 'Modul Reservasi dicabut untuk semua anggota outlet ini.' };

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key, user_id')
    .in('user_id', penerima);
  if (!subs?.length) return { ok: true, sent: 0, reason: 'Belum ada yang mengaktifkan notifikasi di perangkatnya.' };

  const hotel = r.mode === 'hotel';
  const payload = JSON.stringify({
    title: hotel ? '🏨 Booking kamar baru' : '📅 Reservasi baru',
    body: hotel
      ? `${r.customer_name} · ${fmtDate(r.check_in)} → ${fmtDate(r.check_out)} di ${outletName}`
      : `${r.customer_name} · ${r.pax} tamu · ${fmtDate(r.reserve_date)} ${String(r.reserve_time).slice(0, 5)} di ${outletName}`,
    url: './index.html',
    tag: `reservation-${r.id}`
  });

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, payload);
      sent++;
    } catch (err) {
      const e = err as { statusCode?: number };
      // Langganan mati (browser dibersihkan / izin dicabut) -> rapikan.
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      }
    }
  }
  return { ok: true, sent, penerima: penerima.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (NOTIFY_SECRET) {
    const provided = req.headers.get('x-notify-secret');
    if (provided !== NOTIFY_SECRET && !req.headers.get('authorization')) return json({ error: 'Unauthorized' }, 401);
  }

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Body harus JSON' }, 400);
  }

  const r = payload?.record;
  if (payload?.table !== 'reservations' || payload?.type !== 'INSERT' || !r) {
    return json({ ok: true, skipped: true, reason: 'Event tidak perlu dikirim.' });
  }

  const [{ data: outlet }, { data: area }, { data: tipeKamar }] = await Promise.all([
    admin.from('outlets').select('name').eq('id', r.outlet_id).maybeSingle(),
    r.area_id ? admin.from('reservation_areas').select('name').eq('id', r.area_id).maybeSingle() : Promise.resolve({ data: null }),
    r.room_type_id
      ? admin.from('room_types').select('name').eq('id', r.room_type_id).maybeSingle()
      : Promise.resolve({ data: null })
  ]);
  const outletName = outlet?.name ?? '-';
  const namaTipeKamar = tipeKamar?.name ?? 'Kamar';
  const dariWeb = r.source === 'web';

  const hotel = r.mode === 'hotel';

  // Baris tengahnya berbeda per mode: cafe menjawab "jam berapa, berapa orang",
  // hotel menjawab "kamar apa, dari kapan sampai kapan". Memaksakan satu format
  // untuk keduanya akan menampilkan "null tamu" di salah satunya.
  const inti = hotel
    ? [
        `🛏️ <b>${esc(namaTipeKamar)}</b>`,
        `📆 ${fmtDate(r.check_in)} → ${fmtDate(r.check_out)} (${malamAntara(r.check_in, r.check_out)} malam)`,
        `👥 ${r.adults ?? 1} dewasa${r.children ? ` + ${r.children} anak` : ''}`
      ]
    : [`📆 ${fmtDate(r.reserve_date)}`, `🕐 <b>${String(r.reserve_time).slice(0, 5)}</b> · 👥 <b>${r.pax} tamu</b>`];

  const text = [
    hotel
      ? '🏨 <b>Booking Kamar Baru</b>'
      : dariWeb
        ? '🌐 <b>Reservasi Baru — dari Website</b>'
        : '📅 <b>Reservasi Baru — dari Staff</b>',
    '',
    r.code ? `🔖 ${esc(r.code)}` : '',
    `🏪 ${esc(outletName)}${!hotel && area?.name ? ` · ${esc(area.name)}` : ''}`,
    ...inti,
    '',
    `👤 ${esc(r.customer_name)}`,
    `📱 ${esc(r.phone)}${r.email ? `\n✉️ ${esc(r.email)}` : ''}`,
    r.notes ? `💬 ${esc(r.notes)}` : '',
    r.referral_source ? `📣 Tahu dari: ${esc(r.referral_source)}` : '',
    '',
    r.status === 'pending'
      ? '<i>Menunggu persetujuan di Admin Portal → Reservasi.</i>'
      : '<i>Sudah dikonfirmasi.</i>'
  ]
    .filter(Boolean)
    .join('\n');

  const [tg, push] = await Promise.all([
    sendTelegram(text, await resolveChat(r.business_unit_id)),
    // TANPA syarat status. Versi lama hanya mengirim saat status 'pending',
    // sehingga booking hotel — yang dibuat admin dan langsung 'confirmed' —
    // TIDAK PERNAH memicu push sama sekali. Yang batal/ditolak memang tidak
    // pernah sampai ke sini karena trigger-nya hanya on INSERT.
    pushKeTim(r, outletName)
  ]);

  return json({ ok: tg.ok, telegram: tg, push });
});
