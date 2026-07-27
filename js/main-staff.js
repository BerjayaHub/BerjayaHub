import { signIn, signOut, getSession, onAuthStateChange, getCurrentUserContext, changeOwnPassword } from './auth/auth.js';
import { getActiveModules, getModuleRenderer, registerModule, getMyAllowedModules, getModulesActiveInAnyBu } from './core/module-loader.js';
import { getModuleIcon } from './core/module-icons.js';
import { toast, confirmDialog, formDialog } from './core/ui.js';
import { renderAttendancePage } from './modules/attendance/attendance.page.js';
import { renderLeavePage } from './modules/leave/leave.page.js';
import { renderCleaningPage } from './modules/cleaning/cleaning.page.js';
import { renderInventoryPage } from './modules/inventory/inventory.page.js';
import { renderProductStaffPage } from './modules/product/product.staff.page.js';
import { renderProductionPage } from './modules/production/production.page.js';
import { renderDispatchPage } from './modules/dispatch/dispatch.page.js';
import { renderMenuPage } from './modules/menu/menu.page.js';
import { renderSalesPage } from './modules/sales/sales.page.js';
import { renderCashPage } from './modules/cash/cash.page.js';
import { renderShiftPage } from './modules/shift/shift.page.js';
import { renderProfilePage, initials } from './modules/profile/profile.page.js';
import { getStaffPhotoUrl } from './modules/profile/profile.service.js';
import { getMyTodaySession } from './modules/attendance/attendance.service.js';

registerModule('attendance', renderAttendancePage);
registerModule('leave', renderLeavePage);
registerModule('cleaning_checklist', renderCleaningPage);
registerModule('inventory', renderInventoryPage);
registerModule('master_product', renderProductStaffPage);
registerModule('production', renderProductionPage);
registerModule('dispatch', renderDispatchPage);
registerModule('menu', renderMenuPage);
registerModule('sales', renderSalesPage);
registerModule('cash_ledger', renderCashPage);
registerModule('shift', renderShiftPage);

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
  // Modul aktif BU, lalu disaring lagi oleh akses per user (kalau diatur admin).
  const modules = await getMyAllowedModules(activeBuId, await getActiveModules(activeBuId)).catch(() => []);

  // Kas melekat pada USER, bukan BU (migration 0040) — menunya harus tetap ada
  // walau BU yang sedang aktif tidak mengaktifkan modul Kas, asalkan salah satu
  // BU milik user mengaktifkannya. Kalau tidak, saldo pribadi jadi tidak
  // terjangkau hanya karena berpindah BU.
  if (!modules.some((m) => m.code === 'cash_ledger')) {
    const lintasBu = await getModulesActiveInAnyBu(availableBUs.map((b) => b.id)).catch(() => []);
    const kas = lintasBu.find((m) => m.code === 'cash_ledger');
    if (kas) modules.push(kas);
  }
  const moduleCtx = {
    userId: context.profile.id,
    businessUnitId: activeBuId,
    outletId: activeScope?.outlet_id ?? null,
    outletRole: activeScope?.outlets?.outlet_role ?? null
  };

  applyBuTheme(activeBu);

  const logoSrc = activeBu?.logo_url || 'images/logo.svg';
  const buLine =
    availableBUs.length > 1
      ? `<select class="topbar-bu-select" id="bu-switcher-staff">
           ${availableBUs.map((b) => `<option value="${b.id}"${b.id === activeBuId ? ' selected' : ''}>${b.name}</option>`).join('')}
         </select>`
      : `<div class="topbar-bu">${activeBu?.name ?? ''}</div>`;

  // Pintasan mode (Staff App ↔ Admin Portal) hanya untuk akun ber-peran admin.
  const ADMIN_ROLES = ['super_admin', 'bu_admin', 'outlet_admin'];
  const isAdmin = (context.scopes ?? []).some((s) => ADMIN_ROLES.includes(s.role));

  // Tampilan tanpa menu samping: header atas + konten kartu.
  app.innerHTML = `
    <header class="staff-topbar">
      <div class="topbar-main">
        <img src="${logoSrc}" alt="" class="topbar-logo" onerror="this.style.display='none'" />
        <div class="topbar-info">
          <div class="topbar-name">${context.profile.full_name}</div>
          ${buLine}
        </div>
        <button class="topbar-btn" id="btn-home-top" title="Beranda" aria-label="Beranda">🏠</button>
        <button class="topbar-btn" id="btn-profile" title="Profil Saya" aria-label="Profil Saya">👤</button>
        <button class="topbar-btn" id="btn-change-password" title="Ubah Password" aria-label="Ubah Password">🔑</button>
        <button class="topbar-btn" id="btn-logout" title="Keluar" aria-label="Keluar">⎋</button>
      </div>
      ${
        isAdmin
          ? `<div class="app-switch app-switch-on-primary" role="tablist" aria-label="Mode aplikasi">
              <button class="active" aria-current="page"><span>📱</span> Staff App</button>
              <button id="btn-to-admin"><span>🛠️</span> Admin Portal</button>
            </div>`
          : ''
      }
    </header>
    <main class="staff-main" id="module-content"></main>
  `;

  document.getElementById('btn-to-admin')?.addEventListener('click', () => {
    window.location.href = './admin.html';
  });

  document.getElementById('bu-switcher-staff')?.addEventListener('change', (e) => {
    try {
      localStorage.setItem('staff_active_bu', e.target.value);
    } catch {
      // abaikan kalau localStorage diblokir
    }
    renderShellForBu(context, availableBUs, e.target.value);
  });

  document.getElementById('btn-home-top').addEventListener('click', () => renderHome(context, modules, moduleCtx));

  document.getElementById('btn-profile').addEventListener('click', () => {
    const content = document.getElementById('module-content');
    content.innerHTML = `
      <div class="module-header">
        <button class="btn-home" id="btn-back-home">🏠 Beranda</button>
        <span class="module-header-title">Profil Saya</span>
      </div>
      <div id="module-body"></div>`;
    document.getElementById('btn-back-home').addEventListener('click', () => renderHome(context, modules, moduleCtx));
    renderProfilePage(document.getElementById('module-body'), {
      onProfileUpdated: async () => {
        // Segarkan foto/nama di beranda setelah profil diubah.
        try {
          const fresh = await getCurrentUserContext();
          if (fresh) context.profile = fresh.profile;
        } catch {
          /* abaikan */
        }
      }
    });
  });

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

async function renderHome(context, modules, moduleCtx) {
  const content = document.getElementById('module-content');
  const firstName = (context.profile.full_name || '').split(' ')[0] || 'Halo';
  // Hanya tampilkan modul yang punya halaman Staff App + sesuai peran outlet:
  // Produksi hanya di Central Kitchen; Menu hanya di outlet non-CK (yang menjual).
  const role = moduleCtx.outletRole;
  const staffModules = modules.filter((mod) => {
    if (!getModuleRenderer(mod.code)) return false;
    if (mod.code === 'production') return !role || role === 'central_kitchen';
    if (mod.code === 'menu' || mod.code === 'sales') return !role || role !== 'central_kitchen';
    return true;
  });
  const hasAttendance = staffModules.some((m) => m.code === 'attendance');
  content.innerHTML = `
    <div class="home-hero">
      <div class="staff-greeting">
        <div class="hero-avatar" id="hero-avatar">${initials(context.profile.full_name)}</div>
        <div>
          <h1>Halo, ${firstName} 👋</h1>
          <p>Pilih menu di bawah untuk mulai.</p>
        </div>
      </div>
      ${hasAttendance ? `<button class="att-mini" id="att-mini"><div class="att-mini-head">🕐 Presensi Hari Ini</div><div class="att-mini-body" id="att-mini-body">Memuat…</div></button>` : ''}
    </div>
    <div class="card-grid">
      ${
        staffModules
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

  // Foto staff di sebelah sapaan (fallback: inisial nama).
  if (context.profile.photo_path) {
    getStaffPhotoUrl(context.profile.photo_path)
      .then((url) => {
        const el = document.getElementById('hero-avatar');
        if (url && el) el.innerHTML = `<img src="${url}" alt="Foto" />`;
      })
      .catch(() => {});
  }

  // Ringkasan presensi hari ini, tepat di samping sapaan.
  if (hasAttendance) {
    document.getElementById('att-mini').addEventListener('click', () => openModule('attendance', context, modules, moduleCtx));
    getMyTodaySession()
      .then((s) => {
        const body = document.getElementById('att-mini-body');
        if (!body) return;
        if (!s) {
          body.innerHTML = `<span class="att-mini-status att-mini-none">Belum clock in</span><span class="att-mini-cta">Ketuk untuk absen →</span>`;
        } else if (!s.clock_out_at) {
          body.innerHTML = `<span class="att-mini-status att-mini-active">● Sedang bekerja</span><span class="att-mini-cta">Sejak ${fmtClock(s.clock_in_at)} · ketuk untuk clock out →</span>`;
        } else {
          body.innerHTML = `<span class="att-mini-status att-mini-done">✓ Selesai hari ini</span><span class="att-mini-cta">${fmtClock(s.clock_in_at)} – ${fmtClock(s.clock_out_at)}</span>`;
        }
      })
      .catch(() => {
        const body = document.getElementById('att-mini-body');
        if (body) body.textContent = 'Ketuk untuk buka presensi';
      });
  }
}

function fmtClock(iso) {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
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
  // Warna bar browser/status bar HP ikut tema BU (default netral #f5f5f5 sebelum login).
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color || '#f5f5f5');
}

bootstrap();
