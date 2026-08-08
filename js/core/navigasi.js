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
let abaikanSekali = false;

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
    history.replaceState({ berjaya: 'akar' }, '');
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
    if (abaikanSekali) {
      abaikanSekali = false;
      return;
    }
    const lapis = tumpukan.pop();
    if (!lapis) return; // sudah di akar -> biarkan browser melakukan tugasnya

    if (lapis.penjaga && adaIsian && tanyaKeluar) {
      // Entri history dikembalikan SEKARANG JUGA (sinkron) supaya posisinya
      // tidak bergeser sementara pertanyaannya masih ditampilkan. Kalau
      // ditunda, Back kedua saat dialog terbuka akan melompati satu lapis.
      tumpukan.push(lapis);
      try {
        history.pushState({ berjaya: lapis.nama }, '');
      } catch {
        /* diabaikan */
      }
      const lanjut = await tanyaKeluar();
      if (!lanjut) return;
      const i = tumpukan.lastIndexOf(lapis);
      if (i !== -1) tumpukan.splice(i, 1);
      abaikanSekali = true; // popstate dari history.back() di bawah ini
      try {
        history.back();
      } catch {
        /* diabaikan */
      }
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
export function dorongLapis(nama, kembali, { penjaga = false } = {}) {
  if (!terpasang) return () => {};
  const lapis = { nama, kembali, penjaga };
  tumpukan.push(lapis);
  try {
    history.pushState({ berjaya: nama }, '');
  } catch {
    /* diabaikan */
  }

  return () => {
    const i = tumpukan.lastIndexOf(lapis);
    if (i === -1) return; // sudah dipakai Back
    tumpukan.splice(i, 1);
    // Entri history-nya ikut dibuang supaya Back berikutnya tidak "terasa
    // tidak melakukan apa-apa" — ketukan yang tidak menghasilkan apa pun
    // membuat orang mengira aplikasinya menggantung.
    try {
      history.back();
    } catch {
      /* diabaikan */
    }
  };
}

/**
 * Kosongkan tumpukan tanpa menyentuh history.
 * Dipakai saat berpindah ke Beranda lewat tombol, bukan lewat Back.
 */
export function bersihkanLapis() {
  tumpukan.length = 0;
}

/** Berapa lapis yang sedang terbuka — untuk pemeriksaan. */
export function jumlahLapis() {
  return tumpukan.length;
}
