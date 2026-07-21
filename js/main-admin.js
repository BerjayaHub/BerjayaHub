import { signIn, signOut, getSession, onAuthStateChange, getCurrentUserContext } from './auth/auth.js';
import { getActiveModules, getModuleRenderer, registerModule } from './core/module-loader.js';
import { renderMasterUserPage } from './modules/master-user/master-user.page.js';
import { renderAttendanceAdminPage } from './modules/attendance/attendance.admin.page.js';

const app = document.getElementById('app');
const ADMIN_ROLES = ['super_admin', 'bu_admin', 'outlet_admin'];

// Modul "core" admin: selalu tampil untuk admin, tidak tergantung toggle bu_modules
// (beda dengan modul operasional seperti presensi/inventory yang di-toggle per BU)
registerModule('master_user', renderMasterUserPage);
registerModule('attendance', renderAttendanceAdminPage);
const CORE_ADMIN_MENU = [{ code: 'master_user', name: 'Master User' }];

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

  const allMenu = [...CORE_ADMIN_MENU, ...modules];
  const menuItems = allMenu
    .map((mod) => `<li><a href="#" data-module="${mod.code}">${mod.name}</a></li>`)
    .join('');

  app.innerHTML = `
    <div class="app-shell">
      <button class="nav-toggle" id="btn-nav-toggle" aria-label="Buka menu">☰</button>
      <nav class="app-nav" id="app-nav">
        <div class="nav-brand">
          <img src="images/logo.svg" alt="" class="nav-logo" onerror="this.style.display='none'" />
          <div>
            <div style="font-weight:600">${context.profile.full_name}</div>
            <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0">
              ${activeScope.role} — ${activeScope.business_units?.name ?? 'Semua BU'}
            </p>
          </div>
        </div>
        <ul>${menuItems || '<li>Belum ada modul aktif</li>'}</ul>
        <button class="primary" id="btn-logout" style="margin-top:16px">Keluar</button>
      </nav>
      <main class="app-content" id="module-content">
        <p>Pilih modul di sebelah kiri.</p>
      </main>
    </div>
  `;

  document.getElementById('btn-nav-toggle').addEventListener('click', () => {
    document.getElementById('app-nav').classList.toggle('open');
  });

  document.getElementById('btn-logout').addEventListener('click', signOut);

  document.querySelectorAll('[data-module]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      document.getElementById('app-nav')?.classList.remove('open');
      const code = event.target.dataset.module;
      const renderer = getModuleRenderer(code);
      const content = document.getElementById('module-content');
      if (renderer) {
        renderer(content, { businessUnitId: activeScope.business_unit_id, isAdmin: true });
      } else {
        content.innerHTML = `<p>Modul admin "${code}" belum dibangun.</p>`;
      }
    });
  });
}

bootstrap();
