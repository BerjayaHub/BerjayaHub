/**
 * PEMILIH BARANG ASET — kotak cari + foto + jumlah, untuk dialog Transfer.
 *
 * ============ KENAPA BUKAN DERETAN KOTAK ANGKA BIASA ============
 *
 * Bentuk lamanya: satu kotak angka untuk SETIAP barang di outlet, berurutan,
 * tanpa gambar dan tanpa pencarian. Dengan 11 barang itu masih bisa dibaca;
 * dengan 80 ia jadi gulungan panjang berisi nama yang mirip-mirip —
 * "Gelas Cocktail" dan "Gelas Coctail kaki pendek" berselang empat baris —
 * dan yang mengisinya sedang terburu-buru, berdiri di dekat barangnya.
 *
 * Salah ketik satu baris di sini tidak menghasilkan galat apa pun. Ia
 * menghasilkan barang yang BERPINDAH, tanpa penerima yang menghitung ulang
 * dan menolak.
 *
 * Jadi tiga hal ditambahkan, dan ketiganya untuk sebab yang sama:
 *
 *   foto     -> barangnya dikenali dari rupanya, bukan dari nama yang mirip
 *   cari     -> satu kotak untuk nama/kode/kategori/catatan, karena yang
 *               mencari tidak tahu lebih dulu kata itu ada di bagian mana
 *   dipilih  -> jumlah jenis & unit selalu terlihat, dan baris yang sudah
 *               diisi TIDAK PERNAH tersaring keluar
 */
import { escapeHtml as esc } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { kalimatTerpilih, ringkasTerpilih, saringBarang } from './cari-barang-aset.js';

/**
 * @param {HTMLElement} wadah titik tanam
 * @param {object} opsi
 * @param {Array} opsi.daftar barang: { itemId, kode, name, category, notes, batas, photo_path, photo_acuan, outletAcuan }
 * @param {Map<string, number>} [opsi.awal] jumlah yang sudah terisi (revisi)
 * @param {Map<string, string>} [opsi.fotoUrl] path -> signed URL
 * @param {(path: string) => void} [opsi.onFoto] dipanggil saat foto diketuk
 * @returns {{ getItems: () => Array<{itemId:string, qty:number}>, ringkas: () => {jenis:number,unit:number} }}
 */
export function createAssetPicker(wadah, { daftar = [], awal = null, fotoUrl = new Map(), onFoto } = {}) {
  // ============ JUMLAHNYA HIDUP DI SINI, BUKAN DI DOM ============
  //
  // Daftarnya digambar ulang setiap kali kata pencariannya berubah, dan kotak
  // yang hidup di DOM ikut hilang bersamanya. Kalau nilainya cuma ada di
  // kotak, mencari "botol" sesudah mengisi "gelas" akan menghapus angka gelas
  // tanpa satu pun tanda — pola kegagalan yang sama persis dengan centang
  // yang terlepas saat saringan berganti di layar pemindahan aset.
  const pilihan = new Map();
  for (const [id, q] of awal instanceof Map ? awal : []) {
    if (Number(q) > 0) pilihan.set(String(id), Number(q));
  }

  let cari = '';

  wadah.innerHTML = `
    <input class="ap-cari" type="search" placeholder="cari nama, kode, kategori, atau catatan…"
           style="width:100%;margin-bottom:6px" />
    <p class="ap-ringkas" style="margin:0 0 6px;font-size:0.8rem;color:var(--color-text-muted)"></p>
    <div class="ap-list" style="max-height:46vh;overflow:auto;border:1px solid var(--color-border,#e3e3e3);border-radius:8px"></div>
  `;

  const elCari = wadah.querySelector('.ap-cari');
  const elRingkas = wadah.querySelector('.ap-ringkas');
  const elList = wadah.querySelector('.ap-list');

  const baris = (a) => {
    const dipilih = pilihan.get(String(a.itemId)) ?? '';
    const path = a.photo_path || a.photo_acuan || '';
    const acuan = !a.photo_path && a.photo_acuan;
    const url = path ? fotoUrl.get(path) : null;

    // ============ FOTO ACUAN TETAP DITANDAI ============
    //
    // Sama seperti di layar utama: foto dari outlet lain membantu mengenali
    // barangnya, tapi ia memotret barang di gudang lain. Menyamarkannya
    // sebagai milik sendiri membuat orang memakainya sebagai bukti kondisi
    // barang di sini.
    const judulFoto = acuan ? `Foto acuan dari ${a.outletAcuan || 'outlet lain'} — bukan foto barang di outlet ini` : '';
    const foto = !path
      ? `<div style="width:60px;height:60px;border-radius:8px;background:var(--color-bg-alt,#f2f2f2);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:0.65rem;flex:none">tanpa<br>foto</div>`
      : url
        ? `<img src="${esc(url)}" alt="" loading="lazy" class="ap-foto" data-path="${esc(path)}" title="${esc(judulFoto)}"
               style="width:60px;height:60px;object-fit:cover;border-radius:8px;background:#eee;cursor:zoom-in;flex:none;border:1px solid ${
                 acuan ? 'var(--color-text-muted)' : 'var(--color-border,#e3e3e3)'
               }${acuan ? ';border-style:dashed;opacity:.8' : ''}" />`
        : `<button type="button" class="ap-foto" data-path="${esc(path)}" title="${esc(judulFoto)}"
                   style="width:60px;height:60px;flex:none;font-size:0.7rem">Lihat</button>`;

    const ket = [a.category, a.notes].map((v) => String(v ?? '').trim()).filter(Boolean).join(' · ');

    return `<div class="ap-baris" style="display:flex;gap:10px;align-items:center;padding:8px;border-bottom:1px solid var(--color-border,#eee)">
      ${foto}
      <div style="flex:1;min-width:0">
        <div style="font-size:0.85rem;line-height:1.25"><strong>${esc(a.name ?? '-')}</strong></div>
        <div style="font-size:0.72rem;color:var(--color-text-muted);line-height:1.25">
          <span style="font-family:monospace">${esc(a.kode ?? '-')}</span>${ket ? ` · ${esc(ket)}` : ''}
        </div>
        <div style="font-size:0.72rem;color:var(--color-text-muted)">ada ${formatNum(a.batas)}${
          acuan ? ' · <em>foto outlet lain</em>' : ''
        }</div>
      </div>
      <input class="ap-qty" type="number" inputmode="numeric" min="0" max="${esc(a.batas)}" step="1"
             data-id="${esc(a.itemId)}" value="${esc(dipilih)}" placeholder="0"
             style="width:76px;flex:none;text-align:right" />
    </div>`;
  };

  function gambar() {
    const terpilih = new Set([...pilihan.keys()]);
    const tampil = saringBarang(daftar, cari, terpilih);

    elRingkas.textContent = kalimatTerpilih(pilihan);
    elList.innerHTML = tampil.length
      ? tampil.map(baris).join('')
      : `<p style="margin:0;padding:14px;color:var(--color-text-muted);font-size:0.85rem">Tidak ada barang yang cocok dengan "${esc(
          cari
        )}".</p>`;

    elList.querySelectorAll('.ap-qty').forEach((el) =>
      el.addEventListener('input', () => {
        const id = String(el.dataset.id);
        const n = Number(el.value);
        // Angka yang tidak sah DIBUANG dari pilihan, bukan disimpan sebagai 0:
        // "0" dan "belum diisi" sama-sama berarti tidak ikut, dan menyimpan
        // nol membuat ringkasan "3 jenis" untuk dua barang.
        if (Number.isFinite(n) && n > 0) pilihan.set(id, n);
        else pilihan.delete(id);
        elRingkas.textContent = kalimatTerpilih(pilihan);
      })
    );

    if (typeof onFoto === 'function') {
      elList.querySelectorAll('.ap-foto').forEach((el) => el.addEventListener('click', () => onFoto(el.dataset.path)));
    }
  }

  let tunda;
  elCari.addEventListener('input', () => {
    clearTimeout(tunda);
    // Digambar ulang sesudah ketikannya berhenti sejenak. Menggambar ulang
    // pada tiap huruf membuat kotak jumlah yang sedang diisi kehilangan fokus
    // di tengah pengetikan.
    tunda = setTimeout(() => {
      cari = elCari.value;
      gambar();
    }, 160);
  });

  gambar();

  return {
    getItems: () =>
      [...pilihan.entries()]
        .map(([itemId, qty]) => ({ itemId, qty: Number(qty) }))
        .filter((i) => i.qty > 0),
    ringkas: () => ringkasTerpilih(pilihan)
  };
}
