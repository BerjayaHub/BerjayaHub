import { supabase } from '../../config/supabase-client.js';
import { todayWIB } from '../../core/dates.js';

export const VEHICLE_STATUS = {
  idle: 'Tersedia',
  rented: 'Direntalkan',
  maintenance: 'Perawatan',
  inactive: 'Nonaktif'
};
export const STATUS_BADGE = {
  idle: 'badge-approved',
  rented: 'badge-pending',
  maintenance: 'badge-cancelled',
  inactive: 'badge-cancelled'
};
export const STATUS_OPTIONS = Object.entries(VEHICLE_STATUS).map(([value, label]) => ({ value, label }));

export const VEHICLE_TYPES = [
  { value: '', label: '-- pilih --' },
  { value: 'Mobil', label: 'Mobil' },
  { value: 'Motor', label: 'Motor' },
  { value: 'Pickup', label: 'Pickup' },
  { value: 'Truk', label: 'Truk' },
  { value: 'Bus', label: 'Bus' },
  { value: 'Lainnya', label: 'Lainnya' }
];
export const OWNERSHIP_OPTIONS = [
  { value: '', label: '-- pilih --' },
  { value: 'Milik Sendiri', label: 'Milik Sendiri' },
  { value: 'Leasing', label: 'Leasing' },
  { value: 'Sewa', label: 'Sewa' }
];

/** Selisih hari dari hari ini (WIB) ke tanggal target. Negatif = sudah lewat. */
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(todayWIB() + 'T00:00:00');
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}

/** Status dokumen: expired | urgent (mendekati) | ok | none */
export function docStatus(dateStr, leadDays = 30) {
  const d = daysUntil(dateStr);
  if (d === null) return { level: 'none', days: null, label: 'Belum diisi' };
  if (d < 0) return { level: 'expired', days: d, label: `Lewat ${Math.abs(d)} hari` };
  if (d <= leadDays) return { level: 'urgent', days: d, label: d === 0 ? 'Jatuh tempo hari ini' : `${d} hari lagi` };
  return { level: 'ok', days: d, label: `${d} hari lagi` };
}

export const DOC_BADGE = { expired: 'badge-rejected', urgent: 'badge-pending', ok: 'badge-approved', none: 'badge-cancelled' };

// ---- Pengaturan ----

export async function getFleetSettings(businessUnitId) {
  const { data, error } = await supabase
    .from('fleet_settings')
    .select('reminder_lead_days')
    .eq('business_unit_id', businessUnitId)
    .maybeSingle();
  if (error) throw error;
  return data ?? { reminder_lead_days: 30 };
}

export async function upsertFleetSettings(businessUnitId, { reminder_lead_days }) {
  const { error } = await supabase
    .from('fleet_settings')
    .upsert({ business_unit_id: businessUnitId, reminder_lead_days, updated_at: new Date().toISOString() }, { onConflict: 'business_unit_id' });
  if (error) throw error;
}

// ---- Kendaraan ----

export async function listVehicles(businessUnitId) {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*, outlets(name)')
    .eq('business_unit_id', businessUnitId)
    .order('plate_number');
  if (error) throw error;
  return data ?? [];
}

export async function createVehicle(v) {
  const { error } = await supabase.from('vehicles').insert(cleanPayload(v));
  if (error) throw error;
}

export async function updateVehicle(id, v) {
  const { error } = await supabase.from('vehicles').update(cleanPayload(v)).eq('id', id);
  if (error) throw error;
}

export async function deleteVehicle(id) {
  const { error } = await supabase.from('vehicles').delete().eq('id', id);
  if (error) throw error;
}

function cleanPayload(v) {
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (val === '' || val === undefined) out[k] = null;
    else out[k] = val;
  }
  return out;
}

// ---- Rental ----

/** Mulai rental: catat riwayat + set status & info rental di kendaraan. */
export async function startRental({ businessUnitId, vehicleId, renterName, rentalArea, startDate, endDate, notes }) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const { error: insErr } = await supabase.from('vehicle_rentals').insert({
    business_unit_id: businessUnitId,
    vehicle_id: vehicleId,
    renter_name: renterName,
    rental_area: rentalArea || null,
    start_date: startDate,
    end_date: endDate || null,
    notes: notes || null,
    created_by: user?.id ?? null
  });
  if (insErr) throw insErr;

  const { error } = await supabase
    .from('vehicles')
    .update({
      status: 'rented',
      renter_name: renterName,
      rental_area: rentalArea || null,
      rental_start: startDate,
      rental_end: endDate || null,
      rental_notes: notes || null
    })
    .eq('id', vehicleId);
  if (error) throw error;
}

/** Selesaikan rental: tutup riwayat terbuka + kembalikan status kendaraan. */
export async function endRental(vehicleId, endDate) {
  const { data: open } = await supabase
    .from('vehicle_rentals')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .is('end_date', null)
    .order('start_date', { ascending: false })
    .limit(1);
  if (open?.length) {
    await supabase.from('vehicle_rentals').update({ end_date: endDate }).eq('id', open[0].id);
  }
  const { error } = await supabase
    .from('vehicles')
    .update({ status: 'idle', renter_name: null, rental_area: null, rental_start: null, rental_end: null, rental_notes: null })
    .eq('id', vehicleId);
  if (error) throw error;
}

export async function listRentals(businessUnitId, vehicleId) {
  let q = supabase
    .from('vehicle_rentals')
    .select('id, renter_name, rental_area, start_date, end_date, notes, vehicles(plate_number)')
    .eq('business_unit_id', businessUnitId)
    .order('start_date', { ascending: false })
    .limit(300);
  if (vehicleId) q = q.eq('vehicle_id', vehicleId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
