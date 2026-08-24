/**
 * LENCANA KARTU BERANDA.
 *
 * Dua uji yang paling menentukan:
 *
 *   "merah menang"        — kartu yang punya pekerjaan tertunda DAN kabar baru
 *                           harus menampilkan angkanya. Kalau titik biru yang
 *                           menang, pekerjaan tertunda tersamar jadi sekadar
 *                           "ada yang baru", dan hilang begitu kartunya dibuka.
 *
 *   "belum pernah dibuka  — kalau dianggap baru, staff di hari pertama melihat
 *    ≠ ada kabar baru"      SELURUH kartu bertitik. Titik yang muncul di
 *                           mana-mana tidak menyampaikan apa pun.
 */
const { lencanaKartu, lencanaSemua, adaKabarBaru, JENIS } = await import('../js/core/lencana.js');

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

// =====================================================================
// SATU KARTU
// =====================================================================
cek('kosong: tanpa tertunda & tanpa kabar', lencanaKartu(null, false).jenis, JENIS.KOSONG);
cek('nol tertunda = kosong', lencanaKartu({ jumlah: 0, jenis: 'angka' }, false).jenis, JENIS.KOSONG);

const tiga = lencanaKartu({ jumlah: 3, jenis: 'angka' }, false);
cek('tiga tertunda -> angka', tiga.jenis, JENIS.ANGKA);
cek('  teksnya "3"', tiga.teks, '3');
benar('  judulnya menjelaskan', /menunggu dikerjakan/i.test(tiga.judul));

// MERAH MENANG. Ini uji yang paling menentukan di berkas ini.
const keduanya = lencanaKartu({ jumlah: 3, jenis: 'angka' }, true);
cek('ada pekerjaan DAN kabar baru -> tetap angka', keduanya.jenis, JENIS.ANGKA);
cek('  bukan titik biru', keduanya.jenis === JENIS.BARU, false);

cek('tanpa pekerjaan, ada kabar -> titik', lencanaKartu({ jumlah: 0 }, true).jenis, JENIS.BARU);
cek('  titik tidak berangka', lencanaKartu({ jumlah: 0 }, true).teks, '');

// Jenis 'seru' — untuk ketiadaan, bukan hitungan.
const seru = lencanaKartu({ jumlah: 1, jenis: 'seru' }, false);
cek('seru -> tanda !', seru.jenis, JENIS.SERU);
cek('  teksnya "!"', seru.teks, '!');
// "1" di kartu Penjualan akan terbaca "ada 1 penjualan menunggu", padahal
// artinya justru belum ada apa-apa.
benar('  BUKAN angka 1', seru.teks !== '1');

// Angka besar dipangkas supaya kartunya tidak melebar.
cek('99 tetap 99', lencanaKartu({ jumlah: 99, jenis: 'angka' }).teks, '99');
cek('100 jadi 99+', lencanaKartu({ jumlah: 100, jenis: 'angka' }).teks, '99+');
cek('137 jadi 99+', lencanaKartu({ jumlah: 137, jenis: 'angka' }).teks, '99+');
cek('  jumlah aslinya tetap dibawa', lencanaKartu({ jumlah: 137, jenis: 'angka' }).jumlah, 137);

// Masukan rusak tidak boleh melempar — beranda harus tetap tergambar.
cek('jumlah null', lencanaKartu({ jumlah: null }, false).jenis, JENIS.KOSONG);
cek('jumlah teks angka', lencanaKartu({ jumlah: '4', jenis: 'angka' }).teks, '4');
cek('jumlah bukan angka', lencanaKartu({ jumlah: 'banyak' }, false).jenis, JENIS.KOSONG);
cek('jumlah NaN', lencanaKartu({ jumlah: NaN }, false).jenis, JENIS.KOSONG);
cek('jumlah negatif diabaikan', lencanaKartu({ jumlah: -5, jenis: 'angka' }, false).jenis, JENIS.KOSONG);

// `Number()` MENGUBAH APA SAJA JADI ANGKA — jebakan yang sama dengan yang
// dijaga di `pricing.js`. `Number(true)` adalah 1, dan lencana "1" yang lahir
// dari nilai boolean akan terlihat persis seperti satu pekerjaan sungguhan.
cek('boolean true bukan angka 1', lencanaKartu({ jumlah: true, jenis: 'angka' }, false).jenis, JENIS.KOSONG);
cek('array kosong bukan nol yang sah', lencanaKartu({ jumlah: [], jenis: 'angka' }, false).jenis, JENIS.KOSONG);
cek('objek bukan angka', lencanaKartu({ jumlah: {}, jenis: 'angka' }, false).jenis, JENIS.KOSONG);
cek('string kosong bukan angka', lencanaKartu({ jumlah: '', jenis: 'angka' }, false).jenis, JENIS.KOSONG);
cek('string spasi bukan angka', lencanaKartu({ jumlah: '  ', jenis: 'angka' }, false).jenis, JENIS.KOSONG);

// =====================================================================
// SEMUA KARTU
// =====================================================================
const MODUL = [{ code: 'dispatch' }, { code: 'inventory' }, { code: 'sales' }, { code: 'menu' }];
const RPC = {
  modul: {
    dispatch: { jumlah: 3, jenis: 'angka' },
    inventory: { jumlah: 0, jenis: 'angka' },
    sales: { jumlah: 1, jenis: 'seru' }
  }
};

const peta = lencanaSemua(MODUL, RPC, ['inventory', 'menu']);
cek('dispatch: angka', peta.get('dispatch').jenis, JENIS.ANGKA);
cek('inventory: nol tertunda tapi ada kabar -> titik', peta.get('inventory').jenis, JENIS.BARU);
cek('sales: seru', peta.get('sales').jenis, JENIS.SERU);
cek('menu: tidak ada di RPC tapi ada kabar -> titik', peta.get('menu').jenis, JENIS.BARU);

// Modul yang tidak dikenal RPC dan tanpa kabar -> kosong, bukan error.
cek('modul asing tanpa kabar -> kosong', lencanaSemua([{ code: 'xyz' }], RPC, []).get('xyz').jenis, JENIS.KOSONG);
cek('RPC null aman', lencanaSemua(MODUL, null, []).get('dispatch').jenis, JENIS.KOSONG);
cek('modul null aman', lencanaSemua(null, RPC, []).size, 0);

// Set maupun array sama-sama diterima.
cek('kodeBaru sebagai Set', lencanaSemua(MODUL, RPC, new Set(['menu'])).get('menu').jenis, JENIS.BARU);

// =====================================================================
// KABAR BARU — perbandingan waktu
// =====================================================================
const KEMARIN = '2026-08-23T10:00:00.000Z';
const HARI_INI = '2026-08-24T10:00:00.000Z';

cek('aktivitas lebih baru dari terakhir dibuka -> baru',
  [...adaKabarBaru({ dispatch: HARI_INI }, { dispatch: KEMARIN })], ['dispatch']);
cek('aktivitas lebih lama -> tidak baru',
  [...adaKabarBaru({ dispatch: KEMARIN }, { dispatch: HARI_INI })], []);
cek('sama persis -> tidak baru',
  [...adaKabarBaru({ dispatch: HARI_INI }, { dispatch: HARI_INI })], []);

// BELUM PERNAH DIBUKA BUKAN BERARTI ADA KABAR BARU.
//
// Kalau dianggap baru, staff di hari pertama melihat SELURUH kartu bertitik —
// dan titik yang muncul di mana-mana tidak menyampaikan apa pun.
cek('belum pernah dibuka -> BUKAN kabar baru',
  [...adaKabarBaru({ dispatch: HARI_INI }, {})], []);
cek('  walau ada modul lain yang sudah dibuka',
  [...adaKabarBaru({ dispatch: HARI_INI, sales: HARI_INI }, { sales: KEMARIN })], ['sales']);

// Waktu kosong / rusak tidak boleh melempar.
cek('aktivitas null diabaikan', [...adaKabarBaru({ dispatch: null }, { dispatch: KEMARIN })], []);
cek('waktu rusak diabaikan', [...adaKabarBaru({ dispatch: 'bukan tanggal' }, { dispatch: KEMARIN })], []);
cek('waktu buka rusak diabaikan', [...adaKabarBaru({ dispatch: HARI_INI }, { dispatch: 'entah' })], []);
cek('keduanya null aman', [...adaKabarBaru(null, null)], []);

// Beberapa modul sekaligus.
cek('campur',
  [...adaKabarBaru(
    { dispatch: HARI_INI, inventory: KEMARIN, sales: HARI_INI, menu: HARI_INI },
    { dispatch: KEMARIN, inventory: HARI_INI, sales: KEMARIN }
  )].sort(),
  ['dispatch', 'sales']);

// =====================================================================
// ALUR UTUH — titik hilang sesudah dibuka, angka TIDAK
// =====================================================================
const aktivitas = { dispatch: HARI_INI, menu: HARI_INI };
let dibuka = { dispatch: KEMARIN, menu: KEMARIN };

let baru = adaKabarBaru(aktivitas, dibuka);
let p1 = lencanaSemua([{ code: 'dispatch' }, { code: 'menu' }], RPC, baru);
cek('sebelum dibuka: dispatch berangka', p1.get('dispatch').jenis, JENIS.ANGKA);
cek('sebelum dibuka: menu bertitik', p1.get('menu').jenis, JENIS.BARU);

// Keduanya dibuka.
dibuka = { dispatch: '2026-08-24T11:00:00.000Z', menu: '2026-08-24T11:00:00.000Z' };
baru = adaKabarBaru(aktivitas, dibuka);
let p2 = lencanaSemua([{ code: 'dispatch' }, { code: 'menu' }], RPC, baru);

cek('sesudah dibuka: titik menu HILANG', p2.get('menu').jenis, JENIS.KOSONG);

// INI INTINYA: membuka kartu tidak menghapus pekerjaan yang belum selesai.
cek('sesudah dibuka: angka dispatch TETAP', p2.get('dispatch').jenis, JENIS.ANGKA);
cek('  angkanya tidak berubah', p2.get('dispatch').teks, '3');

// Baru hilang ketika pekerjaannya benar-benar selesai.
const p3 = lencanaSemua([{ code: 'dispatch' }], { modul: { dispatch: { jumlah: 0, jenis: 'angka' } } }, baru);
cek('sesudah kerjanya selesai: angka hilang', p3.get('dispatch').jenis, JENIS.KOSONG);

console.log(gagal === 0 ? '✅ lencana: semua lulus' : `❌ lencana: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
