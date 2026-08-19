import { escapeHtml, toast, confirmDialog, formDialog, infoDialog } from '../../core/ui.js';
import { loadingHtml, sekaliJalan } from '../../core/loading.js';
import {
  listDokumen,
  ambilDokumen,
  ambilTtdSaya,
  simpanTtd,
  urlSementara,
  tandatanganiDokumen,
  tolakDokumen
} from './dokumen.service.js';

/**
 * Dokumen & Tanda Tangan.
 *
 * ============ TOMBOL "TOLAK" ADA SEJAK AWAL ============
 *
 * Alur pengesahan yang hanya punya tombol setuju bukan alur pengesahan — ia
 * formalitas yang menekan orang untuk menyetujui, karena satu-satunya cara
 * menyelesaikan layar ini adalah menandatangani. Menolak juga WAJIB beralasan,
 * dijaga sampai ke `documents_keputusan_utuh` di database: penolakan tanpa
 * alasan tidak bisa ditindaklanjuti pengunggahnya.
 *
 * ============ APA YANG SEBENARNYA DIJAMIN TANDA TANGAN INI ============
 *
 * Ditulis di layar, bukan hanya di kode, karena yang perlu tahu batasnya adalah
 * orang yang menandatangani. Gambar tanda tangan bisa disalin siapa pun yang
 * memegang berkas hasilnya. Yang tidak bisa dipalsukan adalah catatan di
 * database: siapa, kapan menurut jam server, dan sidik jari isi berkas pada
 * saat itu.
 */

const STATUS = {
  menunggu: { label: 'Menunggu', kelas: 'badge-pending' },
  ditandatangani: { label: 'Ditandatangani', kelas: 'badge-approved' },
  ditolak: { label: 'Ditolak', kelas: 'badge-rejected' }
};

export async function renderDokumenOwner(root, ctx) {
  root.innerHTML = `
    <div class="module-header">
      <div class="module-header-title">✍️ Dokumen &amp; Tanda Tangan</div>
    </div>
    <nav class="tab-bar" id="dok-tab">
      <button class="tab-btn active" data-sub="menunggu">Menunggu</button>
      <button class="tab-btn" data-sub="riwayat">Riwayat</button>
      <button class="tab-btn" data-sub="ttd">Tanda Tangan Saya</button>
    </nav>
    <div id="dok-isi">${loadingHtml('Memuat…')}</div>
  `;

  const buka = (sub) => {
    root.querySelectorAll('[data-sub]').forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
    ctx.catatLayar?.(sub);
    if (sub === 'ttd') return gambarTtd(root, ctx);
    return gambarDaftar(root, ctx, sub);
  };

  root.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => buka(b.dataset.sub)));

  await buka(ctx.layarAwal === 'ttd' || ctx.layarAwal === 'riwayat' ? ctx.layarAwal : 'menunggu');

  // Tautan dari chat: dokumennya dibuka setelah daftarnya tergambar, supaya
  // menutup dialognya meninggalkan layar yang sudah berisi — bukan layar
  // pemuatan yang kosong.
  if (ctx.dokumenAwal) await bukaDokumen(root, ctx, ctx.dokumenAwal);
}

async function gambarDaftar(root, ctx, sub) {
  const isi = root.querySelector('#dok-isi');
  isi.innerHTML = loadingHtml('Memuat dokumen…');

  let dok;
  try {
    dok = await listDokumen({ businessUnitId: ctx.businessUnitId, status: sub === 'menunggu' ? 'menunggu' : null });
  } catch (error) {
    isi.innerHTML = `<p class="error-text">Gagal memuat: ${escapeHtml(error?.message ?? String(error))}</p>`;
    return;
  }

  if (sub === 'riwayat') dok = dok.filter((d) => d.status !== 'menunggu');

  if (!dok.length) {
    isi.innerHTML = `<p class="report-note">${
      sub === 'menunggu' ? 'Tidak ada dokumen yang menunggu tanda tangan.' : 'Belum ada dokumen yang pernah diputus.'
    }</p>`;
    return;
  }

  isi.innerHTML = `
    <div class="table-scroll">
      <table class="data-table kartu-sempit table-freeze-1">
        <thead><tr><th>Dokumen</th><th>Dari</th><th>Masuk</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${dok
            .map((d) => {
              const s = STATUS[d.status] ?? { label: d.status, kelas: 'badge' };
              return `<tr>
                <td data-label="Dokumen">
                  ${escapeHtml(d.title)}
                  ${d.outlets?.name ? `<br /><span style="font-size:0.72rem;color:var(--color-text-muted)">${escapeHtml(d.outlets.name)}</span>` : ''}
                </td>
                <td data-label="Dari">${escapeHtml(d.pengunggah?.full_name ?? '-')}</td>
                <td data-label="Masuk">${tanggal(d.created_at)}</td>
                <td data-label="Status"><span class="badge ${escapeHtml(s.kelas)}">${escapeHtml(s.label)}</span></td>
                <td data-label=""><button data-buka="${d.id}" style="min-height:38px">Buka</button></td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;

  isi.querySelectorAll('[data-buka]').forEach((b) => {
    b.addEventListener('click', () => bukaDokumen(root, ctx, b.dataset.buka));
  });
}

function tanggal(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });
}

async function bukaDokumen(root, ctx, id) {
  let d;
  try {
    d = await ambilDokumen(id);
  } catch (error) {
    toast(error.message ?? 'Gagal membuka dokumen.', 'error');
    return;
  }
  if (!d) {
    // Dibedakan dari kegagalan teknis. Tautan yang menunjuk BU lain akan
    // ditolak RLS dan pulang KOSONG, bukan sebagai error — kalau tidak
    // dijelaskan, owner akan mengira dokumennya dihapus.
    toast('Dokumen tidak ditemukan, atau berada di Business Unit yang tidak kamu awasi.', 'warning');
    return;
  }

  let urlAsli = null;
  try {
    urlAsli = await urlSementara('documents', d.file_path, 600);
  } catch {
    urlAsli = null;
  }

  const s = STATUS[d.status] ?? { label: d.status, kelas: 'badge' };
  const sudahDiputus = d.status !== 'menunggu';

  // `infoDialog`, bukan `formDialog`: isinya HTML bebas dengan beberapa tombol
  // beraksi sendiri, bukan sederet field yang dikumpulkan jadi satu nilai.
  //
  // Semua listener dipasang di dalam `onReady`. Memasangnya setelah `await`
  // menghasilkan tombol yang tidak pernah bisa ditekan — dialognya baru selesai
  // ketika DITUTUP, jadi saat itu tombolnya sudah tidak ada. Tombolnya tetap
  // terlihat normal, jadi kegagalan itu tidak kelihatan sampai ada yang mencoba
  // menekannya.
  return infoDialog({
    title: d.title,
    bodyHtml: `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <span class="badge ${escapeHtml(s.kelas)}">${escapeHtml(s.label)}</span>
        <span style="font-size:0.78rem;color:var(--color-text-muted)">
          dari ${escapeHtml(d.pengunggah?.full_name ?? '-')} · ${tanggal(d.created_at)}
        </span>
      </div>

      ${d.notes ? `<p style="margin:0 0 10px">${escapeHtml(d.notes)}</p>` : ''}

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        ${urlAsli ? `<a class="btn-inline" href="${urlAsli}" target="_blank" rel="noopener">📄 Buka dokumen</a>` : '<span class="error-text">Berkasnya tidak bisa dibuka.</span>'}
        <button type="button" id="dok-lihat" style="min-height:38px">👁️ Lihat di sini</button>
      </div>

      <iframe id="dok-bingkai" title="Pratinjau dokumen" style="display:none;width:100%;height:52vh;border:1px solid var(--color-border);border-radius:8px"></iframe>

      ${
        sudahDiputus
          ? panelHasil(d)
          : `<p class="report-note" style="margin-top:12px">
               Tanda tangan yang tersimpan akan ditempel di halaman terakhir, dan sebuah
               <strong>Lembar Pengesahan</strong> dibuat terpisah.
               Yang tercatat di sistem: identitasmu, waktu menurut jam server, dan sidik jari isi berkas —
               itulah yang bisa dibuktikan, bukan gambar tanda tangannya.
             </p>
             <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
               <button type="button" id="dok-ttd" class="primary" style="min-height:44px;flex:1;min-width:160px">✍️ Tanda tangani</button>
               <button type="button" id="dok-tolak" class="btn-danger" style="min-height:44px;flex:1;min-width:140px">Tolak</button>
             </div>`
      }
    `,
    onReady: (body, { close }) => {
      body.querySelector('#dok-lihat')?.addEventListener('click', () => {
        if (!urlAsli) return;
        const bingkai = body.querySelector('#dok-bingkai');
        bingkai.src = urlAsli;
        bingkai.style.display = 'block';
      });

      // Unduhan berkas hasil: URL-nya dibuat SAAT diklik, bukan saat dialog
      // digambar. URL bertanda tangan hanya berlaku sebentar, dan dialog yang
      // dibiarkan terbuka beberapa menit akan menyimpan tautan yang sudah mati.
      body.querySelectorAll('[data-unduh]').forEach((b) => {
        b.addEventListener(
          'click',
          sekaliJalan(async () => {
            try {
              const url = await urlSementara('documents', b.dataset.unduh, 300);
              if (url) window.open(url, '_blank', 'noopener');
            } catch (error) {
              toast(error.message ?? 'Gagal membuka berkas.', 'error');
            }
          }, { teks: 'Menyiapkan…' })
        );
      });

      body.querySelector('#dok-ttd')?.addEventListener(
        'click',
        sekaliJalan(async () => {
          try {
            await tandatanganiDokumen({ dokumen: d, namaPenandaTangan: ctx.profile?.full_name ?? 'Owner' });
            toast('Dokumen ditandatangani.', 'success');
            close();
            await gambarDaftar(root, ctx, 'menunggu');
          } catch (error) {
            toast(error.message ?? 'Gagal menandatangani.', 'error');
          }
        }, { teks: 'Menandatangani…' })
      );

      body.querySelector('#dok-tolak')?.addEventListener(
        'click',
        sekaliJalan(async () => {
          const alasan = await tanyaAlasan();
          if (!alasan) return;
          try {
            await tolakDokumen({ dokumenId: d.id, alasan });
            toast('Dokumen ditolak. Alasannya tercatat.', 'success');
            close();
            await gambarDaftar(root, ctx, 'menunggu');
          } catch (error) {
            toast(error.message ?? 'Gagal menolak.', 'error');
          }
        })
      );
    }
  });
}

function panelHasil(d) {
  if (d.status === 'ditolak') {
    return `
      <div class="report-note" style="margin-top:12px;border-left-color:#b91c1c">
        <strong>Ditolak</strong> oleh ${escapeHtml(d.pemutus?.full_name ?? '-')} pada ${tanggal(d.decided_at)}.
        <p style="margin:6px 0 0">Alasan: ${escapeHtml(d.reject_reason ?? '-')}</p>
      </div>`;
  }
  return `
    <div class="report-note" style="margin-top:12px">
      <strong>Ditandatangani</strong> oleh ${escapeHtml(d.pemutus?.full_name ?? '-')} pada ${tanggal(d.decided_at)}.
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button type="button" data-unduh="${escapeHtml(d.signed_path ?? '')}" style="min-height:38px">📄 PDF bertandatangan</button>
        ${d.sheet_path ? `<button type="button" data-unduh="${escapeHtml(d.sheet_path)}" style="min-height:38px">🧾 Lembar Pengesahan</button>` : ''}
      </div>
    </div>`;
}

async function tanyaAlasan() {
  const nilai = await formDialog({
    title: 'Tolak dokumen',
    description: 'Alasannya akan terlihat oleh pengunggah. Tanpa alasan, penolakan tidak bisa ditindaklanjuti.',
    submitText: 'Tolak',
    fields: [{ name: 'alasan', label: 'Alasan', type: 'textarea', required: true, rows: 3 }]
  });
  return (nilai?.alasan ?? '').trim() || null;
}

// =====================================================================
// TANDA TANGAN TERSIMPAN
// =====================================================================

async function gambarTtd(root, ctx) {
  const isi = root.querySelector('#dok-isi');
  isi.innerHTML = loadingHtml('Memuat tanda tangan…');

  let ttd = null;
  let pratinjau = null;
  try {
    ttd = await ambilTtdSaya();
    if (ttd?.image_path) pratinjau = await urlSementara('owner-signature', ttd.image_path, 600);
  } catch {
    // Belum ada tanda tangan bukan kesalahan — layarnya memang untuk membuatnya.
  }

  isi.innerHTML = `
    ${
      pratinjau
        ? `<p style="margin:0 0 6px;font-size:0.85rem;color:var(--color-text-muted)">Tanda tangan tersimpan:</p>
           <img src="${pratinjau}" alt="Tanda tangan tersimpan" style="max-width:280px;border:1px solid var(--color-border);border-radius:8px;background:#fff" />`
        : '<p class="report-note">Belum ada tanda tangan tersimpan. Buat sekali di sini, lalu bisa dipakai untuk semua dokumen berikutnya.</p>'
    }

    <h4 style="margin:18px 0 6px">${pratinjau ? 'Ganti tanda tangan' : 'Buat tanda tangan'}</h4>
    <p class="report-note" style="margin-bottom:10px">
      Tanda tangani langsung di kotak di bawah dengan jari atau pena. Latarnya dibuat transparan
      supaya tidak menutupi teks dokumen saat ditempel.
    </p>
    <canvas id="kanvas-ttd" style="width:100%;max-width:520px;height:200px;border:1px dashed var(--color-border);border-radius:10px;background:#fff;touch-action:none"></canvas>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button id="btn-bersih" style="min-height:44px">Hapus coretan</button>
      <button class="primary" id="btn-simpan-ttd" style="min-height:44px">Simpan tanda tangan</button>
    </div>

    <p class="report-note" style="margin-top:18px">
      Tanda tangan ini hanya bisa dibaca oleh akunmu sendiri — tidak oleh admin, tidak oleh super admin.
      Itu disengaja: tanda tangan yang bisa diambil orang lain dari sistem bukan lagi tanda tangan.
    </p>
  `;

  pasangKanvas(isi.querySelector('#kanvas-ttd'), isi, ctx, root);
}

function pasangKanvas(kanvas, isi, ctx, root) {
  // Kanvas digambar pada resolusi perangkat, bukan resolusi CSS. Tanpa ini,
  // tanda tangan di layar HP ber-DPI tinggi tersimpan buram dan pecah begitu
  // ditempel ke PDF yang dicetak.
  const dpr = window.devicePixelRatio || 1;
  const atur = () => {
    const kotak = kanvas.getBoundingClientRect();
    kanvas.width = Math.round(kotak.width * dpr);
    kanvas.height = Math.round(kotak.height * dpr);
    const c = kanvas.getContext('2d');
    c.scale(dpr, dpr);
    c.lineWidth = 2.2;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = '#111827';
  };
  atur();

  const ctx2d = kanvas.getContext('2d');
  let menggambar = false;
  let adaCoretan = false;

  const titik = (e) => {
    const kotak = kanvas.getBoundingClientRect();
    return { x: e.clientX - kotak.left, y: e.clientY - kotak.top };
  };

  kanvas.addEventListener('pointerdown', (e) => {
    menggambar = true;
    adaCoretan = true;
    kanvas.setPointerCapture(e.pointerId);
    const p = titik(e);
    ctx2d.beginPath();
    ctx2d.moveTo(p.x, p.y);
  });
  kanvas.addEventListener('pointermove', (e) => {
    if (!menggambar) return;
    const p = titik(e);
    ctx2d.lineTo(p.x, p.y);
    ctx2d.stroke();
  });
  const selesai = () => {
    menggambar = false;
  };
  kanvas.addEventListener('pointerup', selesai);
  kanvas.addEventListener('pointercancel', selesai);
  kanvas.addEventListener('pointerleave', selesai);

  isi.querySelector('#btn-bersih').addEventListener('click', () => {
    ctx2d.clearRect(0, 0, kanvas.width, kanvas.height);
    adaCoretan = false;
  });

  isi.querySelector('#btn-simpan-ttd').addEventListener(
    'click',
    sekaliJalan(async () => {
      if (!adaCoretan) {
        toast('Belum ada coretan untuk disimpan.', 'warning');
        return;
      }
      const setuju = await confirmDialog({
        title: 'Simpan tanda tangan?',
        message:
          'Tanda tangan ini akan dipakai untuk menandatangani dokumen berikutnya. Tanda tangan lama diganti, tapi dokumen yang sudah ditandatangani tidak berubah.',
        confirmLabel: 'Simpan'
      });
      if (!setuju) return;

      const blob = await new Promise((r) => kanvas.toBlob(r, 'image/png'));
      if (!blob) {
        toast('Gagal membuat gambar tanda tangan.', 'error');
        return;
      }
      try {
        await simpanTtd(blob);
        toast('Tanda tangan tersimpan.', 'success');
        await gambarTtd(root, ctx);
      } catch (error) {
        toast(error.message ?? 'Gagal menyimpan tanda tangan.', 'error');
      }
    }, { teks: 'Menyimpan…' })
  );
}
