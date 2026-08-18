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
import { perkiraanMenu, petaPerkiraan, labelPerkiraan } from '../js/modules/menu/perkiraan.js';

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
cek('pembatasnya disebut', h.pembatas, 'ayam');
cek('sebabnya ok', h.sebab, 'ok');

// Menambah ayam memindahkan pembatasnya.
cek('tambah ayam -> nasi jadi pembatas', perkiraanMenu(nasiAyam, new Map([['ayam', 100], ['nasi', 15]])).pembatas, 'nasi');

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
cek('tanpa resep', perkiraanMenu(null, stok), { bisa: null, sebab: 'tanpa-resep', pembatas: null });
cek('resep tanpa item', perkiraanMenu({ yield_qty: 1, items: [] }, stok), { bisa: null, sebab: 'resep-kosong', pembatas: null });
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

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Perkiraan menu benar untuk 56 kasus — pembatas, pembulatan ke bawah, takaran 0, dan varian per peran outlet. ✅');
