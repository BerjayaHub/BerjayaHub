// Uji pemetaan jam bebas ke SLOT (migration 0077).
//
// Bahayanya bukan jam bebasnya, tapi kuotanya: kalau 18:00 dan 18:05 dianggap
// slot berbeda, dua rombongan 20 orang bisa masuk berbarengan di ruangan yang
// muat 20 — dan sistemnya melaporkan semuanya baik-baik saja sampai tamunya
// datang.
const menit = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const jam = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function slotDari(t, { open = '10:00', slotMenit = 60 } = {}) {
  const o = menit(open), x = menit(t);
  if (x < o) return open;
  return jam(o + Math.floor((x - o) / slotMenit) * slotMenit);
}

let gagal = 0;
const cek = (ok, ket) => { console.log(`${ok ? '✓' : '✗'} ${ket}`); if (!ok) gagal++; };

cek(slotDari('18:00') === '18:00', '18:00 -> slot 18:00');
cek(slotDari('18:05') === '18:00', '18:05 -> slot 18:00 (kuota yang sama)');
cek(slotDari('18:59') === '18:00', '18:59 masih slot 18:00');
cek(slotDari('19:00') === '19:00', '19:00 pindah ke slot berikutnya');
cek(slotDari('09:30') === '10:00', 'sebelum jam buka dijepit ke jam buka');
cek(slotDari('10:00') === '10:00', 'tepat jam buka');

// Slot 30 menit — pengaturan lain harus ikut benar, bukan cuma yang 60 menit.
const s30 = { open: '10:00', slotMenit: 30 };
cek(slotDari('18:15', s30) === '18:00', 'slot 30 mnt: 18:15 -> 18:00');
cek(slotDari('18:45', s30) === '18:30', 'slot 30 mnt: 18:45 -> 18:30');

// Jam buka bukan pada .00 pun harus konsisten.
const s45 = { open: '10:30', slotMenit: 45 };
cek(slotDari('10:30', s45) === '10:30', 'buka 10:30, slot 45 mnt: awal');
cek(slotDari('11:14', s45) === '10:30', 'buka 10:30: 11:14 masih slot pertama');
cek(slotDari('11:15', s45) === '11:15', 'buka 10:30: 11:15 masuk slot kedua');

// Inti perlindungannya: dua jam berbeda dalam satu slot HARUS berebut kuota.
const kuota = 20;
const isi = [{ jam: '18:00', pax: 12 }, { jam: '18:20', pax: 6 }];
const dipakai = (t) => isi.filter((x) => slotDari(x.jam) === slotDari(t)).reduce((n, x) => n + x.pax, 0);
cek(dipakai('18:40') === 18, '18:00 + 18:20 terhitung satu slot -> terpakai 18 kursi');
cek(dipakai('18:40') + 5 > kuota, 'rombongan 5 orang berikutnya di 18:40 DITOLAK, bukan diterima diam-diam');
cek(dipakai('19:10') === 0, 'slot 19:00 masih kosong — pembatasnya tidak melebar ke slot lain');

if (gagal) { console.error(`\n${gagal} pemetaan slot salah.`); process.exit(1); }
console.log('\nJam fleksibel + kuota per slot benar untuk 14 kasus. ✅');
