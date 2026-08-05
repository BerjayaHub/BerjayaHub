// Uji pemilihan penerima peringatan "jadwal shift kosong".
//
// Aturannya berjenjang dan BERHENTI di jenjang pertama yang berisi orang:
// admin outlet -> admin BU -> super admin. Mengirim ke semua sekaligus
// terdengar aman, tapi peringatan yang jadi tanggung jawab semua orang tidak
// dikerjakan siapa pun.
function pilih(scopes, outlet) {
  const aktif = scopes.filter((s) => s.aktif !== false);
  const adminOutlet = aktif.filter((s) => s.role === 'outlet_admin' && s.outlet_id === outlet.id);
  const adminBu = aktif.filter((s) => s.role === 'bu_admin' && s.business_unit_id === outlet.business_unit_id);
  const superAdmin = aktif.filter((s) => s.role === 'super_admin');
  const dipilih = adminOutlet.length ? adminOutlet : adminBu.length ? adminBu : superAdmin;
  const jenjang = adminOutlet.length ? 'admin outlet' : adminBu.length ? 'admin BU' : superAdmin.length ? 'super admin' : 'tidak ada';
  return { penerima: [...new Set(dipilih.map((s) => s.user_id))], jenjang };
}

const O = { id: 'out1', business_unit_id: 'bu1' };
const kasus = [
  {
    nama: 'ada admin outlet -> admin BU TIDAK ikut',
    scopes: [
      { user_id: 'a', role: 'outlet_admin', outlet_id: 'out1', business_unit_id: 'bu1' },
      { user_id: 'b', role: 'bu_admin', business_unit_id: 'bu1' },
      { user_id: 'c', role: 'super_admin' }
    ],
    harap: ['a'], jenjang: 'admin outlet'
  },
  {
    nama: 'tanpa admin outlet -> naik ke admin BU',
    scopes: [
      { user_id: 'b', role: 'bu_admin', business_unit_id: 'bu1' },
      { user_id: 'c', role: 'super_admin' }
    ],
    harap: ['b'], jenjang: 'admin BU'
  },
  {
    nama: 'tanpa keduanya -> super admin',
    scopes: [{ user_id: 'c', role: 'super_admin' }],
    harap: ['c'], jenjang: 'super admin'
  },
  {
    nama: 'admin outlet OUTLET LAIN tidak dihitung',
    scopes: [
      { user_id: 'x', role: 'outlet_admin', outlet_id: 'out2', business_unit_id: 'bu1' },
      { user_id: 'b', role: 'bu_admin', business_unit_id: 'bu1' }
    ],
    harap: ['b'], jenjang: 'admin BU'
  },
  {
    nama: 'admin BU dari BU LAIN tidak dihitung',
    scopes: [
      { user_id: 'z', role: 'bu_admin', business_unit_id: 'bu9' },
      { user_id: 'c', role: 'super_admin' }
    ],
    harap: ['c'], jenjang: 'super admin'
  },
  {
    nama: 'admin outlet nonaktif dilewati, naik jenjang',
    scopes: [
      { user_id: 'a', role: 'outlet_admin', outlet_id: 'out1', business_unit_id: 'bu1', aktif: false },
      { user_id: 'b', role: 'bu_admin', business_unit_id: 'bu1' }
    ],
    harap: ['b'], jenjang: 'admin BU'
  },
  {
    nama: 'dua scope orang yang sama tidak dikirimi dua kali',
    scopes: [
      { user_id: 'a', role: 'outlet_admin', outlet_id: 'out1', business_unit_id: 'bu1' },
      { user_id: 'a', role: 'outlet_admin', outlet_id: 'out1', business_unit_id: 'bu1' }
    ],
    harap: ['a'], jenjang: 'admin outlet'
  },
  { nama: 'tidak ada admin sama sekali', scopes: [], harap: [], jenjang: 'tidak ada' }
];

let gagal = 0;
for (const k of kasus) {
  const h = pilih(k.scopes, O);
  const ok = JSON.stringify(h.penerima) === JSON.stringify(k.harap) && h.jenjang === k.jenjang;
  if (!ok) gagal++;
  console.log(`${ok ? '✓' : '✗'} ${k.nama} -> [${h.penerima}] (${h.jenjang})`);
}
if (gagal) { console.error(`\n${gagal} kasus jenjang penerima salah.`); process.exit(1); }
console.log('\nJenjang penerima peringatan jadwal kosong benar untuk 8 kasus. ✅');
