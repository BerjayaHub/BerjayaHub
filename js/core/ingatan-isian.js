/**
 * DRAF ISIAN — menyelamatkan yang belum sempat disimpan.
 *
 * ============ MASALAHNYA ============
 *
 * Aplikasi ini halaman web. Saat orangnya berpindah ke aplikasi lain — kamera,
 * WhatsApp, Excel — Android boleh membuang halaman ini dari memori kalau RAM
 * sedang sempit. Begitu kembali, halamannya dimuat ULANG dari nol.
 *
 * `ingatan-layar.js` sudah mengembalikan MODUL, LAYAR, dan KONTEKSNYA. Yang
 * masih hilang adalah yang paling menyakitkan: apa yang sedang diketik.
 * Mengisi resep berisi belasan bahan lalu kehilangan semuanya karena menerima
 * satu telepon adalah cara tercepat membuat orang berhenti memakai aplikasinya.
 *
 * ============ TIDAK DIPULIHKAN DIAM-DIAM ============
 *
 * Draf TIDAK langsung diisikan kembali. Yang muncul adalah tawaran:
 * "ada isian yang belum tersimpan — Pulihkan / Buang".
 *
 * Alasannya: layar yang sama bisa dibuka untuk maksud yang berbeda. Mengisi
 * ulang formulir dengan angka dari setengah jam lalu, tanpa diminta, akan
 * membuat orang menyimpan sesuatu yang tidak pernah dia maksud — dan angkanya
 * terlihat wajar, jadi tidak ada yang memeriksa.
 *
 * ============ YANG TIDAK BISA DISELAMATKAN ============
 *
 * - **Foto.** Objek `File` tidak bisa disimpan ke sessionStorage. Foto yang
 *   sudah dipilih tapi belum dikirim tetap hilang. (Di Daily Activities ini
 *   sudah tidak jadi masalah sejak 0089: fotonya langsung tersimpan.)
 * - **Isian di dalam dialog.** Dialog dibuang bersama halamannya dan tidak
 *   punya alamat yang bisa dipulihkan.
 * - **Sandi & OTP.** Sengaja tidak pernah disimpan.
 *
 * Batasan ini ditulis di sini supaya tidak ada yang mengira draf berarti
 * "semuanya aman".
 */

const KUNCI = 'berjaya_draf_isian';

/** Sama dengan ingatan layar: lebih dari ini, konteksnya sudah lain. */
const UMUR_MAKS_MS = 30 * 60 * 1000;

/** Jenis isian yang TIDAK pernah disimpan. */
const JENIS_DILARANG = new Set(['password', 'file', 'hidden', 'submit', 'button', 'image', 'reset']);

/** Nama/id yang tidak pernah disimpan walau jenisnya biasa. */
const NAMA_DILARANG = /otp|sandi|password|pin\b/i;

/**
 * Kunci sebuah isian — harus SAMA sebelum dan sesudah halaman dimuat ulang.
 *
 * Tiga tingkat, dari yang paling bisa dipercaya:
 *   1. `id`   — paling stabil, dipakai hampir semua formulir di sini.
 *   2. `name` — dipakai isian di dalam `formDialog` & pemilih foto.
 *   3. kelas + urutan — satu-satunya cara mengenali BARIS DINAMIS seperti
 *      bahan resep, yang memang tidak punya id.
 *
 * Tingkat ketiga sengaja dipisahkan dan diberi penanda `#`, karena ia yang
 * paling mungkin salah kamar: kalau jumlah barisnya berubah, urutannya tidak
 * lagi menunjuk baris yang sama. `cocokkanDraf()` yang menjaganya.
 */
export function kunciIsian({ id, name, kelas, indeks }) {
  if (id) return `id:${id}`;
  if (name) return `nm:${name}`;
  if (kelas && Number.isInteger(indeks)) return `#${kelas}:${indeks}`;
  return null;
}

/** Apakah kunci ini bergantung pada URUTAN (baris dinamis)? */
export const kunciBerurutan = (k) => typeof k === 'string' && k.startsWith('#');

/**
 * Cocokkan draf lama dengan isian yang ada SEKARANG.
 *
 * ============ PENJAGA JUMLAH BARIS ============
 *
 * Kunci berurutan (`#kelas:indeks`) hanya dipakai kalau jumlah baris berkelas
 * itu PERSIS SAMA dengan saat draf disimpan. Kalau berbeda, seluruh kelas itu
 * dilewati.
 *
 * Tanpa penjaga ini, resep yang barisnya bertambah/berkurang akan menerima
 * jumlah bahan A ke baris bahan B — angkanya masuk akal, formulirnya terlihat
 * normal, dan resep yang tersimpan salah tanpa satu pun tanda. Lebih baik
 * kehilangan beberapa baris draf daripada memindahkan angka ke bahan yang
 * keliru.
 *
 * @param {{nilai: Record<string,string>, jumlah: Record<string,number>}} draf
 * @param {{kunci: string[], jumlah: Record<string,number>}} sekarang
 * @returns {{isi: Record<string,string>, dilewati: number}}
 */
export function cocokkanDraf(draf, sekarang) {
  const isi = {};
  let dilewati = 0;
  const adaSekarang = new Set(sekarang?.kunci ?? []);

  for (const [k, v] of Object.entries(draf?.nilai ?? {})) {
    if (!adaSekarang.has(k)) {
      dilewati++;
      continue;
    }
    if (kunciBerurutan(k)) {
      const kelas = k.slice(1, k.lastIndexOf(':'));
      const dulu = draf?.jumlah?.[kelas];
      const kini = sekarang?.jumlah?.[kelas];
      if (dulu == null || kini == null || dulu !== kini) {
        dilewati++;
        continue;
      }
    }
    isi[k] = v;
  }
  return { isi, dilewati };
}

// =====================================================================
// Bagian yang menyentuh DOM
// =====================================================================

/** Kelas baris dinamis yang layak diingat. Sengaja daftar pendek & sadar. */
const KELAS_BARIS = ['ln-qty', 'menu-qty', 'opn-qty', 'item-qty'];

function kelasBaris(el) {
  return KELAS_BARIS.find((k) => el.classList?.contains(k)) ?? null;
}

function bolehDisimpan(el) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') return false;
  if (JENIS_DILARANG.has((el.type || '').toLowerCase())) return false;
  if (NAMA_DILARANG.test(`${el.id ?? ''} ${el.name ?? ''}`)) return false;
  if (el.closest('.modal-overlay')) return false; // dialog: tidak dipulihkan
  return true;
}

/** Semua isian yang layak, beserta kuncinya. */
function daftarIsian(root) {
  const semua = [...root.querySelectorAll('input, select, textarea')].filter(bolehDisimpan);
  const hitungKelas = {};
  const out = [];
  for (const el of semua) {
    const kelas = kelasBaris(el);
    let kunci;
    if (el.id || el.name) {
      kunci = kunciIsian({ id: el.id, name: el.name });
    } else if (kelas) {
      hitungKelas[kelas] = (hitungKelas[kelas] ?? 0) + 1;
      kunci = kunciIsian({ kelas, indeks: hitungKelas[kelas] - 1 });
    }
    if (kunci) out.push({ el, kunci, kelas });
  }
  // Jumlah akhir tiap kelas — dipakai penjaga di `cocokkanDraf`.
  const jumlah = {};
  for (const k of KELAS_BARIS) jumlah[k] = out.filter((x) => x.kelas === k).length;
  return { daftar: out, jumlah };
}

/** Ambil isi formulir yang sedang tampak. `null` kalau tidak ada yang terisi. */
export function petikIsian(root) {
  if (!root) return null;
  const { daftar, jumlah } = daftarIsian(root);
  const nilai = {};
  for (const { el, kunci } of daftar) {
    const v = el.type === 'checkbox' || el.type === 'radio' ? (el.checked ? '1' : '') : el.value;
    // Yang kosong tidak disimpan: draf berisi kolom kosong tidak menyelamatkan
    // apa pun, tapi tetap memicu tawaran "pulihkan" yang membingungkan.
    if (v !== '' && v != null) nilai[kunci] = String(v);
  }
  return Object.keys(nilai).length ? { nilai, jumlah } : null;
}

/** Isikan draf ke formulir. Mengembalikan jumlah yang benar-benar terisi. */
export function terapkanIsian(root, draf) {
  if (!root || !draf) return { terisi: 0, dilewati: 0 };
  const { daftar, jumlah } = daftarIsian(root);
  const { isi, dilewati } = cocokkanDraf(draf, { kunci: daftar.map((d) => d.kunci), jumlah });

  let terisi = 0;
  for (const { el, kunci } of daftar) {
    if (!(kunci in isi)) continue;
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = isi[kunci] === '1';
    else el.value = isi[kunci];
    // `input` & `change` disulut supaya perhitungan yang menempel pada isian
    // itu (mis. perkiraan menu, pratinjau kebutuhan bahan) ikut menyesuaikan.
    // Tanpa ini, angkanya kembali tapi layar di sekitarnya menampilkan hasil
    // dari isian yang lama.
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    terisi++;
  }
  return { terisi, dilewati };
}

// =====================================================================
// Penyimpanan
// =====================================================================

function baca() {
  try {
    const mentah = sessionStorage.getItem(KUNCI);
    if (!mentah) return null;
    const data = JSON.parse(mentah);
    if (!data || typeof data !== 'object') return null;
    if (!(Date.now() - (data.ts ?? 0) < UMUR_MAKS_MS)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Simpan draf untuk satu layar. `kunciLayar` = `modul|layar`.
 *
 * `saatSembunyi` menandai bahwa penulisan ini terjadi tepat sebelum halaman
 * disembunyikan — satu-satunya keadaan yang benar-benar mendahului halaman
 * dibuang OS. Lihat `bacaDraf()`.
 */
export function simpanDraf(kunciLayar, isi, { saatSembunyi = false } = {}) {
  if (!kunciLayar) return;
  try {
    if (!isi) {
      const kini = baca();
      if (kini?.layar !== kunciLayar) return;
      sessionStorage.removeItem(KUNCI);
      return;
    }
    sessionStorage.setItem(KUNCI, JSON.stringify({ layar: kunciLayar, ...isi, sembunyi: !!saatSembunyi, ts: Date.now() }));
  } catch {
    /* penyimpanan diblokir -> fitur ini sekadar tidak aktif */
  }
}

/** Turunkan penandanya — halamannya ternyata selamat, tidak perlu ditawarkan. */
export function lupakanSembunyi() {
  const d = baca();
  if (!d?.sembunyi) return;
  try {
    sessionStorage.setItem(KUNCI, JSON.stringify({ ...d, sembunyi: false }));
  } catch {
    /* diabaikan */
  }
}

/**
 * Draf untuk layar ini, atau null.
 *
 * ============ HANYA YANG DITULIS SAAT HALAMAN DISEMBUNYIKAN ============
 *
 * Draf direkam terus-menerus selagi mengetik, tapi yang DITAWARKAN hanya yang
 * penulisan terakhirnya terjadi saat halaman disembunyikan.
 *
 * Sebabnya: kalau halamannya ternyata SELAMAT — orangnya cuma melirik
 * WhatsApp lalu kembali — isian di layar masih utuh. Menawarkan pemulihan di
 * situ cuma bilah yang mengganggu setiap kali berpindah aplikasi, dan bilah
 * yang muncul terus-menerus akan ditutup tanpa dibaca. Sesudah itu ia tidak
 * berguna lagi justru saat isinya benar-benar penting.
 *
 * Halaman yang selamat menurunkan penandanya sendiri lewat `lupakanSembunyi()`
 * saat kembali terlihat. Halaman yang dibuang tidak sempat melakukannya — dan
 * di situlah drafnya ditawarkan.
 */
export function bacaDraf(kunciLayar) {
  const d = baca();
  if (!d || d.layar !== kunciLayar) return null;
  if (!d.sembunyi) return null;
  return { nilai: d.nilai ?? {}, jumlah: d.jumlah ?? {}, ts: d.ts };
}

/** Buang draf layar ini. Dipanggil setelah tersimpan atau saat ditolak. */
export function hapusDraf(kunciLayar) {
  simpanDraf(kunciLayar, null);
}
