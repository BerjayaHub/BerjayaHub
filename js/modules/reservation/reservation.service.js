import { supabase } from '../../config/supabase-client.js';

export const RES_STATUS = {
  pending: 'Menunggu',
  confirmed: 'Dikonfirmasi',
  done: 'Selesai',
  no_show: 'Tidak datang',
  cancelled: 'Dibatalkan',
  rejected: 'Ditolak'
};
export const RES_BADGE = {
  pending: 'badge-pending',
  confirmed: 'badge-approved',
  done: 'badge-approved',
  no_show: 'badge-rejected',
  cancelled: 'badge-cancelled',
  rejected: 'badge-rejected'
};
export const RES_STATUS_OPTIONS = Object.entries(RES_STATUS).map(([value, label]) => ({ value, label }));

export const SOURCE_LABEL = { staff: 'Staff App', web: 'Website' };

// ---- Pengaturan per outlet ----

export async function getReservationSettings(outletId) {
  const { data, error } = await supabase.from('reservation_settings').select('*').eq('outlet_id', outletId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertReservationSettings(outletId, businessUnitId, patch) {
  const { error } = await supabase
    .from('reservation_settings')
    .upsert({ outlet_id: outletId, business_unit_id: businessUnitId, ...patch, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ---- Master area ----

export async function listReservationAreas(outletId, onlyActive = true) {
  let q = supabase.from('reservation_areas').select('id, name, is_active').eq('outlet_id', outletId).order('name');
  if (onlyActive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createReservationArea({ outletId, businessUnitId, name }) {
  const { error } = await supabase.from('reservation_areas').insert({ outlet_id: outletId, business_unit_id: businessUnitId, name: name.trim() });
  if (error) throw error;
}

export async function updateReservationArea(id, { name, is_active }) {
  const { error } = await supabase.from('reservation_areas').update({ name: name?.trim(), is_active }).eq('id', id);
  if (error) throw error;
}

export async function deleteReservationArea(id) {
  const { error } = await supabase.from('reservation_areas').delete().eq('id', id);
  if (error) throw error;
}

// ---- Ketersediaan slot ----

/**
 * Slot beserta sisa kuotanya untuk satu tanggal.
 * Aturannya (jam buka, panjang slot, kuota, lead time) dihitung di database
 * lewat RPC, supaya Staff App dan halaman publik memakai SATU sumber aturan.
 */
export async function getAvailability(outletId, date) {
  const { data, error } = await supabase.rpc('reservation_availability', { p_outlet: outletId, p_date: date });
  if (error) throw error;
  return data ?? [];
}

// ---- Reservasi ----

export async function createReservation({ outletId, name, phone, date, time, pax, areaId, email, notes, referral }) {
  const { data, error } = await supabase.rpc('create_reservation', {
    p_outlet: outletId,
    p_name: name,
    p_phone: phone,
    p_date: date,
    p_time: time,
    p_pax: pax,
    p_area: areaId || null,
    p_email: email || null,
    p_notes: notes || null,
    p_referral: referral || null
  });
  if (error) throw error;
  return data;
}

/** Riwayat reservasi — dipakai Staff App maupun Admin Portal. */
export async function listReservations({ businessUnitId, outletId, status, dateFrom, dateTo, limit = 300 }) {
  let q = supabase
    .from('reservations')
    .select(
      'id, code, outlet_id, customer_name, phone, email, reserve_date, reserve_time, pax, notes, referral_source, source, status, review_note, reviewed_at, created_at, reservation_areas(name), outlets(name), creator:user_profiles!created_by(full_name), reviewer:user_profiles!reviewed_by(full_name)'
    )
    .eq('business_unit_id', businessUnitId)
    .order('reserve_date', { ascending: false })
    .order('reserve_time', { ascending: false })
    .limit(limit);
  if (outletId) q = q.eq('outlet_id', outletId);
  if (status) q = q.eq('status', status);
  if (dateFrom) q = q.gte('reserve_date', dateFrom);
  if (dateTo) q = q.lte('reserve_date', dateTo);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function setReservationStatus(id, status, reviewNote) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('reservations')
    .update({
      status,
      review_note: reviewNote?.trim() || null,
      reviewed_by: user?.id ?? null,
      reviewed_at: new Date().toISOString()
    })
    .eq('id', id);
  if (error) throw error;
}

// ---- Teks WhatsApp ----

const fmtTanggal = (d) =>
  new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

/** Pesan konfirmasi untuk customer — dikirim manual lewat wa.me (tanpa API). */
export function buildConfirmMessage(r) {
  return [
    `Halo ${r.customer_name}, reservasi Anda *DIKONFIRMASI* ✅`,
    '',
    `No. Reservasi : ${r.code ?? '-'}`,
    `Outlet        : ${r.outlets?.name ?? '-'}`,
    `Tanggal       : ${fmtTanggal(r.reserve_date)}`,
    `Jam           : ${String(r.reserve_time).slice(0, 5)}`,
    `Jumlah tamu   : ${r.pax} orang`,
    r.reservation_areas?.name ? `Area          : ${r.reservation_areas.name}` : '',
    r.notes ? `Catatan       : ${r.notes}` : '',
    '',
    'Mohon datang tepat waktu. Kursi kami tahan 15 menit dari jam reservasi.',
    'Terima kasih 🙏'
  ]
    .filter(Boolean)
    .join('\n');
}

/** Pesan penolakan / permintaan reschedule. */
export function buildRejectMessage(r, alasan) {
  return [
    `Halo ${r.customer_name}, mohon maaf reservasi Anda pada ${fmtTanggal(r.reserve_date)} pukul ${String(r.reserve_time).slice(0, 5)} belum dapat kami terima.`,
    alasan ? `\nAlasan: ${alasan}` : '',
    '\nBoleh kami bantu carikan jam atau tanggal lain? Silakan balas pesan ini. Terima kasih 🙏'
  ]
    .filter(Boolean)
    .join('\n');
}

/** 08xx / +62xx / 62xx -> 62xxxxxxxxx untuk tautan wa.me. */
export function waNumber(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  return digits;
}
