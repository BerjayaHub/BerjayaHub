/**
 * Ekspor **kas keluar** Berjaya Hub ke template **ESB Disbursement**.
 *
 * ============ BENTUK TEMPLATENYA ============
 *
 * Delapan belas kolom, header di BARIS 1 — sama dengan Simple Purchase &
 * Simple Transfer, berbeda dari Item Journal yang menaruhnya di baris ke-3.
 *
 *   Sequence | Payment To | Supplier Bank Account Number | Document Date |
 *   Branch | Cost Center | Project | Payment Method | Account | Currency |
 *   Rate | Credit Terms | Supplier Invoice Number | Branch Detail |
 *   Account Detail | Amount | Description | Additional Information
 *
 * ============ KEPALA & RINCIAN, DALAM SATU BARIS ============
 *
 * `Branch`/`Account` adalah KEPALA dokumennya; `Branch Detail`/`Account Detail`
 * adalah barisnya. Contoh di templatenya memakai dua baris per `Sequence`
 * untuk satu dokumen berisi dua rincian.
 *
 * Berjaya Hub mengirim SATU baris per entri kas: tiap kas keluar adalah satu
 * pengeluaran yang berdiri sendiri, dengan satu outlet peruntukan dan satu
 * kantong asal. Menggabungkan beberapa entri jadi satu dokumen menuntut
 * aturan pengelompokan yang tidak dimiliki datanya — dan kelompok yang ditebak
 * tidak akan pernah terlihat salah di layar mana pun.
 *
 * Jadi kepala dan rincian tiap baris SAMA nilainya. Itu bukan kemalasan: itu
 * pernyataan yang benar tentang data yang ada.
 *
 * ============ `Document Date` BERUPA TEKS, BUKAN SEL TANGGAL ============
 *
 * Kebalikan dari Simple Purchase, dan itu diperiksa di templatenya sendiri —
 * lihat catatan panjang di `tanggal-excel.js`. Menyeragamkannya "supaya rapi"
 * berarti menebak, dan berkas yang ditolak ESB bernilai nol rupiah.
 *
 * ============ YANG TIDAK PUNYA PADANAN ============
 *
 * `Supplier Bank Account Number`, `Cost Center`, `Project`, `Credit Terms`,
 * `Supplier Invoice Number` dikosongkan — di contoh templatenya pun
 * sebagiannya kosong, dan Berjaya Hub tidak menyimpan satu pun dari keduanya.
 * Mengarang isinya jauh lebih buruk daripada mengosongkannya.
 *
 * `Currency` & `Rate` dipatok `IDR` / `1`. Berjaya Hub tidak pernah mencatat
 * kas dalam mata uang lain; kolomnya ada di template karena ESB melayani yang
 * multi-mata-uang.
 *
 * Tidak ada impor dari layar di berkas ini, supaya bisa diuji tanpa Excel
 * maupun browser.
 */

import { tanggalTeksEsb } from './tanggal-excel.js';
import { cocokkanSupplier, supplierSiap, normalNama } from './cocok-supplier.js';
import { bulatkanEsb } from './desimal-esb.js';

/** Header template, berurutan. Nama & urutannya harus persis. */
export const KOLOM_DISBURSEMENT = [
  'Sequence',
  'Payment To',
  'Supplier Bank Account Number',
  'Document Date',
  'Branch',
  'Cost Center',
  'Project',
  'Payment Method',
  'Account',
  'Currency',
  'Rate',
  'Credit Terms',
  'Supplier Invoice Number',
  'Branch Detail',
  'Account Detail',
  'Amount',
  'Description',
  'Additional Information'
];

/** Berjaya Hub tidak pernah mencatat kas dalam mata uang lain. */
export const MATA_UANG = 'IDR';
export const RATE_IDR = 1;

const teks = (v) => (v === null || v === undefined ? '' : String(v).trim());
const angka = (v) => {
  // `Number('')` dan `Number(null)` adalah 0, bukan NaN.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Bangun baris template Disbursement dari kas keluar Berjaya Hub.
 *
 * @param {object} o
 * @param {Array} o.kas baris `cash_entries` yang SUDAH disaring jadi kas keluar
 *   non-bahan: { id, entry_date, amount, notes, supplier, outlet_nama,
 *   kantong_nama, kantong_outlet_nama, kode }. `kantong_outlet_nama` adalah
 *   outlet MILIK KANTONGNYA (0120/0151) — sumber kolom Account.
 * @param {Record<string, Map<string,string>>} o.peta hasil `buatPeta` —
 *   `branch`, `coa`, `payment_method`, `supplier`. Dipakai BERSAMA dengan
 *   Simple Purchase: satu nama outlet tidak boleh punya dua padanan Branch.
 * @param {Map<string, {nama: string, kode: string}>} [o.masterSupplier] daftar
 *   induk supplier ESB (`petaSupplier`). Kosong = pemeriksaannya dilewati.
 * @param {string} [o.caraBayar='kas'] kunci lokal untuk kolom Payment Method.
 * @returns {{baris: Array[], kasIds: string[], kurang: Array<{jenis: string, nilai: string, dok: string[]}>}}
 */
export function barisEsbDisbursement({ kas, peta, masterSupplier = new Map(), caraBayar = 'kas' }) {
  const baris = [];
  const kasIds = [];
  const kurang = new Map();
  const catat = (jenis, nilai, kode) => {
    const nilaiTeks = teks(nilai) || '(kosong)';
    const k = `${jenis}::${nilaiTeks.toLowerCase()}`;
    if (!kurang.has(k)) kurang.set(k, { jenis, nilai: nilaiTeks, dok: new Set() });
    kurang.get(k).dok.add(kode);
  };

  // Payment Method dipetakan SEKALI, bukan per baris: seluruh kas keluar
  // dibayar tunai menurut definisinya sendiri — itulah artinya "kas keluar".
  // Kuncinya dinormalkan dengan aturan yang SAMA dengan `buatPeta` — yang
  // menyimpan kuncinya lewat `normalNama`. Memakai `toLowerCase()` polos di
  // sini membuat kategori ber-spasi ganda ("Bensin  Motor", hasil salin-tempel)
  // tidak pernah ketemu padanannya, dan entrinya tertahan selamanya dengan
  // alasan yang terlihat sudah dibereskan di layar pemetaan.
  const bayar = peta?.payment_method?.get?.(normalNama(caraBayar)) ?? null;

  let seq = 1;
  for (const c of Array.isArray(kas) ? kas : []) {
    const kode = teks(c.kode) || teks(c.id).slice(0, 8);
    let adaMasalah = false;

    const tanggal = tanggalTeksEsb(c.entry_date);
    if (tanggal === null) {
      // Tanggal yang gagal dibaca TIDAK dikosongkan: sel Document Date yang
      // kosong akan diisi tanggal unggah oleh ESB, dan pengeluaran bulan lalu
      // masuk sebagai pengeluaran hari ini — ke bulan yang sudah ditutup.
      catat('tanggal-kas', c.entry_date, kode);
      adaMasalah = true;
    }

    const branch = peta?.branch?.get?.(normalNama(c.outlet_nama)) ?? null;
    if (!branch) {
      catat('branch', c.outlet_nama, kode);
      adaMasalah = true;
    }

    // ACCOUNT = nomor COA, dipetakan dari OUTLET MILIK KANTONG KASNYA.
    //
    // BUKAN dari kategori biaya — itu salah baca 0149, dibetulkan di 0151.
    // Keempat baris contoh templatenya berisi '1 1 02 01' / '1 1 02 02':
    // akun HARTA. Kolom ini menyatakan DARI MANA uangnya keluar, bukan untuk
    // apa dibelanjakan. Pemetaan COANo yang sudah ada mengatakan hal yang
    // sama — kas, pusat, tempo, ketiganya sumber dana.
    //
    // Dan bukan pula `outlet_nama`: yang itu outlet PERUNTUKAN, dan sudah
    // jadi kolom Branch di baris ini. Keduanya sering sama; memakai satu
    // untuk keduanya akan benar di sebagian besar baris dan diam-diam salah
    // persis di baris yang paling perlu diperiksa.
    //
    // Entri yang kantongnya tidak punya outlet TIDAK jatuh kembali ke Branch.
    // Nomor akun yang ditebak terlihat persis seperti nomor akun yang benar,
    // dan tidak ada satu pun layar yang bisa membedakannya sesudah berkasnya
    // terunggah.
    let akun = null;
    if (!teks(c.kantong_outlet_nama)) {
      // Alasannya menyebut KANTONGNYA, bukan "(kosong)": yang membacanya perlu
      // tahu kantong mana yang harus ditempeli outlet, dan "Kas Utama" adalah
      // nama yang sama dengan yang ia lihat di Staff App.
      catat('kantong', c.kantong_nama, kode);
      adaMasalah = true;
    } else {
      akun = peta?.coa?.get?.(normalNama(c.kantong_outlet_nama)) ?? null;
      if (!akun) {
        catat('coa', c.kantong_outlet_nama, kode);
        adaMasalah = true;
      }
    }

    if (!bayar) {
      catat('payment_method', caraBayar, kode);
      adaMasalah = true;
    }

    // PAYMENT TO — nama dari daftar induk ESB, bukan yang diketik.
    //
    // Bentuknya disalin PERSIS dari `barisEsbPurchase`, termasuk pengecualian
    // daftar-induk-kosong: BU yang belum sempat mengimpor daftarnya tidak boleh
    // mendadak kehilangan seluruh ekspornya karena aturan baru dinyalakan.
    // Dua ekspor yang memperlakukan nama supplier dengan aturan berbeda akan
    // menghasilkan dua berkas yang tidak konsisten di ESB.
    const adaMasterSupplier = masterSupplier?.size > 0;
    const cocok = adaMasterSupplier ? cocokkanSupplier(c.supplier, masterSupplier, peta?.supplier) : null;
    const supplier = adaMasterSupplier ? (supplierSiap(cocok) ? cocok.nama : null) : teks(c.supplier);
    if (adaMasterSupplier && !supplierSiap(cocok)) {
      catat('supplier', c.supplier, kode);
      adaMasalah = true;
    }
    // Tanpa daftar induk pun, kolomnya tetap tidak boleh kosong: `Payment To`
    // terisi di keempat baris contoh templatenya.
    if (!supplier) {
      catat('supplier', c.supplier, kode);
      adaMasalah = true;
    }

    // Nominalnya disimpan BERTANDA (kas keluar negatif, 0026). Yang dikirim
    // besarnya, bukan tandanya — `Amount` negatif di ESB berarti pengeluaran
    // yang menambah kas.
    const nominal = angka(c.amount);
    const jumlah = nominal === null ? null : bulatkanEsb(Math.abs(nominal));
    if (jumlah === null || jumlah <= 0) {
      catat('jumlah-kas', c.notes, kode);
      adaMasalah = true;
    }

    // Satu entri bermasalah tidak menahan yang lain — tiap kas keluar adalah
    // dokumen yang berdiri sendiri, tidak seperti nota yang barisnya satu
    // kesatuan. Yang tertahan cuma dirinya, dan alasannya terbaca.
    if (adaMasalah) continue;

    baris.push([
      // Teks, mengikuti templatenya: sel `Sequence` di sana bertipe `s`
      // berformat '@'.
      String(seq),
      supplier,
      '', // Supplier Bank Account Number — tidak disimpan Berjaya Hub
      tanggal,
      branch,
      '', // Cost Center
      '', // Project
      bayar,
      akun,
      MATA_UANG,
      RATE_IDR,
      '', // Credit Terms
      '', // Supplier Invoice Number
      // Kepala & rincian sama nilainya — lihat catatan di kepala berkas.
      branch,
      akun,
      jumlah,
      // Description = rincian barisnya, Additional Information = kepalanya.
      // Keterangan kas keluar WAJIB diisi (0141), jadi kolom ini tidak pernah
      // kosong untuk entri yang lolos sampai sini.
      teks(c.notes),
      teks(c.kode)
    ]);
    kasIds.push(c.id);
    seq += 1;
  }

  return {
    baris,
    kasIds,
    kurang: [...kurang.values()].map((k) => ({ jenis: k.jenis, nilai: k.nilai, dok: [...k.dok] }))
  };
}

/** Ringkasan siap-tampil. */
export function ringkasDisbursement(hasil, totalKas) {
  const siap = hasil?.kasIds?.length ?? 0;
  return {
    siap,
    tertahan: Math.max(0, (totalKas ?? 0) - siap),
    baris: hasil?.baris?.length ?? 0,
    kurang: hasil?.kurang?.length ?? 0
  };
}
