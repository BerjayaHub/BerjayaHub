import { escapeHtml } from '../../core/ui.js';
import { formatRupiah, formatNum } from '../../core/format.js';
import { monthRangeWIB } from '../../core/dates.js';
import { loadingHtml } from '../../core/loading.js';
import { muatDataOwner } from './muat-data.js';
import { gambarSaringan } from './ringkasan.owner.js';
import { STATUS_BEP } from './profit-outlet.js';

/**
 * PROFITABILITAS AKTUAL — per outlet.
 *
 * ============ SATU SUMBER ANGKA ============
 *
 * Seluruh angka uang di layar ini datang dari `d.actual`, yaitu hasil
 * `profit-outlet.js`. Mesin lama (`bauranPenjualan`/`hitungBep` di `bep.js`)
 * TIDAK dipakai di sini sama sekali.
 *
 * Itu bukan kerapian belaka. Kedua mesin menghitung kemasan dari sumber yang
 * berbeda — yang lama dari `products.packaging_cost` (BU), yang baru dari
 * `outlet_menu_prices.packaging_cost` (outlet). Kalau keduanya dipakai
 * bersamaan, layar akan menampilkan dua laba yang berbeda tipis, sama-sama
 * masuk akal, dan tidak ada yang bisa memutuskan mana yang benar.
 *
 * ============ TIDAK ADA "BEP GABUNGAN" ============
 *
 * Mode Semua Outlet menampilkan penjumlahan tiap kolom, dan TIDAK menampilkan
 * satu BEP. BEP gabungan hanya bermakna kalau bauran outletnya tetap — dan ia
 * justru menyembunyikan yang mau dilihat: outlet yang sudah untung menutupi
 * yang masih rugi. Yang ditampilkan berapa outlet di atas & di bawah titik
 * impas.
 *
 * ============ APA YANG BENAR-BENAR HISTORIS ============
 *
 * Hanya omzet. HPP & kemasan dihitung dari master SEKARANG, jadi mengubah harga
 * beli bahan hari ini akan menggeser CM bulan lalu. Itu dikatakan di layar,
 * bukan disimpan sebagai catatan kaki di kode.
 */

const rp = (n) => (n == null ? '—' : formatRupiah(n));
const num = (n) => (n == null ? '—' : formatNum(n, 0));
const pct = (n) => (n == null ? '—' : `${formatNum(n, 1)}%`);

const LABEL_STATUS = {
  [STATUS_BEP.DI_ATAS]: { teks: 'DI ATAS BEP', kelas: 'badge-approved' },
  [STATUS_BEP.DI_BAWAH]: { teks: 'DI BAWAH BEP', kelas: 'badge-rejected' },
  [STATUS_BEP.PAS]: { teks: 'PAS DI BEP', kelas: 'badge-pending' },
  [STATUS_BEP.TIDAK_BISA]: { teks: 'BELUM BISA DIHITUNG', kelas: 'badge' }
};

export async function renderActualOwner(root, ctx) {
  const awal = ctx.konteksAwal ?? {};
  const bulan = monthRangeWIB();
  const state = {
    dari: awal.dari ?? bulan.from,
    sampai: awal.sampai ?? bulan.to,
    outletIds: awal.outletIds ?? []
  };

  root.innerHTML = `
    <div class="module-header">
      <div class="module-header-title">📒 Profitabilitas — <span class="tanda-konteks">ACTUAL</span></div>
    </div>
    <div id="owner-saring"></div>
    <div id="owner-isi">${loadingHtml('Menghitung per outlet…')}</div>
  `;

  gambarSaringan(root, state, () => muatDanGambar(root, ctx, state));
  await muatDanGambar(root, ctx, state);
}

async function muatDanGambar(root, ctx, state) {
  const isi = root.querySelector('#owner-isi');
  isi.innerHTML = loadingHtml('Menghitung per outlet…');

  let d;
  try {
    d = await muatDataOwner({ businessUnitId: ctx.businessUnitId, ...state });
  } catch (error) {
    isi.innerHTML = `<p class="error-text">Gagal memuat: ${escapeHtml(error?.message ?? String(error))}</p>
      <button id="btn-ulang">Coba lagi</button>`;
    isi.querySelector('#btn-ulang').addEventListener('click', () => muatDanGambar(root, ctx, state));
    return;
  }

  gambarSaringan(root, state, () => muatDanGambar(root, ctx, state), { outlets: d.outlets });
  ctx.catatKonteks?.({ dari: state.dari, sampai: state.sampai, outletIds: state.outletIds });

  const { outlets: hasil, konsolidasi, bu } = d.actual;
  const satuOutlet = hasil.length === 1;

  isi.innerHTML = `
    <p class="report-note" style="margin-bottom:14px">
      Semua angka di halaman ini <strong>aktual</strong> — dari transaksi dan biaya yang benar-benar tercatat.
      Tidak ada target, proyeksi, maupun asumsi.
      <br /><br />
      <strong>Yang benar-benar historis hanya omzet.</strong> HPP dan kemasan dihitung dari master
      <em>sekarang</em>, jadi mengubah harga beli bahan hari ini akan menggeser margin bulan lalu.
    </p>

    ${hasil.length === 0 ? '<p class="report-note">Tidak ada outlet pada saringan ini.</p>' : ''}

    ${hasil.map(kartuOutlet).join('')}

    ${satuOutlet ? '' : panelKonsolidasi(konsolidasi)}

    ${panelBu(bu, konsolidasi)}

    ${tabelMenu(hasil)}
  `;
}

/**
 * Satu kartu per outlet — dihitung sendiri dari awal sampai akhir.
 */
function kartuOutlet(o) {
  const st = LABEL_STATUS[o.gap?.status] ?? LABEL_STATUS[STATUS_BEP.TIDAK_BISA];

  return `
    <section class="inline-card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <h3 style="margin:0">${escapeHtml(o.outletName || '(tanpa nama)')}</h3>
        <span class="badge ${st.kelas}">${st.teks}</span>
      </div>

      <div class="report-kpis">
        ${kpi('Revenue', rp(o.revenue))}
        ${kpi('Units', num(o.units))}
        ${kpi('Variable Cost', rp(o.variabel.total), rincianVariabel(o))}
        ${kpi('Contribution Margin', rp(o.cm))}
        ${kpi('CM %', pct(o.cmPersen))}
        ${kpi('Direct Fixed Cost', rp(o.fixedLangsung), o.rincianFixed.length ? `${o.rincianFixed.length} pos` : 'belum ada')}
        ${kpi('Operating Profit', rp(o.operatingProfit))}
        ${kpi('Operating Margin', pct(o.operatingMargin))}
        ${kpi('BEP Revenue', rp(o.bep.revenue))}
        ${kpi('BEP Units', num(o.bep.unit))}
        ${kpi('Gap to BEP', o.gap.nilai == null ? '—' : rp(o.gap.nilai))}
        ${kpi('ASP', rp(o.asp), 'rata-rata harga transaksi outlet ini')}
      </div>

      ${o.bep.sebab ? `<p class="report-note" style="margin-top:10px">${escapeHtml(o.bep.sebab)}</p>` : ''}
      ${o.peringatan.map((p) => `<p class="report-note" style="margin-top:8px">${escapeHtml(p)}</p>`).join('')}
      ${
        o.rincianFixed.length
          ? `<details style="margin-top:10px">
               <summary style="cursor:pointer;font-size:0.85rem">Rincian biaya tetap langsung</summary>
               <div class="table-scroll" style="margin-top:8px">
                 <table class="data-table">
                   <thead><tr><th>Pos biaya</th><th>Jumlah</th><th>Sifat</th></tr></thead>
                   <tbody>
                     ${o.rincianFixed
                       .map((r) => `<tr><td>${escapeHtml(r.nama)}</td><td>${rp(r.jumlah)}</td><td>${escapeHtml(r.sifat)}</td></tr>`)
                       .join('')}
                   </tbody>
                 </table>
               </div>
             </details>`
          : ''
      }
    </section>`;
}

function rincianVariabel(o) {
  const bagian = [];
  if (o.variabel.hpp) bagian.push(`HPP ${formatRupiah(o.variabel.hpp)}`);
  if (o.variabel.kemasan) bagian.push(`kemasan ${formatRupiah(o.variabel.kemasan)}`);
  if (o.variabel.perPorsi) bagian.push(`per porsi ${formatRupiah(o.variabel.perPorsi)}`);
  if (o.variabel.persenOmzet) bagian.push(`% omzet ${formatRupiah(o.variabel.persenOmzet)}`);
  return bagian.join(' + ');
}

/**
 * Konsolidasi — PENJUMLAHAN hasil outlet, bukan hitungan ulang.
 */
function panelKonsolidasi(k) {
  return `
    <section class="inline-card" style="margin-bottom:16px;border-left:3px solid var(--color-primary)">
      <h3 style="margin:0 0 4px">Konsolidasi — ${k.jumlahOutlet} outlet</h3>
      <p class="report-note" style="margin:0 0 10px">
        Setiap kolom di bawah adalah <strong>penjumlahan</strong> hasil tiap outlet, bukan hitungan ulang dari
        angka gabungan.
      </p>

      <div class="report-kpis">
        ${kpi('Total Revenue', rp(k.revenue))}
        ${kpi('Total Units', num(k.units))}
        ${kpi('Total Variable Cost', rp(k.variabel.total))}
        ${kpi('Total Contribution Margin', rp(k.cm))}
        ${kpi('CM %', pct(k.cmPersen))}
        ${kpi('Total Direct Fixed Cost', rp(k.fixedLangsung))}
        ${kpi('Total Operating Profit', rp(k.operatingProfit))}
        ${kpi('Operating Margin', pct(k.operatingMargin))}
      </div>

      <p class="report-note" style="margin-top:10px">
        <strong>Weighted Average ASP — informasi saja:</strong> ${rp(k.aspTertimbang)}.
        Angka ini <strong>tidak dipakai</strong> menghitung apa pun. Ia tidak berlaku di outlet mana pun.
      </p>

      <p class="report-note" style="margin-top:8px">
        <strong>Tidak ada satu BEP gabungan</strong> — BEP gabungan menyembunyikan outlet yang rugi di balik
        yang untung. Yang ditampilkan posisi masing-masing:
        <strong>${k.ringkasBep.diAtas}</strong> di atas BEP ·
        <strong>${k.ringkasBep.diBawah}</strong> di bawah ·
        <strong>${k.ringkasBep.pas}</strong> pas ·
        <strong>${k.ringkasBep.tidakBisa}</strong> belum bisa dihitung.
      </p>
    </section>`;
}

/**
 * Tiga angka laba yang sengaja dibedakan namanya.
 */
function panelBu(bu, k) {
  return `
    <section class="inline-card" style="margin-bottom:16px">
      <h3 style="margin:0 0 10px">Ringkasan Business Unit</h3>
      <div class="report-kpis">
        ${kpi('Outlet Operating Profit', rp(k.operatingProfit), 'jumlah seluruh outlet')}
        ${kpi('BU Profit Before Shared Cost', rp(bu.buProfitSebelumShared))}
        ${kpi('Shared BU Cost', rp(bu.sharedBu), bu.rincianShared.length ? `${bu.rincianShared.length} pos` : 'belum ada')}
        ${kpi('BU Profit After Shared Cost', rp(bu.buProfitSetelahShared))}
        ${kpi('Margin setelah shared', pct(bu.marginSetelahShared))}
        ${kpi('Corporate Cost', rp(bu.corporate), 'TIDAK dikurangkan dari BU ini')}
      </div>
      <p class="report-note" style="margin-top:10px">${escapeHtml(bu.catatan)}</p>
      ${
        bu.rincianShared.length || bu.rincianCorporate.length
          ? `<details style="margin-top:10px">
               <summary style="cursor:pointer;font-size:0.85rem">Rincian biaya bersama &amp; korporat</summary>
               <div class="table-scroll" style="margin-top:8px">
                 <table class="data-table">
                   <thead><tr><th>Pos biaya</th><th>Cakupan</th><th>Jumlah</th></tr></thead>
                   <tbody>
                     ${bu.rincianShared.map((r) => `<tr><td>${escapeHtml(r.nama)}</td><td>Bersama BU</td><td>${rp(r.jumlah)}</td></tr>`).join('')}
                     ${bu.rincianCorporate.map((r) => `<tr><td>${escapeHtml(r.nama)}</td><td>Korporat</td><td>${rp(r.jumlah)}</td></tr>`).join('')}
                   </tbody>
                 </table>
               </div>
             </details>`
          : ''
      }
    </section>`;
}

/**
 * Menu profitability — per OUTLET.
 *
 * Menu yang sama muncul beberapa kali kalau dijual di beberapa outlet, dan
 * angkanya memang boleh berbeda. Itu intinya: harga jual berbeda menghasilkan
 * margin berbeda untuk resep yang persis sama.
 *
 * ASP di sini `Σrevenue / Σqty` dari transaksi — bukan harga master.
 */
function tabelMenu(hasil) {
  const baris = [];
  for (const o of hasil) {
    for (const m of o.menu) baris.push({ outlet: o.outletName, ...m });
  }
  if (!baris.length) return '';

  baris.sort((a, b) => b.cm - a.cm);

  const terlewat = hasil.flatMap((o) => o.terlewat.map((t) => ({ outlet: o.outletName, ...t })));

  return `
    <h3 style="margin:22px 0 8px">Profitabilitas per Menu &amp; Outlet</h3>
    <p class="report-note" style="margin-bottom:10px">
      Menu yang sama bisa muncul beberapa kali — sekali untuk tiap outlet. Angkanya memang boleh berbeda:
      harga jual berbeda menghasilkan margin berbeda untuk resep yang sama.
      <strong>ASP</strong> dihitung dari transaksi (Σ omzet ÷ Σ porsi), bukan dari harga master.
    </p>
    <div class="table-scroll">
      <table class="data-table table-freeze-1">
        <thead>
          <tr><th>Menu</th><th>Outlet</th><th>Units</th><th>Revenue</th><th>ASP</th><th>HPP</th><th>Variable/unit</th><th>CM</th><th>CM %</th></tr>
        </thead>
        <tbody>
          ${baris
            .map(
              (b) => `<tr>
                <td>${escapeHtml(b.nama)}</td>
                <td>${escapeHtml(b.outlet)}</td>
                <td>${num(b.units)}</td>
                <td>${rp(b.revenue)}</td>
                <td>${rp(b.asp)}</td>
                <td>${rp(b.hppSatuan)}</td>
                <td>${rp(b.variabelSatuan)}</td>
                <td>${rp(b.cm)}</td>
                <td>${pct(b.cmPersen)}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>

    ${
      terlewat.length
        ? `<div class="report-note" style="margin-top:10px">
             <strong>${terlewat.length} menu terjual tapi tidak ikut dihitung.</strong>
             Sengaja dikeluarkan, bukan dianggap nol — HPP kosong yang dihitung nol membuat margin terlihat 100%.
             <div class="table-scroll" style="margin-top:8px">
               <table class="data-table">
                 <thead><tr><th>Menu</th><th>Outlet</th><th>Units</th><th>Sebab</th></tr></thead>
                 <tbody>
                   ${terlewat
                     .map(
                       (t) =>
                         `<tr><td>${escapeHtml(t.nama)}</td><td>${escapeHtml(t.outlet)}</td><td>${num(t.units)}</td><td>${escapeHtml(t.sebab)}</td></tr>`
                     )
                     .join('')}
                 </tbody>
               </table>
             </div>
           </div>`
        : ''
    }`;
}

function kpi(label, nilai, keterangan = '') {
  return `
    <div class="report-kpi">
      <span class="report-kpi-label">${escapeHtml(label)}</span>
      <strong class="report-kpi-value">${nilai}</strong>
      ${keterangan ? `<span style="font-size:0.7rem;color:var(--color-text-muted)">${escapeHtml(keterangan)}</span>` : ''}
    </div>`;
}
