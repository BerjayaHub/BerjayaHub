// Uji ambang waktu reminder clock in.
//
// Bug yang diuji di sini: versi lama membungkus ambang dengan modulo 1440,
// sehingga shift 23:50 menghasilkan ambang "00:00" dan reminder terkirim
// pukul 00:0x — hampir 24 jam lebih awal. Kegagalannya tenang: tidak ada error,
// hanya notifikasi di waktu yang salah.
const GRACE = 10;
const ambangMenit = (hhmm, add) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m + add; };
const keMenit = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** true = reminder dikirim pada jam `sekarang` untuk shift yang mulai `mulai`. */
function kirim(mulai, sekarang) {
  const t = ambangMenit(mulai, GRACE);
  if (t >= 1440) return false;
  return keMenit(sekarang) >= t;
}

const kasus = [
  ['08:00:00', '07:55', false, 'sebelum jam masuk'],
  ['08:00:00', '08:05', false, 'masih dalam masa tenggang'],
  ['08:00:00', '08:10', true, 'tepat di ambang'],
  ['08:00:00', '13:00', true, 'jauh setelah jam masuk'],
  ['22:00:00', '22:15', true, 'shift malam, normal'],
  ['22:00:00', '00:05', false, 'lewat tengah malam -> tanggal jadwalnya sudah beda'],
  ['23:50:00', '00:05', false, 'BUG LAMA: dulu terkirim 23 jam lebih awal'],
  ['23:55:00', '00:05', false, 'BUG LAMA: idem'],
  ['23:50:00', '23:59', false, 'ambang jatuh di hari berikutnya -> dilewati'],
  ['00:10:00', '00:05', false, 'shift dini hari, belum waktunya'],
  ['00:10:00', '00:20', true, 'shift dini hari, sudah lewat ambang']
];

let gagal = 0;
for (const [mulai, sekarang, harap, ket] of kasus) {
  const hasil = kirim(mulai, sekarang);
  const ok = hasil === harap;
  if (!ok) gagal++;
  console.log(`${ok ? '✓' : '✗'} shift ${mulai.slice(0, 5)} · jam ${sekarang} -> ${hasil ? 'kirim' : 'diam'} (${ket})`);
}
if (gagal) { console.error(`\n${gagal} kasus ambang reminder salah.`); process.exit(1); }
console.log('\nAmbang reminder clock in benar untuk 11 kasus, termasuk shift dekat tengah malam. ✅');
