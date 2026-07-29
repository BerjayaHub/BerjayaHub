// Escape lokal, TIDAK diimpor dari ui.js. Kalau diimpor, terbentuk lingkaran
// (ui.js -> photo-input.js -> ui.js). ES module memang bisa menanganinya karena
// function declaration terangkat, tapi lingkaran impor itu jenis ketergantungan
// yang gampang pecah begitu ada yang mengubah salah satu file jadi const arrow.
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
export function wirePhotoInput(root, name) {
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

  // Memilih dari satu sumber membatalkan pilihan sumber lain, supaya tidak
  // pernah ada dua file terpilih sekaligus dan yang terkirim jadi ambigu.
  kamera.addEventListener('change', () => {
    if (kamera.files[0]) galeri.value = '';
    tampilkan(kamera.files[0] ?? null);
  });
  galeri.addEventListener('change', () => {
    if (galeri.files[0]) kamera.value = '';
    tampilkan(galeri.files[0] ?? null);
  });

  return () => terpilih;
}
