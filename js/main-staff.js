import { signIn, signOut, getSession, onAuthStateChange, getCurrentUserContext, changeOwnPassword } from './auth/auth.js';
import { getActiveModules, getModuleRenderer, registerModule } from './core/module-loader.js';
import { getModuleIcon } from './core/module-icons.js';
import { toast, confirmDialog, formDialog } from './core/ui.js';
import { renderAttendancePage } from './modules/attendance/attendance.page.js';
import { renderLeavePage } from './modules/leave/leave.page.js';

registerModule('attendance', renderAttendancePage);
registerModule('leave', renderLeavePage);

const app = document.getElementById('app');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Diam-diam gagal (misal dibuka lewat http:// biasa) -- app tetap jalan normal tanpa push.
  });
}

async function bootstrap() {
  const session = await getSession();
  if (session?.user) {
    await renderShell();
  } else {
    renderLogin();
  }

  onAuthStateChange((_event, newSession) => {
    if (newSession?.user) {
      renderShell();
    } else {
      renderLogin();
    }
  });
}

function renderLogin(errorMessage = '') {
  app.innerHTML = `
    <section class="auth-page">
      <form class="auth-card" id="login-form">
        <img src="images/logo.svg" alt="Berjaya Hub" class="auth-logo" onerror="this.style.display='none'" />
        <h1>Berjaya Hub — Staff</h1>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" type="email" required autocomplete="username" />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" type="password" required autocomplete="current-password" />
        </div>
        <button class="primary" type="submit">Masuk</button>
        ${errorMessage ? `<p class="error-text">${errorMessage}</p>` : ''}
      </form>
    </section>
  `;

  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    try {
      await signIn(email, password);
      // onAuthStateChange akan otomatis render shell setelah login berhasil
    } catch (error) {
      renderLogin(error.message ?? 'Gagal login. Periksa email/password.');
    }
  });
}

async function renderShell() {
  app.innerHTML = `<p style="padding:24px">Memuat data staff...</p>`;

  let context;
  try {
    context = await getCurrentUserContext();
  } catch (error) {
    app.innerHTML = `<p style="padding:24px" class="error-text">Gagal memuat data: ${error.message}</p>`;
    return;
  }

  if (!context || context.scopes.length === 0) {
    app.innerHTML = `
      <div style="padding:24px">
        <p>Akun kamu belum terhubung ke Business Unit manapun. Hubungi admin.</p>
        <button class="primary" id="btn-logout" style="max-width:200px">Keluar</button>
      </div>
    `;
    document.getElementById('btn-logout').addEventListener('click', signOut);
    return;
  }

  // BU unik dari seluruh scope staff (untuk switcher kalau lebih dari satu BU).
  const seen = new Map();
  for (const s of context.scopes) {
    if (s.business_unit_id && !seen.has(s.business_unit_id)) {
      seen.set(s.business_unit_id, {
        id: s.business_unit_id,
        name: s.business_units?.name ?? 'BU',
        theme_color: s.business_units?.theme_color,
        logo_url: s.business_units?.logo_url
      });
    }
  }
  const availableBUs = [...seen.values()];

  let activeBuId = null;
  try {
    activeBuId = localStorage.getItem('staff_active_bu');
  } catch {
    // localStorage bisa diblokir -> pakai default
  }
  if (!availableBUs.some((b) => b.id === activeBuId)) {
    activeBuId = availableBUs[0]?.id ?? context.scopes[0].business_unit_id;
  }

  renderShellForBu(context, availableBUs, activeBuId);
}

async function renderShellForBu(context, availableBUs, activeBuId) {
  const activeBu = availableBUs.find((b) => b.id === activeBuId) || null;
  // Scope untuk BU aktif: utamakan yang ditandai "tempat kerja utama".
  const scopesInBu = context.scopes.filter((s) => s.business_unit_id === activeBuId);
  const activeScope = scopesInBu.find((s) => s.is_primary) ?? scopesInBu[0] ?? context.scopes[0];

  app.innerHTML = `<p style="padding:24px">Memuat modul...</p>`;
  const modules = await getActiveModules(activeBuId);
  const moduleCtx = {
    userId: context.profile.id,
    businessUnitId: activeBuId,
    outletId: activeScope?.outlet_id ?? null
  };

  applyBuTheme(activeBu);

  const logoSrc = activeBu?.logo_url || 'images/logo.svg';
  const buLine =
    availableBUs.length > 1
      ? `<select class="topbar-bu-select" id="bu-switcher-staff">
           ${availableBUs.map((b) => `<option value="${b.id}"${b.id === activeBuId ? ' selected' : ''}>${b.name}</option>`).join('')}
         </select>`
      : `<div class="topbar-bu">${activeBu?.name ?? ''}</div>`;

  // Tampilan tanpa menu samping: header atas + konten kartu.
  app.innerHTML = `
    <header class="staff-topbar">
      <img src="${logoSrc}" alt="" class="topbar-logo" onerror="this.style.display='none'" />
      <div class="topbar-info">
        <div class="topbar-name">${context.profile.full_name}</div>
        ${buLine}
      </div>
      <button class="topbar-btn" id="btn-home-top" title="Beranda" aria-label="Beranda">🏠</button>
      <button class="topbar-btn" id="btn-change-password" title="Ubah Password" aria-label="Ubah Password">🔑</button>
      <button class="topbar-btn" id="btn-logout" title="Keluar" aria-label="Keluar">⎋</button>
    </header>
    <main class="staff-main" id="module-content"></main>
  `;

  document.getElementById('bu-switcher-staff')?.addEventListener('change', (e) => {
    try {
      localStorage.setItem('staff_active_bu', e.target.value);
    } catch {
      // abaikan kalau localStorage diblokir
    }
    renderShellForBu(context, availableBUs, e.target.value);
  });

  document.getElementById('btn-home-top').addEventListener('click', () => renderHome(context, modules, moduleCtx));

  document.getElementById('btn-logout').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Keluar dari akun?',
      message: 'Kamu perlu login lagi untuk masuk berikutnya.',
      confirmText: 'Keluar',
      danger: true
    });
    if (ok) signOut();
  });

  document.getElementById('btn-change-password').addEventListener('click', async () => {
    const values = await formDialog({
      title: 'Ubah Password',
      description: 'Masukkan password baru untuk akun kamu.',
      fields: [
        { name: 'new_password', label: 'Password baru', type: 'password', required: true, minlength: 6, placeholder: 'Minimal 6 karakter' }
      ],
      submitText: 'Simpan'
    });
    if (!values) return;
    try {
      await changeOwnPassword(values.new_password);
      toast('Password berhasil diubah.', 'success');
    } catch (error) {
      toast(error.message ?? 'Gagal ubah password.', 'error');
    }
  });

  // Beranda card-based sebagai tampilan awal
  renderHome(context, modules, moduleCtx);
}

function renderHome(context, modules, moduleCtx) {
  const content = document.getElementById('module-content');
  const firstName = (context.profile.full_name || '').split(' ')[0] || 'Halo';
  content.innerHTML = `
    <div class="staff-greeting">
      <h1>Halo, ${firstName} 👋</h1>
      <p>Pilih menu di bawah untuk mulai.</p>
    </div>
    <div class="card-grid">
      ${
        modules
          .map(
            (mod) => `
          <button class="module-card" data-module="${mod.code}">
            <span class="module-card-icon">${getModuleIcon(mod.code)}</span>
            <span class="module-card-label">${mod.name}</span>
          </button>`
          )
          .join('') || '<p>Belum ada modul aktif untuk BU kamu. Hubungi admin.</p>'
      }
    </div>
  `;

  content.querySelectorAll('[data-module]').forEach((card) => {
    card.addEventListener('click', () => openModule(card.dataset.module, context, modules, moduleCtx));
  });
}

function openModule(code, context, modules, moduleCtx) {
  const content = document.getElementById('module-content');
  const mod = modules.find((m) => m.code === code);
  content.innerHTML = `
    <div class="module-header">
      <button class="btn-home" id="btn-back-home">🏠 Beranda</button>
      <span class="module-header-title">${mod?.name ?? ''}</span>
    </div>
    <div id="module-body"></div>
  `;
  document.getElementById('btn-back-home').addEventListener('click', () => renderHome(context, modules, moduleCtx));

  const renderer = getModuleRenderer(code);
  const body = document.getElementById('module-body');
  if (renderer) {
    renderer(body, moduleCtx);
  } else {
    body.innerHTML = `<p>Modul "${code}" belum dibangun.</p>`;
  }
}

function applyBuTheme(businessUnit) {
  const color = businessUnit?.theme_color;
  if (color) {
    document.documentElement.style.setProperty('--color-primary', color);
    document.documentElement.style.setProperty('--color-primary-hover', color);
  }
}

bootstrap();
