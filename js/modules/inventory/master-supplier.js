/**
 * MASTER SUPPLIER — daftar yang dipakai bersama Staff App & Admin Portal.
 *
 *   "saya ingin ada master supplier, jadi saya tahu supplier mana yang sudah
 *    terdaftar di berjaya hub dan belum"
 *
 * ============ BEDANYA DENGAN `daftar-supplier.js` ============
 *
 * Keduanya menyebut "supplier", dan keduanya memang perlu ada — tapi menjawab
 * pertanyaan yang berbeda:
 *
 *   `daftar-supplier.js`  "ejaan mana yang belum cocok dengan daftar ESB?"
 *                         Milik layar Pemetaan ESB. Sumbernya `esb_master`
 *                         + ejaan yang dipakai nota.
 *
 *   berkas ini            "supplier apa saja yang terdaftar di Berjaya Hub,
 *                         dan mana yang belum diperiksa admin?"
 *                         Sumbernya tabel `suppliers` (0158) — daftar yang
 *                         dipakai dropdown.
 *
 * Yang pertama soal ekspor ke ESB; yang kedua soal apa yang bisa dipilih staff.
 * Menyatukannya terdengar rapi, tapi akan membuat satu layar menjawab dua
 * pertanyaan sekaligus dan tidak menjawab keduanya dengan baik.
 *
 * Tidak ada impor selain normalisasi nama, supaya bisa diuji tanpa browser.
 */
import { normalNama } from './cocok-supplier.js';

const teks = (v) => (v === null || v === undefined ? '' : String(v));
const angka = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const STATUS = {
  SIAP: 'siap',
  TANPA_KODE: 'tanpa-kode',
  BARU: 'baru',
  NONAKTIF: 'nonaktif'
};

export const LABEL_STATUS = {
  [STATUS.SIAP]: 'Terdaftar & berkode ESB',
  [STATUS.TANPA_KODE]: 'Terdaftar, kode ESB kosong',
  [STATUS.BARU]: 'Baru dari staff',
  [STATUS.NONAKTIF]: 'Nonaktif'
};

/** Status yang butuh pekerjaan admin. Dipakai lencana & urutan. */
export const STATUS_PERLU_DIKERJAKAN = [STATUS.BARU, STATUS.TANPA_KODE];

/**
 * Status satu baris supplier.
 *
 * Urutannya penting: `nonaktif` diperiksa DULU. Supplier yang sudah
 * dinonaktifkan tidak perlu lagi dikabarkan "kode ESB-nya kosong" — pekerjaan
 * itu sudah dibatalkan, dan menampilkannya sebagai tugas membuat daftar
 * pekerjaan berisi hal yang tidak akan pernah dikerjakan siapa pun.
 */
export function statusSupplier(s) {
  if (s?.aktif === false) return STATUS.NONAKTIF;
  if (!s?.terverifikasi) return STATUS.BARU;
  return teks(s?.esb_kode).trim() ? STATUS.SIAP : STATUS.TANPA_KODE;
}

/**
 * Susun daftar siap-tampil.
 *
 * @param {Array} suppliers baris tabel `suppliers`
 * @param {Array<{nama: string, jumlah: number, belum_ekspor: number}>} [terpakai]
 *        hasil `nama_supplier_terpakai` — berapa nota memakainya
 */
export function susunMasterSupplier(suppliers, terpakai = []) {
  const pakai = new Map();
  for (const t of Array.isArray(terpakai) ? terpakai : []) {
    const k = normalNama(t?.nama);
    if (!k) continue;
    // Dijumlahkan, bukan ditimpa: dua ejaan berbeda bisa menunjuk satu baris
    // master yang sama sejak 0158 merapikannya.
    const ada = pakai.get(k) ?? { jumlah: 0, belumEkspor: 0 };
    pakai.set(k, { jumlah: ada.jumlah + angka(t?.jumlah), belumEkspor: ada.belumEkspor + angka(t?.belum_ekspor) });
  }

  const baris = (Array.isArray(suppliers) ? suppliers : [])
    .filter((s) => teks(s?.nama).trim())
    .map((s) => {
      const nama = teks(s.nama).trim();
      const p = pakai.get(normalNama(nama)) ?? { jumlah: 0, belumEkspor: 0 };
      return {
        id: s.id,
        nama,
        esbKode: teks(s.esb_kode).trim(),
        // Kosong berarti "ejaan di ESB sama dengan nama ini" — bukan "belum
        // diisi". Dua arti itu dibedakan di 0158, dan layar tidak boleh
        // menyatukannya lagi.
        esbNama: teks(s.esb_nama).trim(),
        terverifikasi: s.terverifikasi === true,
        aktif: s.aktif !== false,
        status: statusSupplier(s),
        jumlah: p.jumlah,
        belumEkspor: p.belumEkspor
      };
    });

  // Yang BUTUH DIKERJAKAN di atas. Dengan empat puluh supplier, satu nama baru
  // yang muncul kemarin bisa berada di baris ke-35 dan tidak pernah terbaca.
  const urut = { [STATUS.BARU]: 0, [STATUS.TANPA_KODE]: 1, [STATUS.SIAP]: 2, [STATUS.NONAKTIF]: 3 };
  return baris.sort(
    (a, b) => urut[a.status] - urut[b.status] || b.jumlah - a.jumlah || a.nama.localeCompare(b.nama, 'id')
  );
}

/** Hitungan per status untuk lencana di kepala layar. */
export function ringkasMaster(baris) {
  const hasil = { [STATUS.SIAP]: 0, [STATUS.TANPA_KODE]: 0, [STATUS.BARU]: 0, [STATUS.NONAKTIF]: 0, total: 0 };
  for (const b of Array.isArray(baris) ? baris : []) {
    if (hasil[b?.status] === undefined) continue;
    hasil[b.status] += 1;
    hasil.total += 1;
  }
  return hasil;
}

/**
 * Calon kembar: nama yang SALING MIRIP di daftar yang sama.
 *
 * ============ KENAPA INI PERLU ADA SEJAK HARI PERTAMA ============
 *
 * Supplier sekarang lahir dari ketikan staff. "Toko Berkah", "Tk Berkah", dan
 * "Toko Berkah Jaya" akan muncul dengan sendirinya dalam hitungan minggu —
 * bukan karena ada yang ceroboh, tapi karena tiga orang mengetik nama yang
 * sama dengan cara yang berbeda.
 *
 * Daftar master tanpa cara menemukan kembarannya akan berubah jadi daftar yang
 * tidak ada gunanya dibaca, dan pada saat itu orang kembali ke Excel.
 *
 * Yang dicari BUKAN kemiripan huruf satu per satu — itu menghasilkan terlalu
 * banyak tebakan. Yang dipakai: salah satu nama menjadi AWALAN nama yang lain
 * sesudah dinormalkan. Itu menangkap "Toko Berkah" vs "Toko Berkah Jaya" dan
 * singkatan yang dipanjangkan, tanpa menuduh dua nama yang kebetulan mirip.
 *
 * @returns {Map<string, string[]>} id -> daftar id yang mungkin kembarannya
 */
export function calonKembar(baris) {
  const daftar = (Array.isArray(baris) ? baris : []).filter((b) => b?.id && teks(b?.nama).trim());
  const peta = new Map();

  for (let i = 0; i < daftar.length; i++) {
    for (let j = i + 1; j < daftar.length; j++) {
      const a = normalNama(daftar[i].nama);
      const b = normalNama(daftar[j].nama);
      if (!a || !b || a === b) continue;
      // Batas 4 huruf: tanpa itu "cv" jadi awalan hampir setiap nama, dan
      // seluruh daftar saling ditandai kembar.
      const pendek = a.length <= b.length ? a : b;
      if (pendek.length < 4) continue;
      const panjang = a.length <= b.length ? b : a;
      if (!panjang.startsWith(pendek)) continue;
      // Harus putus di batas kata, bukan di tengah kata. Tanpa ini "PT Sari"
      // dan "PT Sarinah" ditandai kembar, padahal itu dua perusahaan.
      if (panjang[pendek.length] !== ' ') continue;

      for (const [x, y] of [
        [daftar[i].id, daftar[j].id],
        [daftar[j].id, daftar[i].id]
      ]) {
        if (!peta.has(x)) peta.set(x, []);
        peta.get(x).push(y);
      }
    }
  }
  return peta;
}

/**
 * Keterangan satu baris di dropdown.
 *
 * SATU fungsi untuk nota maupun form kas. Dua layar yang menampilkan daftar
 * yang sama dengan keterangan berbeda membuat orang mengira daftarnya juga
 * berbeda — dan itu keluhan yang sudah pernah muncul di repo ini.
 */
export function hintSupplier(s) {
  // `esb_kode` (tabel `suppliers`, 0158) ATAU `kode` (baris `esb_master`
  // lama). Keduanya diterima supaya pemanggil yang belum beralih tidak
  // kehilangan keterangannya diam-diam.
  const kode = teks(s?.esb_kode ?? s?.kode).trim();
  if (kode) return `kode ESB ${kode}`;
  if (s?.terverifikasi === false) return 'baru — belum diperiksa admin';
  return '';
}

/** Opsi siap-pakai untuk search-select. */
export function opsiSupplier(daftar) {
  return (Array.isArray(daftar) ? daftar : [])
    .map((s) => ({ value: teks(s?.nama).trim(), label: teks(s?.nama).trim(), hint: hintSupplier(s) }))
    .filter((o) => o.value)
    .sort((a, b) => a.label.localeCompare(b.label, 'id'));
}

/**
 * Kalimat keadaan daftarnya.
 *
 * Menyebut pekerjaan yang ADA lebih dulu. Kalimat yang muncul pada keadaan
 * normal berhenti dibaca dalam hitungan hari.
 */
export function pesanMaster(ringkas) {
  const baru = ringkas?.[STATUS.BARU] ?? 0;
  const tanpaKode = ringkas?.[STATUS.TANPA_KODE] ?? 0;
  if (!ringkas?.total) {
    return 'Belum ada supplier sama sekali. Daftarnya terisi sendiri begitu staff mencatat nota — atau impor daftar ESB di langkah 3.';
  }
  const bagian = [];
  if (baru) bagian.push(`${baru} supplier baru dari staff belum diperiksa`);
  if (tanpaKode) bagian.push(`${tanpaKode} sudah diperiksa tapi kode ESB-nya masih kosong`);
  if (!bagian.length) return `${ringkas.total} supplier terdaftar, semuanya sudah berkode ESB.`;
  return bagian.join(' · ') + '.';
}
