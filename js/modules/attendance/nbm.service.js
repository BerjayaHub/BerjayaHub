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

export async function upsertNbmConfig(outletId, { base_amount, holiday_amount, storing_bonus_amount, ph_bonus_amount, ph_replacement_days }) {
  const { error } = await supabase.from('outlet_nbm_config').upsert({
    outlet_id: outletId,
    base_amount,
    holiday_amount,
    storing_bonus_amount,
    ph_bonus_amount: ph_bonus_amount ?? 0,
    ph_replacement_days: ph_replacement_days ?? 0,
    updated_at: new Date().toISOString()
  });
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

/**
 * Simpan banyak hari libur sekaligus (hasil tarik API, setelah disetujui admin).
 * Selalu di level BU (outlet_id null) supaya berlaku untuk semua outlet, dan
 * memakai upsert agar penarikan ulang menambal, bukan menduplikasi.
 */
export async function addHolidaysBulk(businessUnitId, holidays) {
  if (!holidays?.length) return 0;
  const { error } = await supabase.from('holidays').upsert(
    holidays.map((h) => ({
      holiday_date: h.date,
      name: h.name,
      business_unit_id: businessUnitId,
      outlet_id: null,
      is_joint_leave: !!h.isJoint,
      source: 'api'
    })),
    { onConflict: 'business_unit_id,holiday_date' }
  );
  if (error) throw error;
  return holidays.length;
}

/**
 * Kebijakan hari libur EFEKTIF (migration 0038 + 0039).
 *
 * Libur rutin ditentukan di level OUTLET, karena satu BU bisa punya dua outlet
 * dengan hari libur berbeda. Kolom outlet yang NULL berarti "ikut BU" — itulah
 * jalur yang dipakai BU tanpa outlet seperti Divisi Admin.
 *
 * @returns { holiday_policy, weekly_off_days, from: { policy, days } }
 *          `from` menandai asal nilainya ('outlet' | 'bu') untuk ditampilkan di UI.
 */
export async function getHolidayPolicy(businessUnitId, outletId = null) {
  const [buRes, outletRes] = await Promise.all([
    supabase.from('business_units').select('holiday_policy, weekly_off_days').eq('id', businessUnitId).maybeSingle(),
    outletId
      ? supabase.from('outlets').select('holiday_policy, weekly_off_days').eq('id', outletId).maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);
  if (buRes.error) throw buRes.error;

  const bu = {
    holiday_policy: buRes.data?.holiday_policy ?? 'operational',
    weekly_off_days: buRes.data?.weekly_off_days ?? []
  };
  const o = outletRes?.data ?? null;
  return {
    holiday_policy: o?.holiday_policy ?? bu.holiday_policy,
    weekly_off_days: o?.weekly_off_days ?? bu.weekly_off_days,
    from: {
      policy: o?.holiday_policy ? 'outlet' : 'bu',
      days: o?.weekly_off_days ? 'outlet' : 'bu'
    }
  };
}

/** Kebijakan mentah milik BU sendiri (untuk form pengaturan, tanpa pewarisan). */
export async function getBuHolidayPolicy(businessUnitId) {
  const { data, error } = await supabase
    .from('business_units')
    .select('holiday_policy, weekly_off_days')
    .eq('id', businessUnitId)
    .maybeSingle();
  if (error) throw error;
  return { holiday_policy: data?.holiday_policy ?? 'operational', weekly_off_days: data?.weekly_off_days ?? [] };
}

export async function setHolidayPolicy(businessUnitId, { holiday_policy, weekly_off_days }) {
  const { error } = await supabase
    .from('business_units')
    .update({ holiday_policy, weekly_off_days: weekly_off_days ?? [] })
    .eq('id', businessUnitId);
  if (error) throw error;
}

/** Kebijakan mentah milik outlet (null = belum diatur / ikut BU). */
export async function getOutletHolidayPolicy(outletId) {
  const { data, error } = await supabase
    .from('outlets')
    .select('holiday_policy, weekly_off_days')
    .eq('id', outletId)
    .maybeSingle();
  if (error) throw error;
  return { holiday_policy: data?.holiday_policy ?? null, weekly_off_days: data?.weekly_off_days ?? null };
}

/** Simpan kebijakan outlet. Kirim null/null untuk kembali mengikuti BU. */
export async function setOutletHolidayPolicy(outletId, { holiday_policy, weekly_off_days }) {
  const { error } = await supabase
    .from('outlets')
    .update({ holiday_policy: holiday_policy ?? null, weekly_off_days: weekly_off_days ?? null })
    .eq('id', outletId);
  if (error) throw error;
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

// ---- Penyesuaian manual nominal NBM oleh admin (override) ----

/** Ambil penyesuaian untuk sekumpulan record presensi -> Map recordId -> row. */
export async function listNbmAdjustments(recordIds) {
  if (!recordIds?.length) return new Map();
  const { data, error } = await supabase
    .from('nbm_adjustments')
    .select('attendance_record_id, amount, note, edited_at, user_profiles!edited_by(full_name)')
    .in('attendance_record_id', recordIds);
  if (error) throw error;
  const map = new Map();
  for (const r of data ?? []) map.set(r.attendance_record_id, r);
  return map;
}

export async function upsertNbmAdjustment({ recordId, businessUnitId, amount, note }) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('nbm_adjustments').upsert(
    {
      attendance_record_id: recordId,
      business_unit_id: businessUnitId,
      amount,
      note: note || null,
      edited_by: user?.id ?? null,
      edited_at: new Date().toISOString()
    },
    { onConflict: 'attendance_record_id' }
  );
  if (error) throw error;
}

/** Batalkan penyesuaian -> kembali ke nominal hitungan sistem. */
export async function removeNbmAdjustment(recordId) {
  const { error } = await supabase.from('nbm_adjustments').delete().eq('attendance_record_id', recordId);
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

  // Bonus PH: kompensasi TAMBAHAN untuk yang tetap masuk di hari libur.
  // Beda dengan holiday_amount yang MENGGANTIKAN NBM normal. Default 0, jadi
  // perhitungan lama tidak berubah sampai admin mengisinya.
  const phBonus = isHoliday ? Number(config.ph_bonus_amount ?? 0) : 0;

  return {
    isHoliday,
    base,
    overtimeBonus,
    storingBonus,
    phBonus,
    total: base + overtimeBonus + storingBonus + phBonus
  };
}

export function toDateKey(dateObj) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;
}
