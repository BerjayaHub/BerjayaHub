import { escapeHtml } from '../../core/ui.js';
import { formatRupiah, formatNum } from '../../core/format.js';
import { monthRangeWIB } from '../../core/dates.js';
import { loadingHtml } from '../../core/loading.js';
import { muatDataOwner } from './muat-data.js';
import { gambarSaringan } from './ringkasan.owner.js';
import { LABEL_METODE, METODE } from './pricing.js';
import {
  baselineSimulasi,
  simulasiOutlet,
  bandingkan,
  ringkasSimulasi,
  hargaSimulasi,
  MODE,
  SUSUNAN_VARIABEL
} from './simulasi.js';

/**
 * SIMULASI — layar kotak pasir.
 *
 * ============ INI LAYAR PALING MUDAH DISALAHPAHAMI DI SELURUH APLIKASI ============
 *
 * Tiga layar sebelumnya masih terikat sesuatu yang nyata: transaksi, laju,
 * biaya yang terdaftar. Layar ini tidak terikat apa pun — angkanya seluruhnya
 * karangan yang disengaja.
 *
 * Dan karangan yang rapi jauh lebih meyakinkan daripada kenyataan yang berantakan.
 * "Laba Rp 47,5 juta" yang lahir dari asumsi yang diketik lima menit lalu
 * terlihat persis seperti laba yang sudah masuk rekening — lebih rapi, malah,
 * karena tidak ada peringatan HPP kosong di bawahnya.
 *
 * Maka penanda SIMULATION dipasang di SETIAP panel, termasuk di kolom baseline,
 * dan tidak ada satu pun angka di layar ini yang berdiri tanpa label.
 *
 * ============ TIDAK MENULIS APA PUN ============
 *
 * Semua isian hidup di memori layar dan hilang bersamanya. Tidak ada tombol
 * simpan, tidak ada `outlet_menu_prices`, tidak ada `outlet_costs`. Harga hasil
 * simulasi TIDAK bisa dipasang dari sini — kalau mau dipakai sungguhan, ia
 * diketik ulang di Admin Portal → Menu → Harga per Outlet, tempat perubahannya
 * tercatat sebagai keputusan.
 *
 * ============ BASELINE LEWAT JALUR YANG SAMA ============
 *
 * Kolom kiri BUKAN angka yang diambil dari layar Actual. Ia hasil
 * `simulasiOutlet()` dengan ekonomi apa adanya. Alasannya di kepala
 * `simulasi.js`: kalau kedua sisi lahir dari jalur kode berbeda, kolom Delta
 * mengukur perbedaan kode, bukan perbedaan asumsi.
 */

const rp = (n) => (n == null ? '—' : formatRupiah(n));
const num = (n, d = 0) => (n == null ? '—' : formatNum(n, d));
const pct = (n) => (n == null ? '—' : `${formatNum(n, 1)}%`);
const porsi = (n) => (n == null ? '—' : formatNum(Math.ceil(n), 0));

const TANDA = '<span class="tanda-konteks">SIMULATION</span>';

export async function renderSimulasiOwner(root, ctx) {
  const awal = ctx.konteksAwal ?? {};
  const bulan = monthRangeWIB();
  const state = {
    dari: awal.dari ?? bulan.from,
    sampai: awal.sampai ?? bulan.to,
    outletIds: awal.outletIds ?? [],
    // outletId -> masukan simulasi. Kosong = pakai baseline apa adanya.
    input: {},
    // outletId -> { metode, persen, hpp, kemasan } untuk simulasi harga.
    harga: {}
  };

  root.innerHTML = `
    <div class="module-header">
      <div class="module-header-title">🧪 Simulasi — ${TANDA}</div>
    </div>
    <div id="owner-saring"></div>
    <div id="owner-isi">${loadingHtml('Menyiapkan simulasi…')}</div>
  `;

  gambarSaringan(root, state, () => muatDanGambar(root, ctx, state));
  await muatDanGambar(root, ctx, state);
}

async function muatDanGambar(root, ctx, state) {
  const isi = root.querySelector('#owner-isi');
  isi.innerHTML = loadingHtml('Menyiapkan simulasi…');

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

  isi.innerHTML = `
    <p class="report-note" style="margin-bottom:14px">
      Halaman ini menjawab <strong>"bagaimana kalau…"</strong>. Seluruh angkanya
      <strong>karangan yang disengaja</strong> — bukan yang sudah terjadi (tab Profitabilitas), bukan perkiraan
      (tab Proyeksi), bukan yang harus dicapai dengan keadaan sekarang (tab Target).
      <br /><br />
      <strong>Tidak ada yang tersimpan.</strong> Menutup halaman ini menghapus semua isiannya. Harga hasil simulasi
      tidak bisa dipasang dari sini — kalau mau dipakai, ketik ulang di Admin Portal → Menu → Harga per Outlet,
      tempat perubahannya tercatat sebagai keputusan.
      <br /><br />
      Kolom <strong>Baseline</strong> dihitung fungsi yang sama dengan kolom Simulasi, memakai ekonomi apa adanya.
      Jadi kolom Delta murni akibat asumsi yang kamu ubah.
    </p>
    <div id="s-hasil"></div>
  `;

  gambarHasil(isi, d, state);
}

/** Masukan yang berlaku untuk satu outlet, sudah bersih dari kotak kosong. */
function inputOutlet(state, outletId) {
  const raw = state.input[outletId] ?? {};
  const bersih = {};
  // Kotak kosong dibuang, BUKAN dikirim sebagai 0. `Number('')` adalah 0, dan
  // Variable Cost 0% berarti CM 100% — simulasi jauh lebih indah daripada yang
  // sebenarnya, lahir dari kotak yang tidak diisi siapa pun.
  for (const [k, v] of Object.entries(raw)) if (v != null) bersih[k] = v;
  return { hariOperasional: 30, targetLaba: 0, mode: MODE.REVENUE, ...bersih };
}

function gambarHasil(isi, d, state) {
  const wrap = isi.querySelector('#s-hasil');
  const aktual = d.actual.outlets;

  const kartu = aktual.map((a) => {
    // Asumsi Target 10A dipakai sebagai baseline saat outlet belum berjualan.
    // Tanpa itu, outlet baru tidak punya titik awal apa pun untuk disimulasikan.
    const baseline = baselineSimulasi({ actual: a });
    const inp = inputOutlet(state, a.outletId);

    // Baseline memakai volume & periode yang SAMA dengan simulasi, supaya yang
    // berbeda hanya ekonominya. Kalau volumenya ikut berbeda, kolom Delta
    // mencampur dua perubahan sekaligus dan tidak menjawab apa pun.
    const dasar = simulasiOutlet({
      baseline,
      input: {
        hariOperasional: inp.hariOperasional,
        targetLaba: inp.targetLaba,
        mode: inp.mode,
        revenue: inp.revenue,
        units: inp.units
      },
      peran: 'baseline'
    });

    const sim = simulasiOutlet({ baseline, input: inp });
    return { a, baseline, dasar, sim, banding: bandingkan({ baseline: dasar, simulasi: sim }) };
  });

  const ring = ringkasSimulasi(kartu.map((k) => k.sim));
  const satu = kartu.length === 1;

  wrap.innerHTML = `
    ${kartu.length === 0 ? '<p class="report-note">Tidak ada outlet pada saringan ini.</p>' : ''}
    ${kartu.map((k) => kartuOutlet(k, state)).join('')}
    ${satu ? '' : panelRingkas(ring)}
  `;

  wrap.querySelectorAll('[data-outlet][data-kunci]').forEach((el) => {
    el.addEventListener('change', () => {
      const { outlet, kunci, kelompok } = el.dataset;
      const tujuan = kelompok === 'harga' ? state.harga : state.input;
      tujuan[outlet] = tujuan[outlet] ?? {};
      tujuan[outlet][kunci] = el.value === '' ? null : el.type === 'number' ? Number(el.value) : el.value;
      gambarHasil(isi, d, state);
    });
  });

  wrap.querySelectorAll('[data-reset]').forEach((el) => {
    el.addEventListener('click', () => {
      delete state.input[el.dataset.reset];
      delete state.harga[el.dataset.reset];
      gambarHasil(isi, d, state);
    });
  });
}

// =====================================================================
// SATU OUTLET
// =====================================================================

function kartuOutlet({ a, baseline, dasar, sim, banding }, state) {
  const id = a.outletId;
  const inp = state.input[id] ?? {};
  const mode = inputOutlet(state, id).mode;
  const b = baseline;

  const kotak = (kunci, label, { step = 1, min = null, max = null, placeholder = '' } = {}) => `
    <div class="field" style="margin:0;flex:1;min-width:145px">
      <label style="font-size:0.72rem">${label}</label>
      <input type="number" step="${step}"${min == null ? '' : ` min="${min}"`}${max == null ? '' : ` max="${max}"`}
             data-outlet="${id}" data-kunci="${kunci}" value="${inp[kunci] ?? ''}" placeholder="${escapeHtml(String(placeholder))}" />
    </div>`;

  return `
    <section class="inline-card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <h3 style="margin:0">${escapeHtml(a.outletName || '(tanpa nama)')} — ${TANDA}</h3>
        <button data-reset="${id}" style="min-height:34px;font-size:0.8rem">Kembalikan ke baseline</button>
      </div>

      <h4 style="margin:0 0 8px;font-size:0.9rem">Asumsi simulasi</h4>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        ${kotak('asp', 'Harga jual / ASP', { step: 500, min: 0, placeholder: b.asp.nilai ?? 'belum ada' })}
        ${kotak('promoPersen', 'Promo %', { step: 0.5, min: 0, max: 99, placeholder: 0 })}
        ${kotak('feePersen', 'Merchant fee / komisi %', { step: 0.5, min: 0, max: 99, placeholder: 0 })}
        ${kotak('variabelPersen', 'Variable Cost %', { step: 0.5, min: 0, placeholder: b.variabelPersen.nilai ?? 'belum ada' })}
        ${kotak('hppSatuan', 'HPP / porsi', { step: 500, min: 0, placeholder: 'opsional' })}
        ${kotak('kemasanSatuan', 'Kemasan / porsi', { step: 250, min: 0, placeholder: 'opsional' })}
        ${kotak('fixedBulanan', 'Biaya tetap / bulan', { step: 500000, min: 0, placeholder: b.fixedBulanan.nilai ?? 0 })}
        ${kotak('hariOperasional', 'Hari operasional', { step: 1, min: 0, max: 31, placeholder: 30 })}
        ${kotak('targetLaba', 'Target laba / bulan', { step: 500000, placeholder: 0 })}
      </div>

      <h4 style="margin:14px 0 8px;font-size:0.9rem">Volume yang disimulasikan</h4>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0;flex:1;min-width:170px">
          <label style="font-size:0.72rem">Yang saya tentukan</label>
          <select data-outlet="${id}" data-kunci="mode">
            <option value="${MODE.REVENUE}"${mode === MODE.REVENUE ? ' selected' : ''}>Omzet — porsinya dihitung</option>
            <option value="${MODE.UNIT}"${mode === MODE.UNIT ? ' selected' : ''}>Porsi — omzetnya dihitung</option>
          </select>
        </div>
        ${
          mode === MODE.UNIT
            ? kotak('units', 'Porsi / bulan', { step: 10, min: 0, placeholder: b.unitsAktual ?? 0 })
            : kotak('revenue', 'Omzet / bulan', { step: 1000000, min: 0, placeholder: b.revenueAktual ?? 0 })
        }
      </div>
      <p class="report-note" style="margin-top:10px">
        Dua arah pertanyaan yang sama. <strong>Omzet</strong> menjawab "kalau omzet segini, labanya berapa";
        <strong>Porsi</strong> menjawab "kalau terjual segini banyak, omzet dan labanya berapa".
        ${
          b.adaTransaksi
            ? `Angka abu-abu di kotaknya adalah realisasi periode ini (${rp(b.revenueAktual)} · ${porsi(b.unitsAktual)} porsi).`
            : 'Outlet ini belum punya transaksi, jadi belum ada angka pembanding.'
        }
      </p>

      ${catatanSusunan(sim)}
      ${sim.sebab ? `<p class="report-note" style="margin-top:10px">${escapeHtml(sim.sebab)}</p>` : ''}
      ${sim.peringatan.map((p) => `<p class="report-note" style="margin-top:8px">${escapeHtml(p)}</p>`).join('')}

      ${panelHasil(sim)}
      ${tabelBanding(banding)}
      ${panelHarga(a, state)}
    </section>`;
}

/**
 * Bagaimana rasio biaya variabel disusun.
 *
 * Ditampilkan selalu, bukan hanya saat bermasalah: inilah satu-satunya angka di
 * layar ini yang bisa terhitung dua kali tanpa terlihat salah, dan orang yang
 * mengisi HPP lalu juga mengisi Variable Cost % berhak tahu mana yang menang.
 */
function catatanSusunan(sim) {
  const e = sim.ekonomi;
  const teks = {
    [SUSUNAN_VARIABEL.LANGSUNG]: `<strong>${pct(e.variabelPersen)}</strong> — diketik langsung. HPP, kemasan, dan fee di atas tidak ditambahkan lagi di atasnya.`,
    [SUSUNAN_VARIABEL.TERURAI]: `<strong>${pct(e.variabelPersen)}</strong> — disusun dari (HPP + kemasan) ÷ harga efektif, ditambah merchant fee ${pct(e.feePersen)}.`,
    [SUSUNAN_VARIABEL.BASELINE]: `<strong>${pct(e.variabelPersen)}</strong> — dari ekonomi outlet apa adanya, belum diubah.`
  };

  return `
    <p class="report-note" style="margin-top:12px">
      <strong>Biaya variabel yang dipakai:</strong> ${teks[e.susunanVariabel] ?? '—'}
      <br /><br />
      Promo memotong <strong>harga</strong> (${rp(e.aspDasar)} → ${rp(e.aspEfektif)}); merchant fee memotong
      <strong>omzet</strong>. Dipisahkan begitu supaya tidak ada rupiah yang dipotong dua kali.
    </p>`;
}

function panelHasil(sim) {
  const e = sim.ekonomi;
  const v = sim.volume;

  return `
    <h4 style="margin:16px 0 8px;font-size:0.9rem">Hasil simulasi — ${TANDA}</h4>
    <div class="report-kpis">
      ${kpi('Harga efektif / porsi', rp(e.aspEfektif), e.promoPersen ? `setelah promo ${formatNum(e.promoPersen, 1)}%` : '')}
      ${kpi('Variable Cost %', pct(e.variabelPersen))}
      ${kpi('Contribution Margin %', pct(e.cmPersen))}
      ${kpi('CM / porsi', rp(e.cmSatuan))}
      ${kpi('Omzet simulasi', rp(v.revenue))}
      ${kpi('Porsi simulasi', porsi(v.units), v.units == null ? '' : `tepatnya ${formatNum(v.units, 2)}`)}
      ${kpi('Biaya variabel', rp(v.variabelTotal))}
      ${kpi('Contribution Margin', rp(v.cm))}
      ${kpi('Biaya tetap / bulan', rp(v.fixedBulanan))}
      ${kpi('Operating Profit', rp(v.operatingProfit))}
      ${kpi('Operating Margin', pct(v.operatingMargin))}
    </div>

    <h4 style="margin:16px 0 8px;font-size:0.9rem">Titik impas &amp; target pada asumsi ini — ${TANDA}</h4>
    <div class="report-kpis">
      ${kpi('BEP Omzet / bulan', rp(sim.bep.revenueBulanan))}
      ${kpi('BEP Omzet / hari', rp(sim.bep.revenueHarian))}
      ${kpi('BEP Porsi / bulan', porsi(sim.bep.unitBulanan))}
      ${kpi('BEP Porsi / hari', porsi(sim.bep.unitHarian))}
      ${kpi('Target Omzet / bulan', rp(sim.target.revenueBulanan))}
      ${kpi('Target Omzet / hari', rp(sim.target.revenueHarian))}
      ${kpi('Target Porsi / bulan', porsi(sim.target.unitBulanan))}
      ${kpi('Target Porsi / hari', porsi(sim.target.unitHarian))}
    </div>`;
}

/**
 * Baseline vs simulasi.
 *
 * Warna delta memakai `naikBaik` milik tiap baris, bukan satu aturan untuk
 * semuanya: BEP yang turun kabar baik, laba yang turun bukan. Satu aturan
 * seragam akan menghijaukan BEP yang membengkak.
 */
function tabelBanding(banding) {
  const isi = (b) => {
    const f = (n) => (n == null ? '—' : b.satuan === 'rp' ? formatRupiah(n) : b.satuan === 'pp' ? `${formatNum(n, 1)}%` : formatNum(n, 0));
    const tanda = b.delta == null || Math.abs(b.delta) < 1e-9 ? '' : b.delta > 0 ? '+' : '−';
    const baik = b.delta == null || Math.abs(b.delta) < 1e-9 ? null : b.delta > 0 === b.naikBaik;
    const warna = baik == null ? 'var(--color-text-muted)' : baik ? 'var(--color-primary)' : 'var(--color-danger, #c0392b)';
    const dl = b.delta == null ? '—' : `${tanda}${f(Math.abs(b.delta))}`;
    return `<tr>
      <td>${escapeHtml(b.label)}</td>
      <td>${f(b.baseline)}</td>
      <td><strong>${f(b.simulasi)}</strong></td>
      <td style="color:${warna}"><strong>${dl}</strong></td>
    </tr>`;
  };

  return `
    <h4 style="margin:16px 0 8px;font-size:0.9rem">Baseline vs simulasi</h4>
    <div class="table-scroll">
      <table class="data-table table-freeze-1">
        <thead>
          <tr>
            <th>Metrik</th>
            <th>Baseline ${TANDA}</th>
            <th>Simulasi ${TANDA}</th>
            <th>Delta</th>
          </tr>
        </thead>
        <tbody>${banding.baris.map(isi).join('')}</tbody>
      </table>
    </div>
    <p class="report-note" style="margin-top:8px">
      ${escapeHtml(banding.catatan)}
      <br /><br />
      Warna delta mengikuti arti tiap baris, bukan tandanya: <strong>BEP yang turun itu kabar baik</strong>,
      laba yang turun bukan.
      <br /><br />
      Kolom Baseline juga berlabel SIMULATION — ia bukan angka aktual, melainkan ekonomi apa adanya yang
      dijalankan lewat mesin simulasi supaya kedua kolom sebanding.
    </p>`;
}

// =====================================================================
// SIMULASI HARGA
// =====================================================================

function panelHarga(a, state) {
  const id = a.outletId;
  const h = state.harga[id] ?? {};
  const metode = h.metode ?? 'food_cost';
  const hasil = hargaSimulasi({
    metode,
    persen: h.persen ?? 35,
    hpp: h.hpp ?? null,
    kemasan: h.kemasan ?? 0,
    feePersen: state.input[id]?.feePersen ?? 0,
    promoPersen: state.input[id]?.promoPersen ?? 0
  });

  const kotak = (kunci, label, opsi = {}) => `
    <div class="field" style="margin:0;flex:1;min-width:140px">
      <label style="font-size:0.72rem">${label}</label>
      <input type="number" step="${opsi.step ?? 1}" min="0" data-outlet="${id}" data-kelompok="harga" data-kunci="${kunci}"
             value="${h[kunci] ?? ''}" placeholder="${escapeHtml(String(opsi.placeholder ?? ''))}" />
    </div>`;

  return `
    <details style="margin-top:14px">
      <summary style="cursor:pointer;font-size:0.85rem">Simulasi harga jual dari HPP</summary>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px">
        <div class="field" style="margin:0;flex:1;min-width:150px">
          <label style="font-size:0.72rem">Metode</label>
          <select data-outlet="${id}" data-kelompok="harga" data-kunci="metode">
            ${METODE.map((m) => `<option value="${m}"${m === metode ? ' selected' : ''}>${LABEL_METODE[m]}</option>`).join('')}
          </select>
        </div>
        ${kotak('persen', 'Persentase', { step: 0.5, placeholder: 35 })}
        ${kotak('hpp', 'HPP / porsi', { step: 500, placeholder: 'wajib' })}
        ${kotak('kemasan', 'Kemasan / porsi', { step: 250, placeholder: 0 })}
      </div>

      <div class="report-kpis" style="margin-top:12px">
        ${kpi('Dasar biaya / porsi', rp(hasil.hppTotal), 'HPP + kemasan')}
        ${kpi('Harga simulasi', rp(hasil.harga))}
        ${kpi('Harga untuk marketplace', rp(hasil.hargaOnline), 'supaya yang diterima sama')}
        ${kpi('CM / porsi', rp(hasil.cmSatuan))}
        ${kpi('CM %', pct(hasil.cmPersen))}
      </div>

      ${hasil.sebab ? `<p class="report-note" style="margin-top:10px">${escapeHtml(hasil.sebab)}</p>` : ''}

      <p class="report-note" style="margin-top:10px">
        <strong>Biaya tetap sengaja tidak masuk ke harga.</strong> Membebankan sewa ke tiap porsi membuat harga
        <em>naik</em> ketika penjualan <em>turun</em> — persis kebalikan dari yang seharusnya. Biaya tetap ditutup
        oleh volume, dan itulah gunanya angka BEP di atas.
        <br /><br />
        Harga marketplace bukan harga biasa ditambah fee: potongannya dihitung dari harga yang sudah naik, jadi
        menutup fee 20% butuh menaikkan harga 25%, bukan 20%.
        <br /><br />
        Harga di sini <strong>tidak dipasang ke mana pun</strong>. Kalau mau dipakai, ketik ulang di
        Admin Portal → Menu → Harga per Outlet.
      </p>
    </details>`;
}

function panelRingkas(r) {
  return `
    <section class="inline-card" style="margin-bottom:16px;border-left:3px solid var(--color-primary)">
      <h3 style="margin:0 0 4px">${escapeHtml(r.label)} — ${r.jumlahDihitung} dari ${r.jumlahOutlet} outlet ${TANDA}</h3>
      <p class="report-note" style="margin:0 0 10px">${escapeHtml(r.catatan)}</p>
      <div class="report-kpis">
        ${kpi('Σ Omzet simulasi', rp(r.revenue))}
        ${kpi('Σ Porsi simulasi', porsi(r.units))}
        ${kpi('Σ Operating Profit', rp(r.operatingProfit))}
        ${kpi('Operating Margin gabungan', pct(r.operatingMargin))}
      </div>
      ${
        r.tidakBisaDihitung.length
          ? `<p class="report-note" style="margin-top:10px">
               <strong>${r.tidakBisaDihitung.length} outlet tidak ikut dijumlahkan</strong> karena asumsinya belum
               menghasilkan margin yang bisa dihitung:
               ${r.tidakBisaDihitung.map((o) => escapeHtml(o.outletName || '(tanpa nama)')).join(', ')}.
             </p>`
          : ''
      }
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
