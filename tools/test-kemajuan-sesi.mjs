// Uji kemajuan sesi Daily Activities (migration 0071).
//
// Bug yang dikunci di sini: sesi yang baru terisi 1 dari 15 item dulu langsung
// terhitung "Selesai", dan `unique (outlet_id, session_id, run_date)` membuat
// 14 sisanya tidak bisa diisi siapa pun seharian. Tidak ada error — laporannya
// justru terlihat rapi, dan itu yang membuatnya berbahaya.
function kemajuan(totalItem, barisTercatat) {
  const selesai = barisTercatat.length;
  return { total: totalItem, selesai, tuntas: totalItem > 0 && selesai >= totalItem };
}
function aksi({ adaRun, tuntas, hariIni }) {
  if (!adaRun) return hariIni ? 'isi' : 'terkunci';
  if (!tuntas && hariIni) return 'lanjutkan';
  return 'lihat';
}

const kasus = [
  { nama: '1 dari 15 -> belum tuntas, bisa dilanjutkan', total: 15, baris: ['i1'], harapTuntas: false, harapAksi: 'lanjutkan' },
  { nama: '15 dari 15 -> tuntas, jadi tampilan saja', total: 15, baris: Array.from({ length: 15 }, (_, i) => `i${i}`), harapTuntas: true, harapAksi: 'lihat' },
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

if (gagal) { console.error(`\n${gagal} kasus kemajuan sesi salah.`); process.exit(1); }
console.log('\nKemajuan & aksi sesi benar untuk 7 kasus. ✅');
