/**
 * ATURAN DAFTAR ASET SE-BU — tes murni.
 *
 *   §1 Membaca & mengurutkan kode.
 *   §2 "Belum didata" bukan "tidak punya".
 *   §3 Dugaan kembar.
 *   §4 Peringatan nama mirip saat menambah.
 *   §5 Ringkasan outlet.
 *
 * ============ YANG SEBENARNYA DIUJI DI SINI ============
 *
 * Bukan "apakah daftarnya tampil" — itu bagian yang kelihatan. Yang diuji:
 * apakah dua keadaan yang artinya berbeda tetap bisa dibedakan sesudah
 * digabung. Item yang belum pernah didatangi siapa pun dan item yang sudah
 * dihitung dan memang nol, keduanya menampilkan angka 0; laporan yang
 * menjumlahkannya tetap benar, dan orang yang membacanya tetap salah.
 */
import {
  bacaKode,
  kalimatRiwayat,
  rekapKerusakan,
  cariMirip,
  dugaanKembar,
  gabungItemDenganStok,
  namaBaku,
  ringkasOutlet,
  urutKode
} from '../js/modules/asset/aturan-aset-bu.js';

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
console.log('§1 Membaca & mengurutkan kode');
// ===============================================================
cek('§1 kode biasa', bacaKode('B001'), { prefix: 'B', nomor: 1 });
cek('§1 prefix dua huruf', bacaKode('KI012'), { prefix: 'KI', nomor: 12 });
// Prefix cadangan memakai HURUF ("XA"), bukan angka. Dengan angka, "X2007"
// sama masuk akalnya dibaca X2+007 maupun X+2007 — dan yang membacanya harus
// menebak. 0168 sengaja tidak pernah membuat prefix berakhiran angka.
cek('§1 prefix cadangan dua huruf', bacaKode('XA007'), { prefix: 'XA', nomor: 7 });
cek('§1 nomor empat digit tetap terbaca utuh', bacaKode('B1234'), { prefix: 'B', nomor: 1234 });
cek('§1 huruf kecil dibakukan', bacaKode('b001'), { prefix: 'B', nomor: 1 });
cek('§1 spasi pinggir dibuang', bacaKode('  B001  '), { prefix: 'B', nomor: 1 });
cek('§1 bentuk tak dikenal tidak melempar', bacaKode('???'), { prefix: '???', nomor: null });
cek('§1 kosong', bacaKode(''), { prefix: '', nomor: null });
cek('§1 null', bacaKode(null), { prefix: '', nomor: null });

// ============ B10 TIDAK BOLEH MENDAHULUI B9 ============
//
// Mengurutkan kode sebagai teks biasa menaruh "B10" sebelum "B9". Itu tidak
// terlihat seperti kesalahan — daftarnya tetap berurutan rapi, cuma tidak
// seperti yang dicari mata orang yang sedang menyusuri rak sambil memegang HP.
const acak = ['B10', 'B2', 'B1', 'K1', 'B9', 'KI1'];
cek('§1 nomor diurutkan sebagai ANGKA', [...acak].sort(urutKode), ['B1', 'B2', 'B9', 'B10', 'K1', 'KI1']);
benar('§1 teks biasa memang salah urut', ['B10', 'B9'].sort().join() === 'B10,B9');

// Kode yang tidak terbaca ditaruh di BELAKANG, bukan di depan — daftarnya
// tetap dibuka dengan yang normal.
cek('§1 kode cacat di belakang', ['B2', '???', 'B1'].sort(urutKode), ['B1', 'B2', '???']);

// ===============================================================
console.log('§2 "Belum didata" bukan "tidak punya"');
// ===============================================================
const items = [
  { id: 'i1', kode: 'B001', name: 'Kursi Bar', category: 'Bar', size: '45 cm' },
  { id: 'i2', kode: 'B002', name: 'Meja Bar', category: 'Bar', size: null },
  { id: 'i3', kode: 'K001', name: 'Kompor', category: 'Kitchen', size: null }
];
const stok = [
  { id: 's1', asset_item_id: 'i1', qty: 10, condition: 'normal', size: '50 cm', updated_at: '2026-10-01' },
  // Sudah didata, dan hasilnya memang NOL.
  { id: 's2', asset_item_id: 'i2', qty: 0, condition: 'normal' }
  // i3 tidak ada sama sekali -> BELUM didata.
];
const baris = gabungItemDenganStok({ items, stok });

cek('§2 setiap item muncul, walau outletnya belum punya', baris.length, 3);
cek('§2 urutannya mengikuti daftar item', baris.map((b) => b.kode), ['B001', 'B002', 'K001']);

const b1 = baris[0];
const b2 = baris[1];
const b3 = baris[2];

cek('§2 jumlah dari stok', b1.qty, 10);
benar('§2 yang punya stok tidak ditandai belum didata', b1.belumDidata === false);

// ============ INI PEMERIKSAAN INTINYA ============
//
// b2 dan b3 sama-sama menampilkan 0. Yang satu berarti "sudah dicek, tidak
// ada", yang satu "belum ada yang melihat". Kalau keduanya tidak bisa
// dibedakan, orang yang membaca daftarnya akan mengira semuanya sudah dihitung.
cek('§2 sudah didata dan memang nol', [b2.qty, b2.belumDidata], [0, false]);
cek('§2 belum didata sama sekali', [b3.qty, b3.belumDidata], [0, true]);
benar('§2 keduanya BISA dibedakan', b2.belumDidata !== b3.belumDidata);

cek('§2 stokId ada untuk yang sudah didata', b2.stokId, 's2');
cek('§2 stokId null untuk yang belum', b3.stokId, null);

// Ukuran outlet menang atas ukuran acuan item — barang yang sama bisa beda
// ukuran di outlet yang berbeda.
cek('§2 ukuran outlet menang', b1.size, '50 cm');
// Dan kalau outletnya tidak menyebut, ukuran acuan itemnya yang dipakai.
cek('§2 kalau outlet tidak menyebut, pakai ukuran item', gabungItemDenganStok({ items, stok: [] })[0].size, '45 cm');

cek('§2 tanpa argumen tidak melempar', gabungItemDenganStok(), []);
cek('§2 stok bukan array tidak melempar', gabungItemDenganStok({ items, stok: 'x' }).length, 3);
// Baris stok yatim (itemnya sudah terhapus) tidak boleh memunculkan baris
// hantu yang tidak punya nama.
cek('§2 stok yatim diabaikan', gabungItemDenganStok({ items: [], stok }).length, 0);

// ===============================================================
console.log('§3 Dugaan kembar');
// ===============================================================
cek('§3 huruf besar diabaikan', namaBaku('Kursi Bar'), 'kursi bar');
cek('§3 spasi ganda dirapikan', namaBaku('Kursi  Bar'), 'kursi bar');
cek('§3 spasi pinggir dibuang', namaBaku('  Kursi Bar '), 'kursi bar');

const banyak = [
  { id: 'a', kode: 'B001', name: 'Kursi Bar' },
  { id: 'b', kode: 'B009', name: 'kursi bar' },
  { id: 'c', kode: 'B010', name: 'Kursi  Bar' },
  { id: 'd', kode: 'B002', name: 'Meja Bar' },
  { id: 'e', kode: 'K001', name: 'Kompor' }
];
const kembar = dugaanKembar(banyak);
cek('§3 hanya yang benar-benar kembar', kembar.map((k) => k.namaBaku), ['kursi bar']);
cek('§3 memuat ketiganya', kembar[0].items.length, 3);
// Diurutkan dengan aturan yang SAMA dengan daftarnya — kalau tidak, B010
// muncul sebelum B009 di layar rapikan, dan yang merapikan harus berpikir
// dua kali tentang mana yang paling lama.
cek('§3 diurutkan menurut kode, angka sebagai angka', kembar[0].items.map((i) => i.kode), ['B001', 'B009', 'B010']);

cek('§3 tidak ada kembar -> daftar kosong', dugaanKembar([{ id: 'x', name: 'A' }]), []);
cek('§3 tanpa argumen tidak melempar', dugaanKembar(), []);
// Nama kosong tidak boleh saling "kembar" — kalau tidak, seluruh baris cacat
// berkumpul jadi satu kelompok raksasa yang menutupi kembar yang sungguhan.
cek('§3 nama kosong tidak dianggap kembar', dugaanKembar([{ name: '' }, { name: '  ' }]), []);

// ===============================================================
console.log('§4 Peringatan nama mirip saat menambah');
// ===============================================================
cek('§4 mirip ketemu', cariMirip('KURSI BAR', banyak).map((i) => i.kode), ['B001', 'B009', 'B010']);
cek('§4 spasi ganda juga ketemu', cariMirip('Kursi   Bar', banyak).length, 3);
cek('§4 nama yang memang baru -> kosong', cariMirip('Kulkas', banyak), []);
cek('§4 nama kosong -> kosong, bukan semuanya', cariMirip('', banyak), []);
cek('§4 tanpa daftar tidak melempar', cariMirip('Kursi Bar'), []);

// ===============================================================
console.log('§5 Ringkasan outlet');
// ===============================================================
const r = ringkasOutlet(baris);
cek('§5 jumlah item', r.item, 3);
// Dua angka ini DIPISAH dengan sengaja: yang pertama perlu didatangi, yang
// kedua sudah selesai. Menggabungkannya jadi "2 item kosong" menyembunyikan
// bedanya justru di tempat orang mengambil keputusan.
cek('§5 belum didata', r.belumDidata, 1);
cek('§5 sudah didata tapi nol', r.nol, 1);
cek('§5 total unit', r.totalUnit, 10);

const rRusak = ringkasOutlet(
  gabungItemDenganStok({
    items,
    stok: [{ id: 's1', asset_item_id: 'i1', qty: 3, condition: 'rusak' }]
  })
);
cek('§5 rusak dihitung', rRusak.rusak, 1);
// Item yang BELUM didata tidak boleh terhitung rusak maupun nol — ia belum
// punya kondisi sama sekali.
cek('§5 yang belum didata tidak ikut hitungan nol', rRusak.nol, 0);
cek('§5 belum didata tetap dihitung sendiri', rRusak.belumDidata, 2);

cek('§5 tanpa argumen tidak melempar', ringkasOutlet().item, 0);
cek('§5 totalnya nol, bukan NaN', ringkasOutlet().totalUnit, 0);

// ===============================================================
console.log('§6 Riwayat jadi kalimat');
// ===============================================================

// Tabel berisi `qty | 12 | 8` memuat seluruh faktanya, tapi yang membacanya
// harus menerjemahkan sendiri — dan ia membacanya justru saat sedang bingung
// kenapa angkanya tidak cocok.
cek('§6 perubahan jumlah', kalimatRiwayat({ aksi: 'ubah', kolom: 'qty', sebelum: '12', sesudah: '8' }), 'Jumlah: 12 → 8');
cek('§6 kolom diterjemahkan', kalimatRiwayat({ aksi: 'ubah', kolom: 'nama', sebelum: 'A', sesudah: 'B' }), 'Nama: A → B');

// ============ BARIS 'rusak' BUKAN PERUBAHAN KOLOM ============
//
// Ia kejadian, dan kalimatnya harus menyebut SEBABNYA — itu satu-satunya
// alasan baris itu ada. Membacanya sebagai "pecah: → 2" membuang justru
// bagian yang menjawab "ke mana barangnya".
cek(
  '§6 kerusakan menyebut sebabnya',
  kalimatRiwayat({ aksi: 'rusak', kolom: 'pecah', sesudah: '2', catatan: 'jatuh saat cuci' }),
  'Pecah 2 unit — jatuh saat cuci'
);
cek('§6 kerusakan tanpa sebab tetap terbaca', kalimatRiwayat({ aksi: 'rusak', kolom: 'hilang', sesudah: '1' }), 'Hilang 1 unit');
benar(
  '§6 pembatalan dikatakan sebagai pembatalan',
  /Pembatalan/.test(kalimatRiwayat({ aksi: 'batal-rusak', kolom: 'pecah', sebelum: '3', catatan: 'salah ketik' }))
);
benar('§6 pendataan pertama', /Didata pertama kali/.test(kalimatRiwayat({ aksi: 'didata', sesudah: '5' })));

// Kosong DIKATAKAN. Panah yang menunjuk ruang kosong terbaca seperti tampilan
// yang rusak, bukan seperti catatan yang memang dikosongkan.
cek(
  '§6 nilai kosong ditulis "(kosong)"',
  kalimatRiwayat({ aksi: 'ubah', kolom: 'catatan', sebelum: 'lama', sesudah: '' }),
  'Catatan: lama → (kosong)'
);
benar('§6 tanpa argumen tidak melempar', typeof kalimatRiwayat() === 'string');

// ===============================================================
console.log('§7 Rekap kerusakan');
// ===============================================================
const kerusakan = [
  { jenis: 'pecah', qty: 2 },
  { jenis: 'rusak', qty: 1 },
  { jenis: 'pecah', qty: 3 },
  // Yang DIBATALKAN tidak ikut dihitung — barangnya tidak pernah benar-benar
  // hilang. Tapi barisnya tetap ada di daftar, karena pembatalan yang tidak
  // terlihat sama membingungkannya dengan kerusakan yang tidak tercatat.
  { jenis: 'pecah', qty: 50, dibatalkan_at: '2026-10-01' }
];
const rk = rekapKerusakan(kerusakan);
cek('§7 kejadian yang dihitung', rk.kejadian, 3);
cek('§7 yang dibatalkan dihitung terpisah', rk.dibatalkan, 1);
cek('§7 unit TIDAK memuat yang dibatalkan', rk.unit, 6);
cek('§7 per jenis', [rk.per.pecah, rk.per.rusak, rk.per.hilang], [5, 1, 0]);
cek('§7 jenis yang tidak terpakai tetap nol, bukan hilang', rk.per.hilang, 0);
cek('§7 tanpa argumen tidak melempar', rekapKerusakan().unit, 0);
cek('§7 nilai cacat tidak jadi NaN', rekapKerusakan([{ jenis: 'pecah', qty: 'x' }]).unit, 0);

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-aturan-aset-bu: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
