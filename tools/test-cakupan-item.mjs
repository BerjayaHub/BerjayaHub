// Uji cakupan item Daily Activities setelah multi-outlet (migration 0076).
//
// Tiga kemungkinan, dan yang paling rawan adalah data LAMA: item yang tidak
// punya baris daftar sama sekali harus tetap berlaku persis seperti sebelum
// 0076. Kalau aturan itu tergeser, ceklis outlet mendadak kosong — dan
// gejalanya bukan error, melainkan staff yang mengira tidak ada yang perlu
// dikerjakan.
function berlakuDi(item, daftarOutlet, outletId) {
  if (item.outlet_id) return item.outlet_id === outletId;      // milik satu outlet
  const punya = daftarOutlet[item.id];
  if (!punya || !punya.length) return true;                     // milik BU, tanpa daftar -> semua
  return punya.includes(outletId);                              // milik BU, dengan daftar
}

const SERPONG = 'o-serpong', SENTUL = 'o-sentul', CK = 'o-ck';
const items = [
  { id: 'i-semua', outlet_id: null },
  { id: 'i-multi', outlet_id: null },
  { id: 'i-satu', outlet_id: SENTUL },
  { id: 'i-lama', outlet_id: null }
];
const daftar = { 'i-multi': [SERPONG, SENTUL] }; // i-lama sengaja tanpa daftar

const kasus = [
  ['i-semua', SERPONG, true, 'item BU tanpa daftar -> berlaku di semua outlet'],
  ['i-semua', CK, true, 'termasuk Central Kitchen'],
  ['i-multi', SERPONG, true, 'multi-outlet: Serpong ikut'],
  ['i-multi', SENTUL, true, 'multi-outlet: Sentul ikut'],
  ['i-multi', CK, false, 'multi-outlet: CK TIDAK ikut — inilah yang dulu mustahil'],
  ['i-satu', SENTUL, true, 'item milik satu outlet: hanya di outletnya'],
  ['i-satu', SERPONG, false, 'item milik Sentul tidak muncul di Serpong'],
  ['i-lama', CK, true, 'DATA LAMA tanpa daftar -> tidak berubah sedikit pun']
];

let gagal = 0;
for (const [itemId, outlet, harap, ket] of kasus) {
  const it = items.find((x) => x.id === itemId);
  const h = berlakuDi(it, daftar, outlet);
  const ok = h === harap;
  if (!ok) gagal++;
  console.log(`${ok ? '✓' : '✗'} ${itemId.padEnd(8)} @ ${outlet.padEnd(10)} -> ${h ? 'berlaku' : 'tidak'} · ${ket}`);
}

// Aturan penyimpanan: 1 outlet dipegang kolom outlet_id (supaya admin outlet
// tetap bisa mengelolanya); >1 outlet jadi milik BU + daftar.
function simpan(pilihan) {
  const unik = [...new Set(pilihan)];
  return { outlet_id: unik.length === 1 ? unik[0] : null, daftar: unik.length > 1 ? unik : [] };
}
const cek = (ok, ket) => { console.log(`${ok ? '✓' : '✗'} ${ket}`); if (!ok) gagal++; };
let r = simpan([SENTUL]);
cek(r.outlet_id === SENTUL && r.daftar.length === 0, 'pilih 1 outlet -> jadi milik outlet itu, tanpa daftar');
r = simpan([SERPONG, SENTUL]);
cek(r.outlet_id === null && r.daftar.length === 2, 'pilih 2 outlet -> jadi milik BU + daftar 2 outlet');
r = simpan([]);
cek(r.outlet_id === null && r.daftar.length === 0, 'tanpa pilihan -> milik BU, berlaku semua');
r = simpan([SENTUL, SENTUL]);
cek(r.outlet_id === SENTUL, 'outlet kembar dianggap satu');

if (gagal) { console.error(`\n${gagal} kasus cakupan item salah.`); process.exit(1); }
console.log('\nCakupan item benar untuk 12 kasus, termasuk data lama sebelum 0076. ✅');
