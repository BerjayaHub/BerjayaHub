import { escapeHtml } from '../../core/ui.js';
import { formatRupiah, formatNum } from '../../core/format.js';
import { monthRangeWIB } from '../../core/dates.js';
import { loadingHtml } from '../../core/loading.js';
import { muatDataOwner } from './muat-data.js';
import { gambarSaringan } from './ringkasan.owner.js';
import {
  hitungTarget,
  konsolidasiTarget,
  ringkasBuTarget,
  pencapaianTarget,
  STATUS_TARGET,
  STATUS_HITUNG,
  SUMBER,
  HARI_OPERASIONAL_BAKU
} from './target.js';

/**
 * TARGET / PLANNING — berapa yang HARUS dicapai.
 *
 * ============ SATU-SATUNYA LAYAR YANG BOLEH MEMUAT TIGA KONTEKS ============
 *
 * Layar Actual tidak boleh menyentuh proyeksi; layar Proyeksi tidak boleh
 * menyentuh aktual. Layar ini justru HARUS memuat ketiganya — karena
 * pertanyaannya memang perbandingan:
 *
 *   ACTUAL     Rp 80 juta   yang sudah terjadi
 *   TARGET     Rp 116,67 juta   yang harus dicapai
 *   PROJECTED  Rp 124 juta   perkiraan kalau laju sekarang bertahan
 *
 * Dari tiga baris itu langsung terbaca: aktual masih di bawah target, tapi
 * lajunya akan melewatinya. Kesimpulan itu mustahil didapat dari satu angka
 * saja, dan sangat mudah salah kalau tiga angka itu tercampur tanpa label.
 *
 * Maka aturannya di sini bukan "jangan campur" melainkan **tidak boleh ada satu
 * angka pun tanpa label kolomnya**. Perbandingannya digambar sebagai tabel
 * dengan tiga kepala kolom, bukan sebagai deretan kartu yang bisa terpotong saat
 * dipotret.
 *
 * ============ TIDAK MENULIS APA PUN ============
 *
 * Semua isian di layar ini asumsi perencanaan. Ia hidup di memori layar dan
 * hilang bersama layarnya — tidak tersimpan ke `outlet_costs`,
 * `outlet_menu_prices`, maupun ke mana pun. Asumsi yang tersimpan diam-diam akan
 * dipakai bulan depan oleh orang yang tidak tahu siapa yang mengetiknya.
 *
 * ============ KENAPA MENGHITUNG ULANG SAAT `change`, BUKAN SAAT MENGETIK ============
 *
 * Menghitung setiap ketukan berarti menggambar ulang daerah hasil setiap ketukan,
 * dan kotak yang sedang diketik akan kehilangan fokus di tengah angka. `change`
 * menyala saat fokus meninggalkan kotaknya — jadi angkanya sudah selesai
 * diketik, dan tidak ada yang terpotong.
 */

const rp = (n) => (n == null ? '—' : formatRupiah(n));
const num = (n, d = 0) => (n == null ? '—' : formatNum(n, d));
const pct = (n) => (n == null ? '—' : `${formatNum(n, 1)}%`);

/** Porsi dibulatkan KE ATAS di layar: 55,56 porsi berarti 56, bukan 55. */
const porsi = (n) => (n == null ? '—' : formatNum(Math.ceil(n), 0));

const TANDA_TARGET = '<span class="tanda-konteks">TARGET</span>';
const TANDA_ACTUAL = '<span class="tanda-konteks">ACTUAL</span>';
const TANDA_PROJECTED = '<span class="tanda-konteks">PROJECTED</span>';

const LABEL_STATUS = {
  [STATUS_TARGET.TERCAPAI]: 'badge-approved',
  [STATUS_TARGET.MENDEKATI]: 'badge-pending',
  [STATUS_TARGET.BELUM]: 'badge-rejected',
  [STATUS_TARGET.TIDAK_BISA]: 'badge'
};

export async function renderTargetOwner(root, ctx) {
  const awal = ctx.konteksAwal ?? {};
  const bulan = monthRangeWIB();
  const state = {
    dari: awal.dari ?? bulan.from,
    sampai: awal.sampai ?? bulan.to,
    outletIds: awal.outletIds ?? [],
    // Asumsi yang berlaku untuk semua outlet kecuali yang ditimpa sendiri.
    umum: { laba: 0, hari: HARI_OPERASIONAL_BAKU },
    // outletId -> { laba?, hari?, asp? }. Hanya berisi yang benar-benar ditimpa.
    perOutlet: {}
  };

  root.innerHTML = `
    <div class="module-header">
      <div class="module-header-title">🎯 Target &amp; Perencanaan — ${TANDA_TARGET}</div>
    </div>
    <div id="owner-saring"></div>
    <div id="owner-isi">${loadingHtml('Menghitung target…')}</div>
  `;

  gambarSaringan(root, state, () => muatDanGambar(root, ctx, state));
  await muatDanGambar(root, ctx, state);
}

async function muatDanGambar(root, ctx, state) {
  const isi = root.querySelector('#owner-isi');
  isi.innerHTML = loadingHtml('Menghitung target…');

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
      Halaman ini menjawab <strong>berapa yang harus dicapai</strong> — bukan berapa yang sudah terjadi
      (itu tab Profitabilitas) dan bukan perkiraan akhir bulan (itu tab Proyeksi).
      <br /><br />
      Ekonominya <strong>dipinjam dari data aktual</strong>: rasio biaya variabel, biaya tetap bulanan, dan harga
      rata-rata diambil apa adanya dari outlet masing-masing, jadi definisinya persis sama dengan tab Profitabilitas.
      <br /><br />
      <strong>Biaya tetap dipakai sebulan penuh</strong>, tidak diprorata menurut tanggal laporan. Target yang berubah
      setiap hari bukan target.
      <br /><br />
      Semua isian di bawah adalah <strong>asumsi perencanaan</strong>. Tidak ada satu pun yang tersimpan atau mengubah
      harga, biaya, maupun transaksi.
    </p>

    <section class="inline-card" style="margin-bottom:16px">
      <h3 style="margin:0 0 10px">Asumsi untuk semua outlet</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0;flex:1;min-width:170px">
          <label style="font-size:0.72rem" for="t-laba">Target laba / bulan (Rp)</label>
          <input type="number" id="t-laba" step="100000" value="${state.umum.laba}" />
        </div>
        <div class="field" style="margin:0;flex:1;min-width:170px">
          <label style="font-size:0.72rem" for="t-hari">Hari operasional / bulan</label>
          <input type="number" id="t-hari" min="0" max="31" step="1" value="${state.umum.hari}" />
        </div>
      </div>
      <p class="report-note" style="margin-top:10px">
        Target laba <strong>0</strong> berarti target = titik impas (BEP). Hari operasional dipakai membagi target
        bulanan jadi harian — outlet yang tutup sehari seminggu jangan diisi 30.
        Tiap outlet bisa menimpa keduanya sendiri di kartunya.
      </p>
    </section>

    <div id="t-hasil"></div>
  `;

  const pasang = (id, ubah) => {
    const el = isi.querySelector(id);
    el.addEventListener('change', () => {
      ubah(el.value);
      gambarHasil(isi, d, state);
    });
  };
  pasang('#t-laba', (v) => (state.umum.laba = Number(v) || 0));
  pasang('#t-hari', (v) => (state.umum.hari = v === '' ? null : Number(v)));

  gambarHasil(isi, d, state);
}

/**
 * Asumsi yang benar-benar berlaku untuk satu outlet.
 *
 * `?? null` bukan `?? 0`. Kotak yang dikosongkan berarti "pakai angka aktual",
 * bukan "nilainya nol" — dan bedanya besar: Variable Cost 0% berarti CM 100%,
 * yaitu target yang jauh lebih ringan, lahir dari kotak yang tidak diisi
 * siapa pun.
 */
function asumsiOutlet(state, outletId) {
  const o = state.perOutlet[outletId] ?? {};
  return {
    laba: o.laba ?? state.umum.laba,
    hari: o.hari ?? state.umum.hari,
    asp: o.asp ?? null,
    variabel: o.variabel ?? null
  };
}

function gambarHasil(isi, d, state) {
  const wrap = isi.querySelector('#t-hasil');
  const aktual = d.actual.outlets;
  const proyeksiPer = new Map((d.proyeksi?.outlets ?? []).map((p) => [p.outletId, p]));

  const target = aktual.map((a) => {
    const as = asumsiOutlet(state, a.outletId);
    return hitungTarget({
      actual: a,
      targetLabaBulanan: as.laba,
      hariOperasional: as.hari,
      asumsi: { asp: as.asp, variabelPersen: as.variabel }
    });
  });

  const kons = konsolidasiTarget(target);
  const bu = ringkasBuTarget({ konsolidasi: kons, biaya: d.biayaOutlet });
  const satuOutlet = target.length === 1;

  wrap.innerHTML = `
    ${target.length === 0 ? '<p class="report-note">Tidak ada outlet pada saringan ini.</p>' : ''}
    ${target.map((t, i) => kartuOutlet(t, aktual[i], proyeksiPer.get(t.outletId), state)).join('')}
    ${satuOutlet ? '' : panelKonsolidasi(kons)}
    ${target.length ? tabelRingkasBu(target) : ''}
    ${target.length ? panelBu(bu) : ''}
  `;

  // Isian per outlet: `change`, bukan `input` — lihat alasannya di kepala berkas.
  wrap.querySelectorAll('[data-outlet][data-kunci]').forEach((el) => {
    el.addEventListener('change', () => {
      const id = el.dataset.outlet;
      const kunci = el.dataset.kunci;
      state.perOutlet[id] = state.perOutlet[id] ?? {};
      // Kotak dikosongkan = kembali ke asumsi umum / nilai aktual, BUKAN nol.
      state.perOutlet[id][kunci] = el.value === '' ? null : Number(el.value);
      gambarHasil(isi, d, state);
    });
  });
}

// =====================================================================
// SATU OUTLET
// =====================================================================

function kartuOutlet(t, aktual, proyeksi, state) {
  const as = asumsiOutlet(state, t.outletId);
  const ek = t.masukan.ekonomi;

  const simpanan = state.perOutlet[t.outletId] ?? {};

  // Kotak isian DIBUKA sendiri kalau ada yang menahan perhitungan.
  //
  // `<details>` yang tertutup di bawah tulisan "belum bisa dihitung" adalah
  // jalan buntu: yang menahan justru ada di dalamnya, dan tidak ada yang
  // menunjukkan begitu. Itu persis kegagalan yang dilaporkan pada AB Sentul.
  const perluDiisi = !t.bisaDihitung;

  const isian = `
    <details style="margin-top:12px"${perluDiisi ? ' open' : ''}>
      <summary style="cursor:pointer;font-size:0.85rem">Ubah asumsi khusus outlet ini</summary>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px">
        <div class="field" style="margin:0;flex:1;min-width:150px">
          <label style="font-size:0.72rem">Target laba / bulan</label>
          <input type="number" step="100000" data-outlet="${t.outletId}" data-kunci="laba"
                 value="${simpanan.laba ?? ''}" placeholder="${as.laba}" />
        </div>
        <div class="field" style="margin:0;flex:1;min-width:150px">
          <label style="font-size:0.72rem">Hari operasional</label>
          <input type="number" min="0" max="31" step="1" data-outlet="${t.outletId}" data-kunci="hari"
                 value="${simpanan.hari ?? ''}" placeholder="${as.hari ?? ''}" />
        </div>
        <div class="field" style="margin:0;flex:1;min-width:150px">
          <label style="font-size:0.72rem">Variable Cost %${asal(ek.cmPersen.sumber)}</label>
          <input type="number" min="0" max="100" step="0.5" data-outlet="${t.outletId}" data-kunci="variabel"
                 value="${simpanan.variabel ?? ''}"
                 placeholder="${ek.cmPersen.nilaiAktual == null ? 'belum ada' : formatNum(100 - ek.cmPersen.nilaiAktual, 1)}" />
        </div>
        <div class="field" style="margin:0;flex:1;min-width:150px">
          <label style="font-size:0.72rem">ASP perencanaan${asal(ek.asp.sumber)}</label>
          <input type="number" min="0" step="500" data-outlet="${t.outletId}" data-kunci="asp"
                 value="${simpanan.asp ?? ''}" placeholder="${ek.asp.nilaiAktual ?? 'belum ada'}" />
        </div>
      </div>
      <p class="report-note" style="margin-top:10px">
        <strong>Variable Cost %</strong> dan <strong>ASP</strong> bisa datang dari data aktual atau dari asumsi
        perencanaan. Kalau outlet sudah punya transaksi, keduanya terisi sendiri dari transaksi itu; kalau belum,
        isi manual di sini dan target langsung bisa dihitung.
        <br /><br />
        Isian perencanaan <strong>hanya dipakai menghitung Target</strong> — ia tidak mengubah Actual, Proyeksi,
        harga jual, biaya outlet, maupun transaksi. Tidak ada satu pun yang tersimpan.
        <br /><br />
        Kosongkan sebuah kotak untuk kembali ke asumsi umum atau ke angka aktual. Kotak kosong <strong>bukan</strong>
        berarti nol — Variable Cost 0% berarti CM 100%, yaitu target yang jauh lebih ringan daripada yang sebenarnya.
      </p>
    </details>`;

  if (!t.bisaDihitung) {
    const cara =
      t.status === STATUS_HITUNG.LENGKAPI_VARIABEL
        ? 'Isi <strong>Variable Cost %</strong> di kotak yang sudah terbuka di bawah — misalnya <strong>40</strong> kalau HPP dan biaya per porsi diperkirakan 40% dari harga jual. Target BEP dan target laba langsung muncul.'
        : t.status === STATUS_HITUNG.LENGKAPI_FIXED
          ? 'Daftarkan biaya tetap outlet ini di <strong>Admin Portal → Biaya Outlet</strong> supaya angkanya ikut terpakai di seluruh halaman, bukan hanya di sini.'
          : '';

    return `
      <section class="inline-card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <h3 style="margin:0">${escapeHtml(t.outletName || '(tanpa nama)')} — ${TANDA_TARGET}</h3>
          <span class="badge badge-pending">${escapeHtml(t.status)}</span>
        </div>
        <p class="report-note" style="margin-top:10px">
          ${escapeHtml(t.sebab ?? '')}
          ${cara ? `<br /><br />${cara}` : ''}
          <br /><br />
          Untuk sementara outlet ini <strong>tidak dianggap bertarget nol</strong>. Nol berarti "tidak perlu
          menghasilkan apa pun untuk impas", yaitu kebalikan dari keadaannya. Ia dikeluarkan dari penjumlahan
          dan dilaporkan terpisah.
        </p>
        ${isian}
      </section>`;
  }

  const capai = pencapaianTarget({ revenueActual: aktual?.revenue, targetRevenue: t.target.revenueBulanan });

  return `
    <section class="inline-card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <h3 style="margin:0">${escapeHtml(t.outletName || '(tanpa nama)')} — ${TANDA_TARGET}</h3>
        <span class="badge ${LABEL_STATUS[capai.status] ?? 'badge'}">${escapeHtml(capai.status)}</span>
      </div>

      <h4 style="margin:0 0 6px;font-size:0.9rem">Titik impas (BEP) — target laba Rp 0</h4>
      <div class="report-kpis">
        ${kpi('BEP Omzet / bulan', rp(t.bep.revenueBulanan))}
        ${kpi('BEP Omzet / hari', rp(t.bep.revenueHarian), hariKet(t))}
        ${kpi('BEP Porsi / bulan', porsi(t.bep.unitBulanan), desimal(t.bep.unitBulanan, t))}
        ${kpi('BEP Porsi / hari', porsi(t.bep.unitHarian), desimal(t.bep.unitHarian, t))}
      </div>

      <h4 style="margin:14px 0 6px;font-size:0.9rem">
        Target laba ${rp(t.masukan.targetLabaBulanan)} / bulan
      </h4>
      <div class="report-kpis">
        ${kpi('Target Omzet / bulan', rp(t.target.revenueBulanan))}
        ${kpi('Target Omzet / hari', rp(t.target.revenueHarian), hariKet(t))}
        ${kpi('Target Porsi / bulan', porsi(t.target.unitBulanan), desimal(t.target.unitBulanan, t))}
        ${kpi('Target Porsi / hari', porsi(t.target.unitHarian), desimal(t.target.unitHarian, t))}
      </div>

      ${tabelBanding(t, aktual, proyeksi, capai)}
      ${blokRumus(t)}

      ${t.peringatan.map((p) => `<p class="report-note" style="margin-top:8px">${escapeHtml(p)}</p>`).join('')}
      ${isian}
    </section>`;
}

const hariKet = (t) => (t.rincian.hariOperasional ? `dibagi ${t.rincian.hariOperasional} hari` : 'hari operasional belum diisi');

/** Keterangan porsi: angka desimalnya, atau alasan kenapa kosong. */
const desimal = (n, t) => (n == null ? (t?.bisaPorsi === false ? 'ASP belum tersedia' : '') : `tepatnya ${formatNum(n, 2)}`);

/** Lencana kecil di sebelah label isian: dari mana angka yang sedang dipakai. */
const asal = (sumber) =>
  sumber === SUMBER.ASUMSI
    ? ' <span class="badge badge-pending" style="font-size:0.6rem">PLANNING</span>'
    : ' <span class="badge" style="font-size:0.6rem">dari aktual</span>';

/**
 * ACTUAL vs TARGET vs PROJECTED — tabel, bukan tiga kartu.
 *
 * Tabel dipilih justru karena kepala kolomnya tidak bisa dilepas dari angkanya.
 * Tiga kartu berdampingan akan terpotong saat dipotret atau digulir, dan angka
 * yang terlepas dari labelnya adalah kegagalan yang paling mahal di modul ini.
 */
function tabelBanding(t, aktual, proyeksi, capai) {
  const revActual = aktual?.revenue ?? null;
  const revProy = proyeksi?.bisaDiproyeksi ? proyeksi.revenue : null;

  const bandingProy =
    revProy == null || t.target.revenueBulanan == null
      ? 'Proyeksi belum tersedia untuk outlet ini.'
      : revProy >= t.target.revenueBulanan
        ? '<strong>Proyeksi sudah melewati target</strong> — kalau laju sekarang bertahan sampai akhir periode.'
        : '<strong>Proyeksi masih di bawah target</strong> — laju sekarang belum cukup sampai akhir periode.';

  return `
    <div class="table-scroll" style="margin-top:14px">
      <table class="data-table">
        <thead>
          <tr>
            <th>Omzet</th>
            <th>${TANDA_ACTUAL}</th>
            <th>${TANDA_TARGET}</th>
            <th>${TANDA_PROJECTED}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Sebulan</td>
            <td>${rp(revActual)}</td>
            <td>${rp(t.target.revenueBulanan)}</td>
            <td>${rp(revProy)}</td>
          </tr>
          <tr>
            <td>Arti</td>
            <td>sudah terjadi</td>
            <td>harus dicapai</td>
            <td>perkiraan akhir periode</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="report-note" style="margin-top:8px">
      Pencapaian aktual terhadap target: <strong>${pct(capai.persen)}</strong>
      ${capai.gap == null ? '' : `(selisih ${rp(capai.gap)})`}.
      ${bandingProy}
      <br /><br />
      Aktual dihitung hanya sampai tanggal yang tersaring, sedangkan target berlaku untuk <strong>sebulan penuh</strong> —
      jadi pencapaian di pertengahan bulan memang wajar terlihat rendah. Kolom PROJECTED-lah yang menjawab
      "kalau laju ini bertahan, targetnya kekejar atau tidak".
    </p>`;
}

/**
 * Rumusnya ditulis lengkap dengan angka antaranya.
 *
 * Target yang tidak bisa diperiksa ulang akan dipercaya bulat-bulat atau ditolak
 * bulat-bulat — dan target yang ditolak diam-diam tidak akan pernah dikejar.
 */
function blokRumus(t) {
  const r = t.rincian;
  const ek = t.masukan.ekonomi;

  const tandaSumber = (s) =>
    s === SUMBER.ASUMSI ? ' <span class="badge badge-pending">PLANNING ASSUMPTION</span>' : '';

  return `
    <details style="margin-top:12px">
      <summary style="cursor:pointer;font-size:0.85rem">Cara angkanya didapat</summary>
      <div class="table-scroll" style="margin-top:8px">
        <table class="data-table">
          <tbody>
            <tr>
              <td>Biaya tetap langsung / bulan${tandaSumber(ek.fixedBulanan.sumber)}</td>
              <td><strong>${rp(r.fixedBulanan)}</strong></td>
            </tr>
            <tr>
              <td>Rasio biaya variabel${tandaSumber(ek.cmPersen.sumber)}</td>
              <td><strong>${pct(r.variabelPersen)}</strong></td>
            </tr>
            <tr>
              <td>Contribution margin = 100% − rasio variabel</td>
              <td><strong>${pct(r.cmPersen)}</strong></td>
            </tr>
            <tr>
              <td>BEP omzet = biaya tetap ÷ CM%</td>
              <td><strong>${rp(t.bep.revenueBulanan)}</strong></td>
            </tr>
            <tr>
              <td>Target omzet = (biaya tetap + target laba) ÷ CM%</td>
              <td><strong>${rp(t.target.revenueBulanan)}</strong></td>
            </tr>
            <tr>
              <td>Hari operasional</td>
              <td><strong>${num(r.hariOperasional)}</strong></td>
            </tr>
            <tr>
              <td>Target omzet / hari</td>
              <td><strong>${rp(t.target.revenueHarian)}</strong></td>
            </tr>
            <tr>
              <td>Harga jual rata-rata (ASP)${tandaSumber(ek.asp.sumber)}</td>
              <td><strong>${rp(r.asp)}</strong></td>
            </tr>
            <tr>
              <td>Target porsi = target omzet ÷ ASP</td>
              <td><strong>${num(t.target.unitBulanan, 2)}</strong></td>
            </tr>
            <tr>
              <td>Target porsi / hari</td>
              <td><strong>${num(t.target.unitHarian, 2)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="report-note" style="margin-top:8px">
        <strong>Asal tiap angka.</strong>
        Biaya tetap: ${escapeHtml(ek.fixedBulanan.catatan)}
        Contribution margin: ${escapeHtml(ek.cmPersen.catatan)}
        ASP: ${escapeHtml(ek.asp.catatan)}
        <br /><br />
        Porsi disimpan sebagai desimal di perhitungan dan baru dibulatkan <strong>ke atas</strong> saat ditampilkan —
        55,56 porsi berarti 56, karena 55 belum menutup biayanya.
      </p>
    </details>`;
}

// =====================================================================
// KONSOLIDASI & BU
// =====================================================================

function panelKonsolidasi(k) {
  const dikecualikan = k.tidakBisaDihitung ?? [];

  return `
    <section class="inline-card" style="margin-bottom:16px;border-left:3px solid var(--color-primary)">
      <h3 style="margin:0 0 4px">
        ${escapeHtml(k.label)} — ${k.jumlahDihitung} dari ${k.jumlahOutlet} outlet ${TANDA_TARGET}
      </h3>
      <p class="report-note" style="margin:0 0 10px">
        Ini <strong>penjumlahan target tiap outlet</strong>, bukan satu BEP gabungan.
        <br /><br />
        BEP gabungan (biaya tetap total ÷ CM rata-rata) menghasilkan angka yang berbeda — dan arah selisihnya
        <strong>tidak bisa ditebak</strong>. Dua outlet yang mirip menghasilkan selisih kecil; satu outlet bermargin
        tebal bersama satu bermargin tipis bisa menghasilkan angka gabungan yang <strong>kurang dari separuh</strong>
        kebutuhan sebenarnya. Bias yang tetap masih bisa dikoreksi; bias yang berubah arah tidak.
      </p>

      <div class="report-kpis">
        ${kpi('Σ BEP Omzet / bulan', rp(k.bep.revenueBulanan))}
        ${kpi('Σ BEP Omzet / hari', rp(k.bep.revenueHarian))}
        ${kpi('Σ BEP Porsi / bulan', porsi(k.bep.unitBulanan))}
        ${kpi('Σ BEP Porsi / hari', porsi(k.bep.unitHarian))}
        ${kpi('Σ Target Omzet / bulan', rp(k.target.revenueBulanan))}
        ${kpi('Σ Target Omzet / hari', rp(k.target.revenueHarian))}
        ${kpi('Σ Target Porsi / bulan', porsi(k.target.unitBulanan))}
        ${kpi('Σ Target Porsi / hari', porsi(k.target.unitHarian))}
      </div>

      ${
        dikecualikan.length
          ? `<p class="report-note" style="margin-top:10px">
               <strong>${dikecualikan.length} outlet tidak ikut dijumlahkan</strong> karena targetnya belum bisa dihitung:
               ${dikecualikan.map((o) => escapeHtml(o.outletName || '(tanpa nama)')).join(', ')}.
             </p>`
          : ''
      }
    </section>`;
}

/** §19 — satu baris per outlet, delapan kolom target. */
function tabelRingkasBu(target) {
  return `
    <h3 style="margin:22px 0 8px">Ringkasan target per outlet — ${TANDA_TARGET}</h3>
    <div class="table-scroll">
      <table class="data-table table-freeze-1">
        <thead>
          <tr>
            <th>Outlet</th>
            <th>BEP Omzet/bln</th>
            <th>Target Omzet/bln</th>
            <th>BEP Porsi/bln</th>
            <th>Target Porsi/bln</th>
            <th>BEP Omzet/hari</th>
            <th>Target Omzet/hari</th>
            <th>BEP Porsi/hari</th>
            <th>Target Porsi/hari</th>
          </tr>
        </thead>
        <tbody>
          ${target
            .map(
              (t) => `<tr>
                <td>${escapeHtml(t.outletName || '(tanpa nama)')}</td>
                <td>${rp(t.bep.revenueBulanan)}</td>
                <td>${rp(t.target.revenueBulanan)}</td>
                <td>${porsi(t.bep.unitBulanan)}</td>
                <td>${porsi(t.target.unitBulanan)}</td>
                <td>${rp(t.bep.revenueHarian)}</td>
                <td>${rp(t.target.revenueHarian)}</td>
                <td>${porsi(t.bep.unitHarian)}</td>
                <td>${porsi(t.target.unitHarian)}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function panelBu(bu) {
  return `
    <section class="inline-card" style="margin:16px 0">
      <h3 style="margin:0 0 10px">Business Unit — ${TANDA_TARGET}</h3>
      <div class="report-kpis">
        ${kpi('Σ Target laba seluruh outlet', rp(bu.targetLabaSeluruhOutlet))}
        ${kpi('Shared BU Cost', rp(bu.sharedBu), bu.rincianShared.length ? `${bu.rincianShared.length} pos` : 'belum ada')}
        ${kpi('Laba BU bila semua target tercapai', rp(bu.labaBuJikaTercapai))}
        ${kpi('Corporate Cost', rp(bu.corporate), 'TIDAK dikurangkan dari BU ini')}
      </div>
      <p class="report-note" style="margin-top:10px">
        ${escapeHtml(bu.catatan)}
        <br /><br />
        Baris ketiga yang paling mudah terlewat: <strong>seluruh outlet mencapai target belum tentu berarti BU
        untung.</strong> Target outlet hanya menutup biaya tetap langsungnya sendiri; biaya bersama BU masih harus
        ditutup dari sisanya.
      </p>
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

function kpi(label, nilai, keterangan = '') {
  return `
    <div class="report-kpi">
      <span class="report-kpi-label">${escapeHtml(label)}</span>
      <strong class="report-kpi-value">${nilai}</strong>
      ${keterangan ? `<span style="font-size:0.7rem;color:var(--color-text-muted)">${escapeHtml(keterangan)}</span>` : ''}
    </div>`;
}
