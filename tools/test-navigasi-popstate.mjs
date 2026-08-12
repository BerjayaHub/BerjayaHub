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
  /**
   * `history.state` milik entri yang sedang aktif — ikut berpindah bersama
   * entrinya, persis seperti di browser. Inilah yang membuat kedalaman bisa
   * DIBACA alih-alih dihitung, dan karena itu tidak bisa melenceng.
   */
  get state() {
    return this.entri[this.posisi];
  },
  replaceState(state) {
    this.entri[this.posisi] = state;
  },
  pushState(state) {
    // pushState berlaku SEKARANG, di posisi saat ini — bahkan kalau ada
    // permintaan mundur yang belum diproses. Itulah balapan yang melahirkan
    // bug "klik modul di Admin Portal malah lompat ke Staff App".
    this.entri = this.entri.slice(0, this.posisi + 1);
    this.entri.push(state);
    this.posisi++;
  },
  back() {
    this.go(-1);
  },
  /**
   * ASINKRON, seperti browser sungguhan.
   *
   * Versi pertama tiruan ini memindahkan `posisi` SEKETIKA. Itu keliru, dan
   * kekeliruannya tepat menutupi bug yang dilaporkan: di browser, `back()`
   * hanya MENGANTREKAN perpindahan, dan `pushState` yang dipanggil sesudahnya
   * dieksekusi lebih dulu. Dengan tiruan yang sinkron, urutan itu tidak pernah
   * terjadi, dan kode yang salah tetap terlihat benar.
   */
  /**
   * Tujuannya dihitung SAAT `go()` DIPANGGIL, bukan saat antreannya diproses.
   *
   * Ini perbedaan yang menentukan, dan versi sebelumnya salah menirunya.
   * Urutan yang terjadi di Admin Portal adalah: `go(-1)` dipanggil, lalu
   * `pushState` menyusul SEBELUM perpindahannya sempat dikerjakan. Kalau
   * tujuannya dihitung belakangan, `pushState` itu ikut menggeser sasarannya
   * dan posisinya seolah stabil — persis yang membuat tes ini hijau padahal
   * aplikasinya melompat ke Staff App di HP orangnya.
   *
   * Dengan tujuan dikunci di awal, `pushState` tidak lagi menutupi kesalahan:
   * mundur dari entri yang sudah ditinggalkan mendarat lebih dalam daripada
   * yang dikira, dan itulah yang menembus entri akar aplikasi.
   */
  go(delta) {
    if (delta >= 0) return;
    antrean.push({ tujuan: this.posisi + delta });
  }
};

globalThis.history = history;
globalThis.window = {
  addEventListener: (nama, fn) => pendengar[nama]?.push(fn),
  removeEventListener: (nama, fn) => {
    const i = pendengar[nama]?.indexOf(fn) ?? -1;
    if (i >= 0) pendengar[nama].splice(i, 1);
  },
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
  // navigasi.js kini menjalankan operasi history-nya lewat ANTREAN, dan yang
  // memundurkan menunggu popstate-nya tiba. Jadi "menenangkan" keadaan berarti
  // dua hal sekaligus: memberi giliran pada antrean itu, dan mengirimkan
  // popstate yang ditunggunya. Keduanya saling memicu, jadi diulang sampai
  // benar-benar tidak ada lagi yang tersisa.
  let diam = 0;
  let putaran = 0;
  while (diam < 3) {
    await new Promise((r) => setTimeout(r, 0));
    if (antrean.length) {
      diam = 0;
      const { tujuan } = antrean.shift();
      if (tujuan < 0) {
        // Melewati entri pertama = meninggalkan halaman ini. Di Admin Portal,
        // halaman sebelumnya adalah Staff App.
        keluarAplikasi++;
        history.posisi = 0;
      } else {
        history.posisi = tujuan;
        for (const fn of [...pendengar.popstate]) fn();
      }
    } else {
      diam++;
    }
    // Jaring pengaman: bug "pop-up muncul terus" berbentuk antrean yang tidak
    // pernah habis. Tanpa batas ini, tesnya menggantung alih-alih gagal.
    if (++putaran > 200) throw new Error('popstate tidak berhenti — kemungkinan lingkaran tak berujung');
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

// ---------- Skenario 9: pindah menu di Admin Portal ----------
//
// REGRESI YANG DILAPORKAN: "di Admin Portal, klik salah satu modul malah
// melempar saya ke Staff App."
//
// `openModule()` di Admin Portal memanggil `bersihkanLapis()` setiap kali menu
// diganti. Saat pembersihan itu diberi kemampuan memundurkan history, ia
// memanggil `history.back()` sekali PER LAPIS — dan `back()` itu asinkron, jadi
// beberapa panggilan beruntun bisa diproses sesudah `pushState` yang menyusul.
// Hitungannya meleset ke bawah nol, history mundur melewati entri pertama
// aplikasi, dan entri sebelum itu adalah halaman sebelumnya: Staff App.
layar = 'dashboard';
const keluarSebelumMenu = keluarAplikasi;

for (const menu of ['menu:kas', 'menu:presensi', 'menu:produk', 'menu:reservasi']) {
  // Persis urutan di main-admin.js: bersihkan dulu, baru dorong lapis baru.
  nav.bersihkanLapis();
  nav.dorongLapis(menu, () => (layar = 'dashboard'), { penjaga: true });
  layar = menu;
  await alirkan();
}

cek('berpindah menu berkali-kali tidak melempar keluar aplikasi', keluarAplikasi, keluarSebelumMenu);
cek('tetap di menu terakhir', layar, 'menu:reservasi');
cek('hanya satu lapis menu yang tersisa', nav.jumlahLapis(), 1);

// Dan Back dari menu tetap kembali ke Dashboard, bukan keluar.
history.back();
await alirkan();
cek('Back dari menu -> Dashboard', layar, 'dashboard');
cek('masih tanpa keluar aplikasi', keluarAplikasi, keluarSebelumMenu);

// `bersihkanLapis()` saat tumpukan KOSONG tidak boleh memundurkan apa pun —
// di Dashboard, entri sebelum kita memang bukan milik aplikasi ini.
nav.bersihkanLapis();
await alirkan();
cek('bersihkanLapis saat kosong tidak memundurkan apa pun', keluarAplikasi, keluarSebelumMenu);

// ---------- Skenario 10: pindah menu saat ADA SUB-LAPIS terbuka ----------
//
// Ini bentuk terparah dari regresi yang sama, dan yang paling mungkin dialami
// di layar lebar: admin membuka sebuah menu (1 lapis), masuk ke sub-halaman
// atau membuka dialog (jadi 2 lapis), lalu langsung mengklik menu lain di
// sidebar tanpa menutup apa pun.
//
// `bersihkanLapis()` harus memundurkan DUA entri sekaligus lalu `pushState`
// menyusul. Kalau mundurnya dikerjakan sebagai dua `back()` beruntun, keduanya
// baru diproses SESUDAH pushState — hitungannya meleset satu ke bawah, dan
// satu langkah kelebihan itu sudah cukup untuk keluar dari Admin Portal.
layar = 'dashboard';
const keluarSebelumSub = keluarAplikasi;

nav.dorongLapis('menu:produk', () => (layar = 'dashboard'), { penjaga: true });
layar = 'menu:produk';
nav.dorongSubHalaman('rincian-produk', () => (layar = 'menu:produk'));
layar = 'sub';

// Klik menu lain di sidebar — urutan persis main-admin.js.
nav.bersihkanLapis();
nav.dorongLapis('menu:kas', () => (layar = 'dashboard'), { penjaga: true });
layar = 'menu:kas';
await alirkan();

cek('pindah menu dengan sub-lapis terbuka: tidak keluar aplikasi', keluarAplikasi, keluarSebelumSub);
cek('mendarat di menu yang diklik', layar, 'menu:kas');
cek('hanya lapis menu baru yang tersisa', nav.jumlahLapis(), 1);

// Back sesudahnya harus kembali ke Dashboard — SEKALI, bukan tanpa reaksi.
history.back();
await alirkan();
cek('Back sesudah pindah menu -> Dashboard', layar, 'dashboard');
cek('dan tetap tidak keluar aplikasi', keluarAplikasi, keluarSebelumSub);

// Tiga lapis sekaligus: menu + sub-halaman + dialog di atasnya.
layar = 'dashboard';
nav.dorongLapis('menu:reservasi', () => (layar = 'dashboard'), { penjaga: true });
nav.dorongSubHalaman('form-reservasi', () => (layar = 'menu:reservasi'));
nav.dorongLapis('dialog', () => (layar = 'sub'));
layar = 'dialog';
nav.bersihkanLapis();
nav.dorongLapis('menu:shift', () => (layar = 'dashboard'), { penjaga: true });
layar = 'menu:shift';
await alirkan();
cek('tiga lapis sekaligus pun aman', keluarAplikasi, keluarSebelumSub);
cek('tetap di menu yang diklik', layar, 'menu:shift');

history.back();
await alirkan();
cek('Back tetap satu langkah ke Dashboard', layar, 'dashboard');
cek('tanpa keluar aplikasi sampai akhir', keluarAplikasi, keluarSebelumSub);

// ---------- Skenario 11: berpindah menu BERKALI-KALI ----------
//
// Ini bug yang dilaporkan kedua kalinya: "masuk modul di Admin Portal masih
// dilempar ke Staff App".
//
// Perbaikan pertama memakai PENGHITUNG entri yang kita dorong. Angka itu
// melenceng ke atas, karena `pushState` MEMOTONG entri di depan posisi sekarang
// tanpa memberitahu siapa pun — jadi tiap putaran "mundur lalu dorong"
// meninggalkan sisa. Sesudah beberapa kali berpindah menu, penghitungnya
// mengira ada lebih banyak entri daripada yang sebenarnya, dan satu `go(-n)`
// yang kelebihan langkah membawa orangnya keluar dari Admin Portal.
//
// Karena itu putarannya di sini BANYAK, bukan dua-tiga: kelencengannya
// menumpuk, dan baru terlihat setelah beberapa kali.
layar = 'dashboard';
const keluarSebelumUlang = keluarAplikasi;

for (let i = 0; i < 12; i++) {
  nav.bersihkanLapis();
  nav.dorongLapis(`menu:${i}`, () => (layar = 'dashboard'), { penjaga: true });
  layar = `menu:${i}`;
  await alirkan();
  cek(`putaran ${i}: tidak keluar aplikasi`, keluarAplikasi, keluarSebelumUlang);
}

cek('kedalaman tidak menumpuk setelah 12 kali pindah menu', history.posisi, 1);
cek('lapisnya tetap satu', nav.jumlahLapis(), 1);

// Diselingi sub-halaman & dialog, lalu pindah menu lagi — bentuk yang paling
// mungkin dipakai orang sungguhan.
for (let i = 0; i < 6; i++) {
  nav.dorongSubHalaman(`sub-${i}`, () => (layar = 'menu'));
  nav.dorongLapis('dialog', () => (layar = 'sub'));
  nav.bersihkanLapis();
  nav.dorongLapis(`menu:x${i}`, () => (layar = 'dashboard'), { penjaga: true });
  await alirkan();
  cek(`putaran campuran ${i}: tidak keluar aplikasi`, keluarAplikasi, keluarSebelumUlang);
}
cek('kedalaman tetap satu setelah putaran campuran', history.posisi, 1);

history.back();
await alirkan();
cek('Back masih membawa ke Dashboard', layar, 'dashboard');
cek('dan tetap tidak keluar aplikasi', keluarAplikasi, keluarSebelumUlang);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Lapis Back diuji langsung pada navigasi.js: 77 kasus, termasuk enam bug tumpukan lapis. ✅');
