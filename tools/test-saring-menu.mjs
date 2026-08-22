/**
 * SARINGAN MENU PENJUALAN.
 *
 * Yang paling penting di berkas ini BUKAN pencariannya, melainkan tiga uji di
 * bagian bawah: isian yang tersaring keluar harus tetap terkirim, tetap
 * dilaporkan, dan tidak boleh ikut terkirim lagi setelah dibersihkan.
 *
 * Kegagalannya tidak menampilkan error apa pun. Staff mengetik lima menu,
 * mencari menu keenam, menekan Simpan — dan yang tercatat hanya satu. Rekapnya
 * terlihat wajar, uang di kasir tidak cocok, dan tidak ada yang bisa menunjuk
 * penyebabnya.
 */
const { saringMenu, ringkasIsian, isianTerkirim } = await import('../js/modules/sales/saring-menu.js');

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

const MENUS = [
  { id: 'm1', name: 'Nasi Goreng Spesial', category: 'Makanan', subcategory: 'Nasi' },
  { id: 'm2', name: 'Mie Goreng', category: 'Makanan', subcategory: 'Mie' },
  { id: 'm3', name: 'Kopi Susu', category: 'Minuman', subcategory: 'Kopi Dingin' },
  { id: 'm4', name: 'Kopi Hitam', category: 'Minuman', subcategory: 'Kopi Panas' },
  { id: 'm5', name: 'Es Teh Manis', category: 'Minuman', subcategory: 'Teh Dingin' },
  { id: 'm6', name: 'Ayam Bakar', category: 'Makanan', subcategory: null }
];

const id = (hasil) => hasil.map((m) => m.id);

// =====================================================================
// PENCARIAN
// =====================================================================
cek('tanpa saringan: semua muncul', id(saringMenu(MENUS)), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
cek('kata utuh', id(saringMenu(MENUS, { q: 'goreng' })), ['m1', 'm2']);
cek('potongan kata', id(saringMenu(MENUS, { q: 'gor' })), ['m1', 'm2']);

// Huruf besar/kecil tidak boleh berpengaruh — papan ketik ponsel sering
// mengawali kata dengan huruf besar sendiri.
cek('huruf besar diabaikan', id(saringMenu(MENUS, { q: 'NASI' })), ['m1']);
cek('campur besar-kecil', id(saringMenu(MENUS, { q: 'KoPi' })), ['m3', 'm4']);

// Beberapa kata: SEMUA harus cocok, urutannya bebas.
cek('dua kata berurutan', id(saringMenu(MENUS, { q: 'nasi goreng' })), ['m1']);
cek('dua kata terbalik', id(saringMenu(MENUS, { q: 'goreng nasi' })), ['m1']);
cek('kata kedua tidak cocok -> kosong', id(saringMenu(MENUS, { q: 'nasi bakar' })), []);

// Spasi berlebih dari mengetik cepat tidak boleh mematikan pencarian.
cek('spasi ganda', id(saringMenu(MENUS, { q: 'nasi   goreng' })), ['m1']);
cek('spasi di depan & belakang', id(saringMenu(MENUS, { q: '  kopi  ' })), ['m3', 'm4']);
cek('spasi saja = tanpa saringan', id(saringMenu(MENUS, { q: '   ' })).length, 6);

// Subkategori ikut dicari.
cek('cari subkategori "panas"', id(saringMenu(MENUS, { q: 'panas' })), ['m4']);
cek('cari subkategori "dingin"', id(saringMenu(MENUS, { q: 'dingin' })), ['m3', 'm5']);
cek('nama + subkategori bersamaan', id(saringMenu(MENUS, { q: 'kopi dingin' })), ['m3']);

// Subkategori kosong tidak boleh membuat barisnya rusak atau ikut tercocok.
cek('subkategori null aman', id(saringMenu(MENUS, { q: 'ayam' })), ['m6']);
cek('"null" tidak pernah cocok', id(saringMenu(MENUS, { q: 'null' })), []);

// Kategori + pencarian bekerja bersamaan, bukan saling menimpa.
cek('kategori saja', id(saringMenu(MENUS, { kategori: 'Minuman' })), ['m3', 'm4', 'm5']);
cek('kategori + cari', id(saringMenu(MENUS, { kategori: 'Minuman', q: 'kopi' })), ['m3', 'm4']);
cek('kategori mempersempit hasil cari', id(saringMenu(MENUS, { kategori: 'Makanan', q: 'kopi' })), []);

// Masukan rusak tidak boleh melempar error — layarnya harus tetap tergambar.
cek('menus null', saringMenu(null, { q: 'a' }), []);
cek('baris null dilewati', id(saringMenu([null, MENUS[0]], { q: 'nasi' })), ['m1']);
cek('nama kosong tidak cocok apa pun', id(saringMenu([{ id: 'x' }], { q: 'a' })), []);
cek('nama kosong tetap muncul tanpa pencarian', id(saringMenu([{ id: 'x' }], {})), ['x']);

// =====================================================================
// ISIAN YANG TERSEMBUNYI — inti keselamatan layar ini
// =====================================================================
const qty = new Map([
  ['m1', 20], // Nasi Goreng
  ['m3', 5], // Kopi Susu
  ['m6', 3] // Ayam Bakar
]);

// Sedang mencari "kopi": hanya m3 yang terlihat, dua lainnya tersembunyi.
const terlihat = saringMenu(MENUS, { q: 'kopi' });
const r = ringkasIsian(qty, terlihat, MENUS);

cek('3 menu terisi', r.jumlahTerisi, 3);
cek('2 di antaranya tersembunyi', r.jumlahTersembunyi, 2);
cek('yang tersembunyi disebut namanya', r.tersembunyi.map((t) => t.nama), ['Nasi Goreng Spesial', 'Ayam Bakar']);
cek('beserta jumlahnya', r.tersembunyi.map((t) => t.qty), [20, 3]);

// Menyebut jumlah saja tidak cukup — staff harus bisa memastikan yang mana
// tanpa membatalkan saringannya di tengah antrean pembeli.
benar('nama & angka dibawa serta, bukan cuma hitungannya', r.tersembunyi.every((t) => t.nama && t.qty > 0));

// Tanpa saringan: tidak ada yang tersembunyi.
cek('tanpa saringan: nol tersembunyi', ringkasIsian(qty, saringMenu(MENUS), MENUS).jumlahTersembunyi, 0);

// Nol dan angka tak sah BUKAN entri. Kotak yang sempat diketik lalu dikosongkan
// tidak boleh terhitung sebagai "sudah diisi".
const qtyKotor = new Map([['m1', 0], ['m2', -3], ['m3', NaN], ['m4', 'lima'], ['m5', 8]]);
cek('nol/negatif/NaN/teks tidak dihitung', ringkasIsian(qtyKotor, [], MENUS).jumlahTerisi, 1);
cek('hanya yang sah yang tersisa', ringkasIsian(qtyKotor, [], MENUS).terisi.map((t) => t.id), ['m5']);

// Menu yang sudah dihapus dari master tetap dilaporkan, bukan hilang diam-diam.
cek('id asing tetap dilaporkan', ringkasIsian(new Map([['xx', 4]]), [], MENUS).terisi[0].nama, '(menu tidak dikenal)');

// Sumber nama boleh berupa Map maupun array — keduanya harus sama hasilnya.
const petaNama = new Map(MENUS.map((m) => [m.id, m.name]));
cek('sumber nama Map = array', ringkasIsian(qty, terlihat, petaNama).tersembunyi.map((t) => t.nama), r.tersembunyi.map((t) => t.nama));

cek('qty kosong: nol terisi', ringkasIsian(new Map(), MENUS, MENUS).jumlahTerisi, 0);
cek('qty null aman', ringkasIsian(null, MENUS, MENUS).jumlahTerisi, 0);

// =====================================================================
// YANG DIKIRIM — dari ingatan, BUKAN dari yang terlihat
//
// Uji ini yang paling menentukan. Sebelum ada ingatan, layar membaca isian dari
// `querySelectorAll('.sl-qty')`, yang hanya menemukan baris yang lolos saringan.
// Staff yang mengisi lima menu lalu mencari menu keenam akan menyimpan SATU
// penjualan — empat lainnya lenyap tanpa satu pun pesan.
// =====================================================================
const terkirim = isianTerkirim(qty);
cek('ketiganya ikut terkirim', terkirim.length, 3);
cek('bentuknya sesuai record_sales', terkirim, [
  { product_id: 'm1', qty: 20 },
  { product_id: 'm3', qty: 5 },
  { product_id: 'm6', qty: 3 }
]);

// Yang terkirim TIDAK bergantung pada saringan sama sekali.
benar('saringan tidak memengaruhi yang terkirim', JSON.stringify(isianTerkirim(qty)) === JSON.stringify(terkirim));

// DIJAGA SECARA STRUKTURAL, bukan hanya lewat nilainya.
//
// Sabotase yang menambahkan parameter `terlihat` ke `isianTerkirim()` sempat
// LOLOS: uji di atas memanggilnya dengan satu argumen, jadi penyaringnya tidak
// pernah aktif. Padahal begitu layar mulai mengoper argumen kedua, penjualan
// yang tersaring keluar akan hilang lagi — persis bug yang sedang dicegah.
//
// Maka bentuk fungsinya sendiri yang dikunci: ia hanya boleh menerima ingatan.
cek('isianTerkirim hanya menerima SATU masukan', isianTerkirim.length, 1);

const sumberHalaman = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../js/modules/sales/sales.page.js', import.meta.url), 'utf8')
);

// Dan layarnya harus memanggilnya dengan ingatan itu saja.
benar('layar mengirim dari ingatan', /items\s*=\s*isianTerkirim\(state\.qty\)/.test(sumberHalaman));

// Isian yang dikirim TIDAK BOLEH dikumpulkan dari DOM lagi. `querySelectorAll`
// hanya menemukan baris yang lolos saringan — itulah bentuk asli bugnya.
benar(
  'kiriman tidak dikumpulkan dari kotak yang terlihat',
  !/\.sl-qty'\)\]?\s*\.?\s*\n?\s*\.map\(\(inp\)\s*=>\s*\(\{\s*product_id/.test(sumberHalaman),
  'ada pengumpulan item dari querySelectorAll'
);

// Setelah tersimpan, ingatannya wajib dikosongkan. Kalau hanya kotaknya yang
// dibersihkan, isian yang sedang tersaring keluar tetap tinggal di ingatan dan
// ikut terkirim LAGI pada penyimpanan berikutnya — penjualan ganda yang tidak
// tertangkap penanda kiriman, karena kirimannya memang berbeda.
//
// Dicari PERSIS di blok keberhasilan (`state.ref = null` -> `state.qty.clear()`),
// bukan "di mana saja dalam berkas". Versi pertama aturan ini hanya mencari
// polanya, dan sabotase yang membuang pembersihan di blok keberhasilan tetap
// lolos — karena pemindahan outlet juga memanggil `state.qty.clear()` beberapa
// puluh baris di atasnya.
benar(
  'ingatan dikosongkan tepat sesudah kiriman berhasil',
  /state\.ref = null;[\s\S]{0,800}?state\.qty\.clear\(\)/.test(sumberHalaman)
);

// Dan yang tersembunyi memang ikut — dibuktikan langsung, bukan disimpulkan.
benar('menu tersembunyi ada di dalam kiriman', terkirim.some((i) => i.product_id === 'm1'));
benar('  dengan jumlah yang benar', terkirim.find((i) => i.product_id === 'm1')?.qty === 20);

cek('nol & angka tak sah tidak ikut terkirim', isianTerkirim(qtyKotor), [{ product_id: 'm5', qty: 8 }]);
cek('ingatan kosong -> tidak ada yang dikirim', isianTerkirim(new Map()), []);
cek('ingatan null aman', isianTerkirim(null), []);

// Sesudah tersimpan, ingatan dikosongkan — kalau tidak, isian yang sedang
// tersaring keluar akan IKUT TERKIRIM LAGI pada penyimpanan berikutnya.
// Penanda kiriman tidak akan menangkapnya, karena kirimannya memang berbeda.
const qtySesudah = new Map(qty);
qtySesudah.clear();
cek('setelah dikosongkan: tidak ada sisa', isianTerkirim(qtySesudah), []);

console.log(gagal === 0 ? '✅ saring-menu: semua lulus' : `❌ saring-menu: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
