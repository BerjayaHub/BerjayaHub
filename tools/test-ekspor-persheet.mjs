/**
 * TES MURNI: aturan sheet-per-nota (tanpa jaringan, tanpa Excel sungguhan).
 *
 * Dua hal yang dijaga, dan keduanya pernah membuat berkas .xlsx GAGAL DIBUKA —
 * bukan tampil aneh, melainkan ditolak Excel sejak awal:
 *
 *   nama sheet > 31 karakter
 *   karakter : \ / ? * [ ] pada nama sheet   (nomor nota supplier sering "/")
 *
 * Ditambah satu yang lebih halus: batas jumlah nota yang MENOLAK, bukan
 * memotong diam-diam.
 */
import assert from 'node:assert/strict';
import { namaSheet, periksaBatas, BATAS_SHEET, pesanHasilPerSheet } from '../js/modules/inventory/aturan-nota-persheet.js';

let n = 0;
const ok = (nama, fn) => {
  n++;
  try {
    fn();
  } catch (e) {
    console.error(`❌ ${nama}\n   ${e.message}`);
    process.exitCode = 1;
  }
};

// ---------------------------------------------------------------
console.log('§1 Nama sheet yang diterima Excel');
// ---------------------------------------------------------------

ok('kode nota biasa dipakai apa adanya', () => {
  assert.equal(namaSheet({ code: 'NT-0012' }, 0), 'NT-0012');
});

// ============ "/" ADALAH YANG PALING SERING ============
//
// Nomor nota supplier berbentuk "INV/2026/09/41" sangat umum, dan Excel
// menolak berkas yang punya sheet bernama begitu — tanpa menyebut sheet mana.
ok('karakter terlarang diganti, bukan dibiarkan', () => {
  const nama = namaSheet({ code: 'INV/2026/09' }, 0);
  for (const c of [':', '\\', '/', '?', '*', '[', ']']) {
    assert.ok(!nama.includes(c), `masih mengandung ${c}`);
  }
});

ok('lebih dari 31 karakter dipotong', () => {
  const nama = namaSheet({ code: 'N'.repeat(60) }, 0);
  assert.ok(nama.length <= 31, `panjangnya ${nama.length}`);
});

ok('tanpa kode -> jatuh ke nomor supplier, lalu ke urutan', () => {
  assert.equal(namaSheet({ invoice_no: 'SUP-9' }, 0), 'SUP-9');
  assert.equal(namaSheet({}, 4), 'Nota 5');
  assert.equal(namaSheet(null, 0), 'Nota 1');
});

ok('kode yang seluruhnya karakter terlarang tidak jadi nama kosong', () => {
  // '///' -> '-' setelah diganti; yang penting BUKAN string kosong, karena
  // sheet tanpa nama juga ditolak Excel.
  assert.ok(namaSheet({ code: '///' }, 2).length > 0);
});

// ---------------------------------------------------------------
console.log('§2 Batas jumlah nota MENOLAK, tidak memotong');
// ---------------------------------------------------------------

ok('di bawah batas -> tidak ada penolakan', () => {
  assert.equal(periksaBatas(BATAS_SHEET), null);
  assert.equal(periksaBatas(1), null);
});

ok('di atas batas -> ada kalimat penolakan', () => {
  const p = periksaBatas(BATAS_SHEET + 1);
  assert.ok(p, 'harus menolak');
});

// Penolakan yang cuma berbunyi "terlalu banyak" meninggalkan orangnya di
// tempat yang sama persis.
ok('penolakannya menyebut ANGKA dan JALAN KELUARNYA', () => {
  const p = periksaBatas(300);
  assert.match(p, /300/, 'harus menyebut berapa banyak yang ada');
  assert.match(p, new RegExp(String(BATAS_SHEET)), 'harus menyebut batasnya');
  assert.match(p, /persempit|outlet/i, 'harus menyebut apa yang bisa dikerjakan');
  assert.match(p, /Rincian \+ Rekap/, 'harus menyebut ekspor lain yang tanpa batas');
});

ok('batas bisa diatur pemanggil', () => {
  assert.equal(periksaBatas(5, 10), null);
  assert.ok(periksaBatas(11, 10));
});

// ---------------------------------------------------------------
console.log('§3 Kalimat hasil menyebut yang kurang');
// ---------------------------------------------------------------

ok('yang tanpa rincian & tanpa foto disebut', () => {
  const p = pesanHasilPerSheet({ nota: 10, adaFoto: 7, tanpaBaris: 2, tanpaFoto: 3, gagalFoto: 0 });
  assert.match(p, /10 nota/);
  assert.match(p, /2 nota belum ada rincian/);
  assert.match(p, /3 nota tidak berfoto/);
});

// ============ GAGAL DIMUAT ≠ TIDAK BERFOTO ============
//
// Kalau keduanya dilebur, orang akan disuruh memfoto ulang nota yang fotonya
// sudah ada.
ok('foto gagal dimuat dilaporkan terpisah dari tidak berfoto', () => {
  const p = pesanHasilPerSheet({ nota: 5, adaFoto: 3, tanpaBaris: 0, tanpaFoto: 1, gagalFoto: 1 });
  assert.match(p, /1 nota tidak berfoto/);
  assert.match(p, /1 foto gagal dimuat/);
});

ok('semuanya beres -> tanpa catatan', () => {
  const p = pesanHasilPerSheet({ nota: 4, adaFoto: 4, tanpaBaris: 0, tanpaFoto: 0, gagalFoto: 0 });
  assert.ok(!p.includes('Catatan'));
});

ok('masukan kosong tidak melempar', () => {
  assert.doesNotThrow(() => pesanHasilPerSheet(null));
  assert.equal(pesanHasilPerSheet(null), '');
});

console.log('');
if (process.exitCode) console.error('Ada pemeriksaan yang GAGAL.');
else console.log(`${n} pemeriksaan ekspor per-nota lolos. ✅`);
