/**
 * Tab REKAP WASTE / SPOIL di Admin Portal.
 *
 *   "di sisi admin portal sediakan rekap spoil waste berdasarkan rentang
 *    tanggal, tampilkan tabel di UI dan sediakan export excel beserta foto yang
 *    sudah terkompress dan di embed ke kolom excel nya"
 *
 * Satu baris per BAHAN, bukan per kejadian — itu satuan yang sama dengan cara
 * stoknya berkurang, dan satu-satunya bentuk yang bisa dipivot. Kolom
 * Keterangan yang memisahkan artinya: "Bahan mentah" untuk spoil, "Waste menu
 * X × n" untuk bahan yang ikut terbuang bersama menunya.
 *
 * Fotonya disisipkan KE DALAM sel Excel lewat `core/xlsx-foto.js`. Tautan tidak
 * cukup: berkas ini dikirim lewat WhatsApp dan dibuka orang yang tidak login,
 * dan tautan bertanda tangan yang kedaluwarsa dalam sejam akan membuat seluruh
 * kolom buktinya kosong tepat saat dibaca.
 */

import { toast, infoDialog } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { monthRangeWIB } from '../../core/dates.js';
import { imageToDataUrl } from '../../core/pdf.js';
import { exportTableXLSXFoto } from '../../core/xlsx-foto.js';
import { susunRekapWaste, KOLOM_FOTO } from './laporan-waste.js';
import { rekapWaste, getBiayaRataBu, urlFotoWaste, urlFotoWasteBanyak } from './waste.service.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function renderWasteAdmin(container, { businessUnitId, outlets }) {
  const { from: awal, to: akhir } = monthRangeWIB();
  const state = { outletId: '', dateFrom: awal, dateTo: akhir };

  container.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Rekap Waste / Spoil</h2>
    </div>
    <p style="color:var(--color-text-muted);font-size:0.88rem;margin:0 0 12px;max-width:640px">
      Satu baris per <strong>bahan</strong> yang berkurang. Kolom <strong>Keterangan</strong> membedakan
      bahan mentah yang rusak dari bahan yang ikut terbuang bersama menunya — dua kejadian yang
      memotong stok yang sama tapi menuntut tindakan yang berbeda.
    </p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="margin:0;min-width:150px"><label>Outlet</label>
        <select id="ws-outlet"><option value="">Semua</option>${outlets
          .map((o) => `<option value="${o.id}">${esc(o.name)}</option>`)
          .join('')}</select>
      </div>
      <div class="field" style="margin:0;min-width:140px"><label>Dari</label><input type="date" id="ws-dari" value="${awal}" /></div>
      <div class="field" style="margin:0;min-width:140px"><label>Sampai</label><input type="date" id="ws-sampai" value="${akhir}" /></div>
      <button id="ws-tampil">Tampilkan</button>
      <button id="ws-ekspor" class="primary">⬇ Export Excel (dengan foto)</button>
    </div>
    <div id="ws-hasil"></div>
  `;

  const hasil = container.querySelector('#ws-hasil');

  // Laporan yang SEDANG TERLIHAT. Tombol ekspor memakai persis ini — bukan
  // membaca ulang kotak tanggalnya, yang bisa sudah diubah tanpa menekan
  // "Tampilkan". Berkas yang isinya berbeda dari tabel di layarnya adalah
  // kegagalan yang tidak akan pernah dicurigai.
  let lapTampil = null;

  let biaya = new Map();
  try {
    biaya = await getBiayaRataBu(businessUnitId);
  } catch {
    // Nilai rupiah cuma pembanding. Gagal mengambilnya tidak boleh menghalangi
    // rekapnya tampil — kolom Nilai akan berbunyi "-", dan itu jujur.
  }

  async function muat() {
    hasil.innerHTML = loadingHtml('Memuat rekap waste…', { baris: 4 });
    let baris = [];
    try {
      baris = await rekapWaste(businessUnitId, state);
    } catch (e) {
      const pesan = String(e?.message ?? e);
      // `waste_rekap` belum ada berarti 0135 belum dijalankan. Pesan
      // "relation does not exist" tidak memberi tahu admin apa yang harus
      // dilakukannya — bug yang sama persis pernah terjadi pada 0122.
      hasil.innerHTML = `<p class="error-text">${esc(
        /waste_rekap/.test(pesan)
          ? 'Migration 0135 & 0136 belum dijalankan di Supabase, jadi rekap waste belum tersedia.'
          : pesan
      )}</p>`;
      lapTampil = null;
      return;
    }

    const namaOutlet = state.outletId ? outlets.find((o) => o.id === state.outletId)?.name ?? '' : 'Semua outlet';
    const lap = susunRekapWaste({
      baris,
      biaya,
      periode: { dari: state.dateFrom, sampai: state.dateTo, outlet: namaOutlet }
    });
    lapTampil = lap;

    if (!lap.baris.length) {
      hasil.innerHTML = `<p style="color:var(--color-text-muted);font-size:0.88rem">Tidak ada waste/spoil pada rentang ini.</p>`;
      return;
    }

    hasil.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 6px">${esc(lap.subjudul)}</p>
      <div class="table-scroll"><table class="data-table kartu-sempit">
        <thead><tr>${lap.kolom.map((k) => `<th>${esc(k.header)}</th>`).join('')}</tr></thead>
        <tbody>
          ${lap.baris
            .map(
              (r, i) => `<tr>${r
                .map((sel, j) =>
                  j === KOLOM_FOTO
                    ? `<td data-label="Foto">${
                        lap.meta[i]?.photoPath
                          ? `<button class="ws-foto" data-path="${esc(lap.meta[i].photoPath)}">Lihat</button>`
                          : lap.meta[i]?.lama
                            ? // DIBEDAKAN DARI "belum ada", dan itu bukan kerapian.
                              // "belum ada foto" menuduh staffnya lupa memfoto;
                              // catatan ini memang dibuat sebelum fotonya
                              // diwajibkan, jadi fotonya tidak pernah ada.
                              '<span style="color:var(--color-text-muted);font-size:0.76rem">sebelum foto diwajibkan</span>'
                            : '<span style="color:var(--color-danger);font-size:0.8rem">belum ada</span>'
                      }</td>`
                    : `<td data-label="${esc(lap.kolom[j]?.header ?? '')}">${esc(sel)}</td>`
                )
                .join('')}</tr>`
            )
            .join('')}
        </tbody>
      </table></div>`;

    hasil.querySelectorAll('.ws-foto').forEach((b) =>
      b.addEventListener('click', async () => {
        const url = await urlFotoWaste(b.dataset.path);
        if (!url) return toast('Foto tidak bisa dibuka.', 'error');
        await infoDialog({
          title: 'Foto Waste / Spoil',
          bodyHtml: `<img src="${url}" alt="Foto waste" style="max-width:100%;border-radius:8px" />`
        });
      })
    );
  }

  container.querySelector('#ws-tampil').addEventListener('click', () => {
    state.outletId = container.querySelector('#ws-outlet').value;
    state.dateFrom = container.querySelector('#ws-dari').value;
    state.dateTo = container.querySelector('#ws-sampai').value;
    muat();
  });

  container.querySelector('#ws-ekspor').addEventListener(
    'click',
    sekaliJalan(
      async () => {
        if (!lapTampil?.baris.length) {
          toast('Tidak ada baris untuk diekspor. Tekan Tampilkan dulu.', 'error');
          return;
        }

        // Foto diambil sebagai data URL supaya tertanam di dalam berkasnya.
        //
        // 220px cukup untuk melihat bahwa barangnya memang rusak — dan itu satu-
        // satunya pertanyaan yang dijawab foto ini. Berkas berisi 300 foto
        // beresolusi penuh tidak bisa dikirim lewat WhatsApp, dan rekap yang
        // tidak bisa dikirim tidak menolong siapa pun.
        const urlPeta = await urlFotoWasteBanyak(lapTampil.meta.map((m) => m.photoPath));
        const rows = [];
        for (let i = 0; i < lapTampil.baris.length; i++) {
          const baris = [...lapTampil.baris[i]];
          const path = lapTampil.meta[i]?.photoPath;
          if (!path) {
            // Memang tidak berfoto — hanya mungkin untuk catatan sebelum 0135.
            baris[KOLOM_FOTO] = null;
          } else {
            const url = urlPeta.get(path);
            const dataUrl = url ? await imageToDataUrl(url, 220, 0.7) : null;
            // 'GAGAL' DIBEDAKAN dari kosong, dan itu bukan kerapian: sel kosong
            // terbaca sebagai "waste ini tidak difoto", lalu staffnya ditegur
            // untuk sesuatu yang sudah ia lakukan.
            baris[KOLOM_FOTO] = dataUrl ?? 'GAGAL';
          }
          rows.push(baris);
        }

        await exportTableXLSXFoto({
          filename: lapTampil.namaBerkas,
          sheetName: 'Waste Spoil',
          title: lapTampil.judul,
          subtitle: lapTampil.subjudul,
          columns: lapTampil.kolom,
          rows
        });

        const catatan = lapTampil.ringkas.tanpaNilai
          ? ` (${lapTampil.ringkas.tanpaNilai} baris belum punya biaya rata-rata, nilainya "-")`
          : '';
        toast(
          `${lapTampil.ringkas.jumlahBaris} baris dari ${lapTampil.ringkas.jumlahKejadian} kejadian diekspor.${catatan}`,
          catatan ? 'warning' : 'success'
        );
      },
      { teks: 'Menyiapkan…' }
    )
  );

  await muat();
}
