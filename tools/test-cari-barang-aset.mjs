/**
 * PENCARIAN BARANG SAAT MEMILIH — tes murni.
 *
 * ============ YANG SEBENARNYA DIUJI DI SINI ============
 *
 * Kotak ini dipakai sambil berdiri di dekat barangnya, oleh orang yang
 * terburu-buru, untuk memilih barang yang akan BERPINDAH. Tidak ada penerima
 * yang menghitung ulang dan menolak.
 *
 * Jadi dua kegagalan yang diuji di sini keduanya tanpa galat:
 *   - barang yang ada tapi tidak ketemu -> orangnya menyimpulkan belum
 *     terdaftar, lalu mendaftarkan kembar dengan nama versinya sendiri
 *   - pilihan yang hilang karena saringan -> jumlah yang sudah diisi lenyap
 *     tanpa satu pun tanda
 */
import {
  cocokBarang,
  kalimatTerpilih,
  ladangCari,
  ringkasTerpilih,
  saringBarang
} from '../js/modules/asset/cari-barang-aset.js';

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

const DAFTAR = [
  { itemId: '1', kode: 'B005', name: 'Gelas Cocktail', category: 'Bar', notes: 'kaca tipis', batas: 15 },
  { itemId: '2', kode: 'B006', name: 'Gelas Coctail kaki pendek', category: 'Bar', notes: '', batas: 51 },
  { itemId: '3', kode: 'K001', name: 'Teko Tea Teh', category: 'Kitchen', notes: 'gagang kayu', batas: 4 },
  { itemId: '4', kode: 'B011', name: 'KENDI', category: 'Bar', notes: null, batas: 4 }
];

// ===============================================================
console.log('§1 Ladang yang dicari');
// ===============================================================
benar('§1 kode ikut', ladangCari(DAFTAR[0]).includes('b005'));
benar('§1 nama ikut', ladangCari(DAFTAR[0]).includes('gelas cocktail'));
benar('§1 kategori ikut', ladangCari(DAFTAR[0]).includes('bar'));
benar('§1 catatan ikut', ladangCari(DAFTAR[0]).includes('kaca tipis'));
cek('§1 null tidak jadi kata "null"', ladangCari({ name: 'A', notes: null }), 'a');
cek('§1 tanpa argumen', ladangCari(), '');

// ===============================================================
console.log('§2 Pencocokan');
// ===============================================================
benar('§2 kosong cocok semua', cocokBarang(DAFTAR[0], ''));
benar('§2 tanpa argumen kedua cocok', cocokBarang(DAFTAR[0]));
benar('§2 huruf besar-kecil diabaikan', cocokBarang(DAFTAR[3], 'kendi'));
benar('§2 ketemu lewat kode', cocokBarang(DAFTAR[2], 'K001'));
benar('§2 ketemu lewat kategori', cocokBarang(DAFTAR[2], 'kitchen'));
benar('§2 ketemu lewat catatan', cocokBarang(DAFTAR[2], 'gagang'));

// ============ KATA DIPECAH, DAN DIGABUNG DENGAN "DAN" ============
//
// "gelas pendek" harus menemukan "Gelas Coctail kaki pendek" — kalau frasanya
// dicocokkan utuh, ia tidak ketemu, dan orangnya akan mendaftarkan barang
// kembar dengan nama versinya sendiri.
benar('§2 dua kata terpisah tetap ketemu', cocokBarang(DAFTAR[1], 'gelas pendek'));
benar('§2 urutan kata tidak penting', cocokBarang(DAFTAR[1], 'pendek gelas'));
// Dan "DAN", bukan "ATAU": kalau salah satu kata cukup, "gelas kayu" akan
// mengembalikan hampir seluruh daftar — dan daftar yang nyaris tidak menyusut
// sama saja dengan tidak menyaring.
benar('§2 satu kata yang tidak cocok membatalkan', !cocokBarang(DAFTAR[1], 'gelas kayu'));
benar('§2 spasi berlebih tidak merusak', cocokBarang(DAFTAR[1], '  gelas   pendek  '));
benar('§2 yang tidak ada memang tidak ketemu', !cocokBarang(DAFTAR[0], 'piring'));

// ===============================================================
console.log('§3 Saringan tidak menyembunyikan yang sudah dipilih');
// ===============================================================
cek('§3 menyaring seperti biasa', saringBarang(DAFTAR, 'gelas').map((a) => a.itemId), ['1', '2']);
cek('§3 kosong = semua', saringBarang(DAFTAR, '').length, 4);
cek('§3 bukan array', saringBarang(null, 'x'), []);

// ============ INI PEMERIKSAAN INTINYA ============
//
// Mengisi jumlah untuk Teko, lalu mencari "gelas", TIDAK boleh membuat Teko
// hilang dari layar. Kalau ia hilang, yang mengisinya akan mengira pilihannya
// batal — atau lebih buruk, mengira yang terkirim hanya yang terlihat.
const terpilih = new Set(['3']);
const tampil = saringBarang(DAFTAR, 'gelas', terpilih).map((a) => a.itemId);
cek('§3 yang sudah diisi tetap tampil walau tidak cocok', tampil, ['1', '2', '3']);
benar('§3 dan tidak digandakan', new Set(tampil).size === tampil.length);
cek(
  '§3 yang sudah diisi DAN cocok tidak muncul dua kali',
  saringBarang(DAFTAR, 'gelas', new Set(['1'])).map((a) => a.itemId),
  ['1', '2']
);

// ===============================================================
console.log('§4 Ringkasan pilihan');
// ===============================================================
cek('§4 kosong', ringkasTerpilih(new Map()), { jenis: 0, unit: 0 });
cek('§4 dua jenis', ringkasTerpilih(new Map([['1', 2], ['2', 5]])), { jenis: 2, unit: 7 });
// Nol BUKAN pilihan. Menghitungnya membuat "3 jenis" untuk dua barang yang
// benar-benar dikirim.
cek('§4 nol tidak dihitung', ringkasTerpilih(new Map([['1', 0], ['2', 5]])), { jenis: 1, unit: 5 });
cek('§4 angka cacat tidak jadi NaN', ringkasTerpilih(new Map([['1', 'x'], ['2', 3]])), { jenis: 1, unit: 3 });
cek('§4 bukan Map', ringkasTerpilih(null), { jenis: 0, unit: 0 });

cek('§4 kalimat saat kosong', kalimatTerpilih(new Map()), 'Belum ada barang yang diisi jumlahnya.');
cek('§4 kalimat saat terisi', kalimatTerpilih(new Map([['1', 2], ['2', 5]])), 'Dipilih: 2 jenis · 7 unit');
// Kalimatnya SELALU ada — yang muncul-hilang tidak diperhatikan orang.
benar('§4 kalimatnya tidak pernah kosong', kalimatTerpilih(new Map()).length > 0);

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-cari-barang-aset: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
