import { escapeHtml } from './core/ui.js';
import { pasangNavigasi, dorongLapis, bersihkanLapis, bersihkanIsian } from './core/navigasi.js';
import { ingatModul, ingatLayar, ingatKonteks, mulaiModul, pulihkanGulir, pasangPencatatGulir } from './core/ingatan-layar.js';
import { pasangPerekamDraf, tawarkanDraf } from './core/pasang-draf.js';
import { mountTutorialButton, clearFloatingTutorialButton } from './core/tutorial-button.js';
import { signIn, signOut, getSession, onAuthStateChange, getCurrentUserContext, changeOwnPassword } from './auth/auth.js';
import { buatPenjagaSesi } from './auth/perubahan-sesi.js';
import { getActiveModules, getModuleRenderer, registerModule } from './core/module-loader.js';
import { getModuleIcon } from './core/module-icons.js';
import { renderMasterUserPage } from './modules/master-user/master-user.page.js';
import { renderAttendanceAdminPage } from './modules/attendance/attendance.admin.page.js';
import { renderLeaveAdminPage } from './modules/leave/leave.admin.page.js';
import { renderCleaningAdminPage } from './modules/cleaning/cleaning.admin.page.js';
import { renderMasterProductPage } from './modules/product/product.admin.page.js';
import { renderInventoryAdminPage } from './modules/inventory/inventory.admin.page.js';
import { renderProductionAdminPage } from './modules/production/production.admin.page.js';
import { renderDispatchAdminPage } from './modules/dispatch/dispatch.admin.page.js';
import { renderSalesAdminPage } from './modules/sales/sales.admin.page.js';
import { renderCashAdminPage } from './modules/cash/cash.admin.page.js';
import { renderMenuAdminPage } from './modules/menu/menu.admin.page.js';
import { renderStaffDataPage } from './modules/profile/staff-data.admin.page.js';
import { renderShiftAdminPage } from './modules/shift/shift.admin.page.js';
import { renderFleetAdminPage } from './modules/fleet/fleet.admin.page.js';
import { renderReservationAdminPage } from './modules/reservation/reservation.admin.page.js';
import { renderAssetAdminPage } from './modules/asset/asset.page.js';
import { renderAdminDashboard } from './modules/dashboard/dashboard.admin.page.js';
import { renderReportAdminPage } from './modules/report/report.admin.page.js';
import { renderTelegramAdminPage } from './modules/notifications/telegram.admin.page.js';
import { renderTutorialAdminPage } from './modules/tutorial/tutorial.admin.page.js';
import { renderBuAppearancePage } from './modules/organization/bu-appearance.admin.page.js';
import { renderOrganizationAdminPage } from './modules/organization/organization.admin.page.js';
import { listBusinessUnitsBasic } from './modules/organization/organization.service.js';
import { renderGroupPage } from './core/group-page.js';
import { canAccessTab } from './core/admin-tabs.js';
import { getMyAdminTabAccess } from './modules/master-user/master-user.service.js';
import { loadingHtml } from './core/loading.js';
import { pasangPenandaKoneksi } from './core/koneksi.js';

const app = document.getElementById('app');
const ADMIN_ROLES = ['super_admin', 'bu_admin', 'outlet_admin'];

// Modul "core" admin: selalu tampil untuk admin, tidak tergantung toggle bu_modules
// (beda dengan modul operasional seperti presensi/inventory yang di-toggle per BU)
registerModule('dashboard', renderAdminDashboard);
registerModule('report', renderReportAdminPage);
registerModule('telegram', renderTelegramAdminPage);
registerModule('tutorial', renderTutorialAdminPage);
registerModule('organization', renderOrganizationAdminPage);
registerModule('master_user', renderMasterUserPage);
registerModule('bu_appearance', renderBuAppearancePage);
registerModule('attendance', renderAttendanceAdminPage);
registerModule('leave', renderLeaveAdminPage);
registerModule('cleaning_checklist', renderCleaningAdminPage);
registerModule('master_product', renderMasterProductPage);
registerModule('inventory', renderInventoryAdminPage);
registerModule('production', renderProductionAdminPage);
registerModule('dispatch', renderDispatchAdminPage);
registerModule('sales', renderSalesAdminPage);
registerModule('cash_ledger', renderCashAdminPage);
registerModule('shift', renderShiftAdminPage);
registerModule('fleet', renderFleetAdminPage);
registerModule('reservation', renderReservationAdminPage);
registerModule('asset', renderAssetAdminPage);
// ---- Pengelompokan menu: beberapa modul digabung jadi satu menu bertab ----
// Modul di dalam grup tidak tampil sebagai menu terpisah.
const GROUPS = {
  grp_org: {
    name: 'BU & Outlet',
    icon: '🏢',
    tabs: [
      { code: 'organization', label: 'Organisasi & Outlet', render: renderOrganizationAdminPage, core: true },
      { code: 'bu_appearance', label: 'Tampilan BU', render: renderBuAppearancePage, core: true }
    ]
  },
  grp_user: {
    name: 'User',
    icon: '👤',
    tabs: [
      { code: 'master_user', label: 'Master User', render: renderMasterUserPage, core: true },
      { code: 'staff_data', label: 'Data Staff', render: renderStaffDataPage, core: true },
      // core: true -> kas tidak lagi tergantung toggle modul per BU, karena
      // saldonya milik user dan lintas BU. Aksesnya dijaga superAdminOnly.
      { code: 'cash_ledger', label: 'Kas', render: renderCashAdminPage, core: true }
    ]
  },
  grp_inventory: {
    name: 'Inventory',
    icon: '📦',
    tabs: [
      { code: 'inventory', label: 'Stok & Riwayat', render: renderInventoryAdminPage },
      { code: 'master_product', label: 'Master Produk', render: renderMasterProductPage },
      { code: 'menu', label: 'Menu', render: renderMenuAdminPage },
      { code: 'production', label: 'Produksi', render: renderProductionAdminPage },
      { code: 'sales', label: 'Penjualan', render: renderSalesAdminPage }
    ]
  }
};

// Kode modul yang sudah "diserap" ke dalam grup -> jangan tampil sebagai menu sendiri.
const GROUPED_CODES = new Set(Object.values(GROUPS).flatMap((g) => g.tabs.map((t) => t.code)));

// Laporan bersifat lintas-modul, jadi ikut "core" (tidak di-toggle per BU),
// tapi tetap bisa dibatasi lewat Izin Admin per user.
const CORE_ADMIN_MENU = [
  { code: 'dashboard', name: 'Dashboard' },
  { code: 'report', name: 'Laporan' },
  { code: 'telegram', name: 'Notifikasi Telegram' },
  { code: 'tutorial', name: 'Video Tutorial' }
];

/** Tab dalam sebuah grup yang boleh dilihat user ini di BU aktif. */
function visibleTabsOf(group, activeCodes, isSuperAdmin, allowedTabs) {
  return group.tabs.filter((t) => (t.core || activeCodes.has(t.code)) && canAccessTab(t.code, isSuperAdmin, allowedTabs));
}

/** Susun menu admin: Dashboard + grup + modul aktif lain, disaring izin akses. */
function buildAdminMenu(activeModules, isSuperAdmin, allowedTabs) {
  const activeCodes = new Set(activeModules.map((m) => m.code));
  const menu = CORE_ADMIN_MENU.filter((m) => canAccessTab(m.code, isSuperAdmin, allowedTabs));
  for (const [code, g] of Object.entries(GROUPS)) {
    if (visibleTabsOf(g, activeCodes, isSuperAdmin, allowedTabs).length) menu.push({ code, name: g.name });
  }
  for (const mod of activeModules) {
    if (!GROUPED_CODES.has(mod.code) && canAccessTab(mod.code, isSuperAdmin, allowedTabs)) menu.push(mod);
  }
  return menu;
}

async function bootstrap() {
  const session = await getSession();
  if (session?.user) {
    await renderShell();
  } else {
    renderLogin();
  }

  // JANGAN GAMBAR ULANG HANYA KARENA TOKEN DIPERBARUI.
  //
  // `onAuthStateChange` menyala jauh lebih sering daripada masuk & keluar:
  // `INITIAL_SESSION`, `TOKEN_REFRESHED` (terjadi persis saat tab kembali
  // aktif), dan `USER_UPDATED` semuanya membawa `user` yang terisi. Versi
  // sebelumnya memanggil `renderShell()` untuk semuanya — jadi berpindah tab
  // lalu kembali membangun ulang seluruh aplikasi dan membuang isian yang
  // sedang diketik. Itulah "halaman selalu refresh" yang dikeluhkan dari
  // lapangan, dan sebabnya bukan sistem operasi melainkan baris ini.
  //
  // Aturannya sekarang: gambar ulang HANYA kalau siapa yang login berubah.
  // Alasannya di `auth/perubahan-sesi.js`.
  const penjagaSesi = buatPenjagaSesi(session?.user?.id ?? null);
  onAuthStateChange((_event, newSession) => {
    const putusan = penjagaSesi(newSession);
    if (putusan === 'shell') renderShell();
    else if (putusan === 'login') renderLogin();
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
  app.innerHTML = loadingHtml('Memuat data admin…', { penuh: true });

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

  // Daftar BU yang bisa dikelola: super_admin -> semua BU; lainnya -> BU dari scope adminnya.
  const isSuperAdmin = context.scopes.some((s) => s.role === 'super_admin');
  let availableBUs = [];
  if (isSuperAdmin) {
    try {
      availableBUs = await listBusinessUnitsBasic();
    } catch {
      availableBUs = [];
    }
  }
  if (availableBUs.length === 0) {
    const seen = new Map();
    for (const s of adminScopes) {
      if (s.business_unit_id && !seen.has(s.business_unit_id)) {
        seen.set(s.business_unit_id, {
          id: s.business_unit_id,
          name: s.business_units?.name ?? 'BU',
          theme_color: s.business_units?.theme_color,
          logo_url: s.business_units?.logo_url
        });
      }
    }
    availableBUs = [...seen.values()];
  }

  let activeBuId = null;
  try {
    activeBuId = localStorage.getItem('admin_active_bu');
  } catch {
    // localStorage bisa saja diblokir -> pakai default
  }
  if (!availableBUs.some((b) => b.id === activeBuId)) {
    activeBuId = availableBUs[0]?.id ?? adminScopes[0].business_unit_id;
  }

  renderShellForBu(context, adminScopes, availableBUs, isSuperAdmin, activeBuId);
}

async function renderShellForBu(context, adminScopes, availableBUs, isSuperAdmin, activeBuId) {
  const activeBu = availableBUs.find((b) => b.id === activeBuId) || null;
  const role = isSuperAdmin
    ? 'super_admin'
    : adminScopes.find((s) => s.business_unit_id === activeBuId)?.role ?? adminScopes[0].role;

  app.innerHTML = loadingHtml('Memuat modul…', { penuh: true });
  const modules = activeBuId ? await getActiveModules(activeBuId) : [];
  // Izin akses menu/tab per user (super admin tidak dibatasi).
  const allowedTabs = isSuperAdmin || !activeBuId ? new Set() : await getMyAdminTabAccess(activeBuId);

  applyBuTheme(activeBu);

  const allMenu = buildAdminMenu(modules, isSuperAdmin, allowedTabs);
  const menuItems = allMenu
    .map((mod) => `<li><a href="#" data-module="${mod.code}">${getModuleIcon(mod.code)} ${mod.name}</a></li>`)
    .join('');

  const logoSrc = activeBu?.logo_url || 'images/logo.svg';

  const buSwitcherHtml =
    availableBUs.length > 1
      ? `
        <div class="field" style="margin:0 0 12px">
          <label style="font-size:0.72rem">Business Unit aktif</label>
          <select id="bu-switcher">
            ${availableBUs.map((b) => `<option value="${b.id}"${b.id === activeBuId ? ' selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
          </select>
        </div>`
      : '';

  app.innerHTML = `
    <div class="app-shell">
      <button class="nav-toggle" id="btn-nav-toggle" aria-label="Buka menu">☰</button>
      <nav class="app-nav" id="app-nav">
        <div class="nav-brand">
          <img src="${logoSrc}" alt="" class="nav-logo" onerror="this.style.display='none'" />
          <div>
            <div style="font-weight:600">${escapeHtml(context.profile.full_name)}</div>
            <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0">
              ${role} — ${escapeHtml(activeBu?.name ?? 'Semua BU')}
            </p>
          </div>
        </div>
        ${buSwitcherHtml}
        <ul>${menuItems || '<li>Belum ada modul aktif</li>'}</ul>
        <button id="btn-change-password" style="margin-top:16px;width:100%">Ubah Password</button>
        <div id="change-password-wrap"></div>
        <button class="primary" id="btn-logout" style="margin-top:8px">Keluar</button>
      </nav>
      <div class="app-body">
        <header class="admin-topbar">
          <div class="admin-topbar-title">${escapeHtml(activeBu?.name ?? 'Admin Portal')}</div>
          <div class="app-switch" role="tablist" aria-label="Mode aplikasi">
            <button id="btn-to-staff"><span>📱</span> Staff App</button>
            <button class="active" aria-current="page"><span>🛠️</span> Admin Portal</button>
          </div>
        </header>
        <main class="app-content" id="module-content">
          ${loadingHtml('Memuat dashboard…')}
        </main>
      </div>
    </div>
  `;

  document.getElementById('btn-nav-toggle').addEventListener('click', () => {
    document.getElementById('app-nav').classList.toggle('open');
  });

  document.getElementById('btn-logout').addEventListener('click', signOut);

  document.getElementById('btn-to-staff').addEventListener('click', () => {
    window.location.href = './index.html';
  });

  document.getElementById('bu-switcher')?.addEventListener('change', (e) => {
    const newBu = e.target.value;
    try {
      localStorage.setItem('admin_active_bu', newBu);
    } catch {
      // abaikan kalau localStorage diblokir
    }
    renderShellForBu(context, adminScopes, availableBUs, isSuperAdmin, newBu);
  });

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
      document.querySelectorAll('[data-module]').forEach((a) => a.classList.toggle('active', a.dataset.module === code));
      openModule(code, activeBuId, modules, isSuperAdmin, allowedTabs);
    });
  });

  // Kembali ke menu terakhir, bukan selalu Dashboard.
  //
  // KENAPA: membuka kamera dari <input type="file"> bisa membuat HP MEMBUANG
  // halaman web dari memori; saat kembali, halamannya dimuat ulang dan admin
  // terlempar ke Dashboard — terasa seperti aplikasi "keluar sendiri". Berlaku
  // juga untuk refresh biasa.
  //
  // Menu yang tidak ada di sidebar (mis. izinnya dicabut sejak sesi lalu)
  // diabaikan, supaya tidak mendarat di halaman "tidak punya izin".
  const terakhir = menuTerakhir();
  const awal = terakhir && document.querySelector(`[data-module="${CSS.escape(terakhir)}"]`) ? terakhir : 'dashboard';
  document.querySelector(`[data-module="${CSS.escape(awal)}"]`)?.classList.add('active');
  // `pulihkan: true` — halaman ini baru saja dimuat. Kalau penyebabnya OS
  // membuang halaman saat admin membuka Excel, posisinya harus kembali seperti
  // semula, bukan ke puncak daftar yang panjang.
  openModule(awal, activeBuId, modules, isSuperAdmin, allowedTabs, { pulihkan: true });
}

/**
 * Menu Admin Portal yang terakhir dibuka. sessionStorage, bukan localStorage:
 * ingatan ini hanya untuk sesi yang sedang berjalan. Kalau permanen, admin yang
 * besok login akan langsung mendarat di halaman kemarin dan tidak pernah
 * melihat Dashboard.
 */
const KUNCI_MENU = 'admin_menu_terakhir';
function simpanMenuTerakhir(code) {
  try {
    sessionStorage.setItem(KUNCI_MENU, code);
  } catch {
    // sessionStorage bisa diblokir (mode privat) -> fitur ini sekadar tidak aktif
  }
}
function menuTerakhir() {
  try {
    return sessionStorage.getItem(KUNCI_MENU);
  } catch {
    return null;
  }
}

function openModule(code, businessUnitId, activeModules = [], isSuperAdmin = false, allowedTabs = new Set(), { pulihkan = false } = {}) {
  // Tempat di DALAM menu ikut dipulihkan, bukan cuma menunya.
  //
  // Sebelumnya Admin Portal cuma mengingat kode menu, jadi kembali dari
  // aplikasi lain selalu mendarat di tab pertama. Untuk "Inventory" itu berarti
  // Stok & Riwayat, padahal orangnya baru saja mengisi resep — dan tab pertama
  // terlihat cukup mirip halaman yang benar untuk membuat orang ragu sesaat
  // apakah pekerjaannya tersimpan.
  //
  // Membaca-lalu-mengosongkan dikerjakan `mulaiModul()` dalam SATU langkah:
  // memisahkannya pernah membuat sebuah pemulihan tidak pernah hidup sama
  // sekali di Staff App. Alasannya di core/ingatan-layar.js.
  simpanMenuTerakhir(code);
  const { gulir: gulirSimpanan, layar: layarSimpanan, konteks: konteksSimpanan } = mulaiModul(code, { pulihkan });
  // Halaman baru selalu dimulai dari atas. Tanpa ini, membuka modul setelah
  // menggulir jauh akan menampilkan layar yang tampak kosong — orangnya
  // mengira modulnya belum jadi, padahal isinya ada di atas.
  window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
  bersihkanIsian(); // halaman baru: belum ada yang diketik
  // Back dari menu mana pun kembali ke Dashboard. Dashboard sendiri tidak
  // mendorong lapis — di sana Back memang berarti keluar.
  bersihkanLapis();
  if (code !== 'dashboard') {
    dorongLapis(`menu:${code}`, () => openModule('dashboard', businessUnitId, activeModules, isSuperAdmin, allowedTabs), { penjaga: true });
  }
  const content = document.getElementById('module-content');
  const ctx = {
    businessUnitId,
    isAdmin: true,
    layarAwal: layarSimpanan,
    konteksAwal: konteksSimpanan,
    catatLayar: ingatLayar,
    catatKonteks: ingatKonteks
  };
  content.classList.remove('fade-in');
  void content.offsetWidth; // restart animasi transisi halaman
  content.classList.add('fade-in');

  // Lepas tombol tutorial halaman sebelumnya SEKARANG (sinkron). Kalau
  // diserahkan ke mount asinkron di bawah, perpindahan halaman yang cepat bisa
  // membuat pembersihan datang setelah pemasangan dan justru menghapus tombol
  // yang baru benar.
  clearFloatingTutorialButton();

  const group = GROUPS[code];
  if (group) {
    const activeCodes = new Set(activeModules.map((m) => m.code));
    const tabs = visibleTabsOf(group, activeCodes, isSuperAdmin, allowedTabs);
    Promise.resolve(renderGroupPage(content, ctx, group.name, tabs)).finally(() => {
      pulihkanGulir(gulirSimpanan);
      tawarkanDraf(`${code}|${layarSimpanan ?? ''}`);
    });
    return;
  }

  if (!canAccessTab(code, isSuperAdmin, allowedTabs)) {
    content.innerHTML = `<p class="error-text">Kamu tidak punya izin membuka menu ini.</p>`;
    return;
  }

  const renderer = getModuleRenderer(code);
  if (renderer) {
    Promise.resolve(renderer(content, ctx)).finally(() => {
      pulihkanGulir(gulirSimpanan);
      // Ditawarkan sesudah modulnya menggambar — sebelum itu isiannya belum ada.
      tawarkanDraf(`${code}|${layarSimpanan ?? ''}`);
    });
  } else {
    content.innerHTML = `<p>Modul admin "${code}" belum dibangun.</p>`;
  }

  // Admin Portal merender tiap halaman dengan header-nya sendiri, jadi tidak ada
  // satu tempat tetap untuk menyisipkan tombol -- dipakai mode melayang di pojok
  // kanan bawah. Tombol lama dibersihkan sendiri di dalam mountTutorialButton.
  mountTutorialButton(null, code, businessUnitId, { floating: true });
}

function applyBuTheme(businessUnit) {
  const color = businessUnit?.theme_color;
  if (color) {
    document.documentElement.style.setProperty('--color-primary', color);
    document.documentElement.style.setProperty('--color-primary-hover', color);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color || '#f5f5f5');
}

// Dipasang SEBELUM bootstrap: entri history akar harus sudah ada sebelum
// layar pertama sempat mendorong lapis apa pun.
pasangNavigasi();
pasangPencatatGulir();
pasangPerekamDraf();
pasangPenandaKoneksi();
bootstrap();
