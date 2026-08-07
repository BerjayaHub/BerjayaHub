// Uji alur presensi yang melewati tengah malam.
//
// Kasus nyata: clock in 6 Agustus 22:00, clock out 7 Agustus 07:00.
// Sebelum perbaikan ini, halaman presensi hanya bertanya "apa saya clock in
// HARI INI" — jawabannya "tidak" pada tanggal 7, jadi tombol Clock Out tidak
// pernah muncul dan orangnya malah bisa clock in lagi. Baris tanggal 6
// menggantung tanpa jam pulang, dan hari itu tidak terhitung NBM sama sekali.
const JAM = 3600 * 1000;
const MAX_JAM = 18;

/** Meniru pilihan sesi aktif di halaman presensi. */
function sesiAktif({ sekarang, sesiTerbukaMulai, todaySessionMulai, todaySessionTutup }) {
  const terbuka =
    sesiTerbukaMulai && sekarang - sesiTerbukaMulai <= MAX_JAM * JAM ? { mulai: sesiTerbukaMulai } : null;
  const todayTerbuka = todaySessionMulai && !todaySessionTutup ? { mulai: todaySessionMulai } : null;
  const open = terbuka ?? todayTerbuka;
  const done = todaySessionMulai && todaySessionTutup ? { mulai: todaySessionMulai } : null;
  return { aksi: open ? 'clock out' : done ? 'selesai hari ini' : 'clock in', open };
}

const t = (h) => new Date(`2026-08-0${h < 24 ? 6 : 7}T00:00:00+07:00`).getTime();
const tgl6 = (jam) => new Date(`2026-08-06T${String(jam).padStart(2, '0')}:00:00+07:00`).getTime();
const tgl7 = (jam) => new Date(`2026-08-07T${String(jam).padStart(2, '0')}:00:00+07:00`).getTime();

let gagal = 0;
const cek = (ok, ket) => { console.log(`${ok ? '✓' : '✗'} ${ket}`); if (!ok) gagal++; };

// 7 Agustus 07:00 — sesi tanggal 6 jam 22:00 masih terbuka (9 jam berjalan).
let r = sesiAktif({ sekarang: tgl7(7), sesiTerbukaMulai: tgl6(22), todaySessionMulai: null });
cek(r.aksi === 'clock out', `7 Agu 07:00, masuk 6 Agu 22:00 -> ${r.aksi}`);

// Tanggal 6 jam 23:00, baru saja clock in.
r = sesiAktif({ sekarang: tgl6(23), sesiTerbukaMulai: tgl6(22), todaySessionMulai: tgl6(22) });
cek(r.aksi === 'clock out', `6 Agu 23:00, sesi berjalan -> ${r.aksi}`);

// Sudah clock out pagi tadi untuk shift semalam; malam ini boleh masuk lagi.
r = sesiAktif({ sekarang: tgl7(21), sesiTerbukaMulai: null, todaySessionMulai: null });
cek(r.aksi === 'clock in', `7 Agu 21:00 setelah menutup shift semalam -> ${r.aksi}`);

// Shift pagi biasa yang sudah selesai hari ini -> tidak boleh clock in lagi.
r = sesiAktif({ sekarang: tgl7(15), sesiTerbukaMulai: null, todaySessionMulai: tgl7(8), todaySessionTutup: tgl7(14) });
cek(r.aksi === 'selesai hari ini', `7 Agu 15:00, shift pagi sudah tutup -> ${r.aksi}`);

// Lupa clock out 2 hari lalu: TIDAK boleh menyandera presensi hari ini.
r = sesiAktif({ sekarang: tgl7(8), sesiTerbukaMulai: tgl6(8) - 24 * JAM, todaySessionMulai: null });
cek(r.aksi === 'clock in', `sesi menggantung >18 jam -> ${r.aksi} (tidak memblokir)`);

// Tepat di batas 18 jam masih dianggap berjalan.
r = sesiAktif({ sekarang: tgl6(22) + 18 * JAM, sesiTerbukaMulai: tgl6(22), todaySessionMulai: null });
cek(r.aksi === 'clock out', 'tepat 18 jam -> masih bisa clock out');
r = sesiAktif({ sekarang: tgl6(22) + 18 * JAM + 60000, sesiTerbukaMulai: tgl6(22), todaySessionMulai: null });
cek(r.aksi === 'clock in', 'lewat 18 jam -> dianggap tertinggal, tidak memblokir');

// NBM: hari kerja diikat ke tanggal CLOCK IN, jadi shift lintas malam = 1 hari.
const hariKerja = (masuk) => new Date(masuk).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
cek(hariKerja(tgl6(22)) === '2026-08-06', `clock in 6 Agu 22:00 -> hari kerja ${hariKerja(tgl6(22))} (1 hari, bukan 2)`);

if (gagal) { console.error(`\n${gagal} kasus presensi lintas hari salah.`); process.exit(1); }
console.log('\nPresensi lintas tengah malam benar untuk 8 kasus. ✅');
