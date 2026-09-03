/**
 * Perkiraan "berapa menu masih bisa dibuat".
 *
 * Angka ini dipakai staff memutuskan menu apa yang masih dijual hari itu —
 * dan sekarang tampil langsung di sebelah kotak isian, tanpa perlu dibuka.
 * Artinya ia dibaca jauh lebih sering daripada sebelumnya, dan salahnya jauh
 * lebih mahal.
 *
 * Yang paling ditekankan:
 *
 *  - PEMBATASNYA bahan yang paling cepat habis, bukan rata-rata.
 *  - Dibulatkan ke BAWAH — setengah porsi tidak bisa dijual.
 *  - BERHENTI DI SATU TINGKAT: sambal siap pakai di kulkas dihitung apa
 *    adanya, cabainya tidak lagi relevan. (Beda dengan "bahan menipis" yang
 *    memang harus membentang sampai bahan baku.)
 *  - Takaran 0 tidak boleh berubah jadi Infinity yang terbaca "tak terbatas".
 */
import { perkiraanMenu, petaPerkiraan, labelPerkiraan, rincianBahanMenu } from '../js/modules/menu/perkiraan.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

// =====================================================================
// PEMBATAS = BAHAN YANG PALING CEPAT HABIS
// =====================================================================
// Nasi Ayam: 0,2 kg ayam + 0,15 kg nasi per porsi.
// Stok: ayam 0,6 kg (= 3 porsi), nasi 15 kg (= 100 porsi) -> 3 porsi.
const nasiAyam = {
  yield_qty: 1,
  items: [
    { ingredient_product_id: 'ayam', qty: 0.2 },
    { ingredient_product_id: 'nasi', qty: 0.15 }
  ]
};
const stok = new Map([['ayam', 0.6], ['nasi', 15]]);

const h = perkiraanMenu(nasiAyam, stok);
cek('dibatasi bahan paling sedikit, bukan rata-rata', h.bisa, 3);
cek('pembatasnya disebut', h.pembatas, ['ayam']);
cek('sebabnya ok', h.sebab, 'ok');

// Menambah ayam memindahkan pembatasnya.
cek('tambah ayam -> nasi jadi pembatas', perkiraanMenu(nasiAyam, new Map([['ayam', 100], ['nasi', 15]])).pembatas, ['nasi']);

// =====================================================================
// SEMUA BAHAN YANG SAMA-SAMA MEPET IKUT DITANDAI
//
// Kalau cuma yang pertama ditemukan yang ditandai, staff membeli bahan itu,
// kembali, dan angkanya TIDAK naik sama sekali — karena bahan kedua sama
// mepetnya. Penanda yang menyuruh berbelanja hal yang tidak menyelesaikan
// apa pun lebih buruk daripada tidak ada penanda.
// =====================================================================
const tigaBahan = {
  yield_qty: 1,
  items: [
    { ingredient_product_id: 'ayam', qty: 0.2 },
    { ingredient_product_id: 'sambal', qty: 0.1 },
    { ingredient_product_id: 'nasi', qty: 0.15 }
  ]
};

// ayam 0,6 -> 3 porsi | sambal 0,3 -> 3 porsi | nasi 15 -> 100 porsi
const seri = perkiraanMenu(tigaBahan, new Map([['ayam', 0.6], ['sambal', 0.3], ['nasi', 15]]));
cek('dua bahan sama mepet: angkanya tetap 3', seri.bisa, 3);
cek('  dan KEDUANYA ditandai', seri.pembatas, ['ayam', 'sambal']);
cek('  nasi yang longgar tidak ikut', seri.pembatas.includes('nasi'), false);

// Tiga-tiganya mepet.
const seriTiga = perkiraanMenu(tigaBahan, new Map([['ayam', 0.6], ['sambal', 0.3], ['nasi', 0.45]]));
cek('tiga bahan sama mepet: semuanya ditandai', seriTiga.pembatas.sort(), ['ayam', 'nasi', 'sambal']);

// Menambah SATU dari dua yang seri memindahkan penandanya ke sisanya —
// dan angkanya baru naik setelah keduanya ditambah.
const setelahAyam = perkiraanMenu(tigaBahan, new Map([['ayam', 10], ['sambal', 0.3], ['nasi', 15]]));
cek('tambah ayam saja: angkanya TETAP 3', setelahAyam.bisa, 3);
cek('  penandanya pindah ke sambal saja', setelahAyam.pembatas, ['sambal']);

const setelahKeduanya = perkiraanMenu(tigaBahan, new Map([['ayam', 10], ['sambal', 10], ['nasi', 15]]));
cek('setelah keduanya ditambah, angkanya baru naik', setelahKeduanya.bisa, 50);
cek('  dan pembatasnya jadi ayam', setelahKeduanya.pembatas, ['ayam']);

// Semua bahan habis -> semuanya pembatas, bukan cuma satu.
const habisSemua = perkiraanMenu(tigaBahan, new Map());
cek('semua habis: semuanya ditandai', habisSemua.pembatas.length, 3);
cek('  dan hasilnya 0', habisSemua.bisa, 0);

// Satu bahan saja -> tetap berupa daftar berisi satu, bukan string.
cek(
  'satu bahan tetap berupa daftar',
  perkiraanMenu({ yield_qty: 1, items: [{ ingredient_product_id: 'x', qty: 1 }] }, new Map([['x', 5]])).pembatas,
  ['x']
);

// =====================================================================
// PEMBULATAN KE BAWAH
// =====================================================================
cek('0,55 kg ayam -> 2 porsi, bukan 2,75', perkiraanMenu({ yield_qty: 1, items: [{ ingredient_product_id: 'ayam', qty: 0.2 }] }, new Map([['ayam', 0.55]])).bisa, 2);
cek('pas 3 porsi tetap 3', perkiraanMenu({ yield_qty: 1, items: [{ ingredient_product_id: 'ayam', qty: 0.2 }] }, new Map([['ayam', 0.6]])).bisa, 3);
// Sisa pembagian floating point tidak boleh memotong satu porsi. 0.1*3 = 0.30000000000000004
cek('0,3 kg / 0,1 tetap 3, bukan 2', perkiraanMenu({ yield_qty: 1, items: [{ ingredient_product_id: 'x', qty: 0.1 }] }, new Map([['x', 0.1 * 3]])).bisa, 3);

// =====================================================================
// YIELD
// =====================================================================
// Resep menghasilkan 10 porsi dari 2 kg ayam -> 0,2 kg/porsi.
cek('yield 10 dihitung per porsi', perkiraanMenu({ yield_qty: 10, items: [{ ingredient_product_id: 'ayam', qty: 2 }] }, new Map([['ayam', 1]])).bisa, 5);
cek('yield 0 dianggap 1', perkiraanMenu({ yield_qty: 0, items: [{ ingredient_product_id: 'ayam', qty: 1 }] }, new Map([['ayam', 4]])).bisa, 4);
cek('yield negatif dianggap 1', perkiraanMenu({ yield_qty: -3, items: [{ ingredient_product_id: 'ayam', qty: 1 }] }, new Map([['ayam', 4]])).bisa, 4);

// =====================================================================
// STOK KOSONG / TIDAK ADA
// =====================================================================
cek('stok 0 -> 0 porsi', perkiraanMenu(nasiAyam, new Map([['ayam', 0], ['nasi', 15]])).bisa, 0);
cek('bahan tidak ada di peta stok -> 0 porsi', perkiraanMenu(nasiAyam, new Map([['nasi', 15]])).bisa, 0);
cek('peta stok kosong -> 0 porsi', perkiraanMenu(nasiAyam, new Map()).bisa, 0);
cek('stok null aman', perkiraanMenu(nasiAyam, null).bisa, 0);
// Stok negatif (koreksi yang kebablasan) tidak boleh jadi angka negatif di layar.
cek('stok negatif tetap 0, bukan minus', perkiraanMenu(nasiAyam, new Map([['ayam', -5], ['nasi', 15]])).bisa, 0);

// =====================================================================
// RESEP YANG TIDAK BISA DIHITUNG
// =====================================================================
cek('tanpa resep', perkiraanMenu(null, stok), { bisa: null, sebab: 'tanpa-resep', pembatas: [] });
cek('resep tanpa item', perkiraanMenu({ yield_qty: 1, items: [] }, stok), { bisa: null, sebab: 'resep-kosong', pembatas: [] });
cek('items undefined aman', perkiraanMenu({ yield_qty: 1 }, stok).sebab, 'resep-kosong');

// TAKARAN 0 TIDAK BOLEH JADI "TAK TERBATAS".
// Kalau pembagiannya dibiarkan, 5 / 0 = Infinity dan menunya dilaporkan bisa
// dibuat tanpa batas — padahal resepnya yang belum benar.
cek('semua takaran 0 -> tidak bisa dihitung', perkiraanMenu({ yield_qty: 1, items: [{ ingredient_product_id: 'x', qty: 0 }] }, new Map([['x', 5]])).sebab, 'resep-kosong');
cek('takaran 0 diabaikan, yang lain tetap membatasi', perkiraanMenu({ yield_qty: 1, items: [{ ingredient_product_id: 'x', qty: 0 }, { ingredient_product_id: 'ayam', qty: 0.2 }] }, new Map([['x', 5], ['ayam', 0.6]])).bisa, 3);
cek('takaran teks diabaikan', perkiraanMenu({ yield_qty: 1, items: [{ ingredient_product_id: 'x', qty: 'abc' }, { ingredient_product_id: 'ayam', qty: 0.2 }] }, new Map([['x', 5], ['ayam', 0.6]])).bisa, 3);

// =====================================================================
// SATU TINGKAT SAJA
// =====================================================================
// Nasi Ayam butuh sambal (setengah jadi). Sambalnya ADA 1 kg di kulkas, tapi
// cabainya habis. Menunya tetap bisa dibuat — cabainya tidak relevan lagi.
const pakaiSambal = { yield_qty: 1, items: [{ ingredient_product_id: 'sambal', qty: 0.05 }] };
cek(
  'sambal siap pakai dihitung apa adanya, cabai tidak relevan',
  perkiraanMenu(pakaiSambal, new Map([['sambal', 1], ['cabai', 0]])).bisa,
  20
);

// =====================================================================
// PETA SEMUA MENU
// =====================================================================
const menus = [{ id: 'nasiayam' }, { id: 'soto' }, { id: 'esteh' }];
const recipes = [
  { product_id: 'nasiayam', mode: 'standalone', yield_qty: 1, items: [{ ingredient_product_id: 'ayam', qty: 0.2 }] },
  { product_id: 'nasiayam', mode: 'served_by_ck', yield_qty: 1, items: [{ ingredient_product_id: 'paket', qty: 1 }] },
  { product_id: 'soto', mode: 'standalone', yield_qty: 1, items: [{ ingredient_product_id: 'ayam', qty: 0.1 }] }
];
const stokPeta = new Map([['ayam', 1], ['paket', 7]]);

const standalone = petaPerkiraan({ menus, recipes, stok: stokPeta, mode: 'standalone' });
cek('nasi ayam standalone: 1 / 0,2 = 5', standalone.get('nasiayam').bisa, 5);
cek('soto standalone: 1 / 0,1 = 10', standalone.get('soto').bisa, 10);
cek('es teh tanpa resep', standalone.get('esteh').sebab, 'tanpa-resep');
cek('semua menu ada di peta', standalone.size, 3);

// VARIAN YANG BERLAKU DITENTUKAN PERAN OUTLET — TIDAK ADA CADANGAN.
//
// Outlet yang dilayani CK memakai paket jadi, bukan bahan mentah. Kalau
// jatuh ke varian standalone saat varian CK tidak ada, angkanya berasal dari
// cara kerja yang bukan cara kerja outlet itu.
const ck = petaPerkiraan({ menus, recipes, stok: stokPeta, mode: 'served_by_ck' });
cek('nasi ayam CK memakai resep CK: 7 paket', ck.get('nasiayam').bisa, 7);
cek('soto TIDAK jatuh ke standalone', ck.get('soto').sebab, 'tanpa-resep');
cek('soto tidak melaporkan angka apa pun', ck.get('soto').bisa, null);

cek('menus kosong aman', petaPerkiraan({ menus: [], recipes, stok: stokPeta, mode: 'standalone' }).size, 0);
cek('recipes null aman', petaPerkiraan({ menus, recipes: null, stok: stokPeta, mode: 'standalone' }).get('soto').sebab, 'tanpa-resep');

// =====================================================================
// LABEL
// =====================================================================
cek('label angka', labelPerkiraan({ bisa: 12, sebab: 'ok' }), 'bisa dibuat ± 12');
// 0 punya label sendiri: "bisa dibuat ± 0" terbaca seperti angka biasa dan
// mudah terlewat, padahal artinya menu itu tidak bisa dijual sama sekali.
cek('label 0 berbunyi habis', labelPerkiraan({ bisa: 0, sebab: 'ok' }), 'bahan habis');
cek('label tanpa resep', labelPerkiraan({ bisa: null, sebab: 'tanpa-resep' }), 'resep belum diatur');
cek('label resep kosong', labelPerkiraan({ bisa: null, sebab: 'resep-kosong' }), 'resep belum diatur');
cek('label null aman', labelPerkiraan(null), 'resep belum diatur');

// =====================================================================
// SATU BAHAN DIPAKAI BEBERAPA MENU
//
// Ini bagian yang paling menipu kalau salah, dan salahnya TIDAK terlihat:
// tiap angka benar sendiri-sendiri, tapi bersama-sama menjanjikan lebih
// banyak porsi daripada bahan yang ada.
//
// Ayam 1 kg:
//   Nasi Ayam   0,20 kg/porsi
//   Soto        0,10 kg/porsi
//   Ayam Goreng 0,25 kg/porsi
// =====================================================================
const menuBersama = [{ id: 'nasi' }, { id: 'soto2' }, { id: 'goreng' }];
const resepBersama = [
  { product_id: 'nasi', mode: 'standalone', yield_qty: 1, items: [{ ingredient_product_id: 'ayam', qty: 0.2 }] },
  { product_id: 'soto2', mode: 'standalone', yield_qty: 1, items: [{ ingredient_product_id: 'ayam', qty: 0.1 }] },
  { product_id: 'goreng', mode: 'standalone', yield_qty: 1, items: [{ ingredient_product_id: 'ayam', qty: 0.25 }] }
];
const stokAyam = new Map([['ayam', 1]]);

// Belum ada yang diisi -> tiap menu memakai seluruh stok.
const belum = petaPerkiraan({ menus: menuBersama, recipes: resepBersama, stok: stokAyam, mode: 'standalone' });
cek('belum diisi: nasi 5', belum.get('nasi').bisa, 5);
cek('belum diisi: soto 10', belum.get('soto2').bisa, 10);
cek('belum diisi: goreng 4', belum.get('goreng').bisa, 4);
cek('belum diisi: tidak ada yang dikurangi', belum.get('nasi').dikurangi, false);

// Nasi Ayam diisi 3 -> memakai 0,6 kg. Sisa 0,4 kg untuk yang lain.
const isi3 = petaPerkiraan({
  menus: menuBersama,
  recipes: resepBersama,
  stok: stokAyam,
  mode: 'standalone',
  rencana: new Map([['nasi', 3]])
});
cek('soto turun jadi 4 (0,4 / 0,1)', isi3.get('soto2').bisa, 4);
cek('goreng turun jadi 1 (0,4 / 0,25)', isi3.get('goreng').bisa, 1);
cek('soto ditandai dikurangi', isi3.get('soto2').dikurangi, true);

// MENU ITU SENDIRI TIDAK MENGURANGI DIRINYA.
//
// Kalau ikut dikurangkan, mengetik 3 di Nasi Ayam langsung menurunkan angka
// Nasi Ayam sendiri — dan orangnya tidak punya cara membedakan "sudah saya
// pakai" dari "ternyata tidak cukup".
cek('nasi TIDAK mengurangi dirinya sendiri', isi3.get('nasi').bisa, 5);
cek('nasi tidak ditandai dikurangi', isi3.get('nasi').dikurangi, false);

// Dua menu diisi sekaligus.
const isiDua = petaPerkiraan({
  menus: menuBersama,
  recipes: resepBersama,
  stok: stokAyam,
  mode: 'standalone',
  rencana: new Map([['nasi', 3], ['soto2', 2]])
});
// goreng: 1 - 0,6 - 0,2 = 0,2 kg -> 0 porsi
cek('goreng setelah dua menu diisi: 0', isiDua.get('goreng').bisa, 0);
// soto: 1 - 0,6 (nasi saja) = 0,4 -> 4
cek('soto tidak menghitung dirinya sendiri', isiDua.get('soto2').bisa, 4);
// nasi: 1 - 0,2 (soto saja) = 0,8 -> 4
cek('nasi dikurangi soto saja', isiDua.get('nasi').bisa, 4);

// DIJANJIKAN MELEBIHI STOK -> 0, bukan angka negatif.
const kelebihan = petaPerkiraan({
  menus: menuBersama,
  recipes: resepBersama,
  stok: stokAyam,
  mode: 'standalone',
  rencana: new Map([['nasi', 100]])
});
cek('dijanjikan berlebih: soto 0, bukan minus', kelebihan.get('soto2').bisa, 0);
cek('  dan goreng juga 0', kelebihan.get('goreng').bisa, 0);

// Rencana 0 / kosong tidak mengurangi apa pun.
const nolRencana = petaPerkiraan({
  menus: menuBersama,
  recipes: resepBersama,
  stok: stokAyam,
  mode: 'standalone',
  rencana: new Map([['nasi', 0]])
});
cek('rencana 0 tidak mengurangi', nolRencana.get('soto2').bisa, 10);
cek('rencana negatif diabaikan', petaPerkiraan({ menus: menuBersama, recipes: resepBersama, stok: stokAyam, mode: 'standalone', rencana: new Map([['nasi', -5]]) }).get('soto2').bisa, 10);
cek('rencana null aman', petaPerkiraan({ menus: menuBersama, recipes: resepBersama, stok: stokAyam, mode: 'standalone', rencana: null }).get('soto2').bisa, 10);

// Menu yang TIDAK berbagi bahan tidak terpengaruh.
const terpisah = petaPerkiraan({
  menus: [{ id: 'nasi' }, { id: 'esteh2' }],
  recipes: [
    ...resepBersama,
    { product_id: 'esteh2', mode: 'standalone', yield_qty: 1, items: [{ ingredient_product_id: 'teh', qty: 1 }] }
  ],
  stok: new Map([['ayam', 1], ['teh', 20]]),
  mode: 'standalone',
  rencana: new Map([['nasi', 5]])
});
cek('menu tanpa bahan bersama tidak terpengaruh', terpisah.get('esteh2').bisa, 20);
cek('  dan tidak ditandai dikurangi', terpisah.get('esteh2').dikurangi, false);


// =====================================================================
// MENU YANG TIDAK DIJUAL DI OUTLET INI TIDAK IKUT MEMAKAN STOK (0116)
//
// Kasus nyata yang melahirkan bagian ini: beras 17.280 gr, takaran 200 gr per
// porsi — 86 porsi. Menunya tetap berbunyi "bahan habis", karena rencana untuk
// menu-menu lain yang outletnya TIDAK jual ikut dihitung memotong stok.
//
// Sesudah 0115 barisnya bahkan tidak muncul lagi di layar, jadi tidak ada cara
// apa pun bagi staff melihat — apalagi mengosongkan — penyebabnya.
// =====================================================================
const BERAS = 'beras';
const menuBeras = [{ id: 'ayambakar' }, { id: 'nasgor' }, { id: 'liwet' }];
const resepBeras = menuBeras.map((m) => ({
  product_id: m.id,
  mode: 'served_by_ck',
  yield_qty: 1,
  items: [{ ingredient_product_id: BERAS, qty: 200 }]
}));
const stokBeras = new Map([[BERAS, 17280]]);
const rencanaBeras = new Map([['nasgor', 40], ['liwet', 46]]);

const kasusBeras = (aktif) =>
  petaPerkiraan({
    menus: menuBeras,
    recipes: resepBeras,
    stok: stokBeras,
    mode: 'served_by_ck',
    rencana: rencanaBeras,
    aktif
  }).get('ayambakar');

cek('tanpa penyaring: rencana menu lain menghabiskan beras', kasusBeras(null).bisa, 0);
cek(
  'INTI: menu yang tidak dijual di outlet ini tidak memakan beras',
  kasusBeras(new Set(['ayambakar'])).bisa,
  86
);
cek('  dan tidak ditandai (sisa)', kasusBeras(new Set(['ayambakar'])).dikurangi, false);
cek(
  'menu lain yang MEMANG dijual di sini tetap memotong',
  kasusBeras(new Set(['ayambakar', 'nasgor'])).bisa,
  46
);

// `aktif` null berarti daftarnya belum/gagal dimuat -> jangan menyaring.
// Menyaring dengan himpunan KOSONG akan membuat semua rencana lenyap dan tiap
// menu terlihat lebih longgar daripada sebenarnya — terlalu optimis, arah
// kesalahan yang paling merugikan di layar ini.
cek('aktif=null tidak menyaring apa pun', kasusBeras(null).bisa, kasusBeras(undefined).bisa);

// =====================================================================
// RINCIAN UNTUK PANEL: stok mentah vs sisa, dan siapa pemakannya.
// =====================================================================
const rincian = rincianBahanMenu({
  menus: menuBeras,
  recipes: resepBeras,
  stok: stokBeras,
  mode: 'served_by_ck',
  rencana: rencanaBeras,
  aktif: null,
  menuId: 'ayambakar'
});

cek('rincian: satu baris bahan', rincian.baris.length, 1);
cek('rincian: stok MENTAH apa adanya', rincian.baris[0].stok, 17280);
cek('rincian: sisa sesudah menu lain', rincian.baris[0].sisa, 17280 - 86 * 200);
cek('rincian: selisihnya disebut sendiri', rincian.baris[0].dipakaiMenuLain, 86 * 200);
cek('rincian: bahannya ditandai pembatas', rincian.baris[0].pembatas, true);
cek('rincian: vonisnya sama dengan petaPerkiraan', rincian.hasil.bisa, 0);

const pemakan = rincian.pemakan.get(BERAS) ?? [];
cek('rincian: dua menu lain disebut sebagai pemakan', pemakan.length, 2);
cek('rincian: yang paling banyak makan disebut duluan', pemakan[0].menuId, 'liwet');
cek('rincian: jumlahnya benar', pemakan[0].qty, 46 * 200);
// MENU ITU SENDIRI HARUS PUNYA RENCANA supaya penjaganya benar-benar diuji.
//
// Percobaan pertama memakai `rencanaBeras` yang tidak menyebut 'ayambakar'
// sama sekali. Pemakaian menu itu jadi 0, barisnya tidak pernah sampai ke
// penjaga `mid === menuId`, dan sabotase yang MENCABUT penjaga itu lolos —
// pemeriksaan yang hijau karena sasarannya tidak pernah dilewati.
const rincianDiriSendiri = rincianBahanMenu({
  menus: menuBeras,
  recipes: resepBeras,
  stok: stokBeras,
  mode: 'served_by_ck',
  rencana: new Map([['ayambakar', 10], ['nasgor', 40], ['liwet', 46]]),
  aktif: null,
  menuId: 'ayambakar'
});
const pemakanDiri = rincianDiriSendiri.pemakan.get(BERAS) ?? [];
cek(
  'rincian: menu itu sendiri TIDAK disebut sebagai pemakan',
  pemakanDiri.some((x) => x.menuId === 'ayambakar'),
  false
);
cek('rincian: yang lain tetap disebut', pemakanDiri.length, 2);
// Dan sisanya pun tidak ikut dipotong oleh dirinya sendiri — kalau ikut,
// mengetik 10 akan langsung menurunkan angka menu itu sendiri, dan tidak ada
// cara membedakan "sudah saya pakai" dari "ternyata tidak cukup".
cek('rincian: sisa tidak dipotong oleh rencana dirinya sendiri', rincianDiriSendiri.baris[0].sisa, 17280 - 86 * 200);

// Dengan penyaring, pemakannya ikut menyusut — kalau tidak, layar akan menyebut
// menu yang outletnya tidak jual sebagai penyebab, dan orangnya akan mencari
// baris yang tidak ada.
const rincianSaring = rincianBahanMenu({
  menus: menuBeras,
  recipes: resepBeras,
  stok: stokBeras,
  mode: 'served_by_ck',
  rencana: rencanaBeras,
  aktif: new Set(['ayambakar', 'nasgor']),
  menuId: 'ayambakar'
});
cek('rincian tersaring: hanya menu yang dijual di sini yang disebut', (rincianSaring.pemakan.get(BERAS) ?? []).length, 1);
cek('rincian tersaring: sisanya ikut benar', rincianSaring.baris[0].sisa, 17280 - 40 * 200);

// Menu tanpa resep tidak melempar.
const kosong = rincianBahanMenu({
  menus: menuBeras,
  recipes: [],
  stok: stokBeras,
  mode: 'served_by_ck',
  rencana: new Map(),
  menuId: 'ayambakar'
});
cek('rincian tanpa resep: tidak ada baris', kosong.baris.length, 0);
cek('rincian tanpa resep: sebabnya disebut', kosong.hasil.sebab, 'tanpa-resep');

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Perkiraan menu benar untuk 91 kasus — pembatas, pembulatan ke bawah, takaran 0, dan varian per peran outlet. ✅');
