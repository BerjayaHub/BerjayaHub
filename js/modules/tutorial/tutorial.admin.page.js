import { toast, confirmDialog, formDialog, escapeHtml } from '../../core/ui.js';
import { listBusinessUnitsBasic } from '../organization/organization.service.js';
import {
  listAllTutorials,
  listAllModules,
  saveTutorial,
  deleteTutorial,
  parseYoutubeId,
  thumbUrl,
  watchUrl
} from './tutorial.service.js';

/**
 * Kelola video tutorial (super admin).
 *
 * Dikelompokkan per MODUL, bukan daftar datar: yang ingin diketahui admin saat
 * membuka halaman ini adalah "modul mana yang belum punya video" -- pertanyaan
 * itu tidak terjawab oleh daftar datar yang diurutkan tanggal.
 */
export async function renderTutorialAdminPage(container) {
  container.innerHTML = `<p style="color:var(--color-text-muted)">Memuat tutorial…</p>`;

  let modules = [];
  let bus = [];
  try {
    [modules, bus] = await Promise.all([listAllModules(), listBusinessUnitsBasic().catch(() => [])]);
  } catch (error) {
    container.innerHTML = `<p class="error-text">${escapeHtml(error.message ?? error)}</p>`;
    return;
  }

  const namaBu = new Map(bus.map((b) => [b.id, b.name]));

  container.innerHTML = `
    <div class="page-header">
      <h1 style="margin:0">Video Tutorial</h1>
      <button class="primary" id="tt-new" style="max-width:170px">+ Tambah Video</button>
    </div>
    <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 12px;max-width:70ch">
      Video muncul sebagai tombol <strong>❓ Tutorial</strong> di header modul, di Staff App maupun Admin Portal.
      Modul yang belum punya video tidak menampilkan tombol apa pun.
      Pakai video <strong>Unlisted</strong> di YouTube — Private tidak bisa diputar di dalam aplikasi,
      dan Public membuat SOP internal muncul di hasil pencarian.
    </p>
    <div id="tt-list"></div>
  `;

  const list = container.querySelector('#tt-list');
  container.querySelector('#tt-new').addEventListener('click', () => openForm(null));

  async function refresh() {
    list.innerHTML = `<p style="color:var(--color-text-muted)">Memuat…</p>`;
    let rows;
    try {
      rows = await listAllTutorials();
    } catch (error) {
      list.innerHTML = `<p class="error-text">${escapeHtml(error.message ?? error)}</p>`;
      return;
    }

    const perModul = new Map();
    for (const r of rows) {
      if (!perModul.has(r.module_code)) perModul.set(r.module_code, []);
      perModul.get(r.module_code).push(r);
    }
    const kosong = modules.filter((m) => !perModul.has(m.code));

    list.innerHTML = `
      ${
        perModul.size
          ? [...perModul.entries()]
              .map(([code, videos]) => kartuModul(code, videos, modules, namaBu))
              .join('')
          : '<p style="color:var(--color-text-muted)">Belum ada video tutorial sama sekali.</p>'
      }
      ${
        kosong.length
          ? `<div class="inline-card" style="margin-top:14px">
               <strong style="font-size:0.9rem">Belum punya video (${kosong.length})</strong>
               <p style="font-size:0.8rem;color:var(--color-text-muted);margin:6px 0 0">
                 ${kosong.map((m) => escapeHtml(m.name)).join(' · ')}
               </p>
             </div>`
          : ''
      }
    `;

    list.querySelectorAll('.tt-edit').forEach((b) =>
      b.addEventListener('click', () => openForm(rows.find((r) => r.id === b.dataset.id)))
    );
    list.querySelectorAll('.tt-del').forEach((b) =>
      b.addEventListener('click', async () => {
        const r = rows.find((x) => x.id === b.dataset.id);
        const ok = await confirmDialog({
          title: `Hapus "${r.title}"?`,
          message: 'Video di YouTube tidak ikut terhapus — hanya tautannya di aplikasi ini.',
          confirmText: 'Hapus',
          danger: true
        });
        if (!ok) return;
        try {
          await deleteTutorial(r.id);
          toast('Video dihapus.', 'success');
          await refresh();
        } catch (error) {
          toast(error.message ?? 'Gagal menghapus.', 'error');
        }
      })
    );
  }

  async function openForm(existing) {
    const values = await formDialog({
      title: existing ? `Edit — ${existing.title}` : 'Tambah Video Tutorial',
      description:
        'Tempel link YouTube dalam bentuk apa pun (youtu.be, watch?v=, /embed/, /shorts/) — sistem mengambil ID videonya sendiri.',
      fields: [
        {
          name: 'module_code',
          label: 'Modul',
          type: 'select',
          required: true,
          value: existing?.module_code ?? modules[0]?.code ?? '',
          options: modules.map((m) => ({ value: m.code, label: m.name }))
        },
        {
          name: 'business_unit_id',
          label: 'Berlaku untuk',
          type: 'select',
          value: existing?.business_unit_id ?? '',
          help: 'Video khusus BU MENIMPA video global untuk modul yang sama, bukan ditambahkan di sebelahnya.',
          options: [{ value: '', label: 'Semua BU (global)' }, ...bus.map((b) => ({ value: b.id, label: b.name }))]
        },
        { name: 'title', label: 'Judul', type: 'text', required: true, value: existing?.title ?? '', placeholder: 'mis. Cara clock in dengan foto' },
        { name: 'youtube_id', label: 'Link YouTube', type: 'text', required: true, value: existing?.youtube_id ?? '', placeholder: 'https://youtu.be/XXXXXXXXXXX' },
        { name: 'description', label: 'Keterangan singkat', type: 'textarea', rows: 2, value: existing?.description ?? '' },
        { name: 'sort_order', label: 'Urutan', type: 'number', value: existing?.sort_order ?? 0, help: 'Angka kecil tampil lebih dulu.' }
      ],
      submitText: 'Simpan'
    });
    if (!values) return;

    // Divalidasi di sini juga, bukan hanya di service: kalau link salah, admin
    // harus tahu SEKARANG selagi dialognya masih terbuka.
    if (!parseYoutubeId(values.youtube_id)) {
      toast('Link YouTube tidak dikenali. Contoh yang benar: https://youtu.be/dQw4w9WgXcQ', 'error');
      return;
    }

    try {
      await saveTutorial({ ...values, id: existing?.id });
      toast('Video tersimpan.', 'success');
      await refresh();
    } catch (error) {
      toast(error.message ?? 'Gagal menyimpan.', 'error');
    }
  }

  await refresh();
}

function kartuModul(code, videos, modules, namaBu) {
  const nama = modules.find((m) => m.code === code)?.name ?? code;
  return `
    <div class="inline-card" style="margin-bottom:12px">
      <strong style="font-size:0.95rem">${escapeHtml(nama)}</strong>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
        ${videos.map((v) => barisVideo(v, namaBu)).join('')}
      </div>
    </div>
  `;
}

function barisVideo(v, namaBu) {
  const lingkup = v.business_unit_id
    ? `<span class="badge badge-pending">Khusus ${escapeHtml(namaBu.get(v.business_unit_id) ?? 'BU')}</span>`
    : `<span class="badge badge-approved">Semua BU</span>`;
  return `
    <div style="display:flex;gap:10px;align-items:flex-start;${v.is_active ? '' : 'opacity:0.5'}">
      <img src="${escapeHtml(thumbUrl(v.youtube_id))}" alt="" loading="lazy"
        style="width:96px;height:54px;object-fit:cover;border-radius:6px;background:#eee;flex-shrink:0" />
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:0.88rem">${escapeHtml(v.title)}${v.is_active ? '' : ' (nonaktif)'}</div>
        ${v.description ? `<div style="font-size:0.76rem;color:var(--color-text-muted)">${escapeHtml(v.description)}</div>` : ''}
        <div style="margin-top:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          ${lingkup}
          <a href="${escapeHtml(watchUrl(v.youtube_id))}" target="_blank" rel="noopener" style="font-size:0.74rem">buka di YouTube ↗</a>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="tt-edit" data-id="${v.id}">Edit</button>
        <button class="tt-del" data-id="${v.id}">Hapus</button>
      </div>
    </div>
  `;
}
