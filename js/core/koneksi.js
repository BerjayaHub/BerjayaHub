/**
 * Penanda "sedang offline".
 *
 * KENAPA PERLU: PWA ini dipakai di dapur, gudang, dan halaman parkir. Sinyal
 * hilang itu wajar. Tapi sebelum ini tidak ada satu pun tanda — yang muncul
 * cuma tombol yang gagal dengan pesan teknis, dan orangnya menyimpulkan
 * aplikasinya rusak. Menekan tombol yang sama berkali-kali karena tidak tahu
 * masalahnya ada di sinyal adalah pengalaman yang bisa dihindari dengan satu
 * baris pemberitahuan.
 *
 * KENAPA TIDAK CUKUP `navigator.onLine`: nilainya berarti "ada antarmuka
 * jaringan", bukan "internet bisa dipakai". HP yang tersambung wifi hotel tanpa
 * login tetap melaporkan `true`. Karena itu tanda ini juga dinyalakan oleh
 * KEGAGALAN FETCH yang sebenarnya — satu-satunya bukti yang tidak bisa
 * dibantah.
 */

let offline = false;
let elemen = null;
let jamPulih = null;

function pastikanElemen() {
  if (elemen) return elemen;
  elemen = document.createElement('div');
  elemen.className = 'penanda-koneksi';
  elemen.setAttribute('role', 'status');
  elemen.hidden = true;
  document.body.appendChild(elemen);
  return elemen;
}

function gambar() {
  const el = pastikanElemen();
  if (offline) {
    el.textContent = '⚠️ Tidak ada koneksi — perubahan belum tersimpan ke server.';
    el.classList.add('offline');
    el.classList.remove('pulih');
    el.hidden = false;
  } else if (!el.hidden) {
    // Kabar "sudah tersambung lagi" ditampilkan sebentar, lalu hilang sendiri.
    // Kalau langsung dihilangkan, orang yang sempat melihat peringatannya tidak
    // pernah tahu keadaannya sudah beres, dan ragu mencoba lagi.
    el.textContent = '✓ Koneksi kembali. Silakan coba lagi.';
    el.classList.remove('offline');
    el.classList.add('pulih');
    clearTimeout(jamPulih);
    jamPulih = setTimeout(() => {
      el.hidden = true;
    }, 4000);
  }
}

/** Dipanggil saat sebuah permintaan jaringan benar-benar gagal. */
export function tandaiOffline() {
  if (offline) return;
  offline = true;
  gambar();
}

/** Dipanggil saat sebuah permintaan berhasil — bukti paling kuat bahwa jaringan hidup. */
export function tandaiOnline() {
  if (!offline) return;
  offline = false;
  gambar();
}

export function sedangOffline() {
  return offline;
}

/**
 * Pasang sekali di awal aplikasi.
 *
 * Peristiwa `offline` bawaan browser tetap dipakai karena ia bereaksi SEKETIKA
 * saat mode pesawat dinyalakan — lebih cepat daripada menunggu satu permintaan
 * gagal. Yang tidak dipercaya adalah `online`: tersambungnya antarmuka bukan
 * jaminan servernya bisa dihubungi, jadi tanda offline baru dilepas setelah ada
 * permintaan yang benar-benar berhasil.
 */
export function pasangPenandaKoneksi() {
  window.addEventListener('offline', tandaiOffline);
  if (navigator.onLine === false) tandaiOffline();
}
