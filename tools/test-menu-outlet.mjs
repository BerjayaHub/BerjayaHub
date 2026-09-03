/**
 * Tes: aturan "menu ini aktif di outlet mana".
 *
 * Yang paling penting di sini adalah PERBEDAAN antara dua jenis "kosong":
 *
 *   kosong karena "Aktif di semua outlet" dipilih  -> sah, artinya semua
 *   kosong karena centang terakhir dicabut          -> ditolak, karena artinya
 *                                                      terbalik dari maksudnya
 *
 * Keduanya terlihat sama persis di layar. Kalau aturannya tidak membedakannya,
 * orang yang mencabut centang terakhir dari "hanya AB Sentul" justru
 * mengaktifkan menunya di SELURUH outlet — tanpa satu pun error.
 */
import assert from 'node:assert/strict';
import {
  petaMenuOutlet,
  menuAktifDi,
  saringMenuOutlet,
  keadaanMenu,
  validasiSimpan,
  ringkasMenu,
  SEMUA,
  TERPILIH
} from '../js/modules/menu/menu-outlet.js';

let lulus = 0;
const uji = (nama, fn) => {
  try {
    fn();
    lulus++;
  } catch (e) {
    console.error(`❌ ${nama}\n   ${e.message}`);
    process.exitCode = 1;
  }
};

const SERPONG = 'out-serpong';
const SENTUL = 'out-sentul';
const HAMPTON = 'out-hampton';

const kopi = { id: 'm-kopi', name: 'Kopi Susu' };
const nasgor = { id: 'm-nasgor', name: 'Nasi Goreng' };
const spesial = { id: 'm-spesial', name: 'Menu Spesial Sentul' };

/** Hanya `spesial` yang dibatasi — dan hanya ke Sentul. */
const baris = [{ product_id: 'm-spesial', outlet_id: SENTUL }];

uji('menu tanpa pembatasan aktif di outlet mana pun', () => {
  const peta = petaMenuOutlet(baris);
  assert.equal(menuAktifDi(peta, 'm-kopi', SERPONG), true);
  assert.equal(menuAktifDi(peta, 'm-kopi', SENTUL), true);
  assert.equal(menuAktifDi(peta, 'm-kopi', HAMPTON), true);
});

uji('menu yang dibatasi hanya aktif di outlet yang terdaftar', () => {
  const peta = petaMenuOutlet(baris);
  assert.equal(menuAktifDi(peta, 'm-spesial', SENTUL), true);
  assert.equal(menuAktifDi(peta, 'm-spesial', SERPONG), false);
  assert.equal(menuAktifDi(peta, 'm-spesial', HAMPTON), false);
});

uji('penyaringan daftar menu: yang dibatasi hilang dari outlet lain', () => {
  const peta = petaMenuOutlet(baris);
  const diSentul = saringMenuOutlet([kopi, nasgor, spesial], peta, SENTUL).map((m) => m.id);
  const diSerpong = saringMenuOutlet([kopi, nasgor, spesial], peta, SERPONG).map((m) => m.id);
  assert.deepEqual(diSentul, ['m-kopi', 'm-nasgor', 'm-spesial']);
  assert.deepEqual(diSerpong, ['m-kopi', 'm-nasgor']);
});

uji('INTI: outlet belum terpilih -> daftar UTUH, bukan kosong', () => {
  // Layar yang tiba-tiba kosong terbaca sebagai "tidak ada menu sama sekali".
  // Itu kebohongan yang jauh lebih membingungkan daripada daftar yang belum
  // tersaring — dan tepat keadaan yang terjadi sesaat sebelum outlet dimuat.
  const peta = petaMenuOutlet(baris);
  assert.equal(saringMenuOutlet([kopi, nasgor, spesial], peta, '').length, 3);
  assert.equal(saringMenuOutlet([kopi, nasgor, spesial], peta, null).length, 3);
});

uji('INTI: "hanya outlet terpilih" dengan NOL outlet ditolak', () => {
  // Inilah sisi tajamnya. Kalau ini lolos, tersimpan nol baris — dan nol baris
  // berarti AKTIF DI SEMUA OUTLET, kebalikan persis dari yang dimaksud orang
  // yang baru saja mencabut centang terakhirnya.
  const v = validasiSimpan({ mode: TERPILIH, outlets: [] });
  assert.equal(v.boleh, false);
  assert.match(v.alasan, /SEMUA outlet/);
});

uji('"aktif di semua outlet" memang menyimpan daftar kosong', () => {
  const v = validasiSimpan({ mode: SEMUA, outlets: [] });
  assert.equal(v.boleh, true);
  assert.deepEqual(v.outlets, []);
});

uji('"semua outlet" mengabaikan centang yang tertinggal di layar', () => {
  // Yang tersimpan harus persis sama dengan yang tertulis di tombol yang
  // dipilih orangnya, bukan campuran antara tombol dan sisa centang.
  const v = validasiSimpan({ mode: SEMUA, outlets: [SENTUL, SERPONG] });
  assert.equal(v.boleh, true);
  assert.deepEqual(v.outlets, []);
});

uji('outlet kembar & nilai kosong dibersihkan sebelum disimpan', () => {
  const v = validasiSimpan({ mode: TERPILIH, outlets: [SENTUL, SENTUL, '', null, SERPONG] });
  assert.equal(v.boleh, true);
  assert.deepEqual(v.outlets.sort(), [SERPONG, SENTUL].sort());
});

uji('keadaan awal kotak centang dibaca benar', () => {
  const peta = petaMenuOutlet(baris);
  assert.deepEqual(keadaanMenu(peta, 'm-kopi'), { mode: SEMUA, outlets: [] });
  const k = keadaanMenu(peta, 'm-spesial');
  assert.equal(k.mode, TERPILIH);
  assert.deepEqual(k.outlets, [SENTUL]);
});

uji('Set kosong diperlakukan sebagai TIDAK dibatasi, bukan nol outlet', () => {
  // Set kosong seharusnya tidak pernah lahir. Kalau toh terjadi,
  // memperlakukannya sebagai "dibatasi ke nol outlet" akan menyembunyikan
  // menunya dari SEMUA outlet — menu yang lenyap tanpa sebab jauh lebih mahal
  // daripada menu yang terlalu banyak muncul.
  const peta = new Map([['m-kopi', new Set()]]);
  assert.equal(menuAktifDi(peta, 'm-kopi', SERPONG), true);
  assert.equal(keadaanMenu(peta, 'm-kopi').mode, SEMUA);
});

uji('ringkasan menyebut angka, bukan cuma "dibatasi"', () => {
  const peta = petaMenuOutlet([
    { product_id: 'm-spesial', outlet_id: SENTUL },
    { product_id: 'm-spesial', outlet_id: HAMPTON }
  ]);
  assert.deepEqual(ringkasMenu(peta, 'm-spesial', 4), { teks: '2 outlet', dibatasi: true, jumlah: 2 });
  assert.equal(ringkasMenu(peta, 'm-kopi', 4).dibatasi, false);
});

uji('masukan rusak tidak melempar & tidak menyembunyikan apa pun', () => {
  assert.equal(petaMenuOutlet(null).size, 0);
  assert.equal(petaMenuOutlet([{}, null, { product_id: 'x' }]).size, 0);
  assert.equal(menuAktifDi(null, 'm-kopi', SERPONG), true);
  assert.equal(saringMenuOutlet(null, new Map(), SERPONG).length, 0);
});

if (!process.exitCode) console.log(`Menu aktif per outlet: ${lulus} pemeriksaan lulus. ✅`);
