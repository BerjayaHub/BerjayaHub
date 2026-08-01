// supabase/functions/send-fleet-reminders/index.ts
// Deploy: supabase functions deploy send-fleet-reminders
//
// Dipanggil SEKALI SEHARI oleh pg_cron + pg_net (pola yang sama dengan
// send-attendance-reminders). Mengirim ringkasan dokumen kendaraan
// (STNK pajak, STNK 5 tahun, KIR) yang kedaluwarsa atau mendekati jatuh tempo
// ke grup Telegram.
//
// Ambang "mendekati" diambil dari fleet_settings.reminder_lead_days per BU —
// jadi tetap bisa diatur admin dari Admin Portal, tidak di-hardcode di sini.

import { createClient } from 'npm:@supabase/supabase-js@2'; // npm:, bukan esm.sh — lihat catatan di create-staff-user

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const TIMEZONE = 'Asia/Jakarta';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 'YYYY-MM-DD' hari ini di WIB. */
function todayWIB() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function daysUntil(dateStr: string, today: string) {
  return Math.round((new Date(dateStr + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000);
}

const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Grup tujuan untuk event 'fleet_docs'.
 * Urutan: rute khusus BU -> rute global -> secret cadangan. Sama dengan
 * notify-telegram, supaya pengaturannya satu pintu di Admin Portal.
 */
async function resolveChat(buId: string | null, routes: { chat_id: string; business_unit_id: string | null }[]) {
  const khususBu = buId ? routes.find((r) => r.business_unit_id === buId) : null;
  const global = routes.find((r) => !r.business_unit_id);
  return khususBu?.chat_id ?? global?.chat_id ?? CHAT_ID ?? null;
}

async function sendTelegram(text: string, chatId: string | null) {
  if (!BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN belum diset.' };
  if (!chatId) return { ok: false, error: "Grup tujuan untuk 'fleet_docs' belum diatur." };
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

Deno.serve(async (req) => {
  if (CRON_SECRET) {
    const provided = req.headers.get('x-cron-secret');
    if (provided !== CRON_SECRET) return json({ error: 'Unauthorized' }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true; // untuk uji tanpa benar-benar mengirim
  const today = todayWIB();

  // Sudah pernah dikirim hari ini? (dicek saja — penandanya ditulis SETELAH
  // pengiriman berhasil, lihat catatan di bawah.)
  if (!dryRun) {
    const { data: sudah } = await admin
      .from('telegram_notifications_sent')
      .select('id')
      .eq('kind', 'fleet_docs')
      .eq('ref', today)
      .maybeSingle();
    if (sudah) return json({ ok: true, skipped: true, reason: `Sudah dikirim untuk ${today}.` });
  }

  const [{ data: vehicles, error: vErr }, { data: settings }, { data: routes }] = await Promise.all([
    admin
      .from('vehicles')
      .select('plate_number, brand, model, rental_area, business_unit_id, stnk_tax_expiry, stnk_expiry, kir_expiry, is_active')
      .eq('is_active', true),
    admin.from('fleet_settings').select('business_unit_id, reminder_lead_days'),
    admin.from('telegram_routes').select('chat_id, business_unit_id').eq('event_key', 'fleet_docs').eq('is_active', true)
  ]);
  if (vErr) return json({ error: vErr.message }, 500);

  const leadByBu = new Map((settings ?? []).map((s) => [s.business_unit_id, Number(s.reminder_lead_days) || 30]));

  type Doc = { plat: string; kendaraan: string; area: string; jenis: string; tanggal: string; sisa: number; buId: string };
  const perlu: Doc[] = [];

  for (const v of vehicles ?? []) {
    const lead = leadByBu.get(v.business_unit_id) ?? 30;
    const cek = (jenis: string, tanggal: string | null) => {
      if (!tanggal) return;
      const sisa = daysUntil(tanggal, today);
      if (sisa > lead) return; // masih aman
      perlu.push({
        plat: v.plate_number,
        kendaraan: [v.brand, v.model].filter(Boolean).join(' ') || '-',
        area: v.rental_area ?? '-',
        jenis,
        tanggal,
        sisa,
        buId: v.business_unit_id
      });
    };
    cek('Pajak STNK', v.stnk_tax_expiry);
    cek('STNK 5 tahun', v.stnk_expiry);
    cek('KIR', v.kir_expiry);
  }

  if (!perlu.length) {
    // Sengaja TIDAK menulis penanda dedupe: kalau dokumen jatuh tempo baru
    // diisi admin siang harinya, jalannya cron berikutnya masih bisa mengirim.
    return json({ ok: true, sent: false, reason: 'Tidak ada dokumen yang mendekati jatuh tempo.' });
  }

  perlu.sort((a, b) => a.sisa - b.sisa);

  const baris = (d: Doc) =>
    `• <b>${esc(d.plat)}</b> — ${esc(d.jenis)}: ${fmtDate(d.tanggal)} ` +
    (d.sisa < 0 ? `(lewat ${Math.abs(d.sisa)} hari)` : d.sisa === 0 ? '(hari ini)' : `(${d.sisa} hari lagi)`) +
    (d.area && d.area !== '-' ? `\n   <i>${esc(d.area)} · ${esc(d.kendaraan)}</i>` : `\n   <i>${esc(d.kendaraan)}</i>`);

  // Dikelompokkan per GRUP TUJUAN: kalau nanti ada rute khusus per BU, tiap grup
  // hanya menerima kendaraan miliknya sendiri. Saat semua rute masih global,
  // hasilnya tetap satu pesan seperti biasa.
  const perChat = new Map<string, Doc[]>();
  for (const d of perlu) {
    const chat = await resolveChat(d.buId, routes ?? []);
    if (!chat) continue;
    if (!perChat.has(chat)) perChat.set(chat, []);
    perChat.get(chat)!.push(d);
  }
  if (!perChat.size) {
    return json({ ok: false, error: "Grup tujuan untuk 'fleet_docs' belum diatur di Admin Portal." }, 502);
  }

  const buatTeks = (docs: Doc[]) => {
    const lewat = docs.filter((d) => d.sisa < 0);
    const segera = docs.filter((d) => d.sisa >= 0);
    return [
      '🚗 <b>Pengingat Dokumen Kendaraan</b>',
      `<i>${fmtDate(today)}</i>`,
      lewat.length ? `\n🔴 <b>KEDALUWARSA (${lewat.length})</b>\n${lewat.map(baris).join('\n')}` : '',
      segera.length ? `\n🟡 <b>Segera jatuh tempo (${segera.length})</b>\n${segera.map(baris).join('\n')}` : ''
    ]
      .filter(Boolean)
      .join('\n');
  };

  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      count: perlu.length,
      previews: [...perChat.entries()].map(([chat, docs]) => ({ chat_id: chat, count: docs.length, preview: buatTeks(docs) }))
    });
  }

  const hasil = [];
  for (const [chat, docs] of perChat) {
    hasil.push({ chat_id: chat, count: docs.length, ...(await sendTelegram(buatTeks(docs), chat)) });
  }
  const semuaOk = hasil.every((h) => h.ok);

  // Penanda dedupe ditulis DI SINI, bukan di awal. Kalau ditulis di awal, satu
  // kali jalan yang gagal / tidak menemukan apa pun akan mengunci sisa hari itu
  // dan pengiriman berikutnya selalu "skipped" — persis gejala
  // "tes masuk, tapi saat di-run tidak ada notifikasi".
  if (semuaOk) {
    await admin.from('telegram_notifications_sent').insert({ kind: 'fleet_docs', ref: today });
  }
  return json({ ok: semuaOk, count: perlu.length, results: hasil }, semuaOk ? 200 : 502);
});
