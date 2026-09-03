/**
 * Admin Portal → Menu → tab "Menu per Outlet".
 *
 * ============ KENAPA ADA LAYAR KEDUA ============
 *
 * Pengaturan yang sama sudah bisa dilakukan per menu di tab Menu (buka satu
 * baris → centang outlet). Layar ini melihatnya dari arah sebaliknya: pilih
 * satu outlet, lalu centang menu mana saja yang dijual di sana.
 *
 * Bukan kemewahan. BU ini punya 162 menu. Menyiapkan outlet baru lewat layar
 * per-menu berarti membuka 162 baris satu per satu — pekerjaan yang begitu
 * berat sampai kemungkinan besar tidak akan pernah dikerjakan, dan fitur yang
 * tidak pernah dipakai sama saja dengan tidak ada.
 *
 * ============ SATU HAL YANG HARUS DIPAHAMI PEMAKAINYA ============
 *
 * Mencabut centang di sini berarti "tidak dijual di outlet INI" — bukan
 * "nonaktifkan menunya". Menu itu tetap dijual di outlet lain.
 *
 * Dan ada satu keadaan yang server TOLAK, bukan tebak: menu yang hanya dijual
 * di outlet ini, lalu dicabut. Artinya "tidak dijual di mana pun", dan itu
 * keputusan yang berbeda — tempatnya di Master Produk (`is_active`), bukan
 * efek samping diam-diam dari satu centang. Pesan penolakannya menyebut menu
 * mana saja, dan diteruskan apa adanya ke layar.
 */
import { toast } from '../../core/ui.js';
import { listProducts } from '../product/product.service.js';
import { listOutletsForBu } from '../organization/organization.service.js';
import { sayaAdminBu } from '../../core/base-scope.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { cocokNama } from '../../core/nama.js';
import { daftarKategori, TANPA_KATEGORI } from '../product/saringan.js';
import { listMenuOutlet, setMenuOutletMassal } from './menu-outlet.service.js';
import { petaMenuOutlet, menuAktifDi } from './menu-outlet.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function renderMenuPerOutletTab(content, { businessUnitId }) {
  content.innerHTML = loadingHtml('Memuat…');

  let products, outlets, bolehUbah, baris;
  try {
    [products, outlets, bolehUbah, baris] = await Promise.all([
      listProducts(businessUnitId),
      listOutletsForBu(businessUnitId),
      sayaAdminBu(businessUnitId).catch(() => false),
      listMenuOutlet(businessUnitId)
    ]);
  } catch (error) {
    content.innerHTML = `<p class="error-text">${esc(error.message ?? error)}</p>`;
    return;
  }

  const menus = products
    .filter((p) => p.product_type === 'finished' && p.is_active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
  const outletAktif = outlets.filter((o) => o.is_active !== false);

  if (!outletAktif.length) {
    content.innerHTML = `<p style="color:var(--color-text-muted)">Belum ada outlet aktif di BU ini.</p>`;
    return;
  }

  let peta = petaMenuOutlet(baris);
  const kategori = daftarKategori(menus);
  const state = { outletId: outletAktif[0].id, kategori: '', q: '' };

  content.innerHTML = `
    <div class="module-header"><div class="module-header-title">🏪 Menu per Outlet</div></div>
    <p class="report-note" style="margin-bottom:12px;max-width:720px">
      Centang menu yang <strong>dijual di outlet ini</strong>. Menu yang tidak dicentang hilang dari layar
      Penjualan &amp; Menu di Staff App outlet tersebut — <strong>tetap dijual di outlet lain</strong>, dan
      penjualan yang sudah tercatat tidak terpengaruh sama sekali.
      <br /><br />
      Menu yang belum pernah diatur berarti <strong>dijual di semua outlet</strong>.
    </p>

    <div class="panel-lengket-atas">
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0;max-width:260px"><label>Outlet</label>
          <select id="mpo-outlet">${outletAktif
            .map((o) => `<option value="${o.id}">${esc(o.name)}</option>`)
            .join('')}</select>
        </div>
        <div class="field" style="margin:0;max-width:220px"><label>Kategori</label>
          <select id="mpo-cat"><option value="">Semua</option>${kategori
            .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
            .join('')}</select>
        </div>
        <div class="field" style="margin:0;max-width:240px"><label>Cari menu</label>
          <input type="search" id="mpo-q" placeholder="ketik nama menu…" autocomplete="off" />
        </div>
        ${
          bolehUbah
            ? '<button class="primary" id="mpo-simpan" style="max-width:200px">Simpan</button>'
            : '<span style="font-size:0.8rem;color:var(--color-text-muted)">Hanya admin BU yang bisa mengubah.</span>'
        }
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center">
        <button id="mpo-all" style="min-height:34px">Centang semua yang tampil</button>
        <button id="mpo-none" style="min-height:34px">Kosongkan yang tampil</button>
        <span id="mpo-ringkas" style="font-size:0.82rem;color:var(--color-text-muted)"></span>
      </div>
      <p class="error-text" id="mpo-error" style="margin:6px 0 0;font-size:0.82rem"></p>
    </div>

    <div id="mpo-daftar" class="gulir-baris" style="margin-top:10px"></div>
  `;

  const daftarEl = content.querySelector('#mpo-daftar');
  const errEl = content.querySelector('#mpo-error');
  const ringkasEl = content.querySelector('#mpo-ringkas');

  /**
   * Centang yang SEDANG BERLAKU di layar, untuk outlet yang sedang dipilih.
   *
   * Disimpan terpisah dari kotak centangnya sendiri, dan itu penting: daftarnya
   * disaring kategori & pencarian, jadi kotak untuk menu yang sedang tidak
   * tampil TIDAK ADA di DOM. Kalau yang dikirim ke server dibaca dari DOM,
   * setiap penyimpanan yang dilakukan sambil menyaring akan menghapus seluruh
   * menu yang kebetulan tidak terlihat — dan yang menekan Simpan tidak pernah
   * melihat satu pun dari mereka.
   */
  let centang = new Set();

  function muatCentangDariPeta() {
    centang = new Set(menus.filter((m) => menuAktifDi(peta, m.id, state.outletId)).map((m) => m.id));
  }
  muatCentangDariPeta();

  const tampil = () =>
    menus.filter((m) => {
      if (state.kategori) {
        const punya = String(m.category ?? '').trim();
        if (state.kategori === TANPA_KATEGORI ? punya !== '' : punya !== state.kategori) return false;
      }
      return cocokNama(`${m.name} ${m.category ?? ''} ${m.subcategory ?? ''}`, state.q);
    });

  function gambar() {
    const list = tampil();
    ringkasEl.textContent = `${centang.size} dari ${menus.length} menu dijual di outlet ini${
      list.length === menus.length ? '' : ` · ${list.length} tampil`
    }`;
    daftarEl.innerHTML = `
      <table class="data-table table-freeze-1">
        <thead><tr><th style="width:44px">Jual</th><th>Menu</th><th>Kategori</th></tr></thead>
        <tbody>
          ${
            list
              .map(
                (m) => `<tr>
                  <td><input type="checkbox" class="mpo-c" value="${m.id}"${centang.has(m.id) ? ' checked' : ''}${
                    bolehUbah ? '' : ' disabled'
                  } /></td>
                  <td>${esc(m.name)}</td>
                  <td style="font-size:0.82rem;color:var(--color-text-muted)">${esc(m.category ?? '-')}${
                    m.subcategory ? ` · ${esc(m.subcategory)}` : ''
                  }</td>
                </tr>`
              )
              .join('') || '<tr><td colspan="3">Tidak ada menu pada saringan ini.</td></tr>'
          }
        </tbody>
      </table>`;

    daftarEl.querySelectorAll('.mpo-c').forEach((c) =>
      c.addEventListener('change', () => {
        if (c.checked) centang.add(c.value);
        else centang.delete(c.value);
        ringkasEl.textContent = `${centang.size} dari ${menus.length} menu dijual di outlet ini${
          list.length === menus.length ? '' : ` · ${list.length} tampil`
        }`;
      })
    );
  }
  gambar();

  content.querySelector('#mpo-outlet').addEventListener('change', (e) => {
    state.outletId = e.target.value;
    errEl.textContent = '';
    // Centangnya dimuat ULANG dari peta, bukan dibawa dari outlet sebelumnya.
    // Membawanya akan menyalin pengaturan satu outlet ke outlet lain diam-diam
    // pada penyimpanan berikutnya.
    muatCentangDariPeta();
    gambar();
  });
  content.querySelector('#mpo-cat').addEventListener('change', (e) => {
    state.kategori = e.target.value;
    gambar();
  });
  content.querySelector('#mpo-q').addEventListener('input', (e) => {
    state.q = e.target.value;
    gambar();
  });

  // "Yang tampil" — dan kata itu ada di tombolnya dengan sengaja. Tombol yang
  // berbunyi "Centang semua" sementara daftarnya sedang tersaring adalah janji
  // yang tidak ditepati ke arah yang berbahaya.
  content.querySelector('#mpo-all').addEventListener('click', () => {
    for (const m of tampil()) centang.add(m.id);
    gambar();
  });
  content.querySelector('#mpo-none').addEventListener('click', () => {
    for (const m of tampil()) centang.delete(m.id);
    gambar();
  });

  content.querySelector('#mpo-simpan')?.addEventListener(
    'click',
    sekaliJalan(async () => {
      errEl.textContent = '';
      try {
        await setMenuOutletMassal(state.outletId, [...centang]);
      } catch (error) {
        // Pesan server sudah menyebut menu mana yang buntu dan apa jalan
        // keluarnya. Diteruskan apa adanya — menggantinya dengan "Gagal
        // menyimpan" membuang satu-satunya keterangan yang berguna.
        errEl.textContent = error.message ?? 'Gagal menyimpan.';
        return;
      }
      // Dibaca ULANG dari server, bukan disusun dari tebakan di layar.
      //
      // `set_menu_outlet_massal` bisa menulis baris untuk outlet LAIN (menu
      // yang tadinya tidak dibatasi lalu dicabut di sini didaftarkan ke seluruh
      // outlet lain). Menyusun ulang petanya di sisi klien berarti menirukan
      // logika servernya — dan dua salinan aturan yang sama selalu berakhir
      // menyimpang, biasanya pada kasus yang paling jarang dilihat.
      try {
        peta = petaMenuOutlet(await listMenuOutlet(businessUnitId));
        muatCentangDariPeta();
        gambar();
      } catch {
        errEl.textContent =
          'Tersimpan, tapi daftarnya gagal dimuat ulang — muat ulang halaman untuk melihat keadaan yang sebenarnya.';
      }
      toast(`Tersimpan. ${centang.size} menu dijual di outlet ini.`, 'success');
    })
  );
}
