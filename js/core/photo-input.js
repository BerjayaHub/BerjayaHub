// `image-compress` tidak mengimpor apa pun, jadi tidak ada lingkaran impor
// seperti yang diwaspadai pada `escapeHtml` di bawah.
import { compressImage } from './image-compress.js';

// Escape lokal, TIDAK diimpor dari ui.js. Kalau diimpor, terbentuk lingkaran
// (ui.js -> photo-input.js -> ui.js). ES module memang bisa menanganinya karena
// function declaration terangkat, tapi lingkaran impor itu jenis ketergantungan
// yang gampang pecah begitu ada yang mengubah salah satu file jadi const arrow.
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Foto yang SUDAH dikecilkan di sini.
 *
 * WeakSet, bukan penanda pada objek File-nya: menempelkan properti ke File
 * bekerja, tapi hilang begitu file itu disalin/dibungkus di tempat lain — dan
 * hilangnya tidak terlihat, hasilnya cuma kompresi kedua yang menurunkan mutu
 * bukti tanpa ada yang tahu.
 */
export const sudahDikecilkan = new WeakSet();

/** Apakah file ini sudah melewati kompresi di pemilih foto. */
export function perluDikecilkan(file) {
  return !!file && !sudahDikecilkan.has(file);
}

/**
 * Pemilih foto: Kamera (diutamakan) atau Galeri.
 *
 * KENAPA DUA TOMBOL, BUKAN SATU INPUT:
 * Atribut `capture` pada <input type="file"> memaksa kamera langsung terbuka —
 * tapi efek sampingnya, opsi "pilih dari galeri" HILANG sama sekali di
 * kebanyakan browser HP. Jadi tidak ada satu input pun yang bisa memberi
 * keduanya. Solusinya dua input tersembunyi: satu ber-`capture`, satu polos,
 * dengan tombol Kamera diletakkan lebih dulu dan diberi gaya primer supaya
 * itu yang dipakai secara refleks.
 *
 * `capture="environment"` = kamera belakang (untuk memotret barang),
 * `capture="user"` = kamera depan (untuk swafoto). Nilai ini hanya SARAN;
 * kalau perangkatnya tidak punya kamera yang diminta, browser memakai yang ada
 * — jadi aman dipasang di desktop, yang akan jatuh ke pemilih berkas biasa.
 */

let gaya = false;
function pasangGaya() {
  if (gaya) return;
  gaya = true;
  const el = document.createElement('style');
  el.textContent = `
    .photo-input-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .photo-input-actions button{max-width:none;flex:0 0 auto}
    .photo-preview{display:flex;gap:10px;align-items:center;margin-top:8px}
    .photo-preview img{width:76px;height:76px;object-fit:cover;border-radius:8px;background:#eee;border:1px solid var(--color-border,#e3e3e3)}
    .photo-preview-name{font-size:0.78rem;color:var(--color-text-muted,#666);word-break:break-all}
  `;
  document.head.appendChild(el);
}

/**
 * ============ FOTO DIKECILKAN SAAT DIPILIH, BUKAN SAAT DIKIRIM ============
 *
 * GEJALA YANG DILAPORKAN: di Daily Activities, sesudah mengambil foto untuk
 * salah satu item, halaman melompat kembali ke layar depan modul dan fotonya
 * tidak terunggah.
 *
 * MEKANISMENYA. Sebelumnya file mentah dari kamera disimpan apa adanya sampai
 * tombol Kirim ditekan. Satu foto HP hari ini 3–5 MB / 12 megapiksel. Untuk
 * satu sesi berisi sepuluh item, itu:
 *
 *   - ~40 MB berkas mentah menganggur di memori, DAN
 *   - sepuluh pratinjau `<img>` yang masing-masing MENDEKODE gambar penuh.
 *     Kotaknya cuma 76×76 px, tapi bitmap yang didekode tetap seukuran
 *     aslinya: 12 MP × 4 byte ≈ 48 MB PER GAMBAR.
 *
 * Ratusan megabyte di halaman yang sedang berada di LATAR BELAKANG, karena
 * aplikasi kameranya — yang juga rakus memori — sedang di depan. Android
 * membuang halaman yang di latar belakang lebih dulu. Begitu orangnya kembali,
 * halamannya dimuat ulang dari nol: layarnya reset, dan file yang cuma ada di
 * memori ikut hilang. Persis dua gejala yang dilaporkan.
 *
 * Perlu dikatakan terus terang: ini penjelasan yang paling cocok dengan
 * gejalanya dan mekanismenya bisa dihitung, TAPI saya tidak bisa memutar ulang
 * kejadiannya di HP-nya. Yang pasti berkurang adalah pemicunya — sekitar 25×
 * lebih sedikit memori. Kalau gejalanya masih muncul sesudah ini, sebabnya
 * bukan yang ini.
 *
 * Kompresi juga TIDAK PERNAH menggagalkan pilihan foto: `compressImage`
 * mengembalikan file aslinya kalau gagal. Lebih baik mengunggah yang besar
 * daripada menolak pekerjaan orang yang sedang berdiri di outlet.
 */

/**
 * Markup pemilih foto.
 * @param {{name:string, label:string, help?:string, facing?:'environment'|'user', currentUrl?:string}} opts
 */
export function photoInputHtml({ name, label, help = '', facing = 'environment', currentUrl = '' }) {
  const n = escapeHtml(name);
  return `
    <div class="field photo-input" data-photo="${n}">
      <label>${escapeHtml(label)}</label>
      <div class="photo-input-actions">
        <button type="button" class="primary" data-act="camera">📷 Ambil Foto</button>
        <button type="button" data-act="gallery">🖼️ Dari Galeri</button>
        <button type="button" data-act="clear" hidden>Hapus pilihan</button>
      </div>
      <input type="file" name="${n}" accept="image/*" capture="${escapeHtml(facing)}" hidden data-role="camera" />
      <input type="file" name="${n}__gallery" accept="image/*" hidden data-role="gallery" />
      <div class="photo-preview" ${currentUrl ? '' : 'hidden'}>
        <img alt="" src="${escapeHtml(currentUrl)}" />
        <span class="photo-preview-name">${currentUrl ? 'Foto saat ini — pilih baru untuk mengganti.' : ''}</span>
      </div>
      ${help ? `<span class="field-help">${escapeHtml(help)}</span>` : ''}
    </div>`;
}

/**
 * Hidupkan tombol + pratinjau. Aman dipanggil berkali-kali pada container yang
 * sama (yang sudah diaktifkan dilewati).
 *
 * @returns {() => File|null} pembaca file terpilih untuk container itu
 */
export function wirePhotoInput(root, name, { preset = null } = {}) {
  pasangGaya();
  const wrap = root.querySelector(`.photo-input[data-photo="${CSS.escape(name)}"]`);
  if (!wrap) return () => null;

  const kamera = wrap.querySelector('[data-role="camera"]');
  const galeri = wrap.querySelector('[data-role="gallery"]');
  const preview = wrap.querySelector('.photo-preview');
  const gambar = preview.querySelector('img');
  const teks = preview.querySelector('.photo-preview-name');
  const btnClear = wrap.querySelector('[data-act="clear"]');

  let objectUrl = null;
  let terpilih = null;

  function tampilkan(file) {
    terpilih = file ?? null;
    // Lepas URL lama supaya blob-nya tidak menumpuk di memori — form ini bisa
    // dibuka-tutup berkali-kali dalam satu sesi.
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;

    if (!file) {
      btnClear.hidden = true;
      gambar.removeAttribute('src');
      preview.hidden = true;
      return;
    }
    objectUrl = URL.createObjectURL(file);
    gambar.src = objectUrl;
    teks.textContent = `${file.name || 'foto.jpg'} · ${(file.size / 1024).toFixed(0)} KB`;
    preview.hidden = false;
    btnClear.hidden = false;
  }

  wrap.querySelector('[data-act="camera"]').addEventListener('click', () => kamera.click());
  wrap.querySelector('[data-act="gallery"]').addEventListener('click', () => galeri.click());
  btnClear.addEventListener('click', () => {
    kamera.value = '';
    galeri.value = '';
    tampilkan(null);
  });

  /**
   * Kecilkan lalu tampilkan.
   *
   * `urutan` menjaga hasil yang datang terlambat tidak menimpa pilihan yang
   * lebih baru. Kompresi butuh ratusan milidetik; kalau orangnya memotret
   * ulang sebelum yang pertama selesai, tanpa penjaga ini foto LAMA yang
   * akhirnya tersimpan — dan yang terlihat di pratinjau justru yang baru.
   * Bukti yang salah, tanpa satu pun tanda di layar.
   */
  let urutan = 0;

  async function pilih(file) {
    const ke = ++urutan;
    if (!file) {
      tampilkan(null);
      return;
    }

    // Ditandai "menyiapkan" supaya Kirim yang ditekan cepat tidak mengambil
    // `terpilih` yang masih kosong dan melapor "belum ada fotonya".
    if (preset) {
      terpilih = null;
      teks.textContent = 'Menyiapkan foto…';
      preview.hidden = false;
      gambar.removeAttribute('src');
    }

    // DEFAULTNYA TIDAK MENGECILKAN, dan itu disengaja.
    //
    // Modul lain sudah mengecilkan sendiri di service-nya dengan preset yang
    // sesuai isinya — nota kas 1280px supaya tulisannya terbaca, avatar 512px,
    // selfie presensi 1280px. Mengecilkan di sini secara default berarti
    // mengompres dua kali dengan ukuran yang salah, dan yang turun mutunya
    // justru foto nota yang harus bisa dibaca angkanya.
    //
    // `leave` bahkan menerima PDF lewat jalur ini.
    const kecil = preset ? await compressImage(file, { preset }) : file;
    if (ke !== urutan) return; // sudah ada pilihan yang lebih baru
    if (preset) sudahDikecilkan.add(kecil);
    tampilkan(kecil);
  }

  // Memilih dari satu sumber membatalkan pilihan sumber lain, supaya tidak
  // pernah ada dua file terpilih sekaligus dan yang terkirim jadi ambigu.
  kamera.addEventListener('change', () => {
    if (kamera.files[0]) galeri.value = '';
    pilih(kamera.files[0] ?? null);
  });
  galeri.addEventListener('change', () => {
    if (galeri.files[0]) kamera.value = '';
    pilih(galeri.files[0] ?? null);
  });

  return () => terpilih;
}
