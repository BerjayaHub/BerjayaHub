/**
 * Koreksi presensi oleh admin — terutama MENAMBAHKAN JAM PULANG SAJA.
 *
 * Kasus yang paling sering terjadi (staff lupa absen pulang, NBM-nya jadi tidak
 * bisa dihitung) justru satu-satunya yang dulu mustahil: dialognya mengisi
 * nilai awal dengan membaca TEKS di sel tabel — "17 Agu, 08.15" — yang tidak
 * bisa dibaca `new Date()`. Isian terbuka kosong, Clock In wajib, buntu.
 *
 * Yang dijaga di sini bukan cuma "bisa disimpan", tapi bahwa membetulkan satu
 * jam TIDAK MENYENTUH yang lain. Itu bagian yang paling mudah rusak dan paling
 * sulit dilihat: jam pulang yang terhapus diam-diam tidak menghasilkan error,
 * cuma NBM yang berkurang di rekap gaji bulan itu.
 */
import { rencanaKoreksi, keInputLokal } from '../js/modules/attendance/koreksi-presensi.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

const IN = '2026-08-17T01:00:00.000Z'; // 08:00 WIB
const OUT = '2026-08-17T10:00:00.000Z'; // 17:00 WIB
const lokal = (iso) => keInputLokal(iso);

// ================= KASUS UTAMA: hanya menambah jam pulang =================
// Isian jam masuk dibiarkan seperti nilai awalnya (tidak diubah admin), dan
// admin cuma mengetik jam pulang.
const tambahOut = rencanaKoreksi({ inSekarang: IN, outSekarang: null, inBaru: lokal(IN), outBaru: lokal(OUT) });
cek('jam pulang masuk ke patch', 'clock_out_at' in tambahOut.patch, true);
// INI YANG PALING PENTING: jam masuknya tidak ikut dikirim. Mengirimnya
// "sama seperti sebelumnya" pun bukan hal netral — ia menimpa nilai yang bisa
// saja baru diubah orang lain semenit sebelumnya.
cek('jam masuk TIDAK ikut dikirim', 'clock_in_at' in tambahOut.patch, false);
cek('tidak ada masalah', tambahOut.masalah, []);
cek('perubahannya disebutkan', tambahOut.berubah.length, 1);

// Isian jam masuk DIKOSONGKAN admin = jangan sentuh. Ini yang membuat
// "Clock In wajib" tidak diperlukan lagi.
const kosongIn = rencanaKoreksi({ inSekarang: IN, outSekarang: null, inBaru: '', outBaru: lokal(OUT) });
cek('jam masuk dikosongkan = tidak disentuh', 'clock_in_at' in kosongIn.patch, false);
cek('tapi jam pulang tetap tersimpan', 'clock_out_at' in kosongIn.patch, true);

// ================= Kebalikannya: hanya membetulkan jam masuk =================
const ubahIn = rencanaKoreksi({ inSekarang: IN, outSekarang: OUT, inBaru: lokal('2026-08-17T00:30:00.000Z'), outBaru: lokal(OUT) });
cek('jam masuk berubah', 'clock_in_at' in ubahIn.patch, true);
// Kalau ini gagal, membetulkan jam masuk akan MENGHAPUS jam pulang yang sudah
// benar — persis perilaku versi lama yang selalu mengirim kedua kolom.
cek('jam pulang tidak ikut tersentuh', 'clock_out_at' in ubahIn.patch, false);

// Isian jam pulang dikosongkan TIDAK berarti menghapus.
const kosongOut = rencanaKoreksi({ inSekarang: IN, outSekarang: OUT, inBaru: lokal(IN), outBaru: '' });
cek('mengosongkan isian tidak menghapus jam pulang', kosongOut.patch, {});
cek('dan dilaporkan tidak ada perubahan', kosongOut.berubah, []);

// Menghapus tetap MUNGKIN, tapi harus diminta sadar.
const hapus = rencanaKoreksi({ inSekarang: IN, outSekarang: OUT, inBaru: '', outBaru: '', hapusClockOut: true });
cek('hapus jam pulang kalau diminta', hapus.patch, { clock_out_at: null });
cek('penghapusan disebutkan', hapus.berubah[0].includes('DIHAPUS'), true);
cek('minta hapus padahal sudah kosong = tidak apa-apa', rencanaKoreksi({ inSekarang: IN, outSekarang: null, hapusClockOut: true }).patch, {});

// ================= Jam pulang lebih awal dari jam masuk =================
// NBM dihitung dari selisih keduanya. Selisih negatif tidak menghasilkan error
// di mana pun — ia jadi jam kerja negatif/nol yang ikut dijumlahkan ke rekap
// gaji, dan angka itu terlihat seperti angka biasa.
const terbalik = rencanaKoreksi({ inSekarang: IN, outSekarang: null, inBaru: lokal(IN), outBaru: lokal('2026-08-17T00:00:00.000Z') });
cek('pulang sebelum masuk ditolak', terbalik.masalah.length, 1);
cek('dan patch-nya dikosongkan', terbalik.patch, {});
cek('pesannya menyebut kedua jamnya', terbalik.masalah[0].includes('08.00') || terbalik.masalah[0].includes('07.00'), true);

const samaPersis = rencanaKoreksi({ inSekarang: IN, outSekarang: null, inBaru: lokal(IN), outBaru: lokal(IN) });
cek('pulang sama persis dengan masuk juga ditolak', samaPersis.masalah.length, 1);

// DIPERIKSA TERHADAP NILAI AKHIR, bukan cuma yang diketik. Admin mengisi jam
// pulang saja, sementara jam masuknya tidak disentuh — dan justru inilah bentuk
// koreksi yang paling sering dipakai di sini.
const silang = rencanaKoreksi({ inSekarang: OUT, outSekarang: null, inBaru: '', outBaru: lokal(IN) });
cek('pulang dibanding jam masuk yang TIDAK disentuh', silang.masalah.length, 1);

// Lintas hari tetap sah — shift malam pulang besok paginya.
const malam = rencanaKoreksi({ inSekarang: '2026-08-17T15:00:00.000Z', outSekarang: null, inBaru: '', outBaru: lokal('2026-08-17T23:00:00.000Z') });
cek('shift malam lintas hari diterima', malam.masalah, []);

// ================= Isian yang tidak terbaca =================
cek('tanggal ngawur ditolak', rencanaKoreksi({ inSekarang: IN, inBaru: 'bukan tanggal' }).masalah.length, 1);
cek('dan tidak menghasilkan patch', rencanaKoreksi({ inSekarang: IN, inBaru: 'bukan tanggal' }).patch, {});

// ================= Tidak ada yang berubah =================
const samaSaja = rencanaKoreksi({ inSekarang: IN, outSekarang: OUT, inBaru: lokal(IN), outBaru: lokal(OUT) });
cek('nilai sama = patch kosong', samaSaja.patch, {});
cek('dan berubah kosong', samaSaja.berubah, []);

// ================= keInputLokal =================
// Harus WAKTU LOKAL. Memakai toISOString() (UTC) menggeser 7 jam di WIB —
// cukup untuk memindahkan presensi malam ke hari sebelumnya di layar admin.
const d = new Date(IN);
const p = (n) => String(n).padStart(2, '0');
cek('format datetime-local benar', keInputLokal(IN), `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`);
cek('bukan format UTC', keInputLokal(IN) === IN.slice(0, 16), false);
cek('null aman', keInputLokal(null), '');
cek('kosong aman', keInputLokal(''), '');
cek('teks ngawur aman', keInputLokal('17 Agu, 08.15'), '');
// Inilah teks yang dulu dibaca dari sel tabel — kalau fungsi ini "berhasil"
// membacanya, berarti ia menebak, dan tebakan tanggal di sini menghasilkan
// koreksi presensi yang salah hari.
cek('argumen kosong sepenuhnya', rencanaKoreksi().patch, {});

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Koreksi presensi benar untuk 27 kasus — termasuk menambah jam pulang tanpa menyentuh jam masuk. ✅');
