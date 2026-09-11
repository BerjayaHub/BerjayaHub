/**
 * Tab NOTA TERIMA di Admin Portal — riwayat per nomor + unduh xlsx.
 *
 * Yang dijawab layar ini cuma satu pertanyaan, tapi yang paling sering muncul:
 * "nota nomor sekian isinya apa saja, dan totalnya berapa?" — pertanyaan yang
 * datang tiap kali tagihan supplier tidak cocok dengan catatan.
 *
 * NILAI RUPIAH ADA DI SINI dan tidak di Staff App. Perlu dicatat jujur bahwa
 * itu BUKAN pengaman — `products_select` membuka harga beli untuk semua anggota
 * BU. Yang diatur adalah apa yang ikut beredar di layar yang dibuka di gudang.
 */

import { toast, infoDialog } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { monthRangeWIB } from '../../core/dates.js';
import { exportTableXLSX, exportSheetsXLSX } from '../../core/xlsx.js';
import { listProducts, listRecipesFull, computeCosts } from '../product/product.service.js';
import { susunLaporanNota } from './laporan-nota.js';
import { susunBahanMasuk } from './laporan-bahan-masuk.js';
import { riwayatNota, itemNota, itemNotaBanyak, urlFotoNota } from './nota.service.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function renderNotaAdmin(container, { businessUnitId, outlets }) {
  // monthRangeWIB() memberi { from, to } — bukan { start, end }.
  const { from: awal, to: akhir } = monthRangeWIB();
  const state = { outletId: '', dateFrom: awal, dateTo: akhir };

  container.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Nota Terima</h2>
    </div>
    <p style="color:var(--color-text-muted);font-size:0.88rem;margin:0 0 12px;max-width:620px">
      Penerimaan barang dari supplier, dikelompokkan per nomor nota. Rentang tanggalnya memakai
      <strong>tanggal nota</strong> — bukan waktu input, karena itu yang dipakai mencocokkan tagihan.
    </p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="margin:0;min-width:150px"><label>Outlet</label>
        <select id="nt-outlet"><option value="">Semua</option>${outlets.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin:0;min-width:140px"><label>Dari</label><input type="date" id="nt-dari" value="${awal}" /></div>
      <div class="field" style="margin:0;min-width:140px"><label>Sampai</label><input type="date" id="nt-sampai" value="${akhir}" /></div>
      <button id="nt-tampil">Tampilkan</button>
      <!-- EKSPOR SATU RENTANG, bukan satu nota.
           Ditaruh bersebelahan dengan Tampilkan karena ia memakai filter yang
           SAMA PERSIS - yang diekspor adalah yang sedang terlihat, bukan
           rentang lain yang harus diisi ulang di dialog tersendiri. -->
      <button id="nt-ekspor" class="primary">⬇ Export Excel (rentang ini)</button>
    </div>
    <div id="nt-hasil"></div>
  `;

  const hasil = container.querySelector('#nt-hasil');
  let hpp = new Map();
  try {
    const [products, recipes] = await Promise.all([listProducts(businessUnitId), listRecipesFull(businessUnitId)]);
    hpp = computeCosts(products, recipes);
  } catch {
    // HPP cuma dipakai kalau notanya tidak menyimpan harga satuan — gagal di
    // sini tidak boleh menghalangi daftar notanya tampil.
  }

  // Daftar yang SEDANG TERLIHAT, disimpan supaya tombol ekspor memakai persis
  // itu — bukan mengambil ulang dengan filter yang dibaca lagi dari kotaknya.
  // Kotak tanggal bisa sudah diubah orang tanpa menekan "Tampilkan", dan
  // berkas yang isinya berbeda dari tabel di layarnya adalah bentuk kegagalan
  // yang tidak akan pernah dicurigai.
  let notaTampil = [];

  async function muat() {
    hasil.innerHTML = loadingHtml('Memuat nota…', { baris: 4 });
    let daftar = [];
    try {
      // denganPembuat: hanya di sini, karena hanya di sini kolomnya digambar.
      daftar = await riwayatNota(businessUnitId, { ...state, denganPembuat: true });
    } catch (e) {
      hasil.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
      notaTampil = [];
      return;
    }
    notaTampil = daftar;
    hasil.innerHTML = `
      <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 6px">${daftar.length} nota</p>
      <div class="table-scroll"><table class="data-table table-freeze-1 kartu-sempit">
        <thead><tr><th>Nomor</th><th>Tanggal</th><th>Outlet</th><th>Supplier</th><th>No. Supplier</th><th>Diinput</th><th>Foto</th><th>Aksi</th></tr></thead>
        <tbody>
          ${
            daftar
              .map(
                (n) => `<tr>
                  <td data-label="Nomor" style="font-family:ui-monospace,Menlo,monospace;font-size:0.8rem">${esc(n.code)}</td>
                  <td data-label="Tanggal">${esc(n.receipt_date)}</td>
                  <td data-label="Outlet">${esc(n.outlets?.name ?? '-')}</td>
                  <td data-label="Supplier">${esc(n.supplier ?? '-')}</td>
                  <td data-label="No. Supplier">${esc(n.invoice_no ?? '-')}</td>
                  <td data-label="Diinput" style="font-size:0.82rem">${esc(n.pembuat?.full_name ?? '-')}</td>
                  <td data-label="Foto">${
                    n.photo_path
                      ? `<button class="nt-foto" data-path="${esc(n.photo_path)}">Lihat</button>`
                      : '<span style="color:var(--color-danger);font-size:0.8rem">belum ada</span>'
                  }</td>
                  <td data-label="Aksi"><button class="nt-detail" data-id="${n.id}">Rincian &amp; unduh</button></td>
                </tr>`
              )
              .join('') || '<tr><td colspan="8">Tidak ada nota pada rentang ini.</td></tr>'
          }
        </tbody>
      </table></div>`;

    hasil.querySelectorAll('.nt-foto').forEach((b) =>
      b.addEventListener('click', async () => {
        const url = await urlFotoNota(b.dataset.path);
        if (!url) return toast('Foto tidak bisa dibuka.', 'error');
        await infoDialog({ title: 'Foto Nota', bodyHtml: `<img src="${url}" alt="Foto nota" style="max-width:100%;border-radius:8px" />` });
      })
    );

    hasil.querySelectorAll('.nt-detail').forEach((b) =>
      b.addEventListener(
        'click',
        sekaliJalan(async () => {
          const nota = daftar.find((n) => n.id === b.dataset.id);
          const items = await itemNota(b.dataset.id).catch(() => []);
          const lap = susunLaporanNota({ nota, items, hpp });
          await infoDialog({
            title: lap.judul,
            bodyHtml:
              `<p style="font-size:0.85rem;color:var(--color-text-muted)">${esc(lap.subjudul)}</p>` +
              `<div class="table-scroll" style="max-height:320px"><table class="data-table kartu-sempit"><thead><tr>${lap.kolom
                .map((k) => `<th>${esc(k.header)}</th>`)
                .join('')}</tr></thead><tbody>${lap.baris
                .map((r) => `<tr>${r.map((sel, i) => `<td data-label="${esc(lap.kolom[i]?.header ?? '')}">${esc(sel)}</td>`).join('')}</tr>`)
                .join('')}</tbody></table></div>` +
              `<p style="margin-top:8px">Total nota: <strong>${lap.totalTeks}</strong>${
                lap.adaTanpaHarga ? ' <span style="color:var(--color-text-muted);font-size:0.85rem">(sebagian barang belum berharga)</span>' : ''
              }</p>` +
              (nota?.notes ? `<p style="font-size:0.85rem">Catatan: ${esc(nota.notes)}</p>` : '') +
              `<div style="margin-top:10px"><button id="nt-xlsx">⬇ Unduh Excel</button></div>`,
            // Lewat onReady — sesudah `await infoDialog` dialognya sudah ditutup.
            onReady: (body) =>
              body.querySelector('#nt-xlsx')?.addEventListener('click', async () => {
                await exportTableXLSX({
                  filename: lap.namaBerkas,
                  sheetName: 'Nota',
                  title: lap.judul,
                  subtitle: `${lap.subjudul} · Total ${lap.totalTeks}`,
                  columns: lap.kolom,
                  rows: lap.baris
                });
              })
          });
        })
      )
    );
  }

  container.querySelector('#nt-tampil').addEventListener('click', () => {
    state.outletId = container.querySelector('#nt-outlet').value;
    state.dateFrom = container.querySelector('#nt-dari').value;
    state.dateTo = container.querySelector('#nt-sampai').value;
    muat();
  });

  // =====================================================================
  // EKSPOR SELURUH BAHAN MASUK PADA RENTANG INI
  //
  //   "admin bisa export bahan apa saja yang masuk sesuai range tanggal yang
  //    dipilih tanpa export satu satu per nota"
  //
  // Sebelum ini satu-satunya jalan adalah membuka rincian tiap nota lalu
  // menekan "Unduh Excel" — 43 berkas untuk sepuluh hari, lalu menyalin-tempel
  // semuanya jadi satu. Selain lama, ia punya cara gagal sendiri: satu nota
  // yang terlewat tidak meninggalkan jejak apa pun di hasil gabungannya.
  // =====================================================================
  container.querySelector('#nt-ekspor').addEventListener(
    'click',
    sekaliJalan(
      async () => {
        if (!notaTampil.length) {
          toast('Tidak ada nota pada rentang ini untuk diekspor.', 'error');
          return;
        }

        // KEGAGALANNYA TIDAK DITELAN.
        //
        // Layar rincian per nota memakai `.catch(() => [])` — untuk satu nota
        // itu berarti dialog kosong yang langsung kelihatan salah. Di sini
        // artinya berkas yang kekurangan beberapa nota tanpa satu pun tanda,
        // dan orang yang memakainya sedang mencocokkan tagihan.
        let items;
        try {
          items = await itemNotaBanyak(notaTampil.map((n) => n.id));
        } catch (e) {
          toast(`Gagal mengambil isi notanya: ${e.message ?? e}`, 'error');
          return;
        }

        const namaOutlet = state.outletId
          ? outlets.find((o) => o.id === state.outletId)?.name ?? ''
          : 'Semua outlet';
        const lap = susunBahanMasuk({
          notas: notaTampil,
          items,
          hpp,
          periode: { dari: state.dateFrom, sampai: state.dateTo, outlet: namaOutlet }
        });

        if (!lap.rincian.length) {
          toast('Notanya ada, tapi tidak ada satu pun baris bahan di dalamnya.', 'error');
          return;
        }

        await exportSheetsXLSX({
          filename: lap.namaBerkas,
          sheets: [
            { name: 'Rincian', title: lap.judul, subtitle: lap.subjudul, columns: lap.kolomRincian, rows: lap.rincian },
            {
              name: 'Rekap per Bahan',
              title: `${lap.judul} — rekap per bahan`,
              subtitle: lap.subjudul,
              columns: lap.kolomRekap,
              rows: lap.rekap
            }
          ]
        });

        // Yang DIBUANG dan yang BELUM BERHARGA dikatakan, bukan didiamkan.
        // Total yang rapi tapi lebih kecil dari seharusnya adalah kegagalan
        // yang paling mungkin lolos di laporan pembelian.
        const catatan = [
          lap.ringkas.notaBatal ? `${lap.ringkas.notaBatal} nota batal tidak diikutkan` : '',
          lap.ringkas.barisTanpaHarga ? `${lap.ringkas.barisTanpaHarga} baris belum berharga` : ''
        ].filter(Boolean);
        toast(
          `${lap.ringkas.jumlahBaris} baris dari ${lap.ringkas.jumlahNota} nota diekspor.` +
            (catatan.length ? ` (${catatan.join(', ')})` : ''),
          // `warning` dan bukan `info`: tipe ini yang bertahan 7 detik di layar.
          // Catatan yang hilang dalam 3 detik sama saja dengan tidak ada.
          catatan.length ? 'warning' : 'success'
        );
      },
      { teks: 'Menyiapkan…' }
    )
  );

  await muat();
}
