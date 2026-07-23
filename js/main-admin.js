import { signIn, signOut, getSession, onAuthStateChange, getCurrentUserContext, changeOwnPassword } from './auth/auth.js';
import { getActiveModules, getModuleRenderer, registerModule } from './core/module-loader.js';
import { getModuleIcon } from './core/module-icons.js';
import { renderMasterUserPage } from './modules/master-user/master-user.page.js';
import { renderAttendanceAdminPage } from './modules/attendance/attendance.admin.page.js';
import { renderAdminDashboard } from './modules/dashboard/dashboard.admin.page.js';
import { renderBuAppearancePage } from './modules/organization/bu-appearance.admin.page.js';

const app = document.getElementById('app');
const ADMIN_ROLES = ['super_admin', 'bu_admin', 'outlet_admin'];

// Modul "core" admin: selalu tampil untuk admin, tidak tergantung toggle bu_modules
// (beda dengan modul operasional seperti presensi/inventory yang di-toggle per BU)
registerModule('dashboard', renderAdminDashboard);
registerModule('master_user', renderMasterUserPage);
registerModule('bu_appearance', renderBuAppearancePage);
registerModule('attendance', renderAttendanceAdminPage);
const CORE_ADMIN_MENU = [
  { code: 'dashboard', name: 'Dashboard' },
  { code: 'master_user', name: 'Master User' },
  { code: 'bu_appearance', name: 'Tampilan BU' }
];

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
        <h1>Berjaya Hub — Admin Portal</h1>
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
    } catch (error) {
      renderLogin(error.message ?? 'Gagal login. Periksa email/password.');
    }
  });
}

async function renderShell() {
  app.innerHTML = `<p style="padding:24px">Memuat data admin...</p>`;

  let context;
  try {
    context = await getCurrentUserContext();
  } catch (error) {
    app.innerHTML = `<p style="padding:24px" class="error-text">Gagal memuat data: ${error.message}</p>`;
    return;
  }

  const adminScopes = (context?.scopes ?? []).filter((s) => ADMIN_ROLES.includes(s.role));

  if (!context || adminScopes.length === 0) {
    app.innerHTML = `
      <div style="padding:24px">
        <p>Akun kamu tidak punya akses admin. Hubungi Super Admin.</p>
        <button class="primary" id="btn-logout" style="max-width:200px">Keluar</button>
      </div>
    `;
    document.getElementById('btn-logout').addEventListener('click', signOut);
    return;
  }

  // Fase 0: ambil BU admin pertama. Nanti ditambahkan BU switcher
  // supaya bu_admin yang pegang lebih dari 1 BU bisa pindah konteks.
  const activeScope = adminScopes[0];
  const modules = activeScope.role === 'super_admin' && !activeScope.business_unit_id
    ? []
    : await getActiveModules(activeScope.business_unit_id);

  applyBuTheme(activeScope.business_units);

  const allMenu = [...CORE_ADMIN_MENU, ...modules];
  const menuItems = allMenu
    .map((mod) => `<li><a href="#" data-module="${mod.code}">${getModuleIcon(mod.code)} ${mod.name}</a></li>`)
    .join('');

  const logoSrc = activeScope.business_units?.logo_url || 'images/logo.svg';

  app.innerHTML = `
    <div class="app-shell">
      <button class="nav-toggle" id="btn-nav-toggle" aria-label="Buka menu">☰</button>
      <nav class="app-nav" id="app-nav">
        <div class="nav-brand">
          <img src="${logoSrc}" alt="" class="nav-logo" onerror="this.style.display='none'" />
          <div>
            <div style="font-weight:600">${context.profile.full_name}</div>
            <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0">
              ${activeScope.role} — ${activeScope.business_units?.name ?? 'Semua BU'}
            </p>
          </div>
        </div>
        <ul>${menuItems || '<li>Belum ada modul aktif</li>'}</ul>
        <button id="btn-change-password" style="margin-top:16px;width:100%">Ubah Password</button>
        <div id="change-password-wrap"></div>
        <button class="primary" id="btn-logout" style="margin-top:8px">Keluar</button>
      </nav>
      <main class="app-content" id="module-content">
        <p>Memuat dashboard...</p>
      </main>
    </div>
  `;

  document.getElementById('btn-nav-toggle').addEventListener('click', () => {
    document.getElementById('app-nav').classList.toggle('open');
  });

  document.getElementById('btn-logout').addEventListener('click', signOut);

  document.getElementById('btn-change-password').addEventListener('click', () => {
    const wrap = document.getElementById('change-password-wrap');
    if (wrap.innerHTML) {
      wrap.innerHTML = '';
      return;
    }
    wrap.innerHTML = `
      <form id="change-password-form" style="margin-top:8px">
        <div class="field" style="margin-bottom:6px">
          <input type="password" name="new_password" placeholder="Password baru (min 6 karakter)" minlength="6" required />
        </div>
        <button class="primary" type="submit" style="min-height:36px">Simpan</button>
        <p class="error-text" id="change-password-error" style="margin:4px 0 0"></p>
        <p id="change-password-success" style="color:var(--color-primary);font-size:0.85rem;margin:4px 0 0"></p>
      </form>
    `;
    document.getElementById('change-password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const newPassword = e.target.new_password.value;
      try {
        await changeOwnPassword(newPassword);
        document.getElementById('change-password-error').textContent = '';
        document.getElementById('change-password-success').textContent = 'Password berhasil diubah.';
        e.target.reset();
      } catch (error) {
        document.getElementById('change-password-success').textContent = '';
        document.getElementById('change-password-error').textContent = error.message ?? 'Gagal ubah password.';
      }
    });
  });

  document.querySelectorAll('[data-module]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      document.getElementById('app-nav')?.classList.remove('open');
      const code = event.target.closest('[data-module]').dataset.module;
      openModule(code, activeScope);
    });
  });

  // Dashboard sebagai tampilan awal begitu login
  openModule('dashboard', activeScope);
}

function openModule(code, activeScope) {
  const renderer = getModuleRenderer(code);
  const content = document.getElementById('module-content');
  if (renderer) {
    renderer(content, { businessUnitId: activeScope.business_unit_id, isAdmin: true });
  } else {
    content.innerHTML = `<p>Modul admin "${code}" belum dibangun.</p>`;
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
