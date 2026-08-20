import { escapeHtml, toast, formDialog, confirmDialog } from '../../core/ui.js';
import { formatRupiah, formatNum, attachThousandsInput, parseNumber } from '../../core/format.js';
import { monthRangeWIB } from '../../core/dates.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { muatDataOwner, lupakanData } from './muat-data.js';
import { gambarSaringan } from './ringkasan.owner.js';
import { hitungBep, posisiTerhadapBep, hitungTarget, ringkasBiayaOutlet } from './bep.js';
import {
  tambahBiaya,
  ubahBiaya,
  nonaktifkanBiaya,
  LABEL_JENIS,
  LABEL_SATUAN,
  satuanUntuk
} from './biaya.service.js';
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
    targetJenis: awal.targetJenis ?? 'laba',
    targetNilai: awal.targetNilai ?? 0,
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
  const tetapDipakai = state.biayaTetapManual ?? d.tetapDipakai;

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
          hariKerja: state.hariKerja,
          variabelPerPorsi: d.daftarBiaya.variabelPerPorsi,
          variabelPersen: d.daftarBiaya.variabelPersen
        });

  const posisi = state.biayaTetapManual == null ? d.posisi : posisiTerhadapBep({ totalQty: bauran.totalQty, bepPorsi: bep.porsi });

  isi.innerHTML = `
    ${adaPenjualan ? '' : panelTanpaPenjualan()}

    <div class="report-note" style="margin-bottom:14px">
      Rata-rata di bawah <strong>ditimbang menurut jumlah yang benar-benar terjual</strong>, bukan dirata-ratakan datar antar menu.
      Menu mahal yang jarang laku tidak lagi menarik marginnya ke atas.
    </div>

    <div class="report-kpis">
      ${kartu('Harga jual rata-rata', rp(bauran.hargaTertimbang), sebabKosong(bauran))}
      ${kartu('HPP rata-rata', rp(bauran.hppTertimbang), sebabKosong(bauran))}
      ${kartu('Margin per porsi (kotor)', rp(bauran.marginTertimbang), sebabKosong(bauran))}
      ${kartu('Margin setelah biaya variabel', rp(bep.marginEfektif ?? bauran.marginTertimbang), rincianVariabel(d.daftarBiaya))}
      ${kartu('Porsi terjual', num(bauran.totalQty))}
    </div>
    ${bauran.terlewat.length ? tabelTerlewatBep(bauran.terlewat) : ''}

    <h3 style="margin:22px 0 8px">Angka yang bisa diubah</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:6px">
      <div class="field" style="margin:0;flex:1;min-width:160px">
        <label style="font-size:0.72rem">Biaya tetap per periode</label>
        <input type="text" inputmode="numeric" id="i-tetap" value="${formatNum(tetapDipakai, 0)}" />
        <span class="field-help">${
          d.sumberBiayaTetap === 'daftar'
            ? `Dari daftar biaya di bawah: ${rp(d.daftarBiaya.tetapPerBulan)}`
            : `Dari buku kas: ${rp(biayaTetap.total)}${
                biayaTetap.tanpaKategori > 0 ? ` · ${rp(biayaTetap.tanpaKategori)} belum berkategori` : ''
              }`
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
        ? '<p class="report-note" style="margin-bottom:14px">Biaya tetap sedang <strong>ditimpa manual</strong> — bukan angka dari daftar biaya maupun buku kas.</p>'
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

    ${panelTarget(state, bep, bauran, tetapDipakai)}

    ${panelBiaya(d, state)}

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
    state.biayaTetapManual = tetap === d.tetapDipakai ? null : tetap;
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

  // ---- Target ----
  attachThousandsInput(isi.querySelector('#t-nilai'));
  isi.querySelector('#t-jenis')?.addEventListener('change', (e) => {
    // Nilainya DIKOSONGKAN saat jenisnya berganti. Angka 20.000.000 yang tadi
    // berarti "laba" akan terbaca sebagai "porsi" begitu jenisnya berubah —
    // hasilnya tetap berupa angka yang wajar, dan tidak ada yang menyadari
    // bahwa pertanyaannya sudah berubah.
    state.targetJenis = e.target.value;
    state.targetNilai = 0;
    gambarIsi(root, ctx, state, d);
  });
  isi.querySelector('#btn-target')?.addEventListener('click', () => {
    state.targetNilai = parseNumber(isi.querySelector('#t-nilai').value) || 0;
    ctx.catatKonteks?.({ ...state });
    gambarIsi(root, ctx, state, d);
  });

  // ---- Biaya ----
  isi.querySelector('#btn-tambah-biaya')?.addEventListener('click', () => bukaFormBiaya(root, ctx, state, d, null));
  isi.querySelectorAll('[data-ubah-biaya]').forEach((b) =>
    b.addEventListener('click', () => {
      const baris = d.biayaOutlet.find((x) => x.id === b.dataset.ubahBiaya);
      if (baris) bukaFormBiaya(root, ctx, state, d, baris);
    })
  );
  isi.querySelectorAll('[data-hapus-biaya]').forEach((b) =>
    b.addEventListener(
      'click',
      sekaliJalan(async () => {
        const yakin = await confirmDialog({
          title: 'Nonaktifkan biaya ini?',
          message:
            'Biayanya tidak dihapus, hanya berhenti dihitung. Yang sudah dihapus membuat BEP bulan-bulan lalu tidak bisa dijelaskan lagi.',
          confirmText: 'Nonaktifkan',
          danger: true
        });
        if (!yakin) return;
        try {
          await nonaktifkanBiaya(b.dataset.hapusBiaya);
          toast('Biaya dinonaktifkan.', 'success');
          lupakanData();
          await muatDanGambar(root, ctx, state);
        } catch (error) {
          toast(error.message ?? 'Gagal menonaktifkan.', 'error');
        }
      })
    )
  );
}

// =====================================================================
// TARGET — tiga arah
// =====================================================================

const JENIS_TARGET = {
  laba: { label: 'Target laba (Rp)', tanya: 'Kalau mau untung sekian, harus jual berapa?' },
  omzet: { label: 'Target omzet (Rp)', tanya: 'Kalau omzetnya sekian, untungnya berapa?' },
  porsi: { label: 'Target porsi', tanya: 'Kalau terjual sekian porsi, cukup tidak?' }
};

function panelTarget(state, bep, bauran, tetapDipakai) {
  const t = hitungTarget({
    target: { jenis: state.targetJenis, nilai: state.targetNilai },
    marginEfektif: bep.marginEfektif ?? bauran.marginTertimbang,
    hargaRata: bauran.hargaTertimbang,
    biayaTetap: tetapDipakai,
    hariKerja: state.hariKerja
  });

  const pilihan = Object.entries(JENIS_TARGET)
    .map(([k, v]) => `<option value="${escapeHtml(k)}"${k === state.targetJenis ? ' selected' : ''}>${escapeHtml(v.label)}</option>`)
    .join('');

  return `
    <h3 style="margin:26px 0 8px">Target</h3>
    <p class="report-note" style="margin-bottom:10px">${escapeHtml(JENIS_TARGET[state.targetJenis]?.tanya ?? '')}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
      <div class="field" style="margin:0;flex:1;min-width:170px">
        <label style="font-size:0.72rem">Jenis target</label>
        <select id="t-jenis">${pilihan}</select>
      </div>
      <div class="field" style="margin:0;flex:1;min-width:150px">
        <label style="font-size:0.72rem">${escapeHtml(JENIS_TARGET[state.targetJenis]?.label ?? 'Nilai')}</label>
        <input type="text" inputmode="numeric" id="t-nilai" value="${formatNum(state.targetNilai, 0)}" />
      </div>
      <button class="primary" id="btn-target" style="min-height:44px">Hitung target</button>
    </div>
    ${
      t.sebab
        ? `<p class="report-note">${escapeHtml(t.sebab)}</p>`
        : `<div class="report-kpis">
             ${kartu('Harus terjual', num(t.porsi) + ' porsi')}
             ${kartu('Omzet yang dicapai', rp(t.omzet))}
             ${kartu('Laba sebelum pajak', rp(t.laba))}
             ${kartu('Per hari (porsi)', num(t.porsiHarian))}
             ${kartu('Per hari (omzet)', rp(t.omzetHarian))}
           </div>
           <p class="report-note" style="margin-top:8px">
             <strong>Laba</strong> di sini laba sebelum pajak, penyusutan, dan biaya yang tidak pernah lewat sini.
             Bukan laba bersih.
           </p>`
    }`;
}

// =====================================================================
// BIAYA TETAP & VARIABEL PER OUTLET
// =====================================================================

function panelBiaya(d, state) {
  const daftar = d.biayaOutlet ?? [];
  const namaOutlet = new Map((d.outlets ?? []).map((o) => [o.id, o.name]));

  const baris = daftar
    .map(
      (b) => `<tr>
        <td>${escapeHtml(b.name)}</td>
        <td>${escapeHtml(namaOutlet.get(b.outlet_id) ?? b.outlets?.name ?? '-')}</td>
        <td>${LABEL_JENIS[b.jenis] ?? b.jenis}</td>
        <td>${b.satuan === 'persen_omzet' ? `${formatNum(b.amount, 1)}%` : rp(b.amount)}<br />
            <span style="font-size:0.72rem;color:var(--color-text-muted)">${LABEL_SATUAN[b.satuan] ?? b.satuan}</span></td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button data-ubah-biaya="${b.id}" style="min-height:38px">Ubah</button>
            <button class="btn-danger" data-hapus-biaya="${b.id}" style="min-height:38px">Nonaktifkan</button>
          </div>
        </td>
      </tr>`
    )
    .join('');

  const rb = ringkasBiayaOutlet(daftar);

  return `
    <h3 style="margin:26px 0 8px">Biaya tetap &amp; variabel</h3>
    <p class="report-note" style="margin-bottom:10px">
      Daftar biaya yang <strong>direncanakan</strong>, menempel di outlet. Ini yang dipakai sebagai penyebut BEP —
      berbeda dari buku kas, yang hanya berisi yang <em>sudah dibayar</em>.
      Sewa yang jatuh tempo tanggal 28 belum ada di kas pada tanggal 5, jadi BEP dari kas akan terlihat rendah di awal
      bulan lalu melonjak di akhir tanpa ada yang berubah di dunia nyata.
      <br /><br />
      <strong>Biaya variabel tidak bisa bersatuan bulanan.</strong> Dalam rumus BEP ia mengurangi margin per porsi,
      bukan menambah biaya tetap. Kalau sebuah biaya memang bulanan, ia biaya tetap.
    </p>
    <button class="primary" id="btn-tambah-biaya" style="min-height:44px;margin-bottom:12px">＋ Tambah biaya</button>
    ${
      daftar.length
        ? `<div class="table-scroll">
             <table class="data-table">
               <thead><tr><th>Nama</th><th>Outlet</th><th>Jenis</th><th>Jumlah</th><th>Aksi</th></tr></thead>
               <tbody>${baris}</tbody>
               <tfoot>
                 <tr><th colspan="3">Total biaya tetap per bulan</th><th>${rp(rb.tetapPerBulan)}</th></tr>
                 ${rb.variabelPerPorsi ? `<tr><th colspan="3">Variabel per porsi</th><th>${rp(rb.variabelPerPorsi)}</th></tr>` : ''}
                 ${rb.variabelPersen ? `<tr><th colspan="3">Variabel dari harga jual</th><th>${formatNum(rb.variabelPersen, 1)}%</th></tr>` : ''}
               </tfoot>
             </table>
           </div>`
        : '<p class="report-note">Belum ada biaya terdaftar. Selama kosong, BEP memakai angka dari buku kas.</p>'
    }`;
}

async function bukaFormBiaya(root, ctx, state, d, baris) {
  const outlets = d.outlets ?? [];
  if (!outlets.length) {
    toast('BU ini belum punya outlet, jadi biayanya belum bisa ditempelkan ke mana pun.', 'warning');
    return;
  }

  const jenisAwal = baris?.jenis ?? 'tetap';
  const opsiSatuan = (jenis) => satuanUntuk(jenis).map((x) => ({ value: x, label: LABEL_SATUAN[x] }));
  const satuanOpsi = opsiSatuan(jenisAwal);

  const nilai = await formDialog({
    title: baris ? 'Ubah biaya' : 'Tambah biaya',
    description:
      'Biaya tetap selalu per bulan. Biaya variabel per porsi atau persen dari harga jual — sebab dalam rumus BEP ia mengurangi margin, bukan menambah beban tetap.',
    submitText: 'Simpan',
    fields: [
      { name: 'name', label: 'Nama biaya', type: 'text', required: true, value: baris?.name ?? '', placeholder: 'mis. Sewa, Gaji, Listrik' },
      {
        name: 'outlet_id',
        label: 'Outlet',
        type: 'select',
        required: true,
        value: baris?.outlet_id ?? outlets[0].id,
        options: outlets.map((o) => ({ value: o.id, label: o.name }))
      },
      {
        name: 'jenis',
        label: 'Jenis',
        type: 'select',
        value: jenisAwal,
        options: Object.entries(LABEL_JENIS).map(([v, l]) => ({ value: v, label: l })),
        onChange: null
      },
      { name: 'satuan', label: 'Satuan', type: 'select', value: baris?.satuan ?? satuanOpsi[0].value, options: satuanOpsi },
      { name: 'amount', label: 'Jumlah', type: 'money', required: true, value: baris?.amount ?? '' },
      { name: 'notes', label: 'Catatan', type: 'text', value: baris?.notes ?? '' }
    ],
    onReady: (form) => {
      // Pilihan satuan mengikuti jenisnya. Tanpa ini, "variabel + per bulan"
      // bisa dipilih di layar lalu ditolak database dengan pesan constraint —
      // penolakan yang benar, tapi datang terlambat dan sulit dimengerti.
      const selJenis = form.elements.jenis;
      const selSatuan = form.elements.satuan;
      const sesuaikan = () => {
        const opsi = opsiSatuan(selJenis.value);
        selSatuan.innerHTML = opsi.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
      };
      selJenis.addEventListener('change', sesuaikan);
      if (!baris) sesuaikan();
    }
  });
  if (!nilai) return;

  try {
    if (baris) {
      await ubahBiaya(baris.id, {
        name: nilai.name,
        jenis: nilai.jenis,
        satuan: nilai.satuan,
        amount: nilai.amount,
        notes: nilai.notes
      });
    } else {
      await tambahBiaya({
        businessUnitId: ctx.businessUnitId,
        outletId: nilai.outlet_id,
        name: nilai.name,
        jenis: nilai.jenis,
        satuan: nilai.satuan,
        amount: nilai.amount,
        notes: nilai.notes
      });
    }
    toast('Biaya tersimpan.', 'success');
    // Cache dikosongkan supaya BEP-nya ikut berubah SEKARANG. Tanpa ini
    // angkanya baru menyesuaikan setelah halaman dimuat ulang, dan orang akan
    // mengira penyimpanannya gagal.
    lupakanData();
    await muatDanGambar(root, ctx, state);
  } catch (error) {
    toast(error.message ?? 'Gagal menyimpan biaya.', 'error');
  }
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

function kartu(label, nilai, keterangan = '') {
  // Keterangan hanya ditampilkan kalau nilainya kosong ATAU keterangannya
  // memang menjelaskan angkanya. Kartu yang selalu berkomentar akan berhenti
  // dibaca, dan komentarnya justru dibutuhkan pada kartu yang kosong.
  const perlu = keterangan && (nilai === '—' || !keterangan.startsWith('Belum'));
  return `<div class="report-kpi">
    <span class="report-kpi-label">${label}</span>
    <strong class="report-kpi-value">${nilai}</strong>
    ${perlu ? `<span style="font-size:0.7rem;color:var(--color-text-muted)">${keterangan}</span>` : ''}
  </div>`;
}

/**
 * KENAPA RATA-RATANYA KOSONG.
 *
 * Ini pertanyaan yang benar-benar datang dari lapangan: "HPP rata-rata masih
 * kosong, padahal beberapa menu sudah saya isi HPP-nya."
 *
 * Jawabannya: rata-rata di sini DITIMBANG MENURUT YANG TERJUAL. Penyebutnya
 * penjualan, bukan jumlah menu. Mengisi HPP seratus menu tidak menghasilkan
 * satu pun angka di sini selama belum ada satu porsi pun yang tercatat terjual.
 *
 * Itu keputusan yang disengaja — rata-rata datar antar menu adalah cara Project
 * Hub, dan ia menyesatkan (lihat header `bep.js`). Tapi keputusan yang
 * disengaja pun harus dikatakan di tempat akibatnya terlihat, bukan hanya di
 * komentar kode.
 */
function sebabKosong(bauran) {
  if (bauran.totalQty > 0) return '';
  if (bauran.terlewat.length) {
    return `Belum ada — ${bauran.terlewat.length} menu terjual tapi tidak bisa dihitung, lihat tabel di bawah`;
  }
  return 'Belum ada — dihitung dari penjualan yang tercatat, bukan dari jumlah menu ber-HPP';
}

function rincianVariabel(daftar) {
  const p = daftar?.variabelPerPorsi ?? 0;
  const s = daftar?.variabelPersen ?? 0;
  if (!p && !s) return 'Belum ada biaya variabel terdaftar';
  const bagian = [];
  if (p) bagian.push(`${formatRupiah(p)}/porsi`);
  if (s) bagian.push(`${formatNum(s, 1)}% dari harga`);
  return `Dikurangi ${bagian.join(' + ')}`;
}

function tabelTerlewatBep(baris) {
  return `
    <div class="report-note" style="margin-top:10px">
      <strong>${baris.length} menu terjual tapi tidak ikut dihitung.</strong>
      Sengaja dikeluarkan, bukan dianggap nol — HPP kosong yang dihitung nol membuat margin terlihat 100%.
      <div class="table-scroll" style="margin-top:8px">
        <table class="data-table">
          <thead><tr><th>Menu</th><th>Porsi</th><th>Sebab</th></tr></thead>
          <tbody>
            ${baris
              .map((t) => `<tr><td>${escapeHtml(t.nama)}</td><td>${num(t.qty)}</td><td>${escapeHtml(t.sebab)}</td></tr>`)
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
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

  // HARGA OUTLET, BUKAN HARGA ACUAN BU.
  //
  // Saat satu outlet dipilih, dipakai harga outlet itu. Saat "Semua Outlet",
  // harga per menu bisa BERBEDA antar outlet — dan menampilkan satu angka
  // rata-rata di situ adalah persis yang dilarang: ia terlihat seperti harga
  // yang berlaku, padahal tidak berlaku di outlet mana pun.
  //
  // Maka yang berbeda ditandai "beragam", dan barisnya tidak menghitung
  // selisih terhadap saran. Untuk melihat angkanya, pilih satu outlet.
  const outletDipilih = state.outletIds?.length === 1 ? state.outletIds[0] : null;
  const hargaPer = new Map();
  for (const h of d.hargaOutlet ?? []) {
    if (outletDipilih && h.outlet_id !== outletDipilih) continue;
    const kini = hargaPer.get(h.product_id);
    if (kini === undefined) hargaPer.set(h.product_id, Number(h.selling_price));
    else if (kini !== null && kini !== Number(h.selling_price)) hargaPer.set(h.product_id, null); // beragam
  }

  const baris = menu
    .map((p) => {
      const hargaBerlaku = hargaPer.has(p.id) ? hargaPer.get(p.id) : null;
      return {
      p,
      beragam: hargaPer.get(p.id) === null,
      belumAda: !hargaPer.has(p.id),
      r: ringkasHarga({
        hpp: d.biaya.get(p.id),
        kemasan: Number(p.packaging_cost ?? 0),
        metode: state.metode,
        persen: state.persen,
        hargaSekarang: hargaBerlaku,
        feePersen: Number(p.fee_online_percent ?? 0),
        promoPersen: Number(p.promo_percent ?? 0)
      })
      };
    })
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
            .map(({ p, r, beragam, belumAda }) => {
              const warna = r.selisih == null ? '' : r.selisih < 0 ? 'style="color:#b91c1c"' : '';
              const kolomHarga = belumAda
                ? '<span class="error-text" style="font-size:0.78rem">belum ada harga outlet</span>'
                : beragam
                  ? '<span style="color:var(--color-text-muted)">beragam per outlet</span>'
                  : rp(r.hargaSekarang);
              return `<tr>
                <td data-label="Menu">${escapeHtml(p.name)}${r.sebab ? ` <span style="font-size:0.7rem;color:var(--color-text-muted)">(${escapeHtml(r.sebab)})</span>` : ''}</td>
                <td data-label="HPP+kemasan">${rp(r.hppTotal)}</td>
                <td data-label="Harga kini">${kolomHarga}</td>
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
