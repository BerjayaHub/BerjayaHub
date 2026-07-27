import { supabase } from '../../config/supabase-client.js';

/**
 * Katalog event yang bisa dirutekan ke grup Telegram.
 * Menambah event baru = tambah satu entri di sini + tangani `event_key`-nya
 * di Edge Function. UI kelola rute otomatis ikut.
 */
export const TELEGRAM_EVENTS = [
  {
    key: 'leave_submitted',
    icon: '📝',
    label: 'Pengajuan cuti baru',
    detail: 'Database Webhook · INSERT pada leave_requests'
  },
  {
    key: 'leave_reviewed',
    icon: '✅',
    label: 'Cuti disetujui / ditolak',
    detail: 'Database Webhook · UPDATE leave_requests saat status berubah'
  },
  {
    key: 'stock_order',
    icon: '📦',
    label: 'Order stok baru ke Central Kitchen',
    detail: 'Database Webhook · INSERT pada stock_orders'
  },
  {
    key: 'fleet_docs',
    icon: '🚗',
    label: 'Dokumen kendaraan jatuh tempo',
    detail: 'Cron harian · Edge Function send-fleet-reminders'
  },
  {
    key: 'reservation',
    icon: '📅',
    label: 'Reservasi baru (staff & website)',
    detail: 'Trigger DB · INSERT pada reservations → notify-reservation'
  }
];

export function eventInfo(key) {
  return TELEGRAM_EVENTS.find((e) => e.key === key) ?? { key, icon: '•', label: key, detail: '' };
}

/**
 * Kunci `integration_settings` yang harus terisi supaya PEMICU jalan.
 * Rute grup sudah bisa dicek lewat tombol Tes, tapi tes itu memanggil Edge
 * Function langsung dari browser — ia TIDAK membuktikan bahwa database sudah
 * tahu harus memanggil siapa saat ada data baru. Ini yang paling sering
 * terlewat: tesnya hijau, tapi event sungguhan diam.
 */
export const INTEGRATION_KEYS = [
  {
    key: 'notify_telegram_url',
    label: 'URL notifikasi cuti & order stok',
    fn: 'notify-telegram',
    hint: 'https://<PROJECT-REF>.supabase.co/functions/v1/notify-telegram'
  },
  {
    key: 'notify_reservation_url',
    label: 'URL notifikasi reservasi',
    fn: 'notify-reservation',
    hint: 'https://<PROJECT-REF>.supabase.co/functions/v1/notify-reservation'
  },
  { key: 'notify_secret', label: 'NOTIFY_SECRET (harus sama dengan secret Edge Function)', hint: '<string acak>' }
];

/**
 * Periksa BENTUK URL, bukan sekadar "terisi".
 * Kasus nyata: `<PROJECT-REF>` terhapus saat menempel sehingga tersimpan
 * `https://.supabase.co/...` — terisi, tapi tidak menunjuk ke mana pun. pg_net
 * gagal diam-diam karena trigger sengaja menelan error, jadi salahnya sulit
 * ditemukan kalau UI cuma bilang "terisi".
 */
function urlProblem(value, fn) {
  let u;
  try {
    u = new URL(value);
  } catch {
    return 'Bukan URL yang valid.';
  }
  if (u.protocol !== 'https:') return 'Harus https.';
  // "https://.supabase.co" lolos parsing URL, jadi host-nya dicek manual.
  if (!u.hostname || u.hostname.startsWith('.') || u.hostname.split('.').filter(Boolean).length < 3) {
    return 'Nama project hilang dari URL — bagian sebelum ".supabase.co" kosong.';
  }
  if (fn && !u.pathname.endsWith(`/${fn}`)) return `URL harus berakhir dengan /${fn}.`;
  return null;
}

export async function getIntegrationStatus() {
  const { data, error } = await supabase.from('integration_settings').select('key, value, updated_at');
  if (error) throw error;
  const map = new Map((data ?? []).map((r) => [r.key, r]));
  return INTEGRATION_KEYS.map((k) => {
    const row = map.get(k.key);
    const isSet = !!row?.value;
    const problem = isSet && k.fn ? urlProblem(row.value, k.fn) : null;
    return {
      ...k,
      isSet,
      problem,
      ok: isSet && !problem,
      // Secret tidak pernah ditampilkan utuh — cukup buktinya sudah terisi.
      preview: isSet ? (k.key === 'notify_secret' ? '••••••' + String(row.value).slice(-4) : row.value) : null,
      updatedAt: row?.updated_at ?? null
    };
  });
}

export async function listTelegramRoutes() {
  const { data, error } = await supabase
    .from('telegram_routes')
    .select('id, event_key, business_unit_id, chat_id, label, is_active, business_units(name)')
    .order('event_key');
  if (error) throw error;
  return data ?? [];
}

/**
 * Simpan rute. Tidak memakai upsert/ON CONFLICT karena index uniknya PARTIAL
 * (business_unit_id null vs terisi) — Postgres tidak mau memakainya untuk
 * ON CONFLICT lewat PostgREST. Jadi: baca dulu, lalu UPDATE atau INSERT.
 */
export async function saveTelegramRoute({ id, eventKey, businessUnitId, chatId, label, isActive = true }) {
  const payload = {
    event_key: eventKey,
    business_unit_id: businessUnitId || null,
    chat_id: String(chatId).trim(),
    label: label?.trim() || null,
    is_active: isActive,
    updated_at: new Date().toISOString()
  };

  let targetId = id ?? null;
  if (!targetId) {
    let q = supabase.from('telegram_routes').select('id').eq('event_key', eventKey);
    q = businessUnitId ? q.eq('business_unit_id', businessUnitId) : q.is('business_unit_id', null);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    targetId = data?.id ?? null;
  }

  if (targetId) {
    const { error } = await supabase.from('telegram_routes').update(payload).eq('id', targetId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('telegram_routes').insert(payload);
    if (error) throw error;
  }
}

export async function deleteTelegramRoute(id) {
  const { error } = await supabase.from('telegram_routes').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Tanya Telegram: grup mana saja yang bot ini ada di dalamnya?
 * Sekaligus jadi bukti keanggotaan — grup yang tidak muncul berarti botnya
 * memang belum ditambahkan ke sana.
 */
export async function detectTelegramChats() {
  const { data, error } = await supabase.functions.invoke('notify-telegram', { body: { detect_chats: true } });
  if (error) {
    let detail = error.message ?? String(error);
    try {
      const body = await error.context?.json?.();
      if (body?.error) detail = body.error;
    } catch {
      /* pakai pesan aslinya */
    }
    throw new Error(detail);
  }
  return data;
}

/** Kirim pesan tes ke grup tertentu (chat_id langsung, atau lewat rute event). */
export async function sendTelegramTest({ chatId, eventKey, eventLabel, businessUnitId } = {}) {
  const { data, error } = await supabase.functions.invoke('notify-telegram', {
    body: {
      test: true,
      chat_id: chatId || undefined,
      event_key: eventKey || undefined,
      event_label: eventLabel || undefined,
      business_unit_id: businessUnitId || undefined
    }
  });
  if (error) {
    // supabase-js tidak membaca badan respons non-2xx — dibaca manual supaya
    // pesan Telegram yang sebenarnya ("chat not found", dll) terlihat.
    let detail = error.message ?? String(error);
    try {
      const body = await error.context?.json?.();
      if (body?.error) detail = body.error;
    } catch {
      /* pakai pesan aslinya */
    }
    throw new Error(detail);
  }
  if (!data?.ok) throw new Error(data?.error ?? 'Gagal mengirim.');
  return data;
}
