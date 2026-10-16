/**
 * TES: aturan modul Konten Sosmed.
 *
 *   §1 Tenggat mingguan — termasuk "hari ini masih sempat".
 *   §2 Keadaan tugas: telat hanya untuk yang belum setor.
 *   §3 Brief berjenjang, dan ASALNYA ikut disebut.
 *   §4 Kelengkapan: menyebut apa yang KURANG.
 *   §5 Boleh-tidaknya menambah berkas.
 *   §6 Ringkasan antrean admin.
 *   §7 Masukan aneh tidak melempar.
 */
import assert from 'node:assert/strict';
import {
  tenggatMingguIni,
  tenggatSebelumnya,
  sisaHari,
  keTanggal,
  keadaanTugas,
  briefEfektif,
  BRIEF_BAWAAN,
  ASAL_BRIEF,
  kelengkapan,
  pesanKelengkapan,
  bolehTambah,
  ringkasAntrean,
  pesanAntrean,
  MAKS_BERKAS,
  NAMA_HARI,
  STATUS
} from '../js/modules/konten/aturan-konten.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

console.log('§1 Tenggat mingguan');

// 2026-10-19 adalah Senin (getUTCDay = 1).
assert.equal(new Date('2026-10-19T00:00:00Z').getUTCDay(), 1);
assert.equal(tenggatMingguIni('2026-10-19', 5), '2026-10-23'); // Senin -> Jumat
assert.equal(tenggatMingguIni('2026-10-19', 1), '2026-10-19'); // Senin -> Senin ini
assert.equal(tenggatMingguIni('2026-10-19', 0), '2026-10-25'); // Senin -> Minggu depan
ok('tenggat jatuh pada hari setor berikutnya di minggu berjalan');

// ============ HARI INI MASIH SEMPAT ============
//
// Kalau hari setornya Jumat dan hari ini Jumat, tenggatnya HARI INI. Tanpa itu,
// staff yang membuka aplikasi pagi hari tenggatnya melihat tugas yang jatuh
// tempo seminggu lagi, menganggap belum waktunya, dan tenggat hari itu lewat
// tanpa pernah terlihat.
assert.equal(tenggatMingguIni('2026-10-23', 5), '2026-10-23');
assert.notEqual(tenggatMingguIni('2026-10-23', 5), '2026-10-30');
ok('INTI: hari setor yang jatuh HARI INI tidak dilempar ke minggu depan');

assert.equal(tenggatSebelumnya('2026-10-23'), '2026-10-16');
assert.equal(sisaHari('2026-10-19', '2026-10-23'), 4);
assert.equal(sisaHari('2026-10-25', '2026-10-23'), -2);
assert.equal(sisaHari('2026-10-23', '2026-10-23'), 0);
ok('periode sebelumnya & sisa hari dihitung benar, termasuk yang negatif');

assert.equal(NAMA_HARI[5], 'Jumat');
assert.equal(NAMA_HARI.length, 7);
ok('nama hari sejajar dengan indeks `getUTCDay`/`extract(dow)`');

console.log('\n§2 Keadaan tugas');

const telat = keadaanTugas({ status: STATUS.BELUM, tenggat: '2026-10-23' }, '2026-10-26');
assert.equal(telat.telat, true);
assert.equal(telat.sisaHari, -3);

// ============ YANG SUDAH SETOR TIDAK DITERIAKI LAGI ============
//
// Tugas yang disetor sehari sesudah tenggat pekerjaannya sudah dilakukan.
// Menandainya merah terus-menerus membuat warna merah berhenti berarti apa pun
// di layar ini.
const setorTelat = keadaanTugas({ status: STATUS.DISETOR, tenggat: '2026-10-23' }, '2026-10-26');
assert.equal(setorTelat.telat, false);
assert.equal(keadaanTugas({ status: STATUS.SELESAI, tenggat: '2026-10-23' }, '2026-10-26').telat, false);
ok('INTI: `telat` hanya untuk yang BELUM setor');

assert.equal(keadaanTugas({ status: STATUS.BELUM, tenggat: '2026-10-23' }, '2026-10-23').jatuhTempoHariIni, true);
assert.equal(keadaanTugas({ status: STATUS.BELUM, tenggat: '2026-10-23' }, '2026-10-22').jatuhTempoHariIni, false);
ok('jatuh tempo hari ini dibedakan dari yang masih punya sisa waktu');

// Berkas yang sudah dibersihkan harus bisa DIKATAKAN layar — bukan jadi
// pemutar video kosong yang dilaporkan sebagai bug.
assert.equal(keadaanTugas({ status: STATUS.SELESAI, berkas_dihapus_at: '2026-11-01T00:00:00Z' }, '2026-11-02').berkasDihapus, true);
assert.equal(keadaanTugas({ status: STATUS.SELESAI }, '2026-11-02').berkasDihapus, false);
ok('INTI: berkas yang sudah dihapus otomatis bisa dikenali layar');

console.log('\n§3 Brief berjenjang');

assert.equal(briefEfektif({ briefTugas: 'Ambil latte art' }).teks, 'Ambil latte art');
assert.equal(briefEfektif({ briefTugas: 'Ambil latte art' }).asal, 'tugas');
assert.equal(briefEfektif({ briefTetapOutlet: 'Fokus suasana sore' }).asal, 'outlet');
assert.equal(briefEfektif({}).asal, 'bawaan');
assert.equal(briefEfektif({}).teks, BRIEF_BAWAAN);
ok('tugas menang atas outlet, outlet menang atas bawaan');

// Brief berisi spasi saja bukan brief. Tanpa `trim`, admin yang tidak sengaja
// menekan spasi membuat staff membaca layar kosong — dan admin mengira
// brief-nya tersimpan.
assert.equal(briefEfektif({ briefTugas: '   ', briefTetapOutlet: 'Fokus sore' }).asal, 'outlet');
assert.equal(briefEfektif({ briefTugas: '  ', briefTetapOutlet: '  ' }).asal, 'bawaan');
ok('INTI: brief berisi spasi saja turun ke jenjang berikutnya');

// Brief bawaan harus menyebut angkanya, karena itulah seluruh isinya.
assert.match(BRIEF_BAWAAN, /1 video/);
assert.match(BRIEF_BAWAAN, /1 foto/);
assert.match(BRIEF_BAWAAN, new RegExp(`${MAKS_BERKAS} berkas`));
ok('brief bawaan menyebut minimal & maksimalnya');

// Asalnya punya kalimat yang bisa ditampilkan — supaya admin tahu teks mana
// yang sedang dibaca staff, bukan menebak.
assert.ok(ASAL_BRIEF.bawaan && ASAL_BRIEF.outlet && ASAL_BRIEF.tugas);
assert.match(ASAL_BRIEF.bawaan, /belum mengisi/i);
ok('INTI: asal brief punya kalimat untuk ditampilkan di Admin Portal');

console.log('\n§4 Kelengkapan');

const kosong = kelengkapan([]);
assert.equal(kosong.lengkap, false);
assert.equal(kosong.sisaSlot, MAKS_BERKAS);
assert.match(pesanKelengkapan(kosong), /Belum ada/);

const videoSaja = kelengkapan([{ jenis: 'video' }]);
assert.equal(videoSaja.lengkap, false);
assert.deepEqual(videoSaja.kurang, ['1 foto']);
// Menyebut apa yang KURANG, bukan sekadar "belum lengkap".
assert.match(pesanKelengkapan(videoSaja), /Kurang 1 foto/);
ok('INTI: kalimatnya menyebut apa yang kurang, bukan cuma "belum lengkap"');

const pas = kelengkapan([{ jenis: 'video' }, { jenis: 'foto' }]);
assert.equal(pas.lengkap, true);
assert.equal(pas.penuh, false);
assert.match(pesanKelengkapan(pas), /masih bisa menambah 1/i);

const penuh = kelengkapan([{ jenis: 'video' }, { jenis: 'foto' }, { jenis: 'foto' }]);
assert.equal(penuh.penuh, true);
assert.equal(penuh.sisaSlot, 0);
assert.match(pesanKelengkapan(penuh), /Batas 3 berkas/);
ok('lengkap, penuh, dan sisa slot dibedakan');

console.log('\n§5 Boleh tambah');

assert.equal(bolehTambah([], { jenis: 'video' }).boleh, true);
assert.equal(bolehTambah(penuh2(), { jenis: 'foto' }).boleh, false);
function penuh2() {
  return [{ jenis: 'video' }, { jenis: 'foto' }, { jenis: 'foto' }];
}
assert.match(bolehTambah(penuh2(), { jenis: 'foto' }).alasan, /Hapus salah satu/);
ok('berkas keempat ditolak dengan jalan keluarnya');

assert.equal(bolehTambah([], { jenis: 'dokumen' }).boleh, false);
ok('jenis selain video/foto ditolak');

const MAKS = 100 * 1024 * 1024;
assert.equal(bolehTambah([], { jenis: 'video', ukuran: 50 * 1024 * 1024 }, { maksByte: MAKS }).boleh, true);
const kebesaran = bolehTambah([], { jenis: 'video', ukuran: 150 * 1024 * 1024 }, { maksByte: MAKS });
assert.equal(kebesaran.boleh, false);
// Pesannya menyebut CARA memperbaikinya. "File terlalu besar" meninggalkan
// staff tanpa satu pun langkah yang bisa dikerjakan.
assert.match(kebesaran.alasan, /100 MB/);
assert.match(kebesaran.alasan, /setelan kamera|durasi/i);
ok('INTI: berkas kebesaran ditolak dengan cara memperbaikinya');

// ============ UKURAN YANG TIDAK TERBACA BUKAN NOL ============
//
// `Number(null)` dan `Number('')` adalah 0, dan 0 lolos pemeriksaan "lebih
// besar dari batas" seolah berkasnya kosong. Yang tidak diketahui harus
// diperlakukan sebagai tidak diketahui.
assert.equal(bolehTambah([], { jenis: 'video', ukuran: null }, { maksByte: MAKS }).boleh, true);
assert.equal(bolehTambah([], { jenis: 'video', ukuran: '' }, { maksByte: MAKS }).boleh, true);
assert.equal(bolehTambah([], { jenis: 'video' }, { maksByte: MAKS }).boleh, true);
ok('INTI: ukuran yang tidak terbaca tidak dianggap nol');

// Tanpa batas disetel, ukuran tidak pernah menolak.
assert.equal(bolehTambah([], { jenis: 'video', ukuran: 9e12 }).boleh, true);
ok('tanpa batas ukuran, berkas sebesar apa pun lolos pemeriksaan ini');

console.log('\n§6 Ringkasan antrean');

const antrean = [
  { status: STATUS.BELUM, tenggat: '2026-10-23' },
  { status: STATUS.BELUM, tenggat: '2026-10-30' },
  { status: STATUS.DISETOR, tenggat: '2026-10-23' },
  { status: STATUS.SELESAI, tenggat: '2026-10-16' }
];
const r = ringkasAntrean(antrean, '2026-10-26');
assert.equal(r.total, 4);
assert.equal(r.belum, 2);
assert.equal(r.telat, 1); // yang tenggat 23 Okt; yang 30 Okt belum lewat
assert.equal(r.disetor, 1);
assert.equal(r.selesai, 1);
ok('INTI: telat dihitung terpisah dan hanya dari yang belum setor');

// Pekerjaan yang ADA disebut lebih dulu — itu antrean editingnya.
assert.match(pesanAntrean(r), /1 menunggu kamu tandai selesai/);
assert.match(pesanAntrean(r), /1 lewat tenggat/);
ok('kalimatnya mendahulukan pekerjaan yang menunggu');

const beres = ringkasAntrean([{ status: STATUS.SELESAI, tenggat: '2026-10-16' }], '2026-10-26');
assert.match(pesanAntrean(beres), /Semua beres/);
assert.match(pesanAntrean(ringkasAntrean([], '2026-10-26')), /Belum ada outlet/);
ok('keadaan beres & daftar kosong punya kalimatnya sendiri');

console.log('\n§7 Masukan aneh');

assert.equal(tenggatMingguIni('bukan tanggal', 5), '');
assert.equal(tenggatMingguIni('2026-10-19', 9), '');
// `Number(null)` adalah 0 — hari Minggu yang sah. Tanpa penjaga eksplisit,
// outlet yang hari setornya kosong diam-diam dapat tenggat hari Minggu alih-alih
// ditolak. Pemeriksaan inilah yang menemukannya.
assert.equal(tenggatMingguIni('2026-10-19', null), '');
assert.equal(tenggatMingguIni('2026-10-19', undefined), '');
assert.equal(tenggatMingguIni('2026-10-19', ''), '');
// Tapi 0 yang SUNGGUHAN tetap berarti Minggu.
assert.equal(tenggatMingguIni('2026-10-19', 0), '2026-10-25');
assert.equal(sisaHari(null, null), null);
ok('tanggal/hari yang tidak masuk akal memulangkan kosong, bukan tanggal karangan');

// `keTanggal` tidak boleh MEMOTONG sampah sampai terlihat seperti tanggal —
// jebakan yang sudah pernah menggigit di modul lain.
assert.equal(keTanggal('Fri Oct 23 2026'), '');
assert.equal(keTanggal('2026-10-23T11:00:00Z'), '2026-10-23');
assert.equal(keTanggal(new Date('2026-10-23T00:00:00Z')), '2026-10-23');
assert.equal(keTanggal(undefined), '');
ok('INTI: teks yang bukan tanggal tidak dipotong jadi tanggal palsu');

assert.doesNotThrow(() => kelengkapan(null));
assert.doesNotThrow(() => keadaanTugas(null, null));
assert.doesNotThrow(() => ringkasAntrean(null, null));
// `= {}` pada destrukturisasi hanya menangkap `undefined`, bukan `null` —
// jadi hasil pencarian yang gagal mematikan layarnya dengan galat yang tidak
// menyebut apa pun tentang brief.
assert.doesNotThrow(() => briefEfektif(null));
assert.doesNotThrow(() => bolehTambah([], { jenis: 'foto' }, null));
assert.doesNotThrow(() => pesanAntrean(null));
assert.equal(kelengkapan(null).total, 0);
assert.equal(briefEfektif(null).asal, 'bawaan');
ok('masukan kosong/cacat tidak melempar');

console.log(`\n${n} pemeriksaan aturan konten lolos. ✅`);
