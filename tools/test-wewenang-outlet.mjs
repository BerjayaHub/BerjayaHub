/**
 * "Boleh MELIHAT" vs "boleh MENGATUR" — dua pertanyaan berbeda.
 *
 * Bug yang melahirkan tes ini: admin outlet membuka Jadwal Shift, memilih
 * shift, dan dapat *"new row violates row-level security policy"*. Dropdown
 * outletnya diisi aturan MELIHAT (`saringPerBu`), sedangkan yang menolak adalah
 * aturan MENGATUR (`is_admin_of_outlet` di database). Keduanya memang berbeda —
 * dan memang harus berbeda. Yang salah adalah layar yang memakai jawaban dari
 * pertanyaan yang keliru.
 *
 * Tes ini mengunci selisihnya secara eksplisit: bentuk scope mana yang boleh
 * melihat tapi tidak boleh mengatur. Kalau suatu saat selisihnya berubah tanpa
 * sengaja, di sinilah ketahuannya.
 */
import { saringPerBu } from '../js/core/aturan-outlet.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

const BU = 'bu-cafe';
const OUTLETS = [
  { id: 'o-serpong', name: 'Gading Serpong', business_unit_id: BU },
  { id: 'o-sentul', name: 'Sentul', business_unit_id: BU },
  { id: 'o-lain', name: 'Bengkel Pusat', business_unit_id: 'bu-bengkel' }
];

/** Cermin `is_admin_of_outlet()` (migration 0003) — aturan MENGATUR. */
function bisaMengatur(scopes, outlet) {
  return scopes.some(
    (s) =>
      s.role === 'super_admin' ||
      (s.role === 'bu_admin' && s.business_unit_id === outlet.business_unit_id) ||
      (s.role === 'outlet_admin' && s.outlet_id === outlet.id)
  );
}

const lihat = (scopes) => saringPerBu(OUTLETS, scopes, BU).map((o) => o.id);
const atur = (scopes) => OUTLETS.filter((o) => o.business_unit_id === BU && bisaMengatur(scopes, o)).map((o) => o.id);

// --- Bentuk scope yang SEHAT: dua jawaban sama ---
const superAdmin = [{ role: 'super_admin', business_unit_id: null, outlet_id: null }];
cek('super admin melihat semua', lihat(superAdmin), ['o-serpong', 'o-sentul']);
cek('super admin mengatur semua', atur(superAdmin), ['o-serpong', 'o-sentul']);

const buAdmin = [{ role: 'bu_admin', business_unit_id: BU, outlet_id: null }];
cek('admin BU melihat semua di BU-nya', lihat(buAdmin), ['o-serpong', 'o-sentul']);
cek('admin BU mengatur semua di BU-nya', atur(buAdmin), ['o-serpong', 'o-sentul']);

const outletAdminBenar = [{ role: 'outlet_admin', business_unit_id: BU, outlet_id: 'o-serpong' }];
cek('admin outlet melihat outletnya', lihat(outletAdminBenar), ['o-serpong']);
cek('admin outlet mengatur outletnya', atur(outletAdminBenar), ['o-serpong']);

const staf = [{ role: 'staff', business_unit_id: BU, outlet_id: 'o-sentul' }];
cek('staff melihat outletnya', lihat(staf), ['o-sentul']);
cek('staff tidak mengatur apa pun', atur(staf), []);

// --- Bentuk scope yang MENYIMPANG: inilah sumber bug-nya ---
//
// Peran "outlet_admin" tapi scope-nya dibuat di level BU (tanpa outlet_id).
// Aturan MELIHAT membuka seluruh outlet BU (my-outlets.js: `s.outlet_id == null`),
// sementara aturan MENGATUR tidak memberi satu outlet pun — `is_admin_of_outlet`
// mensyaratkan outletnya disebut persis.
const outletAdminTanpaOutlet = [{ role: 'outlet_admin', business_unit_id: BU, outlet_id: null }];
cek('BUG: melihat semua outlet BU', lihat(outletAdminTanpaOutlet), ['o-serpong', 'o-sentul']);
cek('BUG: tidak boleh mengatur satu pun', atur(outletAdminTanpaOutlet), []);

// Admin outlet Serpong yang PUNYA scope tambahan level BU sebagai staff.
// Dia jadi melihat Sentul juga, tapi hanya boleh mengatur Serpong.
const campuran = [
  { role: 'outlet_admin', business_unit_id: BU, outlet_id: 'o-serpong' },
  { role: 'staff', business_unit_id: BU, outlet_id: null }
];
cek('campuran: melihat dua outlet', lihat(campuran), ['o-serpong', 'o-sentul']);
cek('campuran: hanya mengatur Serpong', atur(campuran), ['o-serpong']);

// --- Yang tidak boleh terjadi dalam keadaan apa pun ---
for (const [nama, scopes] of [
  ['super admin', superAdmin],
  ['admin BU', buAdmin],
  ['admin outlet', outletAdminBenar],
  ['staff', staf],
  ['outlet_admin tanpa outlet', outletAdminTanpaOutlet],
  ['campuran', campuran]
]) {
  const l = new Set(lihat(scopes));
  cek(`${nama}: yang bisa diatur SELALU bagian dari yang bisa dilihat`, atur(scopes).every((id) => l.has(id)), true);
  cek(`${nama}: BU lain tidak pernah ikut`, lihat(scopes).includes('o-lain'), false);
}

// Tidak punya scope di BU ini: tertutup, bukan terbuka.
cek('scope di BU lain saja: tidak melihat apa pun', lihat([{ role: 'bu_admin', business_unit_id: 'bu-bengkel', outlet_id: null }]), []);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Selisih "boleh lihat" vs "boleh atur" benar untuk 23 kasus, termasuk bentuk scope yang memicu bug-nya. ✅');
