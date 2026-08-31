/**
 * TES: penyusunan daftar bahan di layar Stok Opname.
 *
 * Yang dijaga di sini semuanya bertipe "salah tapi tidak error":
 *
 *   - bahan yang dihitung NOL dianggap belum dihitung
 *   - angka yang sedang diketik tertimpa angka server
 *   - urutan asli (tata letak rak) teracak oleh pengurutan status
 *   - array milik layar lain ikut teracak karena `sort()` di tempat
 *   - angka kemajuan ikut berubah saat penyaring diganti
 */
import {
  SARING,
  sudahDihitung,
  nilaiKotak,
  susunDaftar,
  hitungBelumTersimpan,
  keteranganHitung
} from '../js/modules/inventory/opname-daftar.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

const bahan = [
  { id: 'p1', name: 'Mentega' },
  { id: 'p2', name: 'Mika Sekat' },
  { id: 'p3', name: 'Minyak Goreng' },
  { id: 'p4', name: 'Oregano' },
  { id: 'p5', name: 'Gas' }
];

const tersimpan = new Map([
  ['p1', { counted_qty: 1000, counted_at: '2026-08-31T02:16:30Z', penghitung: { full_name: 'Adhe' } }],
  ['p3', { counted_qty: 20000, counted_at: '2026-08-31T02:16:30Z', penghitung: { full_name: 'Adhe' } }],
  // DIHITUNG DAN TERNYATA NOL. Ini kasus yang paling mudah salah.
  ['p5', { counted_qty: 0, counted_at: '2026-08-31T03:00:00Z', penghitung: { full_name: 'Widyantoro' } }]
]);

// =====================================================================
// 1. NOL ADALAH HITUNGAN YANG SAH
//
// Kalau `0` dianggap belum dihitung, bahan yang raknya memang kosong akan
// didatangi berulang kali oleh orang berikutnya — persis bahan yang paling
// perlu ditandai selesai.
// =====================================================================
cek('1. p1 (1000) sudah dihitung', sudahDihitung(tersimpan, 'p1'), true);
cek('1. p5 (0) TETAP dihitung sudah', sudahDihitung(tersimpan, 'p5'), true);
cek('1. p2 (tidak ada barisnya) belum', sudahDihitung(tersimpan, 'p2'), false);
cek('1. peta kosong: belum', sudahDihitung(new Map(), 'p1'), false);
cek('1. bukan Map: tidak meledak', sudahDihitung(null, 'p1'), false);

// =====================================================================
// 2. NILAI KOTAK — yang sedang diketik menang
// =====================================================================
const draft = new Map([['p1', '800'], ['p2', '46']]);

cek('2. yang diketik menang atas yang tersimpan', nilaiKotak(draft, tersimpan, 'p1'), '800');
cek('2. yang tersimpan tampil kalau tidak diketik', nilaiKotak(draft, tersimpan, 'p3'), '20000');
cek('2. nol tersimpan tampil sebagai "0", bukan kosong', nilaiKotak(draft, tersimpan, 'p5'), '0');
cek('2. belum apa-apa: kosong', nilaiKotak(draft, tersimpan, 'p4'), '');

// Kotak yang SENGAJA dikosongkan orangnya tidak boleh diisi ulang dari server.
// Kalau diisi ulang, angka yang baru saja dihapus muncul lagi sendiri — dan
// orangnya akan mengira ketikannya tidak tersimpan.
cek('2. dikosongkan sengaja: tetap kosong', nilaiKotak(new Map([['p1', '']]), tersimpan, 'p1'), '');

// =====================================================================
// 3. YANG BELUM DIHITUNG NAIK KE ATAS
// =====================================================================
let h = susunDaftar(bahan, { tersimpan, draft });
cek('3. urutannya: belum dulu, lalu sudah', h.baris.map((b) => b.id), ['p2', 'p4', 'p1', 'p3', 'p5']);

// Di dalam tiap kelompok, urutan ASLI dipertahankan. Kalau modul ini ikut
// mengurutkan nama, tata letak rak yang sudah diatur pemanggil akan tertimpa
// diam-diam.
cek('3. urutan asli di dalam kelompok "belum" utuh', h.baris.slice(0, 2).map((b) => b.name), ['Mika Sekat', 'Oregano']);
cek('3. urutan asli di dalam kelompok "sudah" utuh', h.baris.slice(2).map((b) => b.name), ['Mentega', 'Minyak Goreng', 'Gas']);

// =====================================================================
// 4. ARRAY ASLI TIDAK BOLEH TERACAK
//
// `sort()` bekerja di tempat. Panel lain di halaman yang sama memakai daftar
// bahan yang sama, dan mengacaknya di sini akan mengubah urutan di layar lain
// tanpa satu pun tanda.
// =====================================================================
cek('4. array masukan tidak berubah', bahan.map((b) => b.id), ['p1', 'p2', 'p3', 'p4', 'p5']);

// =====================================================================
// 5. PENYARING
// =====================================================================
cek('5. saring BELUM', susunDaftar(bahan, { tersimpan, saring: SARING.BELUM }).baris.map((b) => b.id), ['p2', 'p4']);
cek('5. saring SUDAH', susunDaftar(bahan, { tersimpan, saring: SARING.SUDAH }).baris.map((b) => b.id), ['p1', 'p3', 'p5']);
cek('5. saring SEMUA', susunDaftar(bahan, { tersimpan, saring: SARING.SEMUA }).baris.length, 5);

// ANGKA KEMAJUAN DIHITUNG DARI SELURUH DAFTAR, bukan dari yang tampak.
// "3 dari 5" yang berubah jadi "0 dari 2" begitu penyaring diganti akan
// membuat orang mengira pekerjaannya hilang.
const hBelum = susunDaftar(bahan, { tersimpan, saring: SARING.BELUM });
cek('5. total tetap 5 walau disaring', hBelum.total, 5);
cek('5. selesai tetap 3 walau disaring', hBelum.selesai, 3);
cek('5. belum tetap 2', hBelum.belum, 2);

// =====================================================================
// 6. BERAPA YANG BELUM TERSIMPAN
// =====================================================================
cek('6. p1 diubah 1000->800 dan p2 baru: 2 belum tersimpan', hitungBelumTersimpan(draft, tersimpan), 2);

// Kotak yang dibuka lalu diketik ulang dengan angka YANG SAMA tidak dihitung.
cek('6. diketik ulang angka yang sama: 0', hitungBelumTersimpan(new Map([['p1', '1000']]), tersimpan), 0);
cek('6. "1000.0" dianggap sama dengan 1000', hitungBelumTersimpan(new Map([['p1', '1000.0']]), tersimpan), 0);
cek('6. kotak kosong tidak dihitung', hitungBelumTersimpan(new Map([['p4', '']]), tersimpan), 0);
cek('6. mengisi 0 pada yang belum dihitung: dihitung', hitungBelumTersimpan(new Map([['p4', '0']]), tersimpan), 1);
cek('6. mengetik 0 pada p5 yang memang 0: tidak dihitung', hitungBelumTersimpan(new Map([['p5', '0']]), tersimpan), 0);
cek('6. bukan Map: 0, tidak meledak', hitungBelumTersimpan(null, tersimpan), 0);

// =====================================================================
// 7. KETERANGAN SIAPA-KAPAN
// =====================================================================
benar('7. menyebut nama penghitungnya', /Adhe/.test(keteranganHitung(tersimpan, 'p1') ?? ''), keteranganHitung(tersimpan, 'p1'));
cek('7. belum dihitung: null, bukan string kosong', keteranganHitung(tersimpan, 'p2'), null);
benar(
  '7. tanpa waktu: tetap menyebut nama',
  keteranganHitung(new Map([['x', { counted_qty: 1, penghitung: { full_name: 'Budi' } }]]), 'x') === 'dihitung Budi'
);
benar(
  '7. tanpa nama: tidak menulis "undefined"',
  !/undefined/.test(keteranganHitung(new Map([['x', { counted_qty: 1, counted_at: '2026-08-31T02:00:00Z' }]]), 'x') ?? '')
);

// =====================================================================
// 8. BENTUK YANG TIDAK LENGKAP TIDAK BOLEH MELEDAK
// =====================================================================
cek('8. bahan null', susunDaftar(null, { tersimpan }).baris, []);
cek('8. tanpa opsi sama sekali', susunDaftar(bahan).baris.length, 5);
cek('8. tersimpan null: semua dianggap belum', susunDaftar(bahan, { tersimpan: null }).selesai, 0);

console.log(gagal === 0 ? '✅ daftar opname: semua lulus' : `❌ daftar opname: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
