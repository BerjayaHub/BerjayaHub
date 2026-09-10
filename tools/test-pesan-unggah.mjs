/**
 * Tes penerjemahan galat unggah foto nota.
 *
 * "Bucket not found" adalah jawaban yang benar dan sama sekali tidak berguna
 * bagi staff outlet yang sedang memegang nota kertas di depan supplier. Yang
 * ingin ia ketahui saat itu juga: apa yang hilang, apakah ia yang salah, dan
 * apakah pekerjaannya barusan ikut hilang.
 *
 * Jalankan: node tools/test-pesan-unggah.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// `new URL(...).pathname` mengembalikan jalur yang masih ter-encode —
// "Berjaya%20HUB", yang tidak ada di disk. `fileURLToPath` yang menerjemahkannya.
import { fileURLToPath } from 'node:url';
import { pesanGagalUnggah, karenaBucketHilang } from '../js/modules/inventory/pesan-unggah.js';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let lulus = 0;
const uji = (nama, fn) => {
  try {
    fn();
    lulus += 1;
    console.log(`  ok  ${nama}`);
  } catch (e) {
    console.error(`  GAGAL  ${nama}\n        ${e.message}`);
    process.exitCode = 1;
  }
};

console.log('\n== §1 Bucket hilang — yang dilaporkan pengguna ==');

uji('"Bucket not found" jadi kalimat yang menyebut sebab & langkahnya', () => {
  const p = pesanGagalUnggah({ message: 'Bucket not found' });
  assert.ok(!/bucket/i.test(p), `pesan teknisnya masih bocor: ${p}`);
  assert.ok(/belum disiapkan di server/i.test(p), p);
  assert.ok(/0130/.test(p), 'harus menyebut migration mana yang memperbaikinya');
});

uji('dan menegaskan notanya TETAP bisa disimpan', () => {
  // Ini bagian terpentingnya. Tanpa kalimat itu, orangnya menyimpulkan seluruh
  // pekerjaannya batal dan mengulang dari awal — atau tidak mencatat sama
  // sekali sampai admin turun tangan.
  const p = pesanGagalUnggah({ message: 'Bucket not found' });
  assert.ok(/tetap bisa disimpan tanpa foto/i.test(p), p);
  assert.ok(/\+ Foto/.test(p), 'harus menyebut cara menambahkan fotonya nanti');
});

uji('varian kalimat Storage lain untuk sebab yang sama ikut tertangkap', () => {
  for (const m of ['Bucket not found', 'The resource was not found: no such bucket', 'bucket does not exist']) {
    assert.ok(/belum disiapkan di server/i.test(pesanGagalUnggah({ message: m })), m);
  }
});

console.log('\n== §2 Sebab lain dibedakan, bukan disamaratakan ==');

uji('ditolak RLS -> mengarah ke outlet yang aktif, bukan ke admin', () => {
  const p = pesanGagalUnggah({ message: 'new row violates row-level security policy' });
  assert.ok(/tidak berhak/i.test(p), p);
  assert.ok(/outlet/i.test(p), p);
  assert.ok(!/0130/.test(p), 'menyuruh menjalankan migration untuk masalah izin akan menyesatkan admin');
});

uji('berkas terlalu besar -> menyuruh ambil ulang, bukan menyalahkan server', () => {
  const p = pesanGagalUnggah({ message: 'Payload too large' });
  assert.ok(/terlalu besar/i.test(p), p);
  assert.ok(!/belum disiapkan/i.test(p), p);
});

uji('jaringan putus -> menawarkan simpan dulu, foto menyusul', () => {
  const p = pesanGagalUnggah({ message: 'Failed to fetch' });
  assert.ok(/jaringan/i.test(p), p);
  assert.ok(/menyusul|tanpa foto/i.test(p), p);
});

uji('galat yang tidak dikenali tetap ditampilkan apa adanya', () => {
  // Menelan galat yang tidak dikenali di balik kalimat ramah akan membuat
  // sebab yang baru mustahil dilacak.
  const p = pesanGagalUnggah({ message: 'sesuatu yang aneh terjadi' });
  assert.ok(p.includes('sesuatu yang aneh terjadi'), p);
});

uji('masukan aneh tidak melempar', () => {
  for (const x of [null, undefined, '', 'teks biasa', {}, new Error('boom')]) {
    assert.equal(typeof pesanGagalUnggah(x), 'string');
  }
});

console.log('\n== §3 Pengenalnya satu fungsi, bukan pencocokan teks yang tersebar ==');

uji('karenaBucketHilang mengenali pesan yang dihasilkan pesanGagalUnggah', () => {
  // Ini kontraknya. Layar memakai `karenaBucketHilang` untuk memutuskan apakah
  // menawarkan "Simpan tanpa foto"; kalau kalimatnya suatu saat diubah tanpa
  // mengubah penandanya, tawaran itu hilang tanpa satu pun error.
  assert.equal(karenaBucketHilang(pesanGagalUnggah({ message: 'Bucket not found' })), true);
});

uji('dan TIDAK mengenali sebab yang lain', () => {
  for (const m of ['Payload too large', 'Failed to fetch', 'new row violates row-level security policy', 'aneh']) {
    assert.equal(karenaBucketHilang(pesanGagalUnggah({ message: m })), false, m);
  }
});

uji('layar memakai fungsinya, bukan mencocokkan teks Inggris dari Storage', () => {
  const layar = fs.readFileSync(path.join(AKAR, 'js/modules/inventory/nota-staff.js'), 'utf8');

  // Kalau layarnya mencocokkan "Bucket not found" sendiri, ia berhenti bekerja
  // begitu penerjemahannya dipasang — persis perubahan yang baru saja dibuat.
  assert.ok(!/Bucket not found/i.test(layar), 'layar tidak boleh mencocokkan teks Inggris dari Storage');
  assert.ok(/karenaBucketHilang\(/.test(layar), 'layar harus memakai pengenal bersama');
  assert.ok(/Simpan tanpa foto/.test(layar), 'harus ada jalan keluar yang tidak menyandera notanya');
});

console.log(`\n${lulus} pemeriksaan lulus.`);
if (process.exitCode) console.error('ADA YANG GAGAL.');
