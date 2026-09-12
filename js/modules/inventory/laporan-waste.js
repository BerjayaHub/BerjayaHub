/**
 * REKAP WASTE / SPOIL satu rentang tanggal — satu baris per BAHAN.
 *
 * ============ KETERANGANNYA YANG JADI INTI ============
 *
 *   "tambahkan juga keterangan yang berisi jika spoil dalam bentuk bahan mentah
 *    maka keterangan berisi bahan mentah, jika waste dalam bentuk menu, maka
 *    bahan yang waste sesuai resep menu yang di waste keterangannya waste menu
 *    apa"
 *
 * Tanpa kolom itu, rekapnya memuat baris "Beras 1,2 kg" tanpa cara apa pun
 * membedakan dua kejadian yang sepenuhnya berbeda artinya:
 *
 *   beras karungan kena air        -> masalah penyimpanan
 *   2 porsi nasi goreng gosong     -> masalah dapur
 *
 * Keduanya memotong stok beras, dan keduanya menuntut tindakan yang berbeda.
 * Rekap yang tidak bisa memisahkannya tidak menolong siapa pun.
 *
 * ============ KENAPA SATU BARIS PER BAHAN ============
 *
 * Karena itu satuan yang sama dengan cara stoknya berkurang, dan satu-satunya
 * bentuk yang bisa dipivot: "bulan ini beras terbuang berapa kilo, dari spoil
 * atau dari menu?" Satu baris per kejadian akan mengubur bahannya di dalam teks.
 *
 * ============ NILAI RUPIAHNYA BOLEH KOSONG ============
 *
 * Biaya rata-rata (`0118`) hanya ada untuk bahan yang pernah dibeli lewat nota
 * di outlet itu. Bahan yang belum pernah masuk lewat nota TIDAK punya angka —
 * dan angkanya ditulis "-" , bukan Rp0. Rp0 membuat total kerugian terlihat
 * lebih kecil daripada yang sebenarnya, dan itu tidak akan tampak salah.
 *
 * Tidak ada impor dari layar di berkas ini, supaya bisa diuji tanpa browser.
 */

import { formatNum, formatRupiah } from '../../core/format.js';

export const JENIS_SPOIL = 'spoil';
export const JENIS_MENU = 'menu';

/** Keterangan untuk bahan yang hilang karena SPOIL bahan mentah. */
export const KET_BAHAN_MENTAH = 'Bahan mentah';

/**
 * `foto: true` menandai kolom yang gambarnya disisipkan ke sel oleh
 * `core/xlsx-foto.js`. Di layar, kolom yang sama digambar sebagai tombol.
 */
export const KOLOM_WASTE = [
  { header: 'Tanggal', width: 1 },
  { header: 'Outlet', width: 1.4 },
  { header: 'Bahan', width: 2 },
  { header: 'Jumlah', width: 0.9, align: 'right', numeric: true },
  { header: 'Satuan', width: 0.7 },
  { header: 'Nilai', width: 1.2, align: 'right', numeric: true },
  { header: 'Keterangan', width: 2.2 },
  { header: 'Catatan', width: 1.8 },
  { header: 'Dicatat oleh', width: 1.4 },
  { header: 'No.', width: 1.3 },
  { header: 'Foto', width: 1.6, foto: true }
];

/** Posisi kolom foto — dipakai layar & ekspor supaya tidak dihitung dua kali. */
export const KOLOM_FOTO = KOLOM_WASTE.findIndex((k) => k.foto);

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Keterangan satu baris rekap.
 *
 * Dipisah dan diekspor supaya bisa diuji sendiri: inilah satu-satunya bagian
 * yang membawa arti, dan satu-satunya yang bisa salah tanpa terlihat salah.
 *
 * @param {{jenis?: string, sumber_nama?: string, qty_kejadian?: number}} baris
 */
export function keteranganWaste(baris) {
  if (baris?.jenis === JENIS_MENU) {
    const nama = teks(baris.sumber_nama) || '(menu terhapus)';
    const porsi = Number(baris.qty_kejadian ?? 0);
    // Jumlah porsinya ikut disebut. "Waste menu Nasi Goreng" tidak memberi tahu
    // apakah beras 1,2 kg itu dari dua porsi atau dua puluh — dan itu justru
    // yang menentukan apakah angkanya masuk akal.
    return porsi > 0 ? `Waste menu ${nama} × ${formatNum(porsi)}` : `Waste menu ${nama}`;
  }
  return KET_BAHAN_MENTAH;
}

/** Kunci biaya rata-rata: biayanya berbeda PER OUTLET (0118). */
export function kunciBiaya(outletId, productId) {
  return `${teks(outletId)}|${teks(productId)}`;
}

/**
 * @param {object} o
 * @param {object[]} o.baris baris view `waste_rekap`
 * @param {Map<string, number>} [o.biaya] kunciBiaya() -> rata per satuan
 * @param {{dari?: string, sampai?: string, outlet?: string}} [o.periode]
 */
export function susunRekapWaste({ baris, biaya = new Map(), periode = {} } = {}) {
  const daftar = Array.isArray(baris) ? baris : [];

  let total = 0;
  let tanpaNilai = 0;
  let barisLama = 0;
  const kejadian = new Set();

  const mentah = daftar.map((b) => {
    const qty = Number(b?.bahan_qty ?? 0) || 0;
    const rata = biaya instanceof Map ? biaya.get(kunciBiaya(b?.outlet_id, b?.product_id)) : undefined;
    // `??` dan bukan `||`: biaya 0 adalah angka yang sah (bahan bonus) dan tidak
    // boleh terbaca sebagai "belum punya harga".
    const satuan = rata === null || rata === undefined ? null : Number(rata);
    const nilai = satuan === null || !Number.isFinite(satuan) ? null : satuan * qty;
    if (nilai === null) tanpaNilai++;
    else total += nilai;
    if (b?.waste_id) kejadian.add(b.waste_id);
    if (b?.lama) barisLama++;

    return {
      wasteId: teks(b?.waste_id),
      photoPath: teks(b?.photo_path),
      // Dicatat SEBELUM foto diwajibkan (0136). Bedanya penting di layar:
      // "belum ada foto" menuduh staffnya lupa; "sebelum foto diwajibkan"
      // menyatakan apa yang sebenarnya terjadi.
      lama: b?.lama === true,
      tanggal: teks(b?.tanggal),
      outlet: teks(b?.outlet_nama),
      bahan: teks(b?.bahan_nama) || '(produk terhapus)',
      satuanNama: teks(b?.bahan_satuan),
      qty,
      nilai,
      keterangan: keteranganWaste(b),
      catatan: teks(b?.notes),
      oleh: teks(b?.dicatat_oleh),
      kode: teks(b?.code)
    };
  });

  // Urut tanggal TERBARU dulu — rekap waste dibaca untuk menindaklanjuti, dan
  // yang perlu ditindaklanjuti adalah yang baru terjadi.
  mentah.sort(
    (a, b) =>
      b.tanggal.localeCompare(a.tanggal) ||
      a.outlet.localeCompare(b.outlet, 'id') ||
      a.bahan.localeCompare(b.bahan, 'id')
  );

  const rows = mentah.map((r) => [
    r.tanggal,
    r.outlet,
    r.bahan,
    formatNum(r.qty),
    r.satuanNama,
    r.nilai === null ? '-' : formatRupiah(r.nilai),
    r.keterangan,
    r.catatan,
    r.oleh,
    r.kode,
    // Sel foto diisi belakangan oleh layar: modul murni tidak boleh menyentuh
    // jaringan, dan mengubah path jadi data URL berarti mengunduh gambarnya.
    null
  ]);

  const dari = teks(periode.dari);
  const sampai = teks(periode.sampai);
  const rentang = dari && sampai ? `${dari} s/d ${sampai}` : dari || sampai || '';

  const subjudul = [
    teks(periode.outlet) || 'Semua outlet',
    rentang,
    `${kejadian.size} kejadian`,
    `${rows.length} baris bahan`,
    `Total ${formatRupiah(total)}`,
    tanpaNilai ? `${tanpaNilai} baris belum punya biaya rata-rata` : '',
    barisLama ? `${barisLama} baris dicatat sebelum foto diwajibkan` : ''
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    judul: 'Rekap Waste / Spoil',
    subjudul,
    namaBerkas: `waste-spoil-${(rentang || 'semua').replace(/[^\w.-]+/g, '-')}`,
    kolom: KOLOM_WASTE,
    baris: rows,
    // Sejajar indeksnya dengan `baris` — layar memakainya untuk memuat foto.
    meta: mentah.map((r) => ({ wasteId: r.wasteId, photoPath: r.photoPath, lama: r.lama })),
    ringkas: {
      jumlahKejadian: kejadian.size,
      jumlahBaris: rows.length,
      tanpaNilai,
      barisLama,
      total,
      totalTeks: formatRupiah(total)
    }
  };
}
