/**
 * BAHAN MASUK SATU RENTANG TANGGAL — rincian + rekap.
 *
 * ============ YANG DIMINTA ============
 *
 *   "sediakan export excel per range tanggal, jadi admin bisa export bahan apa
 *    saja yang masuk sesuai range tanggal yang dipilih tanpa export satu satu
 *    per nota ... tanggal, bahan, qty, harga beli per bahan (bukan harga per
 *    satuan terkecil), supplier"
 *
 * Sebelumnya satu-satunya jalan adalah membuka rincian tiap nota lalu menekan
 * "Unduh Excel" — 43 berkas untuk sepuluh hari, lalu menyalin-tempel semuanya
 * jadi satu. Pekerjaan yang bukan cuma lama, tapi juga punya cara gagal sendiri:
 * satu nota terlewat tidak meninggalkan jejak apa pun di hasil gabungannya.
 *
 * ============ DUA SHEET, DAN KENAPA BUKAN SATU ============
 *
 * RINCIAN menjawab "beras dari siapa, kapan, berapa" — satu baris per bahan per
 * nota, bisa ditelusuri balik ke nomor notanya.
 *
 * REKAP menjawab "bulan ini beras masuk berapa kilo dan habis berapa" — satu
 * baris per bahan. Bisa saja dibuat sendiri dengan pivot, tapi pertanyaan itu
 * yang paling sering ditanyakan dan tidak semua orang membuat pivot.
 *
 * ============ NOTA BATAL TIDAK IKUT ============
 *
 * Nota yang dibatalkan (`0131`) barangnya sudah ditarik dari stok. Ikut
 * menghitungnya membuat total pembelian lebih besar daripada yang sebenarnya —
 * dan itu tidak akan tampak salah, karena angkanya tetap masuk akal.
 *
 * Jumlah yang dibuang TETAP DISEBUT di subjudulnya. Penyaringan yang diam
 * membuat orang mengira ada nota yang hilang.
 *
 * ============ BARIS TANPA HARGA ============
 *
 * Ditulis "-", bukan 0, dan JUMLAHNYA dilaporkan di rekap per bahan. Kegagalan
 * yang paling mungkin lolos di sini adalah total yang rapi tapi lebih kecil
 * dari seharusnya, karena beberapa baris belum sempat diisi harganya.
 */

import { formatNum, formatRupiah } from '../../core/format.js';
import { hargaBeliBaris } from './harga-baris.js';

/** Status nota yang barangnya sudah ditarik kembali (0131). */
export const STATUS_BATAL = 'dibatalkan';

/**
 * `Jumlah` DITANDAI numeric di sini, berbeda dengan `KOLOM_NOTA`.
 *
 * Bukan kelalaian. Laporan per nota dibaca seperti kuitansi; berkas ini adalah
 * EKSTRAK DATA — yang membukanya akan mem-pivot per bahan, dan kolom teks tidak
 * bisa dipivot. `keAngka` di `core/xlsx.js` sudah menangani "1.200" dan "12,5".
 */
export const KOLOM_BAHAN_MASUK = [
  { header: 'Tanggal', width: 1 },
  { header: 'No. Nota', width: 1.5 },
  { header: 'Outlet', width: 1.5 },
  { header: 'Bahan', width: 2.2 },
  { header: 'Jumlah', width: 0.9, align: 'right', numeric: true },
  { header: 'Satuan', width: 0.7 },
  { header: 'Harga beli', width: 1.2, align: 'right', numeric: true },
  { header: 'Supplier', width: 1.8 }
];

export const KOLOM_REKAP_BAHAN = [
  { header: 'Bahan', width: 2.2 },
  { header: 'Total jumlah', width: 1, align: 'right', numeric: true },
  { header: 'Satuan', width: 0.7 },
  { header: 'Total harga beli', width: 1.3, align: 'right', numeric: true },
  { header: 'Jumlah nota', width: 0.9, align: 'right', numeric: true },
  { header: 'Baris tanpa harga', width: 1, align: 'right', numeric: true },
  { header: 'Supplier', width: 2.4 }
];

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * @param {object} o
 * @param {object[]} o.notas baris `goods_receipts` (butuh id, code, receipt_date,
 *   supplier, status, outlets.name)
 * @param {object[]} o.items baris `goods_receipt_items` DATAR dari banyak nota
 *   (butuh receipt_id, product_id, qty, line_total, unit_cost, products{name, base_unit})
 * @param {Map<string, number>} [o.hpp] cadangan harga terakhir
 * @param {{dari?: string, sampai?: string, outlet?: string}} [o.periode]
 */
export function susunBahanMasuk({ notas, items, hpp = new Map(), periode = {} } = {}) {
  const daftarNota = Array.isArray(notas) ? notas : [];
  const daftarItem = Array.isArray(items) ? items : [];

  // Nota batal disaring DI SINI, sekali, lalu itemnya ikut terbuang sendiri
  // karena tidak menemukan induknya. Menyaring di dua tempat membuka peluang
  // keduanya menyimpang.
  const indukDipakai = new Map();
  let notaBatal = 0;
  for (const n of daftarNota) {
    if (!n?.id) continue;
    if (n.status === STATUS_BATAL) {
      notaBatal++;
      continue;
    }
    indukDipakai.set(n.id, n);
  }

  let total = 0;
  let barisTanpaHarga = 0;
  const mentah = [];

  for (const it of daftarItem) {
    const nota = indukDipakai.get(it?.receipt_id);
    // Item tanpa induk: milik nota batal, atau milik nota di luar rentang yang
    // kebetulan ikut terambil. Dibuang diam-diam TIDAK berbahaya di sini,
    // karena nota batalnya sendiri sudah dihitung dan disebut.
    if (!nota) continue;

    const nilai = hargaBeliBaris(it, hpp);
    if (nilai === null) barisTanpaHarga++;
    else total += nilai;

    mentah.push({
      receiptId: nota.id,
      tanggal: teks(nota.receipt_date),
      kode: teks(nota.code),
      outlet: teks(nota.outlets?.name),
      // Produk yang sudah dihapus dari master TETAP MUNCUL. Barangnya pernah
      // benar-benar masuk dan uangnya benar-benar keluar; membuangnya dari
      // laporan pembelian membuat totalnya tidak cocok dengan tagihan.
      kunci: teks(it.product_id) || `nama:${teks(it.products?.name)}`,
      bahan: teks(it.products?.name) || '(produk terhapus)',
      satuan: teks(it.products?.base_unit),
      qty: Number(it.qty ?? 0) || 0,
      nilai,
      supplier: teks(nota.supplier)
    });
  }

  // Urut tanggal, lalu nomor nota, lalu nama bahan — urutan yang sama dengan
  // cara orang membaca tumpukan nota fisik di mejanya.
  mentah.sort(
    (a, b) =>
      a.tanggal.localeCompare(b.tanggal) ||
      a.kode.localeCompare(b.kode) ||
      a.bahan.localeCompare(b.bahan, 'id')
  );

  const rincian = mentah.map((r) => [
    r.tanggal,
    r.kode,
    r.outlet,
    r.bahan,
    formatNum(r.qty),
    r.satuan,
    r.nilai === null ? '-' : formatRupiah(r.nilai),
    r.supplier
  ]);

  // ---- Rekap per bahan ----
  const kelompok = new Map();
  for (const r of mentah) {
    let g = kelompok.get(r.kunci);
    if (!g) {
      g = { bahan: r.bahan, satuan: r.satuan, qty: 0, nilai: 0, adaNilai: false, tanpaHarga: 0, notas: new Set(), suppliers: new Set() };
      kelompok.set(r.kunci, g);
    }
    g.qty += r.qty;
    if (r.nilai === null) g.tanpaHarga++;
    else {
      g.nilai += r.nilai;
      g.adaNilai = true;
    }
    g.notas.add(r.receiptId);
    if (r.supplier) g.suppliers.add(r.supplier);
  }

  const rekap = [...kelompok.values()]
    .sort((a, b) => b.nilai - a.nilai || a.bahan.localeCompare(b.bahan, 'id'))
    .map((g) => [
      g.bahan,
      formatNum(g.qty),
      g.satuan,
      // Bahan yang SELURUH barisnya belum berharga ditulis "-", bukan Rp0 —
      // sebab yang sama dengan di rincian.
      g.adaNilai ? formatRupiah(g.nilai) : '-',
      String(g.notas.size),
      String(g.tanpaHarga),
      [...g.suppliers].sort((a, b) => a.localeCompare(b, 'id')).join(', ')
    ]);

  const dari = teks(periode.dari);
  const sampai = teks(periode.sampai);
  const rentang = dari && sampai ? `${dari} s/d ${sampai}` : dari || sampai || '';

  const subjudul = [
    teks(periode.outlet) || 'Semua outlet',
    rentang,
    `${indukDipakai.size} nota`,
    `${rincian.length} baris`,
    `${rekap.length} bahan`,
    `Total ${formatRupiah(total)}`,
    notaBatal ? `${notaBatal} nota batal tidak diikutkan` : '',
    barisTanpaHarga ? `${barisTanpaHarga} baris belum berharga` : ''
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    judul: 'Bahan Masuk dari Supplier',
    subjudul,
    namaBerkas: `bahan-masuk-${(rentang || 'semua').replace(/[^\w.-]+/g, '-')}`,
    kolomRincian: KOLOM_BAHAN_MASUK,
    rincian,
    kolomRekap: KOLOM_REKAP_BAHAN,
    rekap,
    ringkas: {
      jumlahNota: indukDipakai.size,
      jumlahBaris: rincian.length,
      jumlahBahan: rekap.length,
      notaBatal,
      barisTanpaHarga,
      total,
      totalTeks: formatRupiah(total)
    }
  };
}
