import { toast } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { listProducts, listRecipesFull } from '../product/product.service.js';
import { petaPerkiraan, labelPerkiraan, rincianBahanMenu } from './perkiraan.js';
import { getOutletStockMap } from '../inventory/inventory.service.js';
import { getMenuPlans, upsertMenuPlan, todayWIB } from './menu.service.js';
import { listMyOutlets } from '../../core/my-outlets.js';
import { saringMenu, ringkasIsian } from '../sales/saring-menu.js';
import { listMenuAktifOutlet } from './menu-outlet.service.js';
import { loadingHtml } from '../../core/loading.js';

export async function renderMenuPage(container, { businessUnitId, outletId }) {
  container.innerHTML = loadingHtml('Memuat menu…');
  const date = todayWIB();

  // RESEP DIMUAT SEKALI DI AWAL, bukan per menu saat dibuka.
  //
  // Perkiraan "bisa dibuat" sekarang tampil di SETIAP baris tanpa perlu
  // dibuka, jadi angkanya harus ada untuk semua menu sejak awal. Memanggil
  // `getRecipeForProduct` per menu berarti satu permintaan jaringan per baris
  // — untuk 60 menu itu 60 permintaan sebelum layarnya berguna.
  //
  // `listRecipesFull` mengambil semuanya dalam dua permintaan, dan sekaligus
  // menghapus sumber perbedaan: sebelumnya angka di rincian dihitung terpisah
  // dari yang di baris, dan dua hitungan untuk pertanyaan yang sama selalu
  // berakhir menyimpang.
  let outlets, products, recipes;
  try {
    [outlets, products, recipes] = await Promise.all([
      listMyOutlets(businessUnitId),
      listProducts(businessUnitId),
      listRecipesFull(businessUnitId)
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }
  const menus = products.filter((p) => p.product_type === 'finished' && p.is_active !== false);
  if (!outlets.length) {
    container.innerHTML = `<h1>Menu</h1><p>Belum ada outlet untukmu di BU ini.</p>`;
    return;
  }
  if (!menus.length) {
    container.innerHTML = `<h1>Menu</h1><p style="color:var(--color-text-muted)">Belum ada menu (Produk Jadi). Minta admin mengisi di Master Produk.</p>`;
    return;
  }
  const categories = [...new Set(menus.map((m) => m.category).filter(Boolean))].sort();
  const produkById = new Map(products.map((p) => [p.id, p]));
  const state = {
    outletId: outlets.some((o) => o.id === outletId) ? outletId : outlets[0].id,
    category: '',
    q: '',
    plans: new Map(),
    stock: new Map()
  };

  container.innerHTML = `
    <h1>Menu</h1>
    <p style="color:var(--color-text-muted);font-size:0.85rem;margin:0 0 10px">Isi jumlah menu yang tersedia hari ini (${fmtDate(date)}) sebagai panduan POS. Mengisi jumlah <strong>tidak</strong> mengurangi stok — stok berkurang saat penjualan.</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px">
      <div class="field" style="margin:0"><label>Outlet</label>
        <select id="menu-outlet">${outlets.map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0"><label>Kategori</label>
        <select id="menu-cat"><option value="">Semua</option>${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;flex:1;min-width:180px"><label>Cari menu</label>
        <input type="search" id="menu-q" placeholder="mis. nasi goreng" autocomplete="off" enterkeyhint="search" />
      </div>
    </div>
    <div id="menu-info" style="margin-bottom:8px"></div>
    <div class="table-scroll gulir-baris"><table class="data-table baris-sejajar">
      <thead><tr><th>Menu</th><th>Kategori</th><th>Jumlah tersedia</th></tr></thead>
      <tbody id="menu-rows"></tbody>
    </table></div>
  `;

  const outletSel = container.querySelector('#menu-outlet');
  const catSel = container.querySelector('#menu-cat');

  /**
   * Menu yang aktif di outlet ini (0115).
   *
   * `null` = belum/gagal dimuat -> daftarnya ditampilkan UTUH. Sama seperti di
   * layar Penjualan: menu yang terlanjur tampil jauh lebih murah daripada
   * layar kosong yang terbaca sebagai aplikasi rusak.
   */
  let menuAktif = null;

  /** Menu milik outlet ini, sebelum saringan kategori & pencarian. */
  const menuOutlet = () => (menuAktif ? menus.filter((m) => menuAktif.has(m.id)) : menus);

  async function reload() {
    try {
      // Ketiganya bergantung pada OUTLET, jadi ketiganya dimuat ulang bersama.
      // Menyisakan salah satunya memakai outlet lama menghasilkan layar yang
      // separuh benar — dan separuh yang salah tidak menandai dirinya sendiri.
      [state.plans, state.stock, menuAktif] = await Promise.all([
        getMenuPlans(state.outletId, date),
        getOutletStockMap(businessUnitId, state.outletId),
        listMenuAktifOutlet(state.outletId).catch(() => null)
      ]);
    } catch {
      state.plans = new Map();
      state.stock = new Map();
      menuAktif = null;
    }
    renderRows();
  }

  /**
   * Rencana yang berlaku SEKARANG — gabungan ingatan dan kotak yang terlihat.
   *
   * DULU ia hanya membaca kotak yang sedang tampak, dan itu salah begitu ada
   * saringan: perkiraan "bisa dibuat berapa porsi" memotong bahan hanya untuk
   * menu yang kebetulan terlihat. Menu lain yang sudah diisi ikut memakai bahan
   * yang sama, tapi tidak dihitung — angkanya jadi terlalu optimis, terlihat
   * wajar, dan tidak ada satu pun tanda.
   *
   * Kotak yang terlihat MENANG atas ingatan: ia yang sedang diketik, jadi ia
   * yang paling baru.
   */
  function rencanaSekarang() {
    const gabung = new Map(state.plans);
    const tbody = container.querySelector('#menu-rows');
    if (tbody) {
      for (const el of tbody.querySelectorAll('.menu-qty')) {
        gabung.set(el.dataset.id, el.value === '' ? 0 : Number(el.value));
      }
    }
    return gabung;
  }

  /** Menu yang lolos saringan kategori DAN pencarian nama. */
  const menuTersaring = () => saringMenu(menuOutlet(), { kategori: state.category, q: state.q });

  /**
   * Beri tahu kalau ada isian yang sedang TERSEMBUNYI oleh saringan.
   *
   * Tanpa ini, staff yang sudah mengisi lima menu lalu mencari menu keenam
   * hanya melihat satu baris — dan akan mengira empat isian sebelumnya hilang.
   */
  function renderInfo() {
    const box = container.querySelector('#menu-info');
    if (!box) return;
    const { terisi, tersembunyi } = ringkasIsian(state.plans, menuTersaring(), menus);
    if (!terisi.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `
      <p class="report-note" style="margin:0">
        <strong>${terisi.length} menu</strong> sudah diisi.
        ${
          tersembunyi.length
            ? `<strong>${tersembunyi.length} di antaranya sedang tidak terlihat</strong> karena saringan —
               isiannya tetap tersimpan: ${tersembunyi.map((t) => `${esc(t.nama)} (${t.qty})`).join(', ')}.`
            : ''
        }
      </p>`;
  }

  /** Varian resep yang berlaku di outlet ini — gerai CK memakai resep CK. */
  function modeOutlet() {
    return outlets.find((o) => o.id === state.outletId)?.outlet_role === 'served_by_ck' ? 'served_by_ck' : 'standalone';
  }

  function renderRows() {
    const tbody = container.querySelector('#menu-rows');
    const list = menuTersaring();
    // Dihitung SETIAP kali baris digambar ulang, bukan sekali di awal: stok
    // berubah saat outlet berganti, dan angka perkiraan dari stok outlet
    // sebelumnya akan terlihat normal sambil menyesatkan.

    tbody.innerHTML =
      list
        .map(
          (m) => `
        <tr class="menu-row">
          <td data-label="Menu"><button class="menu-expand" data-id="${m.id}" style="border:none;background:none;color:var(--color-primary);cursor:pointer;font-size:0.92rem;padding:0;text-align:left">${esc(m.name)} ▾</button></td>
          <td data-label="Kategori">${esc(m.category ?? '-')}</td>
          <td data-label="Jumlah tersedia">
            <div class="menu-isi">
              <input type="number" class="menu-qty isian-sempit" data-id="${m.id}" min="0" inputmode="numeric"
                     value="${state.plans.has(m.id) ? state.plans.get(m.id) : ''}" aria-label="Jumlah tersedia ${esc(m.name)}" />
              <span class="menu-perkiraan" data-id="${m.id}"></span>
            </div>
            <span class="menu-saved" data-id="${m.id}"></span>
          </td>
        </tr>
        <tr class="menu-detail" data-id="${m.id}" hidden><td colspan="3" class="sel-penuh"><div class="menu-detail-body" style="padding:6px 2px"></div></td></tr>`
        )
        .join('') ||
      `<tr><td colspan="3">${
        state.q
          ? `Tidak ada menu yang cocok dengan "${esc(state.q)}"${state.category ? ' di kategori ini' : ''}.`
          : 'Tidak ada menu di kategori ini.'
      }</td></tr>`;

    renderInfo();

    /**
     * Gambar ulang SEMUA label perkiraan dari isian yang sedang tampak.
     *
     * Dibaca dari kotak isiannya, bukan dari `state.plans`: staff harus
     * melihat akibat angkanya SEKARANG, bukan setelah tersimpan. Menunggu
     * simpan berarti label yang tertinggal satu langkah dari yang diketik —
     * dan label yang tertinggal lebih menyesatkan daripada tidak ada label.
     *
     * Yang diperbarui cuma isi <span>-nya, bukan seluruh tabel. Menggambar
     * ulang tabel saat mengetik akan membuang fokus dari kotak yang sedang
     * diisi, dan angka yang sedang diketik ikut hilang.
     */
    function perbaruiPerkiraan() {
      // SELURUH menu, bukan `list`. Bahan yang dipakai menu yang sedang
      // tersaring keluar tetap harus ikut dipotong — kalau tidak, perkiraannya
      // terlalu optimis persis untuk menu yang paling sering diisi bersamaan.
      const peta = petaPerkiraan({
        menus,
        recipes,
        stok: state.stock,
        mode: modeOutlet(),
        rencana: rencanaSekarang(),
        // Rencana untuk menu yang TIDAK dijual di outlet ini tidak boleh ikut
        // memotong stok. Sebelum penyaring ini, beras 17.280 gr dengan takaran
        // 200 gr/porsi bisa berbunyi "bahan habis" — dan sesudah 0115 barisnya
        // bahkan tidak tampil lagi, jadi penyebabnya tidak ada di layar mana pun.
        aktif: menuAktif
      });
      for (const span of tbody.querySelectorAll('.menu-perkiraan')) {
        const h = peta.get(span.dataset.id);
        span.textContent = labelPerkiraan(h) + (h?.dikurangi ? ' (sisa)' : '');
        span.classList.toggle('menu-perkiraan-habis', h?.bisa === 0);
        span.title = h?.dikurangi
          ? 'Sudah dikurangi bahan yang terpakai menu lain yang kamu isi.'
          : '';
      }
    }
    perbaruiPerkiraan();

    tbody.querySelectorAll('.menu-qty').forEach((inp) => {
      // `input`, bukan `change`: angkanya harus ikut berubah saat diketik,
      // bukan menunggu jempolnya pindah ke tempat lain.
      inp.addEventListener('input', perbaruiPerkiraan);
      inp.addEventListener('change', async () => {
        const qty = inp.value === '' ? 0 : Number(inp.value);
        try {
          await upsertMenuPlan({ businessUnitId, outletId: state.outletId, productId: inp.dataset.id, date, qty });
          state.plans.set(inp.dataset.id, qty);
          const s = tbody.querySelector(`.menu-saved[data-id="${inp.dataset.id}"]`);
          if (s) {
            s.textContent = '✓ tersimpan';
            setTimeout(() => (s.textContent = ''), 1500);
          }
          perbaruiPerkiraan();
        } catch (error) {
          toast(error.message ?? 'Gagal menyimpan jumlah.', 'error');
        }
      });
    });

    tbody.querySelectorAll('.menu-expand').forEach((btn) =>
      btn.addEventListener('click', () => toggleDetail(tbody, menus.find((m) => m.id === btn.dataset.id)))
    );
  }

  /**
   * Rincian bahan satu menu.
   *
   * Angka "bisa dibuat" TIDAK dihitung lagi di sini — ia diambil dari
   * perhitungan yang sama dengan yang tampil di barisnya. Sebelumnya keduanya
   * dihitung terpisah, dan dua hitungan untuk pertanyaan yang sama selalu
   * berakhir menyimpang: yang satu diperbaiki, yang lain tertinggal, dan tidak
   * ada yang tahu sampai angkanya berbeda di layar yang sama.
   */
  function toggleDetail(tbody, menu) {
    const detailRow = tbody.querySelector(`.menu-detail[data-id="${menu.id}"]`);
    if (!detailRow) return;
    if (!detailRow.hidden) {
      detailRow.hidden = true;
      return;
    }
    detailRow.hidden = false;

    const mode = modeOutlet();
    const namaVarian = mode === 'served_by_ck' ? 'Dilayani CK' : 'Standalone';
    const resep = recipes.find((r) => r.product_id === menu.id && r.mode === mode) ?? null;
    const body = detailRow.querySelector('.menu-detail-body');

    if (!resep || !resep.items?.length) {
      body.innerHTML = `<span style="color:var(--color-text-muted)">Resep (${esc(namaVarian)}) belum diatur untuk menu ini.</span>`;
      return;
    }

    // Angka, pembatas, DAN sisanya diambil dari perhitungan yang SAMA dengan
    // barisnya — termasuk pengurangan oleh menu lain yang sudah diisi.
    // Menghitungnya ulang di sini dengan stok penuh akan menampilkan dua angka
    // berbeda untuk satu menu, di layar yang sama, tanpa ada yang salah
    // kelihatannya. Itu persis keadaan yang dilaporkan sebagai bug.
    const { hasil, baris, pemakan } = rincianBahanMenu({
      menus: menus.map((x) => ({ id: x.id })),
      recipes,
      stok: state.stock,
      mode,
      rencana: rencanaSekarang(),
      aktif: menuAktif,
      menuId: menu.id
    });

    const rows = baris.map((b) => {
      const p = produkById.get(b.bahanId);
      const satuan = esc(p?.base_unit ?? '');
      // KOLOM SISA ADA KARENA KOLOM STOK SAJA BERBOHONG.
      //
      // Vonis "bahan habis" dan tanda "pembatas" dihitung dari SISA, sementara
      // kolom Stok menampilkan angka MENTAH. Dua angka untuk satu hal, di layar
      // yang sama, dan yang menentukan justru tidak pernah ditampilkan —
      // sehingga "beras 17.280 gr, takaran 200 gr, tapi bahan habis" menjadi
      // pertanyaan yang mustahil dijawab pembacanya.
      //
      // Sisanya hanya ditulis kalau memang BERBEDA. Menampilkan dua angka
      // kembar di tiap baris cuma menambah bacaan tanpa menambah keterangan,
      // dan kolom yang biasanya mengulang dirinya sendiri berhenti diperhatikan
      // justru saat ia berbeda.
      const beda = b.dipakaiMenuLain > 0;
      return `<tr${b.pembatas ? ' class="menu-bahan-batas"' : ''}>
        <td data-label="Bahan">${esc(p?.name ?? '(produk terhapus)')}${b.pembatas ? ' <span class="menu-tag-batas">pembatas</span>' : ''}</td>
        <td data-label="Per menu">${formatNum(b.butuh)} ${satuan}</td>
        <td data-label="Stok">${formatNum(b.stok)} ${satuan}</td>
        <td data-label="Sisa">${
          beda
            ? `<strong>${formatNum(b.sisa)} ${satuan}</strong><div class="menu-sisa-ket">−${formatNum(
                b.dipakaiMenuLain
              )} dipakai menu lain</div>`
            : `<span style="color:var(--color-text-muted)">${formatNum(b.sisa)} ${satuan}</span>`
        }</td>
      </tr>`;
    });

    // SIAPA YANG MEMAKANNYA — untuk bahan pembatas saja.
    //
    // "Sisa 120 gr" masih menyisakan pertanyaan berikutnya, dan sebelum ini
    // pertanyaan itu tidak punya jawaban di layar mana pun. Dibatasi ke bahan
    // pembatas karena hanya bahan itu yang menahan angkanya; menyebut pemakan
    // seluruh bahan akan mengubur keterangan yang berguna di antara yang tidak.
    const dijelaskan = baris.filter((b) => b.pembatas && b.dipakaiMenuLain > 0);
    const ketPemakan = dijelaskan
      .map((b) => {
        const daftar = (pemakan.get(b.bahanId) ?? [])
          .slice(0, 4)
          .map((x) => `${esc(produkById.get(x.menuId)?.name ?? 'menu lain')} (${formatNum(x.qty)})`)
          .join(', ');
        const sisanya = Math.max(0, (pemakan.get(b.bahanId) ?? []).length - 4);
        return `<div><strong>${esc(produkById.get(b.bahanId)?.name ?? 'bahan')}</strong> dipakai ${daftar}${
          sisanya ? ` dan ${sisanya} menu lain` : ''
        }</div>`;
      })
      .join('');

    body.innerHTML = `
      <div style="font-size:0.82rem;color:var(--color-text-muted);margin-bottom:6px">
        Resep ${esc(namaVarian)} · ${esc(labelPerkiraan(hasil))}${hasil.dikurangi ? ' (sisa)' : ''}${
          (hasil.pembatas ?? []).length > 1
            ? ` · <strong>${hasil.pembatas.length} bahan sama-sama mepet</strong> — menambah salah satu saja belum menaikkan angkanya`
            : ''
        }
      </div>
      <table class="data-table baris-sejajar"><thead><tr><th>Bahan</th><th>Per menu</th><th>Stok</th><th>Sisa</th></tr></thead><tbody>${rows.join('')}</tbody></table>
      ${
        ketPemakan
          ? `<div class="menu-pemakan">Kenapa sisanya berkurang — rencana yang sudah diisi hari ini:${ketPemakan}</div>`
          : ''
      }
    `;
  }

  outletSel.addEventListener('change', () => {
    state.outletId = outletSel.value;
    reload();
  });
  catSel.addEventListener('change', () => {
    state.category = catSel.value;
    renderRows();
  });

  // Ditunda 250 ms: menggambar ulang tiap ketukan membuat pengetikan tersendat
  // di ponsel, dan tabel yang digambar ulang di tengah ketikan mencuri fokus
  // dari kotak pencariannya.
  const cariInput = container.querySelector('#menu-q');
  let timerCari;
  cariInput.addEventListener('input', () => {
    clearTimeout(timerCari);
    timerCari = setTimeout(() => {
      state.q = cariInput.value.trim();
      renderRows();
    }, 250);
  });
  cariInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(timerCari);
    state.q = cariInput.value.trim();
    renderRows();
    cariInput.blur();
  });

  await reload();
}

function round(n) {
  return Math.round(Number(n) * 100) / 100;
}
function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'short' });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
