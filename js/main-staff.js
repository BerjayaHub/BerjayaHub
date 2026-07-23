import { signIn, signOut, getSession, onAuthStateChange, getCurrentUserContext, changeOwnPassword } from './auth/auth.js';
import { getActiveModules, getModuleRenderer, registerModule } from './core/module-loader.js';
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

  const menuItems = modules
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
            <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0">${activeScope.business_units?.name ?? ''}</p>
          </div>
        </div>
        <ul>${menuItems || '<li>Belum ada modul aktif</li>'}</ul>
        <button id="btn-change-password" style="margin-top:16px;width:100%">Ubah Password</button>
        <div id="change-password-wrap"></div>
        <button class="primary" id="btn-logout" style="margin-top:8px">Keluar</button>
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
