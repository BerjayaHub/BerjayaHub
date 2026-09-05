/**
 * Argumen RPC tidak boleh hilang di jalan.
 *
 * ============ BUG YANG DIJAGA ============
 *
 *   "Could not find the function public.ubah_nota_terima(p_id, p_invoice_no,
 *    p_items, p_notes, p_receipt_date, p_supplier) in the schema cache"
 *
 * Tujuh argumen tertulis di kode, enam yang sampai. `JSON.stringify` membuang
 * kunci bernilai `undefined`, dan PostgREST memilih fungsi berdasarkan
 * himpunan NAMA argumen — jadi satu `undefined` bukan berarti "argumen ini
 * NULL", melainkan "panggil fungsi lain".
 *
 * Tes ini menirukan perjalanan itu: objeknya di-`JSON.stringify` lalu dibaca
 * kembali, persis seperti yang dilakukan supabase-js sebelum mengirim.
 */
import assert from 'node:assert/strict';
import { argumenRpc, kunciHilang } from '../js/core/rpc-args.js';

let lulus = 0;
const uji = (nama, fn) => {
  try {
    fn();
    lulus++;
  } catch (e) {
    console.error(`❌ ${nama}\n   ${e.message}`);
    process.exitCode = 1;
  }
};

/** Perjalanan yang sesungguhnya: objek -> JSON -> objek. */
const dikirim = (o) => JSON.parse(JSON.stringify(o));

uji('INTI: undefined MEMANG hilang kalau tidak dijaga', () => {
  const mentah = { p_id: 'x', p_photo_path: undefined, p_notes: null };
  assert.deepEqual(Object.keys(dikirim(mentah)), ['p_id', 'p_notes'], 'kalau ini gagal, seluruh alasan file ini hilang');
});

uji('INTI: argumenRpc menyelamatkan kuncinya', () => {
  const aman = argumenRpc({ p_id: 'x', p_photo_path: undefined, p_notes: null });
  assert.deepEqual(Object.keys(dikirim(aman)), ['p_id', 'p_photo_path', 'p_notes']);
  assert.equal(dikirim(aman).p_photo_path, null, 'undefined jadi NULL, bukan string kosong');
});

uji('bentuk persis panggilan ubahNota dari dialog Edit', () => {
  // Dialog Edit memanggil: ubahNota(id, { supplier, invoiceNo, items }).
  // Tiga field lain tidak disebut sama sekali.
  const opsi = { supplier: 'Pasar', invoiceNo: 'INV-1', items: [] };
  const args = argumenRpc({
    p_id: 'nota-1',
    p_receipt_date: opsi.receiptDate || null,
    p_supplier: opsi.supplier ?? null,
    p_invoice_no: opsi.invoiceNo ?? null,
    p_photo_path: opsi.photoPath ?? null,
    p_notes: opsi.notes ?? null,
    p_items: opsi.items
  });
  assert.equal(Object.keys(dikirim(args)).length, 7, 'ubah_nota_terima punya TUJUH argumen; enam yang sampai berarti fungsi lain');
});

uji('NULL yang disengaja tidak ikut diubah jadi sesuatu yang lain', () => {
  // NULL punya arti sendiri di `ubah_nota_terima`: "jangan sentuh kolom ini".
  // Menyamakannya dengan string kosong akan MENGHAPUS isinya (bug 0119).
  const args = argumenRpc({ p_supplier: null, p_notes: '' });
  assert.equal(args.p_supplier, null);
  assert.equal(args.p_notes, '', 'string kosong berarti "hapus" — bukan hal yang sama dengan NULL');
});

uji('nilai palsu lain tidak ikut dijadikan null', () => {
  const args = argumenRpc({ a: 0, b: false, c: '', d: NaN });
  assert.equal(args.a, 0, '0 adalah harga yang sah (barang bonus)');
  assert.equal(args.b, false);
  assert.equal(args.c, '');
  assert.ok(Number.isNaN(args.d));
});

uji('kunciHilang menyebut NAMA-nya, bukan galat 42883', () => {
  assert.deepEqual(kunciHilang({ p_a: 1, p_b: undefined, p_c: undefined }), ['p_b', 'p_c']);
  assert.deepEqual(kunciHilang({ p_a: null }), [], 'null tidak hilang, jadi bukan masalah');
  assert.deepEqual(kunciHilang(null), []);
});

uji('masukan kosong/aneh tidak melempar', () => {
  assert.deepEqual(argumenRpc(null), {});
  assert.deepEqual(argumenRpc(undefined), {});
});

if (process.exitCode !== 1) console.log(`Argumen RPC: ${lulus} pemeriksaan lulus. ✅`);
