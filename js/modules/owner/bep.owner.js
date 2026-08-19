import { escapeHtml } from '../../core/ui.js';
import { formatRupiah, formatNum, attachThousandsInput, parseNumber } from '../../core/format.js';
import { monthRangeWIB } from '../../core/dates.js';
import { loadingHtml } from '../../core/loading.js';
import { muatDataOwner } from './muat-data.js';
import { gambarSaringan } from './ringkasan.owner.js';
import { hitungBep, posisiTerhadapBep } from './bep.js';
import { ringkasHarga, METODE, LABEL_METODE } from './pricing.js';

/**
 * BEP & Harga.
 *
 * ============ DUA SUMBER ANGKA, DAN BEDANYA SELALU DIKATAKAN ============
 *
 * Halaman ini bisa berjalan dari DATA NYATA (penjualan yang tercatat) atau dari
 * ANGKA YANG DIKETIK. Yang kedua ada karena keputusan yang sudah diambil di
 * putaran sebelumnya: penjualan belum rajin diinput, dan halaman BEP yang kosong
 * tidak menolong siapa pun.
 *
 * Tapi keduanya TIDAK PERNAH digambar dengan tampilan yang sama. Angka dari
 * ketikan selalu membawa penanda "perkiraan". Tanpa itu, seseorang akan
 * mengetik volume optimis sekali, melihat BEP yang menyenangkan, lalu mengingat
 * angkanya sebagai fakta seminggu kemudian.
 *
 * ============ SIMULASI TIDAK MENGUBAH APA PUN ============
 *
 * Metode & persentase harga di halaman ini bisa diubah-ubah untuk melihat
 * akibatnya, tapi tidak tersimpan — owner memang tidak punya hak tulis
 * (migration 0093). Yang tersimpan diatur admin di Master Produk. Itu ditulis
 * di layarnya, bukan cuma di sini.
 */

const rp = (n) => (n == null ? '—' : formatRupiah(n));
const num = (n) => (n == null ? '—' : formatNum(n, 0));
const pct = (n) => (n == null ? '—' : `${formatNum(n, 1)}%`);

export async function renderBepOwner(root, ctx) {
  const awal = ctx.konteksAwal ?? {};
  const bulan = monthRangeWIB();
  const state = {
    dari: awal.dari ?? bulan.from,
    sampai: awal.sampai ?? bulan.to,
    outletIds: awal.outletIds ?? [],
    hariKerja: awal.hariKerja ?? 30,
    targetLaba: awal.targetLaba ?? 0,
    biayaTetapManual: awal.biayaTetapManual ?? null,
    // Simulasi harga: dimulai dari setelan BU, boleh diubah tanpa disimpan.
    metode: awal.metode ?? ctx.bu?.pricing_method ?? 'food_cost',
    persen: awal.persen ?? persenBawaan(ctx.bu, awal.metode ?? ctx.bu?.pricing_method ?? 'food_cost')
  };

  root.innerHTML = `
    <div class="module-header">
      <div class="module-header-title">⚖️ BEP &amp; Harga</div>
    </div>
    <div id="owner-saring"></div>
    <div id="owner-isi">${loadingHtml('Menghitung…')}</div>
  `;

  gambarSaringan(root, state, () => muatDanGambar(root, ctx, state));
  await muatDanGambar(root, ctx, state);
}

function persenBawaan(bu, metode) {
  if (metode === 'markup') return Number(bu?.markup_percent ?? 100);
  if (metode === 'margin') return Number(bu?.margin_percent ?? 60);
  return Number(bu?.food_cost_percent ?? 35);
}

async function muatDanGambar(root, ctx, state) {
  const isi = root.querySelector('#owner-isi');
  isi.innerHTML = loadingHtml('Menghitung…');

  let d;
  try {
    d = await muatDataOwner({
      businessUnitId: ctx.businessUnitId,
      dari: state.dari,
      sampai: state.sampai,
      outletIds: state.outletIds,
      hariKerja: state.hariKerja,
      targetLaba: state.targetLaba
    });
  } catch (error) {
    isi.innerHTML = `<p class="error-text">Gagal memuat: ${escapeHtml(error?.message ?? String(error))}</p>
      <button id="btn-ulang">Coba lagi</button>`;
    isi.querySelector('#btn-ulang').addEventListener('click', () => muatDanGambar(root, ctx, state));
    return;
  }

  gambarSaringan(root, state, () => muatDanGambar(root, ctx, state), { outlets: d.outlets });
  ctx.catatKonteks?.({ ...state });

  gambarIsi(root, ctx, state, d);
}

function gambarIsi(root, ctx, state, d) {
  const isi = root.querySelector('#owner-isi');
  const { bauran, biayaTetap } = d;

  const adaPenjualan = bauran.totalQty > 0;
  const tetapDipakai = state.biayaTetapManual ?? biayaTetap.total;

  // Kalau biaya tetapnya ditimpa manual, BEP-nya dihitung ulang di sini —
  // bukan memakai `d.bep`, yang dihitung dari kas. Menampilkan angka lama
  // sesudah orangnya mengetik yang baru adalah cara termudah membuat orang
  // mengira aplikasinya tidak merespons.
  const bep =
    state.biayaTetapManual == null
      ? d.bep
      : hitungBep({
          marginSatuan: bauran.marginTertimbang,
          hargaRata: bauran.hargaTertimbang,
          biayaTetap: tetapDipakai,
          targetLaba: state.targetLaba,
          hariKerja: state.hariKerja
        });

  const posisi = state.biayaTetapManual == null ? d.posisi : posisiTerhadapBep({ totalQty: bauran.totalQty, bepPorsi: bep.porsi });

  isi.innerHTML = `
    ${adaPenjualan ? '' : panelTanpaPenjualan()}

    <div class="report-note" style="margin-bottom:14px">
      Rata-rata di bawah <strong>ditimbang menurut jumlah yang benar-benar terjual</strong>, bukan dirata-ratakan datar antar menu.
      Menu mahal yang jarang laku tidak lagi menarik marginnya ke atas.
    </div>

    <div class="report-kpis">
      ${kartu('Harga jual rata-rata', rp(bauran.hargaTertimbang))}
      ${kartu('HPP rata-rata', rp(bauran.hppTertimbang))}
      ${kartu('Margin per porsi', rp(bauran.marginTertimbang))}
      ${kartu('Porsi terjual', num(bauran.totalQty))}
    </div>

    <h3 style="margin:22px 0 8px">Angka yang bisa diubah</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:6px">
      <div class="field" style="margin:0;flex:1;min-width:160px">
        <label style="font-size:0.72rem">Biaya tetap per periode</label>
        <input type="text" inputmode="numeric" id="i-tetap" value="${formatNum(tetapDipakai, 0)}" />
        <span class="field-help">Dari kas: ${rp(biayaTetap.total)}${
          biayaTetap.tanpaKategori > 0 ? ` · ${rp(biayaTetap.tanpaKategori)} belum berkategori` : ''
        }</span>
      </div>
      <div class="field" style="margin:0;flex:1;min-width:140px">
        <label style="font-size:0.72rem">Target laba</label>
        <input type="text" inputmode="numeric" id="i-target" value="${formatNum(state.targetLaba, 0)}" />
      </div>
      <div class="field" style="margin:0;flex:1;min-width:110px">
        <label style="font-size:0.72rem">Hari kerja</label>
        <input type="number" id="i-hari" min="0" max="366" value="${state.hariKerja}" />
      </div>
      <button class="primary" id="btn-hitung" style="min-height:44px">Hitung ulang</button>
      ${state.biayaTetapManual != null ? '<button id="btn-reset-tetap" style="min-height:44px">Pakai angka kas</button>' : ''}
    </div>
    ${
      state.biayaTetapManual != null
        ? '<p class="report-note" style="margin-bottom:14px">Biaya tetap sedang <strong>ditimpa manual</strong> — bukan angka dari buku kas.</p>'
        : ''
    }

    <h3 style="margin:22px 0 8px">Titik impas</h3>
    ${
      bep.sebab
        ? `<p class="error-text">${escapeHtml(bep.sebab)}</p>`
        : `<div class="report-kpis">
             ${kartu('BEP porsi', num(bep.porsi))}
             ${kartu('BEP omzet', rp(bep.omzet))}
             ${kartu('Per hari (porsi)', num(bep.porsiHarian))}
             ${kartu('Per hari (omzet)', rp(bep.omzetHarian))}
           </div>
           <p style="margin:10px 0 0;font-size:0.9rem">${teksPosisi(posisi)}</p>`
    }
    ${bep.peringatan.map((p) => `<p class="report-note" style="margin-top:8px">${escapeHtml(p)}</p>`).join('')}

    <h3 style="margin:26px 0 8px">Simulasi harga jual</h3>
    <p class="report-note" style="margin-bottom:10px">
      Setelan tersimpan BU ini: <strong>${LABEL_METODE[ctx.bu?.pricing_method] ?? '—'}</strong>.
      Mengubah pilihan di bawah hanya untuk melihat akibatnya — <strong>tidak tersimpan</strong>.
      Yang tersimpan diubah admin lewat Admin Portal.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
      <div class="field" style="margin:0;flex:1;min-width:150px">
        <label style="font-size:0.72rem">Metode</label>
        <select id="i-metode">
          ${METODE.map((m) => `<option value="${m}"${m === state.metode ? ' selected' : ''}>${LABEL_METODE[m]}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0;flex:1;min-width:120px">
        <label style="font-size:0.72rem">Persentase</label>
        <input type="number" id="i-persen" step="0.1" min="0" value="${state.persen}" />
      </div>
      <button id="btn-simulasi" style="min-height:44px">Terapkan simulasi</button>
    </div>
    ${tabelHarga(d, state)}
  `;

  attachThousandsInput(isi.querySelector('#i-tetap'));
  attachThousandsInput(isi.querySelector('#i-target'));

  isi.querySelector('#btn-hitung').addEventListener('click', () => {
    const tetap = parseNumber(isi.querySelector('#i-tetap').value);
    state.biayaTetapManual = tetap === biayaTetap.total ? null : tetap;
    state.targetLaba = parseNumber(isi.querySelector('#i-target').value) || 0;
    state.hariKerja = Number(isi.querySelector('#i-hari').value) || 0;
    ctx.catatKonteks?.({ ...state });
    gambarIsi(root, ctx, state, d);
  });

  isi.querySelector('#btn-reset-tetap')?.addEventListener('click', () => {
    state.biayaTetapManual = null;
    gambarIsi(root, ctx, state, d);
  });

  isi.querySelector('#i-metode').addEventListener('change', (e) => {
    // Persentase ikut berpindah ke bawaan metode barunya. Kalau dibiarkan,
    // "food cost 35" berubah jadi "margin 35" — angka yang sah tapi artinya
    // jauh berbeda, dan sarannya melonjak tanpa ada yang mengubah apa pun.
    state.metode = e.target.value;
    state.persen = persenBawaan(ctx.bu, state.metode);
    gambarIsi(root, ctx, state, d);
  });

  isi.querySelector('#btn-simulasi').addEventListener('click', () => {
    state.persen = Number(isi.querySelector('#i-persen').value);
    gambarIsi(root, ctx, state, d);
  });
}

function panelTanpaPenjualan() {
  return `
    <div class="report-note" style="border-left-color:#d97706;background:#fff8ed;margin-bottom:16px">
      <strong>Belum ada penjualan tercatat pada rentang ini.</strong>
      <p style="margin:6px 0 0">
        Halaman ini menghitung dari penjualan yang benar-benar diinput. Selama penjualan belum diisi,
        angkanya kosong — dan itu ditampilkan apa adanya, bukan diganti nol.
        Kamu masih bisa mengubah biaya tetap dan target di bawah untuk melihat gambarannya,
        tapi tanpa penjualan, margin per porsinya belum bisa diketahui.
      </p>
    </div>`;
}

function teksPosisi(p) {
  if (p.persen == null) return '<span style="color:var(--color-text-muted)">Pencapaian belum bisa dihitung.</span>';
  return p.lewat
    ? `<span style="color:var(--color-primary)">✅ Sudah lewat titik impas — ${pct(p.persen)} dari target, lebih ${num(p.selisih)} porsi.</span>`
    : `<span style="color:#b45309">Belum sampai titik impas — baru ${pct(p.persen)}, kurang ${num(Math.abs(p.selisih))} porsi.</span>`;
}

function kartu(label, nilai) {
  return `<div class="report-kpi"><span class="report-kpi-label">${label}</span><strong class="report-kpi-value">${nilai}</strong></div>`;
}

/**
 * Tabel harga per menu.
 *
 * Hanya produk `finished` — bahan baku dan setengah jadi memang tidak dijual,
 * dan memasukkannya membuat daftar penuh baris yang kolom harganya selamanya
 * kosong, sehingga baris yang benar-benar bermasalah tenggelam.
 */
function tabelHarga(d, state) {
  const menu = (d.products ?? []).filter((p) => p.product_type === 'finished' && p.is_active !== false);
  if (!menu.length) return '<p class="report-note">Belum ada menu jadi di BU ini.</p>';

  const baris = menu
    .map((p) => ({
      p,
      r: ringkasHarga({
        hpp: d.biaya.get(p.id),
        kemasan: Number(p.packaging_cost ?? 0),
        metode: state.metode,
        persen: state.persen,
        hargaSekarang: p.sale_price,
        feePersen: Number(p.fee_online_percent ?? 0),
        promoPersen: Number(p.promo_percent ?? 0)
      })
    }))
    // Yang harganya paling jauh DI BAWAH saran naik ke atas — itu yang menggerus
    // margin, dan itu yang perlu dilihat lebih dulu. Baris tanpa selisih
    // (HPP belum ada) ditaruh di belakang, bukan dibuang.
    .sort((a, b) => (a.r.selisih ?? Infinity) - (b.r.selisih ?? Infinity));

  return `
    <div class="table-scroll">
      <table class="data-table kartu-sempit table-freeze-1">
        <thead>
          <tr><th>Menu</th><th>HPP+kemasan</th><th>Harga kini</th><th>Food cost</th><th>Saran</th><th>Selisih</th><th>Saran online</th></tr>
        </thead>
        <tbody>
          ${baris
            .map(({ p, r }) => {
              const warna = r.selisih == null ? '' : r.selisih < 0 ? 'style="color:#b91c1c"' : '';
              return `<tr>
                <td data-label="Menu">${escapeHtml(p.name)}${r.sebab ? ` <span style="font-size:0.7rem;color:var(--color-text-muted)">(${escapeHtml(r.sebab)})</span>` : ''}</td>
                <td data-label="HPP+kemasan">${rp(r.hppTotal)}</td>
                <td data-label="Harga kini">${rp(r.hargaSekarang)}</td>
                <td data-label="Food cost">${pct(r.foodCostSekarang)}</td>
                <td data-label="Saran">${rp(r.hargaSaran)}</td>
                <td data-label="Selisih" ${warna}>${r.selisih == null ? '—' : rp(r.selisih)}</td>
                <td data-label="Saran online">${rp(r.hargaOnlineSaran)}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>
    <p class="report-note" style="margin-top:8px">
      <strong>Selisih</strong> bertanda: merah berarti harga sekarang <em>di bawah</em> saran.
      <strong>Saran online</strong> adalah harga yang perlu dipasang di marketplace agar yang diterima sama dengan harga offline —
      fee 20% ditutup dengan menaikkan 25%, bukan 20%.
    </p>`;
}
