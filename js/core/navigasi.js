/**
 * Tombol Back perangkat.
 *
 * MASALAH YANG DIPERBAIKI: aplikasi ini satu halaman, dan sebelumnya tidak
 * pernah menyentuh `history` sama sekali. Akibatnya menekan Back di HP —
 * gerakan paling refleks yang ada — **keluar dari aplikasi**. Di PWA yang
 * terpasang, ia menutup aplikasinya; di browser, ia melompat ke situs
 * sebelumnya. Yang sedang diisi hilang, dan orangnya harus masuk lagi dari awal.
 *
 * Tidak ada pesan, tidak ada konfirmasi. Untuk orang yang sedang berdiri sambil
 * memegang HP di tengah shift, itu bukan gangguan kecil.
 *
 * CARA KERJANYA: setiap kali pengguna "masuk lebih dalam" (buka modul, buka
 * dialog, buka form), satu LAPIS didorong ke tumpukan bersama satu entri
 * history. Back memunculkan lapis teratas dan menjalankan fungsi kembalinya.
 * Kalau tumpukannya habis, Back dibiarkan berjalan seperti biasa — di Beranda,
 * keluar aplikasi memang yang diharapkan orang.
 */

/** @type {{nama: string, kembali: () => void, penjaga?: boolean}[]} */
const tumpukan = [];
let terpasang = false;

/**
 * Berapa popstate berikutnya yang harus DIABAIKAN.
 *
 * Setiap `history.back()` yang KITA panggil sendiri (bukan ketukan user) akan
 * memunculkan popstate juga, dan popstate itu tidak membawa tanda apa pun soal
 * siapa yang memicunya. Tanpa penghitung ini, back() milik kita akan dibaca
 * sebagai ketukan Back user dan MEMAKAN SATU LAPIS LAGI.
 *
 * Itulah bug "selesai mengisi form, aplikasi melompat ke Beranda": menutup
 * dialog membuang lapisnya sendiri lalu memundurkan history, dan popstate
 * susulannya menelan lapis modul di bawahnya.
 *
 * PENGHITUNG, bukan boolean: dua dialog yang tertutup hampir bersamaan
 * mengantre dua popstate, sementara satu boolean hanya bisa menahan yang
 * pertama.
 */
let abaikanBerikutnya = 0;

/**
 * Sedang menampilkan pertanyaan "tinggalkan isian?".
 *
 * Dipakai untuk dua hal, dan keduanya perlu dibedakan kejujurannya:
 *
 * 1. MENOLAK ketukan Back yang datang saat pertanyaannya masih terbuka
 *    (sambil mengembalikan entri history-nya). Ini load-bearing — tanpa ini,
 *    ketukan kedua membuka pertanyaan kedua lalu melempar orangnya keluar
 *    modul, dan `tools/test-navigasi-popstate.mjs` membuktikannya.
 *
 * 2. Membuat `dorongLapis()` tidak mendaftarkan apa pun selama pertanyaannya
 *    tampil. Ini pertahanan berlapis, BUKAN penyelamatnya: setelah penghitung
 *    `abaikanBerikutnya` di atas benar, lingkaran "pop-up muncul terus" sudah
 *    tidak bisa terjadi walau baris ini dihapus — saya sudah mencobanya, dan
 *    tesnya tetap hijau. Baris ini dipertahankan karena membuat aturannya
 *    sederhana ("selama bertanya, tumpukan beku") dan murah, bukan karena
 *    terbukti menangkap sesuatu hari ini.
 */
let sedangBertanya = false;

/**
 * Kedalaman entri history KITA, dibaca dari entri yang sedang aktif.
 *
 * PENGHITUNG BIASA TIDAK CUKUP, dan itu sudah dibuktikan dengan cara yang
 * mahal: versi sebelumnya menghitung "berapa entri yang saya dorong dan belum
 * dimundurkan". Angka itu MELENCENG KE ATAS, karena `pushState` MEMOTONG entri
 * yang ada di depan posisi sekarang — dan pemotongan itu tidak pernah
 * memberitahu siapa pun. Setiap `bersihkanLapis()` yang memundurkan lalu
 * `dorongLapis()` yang mendorong meninggalkan sisa, dan sesudah beberapa kali
 * berpindah menu, penghitungnya mengira ada lebih banyak entri daripada yang
 * sebenarnya. Satu `go(-n)` yang kelebihan langkah = keluar dari Admin Portal.
 *
 * Karena itu kedalamannya tidak DIHITUNG, melainkan DIBACA dari `history.state`
 * milik entri yang sedang aktif. Nilainya ikut bersama entrinya ke mana pun
 * browser berpindah, jadi tidak bisa melenceng: kalau entri di depan terpotong,
 * yang tersisa tetap membawa kedalamannya sendiri.
 *
 * Nomornya diturunkan dari entri SEBELUMNYA (`idx + 1`), bukan dari pencacah
 * global — supaya di rantai mana pun nomornya selalu 0, 1, 2, … tanpa lompatan.
 * Tanpa itu, jarak yang dihitung dari selisih nomor tidak sama dengan jumlah
 * langkah yang sebenarnya.
 */
const kedalaman = () => Number(history.state?.idx ?? 0);

/**
 * Apakah ada isian yang belum tersimpan di halaman modul?
 *
 * Dilacak dengan cara paling sederhana yang jujur: setiap kali ada peristiwa
 * `input` di dalam `#module-content` (di luar dialog), tandanya dinyalakan;
 * dimatikan saat modul dibuka dan saat muncul toast SUKSES — satu-satunya
 * isyarat "tersimpan" yang dipakai seragam di seluruh aplikasi.
 *
 * Ini HEURISTIK, dan kesalahannya sengaja diarahkan ke satu sisi: ia bisa
 * bertanya padahal tidak perlu (orang mengetik lalu menghapusnya lagi), tapi
 * jarang diam padahal seharusnya bertanya. Untuk sebuah konfirmasi, pertanyaan
 * berlebih hanya mengganggu; kehilangan isian tidak bisa dibatalkan.
 */
let adaIsian = false;

export function tandaiAdaIsian() {
  adaIsian = true;
}
export function bersihkanIsian() {
  adaIsian = false;
}

/**
 * Fungsi penanya. Disuntik dari luar supaya modul ini tidak bergantung pada
 * core/ui.js — ui.js sendiri sudah bergantung ke sini untuk lapis dialog, dan
 * saling-impor antar keduanya adalah cara paling mudah membuat urutan
 * pemuatan modul jadi tidak bisa ditebak.
 * @type {null | (() => Promise<boolean>)}
 */
let tanyaKeluar = null;
export function pasangPenanyaKeluar(fn) {
  tanyaKeluar = fn;
}

/**
 * Pasang sekali di awal aplikasi.
 *
 * Satu entri "penyangga" didorong lebih dulu supaya entri history pertama milik
 * kita, bukan milik halaman sebelumnya. Tanpa itu, Back dari Beranda pada
 * pemuatan pertama akan langsung meninggalkan aplikasi sebelum tumpukan sempat
 * dipakai sama sekali.
 */
export function pasangNavigasi() {
  if (terpasang) return;
  terpasang = true;
  try {
    history.replaceState({ berjaya: 'akar', idx: 0 }, '');
  } catch {
    /* beberapa browser membatasi History API — fitur ini sekadar tidak aktif */
  }
  // Isian dilacak lewat delegasi, bukan per-halaman: kalau tiap modul harus
  // mendaftar sendiri, satu modul yang lupa akan diam-diam kehilangan
  // perlindungan ini — dan justru modul yang jarang disentuh yang paling mudah
  // terlupakan.
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.closest('.modal-overlay')) return; // dialog punya lapisnya sendiri
    if (t.closest('#module-content')) tandaiAdaIsian();
  });

  window.addEventListener('popstate', async () => {
    if (abaikanBerikutnya > 0) {
      abaikanBerikutnya--;
      return;
    }
    // Ketukan Back saat pertanyaan "tinggalkan isian?" masih terbuka: pertanyaan
    // kedua di atas pertanyaan pertama tidak menjawab apa pun, jadi diabaikan.
    //
    // Tapi entri history-nya SUDAH terlanjur dimakan browser, dan itu tidak
    // boleh dibiarkan: history jadi satu langkah lebih pendek daripada tumpukan
    // lapis, dan selisih itu baru terasa jauh kemudian — sebagai Back yang
    // tiba-tiba melompati satu layar, atau keluar dari aplikasi. Jadi entrinya
    // dikembalikan.
    if (sedangBertanya) {
      dorongEntri('tanya');
      return;
    }

    const lapis = tumpukan.pop();
    if (!lapis) return; // sudah di akar -> biarkan browser melakukan tugasnya

    if (lapis.penjaga && adaIsian && tanyaKeluar) {
      // Entri history dikembalikan SEKARANG JUGA (sinkron) supaya posisinya
      // tidak bergeser sementara pertanyaannya masih ditampilkan. Kalau
      // ditunda, Back kedua saat dialog terbuka akan melompati satu lapis.
      tumpukan.push(lapis);
      dorongEntri(lapis.nama);

      sedangBertanya = true;
      let lanjut = false;
      try {
        lanjut = await tanyaKeluar();
      } finally {
        sedangBertanya = false;
      }
      if (!lanjut) return; // "Lanjut mengisi" -> tidak ada yang berubah

      const i = tumpukan.lastIndexOf(lapis);
      if (i !== -1) tumpukan.splice(i, 1);
      mundurkanSendiri();
    }

    adaIsian = false;
    try {
      lapis.kembali();
    } catch (e) {
      console.warn('[navigasi] gagal kembali dari lapis', lapis.nama, e);
    }
  });
}

/**
 * Daftarkan satu lapis baru.
 *
 * @param {string} nama untuk pelacakan saat ada yang aneh
 * @param {() => void} kembali dijalankan saat Back ditekan di lapis ini
 * @returns {() => void} panggil kalau lapisnya ditutup lewat jalur LAIN
 *   (mis. tombol Batal), supaya tumpukan tidak terisi lapis hantu
 */
/**
 * Mundurkan history atas kehendak KITA, bukan user.
 *
 * Popstate yang timbul karenanya sudah dipesan untuk diabaikan lebih dulu —
 * urutannya penting: menaikkan penghitung SESUDAH `back()` bisa kalah cepat
 * kalau browser mengirim popstate-nya lebih awal dari yang diperkirakan.
 */
/**
 * Antrean operasi history — dijalankan SATU PER SATU, dan yang memundurkan
 * DITUNGGU sampai perpindahannya benar-benar terjadi.
 *
 * INI YANG SEBENARNYA SALAH SELAMA INI, dan dua perbaikan sebelumnya cuma
 * menambal gejalanya.
 *
 * `history.go()` tidak berpindah saat itu juga; ia menjadwalkan perpindahan.
 * Sementara itu `pushState` yang menyusul di baris berikutnya jalan SEKARANG.
 * Di Admin Portal urutannya persis begitu — `bersihkanLapis()` lalu
 * `dorongLapis()`. Browser menghitung tujuan `go()` dari entri yang aktif SAAT
 * DIPANGGIL, jadi perpindahannya mendarat satu entri lebih dalam daripada yang
 * dikira, dan aplikasinya berakhir duduk di entri AKAR sambil menampilkan
 * sebuah modul. Ketukan Back berikutnya lalu meninggalkan halaman sama
 * sekali — ke Staff App.
 *
 * Pagar sebanyak apa pun tidak menutup itu, karena masalahnya bukan "berapa
 * langkah" melainkan "kapan". Yang menutupnya adalah menjalankan operasinya
 * berurutan: mundur dulu sampai tiba, baru mendorong.
 */
let antreOperasi = Promise.resolve();

/**
 * Berapa mundur yang sudah dijadwalkan tapi belum selesai.
 *
 * Selama ini nol, dorongan dikerjakan LANGSUNG — `pushState` sendirian tidak
 * punya balapan, dan menundanya justru membuat entri belum ada saat orangnya
 * sempat menekan Back. Antreannya hanya diperlukan ketika ada mundur yang
 * belum mendarat; di situlah urutannya menentukan.
 */
let mundurTertunda = 0;

function antre(fn) {
  antreOperasi = antreOperasi.then(fn).catch((e) => console.warn('[navigasi] operasi history gagal', e));
}

/** Menunggu satu popstate, dengan batas waktu supaya antreannya tidak macet. */
function tungguPopstate() {
  return new Promise((resolve) => {
    let selesai = false;
    const beres = () => {
      if (selesai) return;
      selesai = true;
      window.removeEventListener('popstate', beres);
      resolve();
    };
    window.addEventListener('popstate', beres);
    // `go()` yang di luar jangkauan TIDAK memunculkan popstate sama sekali.
    // Tanpa batas waktu, antreannya berhenti selamanya dan seluruh tombol Back
    // ikut mati — kegagalan yang jauh lebih buruk daripada yang diperbaiki.
    setTimeout(beres, 300);
  });
}

function mundurkanSendiri(langkah = 1) {
  // TIDAK PERNAH melewati entri akar kita. Entri sebelum itu bukan milik
  // aplikasi ini — di Admin Portal, itu Staff App.
  mundurTertunda++;
  antre(async () => {
    // Jumlah langkahnya dihitung DI DALAM antrean, saat gilirannya tiba —
    // bukan saat dijadwalkan. Kedalaman bisa sudah berubah karena operasi
    // sebelum ini, dan memakai angka yang basi persis yang membuat mundurnya
    // kelebihan langkah.
    const n = Math.min(langkah, kedalaman());
    if (n <= 0) {
      mundurTertunda--;
      return;
    }
    // SATU popstate untuk satu panggilan `go()`, berapa pun langkahnya —
    // browser tidak mengirim satu event per langkah.
    abaikanBerikutnya += 1;
    try {
      history.go(-n);
      await tungguPopstate();
    } catch {
      abaikanBerikutnya -= 1;
    } finally {
      mundurTertunda--;
    }
  });
}

/** Dorong entri history baru — lewat antrean yang sama, supaya urutannya pasti. */
function dorongEntri(nama) {
  const dorong = () => {
    try {
      history.pushState({ berjaya: nama, idx: kedalaman() + 1 }, '');
    } catch {
      /* beberapa browser membatasi History API — fitur ini sekadar tidak aktif */
    }
  };
  // Tidak ada mundur yang menggantung -> kerjakan SEKARANG. Menundanya membuat
  // entri belum ada saat orangnya menekan Back sepersekian detik kemudian, dan
  // Back tanpa entri = keluar dari aplikasi. Bagian ini TERBUKTI perlu: tesnya
  // merah kalau semua dorongan diantrekan.
  //
  // Cabang `antre` sebaliknya BELUM terbukti — mencabutnya tidak membuat tes
  // merah, karena mundurnya sendiri sudah menghitung ulang kedalamannya saat
  // gilirannya tiba. Dipertahankan supaya urutannya pasti, bukan karena
  // menangkap sesuatu hari ini. Ditulis apa adanya supaya tidak ada yang
  // mengira baris ini yang menyelamatkan.
  if (mundurTertunda === 0) dorong();
  else antre(dorong);
}

export function dorongLapis(nama, kembali, { penjaga = false } = {}) {
  if (!terpasang) return () => {};
  // Dialog yang lahir DARI pertanyaan keluar tidak boleh punya lapisnya
  // sendiri. Lihat penjelasan `sedangBertanya` di atas.
  if (sedangBertanya) return () => {};
  const lapis = { nama, kembali, penjaga };
  tumpukan.push(lapis);
  dorongEntri(nama);

  return () => buangLapis(lapis);
}

/**
 * Buang satu lapis tertentu beserta entri history-nya.
 *
 * Entri history-nya ikut dibuang supaya Back berikutnya tidak "terasa tidak
 * melakukan apa-apa" — ketukan yang tidak menghasilkan apa pun membuat orang
 * mengira aplikasinya menggantung.
 *
 * Lewat `mundurkanSendiri()`, BUKAN `history.back()` langsung: lapisnya sudah
 * dibuang di baris atas, jadi popstate susulannya tidak boleh membuang satu
 * lapis lagi.
 */
function buangLapis(lapis) {
  const i = tumpukan.lastIndexOf(lapis);
  if (i === -1) return; // sudah dipakai Back
  tumpukan.splice(i, 1);
  mundurkanSendiri();
}

/**
 * Kosongkan tumpukan — beserta entri history-nya.
 *
 * Dipakai saat berpindah ke Beranda/Dashboard lewat TOMBOL, bukan lewat Back.
 *
 * Versi sebelumnya hanya mengosongkan tumpukan dan membiarkan entri history-nya
 * menumpuk. Akibatnya, sesudah membuka lima modul lalu menekan 🏠, history masih
 * menyimpan lima entri basi: ketukan Back pertama benar (keluar aplikasi tidak
 * terjadi), tapi yang berikutnya hanya memundurkan entri kosong — aplikasinya
 * tidak bereaksi sama sekali. Bagi yang memakainya, tombol Back yang "tidak
 * melakukan apa-apa" beberapa kali tidak bisa dibedakan dari aplikasi
 * menggantung.
 *
 * Dimundurkan satu per satu lewat `mundurkanSendiri()` supaya tiap popstate
 * susulannya ikut dipesan untuk diabaikan.
 */
export function bersihkanLapis() {
  const n = tumpukan.length;
  tumpukan.length = 0;
  mundurkanSendiri(n);
}

/**
 * Lapis untuk SUB-HALAMAN di dalam modul (form, rincian, layar isian) yang
 * digambar di tempat, bukan sebagai dialog.
 *
 * KENAPA ADA: versi pertama hanya memberi lapis pada modul, jadi Back dari
 * form di tengah modul melompat langsung ke Beranda. Orangnya lalu harus
 * masuk lagi ke modul yang sama hanya untuk kembali ke daftar yang tadi dia
 * tinggalkan — hukuman untuk gerakan yang maksudnya cuma "batal".
 *
 * Dengan ini urutannya jadi wajar: form → daftar modul → Beranda.
 *
 * @param {string} nama
 * @param {() => void} kembaliKeDaftar menggambar ulang layar utama modulnya
 * @returns {() => void} pembersih untuk tombol "← Kembali" di layar itu
 */
export function dorongSubHalaman(nama, kembaliKeDaftar) {
  const kunci = `sub:${nama}`;

  /**
   * Pasang perilaku "kembali" pada sebuah lapis, dan kembalikan pembersihnya.
   *
   * Sama seperti dialog: kalau tombol Kembali yang dipakai, entri history-nya
   * harus dibuang sendiri. Kalau Back yang dipakai, browser sudah membuangnya —
   * membuangnya lagi akan memundurkan satu langkah tambahan dan melempar
   * orangnya keluar modul.
   */
  const pasang = (lapis) => {
    lapis.lewatBack = false;
    lapis.kembali = () => {
      lapis.lewatBack = true;
      kembaliKeDaftar();
    };
    return () => {
      if (!lapis.lewatBack) buangLapis(lapis);
    };
  };

  // LAYAR YANG SAMA DIGAMBAR ULANG -> pakai lapis yang sudah ada.
  //
  // Ini bukan penghematan, ini perbaikan bug. Layar sesi Daily Activities
  // menggambar dirinya sendiri lagi setiap kali item dikirim, diperbaiki, atau
  // dihapus. Tanpa pemeriksaan ini, tiap penggambaran ulang menambah satu lapis
  // dan satu entri history: sesudah mengirim tiga kali, orangnya harus menekan
  // Back empat kali untuk keluar — dan tiga ketukan pertama hanya menggambar
  // ulang layar yang sama, persis seperti aplikasi yang menggantung.
  const adaSebelumnya = tumpukan.find((l) => l.nama === kunci);
  if (adaSebelumnya) return pasang(adaSebelumnya);

  const lapis = { nama: kunci, kembali: () => {}, penjaga: false };
  if (!terpasang || sedangBertanya) return () => {};
  tumpukan.push(lapis);
  dorongEntri(kunci);
  return pasang(lapis);
}

/** Berapa lapis yang sedang terbuka — untuk pemeriksaan. */
export function jumlahLapis() {
  return tumpukan.length;
}
