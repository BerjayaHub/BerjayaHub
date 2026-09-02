import { toast, formDialog, confirmDialog, fuzzyMatch } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { listProducts, listRecipesFull, computeCosts } from '../product/product.service.js';
import { getOutletStockMap, recordMovement, getAllowStaffOpname, recordMenuWaste } from './inventory.service.js';
import { listMyOutlets } from '../../core/my-outlets.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { cocokNama } from '../../core/nama.js';
import { urutStokTerendah } from './urutan-stok.js';
import { renderResepStaff } from './resep-staff.js';
import { sesiTerbuka, catatHitungan, itemOpname } from './opname.service.js';
import { SARING, susunDaftar, nilaiKotak, sudahDihitung, keteranganHitung, hitungBelumTersimpan, peringatanTurun } from './opname-daftar.js';
import { renderNotaStaff } from './nota-staff.js';
import { renderMenipisStaff } from './menipis-staff.js';

export async function renderInventoryPage(container, { userId, businessUnitId, outletId }) {
  container.innerHTML = loadingHtml('Memuat inventory…');

  let outlets, products, recipes, allowOpname;
  try {
    [outlets, products, recipes, allowOpname] = await Promise.all([
      listMyOutlets(businessUnitId).then((all) => all.map((o) => ({ id: o.id, name: o.name }))),
      listProducts(businessUnitId),
      listRecipesFull(businessUnitId),
      getAllowStaffOpname(businessUnitId).catch(() => false)
    ]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">Gagal memuat: ${error.message ?? error}</p>`;
    return;
  }
  // Bahan = bahan baku + setengah jadi. Produk bertipe MENU sengaja tidak
  // ditampilkan di form bahan (penerimaan/spoil/opname) — menu hanya
  // dipakai untuk Waste menu & modul Menu.
  const activeProducts = products.filter((p) => p.is_active !== false && p.product_type !== 'finished');
  const menuProducts = products.filter((p) => p.is_active !== false && p.product_type === 'finished');
  if (!outlets.length) {
    container.innerHTML = `<h1>Bahan</h1><p>Belum ada outlet untukmu di BU ini.</p>`;
    return;
  }
  if (!activeProducts.length) {
    container.innerHTML = `<h1>Bahan</h1><p style="color:var(--color-text-muted)">Belum ada produk. Minta admin mengisi Master Produk dulu.</p>`;
    return;
  }
  const costs = computeCosts(products, recipes);
  const productById = new Map(products.map((p) => [p.id, p]));
  const state = { outletId: outlets.some((o) => o.id === outletId) ? outletId : outlets[0].id };

  container.innerHTML = `
    <h1 style="margin-bottom:6px">Bahan</h1>

    <!-- HEADER LENGKET: outlet, tombol tindakan, dan saringan daftar stok.
         Yang menggulir hanya daftar bahannya. Daftar stok satu outlet bisa
         ratusan baris, dan tanpa ini "Terima dari Supplier" hilang dari layar
         begitu orangnya menggulir sedikit untuk memeriksa satu angka. -->
    <div class="panel-lengket-atas">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0;flex:1;min-width:150px">
          <label>Outlet</label>
          <select id="inv-outlet">${outlets.map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}</select>
        </div>
        <div class="field" style="margin:0;flex:1;min-width:120px">
          <label>Kategori</label>
          <select id="inv-cat"><option value="">Semua</option>${[...new Set(activeProducts.map((p) => p.category).filter(Boolean))]
            .sort()
            .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
            .join('')}</select>
        </div>
        <div class="field" style="margin:0;flex:1.3;min-width:140px">
          <label>Cari nama</label>
          <input type="search" id="inv-q" placeholder="ketik nama bahan…" autocomplete="off" enterkeyhint="search" />
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <button class="primary" id="inv-receive">📥 Terima dari Supplier</button>
        <button id="inv-waste">🗑️ Waste / Spoil</button>
        ${allowOpname ? '<button id="inv-opname">📋 Stok Opname</button>' : ''}
        <button id="inv-resep">📖 Resep</button>
        <button id="inv-menipis">⚠️ Bahan Menipis</button>
      </div>
    </div>

    <div id="inv-nota-panel" hidden></div>
    <div id="inv-menipis-panel" hidden></div>
    <div id="inv-opname-panel"></div>
    <div id="inv-resep-panel"></div>
    <div id="inv-stock" style="margin-top:8px"></div>
  `;

  const outletSelect = container.querySelector('#inv-outlet');
  outletSelect.addEventListener('change', () => {
    state.outletId = outletSelect.value;

    // PANEL NOTA DITUTUP SAAT OUTLET BERGANTI.
    //
    // `renderNotaStaff` memegang `outletId` yang berlaku SAAT panelnya dibuka.
    // Tanpa baris ini, mengganti outlet sementara panelnya terbuka menghasilkan
    // nota yang masuk ke outlet SEBELUMNYA — dan tidak ada yang menandakannya:
    // notanya tersimpan, nomornya keluar, toast-nya hijau, stok outlet yang
    // salah bertambah. Baru ketahuan saat stok tidak cocok berhari-hari kemudian.
    for (const [sel, pesan] of [
      ['#inv-nota-panel', 'Panel terima nota ditutup karena outletnya berganti.'],
      ['#inv-menipis-panel', 'Panel bahan menipis ditutup karena outletnya berganti.']
    ]) {
      const panel = container.querySelector(sel);
      if (panel && !panel.hasAttribute('hidden')) {
        panel.setAttribute('hidden', '');
        panel.innerHTML = '';
        toast(pesan, 'info');
      }
    }

    refresh();
  });

  const productOptions = activeProducts.map((p) => ({ value: p.id, label: `${p.name} (${p.base_unit})` }));

  async function refresh() {
    const stockDiv = container.querySelector('#inv-stock');
    stockDiv.innerHTML = loadingHtml('Memuat stok…');
    let map;
    try {
      map = await getOutletStockMap(businessUnitId, state.outletId);
    } catch (error) {
      stockDiv.innerHTML = `<p class="error-text">${error.message ?? error}</p>`;
      return null;
    }
    gambarStok(map);
    return map;
  }

  /**
   * Gambar tabel stok dengan penyaring yang sedang aktif.
   *
   * Dipisah dari `refresh()` supaya mengetik di kotak cari tidak memanggil
   * jaringan sama sekali — daftarnya sudah ada di memori, dan menunggu jaringan
   * untuk tiap huruf membuat pencarian terasa berat justru saat dipakai
   * menelusuri daftar bahan yang panjang.
   */
  function gambarStok(map) {
    const stockDiv = container.querySelector('#inv-stock');
    if (!stockDiv || !map) return;
    const q = container.querySelector('#inv-q')?.value ?? '';
    const cat = container.querySelector('#inv-cat')?.value ?? '';
    // Diurutkan dari stok TERENDAH, jadi yang minus selalu di baris atas.
    // Peringatan "⚠ n bahan minus" di bawah ini sudah ada sejak dulu, tapi
    // peringatan yang menyuruh orang mencari sendiri di ratusan baris adalah
    // peringatan yang akan diabaikan. Aturannya di `urutan-stok.js` supaya
    // Admin Portal memakai urutan yang persis sama.
    const tampil = urutStokTerendah(
      activeProducts.filter((p) => (!cat || p.category === cat) && cocokNama(`${p.name} ${p.category ?? ''}`, q)),
      (p) => map.get(p.id),
      (p) => p.name
    );

    // STOK MINUS DITANDAI, dan jumlahnya disebut di atas.
    //
    // Minus BUKAN sekadar "kosong". Ia berarti catatan mengatakan barangnya
    // terpakai lebih banyak daripada yang pernah masuk — biasanya karena
    // produksi/penjualan tercatat sementara penerimaannya belum, atau opname
    // awalnya belum pernah diisi.
    //
    // Sistem sengaja MENGIZINKAN minus supaya pekerjaan di lapangan tidak
    // terhenti. Tapi kalau angkanya cuma tampil seperti angka biasa, tidak ada
    // yang pernah menyadarinya — dan saat opname akhirnya dijalankan, selisih
    // sebesar itu ikut terserap sebagai "penyesuaian" tanpa pernah
    // ditanyakan sebabnya.
    const jumlahMinus = tampil.filter((p) => Number(map.get(p.id) ?? 0) < 0).length;

    stockDiv.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 6px">
        ${tampil.length === activeProducts.length ? `${activeProducts.length} bahan` : `${tampil.length} dari ${activeProducts.length} bahan`}
      </p>
      ${
        jumlahMinus
          ? `<p class="error-text" style="margin:0 0 8px;font-size:0.85rem">
               ⚠ ${jumlahMinus} bahan stoknya <strong>minus</strong> — catatan bilang terpakai lebih banyak daripada yang pernah masuk.
               Biasanya karena penerimaan belum dicatat, atau stok awal belum diisi lewat opname.
             </p>`
          : ''
      }
      <div class="table-scroll gulir-baris" style="--tinggi-baris:38px"><table class="data-table baris-sejajar">
        <thead><tr><th>Produk</th><th>Stok</th><th>Satuan</th></tr></thead>
        <tbody>
          ${
            tampil
              .map((p) => {
                const qty = Number(map.get(p.id) ?? 0);
                const minus = qty < 0;
                return `<tr><td>${escapeHtml(p.name)}</td><td${
                  minus ? ' style="color:var(--color-danger);font-weight:600"' : ''
                }>${formatNum(qty)}${minus ? ' ⚠' : ''}</td><td>${escapeHtml(p.base_unit)}</td></tr>`;
              })
              .join('') || '<tr><td colspan="3">Tidak ada bahan pada filter ini.</td></tr>'
          }
        </tbody>
      </table></div>
    `;
  }

  let stockMap = await refresh();
  container.querySelector('#inv-cat').addEventListener('change', () => gambarStok(stockMap));
  container.querySelector('#inv-q').addEventListener('input', () => gambarStok(stockMap));

  // BAHAN MENIPIS.
  //
  // `stockMap` diambil SAAT DITEKAN, bukan dipegang dari awal: panel ini
  // menghitung "cukup berapa porsi lagi", dan menghitungnya dari stok basi
  // menghasilkan daftar belanja yang salah tanpa satu pun tanda di layar.
  const menipisPanel = container.querySelector('#inv-menipis-panel');
  container.querySelector('#inv-menipis').addEventListener('click', async () => {
    if (!menipisPanel.hasAttribute('hidden')) {
      menipisPanel.setAttribute('hidden', '');
      menipisPanel.innerHTML = '';
      return;
    }
    menipisPanel.removeAttribute('hidden');
    stockMap = (await refresh()) ?? stockMap;
    await renderMenipisStaff(menipisPanel, {
      outletId: state.outletId,
      outletName: outlets.find((o) => o.id === state.outletId)?.name ?? '',
      // SELURUH produk, bukan `activeProducts`: membentang resep menu menuntut
      // produk bertipe menu ikut dikenali. Menyaringnya di sini akan membuat
      // setiap penjualan menu terbaca "tidak punya resep", dan seluruh
      // pemakaian bahan jadi nol — daftar yang selalu bilang semuanya aman.
      products,
      recipes,
      stok: stockMap ?? new Map()
    });
  });

  // TERIMA DARI SUPPLIER: panel per NOTA, bukan dialog per produk.
  //
  // Bentuk lamanya menuntut satu dialog untuk tiap barang — untuk nota berisi
  // belasan item itu belasan kali memilih produk dan mengetik jumlah, dan
  // sesudahnya tidak ada nomor yang bisa dipakai mencocokkan dengan tagihan
  // supplier.
  const notaPanel = container.querySelector('#inv-nota-panel');
  container.querySelector('#inv-receive').addEventListener('click', () => {
    if (!notaPanel.hasAttribute('hidden')) {
      notaPanel.setAttribute('hidden', '');
      notaPanel.innerHTML = '';
      return;
    }
    notaPanel.removeAttribute('hidden');
    renderNotaStaff(notaPanel, { businessUnitId, outletId: state.outletId, products: activeProducts });
  });

  const menuOptions = menuProducts.map((p) => ({ value: p.id, label: `${p.name} (${p.base_unit})` }));

  container.querySelector('#inv-waste').addEventListener('click', sekaliJalan(async () => {
    const v = await formDialog({
      title: 'Catat Waste / Spoil',
      description: 'Waste = menu jadi yang terbuang (bahan dipotong sesuai resep). Spoil = bahan rusak/kedaluwarsa.',
      fields: [
        {
          name: 'kind',
          label: 'Tipe',
          type: 'select',
          required: true,
          value: 'spoil',
          options: [
            { value: 'spoil', label: 'Spoil — bahan / setengah jadi rusak' },
            { value: 'waste', label: 'Waste — menu jadi terbuang' }
          ]
        },
        { name: 'product_spoil', label: 'Bahan', type: 'searchselect', options: productOptions },
        { name: 'product_waste', label: 'Menu', type: 'searchselect', options: menuOptions },
        { name: 'qty', label: 'Jumlah', type: 'number', required: true, min: 0 },
        { name: 'notes', label: 'Alasan (opsional)', type: 'text', placeholder: 'mis. kedaluwarsa / salah buat' }
      ],
      submitText: 'Simpan',
      onReady: (form) => {
        const kind = form.elements['kind'];
        const spoilField = form.querySelector('.search-select[data-name="product_spoil"]')?.closest('.field');
        const wasteField = form.querySelector('.search-select[data-name="product_waste"]')?.closest('.field');
        const sync = () => {
          const isWaste = kind.value === 'waste';
          if (spoilField) spoilField.style.display = isWaste ? 'none' : 'block';
          if (wasteField) wasteField.style.display = isWaste ? 'block' : 'none';
        };
        kind.addEventListener('change', sync);
        sync();
      }
    });
    if (!v) return;
    const qty = Math.abs(Number(v.qty));
    if (!(qty > 0)) return toast('Jumlah harus lebih dari 0.', 'warning');

    if (v.kind === 'waste') {
      if (!v.product_waste) return toast('Pilih menu yang terbuang.', 'warning');
      if (!menuProducts.length) return toast('Belum ada produk bertipe Menu.', 'warning');
      try {
        await recordMenuWaste({ businessUnitId, outletId: state.outletId, productId: v.product_waste, qty, notes: v.notes });
        toast('Waste menu tercatat — bahan dipotong sesuai resep.', 'success');
        stockMap = await refresh();
      } catch (error) {
        toast(error.message ?? 'Gagal mencatat waste menu.', 'error');
      }
      return;
    }
    if (!v.product_spoil) return toast('Pilih bahan yang rusak.', 'warning');
    await doMovement('waste', v.product_spoil, -qty, v.notes ? `Spoil: ${v.notes}` : 'Spoil');
  }));

  // ---- Stok Opname: tabel yang langsung diisi (bukan pop up per produk) ----
  // `saring` bawaannya SEMUA — tidak boleh ada bahan yang lenyap dari layar.
  //
  // Sempat saya buat bawaannya "Belum dihitung" supaya sisa pekerjaan terlihat
  // jelas. Itu salah untuk cara opname ini dipakai: hitungannya KUMULATIF.
  //
  // Susu ada 3 liter di kitchen dan 1 liter di bar, dan yang dicatat adalah
  // TOTAL outlet. Shenda (bar) harus MELIHAT angka 3 milik Adhe supaya bisa
  // mengubahnya jadi 4. Kalau barisnya hilang begitu Adhe menyimpan, Shenda
  // tidak punya apa pun untuk ditambah — dan tebakan yang paling wajar,
  // mengisi 1 sebagai jatahnya sendiri, menghapus hitungan Adhe.
  //
  // Yang belum dihitung tetap diangkat ke atas, jadi sisa pekerjaan tetap
  // mudah ditemukan tanpa perlu menyembunyikan apa pun.
  const opnameState = { open: false, category: '', q: '', saring: SARING.SEMUA };
  const categories = [...new Set(activeProducts.map((p) => p.category).filter(Boolean))].sort();

  container.querySelector('#inv-opname')?.addEventListener('click', () => {
    opnameState.open = !opnameState.open;
    renderOpnamePanel();
  });

  // Panel resep: hanya dibaca, tanpa rupiah. Digambar SEKALI saat pertama
  // dibuka lalu cukup disembunyikan — menggambar ulang tiap kali ditutup-buka
  // akan menghapus pencarian yang sedang diketik orangnya.
  const resepPanel = container.querySelector('#inv-resep-panel');
  let resepSudahDigambar = false;
  container.querySelector('#inv-resep')?.addEventListener('click', () => {
    const tampil = resepPanel.hasAttribute('hidden') || !resepSudahDigambar;
    if (!resepSudahDigambar) {
      resepPanel.innerHTML = `
        <div class="inline-card fade-in" style="max-width:100%">
          <div class="page-header" style="margin-bottom:8px">
            <h3 style="margin:0;font-size:1rem">Resep</h3>
            <button id="resep-close">Tutup</button>
          </div>
          <div id="resep-isi"></div>
        </div>`;
      renderResepStaff(resepPanel.querySelector('#resep-isi'), products, recipes);
      resepPanel.querySelector('#resep-close').addEventListener('click', () => resepPanel.setAttribute('hidden', ''));
      resepSudahDigambar = true;
    }
    if (tampil) resepPanel.removeAttribute('hidden');
    else resepPanel.setAttribute('hidden', '');
  });

  let sesi = null;
  // Hitungan yang SUDAH TERSIMPAN di server: produkId -> baris stock_count_items.
  let tersimpan = new Map();

  async function renderOpnamePanel() {
    const panel = container.querySelector('#inv-opname-panel');
    if (!opnameState.open) {
      panel.innerHTML = '';
      return;
    }
    sesi = await sesiTerbuka(state.outletId).catch(() => null);

    // TANPA PETA STOK, OPNAME TIDAK BOLEH DIBUKA SAMA SEKALI.
    //
    // `refresh()` mengembalikan `null` kalau pemuatan stok gagal (jaringan
    // putus, RLS menolak, PostgREST error). Sebelum penjaga ini, panel opname
    // tetap terbuka dan `stockMap?.get(pid) ?? 0` menjadikan SETIAP potret
    // sistem bernilai 0.
    //
    // Untuk pengisian stok awal itu kebetulan tidak berbahaya — sistemnya
    // memang 0. Tapi pada opname KEDUA dan seterusnya, akibatnya parah dan
    // sepenuhnya senyap: penyesuaiannya `dihitung − 0` = seluruh angkanya, jadi
    // beras yang tercatat 40 dan dihitung 38 tidak menghasilkan −2 melainkan
    // +38, dan saldonya melonjak jadi 78.
    //
    // Tidak ada error di mana pun. Layarnya menulis "sistem 0" untuk semua
    // bahan — yang justru terlihat masuk akal buat orang yang memang sedang
    // mengisi stok awal, dan tidak mencurigakan buat siapa pun yang lain.
    //
    // Jadi ditolak di depan. Kehilangan satu sesi hitung jauh lebih murah
    // daripada stok yang salah tanpa ada yang tahu kapan mulai salahnya.
    if (sesi && !stockMap) {
      panel.innerHTML = `
        <div class="inline-card fade-in" style="max-width:100%">
          <div class="page-header" style="margin-bottom:8px">
            <h3 style="margin:0;font-size:1rem">Stok Opname</h3>
            <button id="opname-close">Tutup</button>
          </div>
          <p class="error-text" style="margin:0 0 8px">Stok sistem gagal dimuat — opname belum bisa dibuka.</p>
          <p style="margin:0;font-size:0.85rem;color:var(--color-text-muted)">
            Hitungan opname disimpan sebagai <strong>selisih terhadap stok sistem</strong>, jadi angka sistemnya
            harus benar-benar terbaca dulu. Kalau tetap dilanjutkan tanpa itu, selisihnya akan dihitung dari
            angka nol dan stok akhirmu jadi keliru tanpa ada peringatan apa pun.
            <br /><br />
            Periksa koneksi, lalu tekan tombol di bawah.
          </p>
          <button class="primary" id="opname-ulang" style="max-width:220px;margin-top:10px">Muat ulang stok</button>
        </div>`;
      panel.querySelector('#opname-close').addEventListener('click', () => {
        opnameState.open = false;
        renderOpnamePanel();
      });
      panel.querySelector('#opname-ulang').addEventListener('click', async () => {
        // TANPA `?? stockMap`, dan itu disengaja.
        //
        // Di tempat lain pola `?? stockMap` dipakai untuk mempertahankan angka
        // lama saat pemuatan gagal — untuk sekadar MENAMPILKAN stok, data basi
        // lebih berguna daripada layar kosong.
        //
        // Untuk opname justru sebaliknya. Potret sistem yang basi menghasilkan
        // selisih yang salah dengan tenang: dihitung 145 sesudah nota 50 masuk
        // sementara potretnya masih 100 memberi +45, dan stoknya jadi 195.
        // Gagal terang-terangan lebih baik daripada berhasil dengan angka basi.
        stockMap = await refresh();
        renderOpnamePanel();
      });
      return;
    }

    // Tanpa sesi terbuka, tidak ada tempat menyimpan hitungan. Ditolak DI SINI
    // dengan kalimat yang menyebut siapa yang bisa membukanya — bukan dibiarkan
    // sampai orangnya selesai menghitung seratus bahan lalu ditolak server.
    if (!sesi) {
      panel.innerHTML = `
        <div class="inline-card fade-in" style="max-width:100%">
          <div class="page-header" style="margin-bottom:8px">
            <h3 style="margin:0;font-size:1rem">Stok Opname</h3>
            <button id="opname-close">Tutup</button>
          </div>
          <p style="margin:0;color:var(--color-text-muted)">
            Belum ada sesi opname yang dibuka untuk outlet ini.
            <br />Minta <strong>Admin BU</strong> membukanya dari Admin Portal → Inventory → Opname.
          </p>
        </div>`;
      panel.querySelector('#opname-close').addEventListener('click', () => {
        opnameState.open = false;
        renderOpnamePanel();
      });
      return;
    }

    // HITUNGAN YANG SUDAH TERSIMPAN DIMUAT LEBIH DULU.
    //
    // Ini yang dulu tidak ada, dan ketiadaannya adalah bug paling merugikan di
    // modul ini. Opname dikerjakan BERSAMA dan BERTAHAP — Adhe menghitung rak
    // kering pagi ini, Widyantoro melanjutkan chiller sorenya. Tanpa memuat
    // hitungan yang sudah masuk, kotaknya selalu kosong dan orang kedua tidak
    // punya satu pun cara tahu rak mana yang sudah didatangi.
    //
    // Dua akibatnya sama-sama senyap: bahan dihitung dua kali (yang kedua
    // menimpa yang pertama), atau bahan tidak dihitung sama sekali karena
    // masing-masing mengira yang lain sudah.
    //
    // Gagal memuatnya BUKAN alasan menampilkan panel kosong — panel kosong
    // terlihat persis seperti "belum ada yang menghitung", dan itu justru
    // kebohongan yang sedang diperbaiki. Jadi ditolak terang-terangan.
    try {
      const isi = await itemOpname(sesi.id);
      tersimpan = new Map(isi.map((b) => [b.product_id, b]));
    } catch (error) {
      panel.innerHTML = `
        <div class="inline-card fade-in" style="max-width:100%">
          <div class="page-header" style="margin-bottom:8px">
            <h3 style="margin:0;font-size:1rem">Stok Opname</h3>
            <button id="opname-close">Tutup</button>
          </div>
          <p class="error-text" style="margin:0 0 8px">Hitungan yang sudah masuk gagal dimuat.</p>
          <p style="margin:0;font-size:0.85rem;color:var(--color-text-muted)">
            Panel ini sengaja tidak dibuka: layar kosong akan terlihat persis seperti
            “belum ada yang menghitung”, dan kamu bisa menghitung ulang rak yang sebenarnya sudah selesai.
            <br /><br />${esc(error.message ?? error)}
          </p>
          <button class="primary" id="opname-ulang" style="max-width:220px;margin-top:10px">Coba lagi</button>
        </div>`;
      panel.querySelector('#opname-close').addEventListener('click', () => {
        opnameState.open = false;
        renderOpnamePanel();
      });
      panel.querySelector('#opname-ulang').addEventListener('click', () => renderOpnamePanel());
      return;
    }

    panel.innerHTML = `
      <div class="inline-card fade-in" style="max-width:100%;padding-top:0">
        <div class="panel-lengket-atas">
          <div class="page-header" style="margin:0 0 6px">
            <h3 style="margin:0;font-size:1rem">Stok Opname — ${esc(outlets.find((o) => o.id === state.outletId)?.name ?? '')}</h3>
            <button id="opname-close">Tutup</button>
          </div>
          <p style="margin:0 0 8px;font-size:0.8rem;color:var(--color-text-muted)">
            <strong>${esc(sesi.code)}</strong> · dibuka ${esc(sesi.pembuka?.full_name ?? '-')} ·
            stok belum berubah sampai admin menutup sesi
          </p>

          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
            <div class="field" style="margin:0;flex:1;min-width:120px"><label>Kategori</label>
              <select id="opname-cat"><option value="">Semua</option>${categories.map((c) => `<option value="${esc(c)}"${c === opnameState.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
            </div>
            <div class="field" style="margin:0;flex:1;min-width:120px"><label>Status</label>
              <select id="opname-saring">
                <option value="${SARING.SEMUA}"${opnameState.saring === SARING.SEMUA ? ' selected' : ''}>Semua</option>
                <option value="${SARING.BELUM}"${opnameState.saring === SARING.BELUM ? ' selected' : ''}>Belum dihitung</option>
                <option value="${SARING.SUDAH}"${opnameState.saring === SARING.SUDAH ? ' selected' : ''}>Sudah dihitung</option>
              </select>
            </div>
            <div class="field" style="margin:0;flex:1.4;min-width:140px"><label>Cari bahan</label>
              <input type="search" id="opname-q" placeholder="ketik nama bahan…" value="${esc(opnameState.q)}"
                     autocomplete="off" enterkeyhint="search" />
            </div>
          </div>

          <!-- TOMBOL SIMPAN DI HEADER, seperti layar Penjualan.
               Daftar bahan bisa dua ratus baris; tombol yang cuma ada di
               bawahnya memaksa orang menggulir melewati seluruh daftar untuk
               menyimpan lima isian di bagian atas — dan yang paling sering
               terjadi, ia lupa. -->
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
            <button class="primary" id="opname-save" style="flex:1;min-width:170px">Simpan Hasil Opname</button>
            <button id="opname-clear">Kosongkan Isian</button>
          </div>
          <div id="opname-kemajuan" style="margin-top:8px"></div>
        </div>

        <div id="opname-rows" class="gulir-baris" style="--tinggi-baris:74px;margin-top:8px"></div>
      </div>`;

    const rowsBox = panel.querySelector('#opname-rows');
    const draft = new Map(); // productId -> nilai yang sedang diketik

    function renderRows() {
      // Saringan kategori & pencarian dulu; status hitung diurus modul murni.
      const cocok = activeProducts.filter(
        (p) =>
          (!opnameState.category || p.category === opnameState.category) &&
          (!opnameState.q || fuzzyMatch(opnameState.q, `${p.name} ${p.category ?? ''} ${p.subcategory ?? ''}`))
      );

      const h = susunDaftar(cocok, { tersimpan, draft, saring: opnameState.saring });
      const list = h.baris;

      // KEMAJUAN DIHITUNG DARI YANG TERSIMPAN DI SERVER, bukan dari isian lokal.
      //
      // Versi lama menghitung `draft.has(...)` — isian di HP ini saja. Angkanya
      // selalu mulai dari 0 tiap kali panel dibuka, walau rekannya sudah
      // menghitung separuh gudang. "0 dari 5" pada sesi yang sudah 60% selesai
      // bukan sekadar tidak membantu; ia menyuruh orang mengulang pekerjaan
      // yang sudah beres.
      const kemajuan = panel.querySelector('#opname-kemajuan');
      const persen = h.total ? Math.round((h.selesai / h.total) * 100) : 0;
      kemajuan.innerHTML = `
        <div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:4px">
          <span><strong>${h.selesai}</strong> dari <strong>${h.total}</strong> bahan sudah dihitung</span>
          <span style="color:var(--color-text-muted)">${h.belum} belum</span>
        </div>
        <div class="opname-bar"><div class="opname-bar-isi" style="width:${persen}%"></div></div>
        ${
          h.belumTersimpan
            ? `<p class="error-text" style="font-size:0.76rem;margin:6px 0 0">
                 ${h.belumTersimpan} isian belum tersimpan — tekan <strong>Simpan Hasil Opname</strong> sebelum menutup halaman.
               </p>`
            : ''
        }`;

      // KARTU, BUKAN TABEL.
      //
      // Opname dikerjakan sambil berdiri di depan rak, satu tangan memegang HP.
      // Bentuk tabel memaksa kolom nama dibekukan supaya tidak hilang saat
      // digulir — dan nama bahan panjang ("Susu UHT Full Cream 1L") memakan
      // hampir seluruh lebar layar, sehingga kolom Stok Fisik terdorong ke
      // kanan, di luar layar. Orangnya harus menggulir mendatar untuk SETIAP
      // baris, lalu menggulir balik untuk memastikan sedang mengisi bahan yang
      // benar. Di rak yang gelap dan sempit, itu jalan tercepat menuju salah
      // isi.
      //
      // Kartu membuang gulir mendatar sama sekali: nama di atas, kotak isian di
      // bawahnya dengan lebar penuh. Tidak ada yang perlu dibekukan karena
      // tidak ada yang bisa hilang.
      rowsBox.innerHTML = `
        <div class="opname-list">
          ${
            list
              .map((p) => {
                const sys = stockMap.get(p.id) ?? 0;
                const val = nilaiKotak(draft, tersimpan, p.id);
                const selesai = sudahDihitung(tersimpan, p.id);
                const ket = keteranganHitung(tersimpan, p.id);
                return `<div class="opname-kartu${selesai ? ' opname-selesai' : ''}" data-p="${p.id}">
                  <div class="opname-nama">${selesai ? '<span class="opname-centang">✓</span> ' : ''}${esc(p.name)}</div>
                  <div class="opname-meta">${esc(p.category ?? 'Tanpa kategori')} · sistem <strong>${formatNum(sys)}</strong> ${esc(p.base_unit)}</div>
                  ${
                    // ANGKA YANG SUDAH TERSIMPAN DISEBUT TERANG-TERANGAN,
                    // bukan cuma diam-diam menjadi isi kotaknya.
                    //
                    // Hitungannya kumulatif: Shenda harus tahu bahwa 3 di
                    // kotak itu MILIK Adhe dan bagiannya harus DITAMBAHKAN,
                    // bukan menggantikan. Kalau angkanya hanya muncul sebagai
                    // isi kotak, ia terlihat seperti isian sendiri yang tinggal
                    // ditimpa — dan menimpanya menghapus hitungan rekannya.
                    //
                    // Nama & jamnya ikut supaya "kok angkanya beda dari yang
                    // saya lihat di rak" bisa ditanyakan ke orangnya langsung.
                    ket
                      ? `<div class="opname-jejak">
                           Sudah terisi <strong>${formatNum(tersimpan.get(p.id)?.counted_qty ?? 0)} ${esc(p.base_unit)}</strong> · ${esc(ket)}
                           <br /><span class="opname-jejak-tambah">Kalau kamu menemukan lagi di tempat lain, TAMBAHKAN ke angka ini.</span>
                         </div>`
                      : ''
                  }
                  <div class="opname-isi">
                    <input type="number" class="opname-input" data-p="${p.id}" data-sys="${sys}" min="0" step="any"
                      inputmode="decimal" placeholder="stok fisik" value="${esc(val)}" aria-label="Stok fisik ${esc(p.name)}" />
                    <span class="opname-satuan">${esc(p.base_unit)}</span>
                    <span class="opname-diff" data-p="${p.id}">-</span>
                  </div>
                  <div class="opname-turun" data-p="${p.id}" hidden></div>
                </div>`;
              })
              .join('') ||
            `<p style="color:var(--color-text-muted);padding:10px 2px">${
              opnameState.saring === SARING.BELUM && h.total
                ? 'Semua bahan pada saringan ini sudah dihitung. 🎉'
                : 'Tidak ada bahan pada filter ini.'
            }</p>`
          }
        </div>`;

      rowsBox.querySelectorAll('.opname-input').forEach((inp) => {
        const updateDiff = () => {
          const cell = rowsBox.querySelector(`.opname-diff[data-p="${inp.dataset.p}"]`);
          if (inp.value === '') {
            // Dicatat sebagai string kosong, BUKAN dihapus dari `draft`.
            //
            // Menghapusnya membuat `nilaiKotak()` jatuh kembali ke angka
            // server, jadi kotak yang baru saja dikosongkan orangnya akan
            // terisi lagi sendiri pada penggambaran berikutnya — dan ia akan
            // mengira aplikasinya menolak hapusannya.
            draft.set(inp.dataset.p, '');
            cell.textContent = '-';
            cell.style.color = 'var(--color-text-muted)';
            return;
          }
          draft.set(inp.dataset.p, inp.value);
          const diff = Number(inp.value) - Number(inp.dataset.sys);
          cell.textContent = diff === 0 ? 'sesuai' : `${diff > 0 ? '+' : ''}${formatNum(diff)}`;
          cell.style.color = diff === 0 ? 'var(--color-text-muted)' : diff > 0 ? 'var(--color-primary)' : 'var(--color-danger)';

          // ANGKA YANG TURUN DIPERINGATKAN, TIDAK DIHALANGI.
          //
          // Pada hitungan yang menumpuk, angka baru yang lebih kecil hampir
          // selalu berarti orangnya mengisi jatah divisinya sendiri, bukan
          // total outlet — dan itu menghapus hitungan rekannya.
          //
          // Tapi turun juga bisa BENAR: yang pertama salah hitung, barangnya
          // terpakai di antara dua hitungan, atau memang salah ketik. Jadi ini
          // keterangan di sebelah kotaknya, bukan dialog dan bukan tombol yang
          // dikunci. Opname yang macet menghasilkan stok yang lebih salah lagi
          // daripada satu angka yang keliru.
          const kotakTurun = rowsBox.querySelector(`.opname-turun[data-p="${inp.dataset.p}"]`);
          const pesanTurun = peringatanTurun(tersimpan, inp.dataset.p, inp.value);
          if (kotakTurun) {
            kotakTurun.textContent = pesanTurun ? `⚠ ${pesanTurun} — sudah ditambahkan?` : '';
            kotakTurun.hidden = !pesanTurun;
          }
        };
        inp.addEventListener('input', () => {
          updateDiff();
          // HANYA peringatan "belum tersimpan" yang diperbarui, bukan seluruh
          // daftar. Menggambar ulang saat mengetik membuang fokus dari kotak
          // yang sedang diisi — dan di HP itu berarti papan ketiknya tertutup
          // setiap angka. Kartunya juga akan melompat posisi karena yang baru
          // terisi naik/turun kelompok.
          tandaBelumTersimpan();
        });
        updateDiff();
      });
    }

    /** Perbarui angka "belum tersimpan" saja, tanpa menyentuh daftarnya. */
    function tandaBelumTersimpan() {
      const kotak = panel.querySelector('#opname-kemajuan .error-text');
      const n = hitungBelumTersimpan(draft, tersimpan);
      if (n && kotak) {
        kotak.innerHTML = `${n} isian belum tersimpan — tekan <strong>Simpan Hasil Opname</strong> sebelum menutup halaman.`;
      } else if (n && !kotak) {
        panel.querySelector('#opname-kemajuan').insertAdjacentHTML(
          'beforeend',
          `<p class="error-text" style="font-size:0.76rem;margin:6px 0 0">${n} isian belum tersimpan — tekan <strong>Simpan Hasil Opname</strong> sebelum menutup halaman.</p>`
        );
      } else if (!n && kotak) {
        kotak.remove();
      }
    }

    panel.querySelector('#opname-close').addEventListener('click', () => {
      opnameState.open = false;
      renderOpnamePanel();
    });
    panel.querySelector('#opname-cat').addEventListener('change', (e) => {
      opnameState.category = e.target.value;
      renderRows();
    });
    panel.querySelector('#opname-q').addEventListener('input', (e) => {
      opnameState.q = e.target.value;
      renderRows();
    });
    panel.querySelector('#opname-saring').addEventListener('change', (e) => {
      opnameState.saring = e.target.value;
      renderRows();
    });
    panel.querySelector('#opname-clear').addEventListener('click', () => {
      // Yang dibuang hanya ketikan yang BELUM terkirim. Hitungan yang sudah
      // tersimpan di server tetap ada dan muncul kembali di kotaknya — tombol
      // ini bukan "batalkan opname", dan tidak boleh terasa begitu.
      draft.clear();
      renderRows();
    });

    panel.querySelector('#opname-save').addEventListener('click', async (e) => {
      if (!sesi) {
        toast('Belum ada sesi opname yang terbuka. Minta admin membukanya dulu.', 'warning');
        return;
      }

      // PENJAGA KEDUA, dan bukan pengulangan yang sia-sia.
      //
      // Penjaga pertama berjalan saat panel DIBUKA. Panel ini bisa terbuka
      // lama — orang menghitung isi rak sambil membawa HP — dan `stockMap`
      // bisa berubah jadi null di tengah jalan lewat tombol muat ulang mana
      // pun yang gagal. Yang menentukan benar-salahnya angka adalah keadaan
      // pada DETIK DISIMPAN, bukan detik panelnya dibuka.
      if (!stockMap) {
        toast(
          'Stok sistem tidak terbaca, jadi hitungan ini tidak bisa disimpan — selisihnya akan dihitung dari nol ' +
            'dan stokmu jadi keliru. Tutup panel, muat ulang stoknya, lalu isi lagi.',
          'error'
        );
        return;
      }

      // SEMUA yang diisi dikirim, termasuk yang selisihnya nol.
      //
      // Versi lama hanya mengirim yang berselisih, dengan alasan "tidak ada yang
      // perlu dikoreksi". Tapi di sesi bernomor, "dihitung dan ternyata cocok"
      // adalah informasi yang berbeda dari "belum dihitung" — dan justru itu
      // yang membedakan opname yang tuntas dari opname yang berhenti separuh
      // jalan. Yang tidak diisi tetap tidak dikirim.
      const isian = [];
      for (const [pid, raw] of draft.entries()) {
        if (raw === '') continue;
        // POTRET STOK TIDAK LAGI DIKIRIM DARI SINI.
        //
        // Sejak 0114, server yang membacanya saat menyimpan. `stockMap` di
        // layar tetap dipakai untuk MENAMPILKAN angka sistem dan menghitung
        // selisih di layar — dua hal yang boleh basi tanpa merusak apa pun —
        // tapi tidak lagi menentukan penyesuaian stoknya.
        //
        // Bug yang ditutupnya: peta dimuat saat halaman dibuka, orangnya
        // menghitung sejam, stoknya berubah di sela itu, dan yang terkirim
        // adalah angka lama — atau NOL untuk bahan yang tadinya belum
        // bergerak. Nanas 6.400 dihitung 4.600 menghasilkan 11.000.
        isian.push({ pid, counted: Number(raw) });
      }
      if (!isian.length) {
        toast('Belum ada bahan yang diisi.', 'info');
        return;
      }

      e.target.disabled = true;
      // DINAMAI `terkirim`, BUKAN `tersimpan`.
      //
      // `tersimpan` sudah dipakai untuk peta hitungan-dari-server di cakupan
      // luar. Penghitung bernama sama akan MENUTUPINYA di dalam blok ini —
      // dan karena JavaScript tidak mengeluh, kesalahannya baru terasa sebagai
      // daftar yang tiba-tiba menganggap semua bahan belum dihitung.
      let terkirim = 0;
      try {
        for (const it of isian) {
          await catatHitungan({ countId: sesi.id, productId: it.pid, counted: it.counted });
          terkirim++;
        }
        // Sengaja TIDAK menyebut "stok dikoreksi": stok belum bergerak sama
        // sekali. Menulis "tersimpan" untuk sesuatu yang mengubah stok padahal
        // tidak, adalah cara tercepat membuat orang salah paham soal kapan
        // angkanya benar-benar berlaku.
        toast(`${terkirim} hitungan tersimpan ke ${sesi.code}. Stok berubah setelah admin menutup sesi.`, 'success');

        // PANELNYA TETAP TERBUKA, hanya dimuat ulang.
        //
        // Versi lama menutup panel sesudah menyimpan. Itu masuk akal ketika
        // layar ini tidak bisa menampilkan apa pun yang sudah tersimpan —
        // tidak ada yang perlu dilihat. Sekarang justru sebaliknya: sesudah
        // menyimpan, orangnya ingin melihat centangnya bertambah dan
        // melanjutkan ke bahan berikutnya. Menutup panel memaksa ia membuka
        // ulang dan mencari posisinya lagi, tiap kali menyimpan.
        //
        // `draft` ikut dibuang lewat penggambaran ulang: isiannya sudah ada di
        // server, jadi kotaknya akan terisi dari sana. Menyimpannya di dua
        // tempat berarti salah satunya cepat atau lambat jadi basi.
        await renderOpnamePanel();
      } catch (error) {
        toast(`${error.message ?? 'Gagal menyimpan hitungan.'} (${terkirim} tersimpan)`, 'error');
        e.target.disabled = false;
      }
    });

    renderRows();
  }

  // TOMBOL TRANSFER DIHAPUS DARI STAFF APP.
  //
  // Memindahkan bahan antar outlet punya DUA jalan sebelumnya: tombol ini, dan
  // modul Pengiriman. Keduanya menghasilkan pergerakan stok yang sama, tapi
  // hanya Pengiriman yang punya surat jalan, nomor, dan penerimaan di sisi
  // tujuan. Barang yang dipindahkan lewat jalur ini sampai tanpa satu pun
  // dokumen — dan saat stok tidak cocok, tidak ada yang bisa ditelusuri.
  //
  // `transferStock()` di service ikut dihapus, karena sesudah tombol ini
  // hilang tidak ada layar mana pun yang memanggilnya. (Saya sempat menulis
  // di sini bahwa Admin Portal masih memakainya — itu keliru, dan komentar
  // yang salah mengirim orang mencari pemakaian yang tidak ada.)
  //
  // RPC `transfer_stock` di database tetap ada untuk koreksi darurat lewat
  // SQL Editor.

  async function doMovement(type, productId, qtyDelta, notes) {
    try {
      await recordMovement({
        businessUnitId,
        outletId: state.outletId,
        productId,
        movementType: type,
        qtyDelta,
        unitCost: costs.get(productId) ?? null,
        notes
      });
      toast(`${productById.get(productId)?.name ?? 'Stok'} tercatat.`, 'success');
      stockMap = await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan pergerakan.', 'error');
    }
  }
}

function round(n) {
  return Math.round(Number(n) * 100) / 100;
}
function esc(s) {
  return escapeHtml(s);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
