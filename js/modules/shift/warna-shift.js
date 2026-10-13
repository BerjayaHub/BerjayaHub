/**
 * WARNA SEL JADWAL — satu aturan untuk Admin Portal & Staff App.
 *
 *   "tugas luar diberi warna hijau agar tidak sama dengan warna cuti, lalu
 *    tiap shift juga warna nya berbeda satu sama lain"
 *
 * ============ WARNANYA DIKUNCI KE ID, BUKAN KE URUTAN ============
 *
 * Godaan pertamanya adalah memberi warna menurut urutan shift di daftar:
 * yang pertama biru, kedua ungu, dan seterusnya. Itu ditolak.
 *
 * Jadwal shift dibaca dengan MATA, cepat, lewat warna — itu seluruh gunanya
 * diberi warna. Kalau warnanya ikut urutan, maka menambah satu shift baru
 * bernama "DINI HARI" yang kebetulan jatuh di urutan pertama akan MENGGESER
 * warna semua shift lain. Orang yang sudah hafal "biru itu Pagi" tiba-tiba
 * membaca jadwal yang sama dengan arti yang berbeda, dan tidak ada apa pun di
 * layar yang memberitahunya. Itu bukan sekadar kurang rapi: ia membuat orang
 * salah membaca jadwalnya sendiri dengan penuh keyakinan.
 *
 * Maka warnanya dihitung dari `shift.id` — uuid yang tidak pernah berubah
 * seumur hidup shift itu. Menambah, menghapus, atau mengurutkan ulang shift
 * lain tidak menyentuh warna yang sudah dikenal orang.
 *
 * Konsekuensinya yang harus disadari: dua shift BISA kebetulan sewarna, dan
 * tidak ada yang bisa mencegahnya selain mengganti nama/ID-nya. Itu
 * ditukar sadar — warna yang kadang kembar jauh lebih murah daripada warna
 * yang artinya berpindah.
 *
 * ============ KENAPA CUMA LIMA ============
 *
 * Paletnya sengaja berhenti di lima, dan bukan karena malas. Tiga rona sudah
 * terpakai arti lain di layar yang sama:
 *
 *   abu-abu  -> Libur
 *   kuning   -> Cuti / Sakit / PH
 *   hijau    -> Tugas Luar
 *
 * Yang tersisa adalah sian, biru, ungu, fuchsia, merah muda. Memaksakan warna
 * keenam berarti mengambil rona yang terlalu dekat dengan salah satu di atas —
 * dan dua warna yang nyaris sama lebih buruk daripada dua warna yang jelas
 * sama: yang pertama membuat orang mengira ia melihat perbedaan.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

/** Kelas CSS untuk tiap keadaan non-shift. Didefinisikan di `css/styles.css`. */
export const KELAS_LIBUR = 'shift-off';
export const KELAS_CUTI = 'shift-cuti';
export const KELAS_TUGAS_LUAR = 'shift-tugas-luar';

/**
 * Banyaknya warna shift yang tersedia.
 *
 * Diekspor supaya tes bisa membuktikan sebarannya, dan supaya CSS dan JS tidak
 * bisa menyimpang diam-diam: kelas `shift-w6` yang dihasilkan JS tapi tidak
 * ada di CSS menghasilkan sel TANPA warna sama sekali — tanpa galat.
 */
export const JUMLAH_WARNA_SHIFT = 5;

/**
 * Angka stabil dari sebuah string.
 *
 * FNV-1a 32-bit. Dipilih karena pendek, tidak butuh impor, dan — yang
 * terpenting — hasilnya SAMA di setiap mesin dan setiap versi browser. Sesuatu
 * seperti `Math.random()` atau urutan `Map` jelas salah di sini; yang kurang
 * jelas salah adalah memakai panjang string atau jumlah kode karakternya, yang
 * membuat dua uuid berbeda sering jatuh ke angka yang sama.
 *
 * `>>> 0` menjaga hasilnya tetap tak bertanda — tanpa itu `%` bisa memulangkan
 * angka NEGATIF, dan `KELAS[-2]` adalah `undefined`: selnya kehilangan
 * warnanya, lagi-lagi tanpa galat.
 */
function angkaStabil(s) {
  let h = 0x811c9dc5;
  const t = String(s ?? '');
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Kelas warna untuk satu shift.
 *
 * @param {string} shiftId `outlet_shifts.id`
 * @returns {string} mis. `'shift-w3'`, atau `''` kalau idnya kosong
 */
export function kelasWarnaShift(shiftId) {
  const id = shiftId === null || shiftId === undefined ? '' : String(shiftId).trim();
  // Id kosong TIDAK dipaksa jadi warna pertama. Sel tanpa shift memang tidak
  // boleh berwarna shift — memberinya `shift-w1` akan membuat baris rusak
  // terlihat seperti shift yang sah.
  if (!id) return '';
  return `shift-w${(angkaStabil(id) % JUMLAH_WARNA_SHIFT) + 1}`;
}

/**
 * Kelas warna untuk satu sel jadwal apa pun keadaannya.
 *
 * SATU fungsi untuk Admin Portal dan Staff App. Dua layar yang mewarnai hal
 * yang sama dengan aturan yang berbeda adalah cara membuat orang mengira
 * datanya juga berbeda — dan keluhan itu sudah pernah muncul di repo ini
 * untuk dropdown supplier.
 *
 * @param {object} jadwal baris `shift_schedules`
 * @param {{cuti?: boolean}} [opsi] cuti dibaca terpisah (0113), bukan dari baris
 */
export function kelasWarnaSel(jadwal, { cuti = false } = {}) {
  if (cuti) return KELAS_CUTI;
  if (!jadwal) return '';
  // Urutannya mengikuti `selJadwal` di `cuti-jadwal.js`: tugas luar sebelum
  // libur, karena baris tugas luar ber-`is_off` false.
  if (jadwal.is_tugas_luar) return KELAS_TUGAS_LUAR;
  if (jadwal.is_off) return KELAS_LIBUR;
  return kelasWarnaShift(jadwal.shift_id);
}
