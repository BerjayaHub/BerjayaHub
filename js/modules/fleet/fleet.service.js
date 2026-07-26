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
// Merk, Tipe, dan Area Rental TIDAK di-hardcode — semuanya master data per BU
// yang diisi sendiri oleh user (lihat migration 0037).

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

// ---- Master: Merk, Tipe (per merk), Area Rental ----
// Semua diisi user; bisa ditambah langsung dari form kendaraan (allowCreate).

export async function listVehicleBrands(businessUnitId) {
  const { data, error } = await supabase
    .from('vehicle_brands')
    .select('id, name')
    .eq('business_unit_id', businessUnitId)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listVehicleModels(businessUnitId) {
  const { data, error } = await supabase
    .from('vehicle_models')
    .select('id, name, brand_id')
    .eq('business_unit_id', businessUnitId)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listRentalAreas(businessUnitId) {
  const { data, error } = await supabase
    .from('rental_areas')
    .select('id, name')
    .eq('business_unit_id', businessUnitId)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

/** Ambil semua master sekaligus (dipakai form & filter). */
export async function loadFleetMasters(businessUnitId) {
  const [brands, models, areas] = await Promise.all([
    listVehicleBrands(businessUnitId).catch(() => []),
    listVehicleModels(businessUnitId).catch(() => []),
    listRentalAreas(businessUnitId).catch(() => [])
  ]);
  return { brands, models, areas };
}

const norm = (s) => String(s ?? '').trim();
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();

/** Get-or-create merk. Mengembalikan baris merk (id, name) atau null kalau nama kosong. */
export async function ensureBrand(businessUnitId, name) {
  const clean = norm(name);
  if (!clean) return null;
  const existing = (await listVehicleBrands(businessUnitId)).find((b) => same(b.name, clean));
  if (existing) return existing;
  const { data, error } = await supabase
    .from('vehicle_brands')
    .insert({ business_unit_id: businessUnitId, name: clean })
    .select('id, name')
    .single();
  if (error) throw error;
  return data;
}

/** Get-or-create tipe di bawah satu merk. */
export async function ensureModel(businessUnitId, brandId, name) {
  const clean = norm(name);
  if (!clean || !brandId) return null;
  const existing = (await listVehicleModels(businessUnitId)).find((m) => m.brand_id === brandId && same(m.name, clean));
  if (existing) return existing;
  const { data, error } = await supabase
    .from('vehicle_models')
    .insert({ business_unit_id: businessUnitId, brand_id: brandId, name: clean })
    .select('id, name, brand_id')
    .single();
  if (error) throw error;
  return data;
}

/** Get-or-create area rental. */
export async function ensureArea(businessUnitId, name) {
  const clean = norm(name);
  if (!clean) return null;
  const existing = (await listRentalAreas(businessUnitId)).find((a) => same(a.name, clean));
  if (existing) return existing;
  const { data, error } = await supabase
    .from('rental_areas')
    .insert({ business_unit_id: businessUnitId, name: clean })
    .select('id, name')
    .single();
  if (error) throw error;
  return data;
}

const MASTER_TABLE = { brand: 'vehicle_brands', model: 'vehicle_models', area: 'rental_areas' };

/** Ubah nama master. Untuk merk/tipe/area, kendaraan yang memakainya ikut diperbarui. */
export async function renameMaster(kind, id, newName, { businessUnitId, oldName, brandId } = {}) {
  const clean = norm(newName);
  if (!clean) throw new Error('Nama tidak boleh kosong.');
  const { error } = await supabase.from(MASTER_TABLE[kind]).update({ name: clean }).eq('id', id);
  if (error) throw error;
  if (!businessUnitId || !oldName) return;
  const col = kind === 'brand' ? 'brand' : kind === 'model' ? 'model' : 'rental_area';
  let q = supabase.from('vehicles').update({ [col]: clean }).eq('business_unit_id', businessUnitId).eq(col, oldName);
  // Tipe hanya diganti pada kendaraan bermerk sama, karena nama tipe bisa
  // dipakai merk lain.
  if (kind === 'model' && brandId) {
    const brand = (await listVehicleBrands(businessUnitId)).find((b) => b.id === brandId);
    if (brand) q = q.eq('brand', brand.name);
  }
  await q;
}

export async function deleteMaster(kind, id) {
  const { error } = await supabase.from(MASTER_TABLE[kind]).delete().eq('id', id);
  if (error) throw error;
}

// ---- Kendaraan ----

export async function listVehicles(businessUnitId) {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
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

  const patch = {
    status: 'rented',
    renter_name: renterName,
    rental_start: startDate,
    rental_end: endDate || null,
    rental_notes: notes || null
  };
  // rental_area = Area Rental kendaraan (menetap). Hanya ditimpa kalau admin
  // memilih area lain saat merentalkan.
  if (rentalArea) patch.rental_area = rentalArea;
  const { error } = await supabase.from('vehicles').update(patch).eq('id', vehicleId);
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
  // rental_area TIDAK dikosongkan: itu Area Rental kendaraan, bukan data sesi.
  const { error } = await supabase
    .from('vehicles')
    .update({ status: 'idle', renter_name: null, rental_start: null, rental_end: null, rental_notes: null })
    .eq('id', vehicleId);
  if (error) throw error;
}

export async function listRentals(businessUnitId, vehicleId) {
  let q = supabase
    .from('vehicle_rentals')
    .select('id, vehicle_id, renter_name, rental_area, start_date, end_date, notes, vehicles(plate_number)')
    .eq('business_unit_id', businessUnitId)
    .order('start_date', { ascending: false })
    .limit(300);
  if (vehicleId) q = q.eq('vehicle_id', vehicleId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
