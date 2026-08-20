import { escapeHtml } from '../../core/ui.js';
import { formatRupiah, formatNum } from '../../core/format.js';
import { monthRangeWIB } from '../../core/dates.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { muatDataOwner } from './muat-data.js';

/**
 * Ringkasan owner — empat kelompok KPI di atas data satu rentang.
 *
 * ============ ATURAN TAMPILAN YANG BERLAKU DI SELURUH BERKAS INI ============
 *
 * Nilai `null` dari lapisan hitung TIDAK PERNAH digambar sebagai 0 atau 0%.
 * Ia digambar sebagai "—" dengan keterangan. Perbedaan antara "nol" dan "belum
 * ada datanya" adalah perbedaan antara usaha yang tidak menjual apa-apa dan
 * usaha yang penjualannya belum diinput — dan di layar keduanya terlihat sama
 * persis kalau tidak sengaja dibedakan.
 *
 * Bilah peringatan di paling atas muncul lebih dulu daripada angka mana pun.
 * Kalau ia digambar di bawah, ia akan dibaca sesudah orangnya telanjur
 * menyimpulkan sesuatu dari angka di atasnya.
 */

const rp = (n) => (n == null ? '—' : formatRupiah(n));
const pct = (n) => (n == null ? '—' : `${formatNum(n, 1)}%`);
const num = (n) => (n == null ? '—' : formatNum(n, 0));

export async function renderRingkasanOwner(root, ctx) {
  const awal = ctx.konteksAwal ?? {};
  const bulan = monthRangeWIB();
  const state = {
    dari: awal.dari ?? bulan.from,
    sampai: awal.sampai ?? bulan.to,
    outletIds: awal.outletIds ?? []
  };

  root.innerHTML = `
    <div class="module-header">
      <div class="module-header-title">📊 Ringkasan</div>
    </div>
    <div id="owner-saring"></div>
    <div id="owner-isi">${loadingHtml('Menghitung…')}</div>
  `;

  gambarSaringan(root, state, () => muatDanGambar(root, ctx, state));
  await muatDanGambar(root, ctx, state);
}

/**
 * Penyaring rentang & outlet. Dipakai bersama tab BEP — bentuknya sama supaya
 * berpindah tab tidak terasa seperti berpindah aplikasi.
 */
export function gambarSaringan(root, state, onUbah, { outlets = [] } = {}) {
  const wrap = root.querySelector('#owner-saring');
  if (!wrap) return;

  const pilihOutlet = outlets.length
    ? `<div class="field" style="margin:0;flex:1;min-width:180px">
         <label style="font-size:0.72rem">Outlet</label>
         <select id="f-outlet">
           <option value="">Semua outlet</option>
           ${outlets.map((o) => `<option value="${o.id}"${state.outletIds[0] === o.id ? ' selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}
         </select>
       </div>`
    : '';

  wrap.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px">
      <div class="field" style="margin:0;flex:1;min-width:140px">
        <label style="font-size:0.72rem">Dari</label>
        <input type="date" id="f-dari" value="${state.dari}" />
      </div>
      <div class="field" style="margin:0;flex:1;min-width:140px">
        <label style="font-size:0.72rem">Sampai</label>
        <input type="date" id="f-sampai" value="${state.sampai}" />
      </div>
      ${pilihOutlet}
      <button class="primary" id="btn-terapkan" style="min-height:44px">Terapkan</button>
    </div>
  `;

  wrap.querySelector('#btn-terapkan').addEventListener(
    'click',
    sekaliJalan(async () => {
      const dari = wrap.querySelector('#f-dari').value;
      const sampai = wrap.querySelector('#f-sampai').value;
      // Rentang terbalik menghasilkan nol baris tanpa satu pun error — layar
      // akan berbunyi "belum ada penjualan" untuk bulan yang sebenarnya ramai.
      if (dari && sampai && dari > sampai) {
        wrap.querySelector('#f-sampai').setCustomValidity('Tanggal akhir lebih awal dari tanggal mulai.');
        wrap.querySelector('#f-sampai').reportValidity();
        return;
      }
      wrap.querySelector('#f-sampai').setCustomValidity('');
      state.dari = dari;
      state.sampai = sampai;
      const o = wrap.querySelector('#f-outlet')?.value;
      state.outletIds = o ? [o] : [];
      await onUbah();
    }, { teks: 'Menghitung…' })
  );
}

async function muatDanGambar(root, ctx, state) {
  const isi = root.querySelector('#owner-isi');
  isi.innerHTML = loadingHtml('Menghitung…');

  let d;
  try {
    d = await muatDataOwner({ businessUnitId: ctx.businessUnitId, ...state });
  } catch (error) {
    isi.innerHTML = `
      <p class="error-text">Gagal memuat: ${escapeHtml(error?.message ?? String(error))}</p>
      <button id="btn-ulang">Coba lagi</button>`;
    isi.querySelector('#btn-ulang').addEventListener('click', () => muatDanGambar(root, ctx, state));
    return;
  }

  // Daftar outlet baru diketahui setelah data pertama datang; saringannya
  // digambar ulang supaya pilihannya muncul tanpa perlu memuat dua kali.
  gambarSaringan(root, state, () => muatDanGambar(root, ctx, state), { outlets: d.outlets });
  ctx.catatKonteks?.({ dari: state.dari, sampai: state.sampai, outletIds: state.outletIds });

  const { ringkasan, penjualan, operasional, kepatuhan, keuangan, bep, posisi, bauran } = d;

  // ANGKA UANG DIAMBIL DARI SATU SUMBER: `d.actual` (profit-outlet.js).
  //
  // Sebelumnya kartu di sini memakai `kpiPenjualan()` yang menghitung kemasan
  // dari `products.packaging_cost` (BU), sementara tab Profitabilitas memakai
  // kemasan per outlet. Dua laba yang berbeda tipis di dua tab, sama-sama masuk
  // akal, dan tidak ada yang bisa memutuskan mana yang benar.
  //
  // Yang TIDAK dipindah: KPI operasional & kepatuhan. Keduanya tidak menghitung
  // uang, jadi tidak ada dua sumber yang bisa bertengkar.
  const A = d.actual.konsolidasi;
  const BU = d.actual.bu;

  isi.innerHTML = `
    ${bilahPeringatan(ringkasan)}

    ${kartuUtama(A, BU, d.actual.outlets)}

    <h3 style="margin:22px 0 8px">Penjualan &amp; Margin</h3>
    <div class="report-kpis">
      ${kpi('Omzet', rp(A.revenue))}
      ${kpi('Porsi terjual', num(A.units))}
      ${kpi('Contribution Margin', rp(A.cm))}
      ${kpi('CM %', pct(A.cmPersen))}
      ${kpi('Omzet / hari jualan', rp(penjualan.omzetPerHari), 'penyebutnya hari yang ada penjualannya')}
    </div>
    ${tabelMenu('Penyumbang laba terbesar', penjualan.terbaik)}
    ${tabelMenu('Penyumbang laba terkecil', penjualan.terlemah)}

    <h3 style="margin:22px 0 8px">Operasional</h3>
    <div class="report-kpis">
      ${kpi('Nilai susut', rp(operasional.nilaiSusut))}
      ${kpi('Produksi', num(operasional.jumlahProduksi))}
      ${kpi('Produksi dibatalkan', num(operasional.produksiDibatalkan))}
      ${kpi('Bahan bersaldo minus', num(operasional.jumlahStokMinus))}
    </div>
    ${tabelMinus(operasional.stokMinus)}

    <h3 style="margin:22px 0 8px">Kepatuhan</h3>
    <div class="report-kpis">
      ${kpi('Aktivitas selesai', pct(kepatuhan.kepatuhanPersen), `${num(kepatuhan.itemSelesai)} dari ${num(kepatuhan.itemTercatat)} item`)}
      ${kpi('Hari ada aktivitas', num(kepatuhan.hariAdaAktivitas))}
      ${kpi('Outlet mengisi', num(kepatuhan.outletAdaAktivitas))}
      ${kpi('Kehadiran tercatat', num(kepatuhan.kehadiran))}
      ${kpi('Belum clock out', num(kepatuhan.belumClockOut), pct(kepatuhan.persenBelumClockOut))}
    </div>
    <p class="report-note">${escapeHtml(kepatuhan.catatan)}</p>

    <h3 style="margin:22px 0 8px">Arus Kas Keluar</h3>
    <p class="report-note" style="margin-bottom:10px">
      Bagian ini menjawab pertanyaan yang <strong>berbeda</strong> dari profitabilitas di atas:
      berapa uang yang benar-benar <em>keluar dari kas</em> pada rentang ini.
      <br /><br />
      Angkanya tidak akan sama dengan biaya tetap di kartu profitabilitas, dan itu wajar —
      sewa yang jatuh tempo tanggal 28 belum ada di kas pada tanggal 5, sedangkan profitabilitas
      memakai biaya yang <em>direncanakan</em> per bulan. Yang dipakai menghitung laba adalah yang
      direncanakan; yang di bawah ini catatan pembayaran.
    </p>
    <div class="report-kpis">
      ${kpi('Kas keluar', rp(keuangan.kasKeluar))}
      ${kpi('Belum berkategori', rp(keuangan.tanpaKategori), pct(keuangan.persenTanpaKategori))}
      ${kpi('Kas keluar / omzet', pct(keuangan.rasioKasKeluar))}
    </div>
    ${tabelKategori(keuangan.perKategori)}

    ${bauran.terlewat.length ? tabelTerlewat(bauran.terlewat) : ''}

    <p class="report-note" style="margin-top:22px">
      Titik impas: <strong>${num(bep.porsi)}</strong> porsi (${rp(bep.omzet)}) pada rentang ini.
      Rinciannya di tab <strong>BEP &amp; Harga</strong>.
    </p>
  `;
}

function bilahPeringatan(r) {
  if (r.layakDipercaya) return '';
  return `
    <div class="report-note" style="border-left-color:var(--color-warning,#d97706);background:#fff8ed;margin-bottom:16px">
      <strong>Angka di halaman ini belum sepenuhnya bisa dipegang.</strong>
      <ul style="margin:6px 0 0;padding-left:18px">
        ${r.alasan.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
      </ul>
    </div>`;
}

/**
 * Kartu paling atas — seluruhnya dari `d.actual`, dan berlabel ACTUAL.
 *
 * Posisi terhadap BEP diringkas per outlet, bukan sebagai satu angka gabungan.
 * BEP gabungan menyembunyikan outlet yang rugi di balik yang untung; yang perlu
 * dilihat owner justru berapa outlet yang masih di bawah.
 */
function kartuUtama(A, BU, outlets) {
  const rb = A.ringkasBep;
  const capai =
    outlets.length === 0
      ? '<span style="color:var(--color-text-muted)">Belum ada outlet pada saringan ini</span>'
      : rb.diBawah > 0
        ? `<span style="color:#b45309">${rb.diBawah} outlet masih di bawah titik impas</span>`
        : rb.diAtas > 0
          ? `<span style="color:var(--color-primary)">✅ Semua outlet yang bisa dihitung sudah lewat titik impas</span>`
          : '<span style="color:var(--color-text-muted)">Titik impas belum bisa dihitung</span>';

  return `
    <p style="margin:0 0 8px;font-size:0.78rem;color:var(--color-text-muted)">
      Angka di bawah <strong class="tanda-konteks">ACTUAL</strong> — dari transaksi & biaya yang tercatat.
    </p>
    <div class="report-kpis">
      ${kpi('Omzet', rp(A.revenue))}
      ${kpi('Contribution Margin', rp(A.cm))}
      ${kpi('Biaya tetap langsung outlet', rp(A.fixedLangsung))}
      ${kpi('Operating Profit outlet', rp(A.operatingProfit))}
      ${kpi('BU Profit setelah biaya bersama', rp(BU.buProfitSetelahShared), 'sesudah dikurangi biaya bersama BU')}
    </div>
    <p style="margin:10px 0 0;font-size:0.9rem">${capai}</p>
  `;
}

function kpi(label, nilai, keterangan = '') {
  return `
    <div class="report-kpi">
      <span class="report-kpi-label">${label}</span>
      <strong class="report-kpi-value">${nilai}</strong>
      ${keterangan ? `<span style="font-size:0.7rem;color:var(--color-text-muted)">${keterangan}</span>` : ''}
    </div>`;
}

function tabelMenu(judul, baris) {
  if (!baris?.length) return '';
  return `
    <h4 style="margin:14px 0 6px;font-size:0.9rem">${judul}</h4>
    <div class="table-scroll">
      <table class="data-table kartu-sempit table-freeze-1">
        <thead><tr><th>Menu</th><th>Porsi</th><th>Omzet</th><th>Margin/porsi</th><th>Kontribusi</th></tr></thead>
        <tbody>
          ${baris
            .map(
              (b) => `<tr>
                <td data-label="Menu">${escapeHtml(b.nama)}</td>
                <td data-label="Porsi">${num(b.qty)}</td>
                <td data-label="Omzet">${rp(b.omzet)}</td>
                <td data-label="Margin/porsi">${rp(b.marginSatuan)}</td>
                <td data-label="Kontribusi">${rp(b.kontribusi)}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function tabelMinus(baris) {
  if (!baris?.length) return '';
  return `
    <h4 style="margin:14px 0 6px;font-size:0.9rem">Bahan bersaldo minus</h4>
    <p class="report-note" style="margin-bottom:8px">
      Saldo minus berarti yang tercatat masuk lebih sedikit daripada yang dipakai — hampir selalu karena
      opname atau penerimaan barang belum diisi, bukan karena barangnya benar-benar berhutang.
    </p>
    <div class="table-scroll">
      <table class="data-table kartu-sempit table-freeze-1">
        <thead><tr><th>Bahan</th><th>Saldo</th></tr></thead>
        <tbody>
          ${baris
            .slice(0, 20)
            .map((b) => `<tr><td data-label="Bahan">${escapeHtml(b.nama)}</td><td data-label="Saldo">${formatNum(b.qty, 2)}</td></tr>`)
            .join('')}
        </tbody>
      </table>
    </div>
    ${baris.length > 20 ? `<p class="report-note">…dan ${baris.length - 20} bahan lain.</p>` : ''}`;
}

function tabelKategori(baris) {
  if (!baris?.length) return '';
  return `
    <div class="table-scroll">
      <table class="data-table kartu-sempit table-freeze-1">
        <thead><tr><th>Kategori biaya tetap</th><th>Jumlah</th></tr></thead>
        <tbody>
          ${baris.map((k) => `<tr><td data-label="Kategori">${escapeHtml(k.nama)}</td><td data-label="Jumlah">${rp(k.total)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function tabelTerlewat(baris) {
  return `
    <h3 style="margin:22px 0 8px">Tidak ikut dihitung</h3>
    <p class="report-note" style="margin-bottom:8px">
      Menu di bawah ini terjual, tapi dikeluarkan dari perhitungan margin dan BEP karena angkanya belum lengkap.
      Sengaja dikeluarkan, bukan dianggap nol — HPP kosong yang dihitung nol akan membuat margin terlihat 100%.
    </p>
    <div class="table-scroll">
      <table class="data-table kartu-sempit table-freeze-1">
        <thead><tr><th>Menu</th><th>Porsi</th><th>Sebab</th></tr></thead>
        <tbody>
          ${baris
            .map(
              (t) =>
                `<tr><td data-label="Menu">${escapeHtml(t.nama)}</td><td data-label="Porsi">${num(t.qty)}</td><td data-label="Sebab">${escapeHtml(t.sebab)}</td></tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}
