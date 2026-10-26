/**
 * TEKS LAPORAN PENJUALAN BENGKEL — tes murni.
 *
 *   §1 Tanggal panjang, dan kenapa tidak lewat `new Date(iso)`.
 *   §2 Laporan satu hari.
 *   §3 Rekap beberapa hari.
 *   §4 Isian aneh tidak menghasilkan angka yang menyesatkan.
 *
 * ============ YANG SEBENARNYA DIUJI DI SINI ============
 *
 * Teks ini keluar dari aplikasi dan masuk ke grup WhatsApp, lalu hidup sendiri
 * di sana. Angka yang salah di dalamnya tidak bisa ditarik kembali dan tidak
 * bisa dibantah — ia terlihat sama resminya dengan yang benar, dan yang
 * membacanya tidak punya cara memeriksanya selain membuka aplikasinya.
 */
import {
  pesanPenjualanHarian,
  pesanRekapPeriode,
  tanggalPanjang
} from '../js/modules/sparepart/pesan-penjualan-bengkel.js';

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
console.log('§1 Tanggal panjang');
// ===============================================================
cek('§1 hari & bulan Indonesia', tanggalPanjang('2026-10-26'), 'Senin, 26 Oktober 2026');
cek('§1 awal bulan', tanggalPanjang('2026-10-01'), 'Kamis, 1 Oktober 2026');
cek('§1 tanpa nol di depan tanggal', tanggalPanjang('2026-01-05'), 'Senin, 5 Januari 2026');
cek('§1 akhir tahun', tanggalPanjang('2026-12-31'), 'Kamis, 31 Desember 2026');
cek('§1 tahun kabisat', tanggalPanjang('2024-02-29'), 'Kamis, 29 Februari 2024');

// ============ KENAPA TIDAK LEWAT `new Date('2026-10-26')` ============
//
// String ISO tanpa jam dibaca sebagai tengah malam UTC. Di WIB (UTC+7) ia
// tetap tanggal yang sama, jadi bug-nya TIDAK akan pernah muncul di sini —
// tapi ia muncul begitu ada yang membuka aplikasinya dari zona barat UTC, dan
// judul laporannya mundur satu hari.
//
// Laporan yang tanggalnya meleset satu hari tidak terlihat seperti kesalahan
// program. Ia terlihat seperti staff yang salah pilih tanggal, dan yang
// dicari orang adalah staffnya.
cek('§1 tidak bergeser oleh zona waktu', tanggalPanjang('2026-10-26').startsWith('Senin'), true);

cek('§1 bentuk tak dikenal dikembalikan apa adanya', tanggalPanjang('kemarin'), 'kemarin');
cek('§1 kosong', tanggalPanjang(''), '');
cek('§1 null', tanggalPanjang(null), '');

// ===============================================================
console.log('§2 Laporan satu hari');
// ===============================================================
const satu = pesanPenjualanHarian({
  outlet: 'Otonix Depok',
  tanggal: '2026-10-26',
  sparepart: 4500000,
  jasa: 1200000,
  catatan: '2 unit servis besar',
  oleh: 'iko'
});
benar('§2 memuat nama outlet', satu.includes('Otonix Depok'));
benar('§2 memuat tanggal panjang', satu.includes('Senin, 26 Oktober 2026'));
benar('§2 sparepart', satu.includes('Sparepart : Rp4.500.000'));
benar('§2 jasa', satu.includes('Jasa      : Rp1.200.000'));

// TOTAL dihitung, bukan diminta dari pemanggilnya.
//
// Kalau totalnya ikut dikirim sebagai argumen, layar yang lupa menghitungnya
// ulang sesudah angkanya diubah akan mengirim total LAMA bersama rincian
// BARU — dan pesannya tetap terlihat masuk akal, karena ketiganya angka.
benar('§2 total dihitung dari kedua angka', satu.includes('*TOTAL    : Rp5.700.000*'));
benar('§2 catatan ikut', satu.includes('Catatan: 2 unit servis besar'));
benar('§2 pelapor ikut', satu.includes('Dilaporkan oleh: iko'));

const tanpaEkstra = pesanPenjualanHarian({ outlet: 'Otonix Bogor', tanggal: '2026-10-26', sparepart: 0, jasa: 250000 });
benar('§2 tanpa catatan: barisnya tidak muncul', !tanpaEkstra.includes('Catatan:'), tanpaEkstra);
benar('§2 tanpa pelapor: barisnya tidak muncul', !tanpaEkstra.includes('Dilaporkan oleh:'), tanpaEkstra);
// Hari yang hanya berisi jasa tetap sah — bengkel bisa seharian tanpa menjual
// sparepart, dan Rp0 di situ adalah fakta, bukan isian yang terlewat.
benar('§2 sparepart nol ditulis Rp0, bukan dihilangkan', tanpaEkstra.includes('Sparepart : Rp0'));
benar('§2 totalnya benar', tanpaEkstra.includes('*TOTAL    : Rp250.000*'));

benar('§2 outlet kosong dikatakan, bukan dibiarkan kosong', pesanPenjualanHarian({ tanggal: '2026-10-26' }).includes('(outlet tidak disebut)'));

// ===============================================================
console.log('§3 Rekap beberapa hari');
// ===============================================================
const rekap = pesanRekapPeriode({
  outlet: 'Otonix Depok',
  dari: '2026-10-01',
  sampai: '2026-10-03',
  // Sengaja TIDAK urut. Baris datang dari layar yang mengurutkannya terbaru
  // dulu; rekap yang mengikuti urutan itu terbaca mundur dan membuat orang
  // mengira tanggalnya salah.
  baris: [
    { sale_date: '2026-10-03', omzet_sparepart: 300, omzet_jasa: 0 },
    { sale_date: '2026-10-01', omzet_sparepart: 100, omzet_jasa: 50 },
    { sale_date: '2026-10-02', omzet_sparepart: 200, omzet_jasa: 20 }
  ]
});
const urutan = ['2026-10-01', '2026-10-02', '2026-10-03'].map((t) => rekap.indexOf(t));
benar('§3 diurutkan dari tanggal paling awal', urutan[0] < urutan[1] && urutan[1] < urutan[2], rekap);
benar('§3 total sparepart', rekap.includes('Sparepart : Rp600'));
benar('§3 total jasa', rekap.includes('Jasa      : Rp70'));
benar('§3 total keseluruhan', rekap.includes('*TOTAL    : Rp670*'));

// ============ HARI YANG DILAPORKAN, BUKAN HARI KALENDER ============
//
// Yang membaca rekap ini akan membagi totalnya untuk mencari rata-rata harian.
// Membagi dengan hari kalender membuat rata-ratanya terlihat turun hanya
// karena ada hari yang lupa dilapor — dan itu terbaca seperti penjualan yang
// melemah, bukan seperti laporan yang belum lengkap.
benar('§3 menyebut jumlah hari yang DILAPORKAN', rekap.includes('(3 hari dilaporkan)'), rekap);

const bolong = pesanRekapPeriode({
  outlet: 'Otonix Depok',
  dari: '2026-10-01',
  sampai: '2026-10-31',
  baris: [{ sale_date: '2026-10-01', omzet_sparepart: 100, omzet_jasa: 0 }]
});
benar('§3 rentang 31 hari dengan 1 laporan tetap bilang "1 hari"', bolong.includes('(1 hari dilaporkan)'), bolong);

const kosong = pesanRekapPeriode({ outlet: 'Otonix Depok', dari: '2026-10-01', sampai: '2026-10-31', baris: [] });
benar('§3 rentang kosong dikatakan, bukan dibiarkan kosong', kosong.includes('(belum ada laporan di rentang ini)'));
benar('§3 totalnya nol, bukan NaN', kosong.includes('*TOTAL    : Rp0*'), kosong);
benar('§3 tanpa outlet disebut "semua outlet"', pesanRekapPeriode({ baris: [] }).includes('(semua outlet)'));

// ===============================================================
console.log('§4 Isian aneh tidak menghasilkan angka yang menyesatkan');
// ===============================================================

// ============ `Number(null)` ADALAH 0, BUKAN NaN ============
//
// Itu sudah menggigit modul lain di proyek ini. Di sini bahayanya terbalik:
// yang berbahaya BUKAN nol, melainkan NaN yang lolos ke teksnya. "Rp NaN" di
// grup WhatsApp membuat seluruh laporannya dibuang — termasuk angka yang benar
// di sebelahnya.
benar('§4 teks tidak menghasilkan NaN', !pesanPenjualanHarian({ sparepart: 'abc', jasa: undefined }).includes('NaN'));
benar('§4 null jadi Rp0', pesanPenjualanHarian({ sparepart: null, jasa: null }).includes('*TOTAL    : Rp0*'));
benar(
  '§4 rekap dengan nilai cacat tidak menghasilkan NaN',
  !pesanRekapPeriode({ baris: [{ sale_date: '2026-10-01', omzet_sparepart: 'x', omzet_jasa: null }] }).includes('NaN')
);

// Desimal dibulatkan, tidak dibiarkan "Rp4.500.000,4" — nominal rupiah di
// laporan harian tidak pernah berdesimal, dan desimal yang muncul membuat
// orang mengira angkanya hasil hitungan lain.
benar('§4 desimal dibulatkan', pesanPenjualanHarian({ sparepart: 1000.4, jasa: 0 }).includes('Rp1.000'));

cek('§4 tanpa argumen tidak melempar', typeof pesanPenjualanHarian(), 'string');
cek('§4 rekap tanpa argumen tidak melempar', typeof pesanRekapPeriode(), 'string');
benar('§4 baris bukan array tidak melempar', typeof pesanRekapPeriode({ baris: 'bukan array' }) === 'string');

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-pesan-penjualan-bengkel: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
