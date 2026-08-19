import { signIn, signOut, getSession, onAuthStateChange, getCurrentUserContext, changeOwnPassword } from './auth/auth.js';
import { buatPenjagaSesi } from './auth/perubahan-sesi.js';
import { getActiveModules, getModuleRenderer, registerModule, getMyAllowedModules, getModulesActiveInAnyBu } from './core/module-loader.js';
import { getModuleIcon, pakaiLabelStaff } from './core/module-icons.js';
import { listBusinessUnitsBasic } from './modules/organization/organization.service.js';
import { toast, confirmDialog, formDialog, escapeHtml } from './core/ui.js';
import { mountTutorialButton, openTutorialDialog, ensureTutorialStyles } from './core/tutorial-button.js';
import { listTutorialsByModule } from './modules/tutorial/tutorial.service.js';
import { pasangNavigasi, dorongLapis, bersihkanLapis, bersihkanIsian } from './core/navigasi.js';
import { ingatModul, modulTerakhir, mulaiModul, pulihkanGulir, pasangPencatatGulir } from './core/ingatan-layar.js';
import { pasangPerekamDraf, setLayarDraf, tawarkanDraf } from './core/pasang-draf.js';
import { renderAttendancePage } from './modules/attendance/attendance.page.js';
import { renderLeavePage } from './modules/leave/leave.page.js';
import { renderCleaningPage } from './modules/cleaning/cleaning.page.js';
import { renderInventoryPage } from './modules/inventory/inventory.page.js';
import { renderProductionPage } from './modules/production/production.page.js';
import { renderDispatchPage } from './modules/dispatch/dispatch.page.js';
import { renderMenuPage } from './modules/menu/menu.page.js';
import { renderSalesPage } from './modules/sales/sales.page.js';
import { renderCashPage } from './modules/cash/cash.page.js';
import { renderReservationPage } from './modules/reservation/reservation.page.js';
import { renderAssetPage } from './modules/asset/asset.page.js';
import { renderShiftPage } from './modules/shift/shift.page.js';
import { renderProfilePage, initials } from './modules/profile/profile.page.js';
import { getStaffPhotoUrl } from './modules/profile/profile.service.js';
import { getMyTodaySession } from './modules/attendance/attendance.service.js';
import { loadingHtml, sekaliJalan } from './core/loading.js';
import { pasangPenandaKoneksi } from './core/koneksi.js';
import { pasangTabelResponsif } from './core/tabel-responsif.js';

registerModule('attendance', renderAttendancePage);
registerModule('leave', renderLeavePage);
registerModule('cleaning_checklist', renderCleaningPage);
registerModule('inventory', renderInventoryPage);
// Master Produk SENGAJA TIDAK didaftarkan di Staff App.
//
// Isinya hampir seluruhnya sama dengan modul Inventory — daftar produk beserta
// stoknya — dan dua kartu yang membuka hal yang sama membuat staff menebak
// mana yang "benar". Yang lebih buruk: keduanya menampilkan stok, jadi kalau
// suatu saat salah satunya basi, tidak ada cara membedakan mana yang keliru.
//
// `js/modules/product/product.staff.page.js` SEKARANG YATIM dan sebaiknya
// dihapus. Saya sempat menulis bahwa Stok Opname tinggal di sana — itu keliru:
// opname punya layarnya sendiri di dalam modul Inventory, dan berkas itu tidak
// lagi dirujuk siapa pun. Dibiarkan begitu, 75 baris itu terlihat seperti
// bagian aplikasi yang masih hidup bagi siapa pun yang membacanya nanti.
registerModule('production', renderProductionPage);
registerModule('dispatch', renderDispatchPage);
registerModule('menu', renderMenuPage);
registerModule('sales', renderSalesPage);
registerModule('cash_ledger', renderCashPage);
registerModule('reservation', renderReservationPage);
registerModule('asset', renderAssetPage);
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
  app.innerHTML = loadingHtml('Memuat data staff…', { penuh: true });

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
  // Super admin melihat SELURUH BU, tanpa perlu didaftarkan satu per satu.
  //
  // Sebelumnya daftar BU di Staff App hanya dibangun dari baris scope. Akibatnya
  // super admin yang scope-nya cuma satu (mis. Admin Divisi) hanya melihat satu
  // BU di pemilih — padahal perannya berarti "semuanya". Satu-satunya jalan
  // keluar adalah menambahkan scope bu_admin ke setiap BU secara manual, dan
  // itu pekerjaan yang tidak seharusnya ada: daftar scope jadi panjang, dan
  // setiap BU baru harus diingat untuk ditambahkan lagi.
  //
  // Admin Portal sudah lama berperilaku begini; Staff App tertinggal.
  let availableBUs = [];
  if (context.scopes.some((s) => s.role === 'super_admin')) {
    availableBUs = await listBusinessUnitsBasic().catch(() => []);
  }
  if (!availableBUs.length) {
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
    availableBUs = [...seen.values()];
  }

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

  app.innerHTML = loadingHtml('Memuat modul…', { penuh: true });
  // Modul aktif BU, lalu disaring lagi oleh akses per user (kalau diatur admin).
  // pakaiLabelStaff dipasang SEKALI di sini, bukan di tiap tempat yang
  // menggambar namanya (kartu, header modul, daftar tutorial). Kalau ditempel
  // per tempat, satu yang terlewat menghasilkan modul yang namanya berubah di
  // kartu tapi tetap lama di header — dan itu terbaca seperti dua modul.
  const modules = pakaiLabelStaff(
    await getMyAllowedModules(activeBuId, await getActiveModules(activeBuId)).catch(() => [])
  );

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
           ${availableBUs.map((b) => `<option value="${b.id}"${b.id === activeBuId ? ' selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
         </select>`
      : `<div class="topbar-bu">${escapeHtml(activeBu?.name ?? '')}</div>`;

  // Pintasan mode (Staff App ↔ Admin Portal) hanya untuk akun ber-peran admin.
  const ADMIN_ROLES = ['super_admin', 'bu_admin', 'outlet_admin'];
  const isAdmin = (context.scopes ?? []).some((s) => ADMIN_ROLES.includes(s.role));
  // Dipisah dari `isAdmin`: halaman Owner bukan sekadar "lebih tinggi dari
  // staff", ia khusus super admin. Memakai `isAdmin` akan memunculkan tombol
  // untuk admin outlet, yang lalu ditolak halaman tujuannya.
  const isSuperAdmin = (context.scopes ?? []).some((s) => s.role === 'super_admin');

  // Tampilan tanpa menu samping: header atas + konten kartu.
  app.innerHTML = `
    <header class="staff-topbar">
      <div class="topbar-main">
        <img src="${logoSrc}" alt="" class="topbar-logo" onerror="this.style.display='none'" />
        <div class="topbar-info">
          <div class="topbar-name">${escapeHtml(context.profile.full_name)}</div>
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
              ${isSuperAdmin ? '<button id="btn-to-owner"><span>📊</span> Owner</button>' : ''}
            </div>`
          : ''
      }
    </header>
    <main class="staff-main" id="module-content"></main>
  `;

  document.getElementById('btn-to-owner')?.addEventListener('click', () => {
    window.location.href = './owner.html';
  });

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

  document.getElementById('btn-change-password').addEventListener('click', sekaliJalan(async () => {
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
  }));

  // Kembali ke modul terakhir, bukan selalu ke Beranda.
  //
  // KENAPA: membuka kamera dari <input type="file"> membuat Android/iOS
  // MEMBUANG halaman web dari memori kalau RAM sedang sempit. Saat kamera
  // ditutup, halamannya dimuat ULANG — dan tanpa ini staff selalu terlempar ke
  // Beranda, seolah aplikasi "keluar sendiri" setelah memotret. Berlaku juga
  // untuk refresh biasa dan saat PWA dibuka kembali dari layar depan.
  const terakhir = modulTerakhir();
  if (terakhir && modules.some((m) => m.code === terakhir) && getModuleRenderer(terakhir)) {
    // `pulihkan: true` -> modul ini diminta mengembalikan posisi gulir dan
    // sub-layar terakhirnya, bukan memulai dari layar depan. Bedakan dengan
    // membuka modul lewat ketukan, yang memang harus mulai dari atas.
    openModule(terakhir, context, modules, moduleCtx, { pulihkan: true });
  } else {
    renderHome(context, modules, moduleCtx);
  }
}

async function renderHome(context, modules, moduleCtx) {
  // Kembali ke Beranda secara sengaja -> lupakan modul terakhir, supaya
  // refresh berikutnya tetap di Beranda seperti yang orangnya harapkan.
  ingatModul(null);
  setLayarDraf(null);
  // Tumpukan Back dikosongkan: dari Beranda, Back berikutnya memang seharusnya
  // keluar aplikasi seperti yang diharapkan pengguna Android.
  bersihkanLapis();
  const content = document.getElementById('module-content');
  const firstName = (context.profile.full_name || '').split(' ')[0] || 'Halo';
  // Hanya tampilkan modul yang punya halaman Staff App + sesuai peran outlet:
  // Produksi hanya di Central Kitchen; Menu hanya di outlet non-CK (yang menjual).
  const role = moduleCtx.outletRole;
  const staffModules = modules.filter((mod) => {
    if (!getModuleRenderer(mod.code)) return false;
    if (mod.code === 'production') return !role || role === 'central_kitchen';
    // Menu, penjualan, dan reservasi hanya untuk outlet yang melayani tamu.
    if (mod.code === 'menu' || mod.code === 'sales' || mod.code === 'reservation') return !role || role !== 'central_kitchen';
    return true;
  });
  const hasAttendance = staffModules.some((m) => m.code === 'attendance');
  // Presensi sudah punya kartu sendiri di header (att-mini), jadi jangan
  // ditampilkan lagi sebagai kartu biasa — dua pintu ke halaman yang sama
  // hanya membingungkan.
  const gridModules = staffModules.filter((m) => !(hasAttendance && m.code === 'attendance'));
  content.innerHTML = `
    <div class="home-hero">
      <div class="staff-greeting">
        <div class="hero-avatar" id="hero-avatar">${escapeHtml(initials(context.profile.full_name))}</div>
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <h1>Halo, ${firstName} 👋</h1>
            <span id="home-tutorial"></span>
          </div>
          <p>Pilih menu di bawah untuk mulai.</p>
        </div>
      </div>
      ${hasAttendance ? `<button class="att-mini" id="att-mini"><div class="att-mini-head">🕐 Presensi Hari Ini</div><div class="att-mini-body" id="att-mini-body">Memuat…</div></button>` : ''}
    </div>
    <div class="card-grid">
      ${
        gridModules
          .map(
            (mod) => `
          <button class="module-card" data-module="${mod.code}">
            <span class="module-card-icon">${getModuleIcon(mod.code)}</span>
            <span class="module-card-label">${escapeHtml(mod.name)}</span>
          </button>`
          )
          .join('') || '<p>Belum ada modul aktif untuk BU kamu. Hubungi admin.</p>'
      }
    </div>
  `;

  content.querySelectorAll('[data-module]').forEach((card) => {
    card.addEventListener('click', () => openModule(card.dataset.module, context, modules, moduleCtx));
  });

  // Daftar tutorial di Beranda. Tombol ❓ di header modul hanya terlihat kalau
  // orangnya SUDAH membuka modul itu — padahal yang paling butuh tutorial justru
  // yang belum berani membukanya. Sengaja tidak di-await: Beranda harus tampil
  // sekarang, tidak menunggu satu query pelengkap.
  mountTutorialBeranda(staffModules, moduleCtx?.businessUnitId);

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

/**
 * Tombol tutorial di header Beranda, tepat di sebelah sapaan.
 *
 * Tombol ❓ di header modul hanya terlihat kalau orangnya SUDAH membuka modul
 * itu — padahal yang paling butuh tutorial justru yang belum berani membukanya.
 * Di Beranda tombolnya diletakkan di tempat mata sudah berhenti (nama sendiri),
 * bukan sebagai kartu tambahan di bawah: satu kartu lagi di grid modul justru
 * menambah yang harus dipilah sebelum orang sampai ke pekerjaannya.
 *
 * Hanya modul yang BENAR-BENAR dipakai staff ini yang dihitung. Menawarkan
 * tutorial modul yang tidak bisa dia buka bukan cuma sia-sia — itu membuat orang
 * mengira ada bagian aplikasi yang disembunyikan darinya.
 */
async function mountTutorialBeranda(staffModules, businessUnitId) {
  const host = document.getElementById('home-tutorial');
  if (!host || !businessUnitId) return;

  const perModul = await listTutorialsByModule(businessUnitId).catch(() => new Map());
  const punya = staffModules.filter((m) => perModul.get(m.code)?.length);
  // Tidak ada video -> tidak ada tombol. Tombol bantuan yang membuka daftar
  // kosong lebih merugikan daripada tidak ada tombol sama sekali.
  if (!punya.length) return;

  ensureTutorialStyles();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tutorial-btn';
  btn.innerHTML = `❓ <span>Tutorial${punya.length > 1 ? ` (${punya.length})` : ''}</span>`;
  btn.title = 'Video cara memakai tiap modul';
  btn.addEventListener('click', () => {
    // Satu modul saja -> langsung ke videonya, tidak perlu memaksa memilih dulu.
    if (punya.length === 1) {
      openTutorialDialog(perModul.get(punya[0].code), `📺 Tutorial ${punya[0].name}`);
      return;
    }
    pilihModulTutorial(punya, perModul);
  });
  host.appendChild(btn);
}

/** Dialog pemilih modul; setelah dipilih, pemutarnya memakai dialog yang sama
 *  dengan tombol ❓ di header modul (openTutorialDialog), bukan salinannya. */
function pilihModulTutorial(punya, perModul) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" style="max-width:520px">
      <h3 class="modal-title">📺 Video Tutorial</h3>
      <p class="modal-text">Pilih modul yang ingin kamu pelajari.</p>
      <div class="tutorial-list">
        ${punya
          .map((m) => {
            // Jumlah video dihitung DI LUAR template: `perModul.get(m.code)`
            // di dalam ${...} membuat audit escape menandainya (karena `code`
            // termasuk bidang teks bebas), padahal yang dicetak cuma angka.
            const jml = perModul.get(m.code).length;
            return `
          <button class="tutorial-item" data-tut="${escapeHtml(m.code)}">
            <span style="font-size:1.5rem;width:34px;text-align:center;flex-shrink:0">${getModuleIcon(m.code)}</span>
            <span>
              <span class="t-title">${escapeHtml(m.name)}</span>
              <span class="t-desc">${jml} video</span>
            </span>
          </button>`;
          })
          .join('')}
      </div>
      <div class="modal-actions">
        <button type="button" class="primary btn-inline" data-act="close">Tutup</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  let lewatBack = false;
  const lepasLapis = dorongLapis('pilih-tutorial', () => {
    lewatBack = true;
    tutup();
  });
  function tutup() {
    if (!lewatBack) lepasLapis();
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
    document.removeEventListener('keydown', onEsc);
  }
  function onEsc(e) {
    if (e.key === 'Escape') tutup();
  }
  document.addEventListener('keydown', onEsc);
  overlay.querySelector('[data-act="close"]').addEventListener('click', tutup);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) tutup();
  });
  overlay.querySelectorAll('[data-tut]').forEach((b) =>
    b.addEventListener('click', () => {
      const mod = punya.find((m) => m.code === b.dataset.tut);
      // Pemilih ditutup lebih dulu supaya tidak ada dua overlay bertumpuk —
      // yang di bawah tetap menangkap klik dan terasa seperti aplikasi macet.
      tutup();
      openTutorialDialog(perModul.get(b.dataset.tut), `📺 Tutorial ${mod?.name ?? ''}`.trim());
    })
  );
}

function fmtClock(iso) {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

/**
 * @param {{pulihkan?: boolean}} opsi `pulihkan` dipakai saat halaman dimuat
 *   ULANG (mis. OS membuang halaman ini waktu orangnya membuka Excel). Bedanya
 *   penting: membuka modul lewat ketukan harus mulai dari atas, sedangkan
 *   kembali dari aplikasi lain harus mendarat persis di tempat yang ditinggalkan.
 */
function openModule(code, context, modules, moduleCtx, { pulihkan = false } = {}) {
  // Membaca-lalu-mengosongkan dikerjakan `mulaiModul()` dalam SATU langkah.
  // Memisahkannya jadi "baca dulu, lalu ingatModul" pernah menelan satu
  // perbaikan utuh — alasan lengkapnya di core/ingatan-layar.js.
  const { gulir: gulirSimpanan, layar: layarSimpanan, konteks: konteksSimpanan } = mulaiModul(code, { pulihkan });
  // Halaman baru selalu dimulai dari atas. Tanpa ini, membuka modul setelah
  // menggulir jauh akan menampilkan layar yang tampak kosong — orangnya
  // mengira modulnya belum jadi, padahal isinya ada di atas.
  window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
  bersihkanIsian(); // halaman baru: belum ada yang diketik
  // Satu lapis Back untuk seluruh modul: dari mana pun di dalamnya, Back
  // membawa orangnya kembali ke Beranda — bukan keluar dari aplikasi.
  dorongLapis(`modul:${code}`, () => renderHome(context, modules, moduleCtx), { penjaga: true });
  const content = document.getElementById('module-content');
  const mod = modules.find((m) => m.code === code);
  content.innerHTML = `
    <div class="module-header">
      <button class="btn-home" id="btn-back-home">🏠 Beranda</button>
      <span class="module-header-title">${escapeHtml(mod?.name ?? '')}</span>
      <span id="module-help-slot" style="margin-left:auto"></span>
    </div>
    <div id="module-body"></div>
  `;
  document.getElementById('btn-back-home').addEventListener('click', () => renderHome(context, modules, moduleCtx));

  // Tombol ❓ menyusul secara asinkron dan hanya muncul kalau modul ini punya
  // video. Sengaja tidak di-await: modulnya harus tampil sekarang, bukan
  // menunggu satu query tutorial selesai.
  mountTutorialButton(document.getElementById('module-help-slot'), code, moduleCtx?.businessUnitId);

  const renderer = getModuleRenderer(code);
  const body = document.getElementById('module-body');
  if (renderer) {
    // `layarAwal` diteruskan ke modulnya. Modul yang tidak mengenalnya cukup
    // mengabaikannya — tidak ada modul yang perlu diubah supaya tetap jalan.
    Promise.resolve(renderer(body, { ...moduleCtx, layarAwal: layarSimpanan, konteksAwal: konteksSimpanan })).finally(() => {
      pulihkanGulir(gulirSimpanan);
      // Ditawarkan SESUDAH modulnya selesai menggambar — sebelum itu, isian
      // yang mau diisi belum ada di layar dan tidak ada yang bisa dicocokkan.
      tawarkanDraf(`${code}|${layarSimpanan ?? ''}`);
    });
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

// Dipasang SEBELUM bootstrap: entri history akar harus sudah ada sebelum
// layar pertama sempat mendorong lapis apa pun.
pasangNavigasi();
pasangPenandaKoneksi();
pasangTabelResponsif();
pasangPencatatGulir();
pasangPerekamDraf();
bootstrap();
