/**
 * Tes keadaan layar "Order ke CK" di sisi outlet.
 *
 * Jalankan: node tools/test-draft-outlet.mjs
 */

import assert from 'node:assert/strict';
import {
  draftBerjalan,
  orderMenunggu,
  draftGanda,
  keadaanOrderKeCk,
  labelTombolDraft,
  pesanKeadaan
} from '../js/modules/dispatch/draft-outlet.js';

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

const DRAFT = { id: 'd1', code: 'OR-260910-AAAA', status: 'draft', pembuat: { full_name: 'Risma' } };
const OPEN = { id: 'o1', code: 'OR-260909-BBBB', status: 'open' };
const SELESAI = { id: 'f1', code: 'OR-260908-CCCC', status: 'fulfilled' };
const BATAL = { id: 'c1', code: 'OR-260907-DDDD', status: 'cancelled' };

console.log('\n== §1 Menemukan draft yang masih berjalan ==');

uji('draft ditemukan di antara order lain', () => {
  assert.equal(draftBerjalan([SELESAI, DRAFT, OPEN])?.id, 'd1');
});

uji('tanpa draft: null, bukan undefined atau melempar', () => {
  assert.equal(draftBerjalan([SELESAI, OPEN, BATAL]), null);
});

uji('order selesai & batal TIDAK dianggap draft', () => {
  // Kalau ikut terhitung, layar akan menawarkan "buka draft" untuk order yang
  // sudah selesai berbulan-bulan lalu.
  assert.equal(draftBerjalan([SELESAI, BATAL]), null);
});

uji('masukan aneh tidak melempar', () => {
  for (const x of [null, undefined, 'bukan array', 42, [null, undefined]]) {
    assert.equal(draftBerjalan(x), null);
  }
});

console.log('\n== §2 Order yang sudah dikirim tapi belum diproses ==');

uji('hanya yang berstatus open', () => {
  assert.deepEqual(orderMenunggu([DRAFT, OPEN, SELESAI, BATAL]).map((o) => o.id), ['o1']);
});

uji('draft TIDAK ikut — ia belum dikirim ke CK sama sekali', () => {
  assert.deepEqual(orderMenunggu([DRAFT]), []);
});

console.log('\n== §3 Keadaan layar ==');

uji('ada draft -> mode ada-draft', () => {
  const k = keadaanOrderKeCk([DRAFT, SELESAI]);
  assert.equal(k.mode, 'ada-draft');
  assert.equal(k.draft.id, 'd1');
});

uji('tanpa draft tapi ada order menunggu -> mode menunggu', () => {
  const k = keadaanOrderKeCk([OPEN, SELESAI]);
  assert.equal(k.mode, 'menunggu');
  assert.equal(k.menunggu.length, 1);
});

uji('draft menang atas order menunggu', () => {
  // Draft adalah tempat yang bisa langsung ditambahi; order menunggu tidak.
  // Kalau urutannya terbalik, staff diarahkan ke dokumen yang terkunci.
  assert.equal(keadaanOrderKeCk([DRAFT, OPEN]).mode, 'ada-draft');
});

uji('kosong -> mode kosong, dan menunggu tetap array', () => {
  const k = keadaanOrderKeCk([SELESAI, BATAL]);
  assert.equal(k.mode, 'kosong');
  assert.deepEqual(k.menunggu, []);
});

uji('draft ganda dikenali sendiri, bukan diam-diam dipilih satu', () => {
  // Seharusnya mustahil sejak 0111 (unique index parsial). Tapi kalau
  // indeksnya suatu saat hilang, layar tidak boleh menyembunyikan yang kedua —
  // dua nomor yang keduanya "benar" menurut layar adalah dobel order yang
  // paling sulit dilacak.
  const D2 = { id: 'd2', code: 'OR-260910-EEEE', status: 'draft' };
  const k = keadaanOrderKeCk([DRAFT, D2]);
  assert.equal(k.mode, 'ada-draft-ganda');
  assert.equal(k.ganda.length, 2);
  assert.deepEqual(draftGanda([DRAFT, D2, OPEN]).map((o) => o.id), ['d1', 'd2']);
});

console.log('\n== §4 Label tombol menjawab sebelum ditekan ==');

uji('ada draft: tombolnya menyebut NOMOR draftnya', () => {
  const l = labelTombolDraft(keadaanOrderKeCk([DRAFT]));
  assert.ok(l.includes('OR-260910-AAAA'), l);
  assert.ok(/Buka/.test(l), l);
  assert.ok(!/Buat/.test(l), `"Buka / Buat" adalah dua kemungkinan dalam satu kalimat: ${l}`);
});

uji('tanpa draft: tombolnya jelas membuat yang baru', () => {
  const l = labelTombolDraft(keadaanOrderKeCk([]));
  assert.ok(/Buat/.test(l), l);
  assert.ok(!/Buka/.test(l), l);
});

uji('keadaan kosong/undefined tidak melempar', () => {
  assert.equal(typeof labelTombolDraft(undefined), 'string');
});

console.log('\n== §5 Pesannya menyebut siapa & berapa ==');

uji('menyebut nomor, pembuat, dan jumlah bahannya', () => {
  const p = pesanKeadaan(keadaanOrderKeCk([DRAFT]), { jumlahBaris: 7 });
  assert.ok(p.includes('OR-260910-AAAA'), p);
  assert.ok(p.includes('Risma'), p);
  assert.ok(p.includes('7 bahan'), p);
  assert.ok(/jangan buat order baru/i.test(p), p);
});

uji('draft kosong dikatakan kosong, bukan "0 bahan"', () => {
  const p = pesanKeadaan(keadaanOrderKeCk([DRAFT]), { jumlahBaris: 0 });
  assert.ok(/masih kosong/i.test(p), p);
});

uji('tanpa jumlah baris pun kalimatnya tetap utuh', () => {
  const p = pesanKeadaan(keadaanOrderKeCk([DRAFT]));
  assert.ok(p.includes('OR-260910-AAAA'), p);
  assert.ok(!p.includes('null'), p);
  assert.ok(!p.includes('undefined'), p);
});

uji('mode menunggu menyebut nomor order yang sudah dikirim', () => {
  const p = pesanKeadaan(keadaanOrderKeCk([OPEN]));
  assert.ok(p.includes('OR-260909-BBBB'), p);
  assert.ok(/dobel/i.test(p), p);
});

uji('mode kosong tidak menghasilkan peringatan apa pun', () => {
  assert.equal(pesanKeadaan(keadaanOrderKeCk([])), '');
});

uji('draft ganda menghasilkan peringatan yang bisa ditindaklanjuti', () => {
  const D2 = { id: 'd2', code: 'OR-2', status: 'draft' };
  const p = pesanKeadaan(keadaanOrderKeCk([DRAFT, D2]));
  assert.ok(/2 draft/.test(p), p);
  assert.ok(/Gabungkan/i.test(p), p);
  assert.ok(/admin/i.test(p), 'keadaan yang seharusnya mustahil harus sampai ke admin');
});

uji('pembuat tanpa nama tidak meninggalkan kalimat menggantung', () => {
  const p = pesanKeadaan(keadaanOrderKeCk([{ id: 'x', code: 'OR-X', status: 'draft' }]), { jumlahBaris: 2 });
  assert.ok(!/dibuat\s*\./.test(p), p);
  assert.ok(!p.includes('undefined'), p);
});

console.log(`\n${lulus} pemeriksaan lulus.`);
if (process.exitCode) console.error('ADA YANG GAGAL.');
