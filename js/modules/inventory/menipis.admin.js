/**
 * Tab BAHAN MENIPIS di Admin Portal.
 *
 * Dua hal yang tidak ada di Staff App:
 *   1. mengatur **porsi minimum** outlet,
 *   2. memberi/menghapus **batas manual** per bahan,
 * ditambah unduh xlsx daftar belanja.
 *
 * Tombolnya disembunyikan untuk yang bukan Admin BU, TAPI ITU BUKAN PENGAMAN.
 * Penjaganya ada di `set_min_porsi()` (0091) dan policy `pms_modify` (0087); yang
 * di sini hanya supaya orang tidak menekan sesuatu yang pasti ditolak.
 */

import { toast, formDialog, infoDialog } from '../../core/ui.js';
import { formatNum } from '../../core/format.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { todayWIB } from '../../core/dates.js';
import { exportTableXLSX } from '../../core/xlsx.js';
import { sayaAdminBu } from '../../core/base-scope.js';
import { listProducts, listRecipesFull } from '../product/product.service.js';
import { listStockBalances } from './inventory.service.js';
import { susunBahanMenipis, teksBelanja } from './bahan-menipis.js';
import { batasManual, porsiMinimumOutlet, setPorsiMinimum, simpanBatasManual } from './batas-bahan.service.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LENCANA = {
  habis: '<span class="badge" style="background:#fdecea;color:#b3261e">HABIS</span>',
  menipis: '<span class="badge badge-pending">Menipis</span>',
  aman: '<span class="badge badge-approved">Aman</span>'
};

const KOLOM_XLSX = [
  { header: 'Bahan', width: 2.2 },
  { header: 'Kategori', width: 1.2 },
  { header: 'Status', width: 0.9 },
  { header: 'Stok', width: 0.8, align: 'right' },
  { header: 'Satuan', width: 0.7 },
  { header: 'Takaran/porsi', width: 1.1, align: 'right' },
  { header: 'Cukup (porsi)', width: 1, align: 'right' },
  { header: 'Batas', width: 0.9, align: 'right' },
  { header: 'Saran beli', width: 1, align: 'right' }
];

const barisXlsx = (r) => [
  r.nama,
  r.kategori ?? '',
  r.status,
  formatNum(r.stok),
  r.satuan,
  r.takaran == null ? '-' : formatNum(r.takaran),
  r.porsi == null ? '-' : formatNum(r.porsi),
  formatNum(r.batas) + (r.batasManual ? ' (manual)' : ''),
  r.saranBeli > 0 ? formatNum(r.saranBeli) : '-'
];

export async function renderMenipisAdmin(container, { businessUnitId, outlets }) {
  const state = { outletId: outlets[0]?.id ?? '' };

  container.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Bahan Menipis</h2>
    </div>
    <p style="color:var(--color-text-muted);font-size:0.88rem;margin:0 0 12px;max-width:660px">
      Stok dibagi <strong>takaran resep</strong> = cukup berapa porsi lagi. Bahan yang dipakai beberapa menu memakai
      <strong>takaran rata-rata</strong> menu-menu itu.
      Menu yang <strong>Dilayani CK</strong> tidak dibentang jadi bahan di outlet gerai — yang terpakai di sana adalah menunya sendiri.
    </p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div class="field" style="margin:0;min-width:190px"><label>Outlet</label>
        <select id="mn-outlet">${outlets.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
      </div>
      <div id="mn-atur"></div>
    </div>
    <div id="mn-hasil"></div>
  `;

  const hasil = container.querySelector('#mn-hasil');
  const bolehKelola = await sayaAdminBu(businessUnitId).catch(() => false);

  // Master produk & resep dimuat SEKALI, bukan tiap ganti outlet: keduanya
  // milik BU, bukan outlet. Memuat ulang tiap pergantian membuat layar ini
  // terasa berat justru saat dipakai membandingkan antar outlet.
  let products = [];
  let recipes = [];
  try {
    [products, recipes] = await Promise.all([listProducts(businessUnitId), listRecipesFull(businessUnitId)]);
  } catch (e) {
    hasil.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
    return;
  }

  container.querySelector('#mn-outlet').addEventListener('change', (e) => {
    state.outletId = e.target.value;
    muat();
  });

  await muat();

  async function muat() {
    hasil.innerHTML = loadingHtml('Menghitung…', { baris: 5 });
    const hariIni = todayWIB();

    let manual, minPorsi, saldo;
    try {
      [manual, minPorsi, saldo] = await Promise.all([
        batasManual(state.outletId).catch(() => new Map()),
        porsiMinimumOutlet(state.outletId).catch(() => 30),
        listStockBalances(businessUnitId, state.outletId)
      ]);
    } catch (e) {
      hasil.innerHTML = `<p class="error-text">${esc(e.message ?? e)}</p>`;
      return;
    }

    const stok = new Map();
    for (const b of saldo ?? []) stok.set(b.product_id, (stok.get(b.product_id) ?? 0) + Number(b.qty));

    const lap = susunBahanMenipis({ products, recipes, stok, minPorsi, batasManual: manual });
    const namaOutlet = outlets.find((o) => o.id === state.outletId)?.name ?? '';

    container.querySelector('#mn-atur').innerHTML = bolehKelola
      ? `<button id="mn-porsi">🎯 Porsi minimum: <strong>${lap.minPorsi}</strong></button>`
      : `<span style="font-size:0.85rem;color:var(--color-text-muted)">Target cukup ${lap.minPorsi} porsi</span>`;

    container.querySelector('#mn-porsi')?.addEventListener(
      'click',
      sekaliJalan(async () => {
        const v = await formDialog({
          title: `Porsi Minimum — ${namaOutlet}`,
          description:
            'Batas otomatis = takaran rata-rata per porsi × angka ini. Berlaku untuk SEMUA menu sekaligus, tidak diatur per menu. Isi sesuai jarak antar belanja: outlet yang belanja tiap hari tidak perlu menimbun sebanyak yang belanja seminggu sekali.',
          fields: [
            { name: 'porsi', label: 'Stok harus cukup untuk berapa porsi?', type: 'number', required: true, value: String(lap.minPorsi), min: 1, max: 10000 }
          ],
          submitText: 'Simpan'
        });
        if (!v) return;
        try {
          await setPorsiMinimum(state.outletId, v.porsi);
          toast(`Porsi minimum ${namaOutlet} jadi ${v.porsi} porsi.`, 'success');
          await muat();
        } catch (e) {
          toast(e.message ?? 'Gagal menyimpan.', 'error');
        }
      })
    );

    const baris = (r) => `
      <tr>
        <td data-label="Bahan"><strong>${esc(r.nama)}</strong></td>
        <td data-label="Kategori">${esc(r.kategori ?? '-')}</td>
        <td data-label="Status">${LENCANA[r.status]}</td>
        <td data-label="Stok">${formatNum(r.stok)} ${esc(r.satuan)}</td>
        <td data-label="Takaran/porsi">${
          r.takaran == null
            ? '-'
            : `${formatNum(r.takaran)} ${esc(r.satuan)}` +
              // Selisih takaran antar menu ditandai: di situlah rata-rata
              // paling mungkin menyesatkan, dan di situ pula batas manual
              // paling berguna.
              (r.jumlahMenu > 1
                ? ` <span style="font-size:0.72rem;color:var(--color-text-muted)" title="${formatNum(r.takaranMin)}–${formatNum(r.takaranMaks)} ${esc(
                    r.satuan
                  )}">rata² ${r.jumlahMenu} menu</span>`
                : '')
        }</td>
        <td data-label="Cukup">${r.porsi == null ? '-' : `${formatNum(r.porsi)} porsi`}</td>
        <td data-label="Batas">${formatNum(r.batas)}${
          r.batasManual ? ' <span style="font-size:0.72rem;color:var(--color-text-muted)">manual</span>' : ''
        }</td>
        <td data-label="Saran beli">${r.saranBeli > 0 ? `<strong>${formatNum(r.saranBeli)}</strong>` : '-'}</td>
        <td data-label="Aksi">${
          bolehKelola ? `<button class="mn-batas" data-id="${r.productId}" data-nama="${esc(r.nama)}" data-satuan="${esc(r.satuan)}">Batas</button>` : ''
        }</td>
      </tr>`;

    hasil.innerHTML = `
      <p style="margin:0 0 6px;font-size:0.9rem">
        <strong style="color:var(--color-danger)">${lap.jumlahHabis} habis</strong> ·
        <strong>${lap.jumlahMenipis} menipis</strong> ·
        ${lap.jumlahAman} aman
      </p>
      <div class="table-scroll"><table class="data-table table-freeze-1 kartu-sempit">
        <thead><tr><th>Bahan</th><th>Kategori</th><th>Status</th><th>Stok</th><th>Takaran/porsi</th><th>Cukup</th><th>Batas</th><th>Saran beli</th><th>Aksi</th></tr></thead>
        <tbody>${lap.baris.map(baris).join('') || '<tr><td colspan="9">Belum ada bahan yang bisa dihitung — penjualan pada rentang ini masih kosong.</td></tr>'}</tbody>
      </table></div>
      ${
        lap.tersembunyi
          ? `<p style="margin-top:10px;font-size:0.82rem;color:var(--color-text-muted)">
               ${lap.tersembunyi} bahan tidak dipakai resep mana pun (mis. gas, tisu, kemasan), jadi tidak bisa dihitung per porsi.
               Beri <strong>batas manual</strong> kalau tetap perlu diawasi — itu satu-satunya cara memunculkannya di sini.
             </p>`
          : ''
      }
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button id="mn-xlsx">⬇ Unduh Excel</button>
        <button id="mn-wa">💬 Kirim daftar belanja</button>
      </div>`;

    hasil.querySelector('#mn-xlsx').addEventListener('click', async () => {
      await exportTableXLSX({
        filename: `bahan-menipis-${namaOutlet.replace(/[^\w.-]+/g, '-')}-${hariIni}`,
        sheetName: 'Bahan Menipis',
        title: `Bahan Menipis — ${namaOutlet}`,
        subtitle: `Per ${hariIni} · target stok cukup ${lap.minPorsi} porsi`,
        columns: KOLOM_XLSX,
        // SELURUH baris, bukan hanya yang menipis: berkas ini dipakai juga
        // untuk memeriksa apakah batasnya masuk akal, dan itu menuntut melihat
        // yang aman sekaligus.
        rows: lap.baris.map(barisXlsx)
      });
    });

    hasil.querySelector('#mn-wa').addEventListener('click', async () => {
      await infoDialog({
        title: 'Daftar Belanja',
        bodyHtml: `<pre style="white-space:pre-wrap;font-family:inherit;font-size:0.88rem;margin:0">${esc(
          teksBelanja(lap, { outlet: namaOutlet, tanggal: hariIni })
        )}</pre>`
      });
    });

    hasil.querySelectorAll('.mn-batas').forEach((b) =>
      b.addEventListener(
        'click',
        sekaliJalan(async () => {
          const pid = b.dataset.id;
          const punya = manual.has(pid);
          const nilaiKini = punya ? Number(manual.get(pid)) : null;

          // NIATNYA DIPILIH, BUKAN DISIMPULKAN DARI KOSONG/NOL.
          //
          // Bentuk pertamanya satu kotak angka: kosong = otomatis, 0 = jangan
          // diawasi. Itu tidak bisa bekerja — `type: 'qty'` mengubah kosong
          // jadi 0 lewat parseNumber, jadi "kembali ke otomatis" akan diam-diam
          // tersimpan sebagai "jangan diawasi". Dua niat yang berlawanan,
          // hasilnya sama, dan tidak ada error apa pun yang muncul.
          //
          // Memakai `type: 'number'` juga tidak menolong: `step` termasuk
          // atribut yang DIDIAMKAN formDialog, jadi 0,5 kg tidak bisa diketik
          // dengan nyaman di HP.
          const v = await formDialog({
            title: `Batas Minimum — ${b.dataset.nama}`,
            description: `Otomatis = takaran rata-rata per porsi × ${lap.minPorsi} porsi.`,
            fields: [
              {
                name: 'cara',
                label: 'Cara menentukan batas',
                type: 'select',
                required: true,
                value: !punya ? 'otomatis' : nilaiKini > 0 ? 'manual' : 'abaikan',
                options: [
                  { value: 'otomatis', label: 'Otomatis dari resep' },
                  { value: 'manual', label: 'Angka tetap (isi di bawah)' },
                  { value: 'abaikan', label: 'Jangan awasi bahan ini' }
                ]
              },
              {
                name: 'min',
                label: `Angka tetap (${b.dataset.satuan}) — hanya dipakai kalau memilih "Angka tetap"`,
                type: 'qty',
                value: nilaiKini > 0 ? nilaiKini : ''
              },
              { name: 'notes', label: 'Alasan (opsional)', type: 'text', placeholder: 'mis. beli minimal 1 dus' }
            ],
            submitText: 'Simpan'
          });
          if (!v) return;

          if (v.cara === 'manual' && !(Number(v.min) > 0)) {
            toast('Isi angka tetapnya, atau pilih "Jangan awasi bahan ini" kalau memang ingin 0.', 'error');
            return;
          }

          const nilai = v.cara === 'otomatis' ? null : v.cara === 'abaikan' ? 0 : Number(v.min);
          try {
            await simpanBatasManual(state.outletId, pid, nilai, v.notes);
            toast(
              v.cara === 'otomatis'
                ? 'Kembali ke hitungan otomatis.'
                : v.cara === 'abaikan'
                  ? 'Bahan ini tidak akan diawasi lagi.'
                  : 'Batas tersimpan.',
              'success'
            );
            await muat();
          } catch (e) {
            toast(e.message ?? 'Gagal menyimpan batas.', 'error');
          }
        })
      )
    );
  }
}
