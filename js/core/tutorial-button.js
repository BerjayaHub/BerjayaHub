import { escapeHtml } from './ui.js';
import { listTutorials, embedUrl, thumbUrl, watchUrl } from '../modules/tutorial/tutorial.service.js';

/**
 * Tombol ❓ "Tutorial" di header modul, plus dialog pemutarnya.
 *
 * DIPUTAR DI DALAM APP, bukan membuka tab YouTube. Di PWA, membuka tab baru
 * berarti orangnya keluar dari aplikasi dan sering tidak kembali -- padahal dia
 * membuka tutorial justru karena sedang di tengah mengerjakan sesuatu.
 * Tetap disediakan tautan "Buka di YouTube" sebagai cadangan, karena sebagian
 * jaringan kantor memblokir iframe embed sementara aplikasi YouTube-nya jalan.
 */

/** Lepas tombol melayang milik halaman sebelumnya. Sinkron, supaya bisa dipanggil
 *  tepat sebelum halaman baru dirender tanpa risiko balapan dengan mount asinkron. */
export function clearFloatingTutorialButton() {
  document.querySelectorAll('.tutorial-btn-float').forEach((b) => b.remove());
}

let gaya = false;
function pasangGaya() {
  if (gaya) return;
  gaya = true;
  const el = document.createElement('style');
  el.textContent = `
    .tutorial-btn{background:transparent;border:1px solid var(--color-border,#ddd);border-radius:999px;
      padding:4px 10px;font-size:0.8rem;cursor:pointer;color:var(--color-text-muted,#666);line-height:1.4;
      display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
    .tutorial-btn:hover{color:var(--color-primary,#333);border-color:var(--color-primary,#333)}
    .tutorial-btn-float{position:fixed;right:18px;bottom:18px;z-index:40;background:var(--color-surface,#fff);
      box-shadow:0 2px 10px rgba(0,0,0,0.15);padding:8px 14px}
    .tutorial-list{display:flex;flex-direction:column;gap:10px;margin:0}
    .tutorial-item{display:flex;gap:10px;align-items:flex-start;background:none;border:1px solid var(--color-border,#e3e3e3);
      border-radius:10px;padding:8px;cursor:pointer;text-align:left;width:100%}
    .tutorial-item:hover{border-color:var(--color-primary,#333)}
    .tutorial-item img{width:104px;height:58px;object-fit:cover;border-radius:6px;flex-shrink:0;background:#eee}
    .tutorial-item .t-title{font-weight:600;font-size:0.9rem}
    .tutorial-item .t-desc{font-size:0.76rem;color:var(--color-text-muted,#666);margin-top:2px}
    .tutorial-player{position:relative;width:100%;padding-top:56.25%;background:#000;border-radius:8px;overflow:hidden}
    .tutorial-player iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
  `;
  document.head.appendChild(el);
}

/**
 * Pasang tombol tutorial untuk sebuah modul.
 *
 * Tombolnya HANYA muncul kalau modul itu benar-benar punya video. Tombol
 * bantuan yang membuka daftar kosong lebih merugikan daripada tidak ada tombol:
 * sekali orang menekannya dan tidak menemukan apa-apa, dia berhenti mencoba.
 *
 * @param {HTMLElement} host  tempat tombol disisipkan (mode inline)
 * @param {string} moduleCode
 * @param {string} businessUnitId
 * @param {{floating?: boolean}} opts  floating = tombol melayang di pojok kanan bawah
 */
export async function mountTutorialButton(host, moduleCode, businessUnitId, { floating = false } = {}) {
  // Bersihkan tombol melayang milik halaman SEBELUMNYA lebih dulu, sebelum
  // pemeriksaan apa pun. Kalau dibersihkan belakangan, berpindah dari modul
  // yang punya video ke modul yang tidak punya akan meninggalkan tombol lama
  // menempel di layar -- dan tombol itu memutar tutorial modul yang salah.
  if (floating) clearFloatingTutorialButton();

  // Mode melayang tidak butuh host (menempel ke body); mode inline wajib punya.
  if ((!floating && !host) || !moduleCode || !businessUnitId) return;

  let videos = [];
  try {
    videos = await listTutorials(moduleCode, businessUnitId);
  } catch (error) {
    // Tutorial itu pelengkap. Kalau gagal dibaca, modulnya tetap harus jalan.
    console.warn('[tutorial] gagal memuat:', error.message ?? error);
    return;
  }
  if (!videos.length) return;

  pasangGaya();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = floating ? 'tutorial-btn tutorial-btn-float' : 'tutorial-btn';
  btn.innerHTML = `❓ <span>Tutorial${videos.length > 1 ? ` (${videos.length})` : ''}</span>`;
  btn.title = 'Lihat video cara memakai modul ini';
  btn.addEventListener('click', () => bukaDialog(videos));

  if (floating) document.body.appendChild(btn);
  else host.appendChild(btn);
}

function bukaDialog(videos) {
  pasangGaya();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" style="max-width:640px">
      <h3 class="modal-title">📺 Tutorial</h3>
      <div id="tut-body"></div>
      <div class="modal-actions">
        <button type="button" class="primary btn-inline" id="tut-close">Tutup</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  const body = overlay.querySelector('#tut-body');

  function tutup() {
    // Hapus iframe dulu supaya audionya berhenti; sebagian browser terus
    // memutar suara kalau elemennya masih ada saat overlay dilepas.
    overlay.querySelectorAll('iframe').forEach((f) => f.remove());
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
    document.removeEventListener('keydown', onEsc);
  }
  function onEsc(e) {
    if (e.key === 'Escape') tutup();
  }
  document.addEventListener('keydown', onEsc);
  overlay.querySelector('#tut-close').addEventListener('click', tutup);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) tutup();
  });

  // Satu video -> langsung putar, tidak perlu memaksa orang memilih dulu.
  if (videos.length === 1) putar(body, videos[0], null);
  else daftar(body, videos);
}

function daftar(body, videos) {
  body.innerHTML = `
    <div class="tutorial-list">
      ${videos
        .map(
          (v, i) => `
        <button class="tutorial-item" data-i="${i}">
          <img src="${escapeHtml(thumbUrl(v.youtube_id))}" alt="" loading="lazy" />
          <span>
            <span class="t-title">${escapeHtml(v.title)}</span>
            ${v.description ? `<span class="t-desc">${escapeHtml(v.description)}</span>` : ''}
          </span>
        </button>`
        )
        .join('')}
    </div>
  `;
  body.querySelectorAll('.tutorial-item').forEach((b) =>
    b.addEventListener('click', () => putar(body, videos[Number(b.dataset.i)], videos))
  );
}

function putar(body, video, semua) {
  body.innerHTML = `
    ${semua ? `<button id="tut-back" style="margin-bottom:10px">← Daftar video</button>` : ''}
    <h3 style="margin:0 0 6px;font-size:1rem">${escapeHtml(video.title)}</h3>
    ${video.description ? `<p style="font-size:0.82rem;color:var(--color-text-muted);margin:0 0 10px">${escapeHtml(video.description)}</p>` : ''}
    <div class="tutorial-player">
      <iframe src="${escapeHtml(embedUrl(video.youtube_id))}"
        title="${escapeHtml(video.title)}"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
        referrerpolicy="strict-origin-when-cross-origin"
        allowfullscreen></iframe>
    </div>
    <p style="font-size:0.76rem;color:var(--color-text-muted);margin:8px 0 0">
      Videonya tidak muncul? <a href="${escapeHtml(watchUrl(video.youtube_id))}" target="_blank" rel="noopener">Buka di YouTube</a>
      — sebagian jaringan memblokir pemutar tertanam.
    </p>
  `;
  body.querySelector('#tut-back')?.addEventListener('click', () => daftar(body, semua));
}
