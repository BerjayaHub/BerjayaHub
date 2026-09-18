/**
 * DAFTAR MASTER SUPPLIER — apa yang sudah sama dengan ESB, apa yang belum.
 *
 * ============ PERTANYAAN YANG DIJAWAB LAYAR INI ============
 *
 * Sebelum ini, satu-satunya tempat nama supplier terlihat adalah kelompok
 * "Supplier" di layar pemetaan — dan kelompok itu sengaja HANYA memuat ejaan
 * yang bermasalah. Yang sudah benar tidak muncul di mana pun, jadi tidak ada
 * cara menjawab "supplier apa saja yang sudah terdaftar di sini?" selain
 * membuka berkas ESB di Excel.
 *
 * Berkas ini menggabungkan dua sumber yang selama ini terpisah:
 *
 *   esb_master jenis 'supplier' — daftar resmi, diimpor dari ESB
 *   nama_supplier_terpakai()    — ejaan yang benar-benar dipakai nota
 *
 * dan memberi tiap baris satu status yang bisa ditindaklanjuti.
 *
 * ============ EMPAT STATUS, DAN MASING-MASING PUNYA PEKERJAANNYA ============
 *
 *   'cocok'        — ada di ESB dan dipakai nota. Tidak ada yang perlu
 *                    dikerjakan; inilah keadaan yang dituju.
 *   'dipetakan'    — ejaan lama yang sudah dijembatani ke nama ESB. Aman, tapi
 *                    baik diketahui: notanya berangkat dengan nama lain.
 *   'belum-terdaftar' — dipakai nota, TIDAK ada di ESB. Ini yang menahan
 *                    ekspor, dan ini yang perlu ditambahkan di ESB.
 *   'belum-terpakai' — ada di ESB, belum pernah dipakai nota. Bukan masalah —
 *                    tapi menyembunyikannya membuat daftar ini terasa tidak
 *                    lengkap, dan orangnya kembali membuka Excel.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

import { normalNama, cocokkanSupplier } from './cocok-supplier.js';

const teks = (v) => (v === null || v === undefined ? '' : String(v));
const angka = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Label siap-tampil per status. Satu sumber, dipakai tabel maupun saringan. */
export const LABEL_STATUS = {
  cocok: 'Sama dengan ESB',
  dipetakan: 'Dipetakan ke ESB',
  'belum-terdaftar': 'Belum ada di ESB',
  'belum-terpakai': 'Belum dipakai nota'
};

/** Status yang MENAHAN ekspor. Dipakai layar untuk menghitung lencana. */
export const STATUS_MENGHAMBAT = 'belum-terdaftar';

/**
 * Susun satu daftar gabungan.
 *
 * @param {{jenis: string, nama: string, kode?: string}[]} master baris `esb_master`
 * @param {{nama: string, jumlah: number, belum_ekspor: number}[]} terpakai hasil `nama_supplier_terpakai`
 * @param {Map<string,string>} [ejaan] hasil `petaEjaanSupplier`
 * @returns {{nama: string, kode: string, status: string, jumlah: number, belumEkspor: number, namaEsb: string|null}[]}
 */
export function susunDaftarSupplier(master, terpakai, ejaan = new Map()) {
  const petaEsb = new Map();
  for (const m of Array.isArray(master) ? master : []) {
    if (teks(m?.jenis) !== 'supplier') continue;
    const nama = teks(m?.nama).trim();
    if (!nama) continue;
    const k = normalNama(nama);
    if (!petaEsb.has(k)) petaEsb.set(k, { nama, kode: teks(m?.kode).trim() });
  }

  const baris = [];
  const sudahDisebut = new Set();

  // (1) Yang DIPAKAI nota lebih dulu — merekalah yang punya konsekuensi.
  for (const t of Array.isArray(terpakai) ? terpakai : []) {
    const nama = teks(t?.nama).trim();
    if (!nama) continue;
    const k = normalNama(nama);
    const hasil = cocokkanSupplier(nama, petaEsb, ejaan);
    const status = hasil.keadaan === 'daftar' ? 'cocok' : hasil.keadaan === 'dipetakan' ? 'dipetakan' : 'belum-terdaftar';

    baris.push({
      nama,
      // Kodenya datang dari baris ESB yang COCOK, bukan dari nama yang
      // diketik. Untuk ejaan yang dipetakan, kode yang benar milik nama
      // tujuannya — menampilkan kode kosong di situ akan terbaca sebagai
      // "belum terdaftar" padahal sudah dijembatani.
      kode: hasil.nama ? petaEsb.get(normalNama(hasil.nama))?.kode ?? '' : '',
      status,
      jumlah: angka(t?.jumlah),
      belumEkspor: angka(t?.belum_ekspor),
      namaEsb: hasil.nama
    });
    sudahDisebut.add(k);
    // Nama ESB tujuannya ikut ditandai supaya tidak muncul lagi sebagai
    // "belum dipakai" — ia memang sedang dipakai, lewat ejaan lain.
    if (hasil.nama) sudahDisebut.add(normalNama(hasil.nama));
  }

  // (2) Sisa daftar ESB yang belum tersentuh nota mana pun.
  for (const [k, m] of petaEsb) {
    if (sudahDisebut.has(k)) continue;
    baris.push({ nama: m.nama, kode: m.kode, status: 'belum-terpakai', jumlah: 0, belumEkspor: 0, namaEsb: m.nama });
  }

  // Yang MENGHAMBAT di atas, lalu yang paling banyak dipakai, lalu alfabetis.
  //
  // Bukan alfabetis murni: dengan 35 supplier, satu nama yang menahan ekspor
  // bisa berada di baris ke-30 dan tidak pernah terbaca. Urutan yang
  // mendahulukan pekerjaan membuat daftarnya bisa dibaca dari atas ke bawah.
  const urutan = { 'belum-terdaftar': 0, dipetakan: 1, cocok: 2, 'belum-terpakai': 3 };
  return baris.sort(
    (a, b) =>
      urutan[a.status] - urutan[b.status] ||
      b.belumEkspor - a.belumEkspor ||
      b.jumlah - a.jumlah ||
      a.nama.localeCompare(b.nama, 'id')
  );
}

/** Hitungan per status, untuk lencana ringkasan di kepala layar. */
export function ringkasStatus(baris) {
  const hasil = { cocok: 0, dipetakan: 0, 'belum-terdaftar': 0, 'belum-terpakai': 0, total: 0 };
  for (const b of Array.isArray(baris) ? baris : []) {
    if (hasil[b?.status] === undefined) continue;
    hasil[b.status] += 1;
    hasil.total += 1;
  }
  return hasil;
}

/**
 * Kalimat keadaan daftarnya.
 *
 * Menyebut yang MENGHAMBAT lebih dulu, dan hanya menyebut nota tertahan kalau
 * memang ada — kalimat yang muncul pada keadaan normal berhenti dibaca.
 */
export function pesanRingkas(ringkas, daftarKosong) {
  if (daftarKosong) {
    return 'Daftar supplier ESB belum diimpor. Unggah berkas "Master Supplier" dari ESB di langkah 3 supaya nama supplier bisa dipilih, bukan diketik.';
  }
  const belum = ringkas?.['belum-terdaftar'] ?? 0;
  if (!belum) return 'Semua supplier yang dipakai nota sudah cocok dengan ESB.';
  return `${belum} nama supplier dipakai nota tapi belum ada di ESB — notanya akan tertahan saat diekspor.`;
}
