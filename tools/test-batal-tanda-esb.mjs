/**
 * TES: aturan membatalkan tanda ekspor ESB.
 *
 * Yang dijaga: alasan yang sekadarnya ditolak, jejak lama tidak disalahbaca
 * sebagai "tanda sedang terbuka", dan "berhasil" tidak pernah berbohong.
 */
import assert from 'node:assert/strict';
import {
  alasanSah,
  keadaanTanda,
  sedangBertanda,
  jejakBatal,
  susunDaftarBertanda,
  hasilPembatalan,
  PANJANG_ALASAN_MIN,
  PERINGATAN_ESB
} from '../js/modules/inventory/batal-tanda-esb.js';

let n = 0;
const ok = (nama) => {
  n += 1;
  console.log(`  ✔ ${nama}`);
};

console.log('§1 Alasan');

for (const buruk of [null, undefined, '', '   ', 'x', 'salah', '  ok  ']) {
  assert.equal(alasanSah(buruk).boleh, false, `${JSON.stringify(buruk)} seharusnya ditolak`);
}
ok('kosong, spasi, dan alasan terlalu pendek ditolak');

assert.equal(alasanSah('salah ungg').boleh, true);
assert.equal(alasanSah('salah ungg').alasan.length, PANJANG_ALASAN_MIN);
ok(`pas ${PANJANG_ALASAN_MIN} huruf diterima`);

assert.equal(alasanSah('   berkasnya ditolak ESB   ').alasan, 'berkasnya ditolak ESB');
ok('spasi tepinya dirapikan sebelum disimpan');

// Panjangnya dihitung SESUDAH dirapikan. Kalau tidak, sebelas spasi lolos
// sebagai alasan sebelas huruf — dan jejaknya berisi kekosongan.
assert.equal(alasanSah('           ').boleh, false);
ok('sebelas spasi bukan alasan sebelas huruf');

assert.match(alasanSah('x').sebab, /ditolak ESB/);
assert.match(alasanSah('x').sebab, /hapus manual/);
ok('sebab penolakannya memberi tahu APA yang perlu ditulis, bukan cuma berapa hurufnya');

assert.match(PERINGATAN_ESB, /TIDAK menghapus/);
assert.match(PERINGATAN_ESB, /ganda/);
ok('peringatannya menyebut dokumennya tetap ada di ESB dan risikonya pembelian ganda');

console.log('\n§2 Keadaan tanda');

const T1 = '2026-09-01T10:00:00Z';
const T2 = '2026-09-02T10:00:00Z';

assert.equal(keadaanTanda({ esb_exported_at: T1, esb_dibatalkan_at: null }), 'bertanda');
assert.equal(keadaanTanda({ esb_exported_at: null, esb_dibatalkan_at: null }), 'terbuka');
ok('bertanda vs terbuka ditentukan oleh esb_exported_at');

assert.equal(keadaanTanda({ esb_exported_at: null, esb_dibatalkan_at: T1 }), 'terbuka');
ok('tanda kosong + jejak ada = sedang terbuka');

// INI jebakannya. Kolom jejak TIDAK dikosongkan saat notanya diekspor ulang
// (0143), jadi "esb_dibatalkan_at ada" bukan berarti "tandanya terbuka".
assert.equal(keadaanTanda({ esb_exported_at: T2, esb_dibatalkan_at: T1 }), 'pernah-dibuka');
ok('jejak LEBIH TUA dari tanda ekspornya = pernah dibuka, lalu diekspor lagi');

assert.equal(sedangBertanda({ esb_exported_at: T2, esb_dibatalkan_at: T1 }), true);
ok('dan baris seperti itu tetap terkunci — masih boleh muncul untuk dibuka lagi');

assert.equal(sedangBertanda({ esb_exported_at: null, esb_dibatalkan_at: T1 }), false);
ok('yang sudah terbuka TIDAK muncul lagi di daftar');

// Waktu yang tidak terbaca tidak boleh diam-diam dianggap "tidak ada".
assert.equal(keadaanTanda({ esb_exported_at: 'kemarin' }), 'terbuka');
assert.equal(keadaanTanda({}), 'terbuka');
assert.equal(keadaanTanda(null), 'terbuka');
ok('nilai yang tidak terbaca jatuh ke "terbuka" — layar menampilkannya, bukan menyembunyikannya');

console.log('\n§3 Jejak siap-tampil');

assert.equal(jejakBatal({ esb_exported_at: T1 }), null);
ok('tanpa pembatalan, tidak ada jejak yang ditampilkan');

const j = jejakBatal(
  { esb_exported_at: null, esb_dibatalkan_at: T1, esb_alasan_batal: 'ditolak ESB', pembatal: { full_name: 'Iko' } },
  (v) => `<${v}>`
);
assert.equal(j.oleh, 'Iko');
assert.equal(j.waktu, `<${T1}>`);
assert.equal(j.alasan, 'ditolak ESB');
assert.equal(j.sudahDieksporLagi, false);
ok('jejaknya memuat siapa, kapan, dan kenapa');

const j2 = jejakBatal({ esb_exported_at: T2, esb_dibatalkan_at: T1, pembatal: { full_name: 'Iko' } });
assert.equal(j2.sudahDieksporLagi, true);
ok('dan menandai kalau sesudah dibuka ia diekspor lagi');

// RLS bisa memblokir sumber daya tersemat dan mengembalikannya sebagai null —
// itu sudah menggigit di laporan kas. Namanya hilang, jejaknya tidak boleh ikut.
assert.equal(jejakBatal({ esb_dibatalkan_at: T1, pembatal: null }).oleh, 'tidak diketahui');
ok('nama pembatal yang tidak terbaca tidak menghapus jejaknya');

console.log('\n§4 Daftar');

const baris = [
  { id: 'a', code: 'TRM-03', esb_exported_at: T1 },
  { id: 'b', code: 'TRM-01', esb_exported_at: T2 },
  { id: 'c', code: 'TRM-02', esb_exported_at: null, esb_dibatalkan_at: T2 },
  { id: 'd', code: 'TRM-04', esb_exported_at: T2 }
];
const d = susunDaftarBertanda(baris);
assert.deepEqual(d.map((r) => r.id), ['b', 'd', 'a']);
ok('yang sudah terbuka dibuang, sisanya terbaru dulu');

assert.deepEqual(susunDaftarBertanda([]), []);
assert.deepEqual(susunDaftarBertanda(null), []);
ok('masukan kosong tidak melempar');

// Sumbernya tidak boleh ikut berubah: layar memakai daftar yang sama untuk
// hal lain, dan pengurutan di tempat adalah cara paling senyap merusaknya.
const asli = [...baris];
susunDaftarBertanda(baris);
assert.deepEqual(baris, asli);
ok('daftar aslinya tidak diurut di tempat');

console.log('\n§5 Hasil tidak berbohong');

assert.equal(hasilPembatalan(3, 3).nada, 'success');
ok('semua terbuka = success');

// Inilah yang menjaga "berhasil" tetap jujur: database melewati baris milik BU
// lain, atau yang tandanya sudah dibuka orang lain, TANPA melempar galat.
const separuh = hasilPembatalan(5, 2);
assert.equal(separuh.nada, 'warning');
assert.match(separuh.pesan, /2 dari 5/);
ok('sebagian terbuka = warning, dan angkanya disebut');

const nol = hasilPembatalan(4, 0);
assert.equal(nol.nada, 'error');
assert.match(nol.pesan, /Tidak ada/);
ok('tidak ada yang terbuka = error, bukan "berhasil" dengan angka nol');

assert.equal(hasilPembatalan(2, null).nada, 'error');
assert.equal(hasilPembatalan(2, undefined).nada, 'error');
ok('angka yang tidak terbaca dari database diperlakukan sebagai nol, bukan sebagai sukses');

console.log(`\n${n} pemeriksaan pembatalan tanda ESB lolos. ✅`);
