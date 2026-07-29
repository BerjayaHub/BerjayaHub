// =========================================================
// Shell halaman "grup": satu menu Admin Portal berisi beberapa modul
// sebagai sub-tab. Tab yang muncul hanya yang modulnya aktif untuk BU.
// =========================================================

import { mountTutorialButton } from './tutorial-button.js';

/**
 * @param container elemen konten
 * @param ctx       { businessUnitId, isAdmin }
 * @param title     judul halaman grup
 * @param tabs      [{ code, label, render(container, ctx) }]
 */
export async function renderGroupPage(container, ctx, title, tabs) {
  if (!tabs.length) {
    container.innerHTML = `<h1>${title}</h1><p style="color:var(--color-text-muted)">Belum ada modul aktif di grup ini.</p>`;
    return;
  }
  if (tabs.length === 1) {
    // Satu tab saja -> render langsung tanpa tab bar.
    await tabs[0].render(container, ctx);
    mountTutorialButton(null, tabs[0].code, ctx.businessUnitId, { floating: true });
    return;
  }

  container.innerHTML = `
    <div class="tab-bar group-tabs">
      ${tabs.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-gtab="${t.code}">${t.label}</button>`).join('')}
    </div>
    <div id="group-content" class="fade-in"></div>
  `;
  const content = container.querySelector('#group-content');

  async function show(code) {
    container.querySelectorAll('[data-gtab]').forEach((b) => b.classList.toggle('active', b.dataset.gtab === code));
    const tab = tabs.find((t) => t.code === code);
    if (!tab) return;
    content.classList.remove('fade-in');
    void content.offsetWidth; // restart animasi
    content.classList.add('fade-in');
    content.innerHTML = `<p style="color:var(--color-text-muted)">Memuat...</p>`;
    try {
      await tab.render(content, ctx);
    } catch (error) {
      content.innerHTML = `<p class="error-text">${error?.message ?? error}</p>`;
    }
    // Tutorial mengikuti TAB yang aktif, bukan grupnya: satu menu grup bisa
    // berisi beberapa modul yang videonya berbeda-beda.
    mountTutorialButton(null, tab.code, ctx.businessUnitId, { floating: true });
  }

  container.querySelectorAll('[data-gtab]').forEach((btn) => btn.addEventListener('click', () => show(btn.dataset.gtab)));
  await show(tabs[0].code);
}
