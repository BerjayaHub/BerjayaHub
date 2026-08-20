import { escapeHtml } from '../../core/ui.js';
import { formatRupiah, formatNum } from '../../core/format.js';
import { monthRangeWIB } from '../../core/dates.js';
import { loadingHtml } from '../../core/loading.js';
import { muatDataOwner } from './muat-data.js';
import { gambarSaringan } from './ringkasan.owner.js';
import { STATUS_BEP } from './profit-outlet.js';

/**
 * PROYEKSI AKHIR PERIODE — layar estimasi.
 *
 * ============ SETIAP ANGKA DI SINI BERLABEL PROJECTED ============
 *
 * Bukan satu label di judul lalu bebas di bawahnya. Judul, tiap kartu outlet,
 * panel konsolidasi, dan panel BU semuanya membawa penandanya sendiri.
 *
 * Alasannya sederhana dan sudah terbukti sekali di layar Ringkasan: orang
 * memotret sebagian layar, atau menggulir sampai judulnya keluar dari
 * pandangan. Angka laba yang terlepas dari labelnya akan dibaca sebagai
 * kenyataan — dan proyeksi yang dibaca sebagai kenyataan adalah dasar keputusan
 * yang paling mahal di seluruh aplikasi ini.
 *
 * ============ METODENYA DITAMPILKAN, BUKAN DISEMBUNYIKAN ============
 *
 * Blok "Cara angkanya didapat" menampilkan omzet aktual, laju harian, sisa
 * hari, omzet sisa, dan hasil akhirnya — berurutan, dengan angka antaranya.
 * Siapa pun bisa mengalikan sendiri dan mendapati hasil yang sama.
 *
 * Kotak hitam yang mengeluarkan satu angka besar akan dipercaya bulat-bulat
 * atau ditolak bulat-bulat. Keduanya sama buruknya untuk angka yang memang
 * merupakan tebakan lurus.
 *
 * ============ YANG TIDAK DILAKUKAN LAYAR INI ============
 *
 * Tidak ada masukan yang bisa diketik. Tidak ada tombol simpan. Tidak ada
 * skenario "bagaimana kalau". Semua itu SIMULASI, dan simulasi belum dibuat —
 * mencampurnya ke sini akan menghasilkan layar yang setengah estimasi setengah
 * andaian, dengan satu label untuk keduanya.
 */

const rp = (n) => (n == null ? '—' : formatRupiah(n));
const num = (n) => (n == null ? '—' : formatNum(n, 0));
const pct = (n) => (n == null ? '—' : `${formatNum(n, 1)}%`);

const LABEL_STATUS = {
  [STATUS_BEP.DI_ATAS]: { teks: 'DIPROYEKSI DI ATAS BEP', kelas: 'badge-approved' },
  [STATUS_BEP.DI_BAWAH]: { teks: 'DIPROYEKSI DI BAWAH BEP', kelas: 'badge-rejected' },
  [STATUS_BEP.PAS]: { teks: 'DIPROYEKSI PAS DI BEP', kelas: 'badge-pending' },
  [STATUS_BEP.TIDAK_BISA]: { teks: 'BELUM BISA DIPROYEKSI', kelas: 'badge' }
};

const TANDA = '<span class="tanda-konteks">PROJECTED</span>';

export async function renderProyeksiOwner(root, ctx) {
  const awal = ctx.konteksAwal ?? {};
  const bulan = monthRangeWIB();
  const state = {
    dari: awal.dari ?? bulan.from,
    sampai: awal.sampai ?? bulan.to,
    outletIds: awal.outletIds ?? []
  };

  root.innerHTML = `
    <div class="module-header">
      <div class="module-header-title">🔮 Proyeksi Akhir Periode — ${TANDA}</div>
    </div>
    <div id="owner-saring"></div>
    <div id="owner-isi">${loadingHtml('Memproyeksikan…')}</div>
  `;

  gambarSaringan(root, state, () => muatDanGambar(root, ctx, state));
  await muatDanGambar(root, ctx, state);
}

async function muatDanGambar(root, ctx, state) {
  const isi = root.querySelector('#owner-isi');
  isi.innerHTML = loadingHtml('Memproyeksikan…');

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

  const { hari, outlets: hasil, konsolidasi, bu } = d.proyeksi;
  const satuOutlet = hasil.length === 1;

  // Rentang tanggalnya sendiri tidak sah -> jangan gambar kartu apa pun.
  // Menampilkan deretan "—" membuat halaman terlihat seolah datanya kosong,
  // padahal yang salah adalah saringannya.
  if (hari?.sebab) {
    isi.innerHTML = `<p class="report-note">${escapeHtml(hari.sebab)} Betulkan rentang tanggal di atas.</p>`;
    return;
  }

  isi.innerHTML = `
    <p class="report-note" style="margin-bottom:14px">
      Seluruh angka di halaman ini <strong>estimasi</strong>, bukan kenyataan. Metodenya
      <strong>run-rate lurus</strong>: rata-rata harian dari yang sudah berjalan, dikalikan sisa hari.
      <br /><br />
      Itu berarti halaman ini <strong>mengasumsikan sisa periode berjalan sama seperti yang sudah lewat</strong>.
      Untuk usaha yang ramai di akhir pekan, proyeksi yang dibuat di tengah minggu kerja akan terlalu rendah —
      dan sebaliknya. Asumsi ini tidak bisa dihilangkan tanpa data musiman yang belum dikumpulkan.
      <br /><br />
      <strong>Biaya tetap tidak ikut dikalikan.</strong> Sewa tidak bertambah karena penjualan bertambah.
    </p>

    ${panelPeriode(hari)}

    ${hasil.length === 0 ? '<p class="report-note">Tidak ada outlet pada saringan ini.</p>' : ''}

    ${hasil.map(kartuOutlet).join('')}

    ${satuOutlet ? '' : panelKonsolidasi(konsolidasi)}

    ${panelBu(bu, konsolidasi)}
  `;
}

/**
 * Berapa jauh periodenya sudah berjalan. Ditaruh paling atas karena inilah yang
 * menentukan seberapa layak seluruh halaman ini dipercaya: proyeksi dari 2 hari
 * dan proyeksi dari 25 hari terlihat persis sama kalau angka ini tidak ada.
 */
function panelPeriode(hari) {
  const persen = hari.hariPeriode > 0 ? (hari.hariBerjalan / hari.hariPeriode) * 100 : 0;

  return `
    <section class="inline-card" style="margin-bottom:16px">
      <h3 style="margin:0 0 10px">Posisi periode — ${TANDA}</h3>
      <div class="report-kpis">
        ${kpi('Panjang periode', `${num(hari.hariPeriode)} hari`)}
        ${kpi('Sudah berjalan', `${num(hari.hariBerjalan)} hari`, hari.actualSampai ? `aktual s/d ${hari.actualSampai}` : 'belum mulai')}
        ${kpi('Sisa hari', `${num(hari.sisaHari)} hari`)}
        ${kpi('Bagian yang sudah lewat', pct(persen))}
      </div>
    </section>`;
}

/**
 * Satu kartu per outlet. Dua bagian yang sengaja dipisah:
 * angka proyeksinya, lalu CARA angka itu didapat.
 */
function kartuOutlet(o) {
  const st = LABEL_STATUS[o.gap?.status] ?? LABEL_STATUS[STATUS_BEP.TIDAK_BISA];

  // Outlet yang tidak bisa diproyeksi TIDAK digambar dengan deretan "—" di
  // kartu penuh. Deretan "—" terbaca sebagai "hasilnya nol", padahal artinya
  // "belum ada dasarnya". Sebabnya yang ditampilkan, bukan tabelnya.
  if (!o.bisaDiproyeksi) {
    return `
      <section class="inline-card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <h3 style="margin:0">${escapeHtml(o.outletName || '(tanpa nama)')} — ${TANDA}</h3>
          <span class="badge">BELUM BISA DIPROYEKSI</span>
        </div>
        <p class="report-note" style="margin-top:10px">
          ${escapeHtml(o.sebab ?? 'Belum ada dasar untuk memproyeksikan outlet ini.')}
          <br /><br />
          Outlet ini <strong>tidak dianggap nol</strong> dan <strong>tidak diisi rata-rata outlet lain</strong>.
          Ia dikeluarkan dari total BU sepenuhnya — omzet karangan yang terlihat wajar jauh lebih berbahaya
          daripada satu baris kosong yang jujur.
        </p>
      </section>`;
  }

  return `
    <section class="inline-card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <h3 style="margin:0">${escapeHtml(o.outletName || '(tanpa nama)')} — ${TANDA}</h3>
        <span class="badge ${st.kelas}">${st.teks}</span>
      </div>

      <div class="report-kpis">
        ${kpi('Projected Revenue', rp(o.revenue))}
        ${kpi('Projected Units', num(o.units))}
        ${kpi('Projected Variable Cost', rp(o.variabel.total), o.variabel.rasio == null ? '' : `${formatNum(o.variabel.rasio * 100, 1)}% dari omzet (rasio aktual)`)}
        ${kpi('Projected Contribution Margin', rp(o.cm))}
        ${kpi('CM %', pct(o.cmPersen))}
        ${kpi('Direct Fixed Cost', rp(o.fixedLangsung), 'tidak dikalikan — biaya bulanan')}
        ${kpi('Projected Operating Profit', rp(o.operatingProfit))}
        ${kpi('Projected Operating Margin', pct(o.operatingMargin))}
        ${kpi('BEP Revenue', rp(o.bep.revenue))}
        ${kpi('BEP Units', num(o.bep.unit))}
        ${kpi('Gap ke BEP (proyeksi)', o.gap.nilai == null ? '—' : rp(o.gap.nilai))}
      </div>

      ${blokMetode(o)}

      ${o.bep.sebab ? `<p class="report-note" style="margin-top:10px">${escapeHtml(o.bep.sebab)}</p>` : ''}
      ${o.peringatan.map((p) => `<p class="report-note" style="margin-top:8px">${escapeHtml(p)}</p>`).join('')}
    </section>`;
}

/**
 * Cara angkanya didapat — berurutan, dengan angka antaranya.
 *
 * Ini bukan hiasan. Tanpa langkah antaranya, "Projected Revenue Rp 124 juta"
 * tidak bisa diperiksa siapa pun, dan angka yang tidak bisa diperiksa akan
 * dipercaya penuh atau dibuang penuh — dua-duanya keliru untuk tebakan lurus.
 */
function blokMetode(o) {
  const r = o.rincian;
  if (!r) return '';

  return `
    <div class="report-note" style="margin-top:12px">
      <strong>Cara angkanya didapat — ${r.metode.toLowerCase()}:</strong>
      <div class="table-scroll" style="margin-top:8px">
        <table class="data-table">
          <tbody>
            <tr>
              <td>Omzet aktual s/d ${escapeHtml(o.hari?.actualSampai ?? '—')}</td>
              <td><strong>${rp(r.revenueActual)}</strong></td>
            </tr>
            <tr>
              <td>÷ ${num(o.hari?.hariBerjalan)} hari berjalan = rata-rata harian</td>
              <td><strong>${rp(r.lajuRevenueHarian)}</strong></td>
            </tr>
            <tr>
              <td>× ${num(r.sisaHari)} hari tersisa = omzet sisa periode</td>
              <td><strong>${rp(r.revenueSisa)}</strong></td>
            </tr>
            <tr>
              <td><strong>Omzet proyeksi akhir periode</strong></td>
              <td><strong>${rp(o.revenue)}</strong></td>
            </tr>
            <tr>
              <td>Rasio biaya variabel (diambil dari aktual, tidak dihitung ulang)</td>
              <td><strong>${r.rasioVariabel == null ? '—' : `${formatNum(r.rasioVariabel * 100, 1)}%`}</strong></td>
            </tr>
            <tr>
              <td>Biaya tetap langsung (tetap, tidak dikalikan)</td>
              <td><strong>${rp(o.fixedLangsung)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

/**
 * Konsolidasi — penjumlahan proyeksi tiap outlet, sama seperti di Actual.
 */
function panelKonsolidasi(k) {
  const dikecualikan = k.tidakBisaDiproyeksi ?? [];

  return `
    <section class="inline-card" style="margin-bottom:16px;border-left:3px solid var(--color-primary)">
      <h3 style="margin:0 0 4px">Konsolidasi Proyeksi — ${k.jumlahDiproyeksi} dari ${k.jumlahOutlet} outlet ${TANDA}</h3>
      <p class="report-note" style="margin:0 0 10px">
        Tiap kolom adalah <strong>penjumlahan</strong> proyeksi masing-masing outlet — bukan proyeksi baru
        yang dibuat dari angka gabungan. Outlet dengan pola penjualan berbeda tidak diratakan.
      </p>

      <div class="report-kpis">
        ${kpi('Total Projected Revenue', rp(k.revenue))}
        ${kpi('Total Projected Units', num(k.units))}
        ${kpi('Total Projected Variable Cost', rp(k.variabel.total))}
        ${kpi('Total Projected CM', rp(k.cm))}
        ${kpi('CM %', pct(k.cmPersen))}
        ${kpi('Total Direct Fixed Cost', rp(k.fixedLangsung))}
        ${kpi('Total Projected Operating Profit', rp(k.operatingProfit))}
        ${kpi('Projected Operating Margin', pct(k.operatingMargin))}
      </div>

      ${
        dikecualikan.length
          ? `<p class="report-note" style="margin-top:10px">
               <strong>${dikecualikan.length} outlet tidak ikut dijumlahkan</strong> karena belum bisa diproyeksi:
               ${dikecualikan.map((o) => escapeHtml(o.outletName || '(tanpa nama)')).join(', ')}.
               Mereka <strong>tidak</strong> diisi rata-rata outlet lain. Total di atas karena itu adalah total
               outlet yang berjalan, bukan total seluruh BU.
             </p>`
          : ''
      }

      <p class="report-note" style="margin-top:8px">
        <strong>Tidak ada satu BEP proyeksi gabungan</strong>, alasannya sama seperti di Actual — ia menyembunyikan
        outlet yang diproyeksi rugi di balik yang diproyeksi untung. Posisi masing-masing:
        <strong>${k.ringkasBep.diAtas}</strong> di atas ·
        <strong>${k.ringkasBep.diBawah}</strong> di bawah ·
        <strong>${k.ringkasBep.pas}</strong> pas ·
        <strong>${k.ringkasBep.tidakBisa}</strong> belum bisa dihitung.
      </p>
    </section>`;
}

function panelBu(bu, k) {
  return `
    <section class="inline-card" style="margin-bottom:16px">
      <h3 style="margin:0 0 10px">Ringkasan Business Unit — ${TANDA}</h3>
      <div class="report-kpis">
        ${kpi('Projected Outlet Operating Profit', rp(k.operatingProfit), 'jumlah outlet yang bisa diproyeksi')}
        ${kpi('Projected BU Profit Before Shared', rp(bu.buProfitSebelumShared))}
        ${kpi('Shared BU Cost', rp(bu.sharedBu), 'bulanan, tidak dikalikan')}
        ${kpi('Projected BU Profit After Shared', rp(bu.buProfitSetelahShared))}
        ${kpi('Projected Margin setelah shared', pct(bu.marginSetelahShared))}
        ${kpi('Corporate Cost', rp(bu.corporate), 'TIDAK dikurangkan dari BU ini')}
      </div>
      <p class="report-note" style="margin-top:10px">${escapeHtml(bu.catatan)}</p>
    </section>`;
}

function kpi(label, nilai, keterangan = '') {
  return `
    <div class="report-kpi">
      <span class="report-kpi-label">${escapeHtml(label)}</span>
      <strong class="report-kpi-value">${nilai}</strong>
      ${keterangan ? `<span style="font-size:0.7rem;color:var(--color-text-muted)">${escapeHtml(keterangan)}</span>` : ''}
    </div>`;
}
