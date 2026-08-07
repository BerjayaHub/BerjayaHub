import { supabase } from '../../config/supabase-client.js';

export const LATE_LABEL = {
  ontime: 'Tepat waktu',
  tolerance: 'Toleransi',
  late: 'Terlambat',
  no_schedule: 'Tanpa jadwal',
  off_day: 'Hari libur'
};
export const LATE_BADGE = {
  ontime: 'badge-approved',
  tolerance: 'badge-pending',
  late: 'badge-rejected',
  no_schedule: 'badge-cancelled',
  off_day: 'badge-cancelled'
};

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' beberapa hari dari tanggal acuan. */
export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Senin s/d Minggu untuk tanggal tertentu (default: minggu berjalan, WIB). */
export function weekRange(dateStr) {
  const base = dateStr ?? todayWIB();
  const d = new Date(base + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7; // 0 = Senin
  const from = addDays(base, -dow);
  return { from, to: addDays(from, 6), days: Array.from({ length: 7 }, (_, i) => addDays(from, i)) };
}

export function todayWIB() {
  const w = new Date(Date.now() + 7 * 3600000);
  return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`;
}

export function shiftCrossesMidnight(s) {
  return s.end_time < s.start_time;
}

// ---- Libur otomatis (kebijakan BU, migration 0038) ----

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/**
 * Apakah sebuah tanggal otomatis libur menurut kebijakan BU?
 *
 * Hanya berlaku untuk BU ber-policy `follow_calendar`. BU `operational`
 * (cafe/bengkel) TIDAK pernah libur otomatis — Minggu & hari besar tetap hari
 * kerja, dan kompensasinya lewat NBM/cuti pengganti. Ini sengaja: menganggap
 * Minggu libur secara global pernah jadi sumber bug lintas BU.
 *
 * @param dateStr   'YYYY-MM-DD'
 * @param policy    { holiday_policy, weekly_off_days }
 * @param holidayMap Map<'YYYY-MM-DD', namaHariLibur>
 * @returns { off: boolean, reason: string|null }
 */
export function resolveAutoOff(dateStr, policy, holidayMap) {
  const namaLibur = holidayMap?.get?.(dateStr) ?? null;
  if (policy?.holiday_policy !== 'follow_calendar') return { off: false, reason: null, holidayName: namaLibur };
  if (namaLibur) return { off: true, reason: namaLibur, holidayName: namaLibur };
  const dow = new Date(dateStr + 'T00:00:00').getDay();
  if ((policy.weekly_off_days ?? []).map(Number).includes(dow)) {
    return { off: true, reason: DAY_NAMES[dow], holidayName: null };
  }
  return { off: false, reason: null, holidayName: null };
}

/** Map tanggal -> nama hari libur, dari hasil listHolidays(). */
export function holidayMapOf(holidays) {
  return new Map((holidays ?? []).map((h) => [h.holiday_date, h.name]));
}

/** "08:00:00" -> menit sejak tengah malam. */
export function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

/**
 * Hitung status keterlambatan clock-in terhadap jadwal.
 * Mendukung shift lintas tengah malam: kalau shift mulai malam dan clock-in
 * terjadi dini hari (atau sebaliknya), selisihnya dinormalkan ke ±12 jam.
 */
export function evaluateLateness(clockInDate, shift, toleranceMinutes) {
  if (!shift) return { status: 'no_schedule', minutes: null };
  const start = timeToMinutes(shift.start_time);
  const actual = clockInDate.getHours() * 60 + clockInDate.getMinutes();
  let diff = actual - start;
  if (diff > 720) diff -= 1440; // clock-in dini hari untuk shift malam
  if (diff < -720) diff += 1440;
  if (diff <= 0) return { status: 'ontime', minutes: 0 };
  if (diff <= (toleranceMinutes ?? 0)) return { status: 'tolerance', minutes: diff };
  return { status: 'late', minutes: diff };
}

// ---- Pengaturan per BU ----

export async function getShiftSettings(businessUnitId) {
  const { data, error } = await supabase
    .from('shift_settings')
    .select('shift_count, late_tolerance_minutes')
    .eq('business_unit_id', businessUnitId)
    .maybeSingle();
  if (error) throw error;
  return data ?? { shift_count: 2, late_tolerance_minutes: 10 };
}

export async function upsertShiftSettings(businessUnitId, { shift_count, late_tolerance_minutes }) {
  const { error } = await supabase
    .from('shift_settings')
    .upsert(
      { business_unit_id: businessUnitId, shift_count, late_tolerance_minutes, updated_at: new Date().toISOString() },
      { onConflict: 'business_unit_id' }
    );
  if (error) throw error;
}

// ---- Jam shift per outlet ----

export async function listOutletShifts(outletId) {
  const { data, error } = await supabase
    .from('outlet_shifts')
    .select('id, slot, name, start_time, end_time, is_active')
    .eq('outlet_id', outletId)
    .order('slot');
  if (error) throw error;
  return data ?? [];
}

export async function upsertOutletShift({ businessUnitId, outletId, slot, name, start_time, end_time, is_active }) {
  const { error } = await supabase.from('outlet_shifts').upsert(
    {
      business_unit_id: businessUnitId,
      outlet_id: outletId,
      slot,
      name,
      start_time,
      end_time,
      is_active: is_active ?? true
    },
    { onConflict: 'outlet_id,slot' }
  );
  if (error) throw error;
}

export async function deleteOutletShift(id) {
  const { error } = await supabase.from('outlet_shifts').delete().eq('id', id);
  if (error) throw error;
}

// ---- Aktivasi modul shift per outlet ----

export async function setOutletShiftEnabled(outletId, enabled) {
  const { error } = await supabase.rpc('set_outlet_shift_enabled', { p_outlet: outletId, p_enabled: enabled });
  if (error) throw error;
}

// ---- Jadwal ----

export async function listSchedules({ outletId, from, to }) {
  const { data, error } = await supabase
    .from('shift_schedules')
    .select('id, user_id, work_date, shift_id, is_off, outlet_shifts(name, start_time, end_time)')
    .eq('outlet_id', outletId)
    .gte('work_date', from)
    .lte('work_date', to);
  if (error) throw error;
  return data ?? [];
}

export async function setSchedule({ businessUnitId, outletId, userId, workDate, shiftId, isOff }) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('shift_schedules').upsert(
    {
      business_unit_id: businessUnitId,
      outlet_id: outletId,
      user_id: userId,
      work_date: workDate,
      shift_id: isOff ? null : shiftId,
      is_off: !!isOff,
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'outlet_id,user_id,work_date' }
  );
  if (error) throw error;
}

/**
 * Kosongkan satu sel jadwal.
 *
 * `.select()` wajib: RLS `shift_schedules_modify` membatasi ke admin outlet,
 * dan PostgREST TIDAK menganggap penolakan RLS sebagai error — ia membalas
 * sukses dengan 0 baris. Tanpa pemeriksaan ini, admin yang tidak berwenang
 * melihat selnya kembali ke "–", mengira jadwalnya batal, padahal di database
 * masih utuh. Staff-nya lalu tetap dijadwalkan masuk.
 *
 * Menghapus sel yang memang sudah kosong bukan kesalahan — 0 baris hanya
 * dianggap penolakan kalau barisnya memang ada tapi tidak boleh disentuh, jadi
 * keberadaannya dicek dulu.
 */
export async function clearSchedule(outletId, userId, workDate) {
  const { data, error } = await supabase
    .from('shift_schedules')
    .delete()
    .eq('outlet_id', outletId)
    .eq('user_id', userId)
    .eq('work_date', workDate)
    .select('id');
  if (error) throw error;

  if (!data?.length) {
    const { data: masihAda } = await supabase
      .from('shift_schedules')
      .select('id')
      .eq('outlet_id', outletId)
      .eq('user_id', userId)
      .eq('work_date', workDate)
      .maybeSingle();
    if (masihAda) throw new Error('Tidak bisa mengubah jadwal di outlet ini — kamu bukan adminnya.');
  }
}

/** Jadwal staff yang login untuk rentang tanggal (dipakai Staff App). */
export async function listMySchedule(from, to) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('shift_schedules')
    .select('work_date, is_off, outlet_id, outlets!outlet_id(name), outlet_shifts(name, start_time, end_time)')
    .eq('user_id', user.id)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date');
  if (error) throw error;
  return data ?? [];
}

/** Jadwal staff yang login untuk SATU tanggal (dipakai saat clock in). */
/**
 * Jadwal shift saya pada satu tanggal.
 *
 * `outletId` (opsional) = outlet BASIS. Diberikan supaya baris yang dipakai
 * benar saat seseorang dijadwalkan di lebih dari satu outlet pada hari yang
 * sama. Versi sebelumnya memakai `.maybeSingle()` tanpa penyaring outlet:
 * begitu ada dua baris, PostgREST membalas error, error-nya ditelan `catch`,
 * dan hasilnya `null` — yang lalu dinilai sebagai "Tanpa jadwal" dan status
 * keterlambatannya hilang. Tidak ada error di layar; hanya penilaian yang salah.
 */
export async function getMyScheduleFor(dateStr, outletId = null) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;
  // SEMUA jadwal orang ini pada tanggal itu diambil, lalu outlet basis
  // DIUTAMAKAN — bukan disaring.
  //
  // Menyaringnya (`.eq('outlet_id', outletId)`) tampak lebih rapi, tapi orang
  // yang dijadwalkan membantu di outlet lain jadi dianggap TIDAK punya jadwal,
  // dan presensinya tercatat "Tanpa jadwal" selamanya. Menolak jadwal yang
  // nyata-nyata ada hanya karena outletnya berbeda adalah kerugian yang jauh
  // lebih besar daripada memakai baris yang kurang tepat.
  const { data, error } = await supabase
    .from('shift_schedules')
    .select('is_off, shift_id, outlet_id, outlet_shifts(id, name, start_time, end_time)')
    .eq('user_id', user.id)
    .eq('work_date', dateStr)
    // `updated_at` — shift_schedules TIDAK punya kolom `created_at`. Memakai
    // kolom yang tidak ada membuat PostgREST membalas error, error-nya ditelan
    // `catch`, hasilnya null, dan orangnya dicap "Tanpa jadwal". Persis bug
    // yang sedang diperbaiki, dibuat ulang oleh perbaikannya sendiri.
    .order('updated_at', { ascending: true });
  if (error) return null;
  const baris = data ?? [];
  if (!baris.length) return null;
  return baris.find((b) => b.outlet_id === outletId) ?? baris[0];
}

/**
 * Semua staff yang terdaftar di satu outlet — untuk tabel Jadwal Shift.
 *
 * Lewat RPC security-definer, BUKAN select ke membership_scopes: RLS tabel itu
 * hanya membuka baris milik sendiri untuk staff biasa, sehingga select langsung
 * "berhasil" tapi mengembalikan satu orang saja. RPC-nya sengaja hanya
 * mengembalikan nama + status aktif, bukan seluruh profil.
 *
 * `tingkat`: 'outlet' = ditugaskan di outlet ini; 'bu' = scope level BU.
 *
 * Staff NONAKTIF disembunyikan secara default. `includeInactive: true` hanya
 * dipakai Admin Portal — supaya jadwal milik orang yang sudah keluar masih bisa
 * dilihat dan dibatalkan. Kalau barisnya disembunyikan padahal jadwalnya ada,
 * admin tidak akan pernah tahu jadwal itu masih menggantung di sana.
 */
export async function listOutletStaff(outletId, { includeInactive = false } = {}) {
  const { data, error } = await supabase.rpc('list_outlet_staff', {
    p_outlet_id: outletId,
    p_include_inactive: includeInactive
  });
  if (error) throw error;
  return (data ?? []).sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
}

/** Apakah outlet ini mengaktifkan modul shift? */
export function isShiftEnabled(outlet) {
  return !!outlet?.shift_enabled;
}

/**
 * Susun baris roster: dikelompokkan per divisi, dengan penanda kelompok.
 *
 * Staff TANPA divisi TIDAK ikut — sesuai keputusan, roster shift hanya berisi
 * orang yang sudah ditentukan divisinya. Tapi jumlahnya dikembalikan supaya UI
 * bisa memberi tahu; menghilangkan orang tanpa sepatah kata pun adalah cara
 * tercepat membuat admin curiga aplikasinya rusak.
 *
 * @returns {{ baris: Array, tanpaDivisi: Array }}
 *   `baris` berisi { jenis: 'divisi'|'staff', ... } supaya UI tinggal merender
 *   berurutan tanpa perlu tahu aturan pengelompokannya.
 */
export function kelompokkanPerDivisi(staff) {
  const tanpaDivisi = staff.filter((s) => !s.division_id);
  const berdivisi = staff.filter((s) => s.division_id);

  berdivisi.sort(
    (a, b) =>
      (a.division_sort ?? 0) - (b.division_sort ?? 0) ||
      String(a.division_name ?? '').localeCompare(String(b.division_name ?? '')) ||
      String(a.full_name ?? '').localeCompare(String(b.full_name ?? ''))
  );

  const baris = [];
  let divisiTerakhir = null;
  for (const s of berdivisi) {
    if (s.division_id !== divisiTerakhir) {
      divisiTerakhir = s.division_id;
      baris.push({ jenis: 'divisi', nama: s.division_name ?? 'Divisi' });
    }
    baris.push({ jenis: 'staff', ...s });
  }
  return { baris, tanpaDivisi };
}
