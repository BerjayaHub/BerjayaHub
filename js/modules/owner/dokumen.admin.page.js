import { escapeHtml, toast, formDialog, shareDialog, confirmDialog } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import { supabase } from '../../config/supabase-client.js';
import { listDokumen, unggahDokumen, urlSementara, tautanDokumen } from './dokumen.service.js';
import { listOutletsBu } from './owner.service.js';

/**
 * Sisi ADMIN dari alur tanda tangan: mengunggah dokumen dan mengirim tautannya.
 *
 * Halaman owner tidak ada gunanya tanpa layar ini — owner hanya bisa
 * menandatangani apa yang sudah diunggah orang lain. Keduanya sengaja dibangun
 * bersamaan, karena separuh alur yang bisa dipakai lebih membingungkan daripada
 * alur yang belum ada sama sekali: dokumen bisa masuk tapi tidak pernah bisa
 * diminta tanda tangannya, dan tidak ada pesan yang menjelaskan kenapa.
 *
 * Outlet-nya memakai `listOutletsBu` — daftar outlet BU yang sedang dikelola,
 * bukan "outlet yang saya kelola". Layar ini MENULIS, dan sumber daftar untuk
 * layar yang menulis harus daftar resmi BU-nya; `audit-outlet-tulis.cjs` yang
 * menjaga aturan itu.
 */

const STATUS = {
  menunggu: { label: 'Menunggu tanda tangan', kelas: 'badge-pending' },
  ditandatangani: { label: 'Ditandatangani', kelas: 'badge-approved' },
  ditolak: { label: 'Ditolak', kelas: 'badge-rejected' }
};

export async function renderDokumenAdminPage(root, ctx) {
  root.innerHTML = `
    <div class="module-header">
      <div class="module-header-title">✍️ Dokumen untuk Owner</div>
    </div>
    <p class="report-note" style="margin-bottom:14px">
      Unggah PDF di sini, lalu kirim tautannya ke owner lewat chat. Owner harus masuk dulu,
      setelah itu langsung mendarat di dokumennya.
    </p>
    <button class="primary" id="btn-unggah" style="min-height:44px;margin-bottom:14px">＋ Unggah dokumen</button>
    <div id="dok-daftar">${loadingHtml('Memuat…')}</div>
  `;

  root.querySelector('#btn-unggah').addEventListener('click', () => bukaFormUnggah(root, ctx));
  await gambarDaftar(root, ctx);
}

async function gambarDaftar(root, ctx) {
  const wrap = root.querySelector('#dok-daftar');
  wrap.innerHTML = loadingHtml('Memuat dokumen…');

  let dok;
  try {
    dok = await listDokumen({ businessUnitId: ctx.businessUnitId });
  } catch (error) {
    wrap.innerHTML = `<p class="error-text">Gagal memuat: ${escapeHtml(error?.message ?? String(error))}</p>`;
    return;
  }

  if (!dok.length) {
    wrap.innerHTML = '<p class="report-note">Belum ada dokumen yang diunggah.</p>';
    return;
  }

  wrap.innerHTML = `
    <div class="table-scroll">
      <table class="data-table kartu-sempit table-freeze-1">
        <thead><tr><th>Dokumen</th><th>Outlet</th><th>Diunggah</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>
          ${dok
            .map((d) => {
              const s = STATUS[d.status] ?? { label: d.status, kelas: 'badge' };
              return `<tr>
                <td data-label="Dokumen">
                  ${escapeHtml(d.title)}
                  ${d.notes ? `<br /><span style="font-size:0.72rem;color:var(--color-text-muted)">${escapeHtml(d.notes)}</span>` : ''}
                  ${
                    d.status === 'ditolak'
                      ? `<br /><span style="font-size:0.74rem;color:#b91c1c">Alasan: ${escapeHtml(d.reject_reason ?? '-')}</span>`
                      : ''
                  }
                </td>
                <td data-label="Outlet">${escapeHtml(d.outlets?.name ?? 'Semua')}</td>
                <td data-label="Diunggah">${tanggal(d.created_at)}<br /><span style="font-size:0.72rem;color:var(--color-text-muted)">${escapeHtml(
                  d.pengunggah?.full_name ?? '-'
                )}</span></td>
                <td data-label="Status">
                  <span class="badge ${escapeHtml(s.kelas)}">${escapeHtml(s.label)}</span>
                  ${d.decided_at ? `<br /><span style="font-size:0.72rem;color:var(--color-text-muted)">${tanggal(d.decided_at)}</span>` : ''}
                </td>
                <td data-label="Aksi">
                  <div style="display:flex;gap:6px;flex-wrap:wrap">
                    <button data-lihat="${escapeHtml(d.file_path)}" style="min-height:38px">📄 Asli</button>
                    ${
                      d.status === 'menunggu'
                        ? `<button class="primary" data-kirim="${d.id}" data-judul="${escapeHtml(d.title)}" style="min-height:38px">🔗 Kirim</button>
                           <button class="btn-danger" data-hapus="${d.id}" style="min-height:38px">Hapus</button>`
                        : ''
                    }
                    ${d.signed_path ? `<button data-lihat="${escapeHtml(d.signed_path)}" style="min-height:38px">✍️ Bertandatangan</button>` : ''}
                    ${d.sheet_path ? `<button data-lihat="${escapeHtml(d.sheet_path)}" style="min-height:38px">🧾 Pengesahan</button>` : ''}
                  </div>
                </td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;

  wrap.querySelectorAll('[data-lihat]').forEach((b) =>
    b.addEventListener(
      'click',
      sekaliJalan(async () => {
        try {
          const url = await urlSementara('documents', b.dataset.lihat, 300);
          if (url) window.open(url, '_blank', 'noopener');
          else toast('Berkasnya tidak ditemukan.', 'warning');
        } catch (error) {
          toast(error.message ?? 'Gagal membuka berkas.', 'error');
        }
      }, { teks: 'Membuka…' })
    )
  );

  wrap.querySelectorAll('[data-kirim]').forEach((b) =>
    b.addEventListener('click', () => {
      const tautan = tautanDokumen(b.dataset.kirim);
      shareDialog({
        title: 'Kirim ke owner',
        helper: 'Salin pesan ini, atau kirim langsung lewat WhatsApp. Owner harus masuk dulu sebelum dokumennya terbuka.',
        defaultMessage: `Mohon tanda tangan untuk dokumen "${b.dataset.judul}".\n\n${tautan}`
      });
    })
  );

  wrap.querySelectorAll('[data-hapus]').forEach((b) =>
    b.addEventListener(
      'click',
      sekaliJalan(async () => {
        const yakin = await confirmDialog({
          title: 'Hapus dokumen?',
          message: 'Dokumen ini belum diputus owner, jadi masih bisa dihapus. Yang sudah ditandatangani atau ditolak tidak bisa.',
          confirmText: 'Hapus',
          danger: true
        });
        if (!yakin) return;

        // Hasilnya DIPERIKSA, bukan dianggap berhasil. PostgREST tidak
        // menganggap penolakan RLS sebagai error: DELETE yang ditolak pulang
        // sukses dengan nol baris, dan barisnya tetap ada di layar berikutnya
        // tanpa satu pun pesan.
        const { data, error } = await supabase.from('documents').delete().eq('id', b.dataset.hapus).select('id');
        if (error) {
          toast(error.message ?? 'Gagal menghapus.', 'error');
          return;
        }
        if (!data?.length) {
          toast('Dokumen tidak jadi dihapus — kemungkinan owner sudah memutuskannya lebih dulu.', 'warning');
          await gambarDaftar(root, ctx);
          return;
        }
        toast('Dokumen dihapus.', 'success');
        await gambarDaftar(root, ctx);
      })
    )
  );
}

function tanggal(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });
}

async function bukaFormUnggah(root, ctx) {
  let outlets = [];
  try {
    outlets = await listOutletsBu(ctx.businessUnitId);
  } catch {
    outlets = [];
  }

  const nilai = await formDialog({
    title: 'Unggah dokumen',
    description: 'Hanya PDF. Sidik jari isi berkas dicatat saat diunggah, dan diperiksa lagi tepat sebelum ditandatangani.',
    submitText: 'Unggah',
    fields: [
      { name: 'title', label: 'Judul dokumen', type: 'text', required: true },
      {
        name: 'outlet_id',
        label: 'Outlet (opsional)',
        type: 'select',
        options: [{ value: '', label: 'Tidak khusus outlet' }, ...outlets.map((o) => ({ value: o.id, label: o.name }))]
      },
      { name: 'notes', label: 'Catatan untuk owner', type: 'textarea', rows: 3 },
      { name: 'file', label: 'Berkas PDF', type: 'file', accept: 'application/pdf', required: true }
    ]
  });
  if (!nilai) return;

  if (nilai.file?.type !== 'application/pdf') {
    toast('Hanya berkas PDF yang bisa dimintakan tanda tangan.', 'warning');
    return;
  }

  try {
    const id = await unggahDokumen({
      businessUnitId: ctx.businessUnitId,
      outletId: nilai.outlet_id || null,
      title: nilai.title,
      notes: nilai.notes,
      file: nilai.file
    });
    toast('Dokumen terunggah.', 'success');
    await gambarDaftar(root, ctx);

    // Tautannya ditawarkan LANGSUNG. Kalau tidak, unggahan berhenti di sini dan
    // owner tidak pernah tahu ada yang menunggu — tidak ada pemberitahuan
    // otomatis di alur ini.
    shareDialog({
      title: 'Kirim ke owner',
      helper: 'Dokumen sudah masuk. Kirim tautan ini supaya owner tahu ada yang menunggu tanda tangannya.',
      defaultMessage: `Mohon tanda tangan untuk dokumen "${nilai.title}".\n\n${tautanDokumen(id)}`
    });
  } catch (error) {
    toast(error.message ?? 'Gagal mengunggah.', 'error');
  }
}
