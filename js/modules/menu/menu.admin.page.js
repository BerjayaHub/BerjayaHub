import { toast, confirmDialog, formDialog } from '../../core/ui.js';
import { formatRupiah, formatNum, formatThousands, parseNumber, attachThousandsInput } from '../../core/format.js';
import { createProduct, listProducts, listRecipesFull, costForMode, sebabHppKosong, pindahVarianResep, updateSalePrice, updateProductCategory, deleteRecipe } from '../product/product.service.js';
import { openRecipeEditor, MODE_LABEL } from '../product/recipe-editor.js';
import { downloadMenuTemplate } from '../product/product-import.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { listMenuOutlet, setMenuOutlet } from './menu-outlet.service.js';
import { petaMenuOutlet, keadaanMenu, validasiSimpan, ringkasMenu, SEMUA, TERPILIH } from './menu-outlet.js';
import { listOutletsForBu } from '../organization/organization.service.js';
import { sayaAdminBu } from '../../core/base-scope.js';
import { bakukanNama } from '../../core/nama.js';
import { pemakaiResep } from '../product/recipe-graph.js';
import { periksaPindah, pasanganVarian } from '../product/varian-pindah.js';

const MENU_MODES = ['standalone', 'served_by_ck'];

/**
 * Modul Menu (Admin Portal).
 *
 * SISTEMATIKANYA SENGAJA DISAMAKAN dengan tab Resep di Master Produk, karena
 * keduanya menjawab pertanyaan yang sama — "apa isi menu ini dan berapa
 * modalnya" — dan sebelumnya dijawab dengan dua cara berbeda:
 *
 *   - Tombol resepnya dulu bertuliskan "Standalone" / "Dilayani CK": nama
 *     varian tanpa kata kerja, jadi terbaca sebagai LABEL. Itu sebabnya form
 *     isian resep dikira tidak ada.
 *   - Bahannya tidak bisa dilihat tanpa membuka editor satu per satu.
 *   - Editornya muncul di DASAR halaman, jauh dari baris yang diketuk — di HP
 *     itu berarti keluar dari layar.
 *
 * Sekarang: ketuk baris -> bahannya tampil di tempat, dengan tombol
 * "+ Isi resep" / "✎ Ubah resep" di dalam baris itu juga.
 */
export async function renderMenuAdminPage(container, { businessUnitId }) {
  container.innerHTML = `<h1>Menu</h1>${loadingHtml('Memuat menu…')}`;

  let products;
  let recipes;
  let bolehUbah = false;
  let outletsBU = [];
  let barisMenuOutlet;
  try {
    [products, recipes, bolehUbah, outletsBU, barisMenuOutlet] = await Promise.all([
      listProducts(businessUnitId),
      listRecipesFull(businessUnitId),
      sayaAdminBu(businessUnitId).catch(() => false),
      // SELURUH OUTLET BU, bukan "outlet yang saya kelola" — dan ini bukan
      // kelalaian terhadap audit-outlet-tulis.
      //
      // `set_menu_outlet` mengganti SELURUH daftar outlet menu itu dalam satu
      // langkah. Kalau kotak centangnya cuma berisi sebagian outlet, menekan
      // Simpan akan MENGHAPUS outlet yang tidak terlihat dari daftar izinnya —
      // menu yang tadinya dijual di lima outlet mendadak hanya di tiga, dan
      // yang menekan Simpan tidak pernah melihat dua yang hilang.
      //
      // Daftar yang tidak lengkap pada layar "ganti semuanya" bukan pembatasan
      // izin; ia penghapusan data yang tidak terlihat. Wewenangnya sendiri
      // dijaga di tempat yang benar: `sayaAdminBu()` di layar (tombolnya tidak
      // digambar) dan `is_bu_admin()` di dalam RPC-nya.
      listOutletsForBu(businessUnitId).catch(() => []),
      // KEGAGALANNYA TIDAK DITELAN JADI PETA KOSONG.
      //
      // Peta kosong berarti "tidak ada menu yang dibatasi" — tidak bisa
      // dibedakan dari "gagal dimuat". Kalau ditelan, kolom Outlet akan
      // menulis "Semua outlet" dengan yakin untuk menu yang sebenarnya
      // dibatasi, dan admin yang menekan Simpan di sana akan MENGHAPUS
      // pembatasan yang sudah ada tanpa pernah melihatnya.
      listMenuOutlet(businessUnitId).then(
        (r) => ({ ok: true, baris: r }),
        (e) => ({ ok: false, pesan: e.message ?? String(e) })
      )
    ]);
  } catch (error) {
    container.innerHTML = `<h1>Menu</h1><p class="error-text">${esc(error.message ?? error)}</p>`;
    return;
  }
  const menus = products.filter((p) => p.product_type === 'finished');
  const namaProduk = new Map(products.map((p) => [p.id, p]));
  const categories = [...new Set(menus.map((m) => m.category).filter(Boolean))].sort();
  const subKategori = [...new Set(menus.map((m) => m.subcategory).filter(Boolean))].sort();
  let resepPer = new Map(recipes.map((r) => [`${r.product_id}|${r.mode}`, r]));
  const state = { category: '', subcategory: '', q: '', terbuka: new Set() };

  // Outlet yang boleh dicentang, dan pembatasan yang sedang berlaku.
  const outletAktifBU = (outletsBU ?? []).filter((o) => o.is_active !== false);
  const moGagal = barisMenuOutlet?.ok === false;
  let petaMO = petaMenuOutlet(moGagal ? [] : (barisMenuOutlet?.baris ?? []));

  container.innerHTML = `
    <div class="page-header">
      <h1 style="margin:0">Menu</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="mn-tpl">Template Menu</button>
        ${bolehUbah ? '<button class="primary" id="mn-baru" style="max-width:180px">+ Tambah Menu</button>' : ''}
      </div>
    </div>
    <p style="color:var(--color-text-muted);font-size:0.88rem;margin:0 0 12px;max-width:620px">
      Semua produk bertipe <strong>Menu</strong>. HPP dihitung otomatis dari resep + harga bahan.
      Menu baru bisa ditambahkan langsung lewat <strong>+ Tambah Menu</strong>, atau sekaligus banyak lewat
      Import Excel di Master Produk — unduh <strong>Template Menu</strong> di atas, kolom Tipe-nya sudah terisi.
      ${bolehUbah ? 'Harga jual bisa diubah langsung di tabel.' : '<br /><strong>Harga jual & resep hanya bisa diubah Admin BU</strong> — di sini kamu bisa memeriksanya, tapi tidak menyimpannya.'}
    </p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="margin:0;max-width:220px"><label>Kategori</label>
        <select id="mn-cat"><option value="">Semua</option>${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:220px"><label>Sub kategori</label>
        <select id="mn-sub"><option value="">Semua</option>${subKategori.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;max-width:260px"><label>Cari menu</label>
        <input type="search" id="mn-q" placeholder="ketik nama menu…" autocomplete="off" />
        <span class="field-help" id="mn-info"></span>
      </div>
    </div>
    <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">
      Ketuk baris menu untuk melihat bahan tiap varian${bolehUbah ? ' dan mengubahnya' : ''}.${bolehUbah ? ' Kategori bisa diketik langsung di kolomnya — bebas, bukan pilihan tetap.' : ''}
    </p>
    <div id="mn-table"></div>
  `;

  // Datalist kategori ditaruh DI LUAR #mn-table karena isi tabel digambar ulang
  // setiap penyaringan — dan dialog "Tambah Menu" bisa dibuka kapan saja,
  // termasuk saat tabelnya sedang kosong karena saringan.
  const daftarKat = document.createElement('datalist');
  daftarKat.id = 'mn-cat-list';
  daftarKat.innerHTML = categories.map((c) => `<option value="${esc(c)}"></option>`).join('');
  container.appendChild(daftarKat);

  const tableBox = container.querySelector('#mn-table');
  const infoEl = container.querySelector('#mn-info');

  /**
   * Pencocokan nama memakai `bakukanNama()` yang sama dengan impor & tab Resep.
   *
   * Sebelumnya memakai pencocokan sendiri yang tidak membakukan spasi ganda dan
   * karakter tak terlihat dari Excel — jadi mengetik "es kopi susu" bisa gagal
   * menemukan "Es Kopi  Susu", dan orangnya menyimpulkan menunya belum ada.
   * Dua layar yang menjawab pertanyaan sama harus mencocokkan dengan cara sama.
   */
  const cocok = (menu) => {
    if (state.category && menu.category !== state.category) return false;
    // Sub kategori disaring TERPISAH dari kategori, bukan menggantikannya:
    // "Minuman → Kopi" dan "Minuman → Teh" sama-sama Minuman, dan yang dicari
    // orangnya biasanya salah satunya, bukan keduanya.
    if (state.subcategory && menu.subcategory !== state.subcategory) return false;
    const q = bakukanNama(state.q);
    if (!q) return true;
    return bakukanNama(`${menu.name} ${menu.category ?? ''} ${menu.subcategory ?? ''}`).includes(q);
  };

  function renderTable() {
    const list = menus.filter(cocok);
    infoEl.textContent = !bakukanNama(state.q)
      ? `${menus.length} menu`
      : list.length
        ? `${list.length} dari ${menus.length} menu`
        : `Tidak ada menu bernama "${state.q.trim()}"`;

    // Kategori diketik BEBAS, dengan saran dari yang sudah dipakai.
    //
    // Bukan dropdown tertutup: "Minuman", "Makanan", "Snack", "Frozen" adalah
    // urusan yang punya usaha, bukan urusan kode. Daftar tetap di kode berarti
    // setiap kategori baru harus menunggu deploy — dan sementara menunggu,
    // orangnya menaruh menu di kategori yang salah karena itu satu-satunya yang
    // tersedia. `datalist` memberi kecepatan dropdown tanpa mengunci pilihannya.
    tableBox.innerHTML = `
      <div class="table-scroll"><table class="data-table table-freeze-1">
        <thead>
          <tr><th>Menu</th><th>Kategori</th><th>Outlet</th><th>Satuan</th><th>Harga Jual</th><th>HPP Standalone</th><th>HPP Dilayani CK</th><th>Margin</th></tr>
        </thead>
        <tbody>
          ${
            list
              .map((m) => {
                const cStand = costForMode(products, recipes, m.id, 'standalone');
                const cCk = costForMode(products, recipes, m.id, 'served_by_ck');
                const ref = cStand ?? cCk;
                let margin = '-';
                if (m.sale_price != null && ref != null) {
                  const val = Number(m.sale_price) - ref;
                  const pct = Number(m.sale_price) > 0 ? Math.round((val / Number(m.sale_price)) * 100) : 0;
                  margin = `${formatRupiah(val)} <span style="color:var(--color-text-muted)">(${pct}%)</span>`;
                }
                const buka = state.terbuka.has(m.id);
                const harga = bolehUbah
                  ? `<input type="text" inputmode="numeric" class="nbm-total-input mn-price" data-id="${m.id}" value="${m.sale_price != null ? formatThousands(Math.round(m.sale_price)) : ''}" placeholder="0" />`
                  : m.sale_price != null
                    ? formatRupiah(m.sale_price)
                    : '<span style="color:var(--color-text-muted)">-</span>';
                return `<tr class="mn-row" data-id="${m.id}" style="cursor:pointer">
                    <td><span class="mn-arrow" style="display:inline-block;width:1em">${buka ? '▾' : '▸'}</span> ${esc(m.name)}${
                      m.is_active === false ? ' <span style="font-size:0.7rem;color:var(--color-danger)">(nonaktif)</span>' : ''
                    }</td>
                    <td style="font-size:0.85rem">${
                      bolehUbah
                        ? `<input type="text" class="mn-cat-input" data-id="${m.id}" list="mn-cat-list" value="${esc(m.category ?? '')}"
                             placeholder="kategori" style="min-width:110px;margin:0;font-size:0.85rem" />`
                        : esc(m.category ?? '-')
                    }${m.subcategory ? `<div style="font-size:0.75rem;color:var(--color-text-muted)">${esc(m.subcategory)}</div>` : ''}</td>
                    <td data-outlet="${m.id}" style="font-size:0.82rem">${selOutlet(m.id)}</td>
                    <td>${esc(m.base_unit)}</td>
                    <td data-harga>${harga}</td>
                    <td>${cStand != null ? formatRupiah(cStand) : '<span style="color:var(--color-text-muted)">-</span>'}</td>
                    <td>${cCk != null ? formatRupiah(cCk) : '<span style="color:var(--color-text-muted)">-</span>'}</td>
                    <td>${margin}</td>
                  </tr>
                  <tr class="mn-detail" data-for="${m.id}"${buka ? '' : ' hidden'}><td colspan="8" style="background:var(--color-surface-alt,#fafafa)"></td></tr>`;
              })
              .join('') || '<tr><td colspan="8">Tidak ada menu.</td></tr>'
          }
        </tbody>
      </table></div>
    `;

    for (const id of state.terbuka) gambarRincian(id);
    wireHarga();
    wireKategori();
    wireBaris();
  }

  /**
   * Isi kolom "Outlet" pada satu baris.
   *
   * Saat daftar pembatasan GAGAL dimuat, kolomnya menulis "?" — bukan
   * "Semua outlet". Menulis "Semua outlet" untuk menu yang sebenarnya dibatasi
   * bukan sekadar keliru: admin yang membuka menu itu akan melihat pilihan
   * "Semua outlet" tercentang, dan menekan Simpan MENGHAPUS pembatasan yang
   * tidak pernah ia lihat.
   */
  function selOutlet(menuId) {
    if (moGagal) return '<span style="color:var(--color-danger)" title="Pengaturan outlet gagal dimuat">?</span>';
    const r = ringkasMenu(petaMO, menuId, outletAktifBU.length);
    return r.dibatasi
      ? `<strong style="color:var(--color-warning,#8a5800)">${esc(r.teks)}</strong>`
      : `<span style="color:var(--color-text-muted)">${esc(r.teks)}</span>`;
  }

  /**
   * Blok "Dijual di outlet mana" di dalam panel detail satu menu.
   *
   * PILIHANNYA DINYATAKAN, BUKAN DISIMPULKAN DARI JUMLAH CENTANG.
   *
   * Di tingkat data, nol baris berarti "semua outlet" — itu yang membuat 162
   * menu lama dan setiap menu baru langsung wajar tanpa backfill. Tapi kalau
   * layar ikut menyimpulkan maksud dari jumlah centang, orang yang mencabut
   * centang terakhir dari "hanya AB Sentul" justru MENGAKTIFKAN menunya di
   * seluruh outlet — kebalikan persis dari yang ia maksud, tanpa satu pun
   * error, dan baru ketahuan saat outlet lain menjual menu yang bukan miliknya.
   *
   * Jadi ada dua tombol yang menyatakan maksudnya, dan "hanya outlet terpilih"
   * dengan nol centang ditolak dengan alasan yang menyebutkan akibatnya.
   */
  function blokOutlet(menuId) {
    if (moGagal) {
      return `<div style="padding:10px 4px;border-top:1px solid var(--color-border,#e5e5e5)">
          <div style="font-weight:600;margin-bottom:4px">Dijual di outlet mana</div>
          <p class="error-text" style="margin:0;font-size:0.82rem">
            Pengaturannya gagal dimuat, jadi tidak ditampilkan sama sekali —
            menampilkan pilihan yang mungkin salah lebih berbahaya daripada tidak menampilkannya:
            menekan Simpan di atas tebakan akan menghapus pembatasan yang sedang berlaku.
            Muat ulang halaman untuk mencoba lagi.
          </p>
        </div>`;
    }
    const k = keadaanMenu(petaMO, menuId);
    const kotak = outletAktifBU
      .map(
        (o) => `<label style="display:flex;gap:6px;align-items:center;font-size:0.85rem;font-weight:400;margin:0">
            <input type="checkbox" class="mo-out" data-id="${menuId}" value="${o.id}"${
              k.outlets.includes(o.id) ? ' checked' : ''
            }${k.mode === SEMUA ? ' disabled' : ''} style="margin:0" />
            ${esc(o.name)}
          </label>`
      )
      .join('');

    return `<div style="padding:10px 4px;border-top:1px solid var(--color-border,#e5e5e5)" data-mo="${menuId}">
        <div style="font-weight:600;margin-bottom:4px">Dijual di outlet mana</div>
        <p style="font-size:0.78rem;color:var(--color-text-muted);margin:0 0 8px;max-width:520px">
          Bawaannya <strong>semua outlet</strong>. Batasi hanya kalau memang ada outlet yang tidak menjual menu ini —
          staff di outlet lain tidak akan melihatnya lagi di layar Penjualan.
          Penjualan yang <strong>sudah tercatat</strong> tidak terpengaruh sama sekali.
        </p>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px">
          <label style="display:flex;gap:6px;align-items:center;font-size:0.86rem;font-weight:400;margin:0">
            <input type="radio" name="mo-mode-${menuId}" class="mo-mode" data-id="${menuId}" value="${SEMUA}"${
              k.mode === SEMUA ? ' checked' : ''
            } style="margin:0" /> Aktif di semua outlet
          </label>
          <label style="display:flex;gap:6px;align-items:center;font-size:0.86rem;font-weight:400;margin:0">
            <input type="radio" name="mo-mode-${menuId}" class="mo-mode" data-id="${menuId}" value="${TERPILIH}"${
              k.mode === TERPILIH ? ' checked' : ''
            } style="margin:0" /> Hanya outlet terpilih
          </label>
        </div>
        <div class="mo-daftar" style="display:flex;gap:8px 18px;flex-wrap:wrap;margin-bottom:8px">${
          kotak || '<span style="font-size:0.82rem;color:var(--color-text-muted)">Belum ada outlet aktif di BU ini.</span>'
        }</div>
        ${
          bolehUbah
            ? `<button class="primary mo-simpan" data-id="${menuId}" style="max-width:220px">Simpan outlet</button>
               <p class="error-text mo-error" data-id="${menuId}" style="margin:6px 0 0;font-size:0.8rem"></p>`
            : '<p style="font-size:0.78rem;color:var(--color-text-muted);margin:0">Hanya admin BU yang bisa mengubahnya.</p>'
        }
      </div>`;
  }

  /** Panel bahan per varian — bentuknya sengaja sama dengan tab Resep. */
  function gambarRincian(menuId) {
    const sel = tableBox.querySelector(`.mn-detail[data-for="${menuId}"] td`);
    if (!sel) return;
    const menu = namaProduk.get(menuId);
    sel.innerHTML = blokOutlet(menuId) + MENU_MODES.map((mode) => {
      const r = resepPer.get(`${menuId}|${mode}`);
      const baris = (r?.items ?? [])
        .map((it) => {
          const bahan = namaProduk.get(it.ingredient_product_id);
          return `<tr>
            <td>${esc(bahan?.name ?? 'bahan tidak ditemukan')}</td>
            <td style="text-align:right">${formatNum(it.qty)} ${esc(bahan?.base_unit ?? '')}</td>
          </tr>`;
        })
        .join('');
      const isi = r
        ? `<table class="data-table baris-sejajar" style="margin:6px 0;max-width:420px">
             <thead><tr><th>Bahan</th><th style="text-align:right">Jumlah</th></tr></thead>
             <tbody>${baris || `<tr><td colspan="2" style="background:var(--color-warning-bg,#fff8e1)">
                 <strong>Resep ini kosong — bahannya tidak pernah tersimpan.</strong>
                 <div style="font-size:0.78rem;margin-top:3px">
                   Biasanya karena penyimpanan terputus di tengah (sinyal hilang, halaman tertutup, atau aplikasi ditutup paksa)
                   sesudah bahan lama dihapus tapi sebelum bahan barunya masuk. Isi ulang lewat "Ubah resep", atau hapus resepnya
                   supaya kembali berstatus "Belum".
                 </div>
               </td></tr>`}</tbody>
           </table>
           <p style="font-size:0.78rem;color:var(--color-text-muted);margin:0 0 8px">
             Hasil/yield: <strong>${formatNum(r.yield_qty)} ${esc(menu.base_unit)}</strong>
           </p>`
        : `<p style="font-size:0.85rem;color:var(--color-text-muted);margin:6px 0 8px">Varian ini belum punya resep.</p>`;
      // Sebab HPP kosong ditulis di tempat orang mencarinya. Kolom HPP di tabel
      // cuma bisa menampilkan "-", dan tanda hubung tidak memberi tahu siapa pun
      // bahan mana yang harganya belum diisi.
      const sebab = r && costForMode(products, recipes, menuId, mode) == null ? sebabHppKosong(products, recipes, menuId, mode) : [];
      const catatanHpp = sebab.length
        ? `<div style="font-size:0.78rem;background:var(--color-warning-bg,#fff8e1);border-left:3px solid var(--color-warning,#e6a700);padding:6px 8px;margin:0 0 8px;max-width:420px">
             <strong>HPP belum bisa dihitung.</strong> Bukan karena stok — stok tidak ikut menentukan HPP.
             <ul style="margin:4px 0 0 16px;padding:0">${sebab.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
           </div>`
        : '';
      const tujuan = pasanganVarian('finished', mode);
      const bolehPindah =
        tujuan && periksaPindah({ productType: 'finished', dari: mode, ke: tujuan, adaDari: !!r, adaKe: resepPer.has(`${menuId}|${tujuan}`) }).boleh;
      return `<div style="padding:10px 4px;border-top:1px solid var(--color-border,#e5e5e5)">
          <div style="font-weight:600;margin-bottom:2px">${MODE_LABEL[mode]}</div>
          ${isi}
          ${catatanHpp}
          ${
            bolehUbah
              ? `<button class="mn-edit-recipe" data-id="${menuId}" data-mode="${mode}">${r ? '✎ Ubah resep' : '+ Isi resep'}</button>` +
                (r ? ` <button class="mn-del-recipe" data-id="${menuId}" data-mode="${mode}">🗑 Hapus resep</button>` : '') +
                (bolehPindah
                  ? ` <button class="mn-pindah-recipe" data-id="${menuId}" data-mode="${mode}" data-ke="${tujuan}">⇄ Pindahkan ke ${MODE_LABEL[tujuan]}</button>`
                  : '')
              : ''
          }
        </div>`;
    }).join('');

    // ---- Blok "Dijual di outlet mana" ----
    const errEl = sel.querySelector(`.mo-error[data-id="${menuId}"]`);
    const setErr = (t) => {
      if (errEl) errEl.textContent = t ?? '';
    };
    const modeTerpilih = () => sel.querySelector(`.mo-mode[data-id="${menuId}"]:checked`)?.value ?? SEMUA;

    sel.querySelectorAll(`.mo-mode[data-id="${menuId}"]`).forEach((r) =>
      r.addEventListener('change', (e) => {
        e.stopPropagation();
        // Kotak centang dimatikan saat "semua outlet" dipilih. Membiarkannya
        // hidup akan menampilkan centang yang tidak berpengaruh apa-apa pada
        // yang tersimpan — dan kontrol yang bergerak tapi tidak berarti membuat
        // orang yakin telah mengatur sesuatu yang sebenarnya tidak tersimpan.
        const semua = modeTerpilih() === SEMUA;
        sel.querySelectorAll(`.mo-out[data-id="${menuId}"]`).forEach((c) => (c.disabled = semua));
        setErr('');
      })
    );
    sel.querySelectorAll(`.mo-out[data-id="${menuId}"]`).forEach((c) =>
      c.addEventListener('click', (e) => e.stopPropagation())
    );

    sel.querySelector(`.mo-simpan[data-id="${menuId}"]`)?.addEventListener(
      'click',
      sekaliJalan(async (e) => {
        e.stopPropagation();
        setErr('');
        const dipilih = [...sel.querySelectorAll(`.mo-out[data-id="${menuId}"]:checked`)].map((c) => c.value);
        const v = validasiSimpan({ mode: modeTerpilih(), outlets: dipilih });
        if (!v.boleh) {
          setErr(v.alasan);
          return;
        }
        try {
          await setMenuOutlet(menuId, v.outlets);
        } catch (error) {
          setErr(error.message ?? 'Gagal menyimpan.');
          return;
        }
        // Peta di layar diperbarui SESUDAH server menerima, bukan sebelumnya.
        // Memperbaruinya lebih dulu membuat kolom "Outlet" menunjukkan keadaan
        // yang belum tentu tersimpan — dan itu tidak bisa dibedakan dari
        // keadaan yang benar-benar tersimpan.
        petaMO.delete(menuId);
        if (v.outlets.length) petaMO.set(menuId, new Set(v.outlets));
        const kolom = tableBox.querySelector(`td[data-outlet="${menuId}"]`);
        if (kolom) kolom.innerHTML = selOutlet(menuId);
        toast(
          v.outlets.length
            ? `Menu ini sekarang hanya dijual di ${v.outlets.length} outlet.`
            : 'Menu ini aktif di semua outlet.',
          'success'
        );
      })
    );

    // Menu punya DUA varian yang berdiri sendiri: menghapus "Standalone" tidak
    // menyentuh "Dilayani CK". Keduanya menjawab cara produksi yang berbeda dan
    // dipakai outlet yang berbeda.
    sel.querySelectorAll('.mn-pindah-recipe').forEach((btn) =>
      btn.addEventListener(
        'click',
        sekaliJalan(async (e) => {
          e.stopPropagation();
          const { id, mode: dari, ke } = btn.dataset;
          const produk = namaProduk.get(id);
          const ok = await confirmDialog({
            title: 'Pindahkan resep',
            message: `Resep <strong>${esc(produk.name)}</strong> dipindahkan dari <strong>${MODE_LABEL[dari]}</strong> ke <strong>${MODE_LABEL[ke]}</strong>.<br /><br />Bahan dan hasil/yield-nya ikut pindah apa adanya — tidak ada yang dihapus. Setelah ini varian ${MODE_LABEL[dari]} menjadi kosong.`,
            confirmText: 'Pindahkan'
          });
          if (!ok) return;
          try {
            await pindahVarianResep(id, dari, ke);
            toast(`Resep pindah ke ${MODE_LABEL[ke]}.`, 'success');
            recipes = await listRecipesFull(businessUnitId);
            resepPer = new Map(recipes.map((x) => [`${x.product_id}|${x.mode}`, x]));
            renderTable();
          } catch (error) {
            toast(error.message ?? 'Gagal memindahkan resep.', 'error');
          }
        })
      )
    );

    sel.querySelectorAll('.mn-del-recipe').forEach((btn) =>
      btn.addEventListener(
        'click',
        sekaliJalan(async (e) => {
          e.stopPropagation();
          const produk = namaProduk.get(btn.dataset.id);
          const terdampak = pemakaiResep(products, recipes, produk.id);
          const ok = await confirmDialog({
            title: `Hapus resep ${MODE_LABEL[btn.dataset.mode] ?? btn.dataset.mode}?`,
            message:
              `Seluruh bahan pada varian ini dihapus dari "${produk.name}". Varian lainnya tidak ikut terhapus, ` +
              'dan menunya sendiri tetap ada — hanya resepnya yang hilang, jadi bisa diisi ulang atau diimpor ulang.' +
              (terdampak.length
                ? ` HPP ${terdampak.length} varian resep lain yang memakai menu ini ikut jadi kosong: ${terdampak
                    .slice(0, 8)
                    .map((t) => `${t.name} (${MODE_LABEL[t.mode] ?? t.mode})`)
                    .join(', ')}${terdampak.length > 8 ? ', dan lainnya' : ''}.`
                : ''),
            confirmText: 'Hapus resep',
            danger: true
          });
          if (!ok) return;
          try {
            await deleteRecipe(produk.id, btn.dataset.mode);
            toast('Resep dihapus.', 'success');
            recipes = await listRecipesFull(businessUnitId);
            resepPer = new Map(recipes.map((r) => [`${r.product_id}|${r.mode}`, r]));
            renderTable();
          } catch (error) {
            toast(error.message ?? 'Gagal menghapus resep.', 'error');
          }
        })
      )
    );

    sel.querySelectorAll('.mn-edit-recipe').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        let dudukan = sel.querySelector('.mn-editor');
        if (!dudukan) {
          dudukan = document.createElement('div');
          dudukan.className = 'mn-editor';
          sel.appendChild(dudukan);
        }
        openRecipeEditor(dudukan, {
          businessUnitId,
          product: namaProduk.get(btn.dataset.id),
          products,
          mode: btn.dataset.mode,
          onSaved: async () => {
            recipes = await listRecipesFull(businessUnitId);
            resepPer = new Map(recipes.map((r) => [`${r.product_id}|${r.mode}`, r]));
            renderTable();
          }
        });
      })
    );
  }

  function wireBaris() {
    tableBox.querySelectorAll('.mn-row').forEach((row) =>
      row.addEventListener('click', (e) => {
        // Mengetik harga tidak boleh ikut membuka/menutup barisnya.
        if (e.target.closest('input')) return;
        const id = row.dataset.id;
        const detail = tableBox.querySelector(`.mn-detail[data-for="${id}"]`);
        const buka = detail.hidden;
        detail.hidden = !buka;
        row.querySelector('.mn-arrow').textContent = buka ? '▾' : '▸';
        if (buka) {
          state.terbuka.add(id);
          gambarRincian(id);
        } else {
          state.terbuka.delete(id);
        }
      })
    );
  }

  function wireKategori() {
    tableBox.querySelectorAll('.mn-cat-input').forEach((input) => {
      let before = input.value;
      input.addEventListener('focus', () => {
        before = input.value;
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
          input.value = before;
          input.blur();
        }
      });
      input.addEventListener('blur', async () => {
        if (input.value.trim() === before.trim()) return;
        try {
          await updateProductCategory(input.dataset.id, { category: input.value });
          const m = menus.find((x) => x.id === input.dataset.id);
          if (m) m.category = input.value.trim() || null;
          toast('Kategori diperbarui.', 'success');
          // Digambar ulang supaya kategori baru langsung ikut di penyaring dan
          // di daftar saran — kalau tidak, kategori yang baru saja diketik tidak
          // bisa dipakai untuk menu berikutnya sampai halamannya dibuka lagi.
          segarkanKategori();
          renderTable();
        } catch (error) {
          toast(error.message ?? 'Gagal menyimpan kategori.', 'error');
          input.value = before;
        }
      });
    });
  }

  /** Isi ulang dropdown penyaring kategori dari data yang sekarang. */
  function segarkanKategori() {
    const sel = container.querySelector('#mn-cat');
    if (!sel) return;
    const daftar = [...new Set(menus.map((m) => m.category).filter(Boolean))].sort();
    const terpilih = state.category;
    sel.innerHTML = `<option value="">Semua</option>${daftar.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}`;
    // Kalau kategori yang sedang disaring sudah tidak dipakai menu mana pun,
    // penyaringnya dikembalikan ke "Semua" — daftar kosong tanpa sebab yang
    // terlihat lebih membingungkan daripada daftar penuh.
    sel.value = daftar.includes(terpilih) ? terpilih : '';
    state.category = sel.value;
  }

  function wireHarga() {
    tableBox.querySelectorAll('.mn-price').forEach((input) => {
      attachThousandsInput(input);
      let before = input.value;
      input.addEventListener('focus', () => {
        before = input.value;
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
          input.value = before;
          input.blur();
        }
      });
      input.addEventListener('blur', async () => {
        if (input.value === before) return;
        const val = input.value.trim() === '' ? null : parseNumber(input.value);
        try {
          await updateSalePrice(input.dataset.id, val);
          const m = menus.find((x) => x.id === input.dataset.id);
          if (m) m.sale_price = val;
          toast('Harga jual diperbarui.', 'success');
          renderTable();
        } catch (error) {
          toast(error.message ?? 'Gagal menyimpan harga.', 'error');
          input.value = before;
        }
      });
    });
  }

  container.querySelector('#mn-cat').addEventListener('change', (e) => {
    state.category = e.target.value;
    renderTable();
  });
  container.querySelector('#mn-q').addEventListener('input', (e) => {
    state.q = e.target.value;
    renderTable();
  });
  container.querySelector('#mn-sub').addEventListener('change', (e) => {
    state.subcategory = e.target.value;
    renderTable();
  });
  container.querySelector('#mn-tpl').addEventListener('click', downloadMenuTemplate);

  /**
   * Tambah menu langsung dari sini, bukan lewat Master Produk.
   *
   * Menu ADALAH produk bertipe `finished` — jadi yang dibuat tetap produk, dan
   * `createProduct()` yang sama dipakai. Yang berbeda cuma pintunya: sebelumnya
   * orang harus pindah modul, memilih tipe "Menu" di antara tiga pilihan, lalu
   * kembali ke sini untuk mengisi resepnya. Tiga langkah untuk satu niat.
   *
   * `product_type` TIDAK ditawarkan sebagai pilihan di sini — ia sudah pasti
   * "Menu". Menawarkannya cuma membuka pintu membuat bahan baku dari layar
   * bernama Menu.
   */
  container.querySelector('#mn-baru')?.addEventListener(
    'click',
    sekaliJalan(async () => {
      const v = await formDialog({
        title: 'Tambah Menu',
        description: 'Menu baru dibuat sebagai produk bertipe "Menu". Resepnya diisi setelah ini, lewat baris menunya di tabel.',
        fields: [
          { name: 'name', label: 'Nama menu', type: 'text', required: true, placeholder: 'mis. Es Kopi Susu' },
          {
            name: 'base_unit',
            label: 'Satuan jual',
            type: 'text',
            required: true,
            value: 'porsi',
            help: 'Satuan yang dipakai saat menghitung HPP & penjualan — mis. porsi, gelas, pcs.'
          },
          { name: 'category', label: 'Kategori', type: 'text', list: 'mn-cat-list', placeholder: 'mis. Minuman' },
          { name: 'subcategory', label: 'Sub kategori', type: 'text', placeholder: 'mis. Kopi' },
          { name: 'sale_price', label: 'Harga jual', type: 'money', help: 'Boleh dikosongkan dulu dan diisi belakangan di tabel.' }
        ],
        submitText: 'Simpan'
      });
      if (!v) return;

      // Nama kembar diperiksa DI SINI, sebelum menyimpan, memakai pembakuan
      // yang sama dengan impor. Tanpa ini akan lahir dua "Es Kopi Susu" yang
      // resepnya terpisah — dan sesudah itu tidak ada cara memberi tahu mana
      // yang dipakai kasir.
      const kembar = products.find((p) => bakukanNama(p.name) === bakukanNama(v.name));
      if (kembar) {
        return toast(
          `"${kembar.name}" sudah ada (${kembar.product_type === 'finished' ? 'Menu' : 'bukan menu'}). Pakai yang itu, atau beri nama yang berbeda.`,
          'warning'
        );
      }

      try {
        await createProduct({
          businessUnitId,
          name: v.name.trim(),
          product_type: 'finished',
          category: v.category,
          subcategory: v.subcategory,
          base_unit: v.base_unit.trim(),
          sale_price: v.sale_price || null
        });
        toast('Menu ditambahkan. Isi resepnya lewat baris menunya.', 'success');
        await renderMenuAdminPage(container, { businessUnitId });
      } catch (error) {
        toast(error.message ?? 'Gagal menambah menu.', 'error');
      }
    })
  );

  renderTable();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
