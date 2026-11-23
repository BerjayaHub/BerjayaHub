/**
 * MEMBACA EKSPOR "DETAILED PURCHASE ORDERS" DARI TURBOLY.
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase, tidak membaca berkas.
 *
 * ============ KENAPA BERKAS INI YANG DIPAKAI, BUKAN SUMMARY PO ============
 *
 * Summary Purchase Orders berisi satu baris per PO: supplier, total qty,
 * total rupiah. Ia tidak bisa menjawab "part ini dibeli dari siapa", karena
 * satu PO berisi puluhan part berbeda. Berkas ini berisi satu baris per
 * BARANG, lengkap dengan `SKU` — dan SKU itulah yang menyambungkannya ke
 * penjualan.
 *
 * ============ TIGA HAL YANG BERBEDA DARI EKSPOR PENJUALAN ============
 *
 *   1. TIDAK ADA KOLOM STORE/WAREHOUSE YANG TERISI. Ekspor penjualan membawa
 *      `Store` di tiap baris; di sini `Warehouse` dan `Deliver To` kosong, dan
 *      nomor PO-nya berawalan `PO/HO/` — pembelian memang terpusat. Jadi
 *      pembelian disimpan di tingkat BU, bukan outlet. Menebak outletnya dari
 *      supplier atau dari urutan berkas akan menaruh pembelian Malang di
 *      Cibubur tanpa satu pun tanda.
 *
 *   2. TANGGALNYA `Sent At` — tanggal PO dikirim ke supplier, bukan tanggal
 *      barangnya diterima. Untuk mencocokkan "dibeli lalu terpakai", yang
 *      dipakai tetap tanggal ini, dan laporannya menyebut namanya apa adanya.
 *      Menyebutnya "tanggal terima" akan membuat orang mengira barangnya sudah
 *      di rak pada hari itu.
 *
 *   3. HARGANYA BISA NOL. Pada ekspor contoh, `Price (Rp)` dan `Total (Rp)`
 *      nol di SELURUH baris, padahal summary PO untuk periode yang sama
 *      menunjukkan nilai jutaan. Jadi nol di sini TIDAK berarti gratis — ia
 *      berarti "tidak ikut keluar di ekspor ini". Keduanya dibedakan:
 *      `harga === null` untuk sel kosong, dan baris berharga nol dihitung
 *      tersendiri supaya layar bisa mengatakannya sebelum ada yang memakai
 *      angkanya.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());
const rapat = (v) => teks(v).replace(/\s+/g, ' ');

export { angka } from './baca-invoice-turboly.js';
import { angka as keAngka } from './baca-invoice-turboly.js';

export const KOLOM_WAJIB_PO = ['Sent At', 'Order', 'Supplier Name', 'SKU', 'Qty'];

export const PETA_KOLOM_PO = {
  'Sent At': 'tanggal',
  Sender: 'pengirim',
  Order: 'po_no',
  Status: 'status',
  'Supplier Name': 'supplier',
  'Supplier Code': 'supplier_kode',
  'Reference No': 'referensi',
  SKU: 'sku',
  Name: 'nama',
  'Product Type': 'product_type',
  'Product Code': 'product_code',
  Qty: 'qty',
  'Price (Rp)': 'harga',
  'Total (Rp)': 'total',
  Warehouse: 'warehouse',
  'Deliver To': 'kirim_ke'
};

export const MASALAH_PO = {
  TANPA_PO: 'tanpa-po',
  TANPA_TANGGAL: 'tanpa-tanggal',
  TANPA_SKU: 'tanpa-sku',
  QTY_TIDAK_SAH: 'qty-tidak-sah'
};

export const PESAN_MASALAH_PO = {
  [MASALAH_PO.TANPA_PO]: 'Baris tanpa nomor PO.',
  [MASALAH_PO.TANPA_TANGGAL]: 'Baris tanpa tanggal (Sent At).',
  // SKU adalah satu-satunya penyambung ke penjualan. Baris tanpa SKU boleh
  // saja benar sebagai catatan pembelian, tapi ia tidak akan pernah bisa
  // dicocokkan — dan itu harus dikatakan, bukan didiamkan.
  [MASALAH_PO.TANPA_SKU]: 'Baris tanpa SKU — tidak bisa dicocokkan dengan penjualan.',
  [MASALAH_PO.QTY_TIDAK_SAH]: 'Qty kosong atau bukan angka.'
};

/** Keterangan di atas header: supplier, warehouse, status, waktu unduh. */
export function bacaPengantarPo(baris) {
  const hasil = { supplier: '', warehouse: '', status: '', diunduh: '' };
  for (const r of Array.isArray(baris) ? baris.slice(0, 40) : []) {
    const sel = teks(r?.[0]);
    const ambil = (awalan) => (sel.toLowerCase().startsWith(awalan) ? sel.slice(awalan.length).trim() : null);
    const s = ambil('supplier:');
    if (s !== null) hasil.supplier = s;
    const w = ambil('warehouse:');
    if (w !== null) hasil.warehouse = w;
    const st = ambil('status:');
    if (st !== null) hasil.status = st;
    const u = ambil('downloaded at:');
    if (u !== null) hasil.diunduh = u;
  }
  return hasil;
}

/**
 * Cari baris header.
 *
 * Dikenali dari gabungan 'Order' + 'SKU' + 'Supplier Name' — bukan dari nomor
 * barisnya: jumlah baris pengantar berubah mengikuti saringan yang dipakai
 * saat mengekspor.
 */
export function cariHeaderPo(baris) {
  const daftar = Array.isArray(baris) ? baris : [];
  for (let i = 0; i < daftar.length; i++) {
    const sel = (daftar[i] ?? []).map((x) => rapat(x));
    if (sel.includes('Order') && sel.includes('SKU') && sel.includes('Supplier Name')) {
      const peta = new Map();
      sel.forEach((nama, kolom) => {
        if (nama && !peta.has(nama)) peta.set(nama, kolom);
      });
      return { baris: i, peta };
    }
  }
  return null;
}

/**
 * Baca seluruh berkas jadi baris pembelian.
 *
 * Tidak dikelompokkan per PO: yang dipakai mencocokkan adalah BARIS BARANG,
 * dan satu PO bisa memuat part yang terpakai di lima mobil berbeda pada lima
 * hari berbeda. Nomor PO tetap ikut di tiap baris supaya bisa ditelusuri.
 */
export function bacaEksporPo(baris) {
  const daftar = Array.isArray(baris) ? baris : [];
  const pengantar = bacaPengantarPo(daftar);
  const kosong = { pengantar, baris: [], ditolak: [], ringkas: ringkasKosong(), galat: '' };

  const header = cariHeaderPo(daftar);
  if (!header) {
    return {
      ...kosong,
      galat: 'Baris header tidak ketemu. Pastikan ini berkas "Detailed Purchase Orders" dari Turboly — bukan "Summary Purchase Orders", yang isinya satu baris per PO tanpa rincian barang.'
    };
  }

  const hilang = KOLOM_WAJIB_PO.filter((k) => !header.peta.has(k));
  if (hilang.length) {
    return { ...kosong, galat: `Kolom wajib tidak ada: ${hilang.join(', ')}. Ekspor ulang dengan kolom lengkap.` };
  }

  const ambil = (r, nama) => {
    const k = header.peta.get(nama);
    return k === undefined ? undefined : r[k];
  };

  const ditolak = [];
  const hasil = [];
  for (let i = header.baris + 1; i < daftar.length; i++) {
    const r = daftar[i] ?? [];
    if (r.every((c) => teks(c) === '')) continue;

    const isi = {};
    for (const [kolom, bidang] of Object.entries(PETA_KOLOM_PO)) {
      const v = ambil(r, kolom);
      if (v === undefined) continue;
      isi[bidang] = ['qty', 'harga', 'total'].includes(bidang) ? keAngka(v) : rapat(v);
    }
    isi.nomor_berkas = i - header.baris;

    const sebab = periksaBarisPo(isi);
    if (sebab) {
      ditolak.push({ nomor: isi.nomor_berkas, sebab, isi });
      continue;
    }
    hasil.push(isi);
  }

  return { pengantar, baris: hasil, ditolak, ringkas: ringkasPo(hasil, ditolak), galat: '' };
}

function periksaBarisPo(isi) {
  if (!isi.po_no) return MASALAH_PO.TANPA_PO;
  if (!isi.tanggal) return MASALAH_PO.TANPA_TANGGAL;
  if (isi.qty === null || isi.qty === undefined) return MASALAH_PO.QTY_TIDAK_SAH;
  // SKU kosong TIDAK menolak barisnya — pembeliannya tetap nyata dan tetap
  // perlu tercatat. Ia hanya tidak akan pernah ikut dicocokkan, dan itu
  // dihitung tersendiri di ringkasannya.
  return '';
}

function ringkasKosong() {
  return { baris: 0, po: 0, qty: 0, nilai: 0, tanpaSku: 0, tanpaHarga: 0, hargaNol: 0, supplier: [], dari: '', sampai: '', ditolak: 0 };
}

export function ringkasPo(baris, ditolak = []) {
  const r = ringkasKosong();
  const po = new Set();
  const supplier = new Set();
  const tanggal = [];
  for (const b of baris ?? []) {
    r.baris += 1;
    if (b.po_no) po.add(b.po_no);
    if (b.supplier) supplier.add(b.supplier);
    if (b.tanggal) tanggal.push(b.tanggal);
    r.qty += Number(b.qty) || 0;
    if (!b.sku) r.tanpaSku += 1;

    // ============ NOL BUKAN KOSONG, DAN KEDUANYA BUKAN HARGA ============
    //
    // Pada ekspor contoh, SELURUH barisnya berharga 0 sementara summary PO
    // untuk periode yang sama bernilai jutaan. Jadi 0 di sini berarti
    // "harganya tidak ikut keluar", bukan "barangnya gratis" — dan layar
    // harus bisa mengatakannya sebelum ada yang memakai angkanya.
    if (b.harga === null || b.harga === undefined) r.tanpaHarga += 1;
    else if (Number(b.harga) === 0) r.hargaNol += 1;

    const nilai = b.total === null || b.total === undefined ? (Number(b.harga) || 0) * (Number(b.qty) || 0) : Number(b.total) || 0;
    r.nilai += nilai;
  }
  r.po = po.size;
  r.supplier = [...supplier].sort();
  r.ditolak = (ditolak ?? []).length;
  const urut = tanggal.slice().sort();
  r.dari = urut[0] ?? '';
  r.sampai = urut[urut.length - 1] ?? '';
  return r;
}

/**
 * Apakah seluruh berkasnya berharga nol?
 *
 * Dipisah jadi pertanyaan tersendiri karena jawabannya menentukan apa yang
 * boleh dijanjikan laporan. Satu-dua baris nol itu wajar (barang garansi,
 * sampel). SELURUHNYA nol berarti harganya memang tidak ikut terekspor, dan
 * laporan yang menampilkan kolom "Harga Beli" dari berkas itu akan berisi nol
 * yang terlihat seperti fakta.
 */
export function semuaHarganyaNol(ringkas) {
  if (!ringkas || !ringkas.baris) return false;
  return ringkas.hargaNol + ringkas.tanpaHarga === ringkas.baris;
}

/** Bentuk yang dikirim ke RPC. */
export function poUntukRpc(baris) {
  return (baris ?? []).map((b) => ({
    po_no: b.po_no,
    tanggal: b.tanggal,
    supplier: b.supplier ?? '',
    supplier_kode: b.supplier_kode ?? '',
    referensi: b.referensi ?? '',
    status: b.status ?? '',
    pengirim: b.pengirim ?? '',
    sku: b.sku ?? '',
    nama: b.nama ?? '',
    product_type: b.product_type ?? '',
    product_code: b.product_code ?? '',
    qty: b.qty ?? 0,
    // `null` dipertahankan: sel kosong dan nol adalah dua hal berbeda, dan
    // yang membedakannya cuma ini.
    harga: b.harga === undefined ? null : b.harga,
    total: b.total === undefined ? null : b.total
  }));
}
