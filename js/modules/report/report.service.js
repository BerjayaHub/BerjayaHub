import { supabase } from '../../config/supabase-client.js';
import { formatRupiah, formatNum } from '../../core/format.js';
import { isoFrom, isoTo } from '../../core/dates.js';
import { listProducts, listRecipesFull, computeCosts } from '../product/product.service.js';
import { getNbmConfig, listOvertimeTiers, listHolidays, listNbmAdjustments, calculateNbm } from '../attendance/nbm.service.js';
import { listBuStaff } from '../leave/leave.service.js';
import { LATE_LABEL } from '../shift/shift.service.js';

// =========================================================
// KATALOG LAPORAN
// Menambah laporan baru = tambah satu entri di REPORTS. Fungsi `build`
// menerima { businessUnitId, outletId, from, to } dan mengembalikan:
//   {
//     columns: [{ header, width?, numeric? }],
//     rows:    [[sel, sel, ...]]        // sudah berupa teks siap tampil & siap PDF
//     summary: [{ label, value }]        // kartu ringkas di atas tabel (opsional)
//     bold:    [indeks baris]            // baris yang ditebalkan (opsional)
//     note:    'catatan metodologi'      // opsional
//   }
// Halaman laporan merender & meng-export apa pun bentuknya secara generik,
// jadi laporan baru tidak perlu menyentuh UI sama sekali.
// =========================================================

export const REPORTS = [
  {
    key: 'profit_loss',
    label: 'Laba Rugi',
    group: 'Keuangan',
    description: 'Omzet dikurangi HPP bahan dan beban kas keluar, per outlet.',
    build: buildProfitLoss
  },
  {
    key: 'payroll_nbm',
    label: 'Rekap Penggajian (NBM)',
    group: 'SDM',
    description: 'Satu baris per staff: hari hadir, lembur, storing, penyesuaian, dan total NBM.',
    build: buildPayrollNbm
  },
  {
    key: 'attendance_discipline',
    label: 'Rekap Presensi & Disiplin',
    group: 'SDM',
    description: 'Satu baris per staff: hari hadir, ketepatan waktu, menit keterlambatan, dan hari cuti.',
    build: buildAttendanceDiscipline
  }
];

export function getReport(key) {
  return REPORTS.find((r) => r.key === key) ?? REPORTS[0];
}

// ---------------------------------------------------------
// Helper bersama
// ---------------------------------------------------------

const rp = (n) => formatRupiah(Math.round(Number(n) || 0));
/** Angka negatif ditulis dalam kurung, gaya laporan keuangan. */
const rpMinus = (n) => (Number(n) ? `(${formatRupiah(Math.round(Math.abs(Number(n))))})` : formatRupiah(0));

const pad2 = (n) => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' dari komponen LOKAL — jangan pakai toISOString (bisa geser 1 hari). */
const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Semua tanggal 'YYYY-MM-DD' antara from..to (inklusif). */
function daysBetween(from, to) {
  const out = [];
  if (!from || !to) return out;
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    out.push(dateKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * Presensi untuk laporan SDM — disaring berdasarkan **BU/outlet BASIS** staff
 * (nbm_*), bukan lokasi absen fisik, sama seperti Rekap NBM. Baris lama yang
 * belum punya basis di-fallback ke lokasi fisik.
 */
async function fetchAttendance({ businessUnitId, outletId, from, to }) {
  let q = supabase
    .from('attendance_records')
    .select('id, user_id, clock_in_at, clock_out_at, is_storing, late_status, late_minutes, business_unit_id, nbm_business_unit_id, outlet_id, nbm_outlet_id')
    .or(`nbm_business_unit_id.eq.${businessUnitId},and(nbm_business_unit_id.is.null,business_unit_id.eq.${businessUnitId})`)
    .gte('clock_in_at', isoFrom(from))
    .lte('clock_in_at', isoTo(to))
    .order('clock_in_at')
    .limit(5000);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];
  if (!outletId) return rows;
  return rows.filter((r) => (r.nbm_outlet_id ?? r.outlet_id) === outletId);
}

// ---------------------------------------------------------
// 1. Laba Rugi
// ---------------------------------------------------------

async function buildProfitLoss({ businessUnitId, outletId, from, to }) {
  let salesQ = supabase
    .from('sales')
    .select('product_id, qty, revenue')
    .eq('business_unit_id', businessUnitId)
    .gte('sale_date', from)
    .lte('sale_date', to)
    .limit(10000);
  if (outletId) salesQ = salesQ.eq('outlet_id', outletId);

  let cashQ = supabase
    .from('cash_entries')
    .select('amount, entry_type, cash_categories(name)')
    .eq('business_unit_id', businessUnitId)
    .eq('entry_type', 'out')
    .gte('entry_date', from)
    .lte('entry_date', to)
    .limit(5000);
  if (outletId) cashQ = cashQ.eq('outlet_id', outletId);

  const [salesRes, cashRes, products, recipes] = await Promise.all([
    salesQ,
    cashQ,
    listProducts(businessUnitId).catch(() => []),
    listRecipesFull(businessUnitId).catch(() => [])
  ]);
  if (salesRes.error) throw salesRes.error;
  if (cashRes.error) throw cashRes.error;

  const costs = computeCosts(products, recipes);
  const nameOf = new Map(products.map((p) => [p.id, p.name]));

  let omzet = 0;
  let hpp = 0;
  let qtyTerjual = 0;
  const tanpaHpp = new Set();
  for (const s of salesRes.data ?? []) {
    const qty = Number(s.qty) || 0;
    omzet += Number(s.revenue) || 0;
    qtyTerjual += qty;
    const c = costs.get(s.product_id);
    if (c == null) tanpaHpp.add(nameOf.get(s.product_id) ?? 'produk tanpa nama');
    else hpp += qty * c;
  }

  // Beban dikelompokkan per kategori kas.
  const bebanPerKategori = new Map();
  let beban = 0;
  for (const c of cashRes.data ?? []) {
    const nilai = Math.abs(Number(c.amount) || 0);
    const kat = c.cash_categories?.name ?? 'Tanpa kategori';
    bebanPerKategori.set(kat, (bebanPerKategori.get(kat) ?? 0) + nilai);
    beban += nilai;
  }

  const labaKotor = omzet - hpp;
  const labaBersih = labaKotor - beban;
  const marginKotor = omzet > 0 ? (labaKotor / omzet) * 100 : 0;

  const rows = [
    ['Omzet penjualan', rp(omzet)],
    ['HPP — bahan baku terpakai', rpMinus(hpp)],
    ['Laba kotor', rp(labaKotor)],
    ['', ''],
    ...[...bebanPerKategori.entries()].sort((a, b) => b[1] - a[1]).map(([kat, nilai]) => [`Beban — ${kat}`, rpMinus(nilai)]),
    ['Total beban operasional', rpMinus(beban)],
    ['', ''],
    ['Laba bersih (estimasi)', rp(labaBersih)]
  ];
  // Indeks baris yang ditebalkan: Laba kotor, Total beban, Laba bersih.
  const idxTotalBeban = 4 + bebanPerKategori.size;
  const bold = [2, idxTotalBeban, idxTotalBeban + 2];

  return {
    columns: [{ header: 'Keterangan', width: 2.6 }, { header: 'Nilai', width: 1.4, numeric: true }],
    rows,
    bold,
    summary: [
      { label: 'Omzet', value: rp(omzet) },
      { label: 'Laba kotor', value: rp(labaKotor) },
      { label: 'Margin kotor', value: `${formatNum(marginKotor, 1)}%` },
      { label: 'Laba bersih', value: rp(labaBersih) }
    ],
    note:
      `Dihitung dari ${formatNum(qtyTerjual)} porsi terjual. HPP memakai resep aktif (mode Standalone, ` +
      `mundur ke Dilayani CK bila tidak ada). Beban hanya mengambil **Kas Keluar**; transfer antar pemegang kas ` +
      `dan Kas Masuk sengaja tidak dihitung sebagai pendapatan supaya tidak dobel dengan omzet penjualan.` +
      (tanpaHpp.size
        ? ` Perhatian: ${tanpaHpp.size} menu belum punya HPP sehingga tidak masuk perhitungan — ${[...tanpaHpp].slice(0, 8).join(', ')}${tanpaHpp.size > 8 ? ', …' : ''}.`
        : '')
  };
}

// ---------------------------------------------------------
// 2. Rekap Penggajian (NBM)
// ---------------------------------------------------------

async function buildPayrollNbm({ businessUnitId, outletId, from, to }) {
  const [records, staff] = await Promise.all([
    fetchAttendance({ businessUnitId, outletId, from, to }),
    listBuStaff(businessUnitId).catch(() => [])
  ]);
  const namaStaff = new Map(staff.map((s) => [s.user_id, s.full_name]));

  // Config NBM dibaca per outlet BASIS yang benar-benar muncul di data.
  const outletIds = [...new Set(records.map((r) => r.nbm_outlet_id ?? r.outlet_id).filter(Boolean))];
  const cfg = {};
  const tiers = {};
  const holidays = {};
  for (const oid of outletIds) {
    cfg[oid] = await getNbmConfig(oid).catch(() => null);
    tiers[oid] = await listOvertimeTiers(oid).catch(() => []);
    holidays[oid] = (await listHolidays({ businessUnitId, outletId: oid }).catch(() => [])).map((h) => h.holiday_date);
  }
  const adjustments = await listNbmAdjustments(records.map((r) => r.id)).catch(() => new Map());

  const agg = new Map();
  const bucket = (uid) => {
    if (!agg.has(uid))
      agg.set(uid, { hadir: 0, libur: 0, storing: 0, belumTutup: 0, base: 0, lembur: 0, bonusStoring: 0, adjust: 0, total: 0 });
    return agg.get(uid);
  };

  for (const r of records) {
    const b = bucket(r.user_id);
    b.hadir++;
    if (r.is_storing) b.storing++;
    if (!r.clock_out_at) {
      b.belumTutup++;
      continue;
    }
    const oid = r.nbm_outlet_id ?? r.outlet_id;
    const nbm = calculateNbm(r, cfg[oid], tiers[oid], holidays[oid] ?? []);
    if (!nbm) continue;
    if (nbm.isHoliday) b.libur++;
    b.base += nbm.base;
    b.lembur += nbm.overtimeBonus;
    b.bonusStoring += nbm.storingBonus;
    const adj = adjustments.get(r.id);
    // Penyesuaian manual admin MENGGANTIKAN total baris itu.
    const totalBaris = adj ? Number(adj.amount) : nbm.total;
    if (adj) b.adjust += Number(adj.amount) - nbm.total;
    b.total += totalBaris;
  }

  const baris = [...agg.entries()]
    .map(([uid, b]) => ({ nama: namaStaff.get(uid) ?? '(staff tidak dikenal)', ...b }))
    .sort((a, b) => a.nama.localeCompare(b.nama));

  const sum = (k) => baris.reduce((t, r) => t + r[k], 0);
  const rows = baris.map((r) => [
    r.nama,
    formatNum(r.hadir),
    formatNum(r.libur),
    formatNum(r.storing),
    rp(r.base),
    rp(r.lembur),
    rp(r.bonusStoring),
    r.adjust ? rp(r.adjust) : '-',
    rp(r.total)
  ]);
  if (rows.length) {
    rows.push([
      `TOTAL (${baris.length} staff)`,
      formatNum(sum('hadir')),
      formatNum(sum('libur')),
      formatNum(sum('storing')),
      rp(sum('base')),
      rp(sum('lembur')),
      rp(sum('bonusStoring')),
      sum('adjust') ? rp(sum('adjust')) : '-',
      rp(sum('total'))
    ]);
  }

  const belumTutup = baris.reduce((t, r) => t + r.belumTutup, 0);
  const tanpaConfig = outletIds.filter((oid) => !cfg[oid]).length;

  return {
    columns: [
      { header: 'Staff', width: 1.8 },
      { header: 'Hadir', width: 0.6, numeric: true },
      { header: 'Libur', width: 0.6, numeric: true },
      { header: 'Storing', width: 0.7, numeric: true },
      { header: 'NBM Dasar', width: 1.2, numeric: true },
      { header: 'Lembur', width: 1.1, numeric: true },
      { header: 'Bonus Storing', width: 1.1, numeric: true },
      { header: 'Penyesuaian', width: 1.1, numeric: true },
      { header: 'Total', width: 1.2, numeric: true }
    ],
    rows,
    bold: rows.length ? [rows.length - 1] : [],
    summary: [
      { label: 'Staff dibayar', value: formatNum(baris.length) },
      { label: 'Total hari hadir', value: formatNum(sum('hadir')) },
      { label: 'Total NBM', value: rp(sum('total')) }
    ],
    note:
      'Mengikuti **BU/outlet basis** staff (tanda ★ di Master User), bukan lokasi absen fisik. ' +
      'Penyesuaian manual dari tab Rekap NBM sudah diperhitungkan — kolom Penyesuaian menampilkan selisihnya terhadap hitungan otomatis. ' +
      (belumTutup ? `${belumTutup} sesi belum clock out sehingga tidak dihitung. ` : '') +
      (tanpaConfig ? `${tanpaConfig} outlet belum punya pengaturan NBM sehingga presensinya bernilai 0.` : '')
  };
}

// ---------------------------------------------------------
// 3. Rekap Presensi & Disiplin
// ---------------------------------------------------------

async function buildAttendanceDiscipline({ businessUnitId, outletId, from, to }) {
  const [records, staff, leaveRes] = await Promise.all([
    fetchAttendance({ businessUnitId, outletId, from, to }),
    listBuStaff(businessUnitId).catch(() => []),
    supabase
      .from('leave_requests')
      .select('user_id, start_date, end_date, status, leave_types(name)')
      .eq('business_unit_id', businessUnitId)
      .eq('status', 'approved')
      .lte('start_date', to)
      .gte('end_date', from)
      .limit(2000)
  ]);

  const periode = daysBetween(from, to);
  const periodeSet = new Set(periode);

  // Hari cuti yang benar-benar jatuh di dalam periode laporan.
  const cutiHari = new Map();
  for (const l of leaveRes.data ?? []) {
    const n = daysBetween(l.start_date, l.end_date).filter((d) => periodeSet.has(d)).length;
    cutiHari.set(l.user_id, (cutiHari.get(l.user_id) ?? 0) + n);
  }

  const KOSONG = { hadir: 0, tepat: 0, toleransi: 0, telat: 0, menit: 0, storing: 0, belumTutup: 0, tanpaJadwal: 0 };
  const agg = new Map();
  for (const r of records) {
    if (!agg.has(r.user_id)) agg.set(r.user_id, { ...KOSONG });
    const b = agg.get(r.user_id);
    b.hadir++;
    if (r.is_storing) b.storing++;
    if (!r.clock_out_at) b.belumTutup++;
    // Kunci status mengikuti LATE_LABEL di modul Shift.
    if (r.late_status === 'ontime') b.tepat++;
    else if (r.late_status === 'tolerance') b.toleransi++;
    else if (r.late_status === 'late') {
      b.telat++;
      b.menit += Number(r.late_minutes) || 0;
    } else b.tanpaJadwal++; // no_schedule / off_day / outlet tanpa modul Shift
  }

  // Semua staff BU ikut ditampilkan — staff yang 0 hari hadir justru penting terlihat.
  const baris = staff
    .map((s) => ({
      nama: s.full_name,
      aktif: s.is_active !== false,
      cuti: cutiHari.get(s.user_id) ?? 0,
      ...(agg.get(s.user_id) ?? KOSONG)
    }))
    .filter((r) => r.aktif || r.hadir > 0)
    .sort((a, b) => b.telat - a.telat || a.nama.localeCompare(b.nama));

  const rows = baris.map((r) => [
    r.nama + (r.aktif ? '' : ' (nonaktif)'),
    formatNum(r.hadir),
    formatNum(r.tepat),
    formatNum(r.toleransi),
    formatNum(r.telat),
    r.menit ? formatNum(r.menit) : '-',
    formatNum(r.storing),
    r.cuti ? formatNum(r.cuti) : '-',
    r.belumTutup ? formatNum(r.belumTutup) : '-'
  ]);

  const sum = (k) => baris.reduce((t, r) => t + r[k], 0);
  const totalBerjadwal = sum('tepat') + sum('toleransi') + sum('telat');
  const tanpaJadwal = sum('tanpaJadwal');

  return {
    columns: [
      { header: 'Staff', width: 1.8 },
      { header: 'Hadir', width: 0.7, numeric: true },
      { header: LATE_LABEL.ontime, width: 0.9, numeric: true },
      { header: LATE_LABEL.tolerance, width: 0.9, numeric: true },
      { header: 'Terlambat', width: 0.9, numeric: true },
      { header: 'Menit telat', width: 0.9, numeric: true },
      { header: 'Tugas luar', width: 0.9, numeric: true },
      { header: 'Cuti (hari)', width: 0.9, numeric: true },
      { header: 'Belum clock out', width: 1, numeric: true }
    ],
    rows,
    summary: [
      { label: 'Hari dalam periode', value: formatNum(periode.length) },
      { label: 'Total hari hadir', value: formatNum(sum('hadir')) },
      { label: 'Kasus terlambat', value: formatNum(sum('telat')) },
      { label: 'Total menit telat', value: formatNum(sum('menit')) }
    ],
    note:
      'Diurutkan dari yang paling sering terlambat. Mengikuti **BU/outlet basis** staff, bukan lokasi absen fisik. ' +
      'Status ketepatan waktu diambil dari snapshot saat clock in, jadi perubahan jadwal shift belakangan tidak mengubah riwayat. ' +
      (tanpaJadwal
        ? `${formatNum(tanpaJadwal)} sesi tidak punya jadwal shift sehingga tidak masuk kolom tepat waktu/toleransi/terlambat (dari total ${formatNum(totalBerjadwal + tanpaJadwal)} sesi). `
        : '') +
      'Cuti dihitung dari pengajuan berstatus disetujui yang harinya jatuh di dalam periode.'
  };
}
