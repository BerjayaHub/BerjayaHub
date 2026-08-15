/**
 * Daftar resep di Staff App — hanya untuk DIBACA.
 *
 * Dipisah dari `inventory.page.js` yang sudah panjang, dan dari layar resep
 * Admin Portal yang bentuknya memang berbeda: di sini tidak ada tombol ubah,
 * tidak ada impor, dan TIDAK ADA RUPIAH. Yang dibutuhkan orang yang membuka ini
 * sambil berdiri di dapur cuma satu: bahan apa saja dan berapa takarannya.
 *
 * Aturannya sendiri (bahan mana, bermasalah atau tidak) datang dari
 * `susunPanelBahan()` yang sama dipakai Admin Portal — supaya dua layar yang
 * menampilkan resep yang sama tidak pernah menampilkan isi yang berbeda.
 *
 * Soal rupiah yang tidak ditampilkan: itu BUKAN pengaman. `products_select`
 * membuka harga beli untuk semua anggota BU. Yang diatur di sini adalah apa
 * yang ikut terbaca di layar yang dipegang sambil bekerja.
 */

import { formatNum } from '../../core/format.js';
import { bakukanNama } from '../../core/nama.js';
import { susunPanelBahan } from '../product/panel-bahan.js';

const MODE_LABEL = { production: 'Produksi (CK)', standalone: 'Standalone', served_by_ck: 'Dilayani CK' };
const TYPE_LABEL = { semi: 'Setengah Jadi', finished: 'Menu' };
const modesForType = (t) => (t === 'semi' ? ['production'] : t === 'finished' ? ['standalone', 'served_by_ck'] : []);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * @param {HTMLElement} wadah
 * @param {object[]} products  seluruh produk BU
 * @param {object[]} recipes   hasil listRecipesFull()
 */
export function renderResepStaff(wadah, products, recipes) {
  const berresep = (products ?? []).filter(
    (p) => (p.product_type === 'semi' || p.product_type === 'finished') && p.is_active !== false
  );
  const punyaResep = new Set((recipes ?? []).map((r) => r.product_id));

  if (!berresep.length) {
    wadah.innerHTML = '<p style="color:var(--color-text-muted)">Belum ada produk setengah jadi atau menu di BU ini.</p>';
    return;
  }

  const kategori = [...new Set(berresep.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));

  wadah.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:0 0 10px">
      <div class="field" style="margin:0;flex:1 1 180px;min-width:160px">
        <input type="search" id="rs-q" placeholder="Cari nama…" autocomplete="off" />
      </div>
      ${
        kategori.length
          ? `<div class="field" style="margin:0;min-width:140px">
               <select id="rs-cat"><option value="">Semua kategori</option>${kategori.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
             </div>`
          : ''
      }
    </div>
    <span class="field-help" id="rs-info" style="display:block;margin:0 0 8px"></span>
    <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 8px">Ketuk nama produk untuk melihat bahannya.</p>
    <div id="rs-list"></div>
  `;

  const list = wadah.querySelector('#rs-list');
  const info = wadah.querySelector('#rs-info');
  const q = wadah.querySelector('#rs-q');
  const cat = wadah.querySelector('#rs-cat');
  const terbuka = new Set();

  // KARTU, bukan tabel. Ini dibuka di HP sambil berdiri; tabel dengan gulir
  // mendatar berarti takarannya ada di kolom yang harus digeser dulu — dan
  // takaran adalah satu-satunya alasan layar ini dibuka.
  function gambar() {
    const cari = bakukanNama(q.value);
    const kat = cat?.value ?? '';
    const tampil = berresep.filter((p) => (!cari || bakukanNama(p.name).includes(cari)) && (!kat || p.category === kat));

    info.textContent = !cari && !kat ? `${berresep.length} produk` : `${tampil.length} dari ${berresep.length} produk`;

    list.innerHTML =
      tampil
        .map((p) => {
          const buka = terbuka.has(p.id);
          const belum = !punyaResep.has(p.id);
          return `
            <div class="card" style="padding:10px 12px;margin-bottom:8px">
              <div class="rs-head" data-id="${p.id}" style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <span style="width:1em">${buka ? '▾' : '▸'}</span>
                <div style="flex:1">
                  <div style="font-weight:600">${esc(p.name)}</div>
                  <div style="font-size:0.75rem;color:var(--color-text-muted)">
                    ${TYPE_LABEL[p.product_type] ?? p.product_type}${p.category ? ` · ${esc(p.category)}` : ''}
                    ${belum ? ' · <span style="color:var(--color-danger)">belum ada resep</span>' : ''}
                  </div>
                </div>
              </div>
              ${buka ? `<div style="margin-top:8px">${isiHtml(p)}</div>` : ''}
            </div>`;
        })
        .join('') || '<p style="color:var(--color-text-muted)">Tidak ada yang cocok.</p>';

    list.querySelectorAll('.rs-head').forEach((el) =>
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (terbuka.has(id)) terbuka.delete(id);
        else terbuka.add(id);
        gambar();
      })
    );
  }

  function isiHtml(p) {
    return modesForType(p.product_type)
      .map((mode) => {
        const panel = susunPanelBahan({ products, recipes, productId: p.id, mode, denganNilai: false });
        let isi;
        if (!panel.ada) {
          isi = '<p style="font-size:0.85rem;color:var(--color-text-muted);margin:4px 0">Varian ini belum punya resep.</p>';
        } else if (panel.kosong) {
          // Sama seperti di Admin Portal: disebut apa adanya, bukan "belum
          // diisi". Staff yang membacanya perlu tahu ini harus dilaporkan ke
          // admin, bukan ditunggu.
          isi =
            '<p style="font-size:0.85rem;margin:4px 0;color:var(--color-danger)">Resep ini kosong — bahannya tidak tersimpan. Laporkan ke admin.</p>';
        } else {
          isi = `<table class="data-table" style="margin:4px 0;width:100%">
              <thead><tr><th>Bahan</th><th style="text-align:right;white-space:nowrap">Jumlah</th></tr></thead>
              <tbody>${panel.baris
                .map(
                  (b) => `<tr>
                    <td>${esc(b.nama)}</td>
                    <td style="text-align:right;white-space:nowrap">${formatNum(b.jumlah)} ${esc(b.satuan)}</td>
                  </tr>`
                )
                .join('')}</tbody>
            </table>
            <div style="font-size:0.78rem;color:var(--color-text-muted)">
              Hasil: <strong>${formatNum(panel.yieldQty)} ${esc(panel.satuan)}</strong>
            </div>`;
        }
        return `<div style="border-top:1px solid var(--color-border,#e5e5e5);padding-top:6px;margin-top:6px">
            <div style="font-weight:600;font-size:0.85rem">${MODE_LABEL[mode] ?? mode}</div>
            ${isi}
          </div>`;
      })
      .join('');
  }

  q.addEventListener('input', gambar);
  cat?.addEventListener('change', gambar);
  gambar();
}
