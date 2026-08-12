// =========================================================
// Shell halaman "grup": satu menu Admin Portal berisi beberapa modul
// sebagai sub-tab. Tab yang muncul hanya yang modulnya aktif untuk BU.
// =========================================================

import { mountTutorialButton } from './tutorial-button.js';
import { loadingHtml } from './loading.js';
import { kepala, ekor, gabung } from './jalur-layar.js';

/**
 * @param container elemen konten
 * @param ctx       { businessUnitId, isAdmin, layarAwal?, catatLayar? }
 * @param title     judul halaman grup
 * @param tabs      [{ code, label, render(container, ctx) }]
 *
 * `layarAwal` & `catatLayar` dipakai untuk memulihkan tempat terakhir setelah
 * halaman dimuat ulang (mis. OS membuang halaman ini waktu orangnya membuka
 * aplikasi lain). Grup ini mengambil POTONGAN PERTAMA jalur untuk dirinya
 * sendiri dan meneruskan sisanya ke tab yang dipilih — jadi modul di dalamnya
 * bisa punya tab sendiri lagi tanpa grup ini perlu tahu apa-apa soal itu.
 */
export async function renderGroupPage(container, ctx, title, tabs) {
  if (!tabs.length) {
    container.innerHTML = `<h1>${title}</h1><p style="color:var(--color-text-muted)">Belum ada modul aktif di grup ini.</p>`;
    return;
  }
  if (tabs.length === 1) {
    // Satu tab saja -> render langsung tanpa tab bar. Jalurnya diteruskan APA
    // ADANYA: tanpa tab bar, grup ini tidak memakan satu potongan pun, dan
    // memakannya akan membuat modul di dalamnya menerima sisa yang salah.
    await tabs[0].render(container, ctx);
    mountTutorialButton(null, tabs[0].code, ctx.businessUnitId, { floating: true });
    return;
  }

  // Tab yang dipulihkan harus DIPERIKSA masih ada. Daftar tab bergantung modul
  // yang aktif untuk BU dan hak akses orangnya — keduanya bisa berubah setelah
  // tempat itu disimpan. Tanpa pemeriksaan ini, kembali dari aplikasi lain
  // mendarat di halaman kosong yang tidak punya tombol keluar.
  const diminta = kepala(ctx.layarAwal);
  const awal = tabs.some((t) => t.code === diminta) ? diminta : tabs[0].code;
  const sisaAwal = awal === diminta ? ekor(ctx.layarAwal) : null;

  container.innerHTML = `
    <div class="tab-bar group-tabs">
      ${tabs.map((t) => `<button class="tab-btn ${t.code === awal ? 'active' : ''}" data-gtab="${t.code}">${t.label}</button>`).join('')}
    </div>
    <div id="group-content" class="fade-in"></div>
  `;
  const content = container.querySelector('#group-content');

  async function show(code, sisa = null) {
    container.querySelectorAll('[data-gtab]').forEach((b) => b.classList.toggle('active', b.dataset.gtab === code));
    const tab = tabs.find((t) => t.code === code);
    if (!tab) return;
    ctx.catatLayar?.(code);
    content.classList.remove('fade-in');
    void content.offsetWidth; // restart animasi
    content.classList.add('fade-in');
    content.innerHTML = loadingHtml('Memuat…', { baris: 5 });
    try {
      await tab.render(content, {
        ...ctx,
        layarAwal: sisa,
        // Potongan dari modul di dalam selalu ditulis DI BAWAH kode tab ini,
        // jadi berpindah tab otomatis membuang sub-layar tab sebelumnya —
        // yang memang tidak berlaku lagi di sini.
        catatLayar: (sub) => ctx.catatLayar?.(gabung(code, sub))
      });
    } catch (error) {
      content.innerHTML = `<p class="error-text">${error?.message ?? error}</p>`;
    }
    // Tutorial mengikuti TAB yang aktif, bukan grupnya: satu menu grup bisa
    // berisi beberapa modul yang videonya berbeda-beda.
    mountTutorialButton(null, tab.code, ctx.businessUnitId, { floating: true });
  }

  // Ketukan selalu mulai dari atas modulnya (sisa = null); hanya pemulihan yang
  // membawa sub-layar.
  container.querySelectorAll('[data-gtab]').forEach((btn) => btn.addEventListener('click', () => show(btn.dataset.gtab)));
  await show(awal, sisaAwal);
}
