/**
 * SALDO BERJALAN DI RIWAYAT KAS — tes murni.
 *
 * ============ YANG SEBENARNYA DIUJI DI SINI ============
 *
 * Kolom ini dibaca untuk mencocokkan catatan dengan uang fisik di laci. Jadi
 * yang berbahaya bukan angka yang salah — itu ketahuan — melainkan angka yang
 * MUNCUL padahal seharusnya tidak ada:
 *
 *   0 untuk "tidak diketahui"  -> dibaca "kantongnya kosong", lalu orang
 *                                 mulai mencari uang yang tidak hilang
 *   angka untuk entri dicoret  -> entri yang tidak pernah memindahkan uang
 *                                 terlihat seperti yang memindahkan
 */
import { petaSaldo, saldoTerkini, selSaldo, SEBAB_SALDO } from '../js/modules/cash/saldo-berjalan.js';

let gagal = 0;
let n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  n++;
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

// ===============================================================
console.log('§1 Membaca jawaban server');
// ===============================================================
const peta = petaSaldo([
  { id: 'a', saldo: 1000000 },
  { id: 'b', saldo: '750000' },
  { id: 'c', saldo: 0 }
]);
cek('§1 angka dibaca', peta.get('a'), 1000000);
cek('§1 string angka ikut dibaca', peta.get('b'), 750000);

// NOL ADALAH JAWABAN YANG SAH. Kantong yang isinya habis memang bersaldo 0,
// dan membuangnya bersama nilai cacat membuatnya terbaca "tidak diketahui".
cek('§1 nol tetap masuk peta', peta.get('c'), 0);
benar('§1 dan terbaca sebagai nol, bukan kosong', peta.has('c'));

const kotor = petaSaldo([{ id: 'x', saldo: null }, { id: 'y', saldo: 'abc' }, { saldo: 5 }, null]);
benar('§1 null tidak masuk', !kotor.has('x'));
benar('§1 teks cacat tidak jadi NaN di peta', !kotor.has('y'));
cek('§1 baris tanpa id diabaikan', kotor.size, 0);
cek('§1 bukan array', petaSaldo(null).size, 0);

// ===============================================================
console.log('§2 Tiga keadaan sel');
// ===============================================================
const E = (o) => ({ id: 'a', dicoret_at: null, dibayar_pusat: false, ...o });

cek('§2 ada angkanya', selSaldo(E({}), peta), { ada: true, nilai: 1000000, sebab: '' });

const dicoret = selSaldo(E({ dicoret_at: '2026-10-10T00:00:00Z' }), peta);
benar('§2 dicoret tidak diberi angka', dicoret.ada === false && dicoret.nilai === null);
cek('§2 dan sebabnya menyebut pencoretan', dicoret.sebab, SEBAB_SALDO.dicoret);

const pusat = selSaldo(E({ dibayar_pusat: true }), peta);
benar('§2 Dibayar Pusat tidak diberi angka', pusat.ada === false);
cek('§2 dan sebabnya menyebut Pusat', pusat.sebab, SEBAB_SALDO.pusat);

// ============ "TIDAK DIKETAHUI" PUNYA SEBABNYA SENDIRI ============
//
// Kalau ia memakai kalimat yang sama dengan "dicoret", orang yang entrinya
// tidak muncul angkanya akan mencari pencoretan yang tidak pernah ada.
const takTahu = selSaldo(E({ id: 'tidak-ada' }), peta);
benar('§2 yang tidak dikembalikan server tidak diberi angka', takTahu.ada === false);
cek('§2 sebabnya BEDA dari dicoret', takTahu.sebab, SEBAB_SALDO.takTahu);
benar('§2 ketiga sebabnya berbeda satu sama lain', new Set(Object.values(SEBAB_SALDO)).size === 3);

// Entri yang dicoret MEMANG tidak dikembalikan server. Kalau urutan
// pemeriksaannya dibalik, ia jatuh ke cabang "tidak diketahui".
const dicoretTakAda = selSaldo(E({ id: 'tidak-ada', dicoret_at: '2026-10-10T00:00:00Z' }), peta);
cek('§2 dicoret diperiksa SEBELUM "tidak diketahui"', dicoretTakAda.sebab, SEBAB_SALDO.dicoret);

cek('§2 peta bukan Map', selSaldo(E({}), null).sebab, SEBAB_SALDO.takTahu);
cek('§2 tanpa argumen tidak melempar', selSaldo().ada, false);

// ===============================================================
console.log('§3 Saldo terkini untuk dicocokkan dengan kepala halaman');
// ===============================================================
const p2 = petaSaldo([
  { id: 'lama', saldo: 1000000 },
  { id: 'mundur', saldo: 800000 },
  { id: 'baru', saldo: 650000 }
]);

// ============ BUKAN BARIS TERATAS DI LAYAR ============
//
// Daftar Staff App urut WAKTU KETIK; saldonya berjalan menurut TANGGAL ENTRI.
// Entri mundur yang baru saja diketik duduk di paling atas tanpa membawa
// saldo terakhir — mengambil baris teratas akan mencocokkan angka yang salah
// dengan saldo di kepala halaman, lalu menyatakan keduanya cocok.
const baris = [
  { id: 'mundur', entry_date: '2026-10-03', created_at: '2026-10-12T10:00:00Z' },
  { id: 'baru', entry_date: '2026-10-09', created_at: '2026-10-09T08:00:00Z' },
  { id: 'lama', entry_date: '2026-10-01', created_at: '2026-10-01T08:00:00Z' }
];
cek('§3 yang dipakai adalah tanggal entri terbaru', saldoTerkini(baris, p2), 650000);

cek('§3 daftar kosong', saldoTerkini([], p2), null);
cek('§3 bukan array', saldoTerkini(null, p2), null);

// Baris yang tidak punya angka dilewati, bukan dianggap nol.
cek(
  '§3 baris dicoret dilewati',
  saldoTerkini(
    [{ id: 'baru', entry_date: '2026-10-20', created_at: 'z', dicoret_at: 'x' }, baris[2]],
    p2
  ),
  1000000
);

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-saldo-berjalan: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
