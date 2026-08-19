/**
 * Memasang draf isian ke aplikasi — perekam + tawaran pemulihan.
 *
 * Dipisah dari `ingatan-isian.js` supaya bagian yang menentukan angka mendarat
 * di kolom yang benar tetap bisa diuji tanpa browser. Berkas ini murni
 * pemasangan: pendengar peristiwa, waktu tunda, dan satu bilah tawaran.
 *
 * ============ KAPAN DISIMPAN ============
 *
 * Setiap kali ada yang diketik, ditunda ~500 ms — dan SEKALI LAGI saat halaman
 * disembunyikan. Yang kedua yang benar-benar menyelamatkan: `visibilitychange`
 * adalah isyarat terakhir yang pasti dijalankan sebelum Android membuang
 * halamannya. `beforeunload` tidak dipanggil pada kasus itu.
 *
 * ============ KAPAN DITAWARKAN ============
 *
 * Hanya kalau layar yang sekarang SAMA dengan layar tempat draf disimpan, dan
 * hanya kalau ada isian yang benar-benar cocok. Bilahnya menunggu ditekan —
 * draf tidak pernah masuk sendiri. Alasannya di `ingatan-isian.js`.
 */

import { petikIsian, terapkanIsian, bacaDraf, simpanDraf, hapusDraf, lupakanSembunyi } from './ingatan-isian.js';

const TUNDA_MS = 500;

let kunciLayarSekarang = null;
let timer = null;
let terpasang = false;

/** Wadah isian yang sedang aktif. */
function wadah() {
  return document.getElementById('module-content') ?? document.getElementById('module-body');
}

function rekamSekarang({ saatSembunyi = false } = {}) {
  if (!kunciLayarSekarang) return;
  const root = wadah();
  if (!root) return;
  simpanDraf(kunciLayarSekarang, petikIsian(root), { saatSembunyi });
}

/**
 * Pasang perekam. Dipanggil SEKALI saat aplikasi dimulai.
 */
export function pasangPerekamDraf() {
  if (terpasang) return;
  terpasang = true;

  const rekamTertunda = () => {
    clearTimeout(timer);
    timer = setTimeout(rekamSekarang, TUNDA_MS);
  };

  // Delegasi di document: kalau tiap modul harus mendaftar sendiri, satu modul
  // yang lupa akan diam-diam kehilangan perlindungan ini — dan justru modul
  // yang jarang disentuh yang paling mudah terlupakan.
  document.addEventListener('input', rekamTertunda, true);
  document.addEventListener('change', rekamTertunda, true);

  // Isyarat terakhir sebelum halaman dibuang OS. Direkam LANGSUNG, tanpa
  // penundaan — penundaan 500 ms tidak akan pernah selesai kalau halamannya
  // sudah dimatikan.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(timer);
      rekamSekarang({ saatSembunyi: true });
      return;
    }
    // Halamannya SELAMAT — isian di layar masih utuh, jadi drafnya tidak perlu
    // ditawarkan. Kalau baris ini tidak ada, bilah "ada isian belum tersimpan"
    // akan muncul setiap kali orang melirik WhatsApp lalu kembali, dan bilah
    // yang muncul terus-menerus akan ditutup tanpa dibaca.
    lupakanSembunyi();
  });
}

/**
 * Beri tahu perekam layar mana yang sedang dibuka.
 *
 * @param {string|null} kunci `modul|layar` — null saat di Beranda
 */
export function setLayarDraf(kunci) {
  kunciLayarSekarang = kunci || null;
}

/** Buang draf layar ini — dipanggil sesudah isiannya benar-benar tersimpan. */
export function selesaiDraf() {
  if (kunciLayarSekarang) hapusDraf(kunciLayarSekarang);
}

/**
 * Tawarkan pemulihan kalau ada draf untuk layar ini.
 *
 * Dipanggil setelah modulnya selesai menggambar. Aman dipanggil berkali-kali:
 * bilah yang sudah ada tidak digandakan.
 */
export function tawarkanDraf(kunci) {
  setLayarDraf(kunci);
  const draf = bacaDraf(kunci);
  const root = wadah();
  if (!draf || !root) return;
  if (root.querySelector('.draf-bar')) return;

  const menit = Math.max(1, Math.round((Date.now() - (draf.ts ?? Date.now())) / 60000));
  const bar = document.createElement('div');
  bar.className = 'draf-bar';
  bar.innerHTML = `
    <span>Ada isian yang <strong>belum tersimpan</strong> dari ${menit} menit lalu.</span>
    <span class="draf-aksi">
      <button type="button" class="primary" data-act="pulih">Pulihkan</button>
      <button type="button" data-act="buang">Buang</button>
    </span>`;
  root.prepend(bar);

  bar.querySelector('[data-act="pulih"]').addEventListener('click', () => {
    const { terisi, dilewati } = terapkanIsian(root, draf);
    bar.innerHTML =
      terisi > 0
        ? `<span>✅ ${terisi} isian dipulihkan.${
            // Dikatakan apa adanya. Draf yang dipulihkan SEBAGIAN tanpa
            // diberitahu jauh lebih berbahaya daripada tidak dipulihkan sama
            // sekali: orangnya mengira formulirnya utuh lalu menyimpannya.
            dilewati ? ` ${dilewati} tidak bisa dipulihkan karena isian di layar sudah berubah — periksa lagi sebelum menyimpan.` : ''
          }</span>`
        : '<span>Tidak ada isian yang cocok dengan layar ini — kemungkinan bentuknya sudah berubah.</span>';
    if (dilewati) bar.classList.add('draf-bar-sebagian');
    hapusDraf(kunci);
    setTimeout(() => bar.remove(), dilewati ? 12000 : 4000);
  });

  bar.querySelector('[data-act="buang"]').addEventListener('click', () => {
    hapusDraf(kunci);
    bar.remove();
  });
}
