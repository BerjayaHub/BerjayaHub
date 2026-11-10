/**
 * Tab REKAP WASTE / SPOIL di Admin Portal.
 *
 *   "di sisi admin portal sediakan rekap spoil waste berdasarkan rentang
 *    tanggal, tampilkan tabel di UI dan sediakan export excel beserta foto yang
 *    sudah terkompress dan di embed ke kolom excel nya"
 *
 * Satu baris per BAHAN, bukan per kejadian — itu satuan yang sama dengan cara
 * stoknya berkurang, dan satu-satunya bentuk yang bisa dipivot. Kolom
 * Keterangan yang memisahkan artinya: "Bahan mentah" untuk spoil, "Waste menu
 * X × n" untuk bahan yang ikut terbuang bersama menunya.
 *
 * Fotonya disisipkan KE DALAM sel Excel lewat `core/xlsx-foto.js`. Tautan tidak
 * cukup: berkas ini dikirim lewat WhatsApp dan dibuka orang yang tidak login,
 * dan tautan bertanda tangan yang kedaluwarsa dalam sejam akan membuat seluruh
 * kolom buktinya kosong tepat saat dibaca.
 */

import { toast, infoDialog, formDialog, confirmDialog } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { monthRangeWIB } from '../../core/dates.js';
import { imageToDataUrl } from '../../core/pdf.js';
import { exportTableXLSXFoto } from '../../core/xlsx-foto.js';
import { listProducts, listRecipesFull, computeCosts } from '../product/product.service.js';
import { susunRekapWaste, KOLOM_FOTO, KOLOM_PURPOSE, PURPOSE_KOSONG } from './laporan-waste.js';
import {
  rekapWaste,
  getBiayaRataBu,
  urlFotoWaste,
  urlFotoWasteBanyak,
  ubahPurposeWaste,
  revisiWaste,
  batalkanWaste,
  pulihkanWaste,
  daftarWasteDibatalkan
} from './waste.service.js';
import { listEsbMaster } from './esb.service.js';
import { opsiPurpose } from './purpose-esb.js';
import { sayaAdminBu, scopeAdminSaya } from '../../core/base-scope.js';
import {
  keadaanRevisiWaste,
  barisPemegangAksi,
  sahkanRevisiWaste,
  ringkasPerubahanWaste,
  pesanSesudahRevisi,
  PESAN_SEBAB
} from './aturan-revisi-waste.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function renderWasteAdmin(container, { businessUnitId, outlets }) {
  const { from: awal, to: akhir } = monthRangeWIB();
  const state = { outletId: '', dateFrom: awal, dateTo: akhir };

  // ============ WEWENANGNYA DIPERIKSA DI LAYAR, BUKAN CUMA DI DATABASE ============
  //
  // Mengubah Purpose dijaga `is_bu_admin()` di dalam `ubah_purpose_waste`.
  // Menyandarkan diri sepenuhnya pada penjaga itu menghasilkan tombol yang
  // bisa ditekan lalu ditolak — dan penolakannya tidak berbentuk galat,
  // melainkan `0 baris berubah`. Admin outlet lalu membuka dialog, memilih
  // Purpose, menekan Simpan, dan mendapat "tidak ada yang berubah" tanpa
  // pernah tahu bahwa ia memang tidak berhak.
  //
  // Gagal memeriksa = DIANGGAP TIDAK BERWENANG. Arah yang sebaliknya membuka
  // tombolnya untuk semua orang justru saat jaringannya sedang bermasalah.
  const bolehUbahPurpose = await sayaAdminBu(businessUnitId).catch(() => false);

  // ============ REVISI & PEMBATALAN (0181) ============
  //
  // Wewenangnya LEBIH LUAS daripada Purpose: admin outlet boleh membetulkan
  // waste di outletnya sendiri. Memakai `sayaAdminBu` di sini akan
  // menyembunyikan tombolnya dari orang yang database-nya justru mengizinkan.
  const scopeAdmin = await scopeAdminSaya(businessUnitId).catch(() => ({ adminBu: false, outlets: new Set() }));
  const bolehKelolaOutlet = (outletId) => scopeAdmin.adminBu || scopeAdmin.outlets.has(outletId);

  container.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Rekap Waste / Spoil</h2>
    </div>
    <p style="color:var(--color-text-muted);font-size:0.88rem;margin:0 0 12px;max-width:640px">
      Satu baris per <strong>bahan</strong> yang berkurang. Kolom <strong>Keterangan</strong> membedakan
      bahan mentah yang rusak dari bahan yang ikut terbuang bersama menunya — dua kejadian yang
      memotong stok yang sama tapi menuntut tindakan yang berbeda.
    </p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="margin:0;min-width:150px"><label>Outlet</label>
        <select id="ws-outlet"><option value="">Semua</option>${outlets
          .map((o) => `<option value="${o.id}">${esc(o.name)}</option>`)
          .join('')}</select>
      </div>
      <div class="field" style="margin:0;min-width:140px"><label>Dari</label><input type="date" id="ws-dari" value="${awal}" /></div>
      <div class="field" style="margin:0;min-width:140px"><label>Sampai</label><input type="date" id="ws-sampai" value="${akhir}" /></div>
      <button id="ws-tampil">Tampilkan</button>
      <button id="ws-ekspor" class="primary">⬇ Export Excel (dengan foto)</button>
    </div>
    <div id="ws-hasil"></div>
  `;

  const hasil = container.querySelector('#ws-hasil');

  // Laporan yang SEDANG TERLIHAT. Tombol ekspor memakai persis ini — bukan
  // membaca ulang kotak tanggalnya, yang bisa sudah diubah tanpa menekan
  // "Tampilkan". Berkas yang isinya berbeda dari tabel di layarnya adalah
  // kegagalan yang tidak akan pernah dicurigai.
  let lapTampil = null;
  // Baris mana yang memegang tombol aksi. Satu kejadian waste menu melahirkan
  // beberapa baris bahan; tombol di tiap baris akan membuat admin mengira
  // sedang merevisi "baris gula" padahal yang direvisi seluruh kejadiannya.
  let pemegangAksi = new Set();

  // DUA SUMBER NILAI, dan keduanya memang perlu.
  //
  // `biaya_rata_bahan` (0118) diisi dari harga di nota supplier — ia hanya ada
  // untuk barang yang pernah DIBELI. Barang setengah jadi tidak pernah dibeli;
  // "Danish Cinnamon (WIP)" punya HPP Rp6.764/porsi dari resepnya dan nol baris
  // biaya rata-rata. Versi pertama layar ini cuma melihat sumber pertama, jadi
  // seluruh barang produksi berbunyi "-" sementara Master Produk menampilkan
  // angkanya dengan jelas — dan itulah yang dilaporkan.
  let biaya = new Map();
  let hpp = new Map();
  // KEGAGALANNYA DIKATAKAN, tidak ditelan.
  //
  // Bentuk pertamanya `catch {}` kosong: kalau pengambilan biayanya gagal,
  // SELURUH kolom Nilai berbunyi "-" dan tidak ada apa pun yang membedakannya
  // dari "memang belum ada harganya". Admin lalu mencari sebabnya di tempat
  // yang salah — persis yang baru saja terjadi.
  const sumberGagal = [];
  try {
    biaya = await getBiayaRataBu(businessUnitId);
  } catch (e) {
    sumberGagal.push(`biaya rata-rata nota (${e.message ?? e})`);
  }
  // Daftar produk dipakai DUA kali: menghitung HPP, dan mengisi pilihan item
  // di dialog revisi. Diambil sekali supaya keduanya pasti melihat daftar yang
  // sama — dua pengambilan terpisah bisa berbeda kalau ada yang menambah
  // produk di tengahnya, dan bedanya cuma terasa saat dialognya kosong.
  let produkBahan = [];
  let produkMenu = [];
  try {
    const [products, recipes] = await Promise.all([listProducts(businessUnitId), listRecipesFull(businessUnitId)]);
    hpp = computeCosts(products, recipes);
    // Pembagiannya SAMA PERSIS dengan form waste di Staff App
    // (`inventory.page.js`): bahan = selain `finished`, menu = `finished`.
    // Dua aturan yang menyimpang akan membuat admin bisa memilih item yang
    // staffnya tidak akan pernah bisa pilih — dan `revisi_waste` tetap
    // menerimanya, karena database tidak tahu soal tipe produk.
    produkBahan = (products ?? []).filter((x) => x.is_active !== false && x.product_type !== 'finished');
    produkMenu = (products ?? []).filter((x) => x.is_active !== false && x.product_type === 'finished');
  } catch (e) {
    sumberGagal.push(`HPP resep (${e.message ?? e})`);
  }
  if (sumberGagal.length) {
    toast(`Kolom Nilai tidak lengkap — gagal memuat ${sumberGagal.join(' & ')}.`, 'warning');
  }

  // Daftar Purpose ESB (0147). Gagal dimuat berarti tombol Edit tidak
  // ditawarkan — dan alasannya dikatakan, bukan dibiarkan jadi kolom yang
  // "tidak bisa diklik" tanpa sebab. Tanpa daftar induknya, dialog isinya akan
  // jadi kotak ketik bebas, dan nama yang diketik sendiri ditolak ESB.
  let purposeOptions = [];
  let purposeGagal = '';
  try {
    purposeOptions = opsiPurpose(await listEsbMaster(businessUnitId, 'purpose'));
  } catch (e) {
    purposeGagal = String(e?.message ?? e);
  }

  async function muat() {
    hasil.innerHTML = loadingHtml('Memuat rekap waste…', { baris: 4 });
    let baris = [];
    try {
      baris = await rekapWaste(businessUnitId, state);
    } catch (e) {
      const pesan = String(e?.message ?? e);
      // `waste_rekap` belum ada berarti 0135 belum dijalankan. Pesan
      // "relation does not exist" tidak memberi tahu admin apa yang harus
      // dilakukannya — bug yang sama persis pernah terjadi pada 0122.
      hasil.innerHTML = `<p class="error-text">${esc(
        /waste_rekap/.test(pesan)
          ? 'Migration 0135 & 0136 belum dijalankan di Supabase, jadi rekap waste belum tersedia.'
          : pesan
      )}</p>`;
      lapTampil = null;
      return;
    }

    const namaOutlet = state.outletId ? outlets.find((o) => o.id === state.outletId)?.name ?? '' : 'Semua outlet';
    const lap = susunRekapWaste({
      baris,
      biaya,
      hpp,
      periode: { dari: state.dateFrom, sampai: state.dateTo, outlet: namaOutlet }
    });
    lapTampil = lap;
    pemegangAksi = barisPemegangAksi(lap.meta);

    if (!lap.baris.length) {
      hasil.innerHTML = `<p style="color:var(--color-text-muted);font-size:0.88rem">Tidak ada waste/spoil pada rentang ini.</p>`;
      // Daftar yang dibatalkan TETAP ditampilkan. Rentang yang seluruh
      // kejadiannya dibatalkan akan tampak seperti rentang yang memang tidak
      // punya waste — dan yang mencari kejadian yang baru saja dibatalkannya
      // tidak akan menemukannya di mana pun.
      await muatDibatalkan();
      return;
    }

    hasil.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 6px">${esc(lap.subjudul)}</p>
      <div class="table-scroll"><table class="data-table kartu-sempit">
        <thead><tr>${lap.kolom.map((k) => `<th>${esc(k.header)}</th>`).join('')}<th>Aksi</th></tr></thead>
        <tbody>
          ${lap.baris
            .map(
              (r, i) => `<tr>${r
                .map((sel, j) =>
                  j === KOLOM_PURPOSE
                    ? `<td data-label="Purpose">${selPurpose(lap.meta[i], sel)}</td>`
                    : j === KOLOM_FOTO
                    ? `<td data-label="Foto">${
                        lap.meta[i]?.photoPath
                          ? `<button class="ws-foto" data-path="${esc(lap.meta[i].photoPath)}">Lihat</button>`
                          : lap.meta[i]?.lama
                            ? // DIBEDAKAN DARI "belum ada", dan itu bukan kerapian.
                              // "belum ada foto" menuduh staffnya lupa memfoto;
                              // catatan ini memang dibuat sebelum fotonya
                              // diwajibkan, jadi fotonya tidak pernah ada.
                              '<span style="color:var(--color-text-muted);font-size:0.76rem">sebelum foto diwajibkan</span>'
                            : '<span style="color:var(--color-danger);font-size:0.8rem">belum ada</span>'
                      }</td>`
                    : `<td data-label="${esc(lap.kolom[j]?.header ?? '')}">${esc(sel)}</td>`
                )
                .join('')}<td data-label="Aksi">${selAksi(lap.meta[i], i)}</td></tr>`
            )
            .join('')}
        </tbody>
      </table></div>`;

    hasil.querySelectorAll('.ws-foto').forEach((b) =>
      b.addEventListener('click', async () => {
        const url = await urlFotoWaste(b.dataset.path);
        if (!url) return toast('Foto tidak bisa dibuka.', 'error');
        await infoDialog({
          title: 'Foto Waste / Spoil',
          bodyHtml: `<img src="${url}" alt="Foto waste" style="max-width:100%;border-radius:8px" />`
        });
      })
    );

    hasil.querySelectorAll('.ws-purpose:not([disabled])').forEach((b) =>
      b.addEventListener('click', sekaliJalan(() => isiPurpose(b.dataset.waste, b.dataset.kini ?? '')))
    );

    hasil.querySelectorAll('.ws-revisi:not([disabled])').forEach((b) =>
      b.addEventListener('click', sekaliJalan(() => bukaRevisi(Number(b.dataset.i))))
    );
    hasil.querySelectorAll('.ws-batal:not([disabled])').forEach((b) =>
      b.addEventListener('click', sekaliJalan(() => bukaBatal(Number(b.dataset.i))))
    );

    await muatDibatalkan();
  }

  /**
   * Sel kolom Purpose: tombol kalau masih bisa diubah, tulisan kalau tidak.
   *
   * Tiga keadaan yang sengaja dibedakan — ketiganya "tidak ada tombol", dan
   * menyamakannya membuat admin menunggu sesuatu yang tidak akan datang:
   *
   *   baris lama    -> tidak punya `waste_runs` sama sekali. Tidak akan pernah
   *                    bisa diekspor, jadi Purpose-nya memang tidak berlaku.
   *   terkunci      -> sudah diekspor. Bisa dibuka lagi, dan caranya disebut.
   *   daftar gagal  -> daftar induknya tidak terbaca. Masalahnya di tempat lain.
   */
  function selPurpose(meta, teksSel) {
    if (!meta?.wasteId || meta.lama) {
      return '<span style="color:var(--color-text-muted);font-size:0.78rem" title="Dicatat sebelum dokumen waste ada — tidak bisa diekspor ke ESB">tidak berlaku</span>';
    }
    if (meta.terkunci) {
      return `${esc(meta.purpose || PURPOSE_KOSONG)}<br><span style="font-size:0.74rem;color:var(--color-text-muted)">terkunci — sudah diekspor ke ESB</span>`;
    }
    if (!purposeOptions.length) {
      return `${esc(teksSel)}<br><span style="font-size:0.74rem;color:var(--color-text-muted)">${
        purposeGagal ? 'daftar Purpose gagal dimuat' : 'impor Master Purpose dulu di Ekspor ESB'
      }</span>`;
    }
    const kosong = !meta.purpose;
    const isi = kosong ? `<span class="nota-telat">${esc(PURPOSE_KOSONG)}</span> — isi` : esc(meta.purpose);

    // Tombol yang tidak boleh ditekan TETAP DIGAMBAR, mati, dengan sebabnya di
    // `title` — sama seperti tombol koreksi kas. Menyembunyikannya membuat
    // orang mencari tombol yang ada di layar admin lain, tidak menemukannya,
    // lalu menyimpulkan halamannya rusak.
    if (!bolehUbahPurpose) {
      const sebab = 'Hanya admin BU yang boleh mengubah Purpose.';
      return `<button class="ws-purpose" disabled title="${esc(sebab)}" aria-label="${esc(sebab)}"` +
        ` style="font-size:0.78rem;padding:2px 8px">${isi}</button>`;
    }

    return (
      `<button class="ws-purpose" data-waste="${esc(meta.wasteId)}" data-kini="${esc(meta.purpose)}"` +
      ` style="font-size:0.78rem;padding:2px 8px">${isi}</button>`
    );
  }


  /**
   * Sel kolom Aksi.
   *
   * Tombolnya cuma digambar di baris PERTAMA tiap kejadian; baris sisanya
   * menyebut dirinya bagian dari kejadian yang sama. Tombol kedua yang
   * mengerjakan hal yang persis sama adalah cara tercepat membuat orang
   * mengira keduanya berbeda.
   *
   * Yang tidak boleh ditekan TETAP DIGAMBAR, mati, dengan sebabnya di `title`
   * — sama seperti tombol Purpose di sebelahnya. Menyembunyikannya membuat
   * orang mencari tombol yang ada di layar admin lain lalu menyimpulkan
   * halamannya rusak.
   */
  function selAksi(meta, i) {
    if (!pemegangAksi.has(i)) {
      return meta?.wasteId && !meta?.lama
        ? '<span style="color:var(--color-text-muted);font-size:0.72rem">bagian kejadian di atas</span>'
        : '';
    }
    const keadaan = keadaanRevisiWaste(meta, { bolehKelola: bolehKelolaOutlet(meta?.outletId) });
    if (!keadaan.boleh) {
      const sebab = PESAN_SEBAB[keadaan.sebab] ?? 'Tidak bisa direvisi.';
      return `<button class="ws-revisi" disabled title="${esc(sebab)}" aria-label="${esc(sebab)}" style="font-size:0.76rem;padding:2px 8px">Revisi</button>`;
    }
    // `sumberId` kosong berarti 0181 belum dijalankan: viewnya belum memuat
    // kolom itu, jadi dialognya tidak punya item untuk ditawarkan dan
    // fungsinya belum ada di database. Tombol yang pasti gagal lebih buruk
    // daripada tombol yang menjelaskan.
    if (!meta?.sumberId) {
      const sebab = 'Migration 0181 belum dijalankan di Supabase, jadi revisi waste belum tersedia.';
      return `<button class="ws-revisi" disabled title="${esc(sebab)}" aria-label="${esc(sebab)}" style="font-size:0.76rem;padding:2px 8px">Revisi</button>`;
    }
    const tanda = meta.revisiKe > 0 ? `<div style="font-size:0.68rem;color:var(--color-text-muted)">revisi ke-${meta.revisiKe}</div>` : '';
    return (
      `<div style="display:flex;gap:4px;flex-wrap:wrap">` +
      `<button class="ws-revisi" data-i="${i}" style="font-size:0.76rem;padding:2px 8px">Revisi</button>` +
      `<button class="ws-batal btn-danger" data-i="${i}" style="font-size:0.76rem;padding:2px 8px">Batalkan</button>` +
      `</div>${tanda}`
    );
  }

  /**
   * Dialog revisi satu kejadian.
   *
   * Isinya diisi dari keadaan SEKARANG (`meta`), bukan kosong: yang dibetulkan
   * biasanya satu hal saja, dan form kosong memaksa admin mengetik ulang
   * semuanya — termasuk yang sudah benar, yang karena itu bisa ikut salah.
   */
  async function bukaRevisi(i) {
    const meta = lapTampil?.meta?.[i];
    if (!meta?.wasteId) return;

    const menu = meta.jenis === 'menu';
    const opsi = (menu ? produkMenu : produkBahan).map((x) => ({ value: x.id, label: `${x.name} (${x.base_unit})` }));
    if (!opsi.length) {
      return toast(menu ? 'Belum ada produk bertipe Menu.' : 'Daftar bahan belum termuat.', 'warning');
    }
    // Jenis TIDAK bisa diubah — ia menentukan arti `product_id` (bahan yang
    // rusak vs menu yang terbuang). Disebutkan supaya admin tidak mencari
    // pilihannya.
    const serumpun = lapTampil.meta.filter((m) => m.wasteId === meta.wasteId).length;

    const v = await formDialog({
      title: `Revisi waste ${meta.kode || ''}`.trim(),
      description:
        (menu ? 'Waste MENU — bahan resepnya dihitung ulang seluruhnya. ' : 'Spoil BAHAN. ') +
        (serumpun > 1 ? `Kejadian ini punya ${serumpun} baris bahan; semuanya ikut dihitung ulang. ` : '') +
        'Jenis & foto tidak bisa diubah — kalau itu yang salah, batalkan kejadiannya lalu minta staff mencatat ulang.',
      fields: [
        {
          name: 'product',
          label: menu ? 'Menu yang terbuang' : 'Bahan yang rusak',
          type: 'searchselect',
          required: true,
          value: meta.sumberId,
          options: opsi
        },
        { name: 'qty', label: 'Jumlah', type: 'number', required: true, step: 'any', value: String(meta.qtyKejadian ?? '') },
        { name: 'notes', label: 'Catatan', type: 'text', value: meta.catatan ?? '' },
        { name: 'alasan', label: 'Alasan revisi (wajib)', type: 'text', required: true, placeholder: 'mis. staff salah ketik 2000, aslinya 200' }
      ],
      submitText: 'Simpan revisi'
    });
    if (!v) return;

    const sah = sahkanRevisiWaste({ productId: v.product, qty: v.qty, alasan: v.alasan });
    if (!sah.ok) return toast(sah.pesan, 'warning');

    const namaBaru = (menu ? produkMenu : produkBahan).find((x) => x.id === v.product)?.name ?? '';
    const perubahan = ringkasPerubahanWaste(
      { namaItem: meta.sumberNama, qty: meta.qtyKejadian, notes: meta.catatan },
      { namaItem: namaBaru, qty: Number(v.qty), notes: v.notes }
    );
    // Revisi yang tidak mengubah apa pun tetap akan menaikkan `revisi_ke` dan
    // menulis satu baris jejak yang isinya sama di kedua sisi — jejak yang
    // tidak menjawab apa pun, dan yang membacanya mengira ada yang berubah.
    if (!perubahan.length) return toast('Tidak ada yang berubah.', 'warning');

    const keadaan = keadaanRevisiWaste(meta, { bolehKelola: true });
    const ok = await confirmDialog({
      title: 'Simpan revisi?',
      messageHtml:
        `<p style="margin:0 0 6px">Stok akan dihitung ulang:</p>` +
        `<ul style="margin:0 0 8px;padding-left:18px">${perubahan.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` +
        (keadaan.peringatan ? `<p class="error-text" style="margin:0">${esc(keadaan.peringatan)}</p>` : ''),
      confirmText: 'Ya, simpan',
      danger: true
    });
    if (!ok) return;

    try {
      const hasil = await revisiWaste({
        wasteId: meta.wasteId,
        productId: v.product,
        qty: Number(v.qty),
        notes: v.notes ?? null,
        alasan: v.alasan
      });
      toast(pesanSesudahRevisi(hasil), 'success');
    } catch (e) {
      toast(e.message ?? 'Gagal menyimpan revisi.', 'error');
      return;
    }
    await muat();
  }

  /** Batalkan satu kejadian: stoknya kembali, barisnya tetap ada berjejak. */
  async function bukaBatal(i) {
    const meta = lapTampil?.meta?.[i];
    if (!meta?.wasteId) return;
    const keadaan = keadaanRevisiWaste(meta, { bolehKelola: bolehKelolaOutlet(meta.outletId) });
    if (!keadaan.boleh) return toast(PESAN_SEBAB[keadaan.sebab] ?? 'Tidak bisa dibatalkan.', 'warning');

    const v = await formDialog({
      title: `Batalkan waste ${meta.kode || ''}`.trim(),
      description:
        `${meta.sumberNama} ${meta.qtyKejadian} — stok yang dulu terpotong akan DIKEMBALIKAN. ` +
        'Barisnya tidak hilang: ia pindah ke daftar "Dibatalkan" di bawah tabel, dan bisa dipulihkan lagi.' +
        (keadaan.peringatan ? ` ${keadaan.peringatan}` : ''),
      fields: [{ name: 'alasan', label: 'Alasan pembatalan (wajib)', type: 'text', required: true }],
      submitText: 'Batalkan kejadian',
      danger: true
    });
    if (!v?.alasan?.trim()) return;

    try {
      const hasil = await batalkanWaste({ wasteId: meta.wasteId, alasan: v.alasan });
      toast(`${hasil.kode ?? 'Kejadian'} dibatalkan — stoknya sudah dikembalikan.`, 'success');
    } catch (e) {
      toast(e.message ?? 'Gagal membatalkan.', 'error');
      return;
    }
    await muat();
  }

  /**
   * Daftar kejadian yang DIBATALKAN pada rentang yang sama.
   *
   * Tanpa ini, "dibatalkan tapi tetap berjejak" cuma berlaku bagi yang bisa
   * membuka SQL editor — dan admin yang salah membatalkan tidak punya cara
   * menemukan barisnya kembali untuk dipulihkan.
   */
  async function muatDibatalkan() {
    let baris = [];
    try {
      baris = await daftarWasteDibatalkan(businessUnitId, state);
    } catch {
      // 0181 belum dijalankan, atau fungsinya tidak bisa dipanggil. Diam di
      // sini disengaja: tabel utamanya sudah tampil, dan menumpuk galat kedua
      // di bawahnya tidak menolong siapa pun.
      return;
    }
    if (!baris.length) return;

    const html = `
      <details style="margin-top:14px">
        <summary style="cursor:pointer;font-size:0.86rem"><strong>${baris.length}</strong> kejadian dibatalkan pada rentang ini</summary>
        <div class="table-scroll" style="margin-top:8px"><table class="data-table kartu-sempit">
          <thead><tr><th>Kode</th><th>Tanggal</th><th>Outlet</th><th>Item</th><th>Jumlah</th><th>Alasan</th><th>Dibatalkan oleh</th><th>Aksi</th></tr></thead>
          <tbody>${baris
            .map(
              (b) => `<tr>
                <td data-label="Kode">${esc(b.code ?? '-')}</td>
                <td data-label="Tanggal">${esc(b.tanggal ?? '')}</td>
                <td data-label="Outlet">${esc(b.outlet_nama ?? '')}</td>
                <td data-label="Item">${esc(b.sumber_nama ?? '')}</td>
                <td data-label="Jumlah">${esc(String(b.qty ?? ''))}</td>
                <td data-label="Alasan">${esc(b.alasan_batal ?? '')}</td>
                <td data-label="Dibatalkan oleh">${esc(b.dibatalkan_oleh ?? '')}</td>
                <td data-label="Aksi">${
                  bolehKelolaOutlet(b.outlet_id)
                    ? `<button class="ws-pulih" data-waste="${esc(b.waste_id)}" style="font-size:0.76rem;padding:2px 8px">Pulihkan</button>`
                    : ''
                }</td>
              </tr>`
            )
            .join('')}</tbody>
        </table></div>
      </details>`;
    hasil.insertAdjacentHTML('beforeend', html);

    hasil.querySelectorAll('.ws-pulih').forEach((b) =>
      b.addEventListener('click', sekaliJalan(() => pulihkan(b.dataset.waste)))
    );
  }

  async function pulihkan(wasteId) {
    const v = await formDialog({
      title: 'Pulihkan kejadian waste',
      description: 'Stok akan DIPOTONG lagi sebesar jumlah kejadian ini, dan barisnya kembali masuk rekap.',
      fields: [{ name: 'alasan', label: 'Alasan pemulihan (wajib)', type: 'text', required: true }],
      submitText: 'Pulihkan'
    });
    if (!v?.alasan?.trim()) return;
    try {
      const hasil = await pulihkanWaste({ wasteId, alasan: v.alasan });
      toast(`${hasil.kode ?? 'Kejadian'} dipulihkan — stoknya terpotong lagi.`, 'success');
    } catch (e) {
      toast(e.message ?? 'Gagal memulihkan.', 'error');
      return;
    }
    await muat();
  }

  /**
   * Isi/ubah Purpose satu kejadian.
   *
   * Satu waste menu melahirkan banyak baris bahan yang berbagi SATU
   * `waste_id` — jadi yang berubah kejadiannya, dan seluruh barisnya ikut.
   * Itu disebutkan di dialognya supaya tidak terlihat seperti aplikasi yang
   * mengubah lebih dari yang diminta.
   */
  async function isiPurpose(wasteId, kini) {
    const serumpun = lapTampil?.meta?.filter((m) => m.wasteId === wasteId).length ?? 1;
    const v = await formDialog({
      title: 'Purpose kejadian waste',
      description:
        'Menentukan biaya waste ini masuk ke akun COGS yang mana di ESB.' +
        (serumpun > 1 ? ` Kejadian ini punya ${serumpun} baris bahan — semuanya ikut berubah.` : ''),
      fields: [
        {
          name: 'purpose',
          label: 'Purpose (ESB)',
          type: 'select',
          required: true,
          value: kini,
          options: purposeOptions.map((o) => ({ value: o.value, label: o.hint ? `${o.label} — ${o.hint}` : o.label }))
        }
      ],
      submitText: 'Simpan'
    });
    if (!v?.purpose) return;

    try {
      const n = await ubahPurposeWaste([wasteId], v.purpose);
      // Angka dari database DIBANDINGKAN dengan yang diminta. `0` berarti
      // baris itu bukan milik BU yang dipegang, atau tandanya berubah sejak
      // halaman ini dimuat — melaporkan "berhasil" begitu saja membuat admin
      // mengira pekerjaannya selesai.
      if (n === 0) {
        toast('Tidak ada yang berubah — kejadian ini mungkin sudah diekspor atau bukan milik BU ini.', 'warning');
      } else {
        toast(`Purpose diisi "${v.purpose}".`, 'success');
      }
    } catch (e) {
      toast(e.message ?? 'Gagal menyimpan Purpose.', 'error');
      return;
    }
    await muat();
  }

  container.querySelector('#ws-tampil').addEventListener('click', () => {
    state.outletId = container.querySelector('#ws-outlet').value;
    state.dateFrom = container.querySelector('#ws-dari').value;
    state.dateTo = container.querySelector('#ws-sampai').value;
    muat();
  });

  container.querySelector('#ws-ekspor').addEventListener(
    'click',
    sekaliJalan(
      async () => {
        if (!lapTampil?.baris.length) {
          toast('Tidak ada baris untuk diekspor. Tekan Tampilkan dulu.', 'error');
          return;
        }

        // Foto diambil sebagai data URL supaya tertanam di dalam berkasnya.
        //
        // 220px cukup untuk melihat bahwa barangnya memang rusak — dan itu satu-
        // satunya pertanyaan yang dijawab foto ini. Berkas berisi 300 foto
        // beresolusi penuh tidak bisa dikirim lewat WhatsApp, dan rekap yang
        // tidak bisa dikirim tidak menolong siapa pun.
        const urlPeta = await urlFotoWasteBanyak(lapTampil.meta.map((m) => m.photoPath));
        const rows = [];
        for (let i = 0; i < lapTampil.baris.length; i++) {
          const baris = [...lapTampil.baris[i]];
          const path = lapTampil.meta[i]?.photoPath;
          if (!path) {
            // Memang tidak berfoto — hanya mungkin untuk catatan sebelum 0135.
            baris[KOLOM_FOTO] = null;
          } else {
            const url = urlPeta.get(path);
            const dataUrl = url ? await imageToDataUrl(url, 220, 0.7) : null;
            // 'GAGAL' DIBEDAKAN dari kosong, dan itu bukan kerapian: sel kosong
            // terbaca sebagai "waste ini tidak difoto", lalu staffnya ditegur
            // untuk sesuatu yang sudah ia lakukan.
            baris[KOLOM_FOTO] = dataUrl ?? 'GAGAL';
          }
          rows.push(baris);
        }

        await exportTableXLSXFoto({
          filename: lapTampil.namaBerkas,
          sheetName: 'Waste Spoil',
          title: lapTampil.judul,
          subtitle: lapTampil.subjudul,
          columns: lapTampil.kolom,
          rows
        });

        const rincianCatatan = [
          lapTampil.ringkas.dariHpp ? `${lapTampil.ringkas.dariHpp} baris dinilai pakai HPP resep` : '',
          lapTampil.ringkas.tanpaNilai ? `${lapTampil.ringkas.tanpaNilai} baris belum punya harga, nilainya "-"` : ''
        ].filter(Boolean);
        const catatan = rincianCatatan.length ? ` (${rincianCatatan.join(', ')})` : '';
        toast(
          `${lapTampil.ringkas.jumlahBaris} baris dari ${lapTampil.ringkas.jumlahKejadian} kejadian diekspor.${catatan}`,
          catatan ? 'warning' : 'success'
        );
      },
      { teks: 'Menyiapkan…' }
    )
  );

  await muat();
}
