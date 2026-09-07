/**
 * Outlet aktif di Staff App — aturan murni.
 *
 * ============ BUG YANG DIJAGA ============
 *
 * Akun yang cuma punya satu cakupan "Admin Divisi / Admin" membuka BU "Awal
 * Bermula Cafe" di Staff App. `scopesInBu` kosong, dan versi lamanya jatuh ke
 * `context.scopes[0]` — cakupan milik BU YANG LAIN.
 *
 * Sesudah itu seluruh sesinya salah tempat, tanpa satu pun error:
 * modul Produksi hilang, daftar kas kosong, dan nota tersimpan di outlet BU
 * lain lalu tidak muncul di riwayat.
 */
import assert from 'node:assert/strict';
import { cakupanUntukBu, outletAktif, modulUntukPeran } from '../js/core/outlet-aktif.js';

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

const BU_CAFE = 'bu-cafe';
const BU_ADMIN = 'bu-admin';
const CK = { id: 'o-ck', name: 'Central Kitchen', outlet_role: 'central_kitchen' };
const SENTUL = { id: 'o-sentul', name: 'Sentul', outlet_role: 'store' };
const ADMIN = { id: 'o-admin', name: 'Admin', outlet_role: 'office' };

// Persis keadaan yang dilaporkan: SATU cakupan, dan bukan di BU yang dibuka.
const scopeIko = [{ business_unit_id: BU_ADMIN, outlet_id: ADMIN.id, is_primary: true, outlets: ADMIN }];

// ---------------------------------------------------------------
// 1. INTI: tidak pernah meminjam cakupan BU lain.
// ---------------------------------------------------------------
uji('INTI: cakupan BU lain TIDAK dipakai', () => {
  assert.equal(cakupanUntukBu(scopeIko, BU_CAFE), null, 'BU tanpa cakupan harus null, bukan cakupan BU lain');
  assert.equal(cakupanUntukBu(scopeIko, BU_ADMIN)?.outlet_id, ADMIN.id);
});

uji('INTI: outlet aktif tidak jatuh ke outlet BU lain', () => {
  const r = outletAktif({ scopes: scopeIko, buId: BU_CAFE, outletBoleh: [CK, SENTUL] });
  assert.notEqual(r.outletId, ADMIN.id, 'inilah bugnya: outlet Admin Divisi terpakai di Cafe');
  assert.equal(r.outletId, null, 'dua outlet & tanpa cakupan -> harus MEMILIH, bukan menebak');
  assert.equal(r.sebab, 'tidak-ada');
});

// ---------------------------------------------------------------
// 2. Yang diingat menang — tapi hanya kalau masih boleh.
// ---------------------------------------------------------------
uji('pilihan tersimpan dipakai', () => {
  const r = outletAktif({ scopes: scopeIko, buId: BU_CAFE, outletBoleh: [CK, SENTUL], tersimpan: CK.id });
  assert.equal(r.outletId, CK.id);
  assert.equal(r.outletRole, 'central_kitchen');
  assert.equal(r.sebab, 'tersimpan');
});

uji('INTI: pilihan tersimpan yang sudah TIDAK BOLEH diabaikan', () => {
  // Izin yang hidup lebih lama daripada pemberiannya. Kalau haknya dicabut,
  // localStorage tidak boleh jadi pintu belakang yang tetap membukanya.
  const r = outletAktif({ scopes: scopeIko, buId: BU_CAFE, outletBoleh: [SENTUL], tersimpan: CK.id });
  assert.notEqual(r.outletId, CK.id);
  assert.equal(r.outletId, SENTUL.id, 'jatuh ke satu-satunya yang boleh');
});

// ---------------------------------------------------------------
// 3. Cakupan di BU yang benar dipakai.
// ---------------------------------------------------------------
uji('cakupan di BU ini dipakai', () => {
  const scopes = [
    { business_unit_id: BU_ADMIN, outlet_id: ADMIN.id, is_primary: true, outlets: ADMIN },
    { business_unit_id: BU_CAFE, outlet_id: SENTUL.id, outlets: SENTUL }
  ];
  const r = outletAktif({ scopes, buId: BU_CAFE, outletBoleh: [CK, SENTUL] });
  assert.equal(r.outletId, SENTUL.id);
  assert.equal(r.sebab, 'cakupan');
});

uji('yang bertanda "tempat kerja utama" menang', () => {
  const scopes = [
    { business_unit_id: BU_CAFE, outlet_id: CK.id, outlets: CK },
    { business_unit_id: BU_CAFE, outlet_id: SENTUL.id, is_primary: true, outlets: SENTUL }
  ];
  assert.equal(outletAktif({ scopes, buId: BU_CAFE, outletBoleh: [CK, SENTUL] }).outletId, SENTUL.id);
});

uji('cakupan level BU (outlet_id null) tidak memaksa outlet', () => {
  const scopes = [{ business_unit_id: BU_CAFE, outlet_id: null, is_primary: true }];
  const r = outletAktif({ scopes, buId: BU_CAFE, outletBoleh: [CK, SENTUL] });
  assert.equal(r.outletId, null);
  assert.equal(r.outletRole, null, 'peran null = semua modul tampil');
});

uji('cakupan menunjuk outlet yang sudah tidak boleh -> tidak dipakai', () => {
  const scopes = [{ business_unit_id: BU_CAFE, outlet_id: 'o-tutup', outlets: { outlet_role: 'store' } }];
  const r = outletAktif({ scopes, buId: BU_CAFE, outletBoleh: [CK, SENTUL] });
  assert.equal(r.outletId, null);
});

uji('perannya dibaca dari daftar outlet, bukan dari embed cakupan', () => {
  // Embed `outlets` di cakupan bisa null karena RLS untuk outlet BU lain, dan
  // peran null diam-diam berarti "tampilkan semua modul".
  const scopes = [{ business_unit_id: BU_CAFE, outlet_id: CK.id, outlets: null }];
  const r = outletAktif({ scopes, buId: BU_CAFE, outletBoleh: [CK, SENTUL] });
  assert.equal(r.outletRole, 'central_kitchen');
});

// ---------------------------------------------------------------
// 4. Satu-satunya outlet tidak perlu dipilih.
// ---------------------------------------------------------------
uji('satu outlet -> langsung terpakai', () => {
  const r = outletAktif({ scopes: scopeIko, buId: BU_CAFE, outletBoleh: [CK] });
  assert.equal(r.outletId, CK.id);
  assert.equal(r.sebab, 'satu-satunya');
});

uji('tidak ada outlet sama sekali -> null, bukan melempar', () => {
  const r = outletAktif({ scopes: scopeIko, buId: BU_CAFE, outletBoleh: [] });
  assert.equal(r.outletId, null);
  assert.equal(r.sebab, 'tidak-ada');
});

uji('masukan rusak tidak melempar', () => {
  assert.equal(outletAktif({ scopes: null, buId: null, outletBoleh: null }).outletId, null);
  assert.equal(cakupanUntukBu(null, BU_CAFE), null);
});

// ---------------------------------------------------------------
// 5. Modul per peran outlet.
// ---------------------------------------------------------------
uji('INTI: Produksi hanya di central kitchen', () => {
  assert.equal(modulUntukPeran('production', 'central_kitchen'), true);
  assert.equal(modulUntukPeran('production', 'store'), false);
});

uji('INTI: outlet BELUM DIPILIH -> semua modul tampil', () => {
  // Menyembunyikan modul untuk orang yang belum memilih outlet terbaca sebagai
  // fitur yang hilang — dan itu persis keluhan yang melahirkan modul ini.
  assert.equal(modulUntukPeran('production', null), true);
  assert.equal(modulUntukPeran('menu', null), true);
  assert.equal(modulUntukPeran('sales', null), true);
});

uji('Menu/Penjualan/Reservasi tidak di central kitchen', () => {
  for (const k of ['menu', 'sales', 'reservation']) {
    assert.equal(modulUntukPeran(k, 'central_kitchen'), false, k);
    assert.equal(modulUntukPeran(k, 'store'), true, k);
  }
});

uji('modul lain tidak terpengaruh peran outlet', () => {
  for (const k of ['inventory', 'attendance', 'cash_ledger', 'dispatch']) {
    assert.equal(modulUntukPeran(k, 'central_kitchen'), true, k);
    assert.equal(modulUntukPeran(k, 'store'), true, k);
    assert.equal(modulUntukPeran(k, null), true, k);
  }
});

if (process.exitCode !== 1) console.log(`Outlet aktif Staff App: ${lulus} pemeriksaan lulus. ✅`);
