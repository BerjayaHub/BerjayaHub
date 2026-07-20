import { signIn, signOut, getSession, onAuthStateChange, getCurrentUserContext } from './auth/auth.js';
import { getActiveModules, getModuleRenderer, registerModule } from './core/module-loader.js';
import { renderAttendancePage } from './modules/attendance/attendance.page.js';

registerModule('attendance', renderAttendancePage);

const app = document.getElementById('app');

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

  const menuItems = modules
    .map((mod) => `<li><a href="#" data-module="${mod.code}">${mod.name}</a></li>`)
    .join('');

  app.innerHTML = `
    <div class="app-shell">
      <nav class="app-nav">
        <h2>${context.profile.full_name}</h2>
        <p style="font-size:0.8rem;color:var(--color-text-muted)">${activeScope.business_units?.name ?? ''}</p>
        <ul>${menuItems || '<li>Belum ada modul aktif</li>'}</ul>
        <button class="primary" id="btn-logout" style="margin-top:16px">Keluar</button>
      </nav>
      <main class="app-content" id="module-content">
        <p>Pilih modul di sebelah kiri.</p>
      </main>
    </div>
  `;

  document.getElementById('btn-logout').addEventListener('click', signOut);

  document.querySelectorAll('[data-module]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const code = event.target.dataset.module;
      const renderer = getModuleRenderer(code);
      const content = document.getElementById('module-content');
      if (renderer) {
        renderer(content, { userId: context.profile.id, businessUnitId: activeScope.business_unit_id, outletId: activeScope.outlet_id });
      } else {
        content.innerHTML = `<p>Modul "${code}" belum dibangun.</p>`;
      }
    });
  });
}

bootstrap();
