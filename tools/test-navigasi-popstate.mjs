/**
 * Tombol Back & lapis navigasi — diuji terhadap KODE ASLINYA.
 *
 * Beda dari `test-navigasi-back.mjs` yang mencerminkan aturannya: file ini
 * mengimpor `js/core/navigasi.js` yang sebenarnya, lalu menjalankannya di atas
 * tiruan `history` + `popstate`. Dua bug yang dilaporkan user tidak mungkin
 * tertangkap oleh cermin, karena keduanya lahir dari INTERAKSI antara tumpukan
 * lapis dan entri history — bukan dari aturannya:
 *
 *   1. Selesai mengisi form -> aplikasi melompat ke Beranda.
 *      Pembersih `dorongLapis` menghapus lapisnya sendiri LALU memanggil
 *      `history.back()`. Popstate yang muncul tidak tahu itu ulah kita sendiri,
 *      jadi ia memakan SATU LAPIS LAGI — lapis modulnya.
 *
 *   2. Pop-up "lanjutkan mengisi" muncul terus.
 *      Dialog konfirmasinya sendiri mendaftarkan lapis Back (lapisDialog di
 *      ui.js). Saat ditutup, pembersihnya memanggil `history.back()`, yang
 *      memunculkan popstate, yang memicu penjaga yang sama, yang membuka dialog
 *      itu lagi. Selamanya.
 *
 * Tiruan history-nya sengaja meniru perilaku browser yang penting: `back()`
 * TIDAK langsung memanggil handler, ia mengantre popstate untuk giliran
 * berikutnya. Kalau ditiru sinkron, urutan kejadiannya berbeda dari yang
 * sebenarnya dan bug-nya tidak akan muncul.
 */

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

// ---------- Tiruan browser ----------
const antrean = [];
let keluarAplikasi = 0;
const pendengar = { popstate: [] };

const history = {
  entri: [{ berjaya: 'akar' }],
  posisi: 0,
  replaceState(state) {
    this.entri[this.posisi] = state;
  },
  pushState(state) {
    this.entri = this.entri.slice(0, this.posisi + 1);
    this.entri.push(state);
    this.posisi++;
  },
  back() {
    if (this.posisi === 0) {
      keluarAplikasi++; // di akar, Back memang meninggalkan aplikasi
      return;
    }
    this.posisi--;
    antrean.push(this.entri[this.posisi]);
  }
};

globalThis.history = history;
globalThis.window = {
  addEventListener: (nama, fn) => pendengar[nama]?.push(fn),
  scrollY: 0
};
globalThis.document = { addEventListener: () => {} };

/**
 * Kirim semua popstate yang mengantre.
 *
 * Handler-nya dipanggil TANPA di-`await`. Ini bukan kemalasan — begitulah
 * browser bekerja: event berikutnya tetap dikirim meski handler sebelumnya
 * masih menunggu sesuatu (mis. dialog yang belum dijawab). Kalau di sini
 * di-`await` satu per satu, ketukan Back yang datang SAAT dialog terbuka akan
 * tertunda sampai dialognya dijawab — dan bug yang justru paling mungkin
 * dialami orang tidak akan pernah muncul di tes.
 */
async function alirkan() {
  let putaran = 0;
  while (antrean.length) {
    antrean.shift();
    for (const fn of pendengar.popstate) fn();
    await new Promise((r) => setTimeout(r, 0)); // biarkan lanjutan async-nya jalan
    // Jaring pengaman: bug "pop-up muncul terus" berbentuk antrean yang tidak
    // pernah habis. Tanpa batas ini, tesnya menggantung alih-alih gagal.
    if (++putaran > 50) throw new Error('popstate tidak berhenti — kemungkinan lingkaran tak berujung');
  }
}

const nav = await import('../js/core/navigasi.js');

// ---------- Tiruan dialog konfirmasi ui.js ----------
// PENTING: ditiru persis termasuk `lapisDialog` — di situlah lingkarannya lahir.
let dialogMuncul = 0;
let jawabanBerikutnya = false;
/** Kalau diisi, dialognya MENGGANTUNG sampai `jawabSekarang()` dipanggil. */
let tahanJawaban = null;
function konfirmasiSepertiUi() {
  dialogMuncul++;
  let lewatBack = false;
  const lepas = nav.dorongLapis('konfirmasi', () => {
    lewatBack = true;
  });
  const janji = tahanJawaban ? new Promise((r) => (tahanJawaban = r)) : Promise.resolve(jawabanBerikutnya);
  return janji.then((jawab) => {
    if (!lewatBack) lepas();
    return jawab;
  });
}

nav.pasangNavigasi();
nav.pasangPenanyaKeluar(konfirmasiSepertiUi);

// ---------- Skenario 1: tutup dialog form dengan tombol Simpan ----------
let layar = 'beranda';
const lepasModul = nav.dorongLapis('modul:daily', () => (layar = 'beranda'), { penjaga: true });
layar = 'modul';
const lepasForm = nav.dorongLapis('form', () => (layar = 'modul'));
layar = 'form';

// Ditutup lewat tombol Simpan — ditiru persis seperti `close()` di ui.js:
// layarnya diperbarui SENDIRI oleh penutupnya, lalu lapisnya dilepas.
layar = 'modul';
lepasForm();
await alirkan();

cek('setelah menutup form, tetap di modul (bukan melompat ke Beranda)', layar, 'modul');
cek('lapis modulnya masih ada', nav.jumlahLapis(), 1);
cek('tidak ada yang keluar aplikasi', keluarAplikasi, 0);

// ---------- Skenario 2: Back dari modul tanpa isian ----------
history.back();
await alirkan();
cek('Back dari modul kembali ke Beranda', layar, 'beranda');
cek('tumpukan kosong lagi', nav.jumlahLapis(), 0);

// ---------- Skenario 3: penjaga isian — user memilih "Lanjut mengisi" ----------
layar = 'beranda';
nav.dorongLapis('modul:daily', () => (layar = 'beranda'), { penjaga: true });
layar = 'modul';
nav.tandaiAdaIsian();
dialogMuncul = 0;
jawabanBerikutnya = false; // "Lanjut mengisi"

history.back();
await alirkan();

cek('dialog keluar muncul TEPAT sekali', dialogMuncul, 1);
cek('memilih "Lanjut mengisi" -> tetap di modul', layar, 'modul');
cek('lapis modulnya dipertahankan', nav.jumlahLapis(), 1);

// Back kedua harus bertanya lagi — sekali, bukan beruntun.
dialogMuncul = 0;
history.back();
await alirkan();
cek('Back kedua bertanya lagi, tetap sekali', dialogMuncul, 1);
cek('masih di modul', layar, 'modul');

// ---------- Skenario 4: penjaga isian — user memilih "Tinggalkan" ----------
dialogMuncul = 0;
jawabanBerikutnya = true;
history.back();
await alirkan();

cek('memilih "Tinggalkan" -> keluar ke Beranda', layar, 'beranda');
cek('dialognya tetap muncul sekali', dialogMuncul, 1);
cek('tumpukan kosong', nav.jumlahLapis(), 0);
cek('tidak sampai keluar aplikasi', keluarAplikasi, 0);

// ---------- Skenario 5: isian ditandai lalu tersimpan (toast sukses) ----------
layar = 'beranda';
nav.dorongLapis('modul:kas', () => (layar = 'beranda'), { penjaga: true });
layar = 'modul';
nav.tandaiAdaIsian();
nav.bersihkanIsian(); // yang dilakukan toast('...', 'success')
dialogMuncul = 0;
history.back();
await alirkan();
cek('setelah tersimpan, Back tidak bertanya lagi', dialogMuncul, 0);
cek('dan langsung ke Beranda', layar, 'beranda');

// ---------- Skenario 6: sub-halaman di dalam modul ----------
layar = 'beranda';
nav.dorongLapis('modul:cleaning', () => (layar = 'beranda'), { penjaga: true });
layar = 'modul';
const lepasSub = nav.dorongSubHalaman('isi-ceklis', () => (layar = 'modul'));
layar = 'sub';

// (a) keluar lewat tombol "← Kembali" — tombolnya menggambar ulang modulnya
// sendiri, lalu melepas lapisnya (persis cleaning.page.js).
layar = 'modul';
lepasSub();
await alirkan();
cek('tombol Kembali dari sub-halaman -> modul', layar, 'modul');
cek('lapis modul masih utuh', nav.jumlahLapis(), 1);

// (b) masuk lagi, lalu keluar lewat Back perangkat
const lepasSub2 = nav.dorongSubHalaman('isi-ceklis', () => (layar = 'modul'));
layar = 'sub';
history.back();
await alirkan();
cek('Back dari sub-halaman -> modul, bukan Beranda', layar, 'modul');
lepasSub2(); // dipanggil belakangan; tidak boleh berefek apa pun
await alirkan();
cek('pembersih setelah Back tidak memundurkan lagi', layar, 'modul');
cek('lapis modul tetap ada', nav.jumlahLapis(), 1);

history.back();
await alirkan();
cek('Back berikutnya baru ke Beranda', layar, 'beranda');
cek('tidak pernah keluar aplikasi di seluruh skenario', keluarAplikasi, 0);

// ---------- Skenario 6c: Back ditekan saat pertanyaan masih terbuka ----------
//
// Yang realistis bukan dua ketukan dalam satu milidetik, tapi ketukan kedua
// saat dialog "tinggalkan isian?" SUDAH tampil dan belum dijawab — orang yang
// tidak sabar menekan Back lagi alih-alih menyentuh tombol di dialognya.
//
// Yang tidak boleh terjadi: pertanyaannya menumpuk, atau history jadi lebih
// pendek daripada tumpukan lapis. Selisih itu baru terasa jauh kemudian —
// sebagai Back yang melompati satu layar, atau keluar dari aplikasi.
layar = 'beranda';
nav.dorongLapis('modul:kas', () => (layar = 'beranda'), { penjaga: true });
layar = 'modul';
nav.tandaiAdaIsian();
dialogMuncul = 0;
tahanJawaban = () => {}; // dialog akan menggantung

history.back();
await alirkan(); // dialog terbuka, menggantung menunggu jawaban
cek('dialog sudah terbuka', dialogMuncul, 1);

// Ketukan Back kedua, saat dialognya masih terbuka.
history.back();
await alirkan();

const jawab = tahanJawaban;
tahanJawaban = null;
jawab(false); // "Lanjut mengisi"
await new Promise((r) => setTimeout(r, 0));
await alirkan();

cek('ketukan Back saat dialog terbuka tidak menambah pertanyaan', dialogMuncul, 1);
cek('tetap di modul', layar, 'modul');
cek('lapisnya utuh', nav.jumlahLapis(), 1);
cek('tidak keluar aplikasi', keluarAplikasi, 0);

// Dan yang paling penting: posisinya tidak melenceng. Back berikutnya harus
// bertanya lagi — sekali — bukan melompat langsung keluar.
dialogMuncul = 0;
jawabanBerikutnya = true;
history.back();
await alirkan();
cek('Back berikutnya bertanya sekali lagi', dialogMuncul, 1);
cek('lalu keluar ke Beranda', layar, 'beranda');
cek('tetap tanpa keluar aplikasi', keluarAplikasi, 0);

// ---------- Skenario 7: layar sesi menggambar ULANG dirinya sendiri ----------
//
// Daily Activities memanggil `renderRunForm()` lagi setiap kali item dikirim,
// diperbaiki, atau dihapus — dan tiap penggambaran ulang memanggil
// `dorongSubHalaman()` dengan nama yang sama. Kalau lapisnya menumpuk, orangnya
// harus menekan Back sebanyak jumlah pengiriman untuk bisa keluar, dan
// ketukan-ketukan pertama hanya menggambar ulang layar yang sama. Bagi yang
// memakainya, itu tidak bisa dibedakan dari aplikasi yang menggantung.
layar = 'beranda';
nav.dorongLapis('modul:cleaning', () => (layar = 'beranda'), { penjaga: true });
layar = 'modul';

let lepasTerakhir = nav.dorongSubHalaman('sesi:pagi', () => (layar = 'modul'));
layar = 'sub';
const lapisSetelahSekali = nav.jumlahLapis();

// tiga kali kirim/perbaiki/hapus -> tiga penggambaran ulang
for (let i = 0; i < 3; i++) lepasTerakhir = nav.dorongSubHalaman('sesi:pagi', () => (layar = 'modul'));

cek('menggambar ulang layar yang sama tidak menambah lapis', nav.jumlahLapis(), lapisSetelahSekali);

history.back();
await alirkan();
cek('SATU ketukan Back sudah kembali ke daftar sesi', layar, 'modul');
cek('lapis modulnya tersisa satu', nav.jumlahLapis(), 1);

lepasTerakhir(); // pembersih dari penggambaran terakhir; tidak boleh berefek
await alirkan();
cek('pembersih basi tidak memundurkan apa pun', layar, 'modul');
cek('dan tidak membuang lapis modul', nav.jumlahLapis(), 1);

history.back();
await alirkan();
cek('Back berikutnya baru ke Beranda', layar, 'beranda');
cek('sampai akhir tidak pernah keluar aplikasi', keluarAplikasi, 0);

// ---------- Skenario 8: tombol 🏠 Beranda ----------
//
// Berpindah ke Beranda lewat TOMBOL harus ikut membuang entri history-nya.
// Kalau tidak, ketukan Back sesudahnya hanya memundurkan entri basi dan
// aplikasinya tidak bereaksi — beberapa kali berturut-turut. Itu tidak bisa
// dibedakan dari aplikasi yang menggantung.
layar = 'beranda';
nav.dorongLapis('modul:a', () => (layar = 'beranda'), { penjaga: true });
nav.dorongSubHalaman('rincian', () => (layar = 'modul'));
layar = 'sub';

const posisiSebelum = history.posisi;
nav.bersihkanLapis(); // yang dilakukan tombol 🏠
layar = 'beranda';
await alirkan();

cek('tombol Beranda mengosongkan tumpukan', nav.jumlahLapis(), 0);
cek('entri history-nya ikut dibuang, bukan ditinggal basi', history.posisi, posisiSebelum - 2);

const keluarSebelum = keluarAplikasi;
history.back();
await alirkan();
cek('Back di Beranda langsung berarti keluar aplikasi', keluarAplikasi, keluarSebelum + 1);
cek('bukan ketukan yang tidak melakukan apa-apa', layar, 'beranda');

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Lapis Back diuji langsung pada navigasi.js: 39 kasus, termasuk empat bug tumpukan lapis. ✅');
