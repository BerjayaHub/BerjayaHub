import { signIn, signOut, getSession, onAuthStateChange, getCurrentUserContext, changeOwnPassword } from './auth/auth.js';
import { getActiveModules, getModuleRenderer, registerModule } from './core/module-loader.js';
import { getModuleIcon } from './core/module-icons.js';
import { toast, confirmDialog, formDialog } from './core/ui.js';
import { renderAttendancePage } from './modules/attendance/attendance.page.js';

registerModule('attendance', renderAttendancePage);

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

  // Fase 0: ambil BU pertama dari scope staff. Nanti kalau staff punya
  // lebih dari 1 BU, di sini akan ditambahkan selector BU.
  const activeScope = context.scopes[0];
  const modules = await getActiveModules(activeScope.business_unit_id);
  const moduleCtx = {
    userId: context.profile.id,
    businessUnitId: activeScope.business_unit_id,
    outletId: activeScope.outlet_id
  };

  applyBuTheme(activeScope.business_units);

  const logoSrc = activeScope.business_units?.logo_url || 'images/logo.svg';

  // Tampilan tanpa menu samping: header atas + konten kartu.
  app.innerHTML = `
    <header class="staff-topbar">
      <img src="${logoSrc}" alt="" class="topbar-logo" onerror="this.style.display='none'" />
      <div class="topbar-info">
        <div class="topbar-name">${context.profile.full_name}</div>
        <div class="topbar-bu">${activeScope.business_units?.name ?? ''}</div>
      </div>
      <button class="topbar-btn" id="btn-home-top" title="Beranda" aria-label="Beranda">🏠</button>
      <button class="topbar-btn" id="btn-change-password" title="Ubah Password" aria-label="Ubah Password">🔑</button>
      <button class="topbar-btn" id="btn-logout" title="Keluar" aria-label="Keluar">⎋</button>
    </header>
    <main class="staff-main" id="module-content"></main>
  `;

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
