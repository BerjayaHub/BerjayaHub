/**
 * Tes: penandaan "order ini sudah jadi draft" di tab Order Masuk (CK).
 *
 * Yang dijaga di sini adalah pekerjaan sia-sia, bukan keutuhan data — server
 * sudah menolak draft kedua untuk satu order. Tapi penolakan itu datang di
 * ujung, sesudah seluruh kotak jumlah diisi. Aturan di bawah yang menentukan
 * apakah layar sempat mengatakannya lebih dulu.
 */
import assert from 'node:assert/strict';
import { petaDraftPerOrder, keadaanOrder, ringkasOrder } from '../js/modules/dispatch/order-draft.js';

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

const orderA = { id: 'ord-a', code: 'OR-260902-DE06' };
const orderB = { id: 'ord-b', code: 'OR-260902-DE07' };
const orderC = { id: 'ord-c', code: 'OR-260902-DE08' };

const draftDariA = { id: 'dsp-1', code: 'SJ-0001', stock_order_id: 'ord-a' };
/** Draft dari tab "Kirim ke Outlet" — tidak lahir dari order mana pun. */
const draftLepas1 = { id: 'dsp-2', code: 'SJ-0002', stock_order_id: null };
const draftLepas2 = { id: 'dsp-3', code: 'SJ-0003', stock_order_id: null };

uji('order yang sudah punya draft dikenali, lengkap dengan draftnya', () => {
  const peta = petaDraftPerOrder([draftDariA]);
  const k = keadaanOrder(orderA, peta);
  assert.equal(k.mode, 'sudah-draft');
  assert.equal(k.draft.code, 'SJ-0001');
});

uji('order yang belum disiapkan tetap "belum"', () => {
  const peta = petaDraftPerOrder([draftDariA]);
  assert.equal(keadaanOrder(orderB, peta).mode, 'belum');
});

uji('INTI: draft tanpa stock_order_id tidak boleh masuk peta', () => {
  // Kalau `null` ikut jadi kunci, dua draft lepas saling menimpa di kunci yang
  // sama — keadaan tidak masuk akal yang kebetulan tidak terlihat selama tidak
  // ada order ber-id null. Dibuang terang-terangan, bukan dibiarkan bergantung
  // pada kebetulan.
  const peta = petaDraftPerOrder([draftLepas1, draftLepas2, draftDariA]);
  assert.equal(peta.size, 1);
  assert.equal(peta.has(null), false);
  assert.equal(peta.get('ord-a').id, 'dsp-1');
});

uji('daftar draft kosong: semua order dianggap belum disiapkan', () => {
  const peta = petaDraftPerOrder([]);
  assert.equal(keadaanOrder(orderA, peta).mode, 'belum');
});

uji('INTI: gagal memuat draft TIDAK boleh terbaca sebagai "belum ada draft"', () => {
  // Peta kosong karena gagal dimuat terlihat persis sama dengan peta kosong
  // karena memang belum ada draft. Menyamakan keduanya membuat layar berkata
  // "silakan kerjakan" dengan yakin pada order yang sebetulnya sudah
  // disiapkan — tepat pekerjaan sia-sia yang hendak dicegah.
  const peta = petaDraftPerOrder([]);
  assert.equal(keadaanOrder(orderA, peta, { gagalMemuatDraft: true }).mode, 'tidak-tahu');
  // Bahkan ketika petanya BERISI, kegagalan tetap menang: petanya tidak
  // lengkap, jadi tidak ada satu baris pun yang boleh diklaim pasti.
  const peta2 = petaDraftPerOrder([draftDariA]);
  assert.equal(keadaanOrder(orderA, peta2, { gagalMemuatDraft: true }).mode, 'tidak-tahu');
});

uji('ringkasan menghitung yang benar-benar perlu dikerjakan', () => {
  const peta = petaDraftPerOrder([draftDariA]);
  const r = ringkasOrder([orderA, orderB, orderC], peta);
  assert.deepEqual(r, { total: 3, sudah: 1, belum: 2, tidakTahu: false });
});

uji('ringkasan saat gagal memuat menolak mengklaim apa pun sudah beres', () => {
  const r = ringkasOrder([orderA, orderB], petaDraftPerOrder([]), { gagalMemuatDraft: true });
  assert.equal(r.tidakTahu, true);
  assert.equal(r.sudah, 0);
});

uji('dua draft untuk satu order: yang terbaru (pertama di daftar) menang', () => {
  // Server melarang keadaan ini, tapi layar tidak boleh ikut ambruk kalau
  // larangannya pernah bocor.
  const peta = petaDraftPerOrder([
    { id: 'dsp-baru', code: 'SJ-0009', stock_order_id: 'ord-a' },
    { id: 'dsp-lama', code: 'SJ-0001', stock_order_id: 'ord-a' }
  ]);
  assert.equal(peta.get('ord-a').id, 'dsp-baru');
});

uji('masukan yang rusak tidak melempar', () => {
  assert.equal(petaDraftPerOrder(null).size, 0);
  assert.equal(petaDraftPerOrder(undefined).size, 0);
  assert.equal(petaDraftPerOrder([null, undefined, {}]).size, 0);
  assert.equal(keadaanOrder(orderA, null).mode, 'belum');
  assert.equal(ringkasOrder(null, new Map()).total, 0);
});

if (!process.exitCode) console.log(`Order masuk yang sudah jadi draft: ${lulus} pemeriksaan lulus. ✅`);
