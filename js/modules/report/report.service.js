import { supabase } from '../../config/supabase-client.js';
import { formatRupiah, formatNum } from '../../core/format.js';
import { isoFrom, isoTo } from '../../core/dates.js';
import { ambilSemua } from '../../core/ambil-semua.js';
import { listProducts, listRecipesFull, computeCosts } from '../product/product.service.js';
import { getNbmConfig, listOvertimeTiers, listHolidays, listNbmAdjustments, calculateNbm } from '../attendance/nbm.service.js';
// listHolidays juga dipakai laporan Hak Cuti Pengganti (PH).
// includeInactive: true di SELURUH laporan. Orang yang bekerja bulan lalu lalu
// keluar tetap harus terhitung di laporan bulan lalu — menyembunyikannya berarti
// menulis ulang sejarah, dan total jam/gaji jadi tidak cocok dengan kenyataan
// tanpa ada penjelasan kenapa.
import { listBuStaff } from '../leave/leave.service.js';
import { LATE_LABEL } from '../shift/shift.service.js';
import { laporanKasUser, rincianMutasiKas } from '../cash/cash.service.js';
import { nilaiStok, barisCogs, ringkasCogs } from './cogs.js';
import { barisLabaRugi, ringkasLabaRugi, persen, rekapPerBahan, pesanLabaRugi } from './laba-rugi-outlet.js';
import { selainBahan } from '../cash/jenis-pengeluaran.js';
import { susunMutasiKas } from './mutasi-kas.js';

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
    label: 'Laba Kotor',
    group: 'Keuangan',
    description: 'Omzet dikurangi HPP bahan, per outlet. Beban operasional belum termasuk — lihat catatan di bawah tabel.',
    build: buildProfitLoss
  },
  {
    key: 'laba_rugi_outlet',
    label: 'Laba Rugi Outlet',
    group: 'Keuangan',
    description:
      'Empat arus dipertemukan: barang masuk (kiriman CK + nota supplier), stok awal & akhir dari opname, ' +
      'penjualan, dan pengeluaran outlet selain bahan. Menghasilkan HPP nyata, food cost %, laba kotor, dan laba ' +
      'bersih per outlet. Pilih satu outlet untuk melihat rincian per dokumen dan rekap per bahan.',
    build: buildLabaRugiOutlet
  },
  {
    key: 'cogs',
    label: 'COGS (Harga Pokok Penjualan)',
    group: 'Keuangan',
    description:
      'Stok awal + barang masuk − stok akhir, per outlet. Barang masuk mencakup nota supplier DAN kiriman ' +
      'dari Central Kitchen. Stok awal & akhir = nilai SALDO STOK pada tanggalnya (seluruh bahan × HPP, hasil ' +
      'opname sudah termasuk). Berbeda dari Laba Kotor, yang menghitung HPP dari resep.',
    build: buildCogs
  },
  {
    key: 'payroll_nbm',
    label: 'Rekap Penggajian (NBM)',
    group: 'SDM',
    description: 'Satu baris per staff: hari hadir, lembur, tugas luar/storing, penyesuaian, dan total NBM.',
    build: buildPayrollNbm
  },
  {
    key: 'attendance_discipline',
    label: 'Rekap Presensi & Disiplin',
    group: 'SDM',
    description: 'Satu baris per staff: hari hadir, ketepatan waktu, menit keterlambatan, dan hari cuti.',
    build: buildAttendanceDiscipline
  },
  {
    key: 'cash_by_user',
    label: 'Kas per Pemegang',
    group: 'Keuangan',
    // `pakaiFilterUser` dibaca halaman laporan untuk memunculkan dropdown user.
    // Laporan lain tidak punya konsep "pemegang", jadi filternya disembunyikan
    // di sana — filter yang tidak berpengaruh apa pun lebih membingungkan
    // daripada tidak ada filter.
    pakaiFilterUser: true,
    // Idem untuk kategori: hanya laporan kas yang punya kategori.
    pakaiFilterKategori: true,
    description:
      'Transaksi kas per pemegang: kantong, outlet peruntukan, kategori, keterangan, jumlah barang & satuan, nominal, dan bukti nota.',
    build: buildCashByUser
  },
  {
    key: 'cash_mutation_detail',
    label: 'Rincian Mutasi Kas (per item)',
    group: 'Keuangan',
    pakaiFilterUser: true,
    pakaiFilterKategori: true,
    // Hanya laporan ini yang memecah per kantong; `pakaiFilterKantong` yang
    // memunculkan dropdown-nya di halaman laporan.
    pakaiFilterKantong: true,
    description:
      'Keluar-masuk kas dirinci PER ITEM, bukan per nota: pembayaran nota supplier dipecah menjadi baris bahannya ' +
      '(lombok 1 kg Rp10.000), pengeluaran buku kas tampil dengan kategorinya (karcis parkir Rp5.000). ' +
      'Bisa disaring per pemegang kas dan per kantong.',
    build: buildCashMutationDetail
  },
  {
    key: 'ph_replacement',
    label: 'Hak Cuti Pengganti (PH)',
    group: 'SDM',
    description: 'Staff yang tetap masuk di hari libur nasional beserta hak cuti penggantinya.',
    build: buildPhReplacement
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
const fnum = (n) => formatNum(Number(n) || 0);
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
  // `ambilSemua`, bukan `.limit(5000)`.
  //
  // Batas itu tidak pernah menghasilkan error — jawabannya sukses, cuma
  // kurang. Urutannya MENAIK di sini, jadi yang terpotong justru tanggal
  // TERBARU: laporan setahun akan diam-diam berhenti di bulan kesekian, dan
  // yang hilang adalah bulan yang paling mungkin sedang ditanyakan orang.
  const rows = await ambilSemua((dari, sampai) =>
    supabase
      .from('attendance_records')
      .select(
        'id, user_id, clock_in_at, clock_out_at, is_storing, late_status, late_minutes, business_unit_id, nbm_business_unit_id, outlet_id, nbm_outlet_id',
        { count: 'exact' }
      )
      .or(`nbm_business_unit_id.eq.${businessUnitId},and(nbm_business_unit_id.is.null,business_unit_id.eq.${businessUnitId})`)
      .gte('clock_in_at', isoFrom(from))
      .lte('clock_in_at', isoTo(to))
      .order('clock_in_at')
      .range(dari, sampai)
  );
  if (!outletId) return rows;
  return rows.filter((r) => (r.nbm_outlet_id ?? r.outlet_id) === outletId);
}

// ---------------------------------------------------------
// 0. COGS — dari pergerakan stok nyata
//
//   COGS = stok awal + pembelian − stok akhir
//
// Stok awal & akhir = NILAI OPNAME (Σ dihitung × HPP), bukan saldo `stock_balances`.
// Alasannya: saldo sistem adalah hasil pencatatan; opname adalah hasil MELIHAT
// RAK. Selisih keduanya justru isi dari angka yang dicari — tumpahan, kelebihan
// takar, waste tak tercatat, kehilangan.
// ---------------------------------------------------------

/**
 * Opname TERTUTUP terakhir per outlet pada suatu rentang tanggal.
 *
 * `status = 'closed'` saja. Sesi yang masih 'open' belum selesai dihitung, dan
 * sesi 'cancelled' sengaja ditutup TANPA menyentuh stok (0085) — memakai
 * keduanya berarti menilai stok dari hitungan yang belum/tidak berlaku.
 *
 * Kalau satu outlet punya beberapa opname di rentang yang sama, yang dipakai
 * yang PALING AKHIR: itulah keadaan rak pada ujung periode.
 */
async function opnameTerakhirPerOutlet({ businessUnitId, outletIds, sampai, sejak = null }) {
  if (!outletIds?.length) return new Map();
  const baris = await ambilSemua((dari, hingga) => {
    let q = supabase
      .from('stock_counts')
      .select('id, outlet_id, code, count_date, closed_at', { count: 'exact' })
      .eq('business_unit_id', businessUnitId)
      .eq('status', 'closed')
      .in('outlet_id', outletIds)
      .lte('count_date', sampai)
      .order('count_date', { ascending: false })
      .order('closed_at', { ascending: false });
    if (sejak) q = q.gte('count_date', sejak);
    return q.range(dari, hingga);
  });

  // Urutannya sudah menurun, jadi yang PERTAMA ketemu per outlet adalah yang
  // paling akhir. `has` dipakai supaya sisanya dilewati tanpa membandingkan
  // tanggal lagi — perbandingan kedua adalah tempat urutan mudah tertukar.
  const peta = new Map();
  for (const b of baris) {
    if (!peta.has(b.outlet_id)) peta.set(b.outlet_id, b);
  }
  return peta;
}

/**
 * Saldo stok seluruh outlet pada satu tanggal, dinilai dengan HPP.
 *
 * ============ KENAPA BUKAN NILAI SESI OPNAME ============
 *
 * Versi pertama laporan ini memakai nilai SATU SESI opname sebagai stok akhir.
 * Sesi opname hanya berisi bahan yang dihitung DI SESI ITU — dan sesi
 * perbaikan, yang dibuka hanya untuk membetulkan satu bahan, berisi satu baris.
 * Nilainya Rp54.701 dipakai sebagai "nilai seluruh stok outlet".
 *
 * `saldo_stok_pada` (0137) adalah `stock_balances` dengan batas tanggal.
 * Menutup opname MENULIS penyesuaian ke `stock_movements`, jadi hasil tiap
 * opname — termasuk sesi perbaikan — sudah ikut dengan sendirinya, dan bahan
 * yang tidak pernah dihitung tetap membawa saldo terakhirnya.
 */
async function nilaiStokPerOutlet({ businessUnitId, outletId, tanggal, hpp }) {
  // `ambilSemua`, dan bukan satu panggilan polos.
  //
  // RPC yang mengembalikan himpunan baris ikut dipotong PostgREST di sekitar
  // 1000 baris. Satu BU di sini punya 800+ produk di beberapa outlet; yang
  // hilang adalah produk-produk terakhir menurut urutan, dan stok akhirnya
  // cuma jadi lebih kecil — tanpa satu pun error.
  const baris = await ambilSemua((dari, sampai) =>
    supabase
      .rpc('saldo_stok_pada', { p_bu: businessUnitId, p_tanggal: tanggal, p_outlet: outletId || null }, { count: 'exact' })
      .order('product_id')
      .range(dari, sampai)
  );

  const perOutlet = new Map();
  for (const b of baris) {
    if (!perOutlet.has(b.outlet_id)) perOutlet.set(b.outlet_id, []);
    perOutlet.get(b.outlet_id).push(b);
  }

  const hasil = new Map();
  for (const [oid, rows] of perOutlet) hasil.set(oid, nilaiStok(rows, hpp));
  return hasil;
}

/**
 * Nilai BARANG MASUK DARI CK per outlet, pada periode.
 *
 * ============ KENAPA INI SEMPAT HILANG DARI COGS ============
 *
 * `buildCogs` mengambil "pembelian" dari `nota_ringkas`, dan view itu MURNI
 * `goods_receipts` — nota supplier saja. Sementara stok awal & akhirnya dari
 * `saldo_stok_pada`, yang menjumlahkan SELURUH `stock_movements` termasuk
 * `transfer_in` dari CK.
 *
 * Jadi untuk outlet yang dipasok CK, barangnya menaikkan stok akhir tapi tidak
 * pernah masuk sisi "pembelian":
 *
 *     stok awal 100 · kiriman CK 50 · beli supplier 30 · terpakai 60
 *     stok akhir = 120
 *     COGS seharusnya           : 60
 *     COGS tanpa kiriman CK     : 100 + 30 − 120 = 10
 *
 * Angkanya jauh lebih kecil dari seharusnya, tercetak rapi, tanpa satu pun
 * galat. Outlet yang belanja sendiri saja tidak terkena; yang dipasok CK
 * terkena telak — dan itu sebagian besar outlet.
 *
 * ============ DIHITUNG PER TANGGAL TERIMA, BUKAN TANGGAL KIRIM ============
 *
 * Gerakan stoknya ditulis `receive_dispatch` SAAT DITERIMA. Kiriman yang
 * berangkat 31 Agustus dan diterima 1 September menaikkan stok September —
 * jadi menghitungnya di Agustus membuat kedua bulan salah sekaligus, dan
 * selisihnya tidak akan pernah bisa dijelaskan.
 *
 * Nilainya qty × HPP, pola yang sama dengan `rekap-kiriman.js`. Tidak ada
 * "harga beli" pada transfer internal; HPP satu-satunya nilai yang masuk akal.
 */
/**
 * ============ DAN SISI KELUARNYA, YANG SEMPAT TIDAK ADA SAMA SEKALI ============
 *
 * Outlet yang MENGIRIM stoknya berkurang sebesar yang dikirim. Tanpa
 * mengurangkannya, barang yang ia KIRIM terhitung sebagai barang yang ia
 * PAKAI — dan kiriman internal terhitung DUA KALI di tingkat BU:
 *
 *     CK awal 100, kirim 60, akhir 40   -> COGS 60, padahal CK tidak memakai
 *     Outlet awal 0, masuk 60, akhir 10 -> COGS 50 (benar)
 *     TOTAL                             -> 110, padahal grup memakai 50
 *
 * Gejala lapangannya: food cost Central Kitchen ratusan persen.
 *
 * Nilainya dari qty DITERIMA, bukan qty dikirim. Kalau memakai qty dikirim,
 * barang yang susut di perjalanan lenyap dari laporan; dengan qty diterima,
 * susutnya tetap jadi beban pengirimnya — dan itu memang tempatnya hilang.
 */
async function nilaiKirimanPerOutlet({ businessUnitId, outletId, from, to, hpp }) {
  const baris = await ambilSemua((dari, sampai) => {
    const q = supabase
      .from('dispatch_items')
      // `!inner` supaya saringan status & tanggal bisa menempel ke headernya.
      //
      // TIDAK disaring per outlet di sini walau `outletId` ada: satu baris
      // yang sama dibutuhkan DUA KALI — sebagai "masuk" bagi tujuannya dan
      // "keluar" bagi asalnya. Menyaringnya di server akan membuang sisi yang
      // satunya, dan outlet yang dipilih kehilangan sisi keluarnya.
      .select('product_id, received_qty, dispatches!inner(from_outlet_id, to_outlet_id, status, received_at, business_unit_id)', {
        count: 'exact'
      })
      .eq('dispatches.business_unit_id', businessUnitId)
      .eq('dispatches.status', 'received')
      .gte('dispatches.received_at', isoFrom(from))
      .lte('dispatches.received_at', isoTo(to));
    return q.range(dari, sampai);
  });

  const masuk = new Map();
  const keluar = new Map();
  const tambah = (peta, oid, nilai, adaHpp) => {
    if (!oid) return;
    const kini = peta.get(oid) ?? { nilai: 0, tanpaHpp: 0, jumlahItem: 0 };
    kini.jumlahItem += 1;
    // Bahan tanpa HPP DIHITUNG TERPISAH, tidak diam-diam dianggap nol. Nol
    // membuat COGS terlihat lebih kecil tanpa ada yang menandainya.
    if (adaHpp) kini.nilai += nilai;
    else kini.tanpaHpp += 1;
    peta.set(oid, kini);
  };

  for (const b of baris) {
    const qty = Number(b.received_qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const h = hpp.get(b.product_id);
    const adaHpp = h !== null && h !== undefined && Number.isFinite(Number(h));
    const nilai = adaHpp ? Number(h) * qty : 0;
    tambah(masuk, b.dispatches?.to_outlet_id, nilai, adaHpp);
    tambah(keluar, b.dispatches?.from_outlet_id, nilai, adaHpp);
  }

  // Saringan outlet diterapkan DI SINI, sesudah kedua sisi terhitung.
  if (outletId) {
    const satu = (peta) => new Map(peta.has(outletId) ? [[outletId, peta.get(outletId)]] : []);
    return { masuk: satu(masuk), keluar: satu(keluar) };
  }
  return { masuk, keluar };
}

async function buildCogs({ businessUnitId, outletId, from, to }) {
  let outletQ = supabase.from('outlets').select('id, name').eq('business_unit_id', businessUnitId).order('name');
  if (outletId) outletQ = outletQ.eq('id', outletId);
  const [outletRes, products, recipes] = await Promise.all([
    outletQ,
    listProducts(businessUnitId).catch(() => []),
    listRecipesFull(businessUnitId).catch(() => [])
  ]);
  if (outletRes.error) throw outletRes.error;

  const outlets = outletRes.data ?? [];
  const outletIds = outlets.map((o) => o.id);
  const hpp = computeCosts(products, recipes);

  // Sehari sebelum periode: stok awal adalah keadaan rak SEBELUM hari pertama.
  // Memakai `from` sendiri akan mengambil opname yang dilakukan DI DALAM
  // periode sebagai stok awal, dan pembelian hari itu jadi terhitung dua kali.
  const sebelum = new Date(`${from}T00:00:00`);
  sebelum.setDate(sebelum.getDate() - 1);
  const hariSebelum = dateKey(sebelum);

  const [stokAwal, stokAkhir, petaAwal, petaAkhir, notaRes, kirimanMasuk] = await Promise.all([
    nilaiStokPerOutlet({ businessUnitId, outletId, tanggal: hariSebelum, hpp }),
    nilaiStokPerOutlet({ businessUnitId, outletId, tanggal: to, hpp }),
    // Opname TIDAK lagi jadi sumber angkanya — ia penanda apakah angka itu
    // pernah dikunci hitungan fisik. Tanggalnya tetap ditampilkan supaya admin
    // tahu sejauh mana stoknya sudah diverifikasi.
    opnameTerakhirPerOutlet({ businessUnitId, outletIds, sampai: hariSebelum }),
    opnameTerakhirPerOutlet({ businessUnitId, outletIds, sampai: to, sejak: from }),
    ambilSemua((dari, sampai) => {
      let q = supabase
        .from('nota_ringkas')
        .select('outlet_id, receipt_date, total, status', { count: 'exact' })
        .eq('business_unit_id', businessUnitId)
        .gte('receipt_date', from)
        .lte('receipt_date', to);
      if (outletId) q = q.eq('outlet_id', outletId);
      return q.range(dari, sampai);
    }),
    nilaiKirimanPerOutlet({ businessUnitId, outletId, from, to, hpp })
  ]);

  // Nota yang DIBATALKAN (0131) barangnya sudah ditarik — ikut menghitungnya
  // membuat pembelian, dan karenanya COGS, lebih besar dari yang sebenarnya.
  const pembelian = new Map();
  for (const n of notaRes) {
    if (n.status === 'dibatalkan') continue;
    pembelian.set(n.outlet_id, (pembelian.get(n.outlet_id) ?? 0) + (Number(n.total) || 0));
  }

  // ============ KIRIMAN DARI CK IKUT "BARANG MASUK" ============
  //
  // Lihat penjelasan panjang di `nilaiKirimanPerOutlet`. Tanpa baris ini, COGS
  // outlet yang dipasok CK jauh lebih kecil dari seharusnya — tanpa galat.
  let tanpaHppKiriman = 0;
  for (const [oid, k] of kirimanMasuk.masuk) {
    pembelian.set(oid, (pembelian.get(oid) ?? 0) + k.nilai);
    tanpaHppKiriman += k.tanpaHpp;
  }

  // ============ DAN SISI KELUARNYA DIKURANGKAN ============
  //
  // Lihat penjelasan di `nilaiKirimanPerOutlet`. Tanpa ini, barang yang
  // DIKIRIM CK terhitung sebagai barang yang DIPAKAI CK, dan total BU
  // menghitung kiriman internal dua kali.
  const keluarKiriman = new Map();
  for (const [oid, k] of kirimanMasuk.keluar) {
    keluarKiriman.set(oid, k.nilai);
    pembelian.set(oid, (pembelian.get(oid) ?? 0) - k.nilai);
  }

  const kosong = { nilai: 0, tanpaHpp: 0, jumlahItem: 0 };
  const baris = outlets.map((o) => ({
    outlet: o.name,
    ...barisCogs({
      awal: stokAwal.get(o.id) ?? kosong,
      akhir: stokAkhir.get(o.id) ?? kosong,
      pembelian: pembelian.get(o.id) ?? 0,
      opnameAwal: petaAwal.get(o.id) ? { tanggal: petaAwal.get(o.id).count_date } : null,
      opnameAkhir: petaAkhir.get(o.id) ? { tanggal: petaAkhir.get(o.id).count_date } : null
    })
  }));

  const total = ringkasCogs(baris);

  const rows = baris.map((b) => [
    b.outlet,
    // Tanggal opname DITAMPILKAN walau bukan lagi sumber angkanya: ia satu-
    // satunya petunjuk sejauh mana stoknya pernah diverifikasi fisik, dan itu
    // tidak terlihat dari angkanya sendiri.
    b.tanggalAwal || '(belum ada)',
    rp(b.awal),
    rp(b.pembelian),
    b.tanggalAkhir || '(belum ada)',
    rp(b.akhir),
    rp(b.cogs),
    b.catatan
  ]);

  if (baris.length > 1) {
    rows.push([
      'TOTAL',
      '',
      rp(total.awal),
      rp(total.pembelian),
      '',
      rp(total.akhir),
      rp(total.cogs),
      total.outletBelumTerkunci ? `${total.outletBelumTerkunci} outlet belum dikunci opname` : ''
    ]);
  }

  return {
    columns: [
      { header: 'Outlet', width: 1.6 },
      { header: 'Opname Awal', width: 1 },
      { header: 'Stok Awal', width: 1.2, numeric: true },
      { header: 'Masuk − Keluar', width: 1.4, numeric: true },
      { header: 'Opname Akhir', width: 1 },
      { header: 'Stok Akhir', width: 1.2, numeric: true },
      { header: 'COGS', width: 1.3, numeric: true },
      { header: 'Catatan', width: 2 }
    ],
    rows,
    bold: baris.length > 1 ? [rows.length - 1] : [],
    summary: [
      { label: 'Stok awal', value: rp(total.awal) },
      { label: 'Masuk − keluar (bersih)', value: rp(total.pembelian) },
      { label: 'Stok akhir', value: rp(total.akhir) },
      { label: 'COGS', value: rp(total.cogs) },
      {
        label: 'Dikunci opname',
        value: `${total.outletTerkunci}/${total.outletTotal} outlet`
      }
    ],
    note:
      // ============ ANGKANYA BERUBAH SEJAK KIRIMAN CK IKUT ============
      //
      // Rekap yang terlanjur dicetak sebelum perbaikan ini memuat COGS yang
      // jauh lebih kecil. Tanpa kalimat ini, orang yang membandingkannya akan
      // mengira salah satunya rusak — dan tidak ada cara menjawabnya.
      'PENTING: sejak perbaikan ini, kolom Masuk − Keluar memuat kiriman antar-outlet di KEDUA arah, bukan hanya ' +
      'nota supplier. Sebelumnya kiriman yang DITERIMA menaikkan stok akhir tanpa pernah masuk sisi barang masuk ' +
      '(COGS outlet penerima tercetak terlalu kecil), dan kiriman yang DIKIRIM menurunkan stok tanpa dikurangkan ' +
      '(COGS pengirim tercetak terlalu besar, dan total BU menghitung kiriman internal dua kali). Rekap lama yang ' +
      'sudah dicetak memuat angka yang itu. ' +
      (tanpaHppKiriman
        ? `${tanpaHppKiriman} baris kiriman belum punya HPP dan nilainya dihitung nol — lengkapi HPP bahannya supaya COGS tidak terlalu kecil. `
        : '') +
      'COGS = stok awal + (barang masuk − barang keluar) − stok akhir. Masuk = nota supplier (harga nota) + ' +
      'kiriman diterima dari outlet lain; keluar = kiriman yang DIKIRIM outlet ini. Keduanya qty diterima × HPP, ' +
      'dihitung pada TANGGAL TERIMA supaya cocok dengan saldo stok. ' +
      'Barang keluar dikurangkan supaya barang yang DIKIRIM Central Kitchen tidak terhitung sebagai barang yang ' +
      'DIPAKAI Central Kitchen — tanpa itu kiriman internal terhitung dua kali dan total BU selalu terlalu besar. ' +
      'Stok awal = nilai SALDO STOK pada akhir hari sebelum ' +
      `${from}; stok akhir = nilai saldo stok pada akhir hari ${to}. Keduanya = Σ (saldo × HPP), memakai ` +
      'saldo semua bahan — bukan nilai satu sesi opname, karena sesi perbaikan hanya berisi bahan yang dibetulkan ' +
      'dan nilainya akan jauh lebih kecil dari stok sebenarnya. Hasil opname tetap ikut dengan sendirinya: ' +
      'menutup opname menulis penyesuaian ke pergerakan stok. ' +
      'Kolom Opname Awal/Akhir menunjukkan kapan stoknya terakhir DIKUNCI hitungan fisik; yang berisi ' +
      '"(belum ada)" berarti angkanya hanya sebaik pencatatannya. ' +
      'Angka ini berbasis barang yang benar-benar hilang dari rak, jadi selisihnya terhadap HPP resep di laporan ' +
      'Laba Kotor adalah tumpahan, kelebihan takar, waste tak tercatat, dan kehilangan.'
  };
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

  const [salesRes, products, recipes] = await Promise.all([
    salesQ,
    listProducts(businessUnitId).catch(() => []),
    listRecipesFull(businessUnitId).catch(() => [])
  ]);
  if (salesRes.error) throw salesRes.error;

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

  const labaKotor = omzet - hpp;
  const marginKotor = omzet > 0 ? (labaKotor / omzet) * 100 : 0;

  const rows = [
    ['Omzet penjualan', rp(omzet)],
    ['HPP — bahan baku terpakai', rpMinus(hpp)],
    ['Laba kotor', rp(labaKotor)]
  ];

  return {
    columns: [{ header: 'Keterangan', width: 2.6 }, { header: 'Nilai', width: 1.4, numeric: true }],
    rows,
    bold: [2],
    summary: [
      { label: 'Omzet', value: rp(omzet) },
      { label: 'HPP', value: rp(hpp) },
      { label: 'Laba kotor', value: rp(labaKotor) },
      { label: 'Margin kotor', value: `${formatNum(marginKotor, 1)}%` }
    ],
    note:
      `Dihitung dari ${formatNum(qtyTerjual)} porsi terjual. HPP memakai resep aktif (mode Standalone, ` +
      `mundur ke Dilayani CK bila tidak ada). ` +
      `**Beban operasional belum termasuk**, jadi angka ini laba KOTOR — bukan laba bersih. ` +
      `Sejak modul Kas diubah menjadi milik user (bukan BU/outlet), pengeluaran kas tidak lagi menyimpan ` +
      `outlet mana yang menanggungnya, sehingga tidak bisa dibebankan ke laporan per outlet. ` +
      `Untuk laba bersih, beban perlu punya atribusi outlet sendiri — lihat catatan Fase 11 di README.` +
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
    listBuStaff(businessUnitId, { includeInactive: true }).catch(() => [])
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
      agg.set(uid, { hadir: 0, libur: 0, storing: 0, belumTutup: 0, base: 0, lembur: 0, bonusStoring: 0, phBonus: 0, adjust: 0, total: 0 });
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
    b.phBonus += nbm.phBonus ?? 0;
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
    r.phBonus ? rp(r.phBonus) : '-',
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
      sum('phBonus') ? rp(sum('phBonus')) : '-',
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
      { header: 'Tugas Luar/Storing', width: 1, numeric: true },
      { header: 'NBM Dasar', width: 1.2, numeric: true },
      { header: 'Lembur', width: 1.1, numeric: true },
      { header: 'Bonus Tugas Luar/Storing', width: 1.3, numeric: true },
      { header: 'Bonus PH', width: 1, numeric: true },
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
  const [records, staff, staffOutlet, leaveRes] = await Promise.all([
    fetchAttendance({ businessUnitId, outletId, from, to }),
    // Seluruh staff BU tetap diambil — dari sinilah NAMA-nya.
    listBuStaff(businessUnitId, { includeInactive: true }).catch(() => []),
    // Dan yang cakupannya di outlet terpilih (0139). Tanpa filter outlet,
    // daftar ini tidak dipakai sama sekali.
    outletId ? listBuStaff(businessUnitId, { includeInactive: true, outletId }).catch(() => null) : Promise.resolve(null),
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
    } else b.tanpaJadwal++;
    // Sisanya: `no_schedule`, `off_day`, `tugas_luar` (0160), dan outlet yang
    // belum memakai modul Shift.
    //
    // `tugas_luar` SENGAJA masuk ke sini, dan bukan karena terlewat: ketiga
    // kolom di atas menjawab "disiplin jam masuk", dan hari tanpa jam masuk
    // tidak bisa dinilai disiplinnya. Jumlah hari tugas luarnya sendiri sudah
    // punya kolomnya — `b.storing`, dibaca dari sesi presensinya yang
    // sebenarnya, bukan dari jadwalnya.
  }

  // SIAPA YANG DITAMPILKAN.
  //
  // Tanpa filter outlet: seluruh staff BU — baris nol hari hadir justru yang
  // paling penting terlihat di laporan disiplin.
  //
  // DENGAN filter outlet: hanya yang cakupannya DI OUTLET ITU, ditambah siapa
  // pun yang benar-benar punya presensi di sana pada periode ini. Bagian kedua
  // itu bukan kelonggaran — tanpanya, staff bercakupan level BU yang memang
  // bekerja di outlet tersebut akan hilang dari laporan BESERTA angkanya, dan
  // total di kartu ringkas tidak akan cocok dengan jumlah barisnya.
  //
  // Gagal memuat daftar outletnya (`null`) berarti kembali menampilkan semua —
  // laporan yang kelebihan baris masih bisa dibaca; yang kekurangan baris
  // diam-diam tidak.
  const cakupanOutlet = staffOutlet ? new Set(staffOutlet.map((s) => s.user_id)) : null;
  const tampil = (uid) => !cakupanOutlet || cakupanOutlet.has(uid) || agg.has(uid);

  const baris = staff
    .filter((s) => tampil(s.user_id))
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
      { header: 'Tugas Luar/Storing', width: 1, numeric: true },
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

// ---------------------------------------------------------
// 4. Hak Cuti Pengganti (PH)
// ---------------------------------------------------------

async function buildPhReplacement({ businessUnitId, outletId, from, to }) {
  const [records, staff, holidays] = await Promise.all([
    fetchAttendance({ businessUnitId, outletId, from, to }),
    listBuStaff(businessUnitId, { includeInactive: true }).catch(() => []),
    listHolidays({ businessUnitId, outletId: outletId || null }).catch(() => [])
  ]);
  const namaStaff = new Map(staff.map((s) => [s.user_id, s.full_name]));
  const holidayName = new Map(holidays.filter((h) => h.holiday_date >= from && h.holiday_date <= to).map((h) => [h.holiday_date, h.name]));

  // Hak cuti pengganti ditentukan per outlet BASIS (Pengaturan NBM & Lembur).
  const outletIds = [...new Set(records.map((r) => r.nbm_outlet_id ?? r.outlet_id).filter(Boolean))];
  const perDay = {};
  for (const oid of outletIds) {
    const cfg = await getNbmConfig(oid).catch(() => null);
    perDay[oid] = Number(cfg?.ph_replacement_days ?? 0);
  }

  const agg = new Map();
  for (const r of records) {
    const tgl = dateKey(new Date(r.clock_in_at));
    const nama = holidayName.get(tgl);
    if (!nama) continue; // hanya hari yang terdaftar sebagai libur nasional
    const oid = r.nbm_outlet_id ?? r.outlet_id;
    if (!agg.has(r.user_id)) agg.set(r.user_id, { hari: 0, hak: 0, tanggal: [] });
    const b = agg.get(r.user_id);
    b.hari++;
    b.hak += perDay[oid] ?? 0;
    b.tanggal.push(`${tgl} (${nama})`);
  }

  const baris = [...agg.entries()]
    .map(([uid, b]) => ({ nama: namaStaff.get(uid) ?? '(staff tidak dikenal)', ...b }))
    .sort((a, b) => b.hak - a.hak || a.nama.localeCompare(b.nama));

  const rows = baris.map((r) => [r.nama, formatNum(r.hari), formatNum(r.hak, 2), r.tanggal.join(', ')]);
  const totalHak = baris.reduce((t, r) => t + r.hak, 0);
  if (rows.length) rows.push([`TOTAL (${baris.length} staff)`, formatNum(baris.reduce((t, r) => t + r.hari, 0)), formatNum(totalHak, 2), '']);

  const belumDiatur = outletIds.filter((oid) => !perDay[oid]).length;

  return {
    columns: [
      { header: 'Staff', width: 1.8 },
      { header: 'Hari kerja di libur nasional', width: 1.3, numeric: true },
      { header: 'Hak cuti pengganti (hari)', width: 1.2, numeric: true },
      { header: 'Tanggal', width: 3 }
    ],
    rows,
    bold: rows.length ? [rows.length - 1] : [],
    summary: [
      { label: 'Hari libur di periode ini', value: formatNum(holidayName.size) },
      { label: 'Staff yang masuk', value: formatNum(baris.length) },
      { label: 'Total hak cuti pengganti', value: `${formatNum(totalHak, 2)} hari` }
    ],
    note:
      'Hanya menghitung presensi yang tanggalnya terdaftar di **Hari Libur** (Pengaturan NBM & Lembur) — jadi pastikan kalender liburnya sudah ditarik/diisi. ' +
      'Besaran hak per hari diambil dari **Cuti pengganti** di pengaturan NBM outlet basis staff. ' +
      (belumDiatur ? `${belumDiatur} outlet belum mengisi cuti pengganti, sehingga haknya 0. ` : '') +
      'Laporan ini baru sebatas **perhitungan hak**; pemberiannya ke jatah cuti staff masih dilakukan admin lewat modul Cuti.'
  };
}

// ---------------------------------------------------------
// 5. Kas per Pemegang
// ---------------------------------------------------------

async function buildCashByUser({ outletId, userId, categoryId, from, to }) {
  const rows = await laporanKasUser({ from, to, userId, outletId, categoryId }).catch(() => []);

  const label = {
    in: 'Masuk',
    out: 'Keluar',
    transfer_in: 'Terima transfer',
    transfer_out: 'Kirim transfer',
    move_in: 'Masuk antar kantong',
    move_out: 'Keluar antar kantong'
  };

  let masuk = 0;
  let keluar = 0;
  for (const r of rows) {
    const n = Number(r.amount) || 0;
    if (n >= 0) masuk += n;
    else keluar += Math.abs(n);
  }

  const baris = rows.map((r) => [
    r.entry_date,
    r.holder_name ?? '-',
    r.account_name ?? '-',
    r.outlet_name ?? '-',
    label[r.entry_type] ?? r.entry_type,
    r.category_name ?? '-',
    [r.notes, r.counterpart_name ? `(${r.counterpart_name})` : ''].filter(Boolean).join(' ') || '-',
    r.qty == null ? '-' : `${formatNum(r.qty)}${r.unit ? ` ${r.unit}` : ''}`,
    formatRupiah(Number(r.amount) || 0),
    r.proof_path ? 'Ada' : '—'
  ]);

  return {
    columns: [
      { header: 'Tanggal', width: 1 },
      { header: 'Pemegang', width: 1.5 },
      { header: 'Kantong', width: 1.1 },
      { header: 'Outlet', width: 1.2 },
      { header: 'Jenis', width: 1 },
      { header: 'Kategori', width: 1.2 },
      { header: 'Keterangan', width: 2 },
      { header: 'Jumlah', width: 1 },
      { header: 'Nominal', width: 1.2, numeric: true },
      { header: 'Nota', width: 0.7 }
    ],
    rows: baris,
    summary: [
      { label: 'Kas masuk', value: formatRupiah(masuk) },
      { label: 'Kas keluar', value: formatRupiah(keluar) },
      { label: 'Selisih', value: formatRupiah(masuk - keluar) },
      { label: 'Transaksi', value: formatNum(rows.length) }
    ],
    note:
      'Saldo kas melekat pada **user**, bukan outlet. Kolom Outlet adalah **peruntukan** yang dipilih saat mencatat kas keluar — ' +
      'untuk outlet mana uang itu dibelanjakan — bukan tempat kerja utama pemegangnya. ' +
      'Kas masuk tidak punya peruntukan, jadi kolomnya kosong; menyaring per outlet otomatis menyisihkan baris kas masuk. ' +
      'Transfer antar pemegang dan perpindahan antar kantong sendiri tidak memerlukan nota, karena tidak ada nota yang bisa difoto.'
  };
}

// ---------------------------------------------------------
// 6. Rincian Mutasi Kas — per ITEM, bukan per nota
//
// Seluruh penyusunannya ada di `mutasi-kas.js` (modul murni, bisa diuji tanpa
// browser). Yang tersisa di sini hanya pengambilan datanya.
//
// `businessUnitId` SENGAJA tidak dipakai, sama seperti Kas per Pemegang: sejak
// 0040 saldo kas melekat pada USER dan tidak menyimpan BU. Menyaringnya per BU
// akan membuang baris milik orang yang sama hanya karena ia juga bekerja di BU
// lain — dan yang terbuang adalah uang yang sungguhan keluar.
// ---------------------------------------------------------

async function buildCashMutationDetail({ outletId, userId, categoryId, accountId, tanpaKantong, from, to }) {
  const baris = await rincianMutasiKas({
    from,
    to,
    userId,
    accountId,
    tanpaKantong,
    outletId,
    categoryId
  });
  return susunMutasiKas({ baris, periode: { dari: from, sampai: to } });
}

// ---------------------------------------------------------
// Laba Rugi Outlet — empat arus dipertemukan.
// ---------------------------------------------------------

/**
 * Barang masuk dari CK, DIRINCI: per dokumen dan per bahan sekaligus.
 *
 * Satu query, dua bentuk keluaran — bukan dua query. Rincian dokumen dan rekap
 * bahan yang diambil terpisah bisa menjawab berbeda untuk periode yang sama
 * begitu salah satunya lupa menyaring status.
 */
async function rincianKirimanMasuk({ businessUnitId, outletId, from, to, hpp }) {
  const baris = await ambilSemua((dari, sampai) => {
    let q = supabase
      .from('dispatch_items')
      .select(
        'product_id, received_qty, products(name, base_unit), ' +
          'dispatches!inner(id, code, to_outlet_id, status, received_at, business_unit_id, from_outlet:outlets!from_outlet_id(name))',
        { count: 'exact' }
      )
      .eq('dispatches.business_unit_id', businessUnitId)
      .eq('dispatches.status', 'received')
      .gte('dispatches.received_at', isoFrom(from))
      .lte('dispatches.received_at', isoTo(to));
    if (outletId) q = q.eq('dispatches.to_outlet_id', outletId);
    return q.range(dari, sampai);
  });

  const perOutlet = new Map();
  for (const b of baris) {
    const oid = b.dispatches?.to_outlet_id;
    if (!oid) continue;
    const qty = Number(b.received_qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const h = hpp.get(b.product_id);
    const adaHpp = h !== null && h !== undefined && Number.isFinite(Number(h));
    const nilai = adaHpp ? Number(h) * qty : 0;

    if (!perOutlet.has(oid)) perOutlet.set(oid, { nilai: 0, tanpaHpp: 0, jumlahItem: 0, dok: new Map(), bahan: [] });
    const o = perOutlet.get(oid);
    o.nilai += nilai;
    o.jumlahItem += 1;
    if (!adaHpp) o.tanpaHpp += 1;

    const kode = b.dispatches?.code || '(tanpa nomor)';
    if (!o.dok.has(kode)) {
      o.dok.set(kode, { kode, tanggal: (b.dispatches?.received_at ?? '').slice(0, 10), dari: b.dispatches?.from_outlet?.name ?? '-', nilai: 0, item: 0 });
    }
    const d = o.dok.get(kode);
    d.nilai += nilai;
    d.item += 1;

    o.bahan.push({
      product_id: b.product_id,
      nama: b.products?.name ?? '',
      satuan: b.products?.base_unit ?? '',
      qty,
      nilai,
      adaHpp
    });
  }
  return perOutlet;
}

/** Barang masuk dari supplier, dirinci per nota dan per bahan. */
async function rincianNotaSupplier({ businessUnitId, outletId, from, to }) {
  const [nota, item] = await Promise.all([
    ambilSemua((dari, sampai) => {
      let q = supabase
        .from('nota_ringkas')
        .select('id, outlet_id, code, receipt_date, supplier, total, status, baris_tanpa_harga', { count: 'exact' })
        .eq('business_unit_id', businessUnitId)
        .gte('receipt_date', from)
        .lte('receipt_date', to);
      if (outletId) q = q.eq('outlet_id', outletId);
      return q.range(dari, sampai);
    }),
    ambilSemua((dari, sampai) => {
      let q = supabase
        .from('goods_receipt_items')
        .select('receipt_id, product_id, qty, line_total, unit_cost, products(name, base_unit), goods_receipts!inner(outlet_id, business_unit_id, receipt_date, status)', {
          count: 'exact'
        })
        .eq('goods_receipts.business_unit_id', businessUnitId)
        .gte('goods_receipts.receipt_date', from)
        .lte('goods_receipts.receipt_date', to);
      if (outletId) q = q.eq('goods_receipts.outlet_id', outletId);
      return q.range(dari, sampai);
    })
  ]);

  const perOutlet = new Map();
  const notaDipakai = new Set();
  for (const nRow of nota) {
    // Nota DIBATALKAN (0131) barangnya sudah ditarik — ikut menghitungnya
    // membuat barang masuk, dan karenanya HPP, lebih besar dari sebenarnya.
    if (nRow.status === 'dibatalkan') continue;
    notaDipakai.add(nRow.id);
    if (!perOutlet.has(nRow.outlet_id)) {
      perOutlet.set(nRow.outlet_id, { nilai: 0, barisTanpaHarga: 0, dok: [], bahan: [] });
    }
    const o = perOutlet.get(nRow.outlet_id);
    o.nilai += Number(nRow.total) || 0;
    o.barisTanpaHarga += Number(nRow.baris_tanpa_harga) || 0;
    o.dok.push({
      kode: nRow.code || '(tanpa nomor)',
      tanggal: nRow.receipt_date,
      dari: nRow.supplier || '-',
      nilai: Number(nRow.total) || 0
    });
  }

  for (const it of item) {
    // Baris milik nota yang dibatalkan dibuang di sini juga — kalau tidak,
    // rekap per bahan akan memuat barang yang totalnya tidak ikut dihitung,
    // dan dua bagian laporan yang sama jadi tidak sejalan.
    if (!notaDipakai.has(it.receipt_id)) continue;
    const oid = it.goods_receipts?.outlet_id;
    const o = perOutlet.get(oid);
    if (!o) continue;
    o.bahan.push({
      product_id: it.product_id,
      nama: it.products?.name ?? '',
      satuan: it.products?.base_unit ?? '',
      qty: Number(it.qty) || 0,
      nilai: Number(it.line_total ?? (Number(it.qty) || 0) * (Number(it.unit_cost) || 0)) || 0
    });
  }
  return perOutlet;
}

/** Pengeluaran kas SELAIN bahan, per outlet peruntukan. */
async function biayaNonBahanPerOutlet({ businessUnitId, outletId, from, to }) {
  const baris = await ambilSemua((dari, sampai) => {
    let q = supabase
      .from('cash_entries')
      // Kolomnya persis `KOLOM_DIBUTUHKAN` milik `jenis-pengeluaran.js`:
      // `untuk_nota` yang tidak ikut terbaca `undefined`, dan SELURUH
      // pembayaran nota akan terhitung sebagai "selain bahan".
      .select('id, entry_type, untuk_nota, penyesuaian_nota, amount, dicoret_at, notes, entry_date, outlet_id, cash_categories(name), outlets!outlet_id(business_unit_id)', {
        count: 'exact'
      })
      .eq('outlets.business_unit_id', businessUnitId)
      .gte('entry_date', from)
      .lte('entry_date', to);
    if (outletId) q = q.eq('outlet_id', outletId);
    return q.range(dari, sampai);
  });

  const perOutlet = new Map();
  for (const e of baris) {
    // Yang dicoret (0141) TIDAK ikut menjumlah — seluruh pembaca kas
    // menyaringnya, dan laporan yang tidak ikut akan berbeda dari layar Kas.
    if (e.dicoret_at) continue;
    if (!selainBahan(e)) continue;
    const oid = e.outlet_id;
    if (!oid) continue;
    if (!perOutlet.has(oid)) perOutlet.set(oid, { nilai: 0, dok: [] });
    const o = perOutlet.get(oid);
    const n = Number(e.amount) || 0;
    o.nilai += n;
    o.dok.push({
      tanggal: e.entry_date,
      kategori: e.cash_categories?.name ?? '-',
      keterangan: e.notes ?? '',
      nilai: n
    });
  }
  return perOutlet;
}

async function buildLabaRugiOutlet({ businessUnitId, outletId, from, to }) {
  let outletQ = supabase.from('outlets').select('id, name').eq('business_unit_id', businessUnitId).order('name');
  if (outletId) outletQ = outletQ.eq('id', outletId);
  const [outletRes, products, recipes] = await Promise.all([
    outletQ,
    listProducts(businessUnitId).catch(() => []),
    listRecipesFull(businessUnitId).catch(() => [])
  ]);
  if (outletRes.error) throw outletRes.error;
  const outlets = outletRes.data ?? [];
  const outletIds = outlets.map((o) => o.id);
  const hpp = computeCosts(products, recipes);

  // Stok awal = keadaan rak SEBELUM hari pertama. Memakai `from` sendiri akan
  // mengambil pergerakan hari itu sebagai stok awal, dan barang masuk hari
  // pertama terhitung dua kali.
  const sebelum = new Date(`${from}T00:00:00`);
  sebelum.setDate(sebelum.getDate() - 1);
  const hariSebelum = dateKey(sebelum);

  let salesQ = supabase
    .from('sales')
    .select('outlet_id, revenue')
    .eq('business_unit_id', businessUnitId)
    .gte('sale_date', from)
    .lte('sale_date', to)
    .limit(10000);
  if (outletId) salesQ = salesQ.eq('outlet_id', outletId);

  const [stokAwal, stokAkhir, petaAwal, petaAkhir, ck, kirimanDua, sup, biaya, salesRes] = await Promise.all([
    nilaiStokPerOutlet({ businessUnitId, outletId, tanggal: hariSebelum, hpp }),
    nilaiStokPerOutlet({ businessUnitId, outletId, tanggal: to, hpp }),
    opnameTerakhirPerOutlet({ businessUnitId, outletIds, sampai: hariSebelum }),
    opnameTerakhirPerOutlet({ businessUnitId, outletIds, sampai: to, sejak: from }),
    rincianKirimanMasuk({ businessUnitId, outletId, from, to, hpp }),
    nilaiKirimanPerOutlet({ businessUnitId, outletId, from, to, hpp }),
    rincianNotaSupplier({ businessUnitId, outletId, from, to }),
    biayaNonBahanPerOutlet({ businessUnitId, outletId, from, to }),
    salesQ
  ]);
  if (salesRes.error) throw salesRes.error;

  const omzet = new Map();
  for (const s of salesRes.data ?? []) {
    omzet.set(s.outlet_id, (omzet.get(s.outlet_id) ?? 0) + (Number(s.revenue) || 0));
  }

  const kosong = { nilai: 0, tanpaHpp: 0, jumlahItem: 0 };
  const baris = outlets.map((o) =>
    barisLabaRugi({
      outlet: o.name,
      outletId: o.id,
      stokAwal: stokAwal.get(o.id) ?? kosong,
      stokAkhir: stokAkhir.get(o.id) ?? kosong,
      masukCk: ck.get(o.id) ?? kosong,
      masukSupplier: sup.get(o.id) ?? { nilai: 0, barisTanpaHarga: 0 },
      keluarKiriman: kirimanDua.keluar.get(o.id) ?? kosong,
      omzet: omzet.get(o.id) ?? 0,
      biayaNonBahan: biaya.get(o.id)?.nilai ?? 0,
      opnameAwal: petaAwal.get(o.id) ? { tanggal: petaAwal.get(o.id).count_date } : null,
      opnameAkhir: petaAkhir.get(o.id) ? { tanggal: petaAkhir.get(o.id).count_date } : null
    })
  );
  const total = ringkasLabaRugi(baris);

  // ============ RINGKASAN BU, RINCIAN SAAT OUTLET DIPILIH ============
  //
  // Di tingkat BU laporannya satu baris per outlet supaya bisa dibandingkan.
  // Rincian dokumen & rekap bahan hanya digambar kalau SATU outlet dipilih —
  // enam outlet berincian penuh menghasilkan belasan halaman yang tidak
  // dibaca siapa pun.
  const rows = baris.map((b) => [
    b.outlet,
    rp(b.omzet),
    rp(b.awal),
    rp(b.nilaiCk),
    rp(b.nilaiSupplier),
    rp(b.keluar),
    rp(b.akhir),
    rp(b.hpp),
    persen(b.foodCostPersen),
    rp(b.labaKotor),
    rp(b.biayaNonBahan),
    rp(b.labaBersih),
    b.catatan
  ]);

  if (baris.length > 1) {
    rows.push([
      'TOTAL',
      rp(total.omzet),
      rp(total.awal),
      rp(total.nilaiCk),
      rp(total.nilaiSupplier),
      rp(total.keluar),
      rp(total.akhir),
      rp(total.hpp),
      persen(total.foodCostPersen),
      rp(total.labaKotor),
      rp(total.biayaNonBahan),
      rp(total.labaBersih),
      ''
    ]);
  }

  const bagian = [];
  if (outletId && baris.length === 1) {
    const o = baris[0];
    const dokCk = [...(ck.get(o.outletId)?.dok?.values() ?? [])].sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
    const dokSup = (sup.get(o.outletId)?.dok ?? []).sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
    const dokBiaya = (biaya.get(o.outletId)?.dok ?? []).sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
    const bahan = rekapPerBahan(ck.get(o.outletId)?.bahan ?? [], sup.get(o.outletId)?.bahan ?? []);

    bagian.push({
      judul: `Barang masuk dari Central Kitchen (${dokCk.length} surat jalan)`,
      columns: [
        { header: 'Tanggal Terima', width: 1 },
        { header: 'No. SJ', width: 1.2 },
        { header: 'Dari', width: 1.4 },
        { header: 'Item', width: 0.7, numeric: true },
        { header: 'Nilai (HPP)', width: 1.3, numeric: true }
      ],
      rows: dokCk.map((d) => [d.tanggal, d.kode, d.dari, d.item, rp(d.nilai)])
    });

    bagian.push({
      judul: `Barang masuk dari supplier (${dokSup.length} nota)`,
      columns: [
        { header: 'Tanggal Nota', width: 1 },
        { header: 'No. Nota', width: 1.2 },
        { header: 'Supplier', width: 1.6 },
        { header: 'Nilai', width: 1.3, numeric: true }
      ],
      rows: dokSup.map((d) => [d.tanggal, d.kode, d.dari, rp(d.nilai)])
    });

    bagian.push({
      judul: `Rekap barang masuk per bahan (${bahan.length} bahan)`,
      columns: [
        { header: 'Bahan', width: 1.8 },
        { header: 'Satuan', width: 0.7 },
        { header: 'Qty dari CK', width: 1, numeric: true },
        { header: 'Nilai CK', width: 1.2, numeric: true },
        { header: 'Qty Supplier', width: 1, numeric: true },
        { header: 'Nilai Supplier', width: 1.2, numeric: true },
        { header: 'Nilai Total', width: 1.3, numeric: true }
      ],
      rows: bahan.map((b) => [
        b.nama + (b.tanpaHpp ? ' (tanpa HPP)' : ''),
        b.satuan,
        b.qtyCk ? fnum(b.qtyCk) : '',
        b.nilaiCk ? rp(b.nilaiCk) : '',
        b.qtySupplier ? fnum(b.qtySupplier) : '',
        b.nilaiSupplier ? rp(b.nilaiSupplier) : '',
        rp(b.nilaiTotal)
      ])
    });

    bagian.push({
      judul: `Pengeluaran outlet selain bahan (${dokBiaya.length} entri)`,
      columns: [
        { header: 'Tanggal', width: 1 },
        { header: 'Kategori', width: 1.4 },
        { header: 'Keterangan', width: 2.4 },
        { header: 'Nilai', width: 1.3, numeric: true }
      ],
      rows: dokBiaya.map((d) => [d.tanggal, d.kategori, d.keterangan, rp(d.nilai)])
    });
  }

  return {
    columns: [
      { header: 'Outlet', width: 1.5 },
      { header: 'Penjualan', width: 1.3, numeric: true },
      { header: 'Stok Awal', width: 1.2, numeric: true },
      { header: 'Masuk CK', width: 1.2, numeric: true },
      { header: 'Masuk Supplier', width: 1.3, numeric: true },
      { header: 'Keluar (kirim)', width: 1.2, numeric: true },
      { header: 'Stok Akhir', width: 1.2, numeric: true },
      { header: 'HPP', width: 1.2, numeric: true },
      { header: 'Food Cost', width: 0.9 },
      { header: 'Laba Kotor', width: 1.3, numeric: true },
      { header: 'Biaya Lain', width: 1.2, numeric: true },
      { header: 'Laba Bersih', width: 1.3, numeric: true },
      { header: 'Catatan', width: 2 }
    ],
    rows,
    bagian,
    bold: baris.length > 1 ? [rows.length - 1] : [],
    summary: [
      { label: 'Penjualan', value: rp(total.omzet) },
      { label: 'Barang keluar (kiriman)', value: rp(total.keluar) },
      { label: 'HPP', value: rp(total.hpp) },
      { label: 'Food cost', value: persen(total.foodCostPersen) },
      { label: 'Laba kotor', value: rp(total.labaKotor) },
      { label: 'Biaya selain bahan', value: rp(total.biayaNonBahan) },
      { label: 'Laba bersih', value: rp(total.labaBersih) },
      { label: 'Dikunci opname', value: `${total.outletTerkunci}/${total.outletTotal} outlet` }
    ],
    note:
      `${pesanLabaRugi(total)} ` +
      'HPP = stok awal + barang masuk (CK + supplier) − barang KELUAR − stok akhir, yaitu barang yang ' +
      'BENAR-BENAR hilang dari ' +
      'rak — bukan HPP resep. Selisihnya terhadap laporan Laba Kotor adalah tumpahan, kelebihan takar, waste tak ' +
      'tercatat, dan kehilangan. ' +
      'Kiriman dinilai qty diterima × HPP pada TANGGAL TERIMA (bukan tanggal kirim) supaya cocok dengan saldo ' +
      'stok; nota supplier memakai harga notanya sendiri, dan nota yang dibatalkan tidak ikut. ' +
      'Kolom Keluar adalah kiriman yang DIKIRIM outlet ini — dikurangkan supaya barang yang dikirim Central ' +
      'Kitchen tidak terhitung sebagai barang yang dipakainya. Tanpa itu food cost CK terbaca ratusan persen dan ' +
      'total BU menghitung kiriman internal DUA KALI. Nilainya memakai qty DITERIMA, jadi susut di perjalanan ' +
      'tetap jadi beban pengirimnya. ' +
      'Biaya Lain = kas keluar yang BUKAN pembayaran nota bahan, menurut outlet peruntukannya; yang dicoret tidak ' +
      'ikut. Gaji/NBM TIDAK termasuk — lihat Rekap Penggajian. ' +
      (outletId
        ? ''
        : 'Pilih satu outlet untuk melihat rincian per dokumen dan rekap per bahan. ')
  };
}
