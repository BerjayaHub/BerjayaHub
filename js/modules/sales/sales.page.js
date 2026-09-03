import { toast, shareDialog, confirmDialog, formDialog } from '../../core/ui.js';
import { formatNum, formatRupiah } from '../../core/format.js';
import { listProducts } from '../product/product.service.js';
import { listMenuAktifOutlet } from '../menu/menu-outlet.service.js';
import {
  recordSales,
  getSalesSummary,
  listSalesHariIni,
  ubahPenjualan,
  hapusPenjualan,
  todayWIB,
  buatRefKiriman
} from './sales.service.js';
import { listHargaAktif } from '../menu/harga-outlet.service.js';
import { listMyOutlets } from '../../core/my-outlets.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { saringMenu, ringkasIsian, isianTerkirim } from './saring-menu.js';

export async function renderSalesPage(container, { businessUnitId, outletId }) {
  container.innerHTML = loadingHtml('Memuat penjualan…');
  const date = todayWIB();

  let allOutlets, products;
  try {
    [allOutlets, products] = await Promise.all([
      listMyOutlets(businessUnitId),
      listProducts(businessUnitId)
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }
  // allOutlets sudah hasil listMyOutlets() -> tidak perlu disaring dua kali.
  const myOutlets = allOutlets.filter((o) => o.allow_sales !== false);
  const menus = products.filter((p) => p.product_type === 'finished' && p.is_active !== false);
  if (!myOutlets.length) {
    container.innerHTML = `<h1>Penjualan</h1><p style="color:var(--color-text-muted)">Penjualan belum diaktifkan untuk outletmu. (Diatur admin di Master BU & Outlet.)</p>`;
    return;
  }
  if (!menus.length) {
    container.innerHTML = `<h1>Penjualan</h1><p style="color:var(--color-text-muted)">Belum ada menu. Minta admin mengisi di Master Produk.</p>`;
    return;
  }
  const categories = [...new Set(menus.map((m) => m.category).filter(Boolean))].sort();
  const state = {
    outletId: myOutlets.some((o) => o.id === outletId) ? outletId : myOutlets[0].id,
    category: '',
    q: '',
    summary: new Map(),
    // Baris penjualan hari ini, satu per transaksi — bahan untuk Edit & Hapus.
    baris: [],
    harga: new Map(),
    // JUMLAH YANG DIKETIK DISIMPAN DI SINI, BUKAN DI KOTAK ISIANNYA.
    //
    // Menyaring daftar menggambar ulang seluruh tabel, dan kotak isian yang
    // digambar ulang kehilangan isinya. Tanpa ingatan ini, staff yang mengetik
    // "Nasi Goreng 20" lalu mencari menu berikutnya akan kehilangan angka 20 —
    // tanpa peringatan apa pun, karena layarnya memang tidak menampilkannya lagi.
    //
    // Ini juga yang membuat SIMPAN membaca dari sini, bukan dari kotak yang
    // sedang terlihat. Sebelum ada saringan nama, berganti kategori sudah
    // menghapus isian yang sudah diketik; dengan saringan nama, kegagalan itu
    // akan terjadi berkali-kali dalam satu sesi pengisian.
    qty: new Map(),
    // Penanda kiriman. Dibuat SEKALI saat Simpan ditekan, dan DIPERTAHANKAN
    // selama percobaannya belum berhasil — supaya retry memakai penanda yang
    // sama dan tidak menghasilkan penjualan ganda. Alasan lengkapnya di 0098.
    ref: null
  };

  container.innerHTML = `
    <h1 style="margin-bottom:4px">Penjualan</h1>
    <p style="color:var(--color-text-muted);font-size:0.82rem;margin:0 0 8px">Isi jumlah terjual tiap menu hari ini (${fmtDate(date)}), lalu Simpan. Stok bahan otomatis berkurang sesuai resep, omzet tercatat.</p>

    <div class="panel-lengket-atas">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0;min-width:130px"><label>Outlet</label>
          <select id="sl-outlet">${myOutlets.map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
        </div>
        <div class="field" style="margin:0;min-width:120px"><label>Kategori</label>
          <select id="sl-cat"><option value="">Semua</option>${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
        </div>
        <div class="field" style="margin:0;flex:1;min-width:150px"><label>Cari menu</label>
          <input type="search" id="sl-q" placeholder="mis. nasi goreng" autocomplete="off" enterkeyhint="search" />
        </div>
      </div>

      <!-- TOMBOL SIMPAN DI ATAS, bukan di bawah daftar.

           Daftar menunya bisa dua ratus baris. Tombol yang hanya ada di
           bawahnya berarti staff yang mengisi lima menu di bagian atas harus
           menggulir melewati seluruh daftar untuk menyimpan — dan yang paling
           sering terjadi, ia lupa lalu pindah layar. -->
      <button class="primary" id="sl-save" style="max-width:100%;margin-top:8px">Simpan Penjualan</button>
      <div id="sl-info" style="margin-top:8px"></div>
    </div>

    <div class="table-scroll gulir-baris" style="margin-top:8px">
      <table class="data-table baris-sejajar">
        <thead><tr><th>Menu</th><th>Harga</th><th>Jumlah terjual</th></tr></thead>
        <tbody id="sl-rows"></tbody>
      </table>
    </div>

    <div class="panel-lengket-bawah" id="sl-summary"></div>
  `;

  const outletSel = container.querySelector('#sl-outlet');
  const catSel = container.querySelector('#sl-cat');
  const cariInput = container.querySelector('#sl-q');

  /**
   * Menu yang aktif di outlet yang sedang dipilih (0115).
   *
   * `null` berarti BELUM/GAGAL dimuat — dan dalam keadaan itu daftarnya
   * ditampilkan UTUH, bukan dikosongkan. Layar penjualan yang tiba-tiba kosong
   * terbaca sebagai "aplikasinya rusak", dan staff yang sedang menutup shift
   * tidak punya jalan lain. Menampilkan menu yang seharusnya tersembunyi jauh
   * lebih murah daripada menghalangi penjualan yang harus tercatat hari itu.
   */
  let menuAktif = null;

  async function loadMenuAktif() {
    try {
      menuAktif = await listMenuAktifOutlet(state.outletId);
    } catch {
      menuAktif = null;
    }
  }

  /** Menu milik outlet ini, sebelum saringan kategori & pencarian. */
  const menuOutlet = () => (menuAktif ? menus.filter((m) => menuAktif.has(m.id)) : menus);

  const menuTersaring = () => saringMenu(menuOutlet(), { kategori: state.category, q: state.q });

  /**
   * Beri tahu kalau ada isian yang sedang TERSEMBUNYI oleh saringan.
   *
   * Ini penjaga yang paling penting di layar ini. Staff yang sudah mengisi lima
   * menu lalu mencari menu keenam hanya melihat satu baris — dan tanpa
   * keterangan ini, tombol Simpan terlihat seperti hanya akan menyimpan yang
   * satu itu. Yang lebih buruk: ia bisa mengira empat isian sebelumnya hilang
   * dan mengetiknya ulang.
   */
  function renderInfo() {
    const box = container.querySelector('#sl-info');
    const { terisi, tersembunyi } = ringkasIsian(state.qty, menuTersaring(), menus);
    if (!terisi.length) {
      box.innerHTML = '';
      return;
    }

    box.innerHTML = `
      <p class="report-note" style="margin:0">
        <strong>${terisi.length} menu</strong> sudah diisi dan akan ikut tersimpan.
        ${
          tersembunyi.length
            ? `<strong>${tersembunyi.length} di antaranya sedang tidak terlihat</strong> karena saringan —
               isiannya tetap aman: ${tersembunyi.map((t) => `${esc(t.nama)} (${formatNum(t.qty)})`).join(', ')}.`
            : ''
        }
      </p>`;
  }

  function renderRows() {
    const tbody = container.querySelector('#sl-rows');
    const list = menuTersaring();
    tbody.innerHTML = list
      .map(
        (m) => `<tr>
          <td>${esc(m.name)}</td>
          <td>${
            // HARGA OUTLET, bukan `products.sale_price`.
            //
            // Sejak 0099 harga transaksi diambil dari daftar harga outlet, dan
            // menu tanpa harga outlet DITOLAK seluruh transaksinya. Kalau layar
            // ini tetap menampilkan harga acuan BU, staff akan melihat angka
            // yang wajar lalu ditolak saat menyimpan — tanpa tahu kenapa.
            state.harga.has(m.id)
              ? formatRupiah(state.harga.get(m.id))
              : '<span class="error-text" style="font-size:0.78rem">belum ada harga</span>'
          }</td>
          <td><input type="number" class="sl-qty sl-qty-input" data-id="${m.id}" min="0" placeholder="0"
            inputmode="numeric" value="${state.qty.get(m.id) ?? ''}" /></td>
        </tr>`
      )
      .join('') ||
      `<tr><td colspan="3">${
        state.q
          ? `Tidak ada menu yang cocok dengan "${esc(state.q)}"${state.category ? ' di kategori ini' : ''}.`
          : 'Tidak ada menu di kategori ini.'
      }</td></tr>`;

    renderInfo();
  }

  /** Harga aktif outlet ini hari ini: Map<productId, harga>. */
  async function loadHarga() {
    try {
      const semua = await listHargaAktif(businessUnitId, { tanggal: date });
      state.harga = new Map(semua.filter((h) => h.outlet_id === state.outletId).map((h) => [h.product_id, h.selling_price]));
    } catch {
      // Gagal memuat harga TIDAK dibiarkan diam. Tanpa harga di layar, staff
      // tetap bisa mengetik jumlah lalu ditolak saat menyimpan — dan
      // penolakannya akan terlihat seperti kerusakan aplikasi.
      state.harga = new Map();
      toast('Daftar harga outlet gagal dimuat. Angka harga di bawah mungkin tidak lengkap.', 'warning');
    }
  }

  async function loadSummary() {
    const box = container.querySelector('#sl-summary');
    try {
      state.summary = await getSalesSummary(state.outletId, date);
    } catch {
      state.summary = new Map();
    }
    // Baris per TRANSAKSI, bukan agregat per menu. Menu yang sama bisa punya
    // beberapa baris (shift pagi & malam), dan menggabungkannya membuat
    // pertanyaan "yang mana yang salah ketik?" tidak bisa dijawab.
    try {
      state.baris = await listSalesHariIni(state.outletId, date);
    } catch {
      state.baris = [];
    }

    let total = 0;
    for (const s of state.summary.values()) total += s.revenue;

    const rows = state.baris.map(
      (b) => `<tr>
        <td data-label="Menu">${esc(b.products?.name ?? '(menu terhapus)')}</td>
        <td data-label="Terjual" style="text-align:right">${formatNum(b.qty)}</td>
        <td data-label="Omzet" style="text-align:right">${formatRupiah(b.revenue)}</td>
        <td data-label="Aksi" style="white-space:nowrap">
          <button class="sl-edit" data-id="${b.id}">Edit</button>
          <button class="sl-del" data-id="${b.id}">Hapus</button>
        </td>
      </tr>`
    );

    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;max-width:560px;flex-wrap:wrap">
        <h2 style="font-size:1rem;margin:0">Rekap Penjualan Hari Ini</h2>
        ${rows.length ? '<button id="sl-share">📤 Kirim via WhatsApp</button>' : ''}
      </div>
      ${
        rows.length
          ? `<div class="table-scroll" style="max-width:560px;margin-top:8px">
               <table class="data-table table-freeze-1 kartu-sempit">
                 <thead><tr><th>Menu</th><th>Terjual</th><th>Omzet</th><th>Aksi</th></tr></thead>
                 <tbody>${rows.join('')}</tbody>
               </table>
             </div>
             <p style="font-weight:600;margin-top:8px">Total omzet: ${formatRupiah(total)}</p>
             <details style="max-width:560px">
               <summary style="cursor:pointer;font-size:0.82rem;color:var(--color-text-muted)">Tentang mengubah &amp; menghapus</summary>
               <p class="report-note" style="max-width:560px">
                 Salah input bisa dibetulkan di sini. <strong>Stok bahan ikut dikoreksi otomatis</strong> —
                 mengurangi jumlah mengembalikan bahannya, menghapus mengembalikan seluruhnya.
                 <br /><br />
                 Harga tidak ikut berubah walau daftar harga sudah diperbarui: yang dipakai tetap harga saat
                 transaksi ini dicatat, supaya omzet hari-hari sebelumnya tidak bergeser sendiri.
                 <br /><br />
                 Kamu hanya bisa membetulkan yang <strong>kamu catat sendiri hari ini</strong>. Selebihnya lewat Admin BU.
               </p>
             </details>`
          : '<p style="color:var(--color-text-muted)">Belum ada penjualan tercatat hari ini.</p>'
      }
    `;

    box.querySelectorAll('.sl-edit').forEach((b) =>
      b.addEventListener('click', () => bukaEdit(state.baris.find((x) => x.id === b.dataset.id)))
    );
    box.querySelectorAll('.sl-del').forEach((b) =>
      b.addEventListener('click', sekaliJalan(() => bukaHapus(state.baris.find((x) => x.id === b.dataset.id))))
    );

    box.querySelector('#sl-share')?.addEventListener('click', () => {
      const outletName = myOutlets.find((o) => o.id === state.outletId)?.name ?? '-';
      let qtyTotal = 0;
      const lines = menus
        .filter((m) => state.summary.has(m.id))
        .map((m) => {
          const s = state.summary.get(m.id);
          qtyTotal += s.qty;
          return `• ${m.name}: ${formatNum(s.qty)} — ${formatRupiah(s.revenue)}`;
        });
      const text = [
        `*Rekap Penjualan — ${outletName}*`,
        fmtDate(date),
        '',
        ...lines,
        '',
        `Total terjual: ${formatNum(qtyTotal)} menu`,
        `*Total omzet: ${formatRupiah(total)}*`
      ].join('\n');
      shareDialog({
        title: 'Kirim Rekap Penjualan',
        helper: 'Teks bisa diedit dulu sebelum dikirim ke WhatsApp/chat.',
        defaultMessage: text
      });
    });
  }

  /**
   * Perbaiki jumlah terjual satu baris.
   *
   * Harganya SENGAJA ditampilkan sebagai keterangan mati, bukan kotak isian:
   * yang boleh diperbaiki di sini hanya jumlahnya. Harga yang bisa diketik di
   * layar staff berarti omzet bisa diubah tanpa lewat daftar harga — dan
   * selisih antara omzet tercatat dan harga yang berlaku tidak akan pernah
   * bisa dijelaskan.
   */
  async function bukaEdit(baris) {
    if (!baris) return;
    const nama = baris.products?.name ?? '(menu terhapus)';

    const nilai = await formDialog({
      title: `Perbaiki — ${nama}`,
      fields: [
        {
          name: 'qty',
          label: 'Jumlah terjual',
          type: 'qty',
          required: true,
          value: baris.qty,
          help: `Harga tetap ${formatRupiah(baris.unit_price)}/porsi (harga saat transaksi ini dicatat). Stok bahan ikut dikoreksi.`
        }
      ],
      submitText: 'Simpan perbaikan'
    });
    if (!nilai) return;

    const qty = Number(nilai.qty);
    if (!(qty > 0)) {
      // Diarahkan ke Hapus, bukan disimpan sebagai nol. Baris beromzet nol yang
      // stoknya sudah terpotong adalah persis bentuk data yang dijaga sejak 0099.
      toast('Jumlah harus lebih dari 0. Kalau memang tidak jadi terjual, pakai tombol Hapus.', 'warning');
      return;
    }

    try {
      const hasil = await ubahPenjualan(baris.id, qty);
      // Dikatakan apa adanya kalau stoknya TIDAK ikut berubah. "Tersimpan" saja
      // akan membuat orang mengira bahannya sudah dikoreksi padahal menunya
      // memang tidak punya resep.
      toast(
        hasil?.stok_disesuaikan === false
          ? 'Jumlah diperbarui. Menu ini tidak punya resep, jadi stok bahan tidak ikut berubah.'
          : 'Jumlah diperbarui. Stok bahan ikut dikoreksi.',
        'success'
      );
      await loadSummary();
    } catch (error) {
      toast(error.message ?? 'Gagal memperbaiki penjualan.', 'error');
    }
  }

  /** Hapus satu baris penjualan. Stok bahannya dikembalikan lebih dulu. */
  async function bukaHapus(baris) {
    if (!baris) return;
    const nama = baris.products?.name ?? '(menu terhapus)';

    const ok = await confirmDialog({
      title: `Hapus penjualan ${nama}?`,
      message:
        `${formatNum(baris.qty)} porsi — ${formatRupiah(baris.revenue)}.\n\n` +
        'Stok bahan yang terpakai akan DIKEMBALIKAN, dan baris ini hilang permanen dari catatan penjualan.',
      confirmText: 'Hapus & kembalikan stok',
      danger: true
    });
    if (!ok) return;

    try {
      const hasil = await hapusPenjualan(baris.id);
      toast(
        hasil?.stok_dikembalikan === false
          ? 'Penjualan dihapus. Menu ini tidak punya resep, jadi tidak ada stok yang dikembalikan.'
          : 'Penjualan dihapus. Stok bahan dikembalikan.',
        'success'
      );
      await loadSummary();
    } catch (error) {
      toast(error.message ?? 'Gagal menghapus penjualan.', 'error');
    }
  }

  outletSel.addEventListener('change', async () => {
    // ISIAN TIDAK BOLEH IKUT BERPINDAH OUTLET DIAM-DIAM.
    //
    // Kalau dibiarkan, staff yang mengisi untuk Serpong lalu berganti ke Sentul
    // sekadar mengecek sesuatu akan menekan Simpan dengan angka Serpong yang
    // masih menempel — dan penjualannya tercatat di outlet yang salah. Stok
    // outlet yang salah ikut terpotong, dan koreksinya harus lewat admin.
    const terisi = [...state.qty.values()].filter((q) => q > 0).length;
    if (terisi) {
      const lama = myOutlets.find((o) => o.id === state.outletId)?.name ?? 'outlet sebelumnya';
      const ok = await confirmDialog({
        title: 'Pindah outlet?',
        message: `${terisi} menu sudah diisi untuk ${lama}. Isiannya akan dikosongkan supaya tidak tercatat di outlet yang keliru.`,
        confirmText: 'Pindah & kosongkan'
      });
      if (!ok) {
        outletSel.value = state.outletId; // kembalikan pilihannya
        return;
      }
      state.qty.clear();
    }

    state.outletId = outletSel.value;
    // DAFTAR MENUNYA IKUT BERGANTI, bukan cuma harganya.
    //
    // Menu bisa dibatasi ke outlet tertentu (0115). Tanpa baris ini, layarnya
    // tetap menampilkan menu milik outlet sebelumnya — dan karena harganya
    // ikut berubah, hasilnya adalah menu outlet lama dengan harga outlet baru:
    // tampilan yang tidak pernah benar untuk outlet mana pun.
    await loadMenuAktif();
    // Harga menempel pada OUTLET, jadi berganti outlet berarti seluruh kolom
    // harga berubah. Tanpa ini, layarnya menampilkan harga outlet sebelumnya.
    await loadHarga();
    renderRows();
    await loadSummary();
  });
  catSel.addEventListener('change', () => {
    state.category = catSel.value;
    renderRows();
  });

  // Ditunda 250 ms. Menggambar ulang tiap ketukan pada BU dengan ratusan menu
  // membuat pengetikan tersendat di ponsel — dan tabel yang digambar ulang di
  // tengah ketikan juga mencuri fokus dari kotak pencariannya.
  let timerCari;
  cariInput.addEventListener('input', () => {
    clearTimeout(timerCari);
    timerCari = setTimeout(() => {
      state.q = cariInput.value.trim();
      renderRows();
    }, 250);
  });

  // Enter di kotak pencarian JANGAN mengirim apa pun. Di ponsel, tombol Enter
  // berlabel "cari" berada tepat di tempat orang menekannya secara refleks —
  // dan form submit yang tidak sengaja di layar ini berarti penjualan tercatat.
  cariInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(timerCari);
    state.q = cariInput.value.trim();
    renderRows();
    cariInput.blur(); // tutup papan ketik supaya daftarnya langsung terlihat
  });

  // Isian disimpan ke ingatan lewat SATU pendengar di tabelnya, bukan satu per
  // baris. Baris digambar ulang tiap kali saringan berubah, dan pendengar
  // per-baris akan ikut hilang bersamanya — hanya baris hasil gambar terakhir
  // yang masih merekam, dan sisanya diam-diam berhenti.
  container.querySelector('#sl-rows').addEventListener('input', (e) => {
    const inp = e.target.closest('.sl-qty');
    if (!inp) return;
    const n = Number(inp.value);
    // Kotak yang dikosongkan berarti "batal", bukan nol — entrinya dibuang
    // supaya tidak ikut terhitung sebagai menu yang sudah diisi.
    if (inp.value === '' || !Number.isFinite(n) || n <= 0) state.qty.delete(inp.dataset.id);
    else state.qty.set(inp.dataset.id, n);
    renderInfo();
  });

  /**
   * Katakan menu mana yang TIDAK memotong stok.
   *
   * Dibaca dengan sangat hati-hati karena PWA ini ter-cache di HP staff: layar
   * versi baru bisa berjalan melawan database yang BELUM dimigrasi 0108, dan
   * saat itu kedua kunci ini tidak ada sama sekali. `Array.isArray` menangkap
   * itu tanpa menampilkan apa pun — diam adalah perilaku lama, dan perilaku
   * lama lebih baik daripada pesan salah.
   */
  function laporkanStokTakBergerak(hasil) {
    const tanpa = Array.isArray(hasil?.tanpa_resep) ? hasil.tanpa_resep : [];
    const kosong = Array.isArray(hasil?.resep_kosong) ? hasil.resep_kosong : [];
    if (!tanpa.length && !kosong.length) return;

    const bagian = [];
    if (tanpa.length) {
      bagian.push(`${tanpa.join(', ')} belum punya resep`);
    }
    if (kosong.length) {
      // Dibedakan dari yang di atas karena perbaikannya berbeda — dan karena di
      // layar Admin, menu ini terlihat SUDAH punya resep. Tanpa kalimat ini,
      // orang akan membuka daftar resep, melihat namanya ada, lalu menyimpulkan
      // sistemnya yang salah.
      bagian.push(`${kosong.join(', ')} resepnya tersimpan tapi isinya kosong`);
    }

    toast(
      `Omzet tercatat, tapi stok bahan TIDAK berkurang untuk: ${bagian.join('; ')}. ` +
        'Kalau menu itu memang dibeli jadi, ini wajar. Kalau tidak, minta admin melengkapi resepnya.',
      'warning'
    );
  }

  container.querySelector('#sl-save').addEventListener('click', async (e) => {
    // DIBACA DARI INGATAN, BUKAN DARI KOTAK YANG SEDANG TERLIHAT.
    //
    // `querySelectorAll('.sl-qty')` hanya menemukan baris yang lolos saringan.
    // Membacanya dari sana berarti menu yang sudah diisi lalu tersaring keluar
    // TIDAK ikut tersimpan — penjualan hilang tanpa satu pun pesan, dan baru
    // ketahuan saat rekap tidak cocok dengan kasir.
    const items = isianTerkirim(state.qty);

    if (!items.length) {
      toast('Isi jumlah terjual dulu.', 'warning');
      return;
    }

    // PENANDA DIBUAT SEKALI, DIPAKAI ULANG SAMPAI BERHASIL.
    //
    // Tombol yang dinonaktifkan tidak cukup: yang mau dicegah bukan klik ganda
    // melainkan KIRIMAN yang sampai dua kali — jaringan yang putus lalu
    // permintaannya ternyata sudah diterima server, atau staff yang menekan
    // ulang sesudah layarnya terlihat tidak merespons.
    if (!state.ref) state.ref = buatRefKiriman();

    e.target.disabled = true;
    try {
      const hasil = await recordSales({ businessUnitId, outletId: state.outletId, date, items, ref: state.ref });

      // Berhasil -> penanda dibuang, siap untuk kiriman berikutnya (shift kedua).
      state.ref = null;
      // Ingatannya ikut dikosongkan, bukan hanya kotak yang terlihat. Kalau
      // hanya kotaknya yang dibersihkan, isian yang sedang tersaring keluar
      // akan tetap tersimpan di ingatan dan IKUT TERKIRIM LAGI pada penyimpanan
      // berikutnya — penjualan ganda yang tidak tertangkap penanda kiriman,
      // karena kirimannya memang berbeda.
      state.qty.clear();
      container.querySelectorAll('.sl-qty').forEach((inp) => (inp.value = ''));
      renderInfo();

      toast(
        hasil?.diproses === false
          ? 'Kiriman ini sudah tersimpan sebelumnya — tidak dicatat dua kali.'
          : 'Penjualan tersimpan. Stok & omzet diperbarui.',
        'success'
      );

      // MENU YANG TERJUAL TAPI TIDAK MENGGERAKKAN STOK.
      //
      // Dilaporkan server sejak 0108. Sebelum itu, menu tanpa resep menambah
      // omzet tanpa menyentuh stok sama sekali dan layar ini tetap berkata
      // "Stok & omzet diperbarui" — kalimat yang setengahnya tidak benar.
      //
      // Ditampilkan sebagai peringatan TERPISAH, bukan menggantikan pesan
      // berhasilnya: penjualannya memang berhasil, yang perlu diketahui adalah
      // bagian yang tidak terjadi.
      laporkanStokTakBergerak(hasil);

      await loadSummary();
    } catch (error) {
      const pesan = error.message ?? 'Gagal menyimpan penjualan.';

      // DUA JENIS KEGAGALAN, DUA PERLAKUAN BERBEDA.
      //
      // Ditolak karena isinya (harga belum disetting) -> penanda DIBUANG.
      // Isinya akan diperbaiki, jadi kiriman berikutnya adalah kiriman yang
      // BERBEDA; mempertahankan penanda akan membuat kiriman yang sudah benar
      // ditolak sebagai duplikat.
      //
      // Gagal karena jaringan -> penanda DIPERTAHANKAN, supaya percobaan ulang
      // dikenali sebagai kiriman yang sama.
      if (/harga jual belum disetting/i.test(pesan)) state.ref = null;

      toast(pesan, 'error');
    } finally {
      e.target.disabled = false;
    }
  });

  await loadMenuAktif();
  await loadHarga();
  renderRows();
  await loadSummary();
}

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'short' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
