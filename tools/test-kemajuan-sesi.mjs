// Uji kemajuan sesi Daily Activities (migration 0071).
//
// Bug yang dikunci di sini: sesi yang baru terisi 1 dari 15 item dulu langsung
// terhitung "Selesai", dan `unique (outlet_id, session_id, run_date)` membuat
// 14 sisanya tidak bisa diisi siapa pun seharian. Tidak ada error — laporannya
// justru terlihat rapi, dan itu yang membuatnya berbahaya.
// `baris` = isi checklist_run_items untuk run itu, masing-masing { checked }.
// HANYA yang checked yang dihitung: data sebelum 0071 menyimpan baris untuk
// item yang TIDAK dicentang juga, jadi menghitung semua baris membuat sesi
// yang baru terisi 1 dari 6 terbaca "6 dari 6".
function kemajuan(totalItem, baris) {
  const selesai = (baris ?? []).filter((b) => b.checked).length;
  return { total: totalItem, selesai, tuntas: totalItem > 0 && selesai >= totalItem };
}
/** Item yang masih boleh diisi: belum punya baris, atau barisnya checked=false. */
function sisaItem(semuaItem, baris) {
  const peta = new Map((baris ?? []).map((b) => [b.item_id, b.checked]));
  return semuaItem.filter((id) => peta.get(id) !== true);
}
function aksi({ adaRun, tuntas, hariIni }) {
  if (!adaRun) return hariIni ? 'isi' : 'terkunci';
  if (!tuntas && hariIni) return 'lanjutkan';
  return 'lihat';
}

const kasus = [
  { nama: '1 dari 15 -> belum tuntas, bisa dilanjutkan', total: 15, baris: [{ item_id: 'i1', checked: true }], harapTuntas: false, harapAksi: 'lanjutkan' },
  { nama: '15 dari 15 -> tuntas, jadi tampilan saja', total: 15, baris: Array.from({ length: 15 }, (_, i) => ({ item_id: `i${i}`, checked: true })), harapTuntas: true, harapAksi: 'lihat' },
  {
    nama: 'DATA LAMA: 6 baris tapi cuma 1 dicentang -> belum tuntas',
    total: 6,
    baris: [{ item_id: 'i0', checked: true }, ...Array.from({ length: 5 }, (_, i) => ({ item_id: `i${i + 1}`, checked: false }))],
    harapTuntas: false,
    harapAksi: 'lanjutkan'
  },
  { nama: 'belum ada run hari ini -> isi dari awal', total: 15, baris: null, harapTuntas: false, harapAksi: 'isi' },
  { nama: 'sesi tanpa item -> tidak pernah dianggap tuntas', total: 0, baris: [], harapTuntas: false, harapAksi: 'lanjutkan' }
];

let gagal = 0;
for (const k of kasus) {
  const km = kemajuan(k.total, k.baris ?? []);
  const a = aksi({ adaRun: k.baris !== null, tuntas: km.tuntas, hariIni: true });
  const ok = km.tuntas === k.harapTuntas && a === k.harapAksi;
  if (!ok) gagal++;
  console.log(`${ok ? '✓' : '✗'} ${k.nama} -> ${km.selesai}/${km.total}, ${km.tuntas ? 'tuntas' : 'belum'}, aksi=${a}`);
}

// Hari lampau tidak boleh bisa diisi surut, tuntas maupun tidak.
for (const tuntas of [true, false]) {
  const a = aksi({ adaRun: true, tuntas, hariIni: false });
  const ok = a === 'lihat';
  if (!ok) gagal++;
  console.log(`${ok ? '✓' : '✗'} hari lampau (${tuntas ? 'tuntas' : 'belum tuntas'}) -> aksi=${a}`);
}
const aKunci = aksi({ adaRun: false, tuntas: false, hariIni: false });
console.log(`${aKunci === 'terkunci' ? '✓' : '✗'} hari lampau tanpa run -> aksi=${aKunci}`);
if (aKunci !== 'terkunci') gagal++;

// Item yang boleh dilanjutkan: baris checked=false TIDAK boleh dianggap selesai.
const semua = ['i0', 'i1', 'i2', 'i3', 'i4', 'i5'];
const barisLama = [{ item_id: 'i0', checked: true }, ...semua.slice(1).map((id) => ({ item_id: id, checked: false }))];
const sisa = sisaItem(semua, barisLama);
const okSisa = JSON.stringify(sisa) === JSON.stringify(['i1', 'i2', 'i3', 'i4', 'i5']);
console.log(`${okSisa ? '✓' : '✗'} data lama: sisa item yang bisa diisi -> [${sisa}]`);
if (!okSisa) gagal++;

const sisaBaru = sisaItem(semua, [{ item_id: 'i0', checked: true }]);
const okBaru = JSON.stringify(sisaBaru) === JSON.stringify(['i1', 'i2', 'i3', 'i4', 'i5']);
console.log(`${okBaru ? '✓' : '✗'} data baru: sisa item yang bisa diisi -> [${sisaBaru}]`);
if (!okBaru) gagal++;

const sisaTuntas = sisaItem(semua, semua.map((id) => ({ item_id: id, checked: true })));
const okTuntas = sisaTuntas.length === 0;
console.log(`${okTuntas ? '✓' : '✗'} semua berbukti -> tidak ada yang bisa ditimpa (sisa ${sisaTuntas.length})`);
if (!okTuntas) gagal++;

if (gagal) { console.error(`\n${gagal} kasus kemajuan sesi salah.`); process.exit(1); }
console.log('\nKemajuan & aksi sesi benar untuk 11 kasus, termasuk data lama sebelum 0071. ✅');
