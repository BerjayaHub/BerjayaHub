import { toast, formDialog, confirmDialog, fuzzyMatch } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { listProducts, listRecipesFull, computeCosts } from '../product/product.service.js';
import { getOutletStockMap, recordMovement, getAllowStaffOpname, recordMenuWaste } from './inventory.service.js';
import { listMyOutlets } from '../../core/my-outlets.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { cocokNama } from '../../core/nama.js';
import { renderResepStaff } from './resep-staff.js';
import { sesiTerbuka, catatHitungan } from './opname.service.js';
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
    <h1>Bahan</h1>
    <div class="field" style="max-width:280px">
      <label>Outlet</label>
      <select id="inv-outlet">${outlets.map((o) => `<option value="${o.id}"${o.id === state.outletId ? ' selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}</select>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="primary" id="inv-receive" style="max-width:220px">📥 Terima dari Supplier</button>
      <button id="inv-waste">🗑️ Waste / Spoil</button>
      ${allowOpname ? '<button id="inv-opname">📋 Stok Opname</button>' : ''}
      <button id="inv-resep">📖 Resep</button>
      <button id="inv-menipis">⚠️ Bahan Menipis</button>
    </div>
    <div id="inv-nota-panel" hidden></div>
    <div id="inv-menipis-panel" hidden></div>
    <div id="inv-opname-panel"></div>
    <div id="inv-resep-panel"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px">
      <div class="field" style="margin:0;max-width:200px">
        <label>Kategori</label>
        <select id="inv-cat"><option value="">Semua</option>${[...new Set(activeProducts.map((p) => p.category).filter(Boolean))]
          .sort()
          .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
          .join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:240px">
        <label>Cari nama</label>
        <input type="search" id="inv-q" placeholder="ketik nama bahan…" autocomplete="off" />
      </div>
    </div>
    <div id="inv-stock"></div>
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
    const tampil = activeProducts.filter((p) => (!cat || p.category === cat) && cocokNama(`${p.name} ${p.category ?? ''}`, q));
    stockDiv.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 6px">
        ${tampil.length === activeProducts.length ? `${activeProducts.length} bahan` : `${tampil.length} dari ${activeProducts.length} bahan`}
      </p>
      <div class="table-scroll"><table class="data-table table-freeze-1">
        <thead><tr><th>Produk</th><th>Stok</th><th>Satuan</th></tr></thead>
        <tbody>
          ${
            tampil
              .map((p) => {
                const qty = map.get(p.id) ?? 0;
                return `<tr><td>${escapeHtml(p.name)}</td><td>${formatNum(qty)}</td><td>${escapeHtml(p.base_unit)}</td></tr>`;
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
  const opnameState = { open: false, category: '', q: '' };
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

  async function renderOpnamePanel() {
    const panel = container.querySelector('#inv-opname-panel');
    if (!opnameState.open) {
      panel.innerHTML = '';
      return;
    }
    sesi = await sesiTerbuka(state.outletId).catch(() => null);

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

    panel.innerHTML = `
      <div class="inline-card fade-in" style="max-width:100%">
        <div class="page-header" style="margin-bottom:8px">
          <h3 style="margin:0;font-size:1rem">Stok Opname — ${esc(outlets.find((o) => o.id === state.outletId)?.name ?? '')}</h3>
          <button id="opname-close">Tutup</button>
        </div>
        <p style="margin:0 0 10px;font-size:0.85rem">
          Nomor <strong>${esc(sesi.code)}</strong> · dibuka ${esc(sesi.pembuka?.full_name ?? '-')}
          <br /><span style="color:var(--color-text-muted)">
            Hitunganmu bisa diubah berkali-kali. <strong>Stok belum berubah</strong> sampai admin menutup sesi ini.
          </span>
        </p>
        <p style="font-size:0.83rem;color:var(--color-text-muted);margin:0 0 10px">
          Isi <strong>Stok Fisik</strong> hasil hitung di lapangan. Baris yang dikosongkan diabaikan; selisih dihitung otomatis.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
          <div class="field" style="margin:0;max-width:200px"><label>Kategori</label>
            <select id="opname-cat"><option value="">Semua</option>${categories.map((c) => `<option value="${esc(c)}"${c === opnameState.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
          </div>
          <div class="field" style="margin:0;max-width:240px"><label>Cari bahan</label>
            <input type="text" id="opname-q" placeholder="ketik nama bahan…" value="${esc(opnameState.q)}" />
          </div>
        </div>
        <div id="opname-rows"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="primary" id="opname-save" style="max-width:220px">Simpan Hasil Opname</button>
          <button id="opname-clear">Kosongkan Isian</button>
        </div>
      </div>`;

    const rowsBox = panel.querySelector('#opname-rows');
    const draft = new Map(); // productId -> nilai yang sedang diketik

    function renderRows() {
      const list = activeProducts.filter(
        (p) =>
          (!opnameState.category || p.category === opnameState.category) &&
          (!opnameState.q || fuzzyMatch(opnameState.q, `${p.name} ${p.category ?? ''} ${p.subcategory ?? ''}`))
      );
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
      const sudahIsi = list.filter((p) => draft.has(p.id)).length;
      rowsBox.innerHTML = `
        <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">
          <strong class="opname-kemajuan">${sudahIsi}</strong> dari <strong>${list.length}</strong> bahan sudah diisi.
          Yang dikosongkan tidak ikut tersimpan.
        </p>
        <div class="opname-list">
          ${
            list
              .map((p) => {
                const sys = stockMap?.get(p.id) ?? 0;
                const val = draft.has(p.id) ? draft.get(p.id) : '';
                return `<div class="opname-kartu" data-p="${p.id}">
                  <div class="opname-nama">${esc(p.name)}</div>
                  <div class="opname-meta">${esc(p.category ?? 'Tanpa kategori')} · sistem <strong>${formatNum(sys)}</strong> ${esc(p.base_unit)}</div>
                  <div class="opname-isi">
                    <input type="number" class="opname-input" data-p="${p.id}" data-sys="${sys}" min="0" step="any"
                      inputmode="decimal" placeholder="stok fisik" value="${val}" aria-label="Stok fisik ${esc(p.name)}" />
                    <span class="opname-satuan">${esc(p.base_unit)}</span>
                    <span class="opname-diff" data-p="${p.id}">-</span>
                  </div>
                </div>`;
              })
              .join('') || '<p style="color:var(--color-text-muted)">Tidak ada bahan pada filter ini.</p>'
          }
        </div>`;

      rowsBox.querySelectorAll('.opname-input').forEach((inp) => {
        const updateDiff = () => {
          const cell = rowsBox.querySelector(`.opname-diff[data-p="${inp.dataset.p}"]`);
          if (inp.value === '') {
            draft.delete(inp.dataset.p);
            cell.textContent = '-';
            cell.style.color = 'var(--color-text-muted)';
            return;
          }
          draft.set(inp.dataset.p, inp.value);
          const diff = Number(inp.value) - Number(inp.dataset.sys);
          cell.textContent = diff === 0 ? 'sesuai' : `${diff > 0 ? '+' : ''}${formatNum(diff)}`;
          cell.style.color = diff === 0 ? 'var(--color-text-muted)' : diff > 0 ? 'var(--color-primary)' : 'var(--color-danger)';
        };
        inp.addEventListener('input', () => {
          updateDiff();
          // Penghitung kemajuan diperbarui di tempat. Menggambar ulang seluruh
          // daftar akan membuat kotak yang sedang diketik kehilangan fokus —
          // dan di HP itu berarti papan ketiknya ikut tertutup setiap angka.
          const info = rowsBox.querySelector('.opname-kemajuan');
          if (info) info.textContent = String(list.filter((p) => draft.has(p.id)).length);
        });
        updateDiff();
      });
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
    panel.querySelector('#opname-clear').addEventListener('click', () => {
      draft.clear();
      renderRows();
    });

    panel.querySelector('#opname-save').addEventListener('click', async (e) => {
      if (!sesi) {
        toast('Belum ada sesi opname yang terbuka. Minta admin membukanya dulu.', 'warning');
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
        isian.push({ pid, counted: Number(raw), sys: stockMap?.get(pid) ?? 0 });
      }
      if (!isian.length) {
        toast('Belum ada bahan yang diisi.', 'info');
        return;
      }

      e.target.disabled = true;
      let tersimpan = 0;
      try {
        for (const it of isian) {
          await catatHitungan({ countId: sesi.id, productId: it.pid, counted: it.counted, systemQty: it.sys });
          tersimpan++;
        }
        // Sengaja TIDAK menyebut "stok dikoreksi": stok belum bergerak sama
        // sekali. Menulis "tersimpan" untuk sesuatu yang mengubah stok padahal
        // tidak, adalah cara tercepat membuat orang salah paham soal kapan
        // angkanya benar-benar berlaku.
        toast(`${tersimpan} hitungan tersimpan ke ${sesi.code}. Stok berubah setelah admin menutup sesi.`, 'success');
        opnameState.open = false;
        renderOpnamePanel();
      } catch (error) {
        toast(`${error.message ?? 'Gagal menyimpan hitungan.'} (${tersimpan} tersimpan)`, 'error');
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
