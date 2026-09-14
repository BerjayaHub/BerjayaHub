/**
 * RINCIAN SATU NOTA — susunan murninya.
 *
 * ============ KENAPA BERDIRI SENDIRI ============
 *
 * Nomor nota muncul di beberapa layar yang bukan modul Bahan: riwayat Kas
 * ("Pembayaran nota TRM-260912-56F0"), laporan mutasi kas, dan nanti mungkin
 * lainnya. Kalau tiap layar menyusun rinciannya sendiri, cepat atau lambat dua
 * layar menampilkan TOTAL YANG BERBEDA untuk nota yang sama — dan yang
 * membacanya tidak punya cara tahu mana yang benar.
 *
 * Berkas ini menyusunnya sekali. Yang mengambil data dan menggambar dialognya
 * ada di `nota-dialog.js`; yang di sini bisa diuji tanpa browser.
 *
 * ============ HARGA BARIS, BUKAN HARGA SATUAN x JUMLAH ============
 *
 * Nilainya lewat `hargaBeliBaris()` — `line_total` dulu, sama seperti
 * `nota_ringkas` di server. Mengalikan balik dari `unit_cost` meleset ribuan
 * rupiah pada qty yang tidak membagi habis, dan selisih itu baru terlihat saat
 * orang menyandingkan layar ini dengan nominal yang benar-benar dibayarkan.
 *
 * ============ BARIS TANPA HARGA ============
 *
 * Ditulis "-", bukan Rp0, dan jumlahnya disebut. Nota yang totalnya rapi tapi
 * lebih kecil dari tagihan supplier adalah persis bentuk kegagalan yang paling
 * sering lolos di aplikasi ini.
 */

import { formatNum, formatRupiah } from '../../core/format.js';
import { hargaBeliBaris, hargaSatuanBaris } from './harga-baris.js';

export const STATUS_BATAL = 'dibatalkan';

export const KOLOM_RINCIAN_NOTA = [
  { header: 'Bahan' },
  { header: 'Jumlah', numeric: true },
  { header: 'Satuan' },
  { header: 'Harga/satuan', numeric: true },
  { header: 'Harga beli', numeric: true }
];

const teks = (v) => (v === null || v === undefined ? '' : String(v));

const LABEL_BAYAR = { lunas: 'Lunas', belum: 'Belum dibayar', batal: 'Batal' };
const LABEL_SUMBER = { kas: 'Kas', pusat: 'Dibayar Pusat' };

function fmtTanggal(d) {
  if (!d) return '';
  const t = new Date(`${d}T00:00:00`);
  if (Number.isNaN(t.getTime())) return teks(d);
  return t.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * @param {object} o
 * @param {object} o.nota baris `goods_receipts` (code, receipt_date, supplier,
 *   invoice_no, status, payment_status, payment_source, notes, photo_path,
 *   outlets{name})
 * @param {object[]} o.items baris `goods_receipt_items` (+ products{name, base_unit})
 * @param {Map<string, number>} [o.hpp] cadangan harga terakhir per product_id
 */
export function susunRincianNota({ nota, items, hpp = new Map() } = {}) {
  const n = nota ?? {};
  const daftar = Array.isArray(items) ? items : [];

  let total = 0;
  let adaNilai = false;
  let tanpaHarga = 0;

  const baris = daftar
    .map((it) => {
      const nilai = hargaBeliBaris(it, hpp);
      const satuan = hargaSatuanBaris(it, hpp);
      if (nilai === null) tanpaHarga++;
      else {
        total += nilai;
        adaNilai = true;
      }
      return {
        // Produk yang sudah dihapus dari master TETAP MUNCUL: barangnya pernah
        // benar-benar masuk dan uangnya benar-benar keluar.
        bahan: teks(it?.products?.name) || '(produk terhapus)',
        qty: Number(it?.qty ?? 0) || 0,
        base: teks(it?.products?.base_unit),
        satuan,
        nilai,
        catatan: teks(it?.notes)
      };
    })
    .sort((a, b) => a.bahan.localeCompare(b.bahan, 'id'));

  const rows = baris.map((b) => [
    b.catatan ? `${b.bahan} — ${b.catatan}` : b.bahan,
    formatNum(b.qty),
    b.base || '-',
    b.satuan === null ? '-' : formatRupiah(b.satuan),
    b.nilai === null ? '-' : formatRupiah(b.nilai)
  ]);

  const batal = n.status === STATUS_BATAL;

  // Baris keterangan yang KOSONG dibuang, bukan ditulis "-". Di dialog sempit,
  // deretan "-" membuat yang benar-benar terisi jadi sulit ditemukan.
  const info = [
    { label: 'Tanggal nota', value: fmtTanggal(n.receipt_date) },
    { label: 'Supplier', value: teks(n.supplier) },
    { label: 'No. invoice', value: teks(n.invoice_no) },
    { label: 'Outlet', value: teks(n.outlets?.name) },
    {
      label: 'Status bayar',
      value: [LABEL_BAYAR[n.payment_status] ?? teks(n.payment_status), LABEL_SUMBER[n.payment_source] ?? '']
        .filter(Boolean)
        .join(' · ')
    },
    { label: 'Catatan', value: teks(n.notes) }
  ].filter((r) => r.value);

  return {
    judul: `Nota ${teks(n.code) || '(tanpa nomor)'}`,
    kode: teks(n.code),
    batal,
    alasanBatal: batal ? teks(n.alasan_batal) : '',
    info,
    kolom: KOLOM_RINCIAN_NOTA,
    rows,
    jumlahBaris: rows.length,
    tanpaHarga,
    total,
    // Nota yang SELURUH barisnya belum berharga ditulis "-", bukan Rp0: nol
    // berarti barangnya gratis, dan itu keterangan yang berbeda.
    totalTeks: adaNilai ? formatRupiah(total) : '-',
    adaFoto: !!teks(n.photo_path),
    photoPath: teks(n.photo_path)
  };
}
