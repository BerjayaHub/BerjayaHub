/**
 * ISTIRAHAT & CLOCK OUT OTOMATIS — aturan murni.
 *
 * Dua hal yang paling ditekankan:
 *
 *   1. 12 JAM ADALAH PEMICU, BUKAN JAM PULANG. Kalau barisnya ditutup pada jam
 *      pemicu, staff yang lupa clock out tercatat bekerja 12 jam — lembur yang
 *      tidak pernah terjadi, di sistem yang membayar lembur bertingkat (0037).
 *   2. JAM KELUAR TIDAK BOLEH MENDAHULUI JAM MASUK. Durasi negatif menghasilkan
 *      angka mustahil di NBM, dan tetap tercetak rapi.
 */
import {
  setelanEfektif,
  bolehMulaiIstirahat,
  bolehSelesaiIstirahat,
  dalamJendela,
  keMenit,
  batasKembali,
  jamTutupOtomatis,
  totalMenitIstirahat,
  MODE_BEBAS,
  MODE_DITENTUKAN,
  BATAS_ISTIRAHAT_JAM,
  SETELAN_BAWAAN
} from '../js/modules/attendance/istirahat.js';

let gagal = 0;
const bertanda = (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? `<<${String(v)}>>` : v);
const tulis = (v) => JSON.stringify(v, bertanda);
const cek = (nama, dapat, harap) => {
  if (tulis(dapat) !== tulis(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${tulis(dapat)}\n   harap : ${tulis(harap)}`);
  }
};

// =====================================================================
// SETELAN: outlet menimpa BU, PER KOLOM
// =====================================================================
cek('tanpa setelan apa pun -> bawaan', setelanEfektif(null, null), { ...SETELAN_BAWAAN, dari: 'bawaan' });

const bu = { break_mode: MODE_DITENTUKAN, break_start: '12:00:00', break_end: '13:00:00', standard_work_hours: 7, auto_close_after_hours: 10 };
cek('setelan BU dipakai kalau outlet belum punya', setelanEfektif(bu, null), {
  breakMode: MODE_DITENTUKAN,
  breakStart: '12:00:00',
  breakEnd: '13:00:00',
  standardWorkHours: 7,
  autoCloseAfterHours: 10,
  dari: 'bu'
});

// PER KOLOM, bukan per baris. Outlet yang cuma mengubah jam istirahatnya tidak
// boleh kehilangan `standard_work_hours` milik BU-nya hanya karena barisnya ada.
const outletSebagian = { break_start: '14:00:00', break_end: '15:00:00' };
const gabung = setelanEfektif(bu, outletSebagian);
cek('outlet menimpa jam istirahatnya', [gabung.breakStart, gabung.breakEnd], ['14:00:00', '15:00:00']);
cek('tapi jam kerja standar BU tetap terpakai', gabung.standardWorkHours, 7);
cek('dan mode BU tetap terpakai', gabung.breakMode, MODE_DITENTUKAN);
cek('sumbernya disebut', gabung.dari, 'outlet');

cek('mode tak dikenal jatuh ke bebas', setelanEfektif({ break_mode: 'entah' }, null).breakMode, MODE_BEBAS);
// Nol DITOLAK, berbeda dari tempat lain di repo ini yang memperlakukan 0
// sebagai nilai sah. Di sini 0 bukan "gratis" melainkan "jam kerja nol jam" —
// clock out otomatis akan jatuh PERSIS di jam masuk, dan durasi nol lolos ke
// NBM tanpa satu pun error.
cek('jam kerja 0 tidak dipakai', setelanEfektif({ standard_work_hours: 0 }, null).standardWorkHours, 8);
cek('jam kerja negatif tidak dipakai', setelanEfektif({ standard_work_hours: -3 }, null).standardWorkHours, 8);
cek('batas tutup 0 tidak dipakai', setelanEfektif({ auto_close_after_hours: 0 }, null).autoCloseAfterHours, 12);

// Kolom yang NULL berarti "ikut yang di atas" — itu yang membuat penimpaan
// per kolom mungkin, dan yang dulu dipatahkan `not null default` di tabelnya.
cek(
  'kolom null di baris outlet mewarisi BU',
  setelanEfektif({ standard_work_hours: 7 }, { standard_work_hours: null, break_mode: 'bebas' }).standardWorkHours,
  7
);

// =====================================================================
// JENDELA JAM
// =====================================================================
cek('jam biasa di dalam jendela', dalamJendela('12:30', '12:00', '13:00'), true);
cek('tepat di batas awal ikut', dalamJendela('12:00', '12:00', '13:00'), true);
cek('tepat di batas akhir ikut', dalamJendela('13:00', '12:00', '13:00'), true);
cek('di luar jendela', dalamJendela('11:59', '12:00', '13:00'), false);

// Jendela yang MELEWATI TENGAH MALAM. Shift malam ada di aplikasi ini;
// perbandingan lurus akan menolak seluruh jam yang sah tanpa satu pun pesan.
cek('jendela lintas tengah malam: 23:30 ikut', dalamJendela('23:30', '23:00', '01:00'), true);
cek('jendela lintas tengah malam: 00:30 ikut', dalamJendela('00:30', '23:00', '01:00'), true);
cek('jendela lintas tengah malam: 12:00 TIDAK ikut', dalamJendela('12:00', '23:00', '01:00'), false);

cek('detik boleh ada', keMenit('12:34:56'), 12 * 60 + 34);
cek('jam tidak sah -> null', keMenit('25:00'), null);
cek('menit tidak sah -> null', keMenit('12:70'), null);
cek('teks kosong -> null', keMenit(''), null);
cek('jendela dengan jam rusak -> false', dalamJendela('12:00', 'x', '13:00'), false);

// =====================================================================
// TOMBOL ISTIRAHAT
// =====================================================================
const bebas = setelanEfektif(null, null);
cek('mode bebas: kapan pun boleh', bolehMulaiIstirahat({ setelan: bebas, jamSekarang: '03:00' }), { boleh: true, sebab: '' });
cek('sudah clock out: tidak boleh', bolehMulaiIstirahat({ setelan: bebas, jamSekarang: '12:00', sudahClockOut: true }).boleh, false);
cek('sedang istirahat: tidak boleh', bolehMulaiIstirahat({ setelan: bebas, jamSekarang: '12:00', sedangIstirahat: true }).boleh, false);

// SATU ISTIRAHAT PER HARI KERJA — ditolak walau yang pertama sudah SELESAI.
const sudahDipakai = bolehMulaiIstirahat({ setelan: bebas, jamSekarang: '12:00', sudahIstirahat: true });
cek('jatah hari ini sudah dipakai: tidak boleh', sudahDipakai.boleh, false);
cek('sebabnya menyebut sekali sehari', /sekali dalam satu hari kerja/i.test(sudahDipakai.sebab), true);

// Diperiksa SEBELUM jendela jam. Kalau jatahnya sudah dipakai, "di luar jam
// istirahat" adalah sebab yang salah — orangnya akan menunggu sampai jamnya
// tiba lalu menekan lagi, dan ditolak lagi tanpa tahu kenapa.
const sudahDanDiLuarJam = bolehMulaiIstirahat({
  setelan: setelanEfektif({ break_mode: MODE_DITENTUKAN, break_start: '12:00:00', break_end: '13:00:00' }, null),
  jamSekarang: '20:00',
  sudahIstirahat: true
});
cek('sebab "sudah dipakai" menang atas "di luar jam"', /sekali dalam satu hari kerja/i.test(sudahDanDiLuarJam.sebab), true);

// "Masih berjalan" dan "sudah dipakai" adalah dua keadaan berbeda, dan
// menuntut tindakan berbeda dari yang membacanya.
cek(
  'sedang berjalan tetap punya sebabnya sendiri',
  bolehMulaiIstirahat({ setelan: bebas, jamSekarang: '12:00', sedangIstirahat: true, sudahIstirahat: true }).sebab,
  'Istirahatmu masih berjalan.'
);

const ditentukan = setelanEfektif({ break_mode: MODE_DITENTUKAN, break_start: '12:00:00', break_end: '13:00:00' }, null);
cek('mode ditentukan: di dalam jam -> boleh', bolehMulaiIstirahat({ setelan: ditentukan, jamSekarang: '12:30' }).boleh, true);
const diTolak = bolehMulaiIstirahat({ setelan: ditentukan, jamSekarang: '15:00' });
cek('mode ditentukan: di luar jam -> tidak boleh', diTolak.boleh, false);
// Sebabnya menyebut JAMNYA. "Tidak bisa" tanpa angka membuat staff menekan
// tombolnya berulang kali dan menyimpulkan aplikasinya rusak.
cek('sebabnya menyebut jamnya', /12:00.*13:00/.test(diTolak.sebab), true);

// Mode 'ditentukan' tanpa jam adalah setelan yang tidak bisa dijalankan.
const setengah = setelanEfektif({ break_mode: MODE_DITENTUKAN }, null);
const pincang = bolehMulaiIstirahat({ setelan: setengah, jamSekarang: '12:00' });
cek('ditentukan tanpa jam: ditolak', pincang.boleh, false);
cek('dan sebabnya menunjuk admin', /admin/i.test(pincang.sebab), true);

// Kembali TIDAK dibatasi jendela — menolaknya cuma menghukum orang yang
// kembali lebih awal, karena istirahatnya lalu digantung sampai 2 jam.
cek('kembali selalu boleh kalau ada yang berjalan', bolehSelesaiIstirahat({ sedangIstirahat: true }).boleh, true);
cek('kembali tanpa istirahat berjalan: ditolak', bolehSelesaiIstirahat({}).boleh, false);

// =====================================================================
// BATAS 2 JAM
// =====================================================================
const T0 = new Date('2026-09-12T12:00:00+07:00').getTime();
cek('batas kembali = mulai + 2 jam', batasKembali(T0), T0 + BATAS_ISTIRAHAT_JAM * 3600 * 1000);
cek('mulai tidak sah -> null', batasKembali('bukan angka'), null);

// =====================================================================
// JAM TUTUP OTOMATIS
// =====================================================================
const masukPagi = new Date('2026-09-12T08:00:00+07:00').getTime();

// Tanpa shift -> jam kerja standar.
cek('tanpa shift: masuk + 8 jam', jamTutupOtomatis({ clockInMs: masukPagi, jamStandar: 8 }), {
  waktu: masukPagi + 8 * 3600 * 1000,
  dari: 'standar'
});
cek('jam standar bisa diubah', jamTutupOtomatis({ clockInMs: masukPagi, jamStandar: 7 }).waktu, masukPagi + 7 * 3600 * 1000);

// Dengan shift -> jam pulang shiftnya, BUKAN 12 jam sesudah masuk.
//
// Inilah inti permintaannya: "dianggap masuk seperti biasa tanpa lembur".
const denganShift = jamTutupOtomatis({ clockInMs: masukPagi, shift: { start: '08:00', end: '17:00' }, jamStandar: 8 });
cek('dengan shift: jam pulang shiftnya', new Date(denganShift.waktu).getHours(), 17);
cek('sumbernya shift', denganShift.dari, 'shift');
// 12 jam sesudah masuk adalah jam 20:00 — kalau itu yang terpakai, staffnya
// tercatat lembur 4 jam yang tidak pernah terjadi.
cek('BUKAN 12 jam sesudah masuk', denganShift.waktu !== masukPagi + 12 * 3600 * 1000, true);

// Shift malam yang melewati tengah malam.
const masukMalam = new Date('2026-09-12T22:00:00+07:00').getTime();
const shiftMalam = jamTutupOtomatis({ clockInMs: masukMalam, shift: { start: '22:00', end: '07:00' }, jamStandar: 8 });
cek('shift malam: pulang HARI BERIKUTNYA', new Date(shiftMalam.waktu).getDate(), 13);
cek('shift malam: jam 07', new Date(shiftMalam.waktu).getHours(), 7);
cek('shift malam: durasinya 9 jam', (shiftMalam.waktu - masukMalam) / 3600000, 9);
cek('shift malam: sumbernya tetap shift', shiftMalam.dari, 'shift');

// JAM KELUAR TIDAK BOLEH MENDAHULUI JAM MASUK.
//
// Terjadi kalau jadwalnya diubah sesudah orangnya masuk, atau ia masuk jauh
// sesudah shiftnya usai. Durasi negatif menghasilkan angka mustahil di NBM.
const telatSekali = jamTutupOtomatis({ clockInMs: new Date('2026-09-12T18:00:00+07:00').getTime(), shift: { start: '08:00', end: '17:00' }, jamStandar: 8 });
cek('jam keluar < jam masuk: jatuh ke jam standar', telatSekali.dari, 'standar');
cek('dan durasinya positif', telatSekali.waktu > new Date('2026-09-12T18:00:00+07:00').getTime(), true);

cek('shift rusak jatuh ke standar', jamTutupOtomatis({ clockInMs: masukPagi, shift: { start: 'x', end: 'y' } }).dari, 'standar');
cek('clockIn tidak sah tidak melempar', jamTutupOtomatis({ clockInMs: 'entah' }).dari, 'standar');

// =====================================================================
// REKAP MENIT ISTIRAHAT
// =====================================================================
const A = '2026-09-12T12:00:00+07:00';
const B = '2026-09-12T12:45:00+07:00';
cek('satu istirahat 45 menit', totalMenitIstirahat([{ mulai_at: A, selesai_at: B }]).menit, 45);
cek('dua istirahat dijumlahkan', totalMenitIstirahat([{ mulai_at: A, selesai_at: B }, { mulai_at: A, selesai_at: B }]).menit, 90);
cek('yang otomatis dihitung terpisah', totalMenitIstirahat([{ mulai_at: A, selesai_at: B, otomatis: true }]).otomatis, 1);

// Yang masih berjalan DIJEPIT ke 2 jam: sesudah itu server menutupnya di angka
// yang sama, dan rekap yang terus tumbuh akan berbeda dari angka final.
const sekarang = new Date('2026-09-12T20:00:00+07:00').getTime();
const berjalan = totalMenitIstirahat([{ mulai_at: A }], sekarang);
cek('istirahat berjalan dijepit 2 jam', berjalan.menit, 120);
cek('dan ditandai berjalan', berjalan.berjalan, 1);

cek('daftar kosong', totalMenitIstirahat([]), { menit: 0, berjalan: 0, otomatis: 0 });
cek('argumen bukan array tidak melempar', totalMenitIstirahat(null).menit, 0);
cek('selesai mendahului mulai diabaikan', totalMenitIstirahat([{ mulai_at: B, selesai_at: A }]).menit, 0);

// =====================================================================
// YANG TIDAK BOLEH ADA DI BERKAS INI
//
// Istirahat tidak berpengaruh ke NBM. Berkas aturan ini sengaja TIDAK punya
// fungsi yang mengurangi jam kerja — godaan "kan lebih adil kalau dipotong"
// akan datang dari orang yang tidak membaca permintaan aslinya.
// =====================================================================
const modul = await import('../js/modules/attendance/istirahat.js');
const namaEkspor = Object.keys(modul);
cek(
  'tidak ada ekspor yang berbau memotong jam kerja',
  namaEkspor.filter((n) => /bersih|dipotong|kurangiJam|jamKerjaEfektif|netto/i.test(n)),
  []
);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log(
  'Istirahat & clock out otomatis benar untuk 57 kasus — termasuk satu istirahat per hari kerja, shift lintas tengah malam, ' +
    'jam keluar yang tidak boleh mendahului masuk, dan kolom null yang berarti "ikut yang di atas". ✅'
);
