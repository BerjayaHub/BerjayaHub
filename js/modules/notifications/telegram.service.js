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
