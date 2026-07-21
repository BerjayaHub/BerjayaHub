import { supabase } from '../../config/supabase-client.js';

// ---- Config dasar per outlet ----

export async function getNbmConfig(outletId) {
  const { data, error } = await supabase
    .from('outlet_nbm_config')
    .select('*')
    .eq('outlet_id', outletId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertNbmConfig(outletId, { base_amount, holiday_amount, storing_bonus_amount }) {
  const { error } = await supabase
    .from('outlet_nbm_config')
    .upsert({ outlet_id: outletId, base_amount, holiday_amount, storing_bonus_amount, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ---- Tingkatan bonus lembur ----

export async function listOvertimeTiers(outletId) {
  const { data, error } = await supabase
    .from('outlet_nbm_overtime_tiers')
    .select('*')
    .eq('outlet_id', outletId)
    .order('threshold_minutes');
  if (error) throw error;
  return data ?? [];
}

export async function addOvertimeTier(outletId, { threshold_minutes, bonus_amount, label }) {
  const { error } = await supabase
    .from('outlet_nbm_overtime_tiers')
    .insert({ outlet_id: outletId, threshold_minutes, bonus_amount, label: label || null });
  if (error) throw error;
}

export async function removeOvertimeTier(tierId) {
  const { error } = await supabase.from('outlet_nbm_overtime_tiers').delete().eq('id', tierId);
  if (error) throw error;
}

// ---- Hari libur ----

export async function listHolidays({ businessUnitId, outletId }) {
  let query = supabase.from('holidays').select('*').order('holiday_date', { ascending: false });
  if (outletId) query = query.or(`outlet_id.eq.${outletId},and(outlet_id.is.null,business_unit_id.eq.${businessUnitId})`);
  else if (businessUnitId) query = query.eq('business_unit_id', businessUnitId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function addHoliday({ holiday_date, name, business_unit_id, outlet_id }) {
  const { error } = await supabase
    .from('holidays')
    .insert({ holiday_date, name, business_unit_id: business_unit_id || null, outlet_id: outlet_id || null });
  if (error) throw error;
}

export async function removeHoliday(id) {
  const { error } = await supabase.from('holidays').delete().eq('id', id);
  if (error) throw error;
}

// ---- Kalkulasi (murni JS, gampang diaudit/diubah) ----

/** Menit sejak tengah malam TANGGAL clock_in, dari sebuah timestamp ISO. */
function minutesSinceClockInMidnight(clockInDate, targetIso) {
  const target = new Date(targetIso);
  const clockInMidnight = new Date(clockInDate);
  clockInMidnight.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - clockInMidnight.getTime()) / 60000);
}

function isSameCalendarDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Hitung total NBM untuk 1 record presensi.
 * record: { clock_in_at, clock_out_at, is_storing }
 * config: { base_amount, holiday_amount, storing_bonus_amount } | null
 * tiers: [{ threshold_minutes, bonus_amount }]
 * holidays: array tanggal libur yang relevan (format 'YYYY-MM-DD')
 *
 * Return null kalau belum bisa dihitung (belum clock out, atau config belum diset).
 */
export function calculateNbm(record, config, tiers, holidayDates) {
  if (!config || !record.clock_out_at) return null;

  const clockIn = new Date(record.clock_in_at);
  const dateKey = toDateKey(clockIn);
  const isHoliday = holidayDates.includes(dateKey);

  const base = isHoliday && config.holiday_amount != null ? Number(config.holiday_amount) : Number(config.base_amount);

  const outMinutes = minutesSinceClockInMidnight(clockIn, record.clock_out_at);
  const overtimeBonus = (tiers ?? [])
    .filter((t) => outMinutes >= t.threshold_minutes)
    .reduce((sum, t) => sum + Number(t.bonus_amount), 0);

  const storingBonus = record.is_storing ? Number(config.storing_bonus_amount ?? 0) : 0;

  return {
    isHoliday,
    base,
    overtimeBonus,
    storingBonus,
    total: base + overtimeBonus + storingBonus
  };
}

export function toDateKey(dateObj) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;
}
