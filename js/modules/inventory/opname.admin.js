/**
 * Tab OPNAME di Admin Portal — membuka, menutup, membatalkan, dan riwayatnya.
 *
 * KENAPA MEMBUKA & MENUTUP ADA DI SINI, BUKAN DI STAFF APP: menutup sesi
 * mengubah stok dan tidak bisa dibatalkan. Staff tetap yang menghitung dan
 * mengisi — yang dipindah ke admin hanya dua tombol yang akibatnya permanen.
 *
 * Tombolnya disembunyikan untuk yang bukan Admin BU, TAPI ITU BUKAN PENGAMAN.
 * Penjaganya ada di `is_bu_admin()` di dalam RPC-nya (0085); yang di sini cuma
 * supaya orang tidak menekan sesuatu yang pasti ditolak.
 */

import { toast, confirmDialog, formDialog, infoDialog } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { sayaAdminBu } from '../../core/base-scope.js';
import { listProducts, listRecipesFull, computeCosts } from '../product/product.service.js';
import { exportTableXLSX } from '../../core/xlsx.js';
import { susunLaporanOpname } from './laporan-opname.js';
import { bukaOpname, tutupOpname, batalkanOpname, riwayatOpname, itemOpname } from './opname.service.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LABEL_STATUS = {
  open: '<span class="badge badge-pending">Sedang berjalan</span>',
  closed: '<span class="badge badge-approved">Selesai</span>',
  cancelled: '<span class="badge" style="background:#eee;color:#666">Dibatalkan</span>'
};

export async function renderOpnameAdmin(container, { businessUnitId, outlets }) {
  container.innerHTML = loadingHtml('Memuat opname…', { baris: 4 });

  let bolehKelola = false;
  let daftar = [];
  let hpp = new Map();
  try {
    const [adminBu, riwayat, products, recipes] = await Promise.all([
      sayaAdminBu(businessUnitId).catch(() => false),
      riwayatOpname(businessUnitId),
      listProducts(businessUnitId),
      listRecipesFull(businessUnitId)
    ]);
    bolehKelola = adminBu;
    daftar = riwayat;
    hpp = computeCosts(products, recipes);
  } catch (error) {
    container.innerHTML = `<p class="error-text">${esc(error.message ?? error)}</p>`;
    return;
  }

  const outletBelumAdaSesi = outlets.filter((o) => !daftar.some((d) => d.outlet_id === o.id && d.status === 'open'));

  container.innerHTML = `
    <div class="page-header">
      <h2 style="font-size:1.05rem;margin:0">Stok Opname</h2>
      ${
        bolehKelola && outletBelumAdaSesi.length
          ? '<button class="primary" id="opn-buka" style="max-width:200px">+ Buka Sesi Opname</button>'
          : ''
      }
    </div>
    <p style="color:var(--color-text-muted);font-size:0.88rem;margin:0 0 12px;max-width:640px">
      Staff mengisi hitungan lewat Staff App ke nomor yang sedang terbuka — boleh diubah berkali-kali, dan
      <strong>stok tidak bergerak sama sekali</strong> sampai sesinya ditutup di sini.
      ${bolehKelola ? '' : '<br /><strong>Hanya Admin BU & Super Admin</strong> yang bisa membuka, menutup, atau membatalkan sesi.'}
    </p>
    <div class="table-scroll"><table class="data-table table-freeze-1 kartu-sempit">
      <thead><tr><th>Nomor</th><th>Tanggal</th><th>Outlet</th><th>Status</th><th>Dibuka</th><th>Aksi</th></tr></thead>
      <tbody>
        ${
          daftar
            .map(
              (d) => `<tr>
                <td data-label="Nomor" style="font-family:ui-monospace,Menlo,monospace;font-size:0.82rem">${esc(d.code)}</td>
                <td data-label="Tanggal">${esc(d.count_date)}</td>
                <td data-label="Outlet">${esc(d.outlets?.name ?? '-')}</td>
                <td data-label="Status">${LABEL_STATUS[d.status] ?? esc(d.status)}</td>
                <td data-label="Dibuka" style="font-size:0.82rem">${esc(d.pembuka?.full_name ?? '-')}</td>
                <td data-label="Aksi">
                  <button class="opn-lihat" data-id="${d.id}">Lihat</button>
                  ${bolehKelola && d.status === 'open' ? `<button class="opn-tutup" data-id="${d.id}" data-code="${esc(d.code)}">Tutup</button>` : ''}
                  ${bolehKelola && d.status === 'open' ? `<button class="opn-batal" data-id="${d.id}" data-code="${esc(d.code)}">Batalkan</button>` : ''}
                </td>
              </tr>`
            )
            .join('') || '<tr><td colspan="6">Belum ada sesi opname.</td></tr>'
        }
      </tbody>
    </table></div>
  `;

  const muat = () => renderOpnameAdmin(container, { businessUnitId, outlets });

  container.querySelector('#opn-buka')?.addEventListener(
    'click',
    sekaliJalan(async () => {
      const v = await formDialog({
        title: 'Buka Sesi Opname',
        description: 'Setelah dibuka, staff bisa mulai mengisi hitungan lewat Staff App. Stok belum berubah sampai sesi ini ditutup.',
        fields: [
          {
            name: 'outlet_id',
            label: 'Outlet',
            type: 'select',
            required: true,
            // Outlet yang SUDAH punya sesi terbuka tidak ditawarkan: membukanya
            // lagi cuma mengembalikan sesi yang sama, dan menawarkannya membuat
            // orang mengira ia sedang membuat yang baru.
            options: outletBelumAdaSesi.map((o) => ({ value: o.id, label: o.name }))
          },
          { name: 'notes', label: 'Catatan (opsional)', type: 'text', placeholder: 'mis. opname akhir bulan' }
        ],
        submitText: 'Buka Sesi'
      });
      if (!v) return;
      try {
        await bukaOpname(v.outlet_id, v.notes);
        toast('Sesi opname dibuka. Staff sudah bisa mengisi hitungan.', 'success');
        await muat();
      } catch (error) {
        toast(error.message ?? 'Gagal membuka sesi.', 'error');
      }
    })
  );

  container.querySelectorAll('.opn-tutup').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(async () => {
        // Ringkasannya ditampilkan SEBELUM menutup, lengkap dengan nilai
        // rupiahnya. Menutup mengubah stok dan tidak bisa dibatalkan — angka
        // yang akan terjadi harus bisa dilihat dulu, bukan sesudahnya.
        const items = await itemOpname(btn.dataset.id).catch(() => []);
        const lap = susunLaporanOpname({ sesi: { code: btn.dataset.code }, items, hpp, denganNilai: true });
        const ok = await confirmDialog({
          title: `Tutup ${btn.dataset.code}?`,
          message:
            `<p><strong>${lap.jumlahItem}</strong> bahan dihitung, <strong>${lap.jumlahSelisih}</strong> berselisih.</p>` +
            `<p style="margin:6px 0">Kurang: <strong style="color:var(--color-danger)">${lap.nilaiKurangTeks}</strong> · ` +
            `Lebih: <strong>${lap.nilaiLebihTeks}</strong></p>` +
            (lap.jumlahBentrok
              ? `<p style="color:var(--color-danger)">⚠ ${lap.jumlahBentrok} bahan pernah dihitung dua orang dengan angka berbeda — periksa dulu sebelum menutup.</p>`
              : '') +
            (lap.adaTanpaHpp ? '<p style="font-size:0.85rem;color:var(--color-text-muted)">Sebagian bahan belum punya HPP, jadi nilainya belum lengkap.</p>' : '') +
            '<p style="margin-top:8px">Stok akan disesuaikan sekarang, dan <strong>tidak bisa dibatalkan</strong>. Bahan yang tidak dihitung tidak disentuh.</p>',
          confirmText: 'Tutup & sesuaikan stok',
          danger: true
        });
        if (!ok) return;
        try {
          const n = await tutupOpname(btn.dataset.id);
          toast(`${btn.dataset.code} ditutup — ${n} bahan disesuaikan.`, 'success');
          await muat();
        } catch (error) {
          toast(error.message ?? 'Gagal menutup sesi.', 'error');
        }
      })
    )
  );

  container.querySelectorAll('.opn-batal').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(async () => {
        const v = await formDialog({
          title: `Batalkan ${btn.dataset.code}?`,
          description:
            'Sesi ditutup TANPA menyentuh stok sama sekali. Hitungan yang sudah masuk tetap tersimpan sebagai riwayat — yang dibatalkan akibatnya pada stok, bukan catatan bahwa ada orang menghitung.',
          fields: [{ name: 'alasan', label: 'Alasan pembatalan', type: 'text', required: true, placeholder: 'mis. hitungan tidak lengkap, diulang besok' }],
          submitText: 'Batalkan Sesi'
        });
        if (!v) return;
        try {
          await batalkanOpname(btn.dataset.id, v.alasan);
          toast('Sesi dibatalkan. Stok tidak berubah.', 'success');
          await muat();
        } catch (error) {
          toast(error.message ?? 'Gagal membatalkan sesi.', 'error');
        }
      })
    )
  );

  container.querySelectorAll('.opn-lihat').forEach((btn) =>
    btn.addEventListener(
      'click',
      sekaliJalan(async () => {
        const sesi = daftar.find((d) => d.id === btn.dataset.id);
        const items = await itemOpname(btn.dataset.id).catch(() => []);
        const lap = susunLaporanOpname({
          sesi: { ...sesi, outletName: sesi?.outlets?.name },
          items,
          hpp,
          denganNilai: true
        });
        await infoDialog({
          title: lap.judul,
          bodyHtml:
            `<p style="font-size:0.85rem;color:var(--color-text-muted)">${esc(lap.subjudul)}</p>` +
            `<p>Kurang: <strong style="color:var(--color-danger)">${lap.nilaiKurangTeks}</strong> · Lebih: <strong>${lap.nilaiLebihTeks}</strong></p>` +
            // Label kolom ikut menempel di tiap sel: dialog ini yang paling
            // sering dibuka di HP saat admin memeriksa selisih dari lapangan,
            // dan tabel delapan kolom di layar sempit hanya terbaca sebagai kartu.
            `<div class="table-scroll" style="max-height:320px"><table class="data-table kartu-sempit"><thead><tr>${lap.kolom
              .map((k) => `<th>${esc(k.header)}</th>`)
              .join('')}</tr></thead><tbody>${lap.baris
              .map((b) => `<tr>${b.map((sel, i) => `<td data-label="${esc(lap.kolom[i]?.header ?? '')}">${esc(sel)}</td>`).join('')}</tr>`)
              .join('')}</tbody></table></div>` +
            `<div style="margin-top:10px"><button id="opn-xlsx">⬇ Unduh Excel</button></div>`
        });
        document.getElementById('opn-xlsx')?.addEventListener('click', async () => {
          await exportTableXLSX({
            filename: lap.namaBerkas,
            sheetName: 'Opname',
            title: lap.judul,
            subtitle: lap.subjudul,
            columns: lap.kolom,
            rows: lap.baris
          });
        });
      })
    )
  );
}

