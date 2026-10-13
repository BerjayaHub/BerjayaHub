/**
 * TES: tugas luar di jadwal shift (0160) — aturan murninya.
 *
 *   §1 Penyandian nilai `<select>` dan pembacaannya BOLAK-BALIK.
 *   §2 Urutan pemeriksaan: tugas luar sebelum `is_off`.
 *   §3 Pilihan dropdown, termasuk jenis nonaktif yang sedang terpasang.
 *   §4 Label & keterangan clock in.
 *   §5 `selJadwal` mengenal mode keempat, dan ringkasannya menghitungnya.
 *   §6 Masukan aneh tidak melempar.
 *   §7 Warna sel: dikunci ke ID, stabil selamanya.
 */
import assert from 'node:assert/strict';
import {
  NILAI_OFF,
  PREFIKS_TL,
  MODE,
  nilaiSel,
  bacaNilaiSel,
  opsiSel,
  labelJenis,
  labelTugasLuar,
  keteranganClockIn,
  jenisAktif,
  periksaSelTugasLuar,
  kelompokOpsi,
  STATUS_PRESENSI_TUGAS_LUAR
} from '../js/modules/shift/tugas-luar.js';
import {
  kelasWarnaShift,
  kelasWarnaSel,
  JUMLAH_WARNA_SHIFT,
  KELAS_CUTI,
  KELAS_LIBUR,
  KELAS_TUGAS_LUAR
} from '../js/modules/shift/warna-shift.js';
import { selJadwal, ringkasBaris } from '../js/modules/shift/cuti-jadwal.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

const ID_JENIS = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ID_SHIFT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ID_OUTLET = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const JENIS = [
  { id: ID_JENIS, nama: 'Antar Barang', aktif: true },
  { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', nama: 'Belanja', aktif: true }
];
const SHIFTS = [{ id: ID_SHIFT, name: 'Pagi' }];

const jenisPerId = new Map(JENIS.map((j) => [j.id, j]));
const outletPerId = new Map([[ID_OUTLET, { id: ID_OUTLET, name: 'Dago' }]]);

console.log('§1 Penyandian bolak-balik');

// ============ INI PEMERIKSAAN TERPENTING DI BERKAS INI ============
//
// Penulis nilai (`nilaiSel`) dan pembacanya (`bacaNilaiSel`) harus sepakat.
// Kalau mereka menyimpang, selnya tersimpan sebagai keadaan yang BERBEDA dari
// yang dipilih orangnya — dan layarnya digambar ulang dari database dengan
// tampilan yang benar, jadi tidak ada satu pun tanda sampai seseorang memeriksa
// rekapnya berminggu-minggu kemudian.
const bolakBalik = (jadwal, modeHarap) => {
  const v = nilaiSel(jadwal);
  const niat = bacaNilaiSel(v);
  assert.equal(niat.mode, modeHarap, `${JSON.stringify(jadwal)} -> '${v}' -> ${niat.mode}`);
  return niat;
};

bolakBalik(null, MODE.KOSONG);
bolakBalik({ is_off: true }, MODE.OFF);
bolakBalik({ shift_id: ID_SHIFT }, MODE.SHIFT);
const niatTL = bolakBalik({ is_tugas_luar: true, tugas_luar_type_id: ID_JENIS }, MODE.TUGAS_LUAR);
ok('INTI: keempat keadaan bolak-balik utuh lewat nilai `<select>`');

assert.equal(niatTL.tugasLuarTypeId, ID_JENIS);
assert.equal(niatTL.shiftId, null);
assert.equal(niatTL.isOff, false);
ok('tugas luar membawa jenisnya, tanpa shift & tanpa libur');

assert.equal(nilaiSel({ is_tugas_luar: true, tugas_luar_type_id: ID_JENIS }), `${PREFIKS_TL}${ID_JENIS}`);
assert.equal(nilaiSel({ is_off: true }), NILAI_OFF);
ok('sandinya memakai konstanta yang sama dengan pembacanya');

// ============ JENIS DAN SHIFT KEDUANYA UUID ============
//
// Tanpa prefiks `tl:` tidak ada cara memisahkannya, dan `shift_id` yang
// menunjuk jenis tugas luar akan ditolak FK dengan pesan yang tidak menyebut
// apa pun tentang sel jadwal.
assert.equal(bacaNilaiSel(ID_JENIS).mode, MODE.SHIFT);
assert.equal(bacaNilaiSel(`${PREFIKS_TL}${ID_JENIS}`).mode, MODE.TUGAS_LUAR);
ok('INTI: uuid telanjang = shift, uuid berprefiks = tugas luar');

// Bentuk keluarannya SAMA untuk keempat keadaan — pemanggil yang membaca
// sebagian kunci tidak pernah membaca `undefined` lalu mengirimnya sebagai
// "jangan ubah".
for (const v of ['', NILAI_OFF, ID_SHIFT, `${PREFIKS_TL}${ID_JENIS}`]) {
  const niat = bacaNilaiSel(v);
  assert.deepEqual(Object.keys(niat).sort(), ['isOff', 'isTugasLuar', 'mode', 'shiftId', 'tugasLuarTypeId']);
}
ok('keempatnya memulangkan bentuk yang sama — tidak ada kunci yang hilang');

console.log('\n§2 Urutan pemeriksaan');

// ============ TUGAS LUAR DIPERIKSA SEBELUM `is_off` ============
//
// Baris tugas luar ber-`is_off` false dan ber-`shift_id` null. Perhitungan lama
// (`is_off ? 'off' : shift_id`) memulangkan '' untuknya — yaitu "belum
// dijadwalkan". Selnya digambar kosong, adminnya mengira tugas luarnya gagal
// tersimpan, dan ia memilihnya lagi: menimpa baris yang sudah benar.
assert.equal(nilaiSel({ is_tugas_luar: true, tugas_luar_type_id: ID_JENIS, is_off: false, shift_id: null }), `${PREFIKS_TL}${ID_JENIS}`);
assert.notEqual(nilaiSel({ is_tugas_luar: true, tugas_luar_type_id: ID_JENIS }), '');
ok('INTI: sel tugas luar tidak digambar kosong');

// Tugas luar tanpa jenis TIDAK menghasilkan `'tl:'` yang pembacanya tak bisa
// pakai — datanya sudah melanggar constraint 0160, jadi lebih baik kosong.
assert.equal(nilaiSel({ is_tugas_luar: true, tugas_luar_type_id: null }), '');
assert.equal(bacaNilaiSel(PREFIKS_TL).mode, MODE.KOSONG);
ok('`tl:` tanpa uuid tidak diteruskan ke database');

console.log('\n§3 Pilihan dropdown');

const opsi = opsiSel(SHIFTS, JENIS);
assert.deepEqual(opsi.map((o) => o.value), ['', ID_SHIFT, NILAI_OFF, `${PREFIKS_TL}${JENIS[0].id}`, `${PREFIKS_TL}${JENIS[1].id}`]);
ok('urutannya: kosong, shift, libur, lalu tugas luar per jenis');

// ============ LABELNYA PENDEK, ARTINYA DI GRUPNYA ============
//
//   "tidak perlu ada keterangan 'Tugas Luar · Dinas Luar' dll, cukup jenis
//    tugas luarnya saja"
//
// Labelnya dipendekkan, tapi awalannya tidak sekadar dibuang: nama jenis
// ditentukan admin sendiri, jadi tidak ada yang mencegah lahirnya jenis
// bernama "Siang Keliling" yang berdiri sebaris dengan shift "SIANG" tanpa apa
// pun yang membedakannya. `grup` yang memikul artinya.
assert.equal(opsi[3].label, 'Antar Barang');
assert.doesNotMatch(opsi[3].label, /Tugas Luar/);
assert.equal(opsi[3].grup, 'Tugas Luar');
ok('INTI: label opsi tugas luar cuma nama jenisnya; grupnya yang memberi arti');

assert.equal(opsi[1].grup, 'Shift');
// "–" dan "Libur" bukan anggota kategori apa pun, dan tidak dipaksa masuk
// salah satunya.
assert.equal(opsi[0].grup, '');
assert.equal(opsi[2].grup, '');
ok('shift bergrup "Shift"; "–" dan "Libur" berdiri sendiri');

const grup = kelompokOpsi(opsi);
assert.deepEqual(grup.map((g) => g.grup), ['', 'Shift', '', 'Tugas Luar']);
assert.equal(grup[3].opsi.length, 2);
ok('`kelompokOpsi` menyusun `<optgroup>` tanpa menyentuh DOM');

// Urutan grup mengikuti kemunculan pertama, bukan abjad — daftar yang
// urutannya berubah saat admin mengganti nama jenis tidak bisa dihafal.
const acak = kelompokOpsi([
  { value: 'b', label: 'B', grup: 'Zeta' },
  { value: 'a', label: 'A', grup: 'Alfa' },
  { value: 'c', label: 'C', grup: 'Zeta' }
]);
assert.deepEqual(acak.map((g) => g.grup), ['Zeta', 'Alfa']);
assert.equal(acak[0].opsi.length, 2);
ok('grup yang sama digabung, urutannya mengikuti kemunculan pertama');

// Jenis nonaktif tidak ditawarkan sebagai pilihan BARU…
const adaNonaktif = [...JENIS, { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', nama: 'Lama', aktif: false }];
assert.equal(opsiSel(SHIFTS, adaNonaktif).length, opsi.length);
ok('jenis nonaktif tidak ditawarkan sebagai pilihan baru');

// ============ …TAPI TETAP DITAWARKAN KALAU IA SEDANG TERPASANG ============
//
// Alasannya sama dengan supplier di luar daftar (`supplier-kas.js`): tanpa itu,
// membuka sel yang sudah berisi jenis yang baru dinonaktifkan menampilkannya
// KOSONG — dan menyentuh sel itu menghapus hari kerja yang sudah ditetapkan.
const terpasang = `${PREFIKS_TL}eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee`;
const opsiTerpasang = opsiSel(SHIFTS, adaNonaktif, terpasang);
assert.ok(opsiTerpasang.some((o) => o.value === terpasang));
assert.match(opsiTerpasang.find((o) => o.value === terpasang).label, /nonaktif/i);
ok('INTI: jenis nonaktif yang sedang terpasang tetap ditawarkan, ditandai');

assert.equal(jenisAktif(adaNonaktif).length, 2);
assert.equal(jenisAktif(null).length, 0);
ok('`jenisAktif` menyaring yang nonaktif & tahan daftar kosong');

console.log('\n§4 Label & keterangan');

const selTL = { is_tugas_luar: true, tugas_luar_type_id: ID_JENIS, tugas_luar_outlet_id: ID_OUTLET };
assert.equal(labelTugasLuar(selTL, jenisPerId, outletPerId), 'Antar Barang → Dago');
assert.equal(labelTugasLuar({ is_tugas_luar: true, tugas_luar_type_id: ID_JENIS }, jenisPerId, outletPerId), 'Antar Barang');
ok('outlet tujuan disebut kalau ada, dihilangkan kalau tidak');

// Jenis yang tidak ketemu di peta paling sering cuma BELUM TERMUAT, bukan
// hilang. "Tugas Luar" apa adanya lebih jujur daripada "undefined".
assert.equal(labelTugasLuar({ tugas_luar_type_id: 'tidak-ada' }, jenisPerId, outletPerId), 'Tugas Luar');
// Peta yang NULL: jenisnya tidak bisa dicari sama sekali, jadi labelnya
// mundur ke 'Tugas Luar' — bukan melempar, dan bukan 'undefined → undefined'.
assert.equal(labelTugasLuar(selTL, null, null), 'Tugas Luar');
ok('peta yang kosong tidak menghasilkan "undefined" di layar');

assert.equal(keteranganClockIn(selTL, jenisPerId, outletPerId), 'Tugas luar: Antar Barang → Dago');
// Hari yang BUKAN tugas luar memulangkan '' — pemanggil memakainya sebagai
// "jangan isi apa pun", bukan "isi dengan kosong".
assert.equal(keteranganClockIn({ is_off: true }, jenisPerId, outletPerId), '');
assert.equal(keteranganClockIn(null, jenisPerId, outletPerId), '');
ok('INTI: keterangan clock in hanya terisi pada hari tugas luar');

assert.equal(labelJenis({ nama: 'Belanja' }), 'Belanja');
assert.equal(labelJenis({}), 'Tugas Luar');
ok('jenis tanpa nama tidak menghasilkan label kosong');

console.log('\n§5 selJadwal & ringkasan');

assert.equal(selJadwal({ cuti: null, jadwal: selTL }).mode, 'tugas-luar');
assert.equal(selJadwal({ cuti: null, jadwal: { is_off: true } }).mode, 'off');
assert.equal(selJadwal({ cuti: null, jadwal: { shift_id: ID_SHIFT } }).mode, 'shift');
ok('INTI: `selJadwal` tidak lagi menyamarkan tugas luar jadi shift');

// Cuti tetap MENANG atas tugas luar: cuti yang sudah disetujui punya sumber
// kebenarannya sendiri (0113), dan sel yang dikunci karenanya tidak boleh
// terbuka cuma karena ada jadwal tugas luar di bawahnya.
assert.equal(selJadwal({ cuti: { jenis: 'Tahunan' }, jadwal: selTL }).mode, 'cuti');
assert.equal(selJadwal({ cuti: { jenis: 'Tahunan' }, jadwal: selTL }).terkunci, true);
ok('cuti yang disetujui tetap menang & tetap mengunci selnya');

const ringkas = ringkasBaris([
  selJadwal({ cuti: null, jadwal: selTL }),
  selJadwal({ cuti: null, jadwal: selTL }),
  selJadwal({ cuti: null, jadwal: { is_off: true } }),
  selJadwal({ cuti: null, jadwal: { shift_id: ID_SHIFT } }),
  selJadwal({ cuti: null, jadwal: null })
]);
assert.equal(ringkas.tugasLuar, 2);
// Tidak dilebur: ke `shift` membuat "5 shift minggu ini" terbaca penuh padahal
// 2 di antaranya tidak ada orangnya di outlet; ke `off` membuat orang yang
// justru bekerja terhitung libur.
assert.equal(ringkas.shift, 1);
assert.equal(ringkas.off, 1);
assert.equal(ringkas.kosong, 1);
ok('INTI: tugas luar dihitung tersendiri, bukan dilebur ke shift atau libur');

console.log('\n§6 Pemeriksaan & masukan aneh');

assert.equal(periksaSelTugasLuar({ isTugasLuar: false }, JENIS), null);
assert.match(periksaSelTugasLuar({ isTugasLuar: true, tugasLuarTypeId: '' }, JENIS), /jenis/i);
assert.match(periksaSelTugasLuar({ isTugasLuar: true, tugasLuarTypeId: 'hantu' }, JENIS), /tidak ada di daftar/i);
assert.equal(periksaSelTugasLuar({ isTugasLuar: true, tugasLuarTypeId: ID_JENIS }, JENIS), null);
ok('jenis yang tidak ada di daftar BU ini ditolak di layar, dengan kalimat yang bisa dikerjakan');

assert.equal(STATUS_PRESENSI_TUGAS_LUAR, 'tugas_luar');
ok('nama statusnya sama dengan yang ditulis database (0160)');

// Tidak satu pun melempar untuk masukan cacat.
assert.doesNotThrow(() => opsiSel(null, null));
assert.doesNotThrow(() => opsiSel(undefined, [{ nama: 'tanpa id' }]));
assert.doesNotThrow(() => bacaNilaiSel(undefined));
assert.doesNotThrow(() => nilaiSel({ is_tugas_luar: true }));
assert.doesNotThrow(() => keteranganClockIn(undefined, undefined, undefined));
// Baris tanpa `id` dibuang, bukan jadi pilihan yang nilainya `'tl:undefined'`.
assert.equal(opsiSel([], [{ nama: 'tanpa id' }]).length, 2);
ok('masukan cacat tidak melempar, dan tidak menghasilkan pilihan rusak');

console.log('\n§7 Warna sel');

// ============ WARNA DIKUNCI KE ID, BUKAN KE URUTAN ============
//
// Ini pemeriksaan terpenting di bagian ini. Jadwal dibaca dengan MATA lewat
// warna — jadi warna yang berpindah arti lebih buruk daripada tidak berwarna
// sama sekali: orang membaca jadwal yang sama dengan keyakinan penuh dan
// kesimpulan yang salah.
const w = kelasWarnaShift(ID_SHIFT);
assert.match(w, /^shift-w[1-5]$/);
assert.equal(kelasWarnaShift(ID_SHIFT), w);
ok('warna satu shift selalu sama untuk id yang sama');

// Menambah shift baru TIDAK menggeser warna shift yang sudah ada — itu yang
// tidak bisa dijamin kalau warnanya mengikuti urutan di daftar.
const sebelum = [ID_SHIFT, 'f1', 'f2'].map(kelasWarnaShift);
const sesudah = ['shift-baru-di-urutan-pertama', ID_SHIFT, 'f1', 'f2'].map(kelasWarnaShift).slice(1);
assert.deepEqual(sesudah, sebelum);
ok('INTI: menambah shift baru tidak menggeser warna shift yang sudah dikenal');

// Id kosong tidak dipaksa jadi warna pertama: sel tanpa shift tidak boleh
// terlihat seperti shift yang sah.
assert.equal(kelasWarnaShift(''), '');
assert.equal(kelasWarnaShift(null), '');
assert.equal(kelasWarnaShift(undefined), '');
ok('id kosong tidak menghasilkan warna shift');

// Hasilnya selalu di dalam palet — `%` atas angka negatif akan memulangkan
// kelas yang tidak ada di CSS, dan selnya kehilangan warna tanpa galat.
const dipakai = new Set();
for (let i = 0; i < 400; i++) {
  const k = kelasWarnaShift(`shift-${i}-${i * 7919}`);
  assert.match(k, /^shift-w[1-5]$/, k);
  dipakai.add(k);
}
assert.equal(dipakai.size, JUMLAH_WARNA_SHIFT);
ok(`400 id acak jatuh ke ${JUMLAH_WARNA_SHIFT} kelas yang ada, dan kelimanya terpakai`);

// ============ TUGAS LUAR TIDAK BOLEH SEWARNA CUTI ============
assert.equal(kelasWarnaSel(selTL), KELAS_TUGAS_LUAR);
assert.notEqual(KELAS_TUGAS_LUAR, KELAS_CUTI);
assert.notEqual(KELAS_TUGAS_LUAR, KELAS_LIBUR);
ok('INTI: tugas luar punya kelas sendiri, bukan kelas cuti maupun libur');

assert.equal(kelasWarnaSel({ is_off: true }), KELAS_LIBUR);
assert.equal(kelasWarnaSel({ shift_id: ID_SHIFT }), w);
assert.equal(kelasWarnaSel(null), '');
// Cuti menang atas apa pun — urutannya sama dengan `selJadwal`.
assert.equal(kelasWarnaSel(selTL, { cuti: true }), KELAS_CUTI);
ok('keempat keadaan dapat kelasnya masing-masing, dan cuti menang');

console.log(`\n${n} pemeriksaan tugas luar lolos. ✅`);
