// supabase/functions/notify-telegram/index.ts
// Deploy: supabase functions deploy notify-telegram --no-verify-jwt
//
// Satu-satunya pintu kirim pesan Telegram. Token bot HANYA hidup di sini
// sebagai secret Supabase — tidak pernah masuk folder js/ karena repo ini
// publik di GitHub Pages.
//
// Dipanggil oleh:
//   1. Database Webhook Supabase (INSERT/UPDATE pada leave_requests & stock_orders)
//   2. Admin Portal, untuk kirim pesan tes ({"test": true})
//
// Tujuan grup dibaca dari tabel `telegram_routes` (event -> chat), BUKAN dari
// secret, supaya bisa diubah dari Admin Portal tanpa redeploy. TELEGRAM_CHAT_ID
// hanya dipakai sebagai cadangan kalau rute belum diatur.
//
// Secrets yang dibutuhkan:
//   supabase secrets set TELEGRAM_BOT_TOKEN=...
//   supabase secrets set NOTIFY_SECRET=...            (opsional tapi disarankan)
//   supabase secrets set TELEGRAM_CHAT_ID=-100...     (opsional, cadangan)

import { createClient } from 'npm:@supabase/supabase-js@2'; // npm:, bukan esm.sh — lihat catatan di create-staff-user

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
// Dipakai Database Webhook lewat custom header `x-notify-secret`.
// Kalau tidak diset, pemeriksaan dilewati (mis. saat masih uji coba).
const NOTIFY_SECRET = Deno.env.get('NOTIFY_SECRET');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notify-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---- Telegram ----

/** Escape untuk parse_mode HTML — hanya 3 karakter ini yang wajib. */
function esc(s: unknown) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Cari grup tujuan untuk sebuah event.
 * Urutan: rute khusus BU -> rute global (business_unit_id null) -> secret cadangan.
 */
async function resolveChat(eventKey: string, buId: string | null): Promise<string | null> {
  const { data } = await admin
    .from('telegram_routes')
    .select('chat_id, business_unit_id')
    .eq('event_key', eventKey)
    .eq('is_active', true);
  const rows = data ?? [];
  const khususBu = buId ? rows.find((r) => r.business_unit_id === buId) : null;
  const global = rows.find((r) => !r.business_unit_id);
  return khususBu?.chat_id ?? global?.chat_id ?? CHAT_ID ?? null;
}

export async function sendTelegram(text: string, chatId: string | null) {
  if (!BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN belum diset sebagai secret.' };
  if (!chatId) return { ok: false, error: 'Grup tujuan belum diatur untuk event ini (Admin Portal -> Notifikasi Telegram).' };
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });
  const body = await res.json().catch(() => ({}));
  // Telegram membalas 200 dengan {ok:false} kalau chat_id salah / bot dikeluarkan
  // dari grup — jadi status HTTP saja tidak cukup untuk menyimpulkan berhasil.
  if (!res.ok || body?.ok === false) {
    let error = body?.description ?? `HTTP ${res.status}`;
    // Grup biasa yang di-UPGRADE jadi supergroup akan berganti ID. Telegram
    // memberi tahu ID barunya di `parameters.migrate_to_chat_id` — disebutkan
    // langsung supaya admin tinggal menyalinnya, tidak perlu menebak.
    const idBaru = body?.parameters?.migrate_to_chat_id;
    if (idBaru) error += ` — grup ini sudah jadi supergroup, ID barunya: ${idBaru}. Ganti ID chat di Admin Portal dengan angka itu.`;
    return { ok: false, error, statusCode: res.status, migrateTo: idBaru ?? null };
  }
  return { ok: true };
}

// ---- Format tanggal ----

const fmtDate = (d: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }) : '-';

// ---- Formatter per event ----

async function namaUser(id: string | null) {
  if (!id) return '-';
  const { data } = await admin.from('user_profiles').select('full_name').eq('id', id).maybeSingle();
  return data?.full_name ?? '-';
}

async function namaBu(id: string | null) {
  if (!id) return null;
  const { data } = await admin.from('business_units').select('name').eq('id', id).maybeSingle();
  return data?.name ?? null;
}

async function namaOutlet(id: string | null) {
  if (!id) return null;
  const { data } = await admin.from('outlets').select('name').eq('id', id).maybeSingle();
  return data?.name ?? null;
}

// deno-lint-ignore no-explicit-any
async function pesanCutiBaru(r: any) {
  const [nama, jenis, bu, outlet] = await Promise.all([
    namaUser(r.user_id),
    admin.from('leave_types').select('name').eq('id', r.leave_type_id).maybeSingle().then((x) => x.data?.name ?? 'Cuti'),
    namaBu(r.business_unit_id),
    namaOutlet(r.outlet_id)
  ]);
  const lokasi = [bu, outlet].filter(Boolean).join(' · ');
  return [
    '📝 <b>Pengajuan Cuti Baru</b>',
    '',
    `👤 <b>${esc(nama)}</b>${lokasi ? `\n🏢 ${esc(lokasi)}` : ''}`,
    `🗂 Jenis: ${esc(jenis)}`,
    `📅 ${fmtDate(r.start_date)} – ${fmtDate(r.end_date)} (<b>${r.day_count} hari</b>)`,
    r.reason ? `💬 ${esc(r.reason)}` : '',
    r.attachment_path ? '📎 Ada lampiran' : '',
    '',
    '<i>Menunggu persetujuan PIC di Admin Portal.</i>'
  ]
    .filter(Boolean)
    .join('\n');
}

// deno-lint-ignore no-explicit-any
async function pesanCutiDireview(r: any) {
  const disetujui = r.status === 'approved';
  const [nama, reviewer, jenis] = await Promise.all([
    namaUser(r.user_id),
    namaUser(r.reviewed_by),
    admin.from('leave_types').select('name').eq('id', r.leave_type_id).maybeSingle().then((x) => x.data?.name ?? 'Cuti')
  ]);
  return [
    disetujui ? '✅ <b>Cuti Disetujui</b>' : '❌ <b>Cuti Ditolak</b>',
    '',
    `👤 <b>${esc(nama)}</b>`,
    `🗂 Jenis: ${esc(jenis)}`,
    `📅 ${fmtDate(r.start_date)} – ${fmtDate(r.end_date)} (<b>${r.day_count} hari</b>)`,
    `🧑‍💼 Diputuskan oleh: ${esc(reviewer)}`,
    r.review_note ? `💬 ${esc(r.review_note)}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

// deno-lint-ignore no-explicit-any
async function pesanOrderStok(r: any) {
  const [dari, ke, pemesan, items] = await Promise.all([
    namaOutlet(r.from_outlet_id),
    namaOutlet(r.to_outlet_id),
    namaUser(r.created_by),
    admin.from('stock_order_items').select('qty, products(name, base_unit)').eq('order_id', r.id)
  ]);
  // deno-lint-ignore no-explicit-any
  const daftar = (items.data ?? []).map((i: any) => `• ${esc(i.products?.name ?? '-')} — ${i.qty} ${esc(i.products?.base_unit ?? '')}`);
  return [
    '📦 <b>Order Stok Baru</b>',
    '',
    r.code ? `🔖 ${esc(r.code)}` : '',
    `🏪 Dari: <b>${esc(dari ?? '-')}</b>`,
    `🏭 Ke: <b>${esc(ke ?? '-')}</b>`,
    `👤 Pemesan: ${esc(pemesan)}`,
    daftar.length ? `\n<b>Item (${daftar.length}):</b>\n${daftar.slice(0, 30).join('\n')}` : '',
    daftar.length > 30 ? `<i>…dan ${daftar.length - 30} item lain</i>` : '',
    r.notes ? `\n💬 ${esc(r.notes)}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

// deno-lint-ignore no-explicit-any
async function pesanDispatch(r: any, diterima: boolean) {
  const [dari, ke, orang, items] = await Promise.all([
    namaOutlet(r.from_outlet_id),
    namaOutlet(r.to_outlet_id),
    namaUser(diterima ? r.received_by : r.created_by),
    admin.from('dispatch_items').select('sent_qty, received_qty, products(name, base_unit)').eq('dispatch_id', r.id)
  ]);
  // deno-lint-ignore no-explicit-any
  const daftar = (items.data ?? []).map((i: any) => {
    const nama = esc(i.products?.name ?? '-');
    const satuan = esc(i.products?.base_unit ?? '');
    // Saat penerimaan, selisih kirim vs terima adalah info paling penting.
    if (diterima && i.received_qty != null && Number(i.received_qty) !== Number(i.sent_qty)) {
      return `• ${nama} — dikirim ${i.sent_qty}, diterima <b>${i.received_qty}</b> ${satuan} ⚠️`;
    }
    return `• ${nama} — ${diterima ? i.received_qty ?? i.sent_qty : i.sent_qty} ${satuan}`;
  });
  const selisih = (items.data ?? []).filter(
    // deno-lint-ignore no-explicit-any
    (i: any) => diterima && i.received_qty != null && Number(i.received_qty) !== Number(i.sent_qty)
  ).length;

  return [
    diterima ? '📥 <b>Kiriman Diterima</b>' : '🚚 <b>Barang Dikirim</b>',
    '',
    `🏭 Dari: <b>${esc(dari ?? '-')}</b>`,
    `🏪 Ke: <b>${esc(ke ?? '-')}</b>`,
    `👤 ${diterima ? 'Diterima' : 'Dikirim'} oleh: ${esc(orang)}`,
    daftar.length ? `\n<b>Item (${daftar.length}):</b>\n${daftar.slice(0, 30).join('\n')}` : '',
    daftar.length > 30 ? `<i>…dan ${daftar.length - 30} item lain</i>` : '',
    selisih ? `\n⚠️ <b>${selisih} item selisih</b> antara dikirim dan diterima.` : '',
    r.notes ? `\n💬 ${esc(r.notes)}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

type Built = { text: string; eventKey: string; buId: string | null };

/**
 * Ubah payload Database Webhook jadi teks pesan + kunci event (penentu grup).
 * Return null = event ini memang tidak perlu dikirim (bukan error).
 */
// deno-lint-ignore no-explicit-any
async function buildMessage(payload: any): Promise<Built | null> {
  const { type, table, record, old_record } = payload ?? {};
  if (!table || !record) return null;

  if (table === 'leave_requests') {
    const buId = record.business_unit_id ?? null;
    if (type === 'INSERT') return { text: await pesanCutiBaru(record), eventKey: 'leave_submitted', buId };
    if (type === 'UPDATE') {
      // Hanya saat status BERUBAH ke approved/rejected — update lain
      // (mis. melengkapi lampiran) tidak perlu mengganggu grup.
      const berubah = old_record && old_record.status !== record.status;
      if (berubah && (record.status === 'approved' || record.status === 'rejected')) {
        return { text: await pesanCutiDireview(record), eventKey: 'leave_reviewed', buId };
      }
    }
    return null;
  }

  if (table === 'stock_orders') {
    if (type === 'INSERT') {
      return { text: await pesanOrderStok(record), eventKey: 'stock_order', buId: record.business_unit_id ?? null };
    }
    return null;
  }

  if (table === 'dispatches') {
    const buId = record.business_unit_id ?? null;
    if (type === 'INSERT') {
      return { text: await pesanDispatch(record, false), eventKey: 'dispatch_sent', buId };
    }
    if (type === 'UPDATE') {
      // Hanya saat status BERUBAH jadi 'received' — update lain tidak perlu
      // mengganggu grup.
      const berubah = old_record && old_record.status !== record.status;
      if (berubah && record.status === 'received') {
        return { text: await pesanDispatch(record, true), eventKey: 'dispatch_received', buId };
      }
    }
    return null;
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (NOTIFY_SECRET) {
    const provided = req.headers.get('x-notify-secret');
    // Panggilan dari Admin Portal membawa JWT user, bukan secret — itu sudah
    // dijaga oleh gerbang Supabase, jadi cukup salah satu terpenuhi.
    const punyaJwt = !!req.headers.get('authorization');
    if (provided !== NOTIFY_SECRET && !punyaJwt) return json({ error: 'Unauthorized' }, 401);
  }

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Body harus JSON' }, 400);
  }

  // Deteksi grup: tanya Telegram grup mana saja yang BOT INI ada di dalamnya.
  // Menghilangkan tebak-tebakan ID — sekaligus membuktikan keanggotaan bot,
  // karena getUpdates hanya memuat chat tempat bot benar-benar menjadi anggota.
  if (payload?.detect_chats) {
    if (!BOT_TOKEN) return json({ error: 'TELEGRAM_BOT_TOKEN belum diset sebagai secret.' }, 400);
    try {
      // Tanpa parameter `offset`, update TIDAK dikonsumsi — jadi aman dipanggil
      // berkali-kali dan tidak mengganggu sistem lain yang memakai bot sama.
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=100`);
      const body = await res.json().catch(() => ({}));
      if (body?.ok === false) {
        let error = body?.description ?? `HTTP ${res.status}`;
        if (String(error).includes('terminated by other getUpdates')) {
          error += ' — ada sistem lain yang sedang polling bot ini (kemungkinan app lama). Matikan sementara, lalu coba lagi.';
        }
        if (String(error).includes('webhook is active')) {
          error += ' — bot ini dipakai dengan mode webhook oleh sistem lain, jadi deteksi otomatis tidak bisa dipakai.';
        }
        return json({ error }, 502);
      }
      const me = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`)
        .then((r) => r.json())
        .catch(() => null);

      const chats = new Map<string, { id: string; title: string; type: string }>();
      // deno-lint-ignore no-explicit-any
      for (const u of (body?.result ?? []) as any[]) {
        const c = u?.message?.chat ?? u?.channel_post?.chat ?? u?.my_chat_member?.chat;
        if (!c?.id) continue;
        chats.set(String(c.id), {
          id: String(c.id),
          title: c.title ?? c.username ?? c.first_name ?? '(tanpa nama)',
          type: c.type ?? '-'
        });
      }
      return json({ ok: true, bot: me?.result?.username ?? null, chats: [...chats.values()] });
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }

  // Mode tes dari Admin Portal. Bisa menyasar chat tertentu (chat_id) atau
  // rute sebuah event (event_key) — supaya tiap grup bisa diuji terpisah.
  if (payload?.test) {
    const chat = payload.chat_id ?? (await resolveChat(payload.event_key ?? 'test', payload.business_unit_id ?? null));
    const hasil = await sendTelegram(
      [
        '🔔 <b>Tes Notifikasi Berjaya Hub</b>',
        '',
        payload.event_label ? `Rute: <b>${esc(payload.event_label)}</b>` : '',
        'Kalau pesan ini muncul, koneksi bot ke grup sudah benar.',
        `<i>${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</i>`
      ]
        .filter(Boolean)
        .join('\n'),
      chat
    );
    return json(hasil, hasil.ok ? 200 : 502);
  }

  const built = await buildMessage(payload);
  if (!built) return json({ ok: true, skipped: true, reason: 'Event tidak perlu dikirim.' });

  const chat = await resolveChat(built.eventKey, built.buId);
  const hasil = await sendTelegram(built.text, chat);
  // Webhook Supabase akan mencatat kegagalan; balas non-2xx supaya terlihat di log.
  return json(hasil, hasil.ok ? 200 : 502);
});
