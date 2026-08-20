import { escapeHtml } from './core/ui.js';
import { pasangNavigasi, bersihkanLapis, bersihkanIsian } from './core/navigasi.js';
import { ingatLayar, ingatKonteks, mulaiModul, pulihkanGulir, pasangPencatatGulir } from './core/ingatan-layar.js';
import { pasangPerekamDraf, tawarkanDraf } from './core/pasang-draf.js';
import { signIn, signOut, getSession, onAuthStateChange, getCurrentUserContext, changeOwnPassword } from './auth/auth.js';
import { buatPenjagaSesi } from './auth/perubahan-sesi.js';
import { loadingHtml } from './core/loading.js';
import { pasangPenandaKoneksi } from './core/koneksi.js';
import { pasangTabelResponsif } from './core/tabel-responsif.js';
import { listBuOwner } from './modules/owner/owner.service.js';
import { renderActualOwner } from './modules/owner/actual.owner.js';
import { renderProyeksiOwner } from './modules/owner/proyeksi.owner.js';
import { renderRingkasanOwner } from './modules/owner/ringkasan.owner.js';
import { renderBepOwner } from './modules/owner/bep.owner.js';
import { renderDokumenOwner } from './modules/owner/dokumen.owner.js';

/**
 * Halaman Owner.
 *
 * ============ KENAPA HALAMAN SENDIRI, BUKAN TAB DI ADMIN PORTAL ============
 *
 * Yang membukanya SUPER ADMIN — orang yang sama, hak yang sama. Jadi alasannya
 * bukan lagi soal izin, melainkan soal apa yang ada di layar.
 *
 * Admin Portal adalah tempat MENGUBAH: tiap menu punya tombol simpan, hapus,
 * dan koreksi. Halaman ini tempat MEMBACA — dan satu-satunya hal yang bisa
 * ditulis dari sini adalah keputusan tanda tangan.
 *
 * Kalau keduanya digabung, tidak ada lagi yang menahan tombol "betulkan saja
 * dari sini" ditambahkan ke halaman ringkasan. Perubahan yang datang dari
 * ringkasan tidak salah secara hak, tapi ia melewati layar yang seharusnya
 * mencatatnya, dan riwayatnya jadi menunjuk tempat yang keliru.
 *
 * Pemisahan itu penjagaan di LAYAR, bukan di database — super admin tetap bisa
 * menulis apa pun lewat modul yang benar. `tools/audit-owner-baca-saja.cjs`
 * yang menjaga agar halaman ini tidak diam-diam tumbuh tombol tulis.
 *
 * ============ TAUTAN DOKUMEN ============
 *
 * `owner.html?dok=<id>` dibuka dari chat. Parameternya DISIMPAN dulu sebelum
 * layar masuk digambar, lalu dipakai lagi sesudah login berhasil. Tanpa itu,
 * owner yang belum login akan kehilangan tujuannya begitu ia mengetik sandi,
 * dan mendarat di Ringkasan — lalu harus meminta tautannya dikirim ulang.
 */

const app = document.getElementById('app');

const TAB = [
  // Profitabilitas aktual dijadikan tab PERTAMA — ia yang menjawab pertanyaan
  // paling sering ditanyakan owner, dan ia satu-satunya tab yang seluruh
  // angkanya aktual tanpa asumsi apa pun.
  { kode: 'actual', label: 'Profitabilitas', ikon: '📒', render: renderActualOwner },
  // Proyeksi ditaruh PERSIS SESUDAH Actual, bukan di ujung deretan. Keduanya
  // menjawab pertanyaan yang sama pada dua waktu berbeda, dan mendekatkannya
  // membuat perbedaan labelnya — ACTUAL vs PROJECTED — terbaca sebagai pilihan
  // yang disengaja, bukan sebagai dua halaman yang kebetulan mirip.
  { kode: 'proyeksi', label: 'Proyeksi', ikon: '🔮', render: renderProyeksiOwner },
  { kode: 'ringkasan', label: 'Ringkasan', ikon: '📊', render: renderRingkasanOwner },
  { kode: 'bep', label: 'BEP & Harga', ikon: '⚖️', render: renderBepOwner },
  { kode: 'dokumen', label: 'Dokumen & TTD', ikon: '✍️', render: renderDokumenOwner }
];

/** Id dokumen dari URL, kalau ada. Dibaca sekali dan disimpan. */
const dokAwal = new URLSearchParams(window.location.search).get('dok');

const KUNCI_BU = 'owner_bu_aktif';
const KUNCI_TAB = 'owner_tab_terakhir';

function simpan(kunci, nilai) {
  try {
    sessionStorage.setItem(kunci, nilai);
  } catch {
    // sessionStorage bisa diblokir di mode privat -> fitur ingat-tab sekadar mati
  }
}
function baca(kunci) {
  try {
    return sessionStorage.getItem(kunci);
  } catch {
    return null;
  }
}

async function bootstrap() {
  const session = await getSession();
  if (session?.user) await renderShell();
  else renderLogin();

  // Sama dengan Admin Portal & Staff App: JANGAN gambar ulang hanya karena
  // token diperbarui. `onAuthStateChange` juga menyala untuk INITIAL_SESSION
  // dan TOKEN_REFRESHED — dan yang kedua terjadi persis saat tab kembali aktif.
  // Alasannya di `auth/perubahan-sesi.js`.
  const penjagaSesi = buatPenjagaSesi(session?.user?.id ?? null);
  onAuthStateChange((_event, sesiBaru) => {
    const putusan = penjagaSesi(sesiBaru);
    if (putusan === 'shell') renderShell();
    else if (putusan === 'login') renderLogin();
  });
}

function renderLogin(pesanError = '') {
  // Kalau datang dari tautan dokumen, katakan tujuannya di layar masuk. Layar
  // login yang polos membuat orang mengira tautannya salah.
  const dariTautan = dokAwal
    ? `<p class="report-note" style="margin-bottom:12px">Kamu membuka tautan dokumen. Masuk dulu, lalu dokumennya akan langsung terbuka.</p>`
    : '';

  app.innerHTML = `
    <section class="auth-page">
      <form class="auth-card" id="login-form">
        <img src="images/logo.svg" alt="Berjaya Hub" class="auth-logo" onerror="this.style.display='none'" />
        <h1>Berjaya Hub — Owner</h1>
        ${dariTautan}
        <div class="field">
          <label for="email">Email</label>
          <input id="email" type="email" required autocomplete="username" />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" type="password" required autocomplete="current-password" />
        </div>
        <button class="primary" type="submit">Masuk</button>
        ${pesanError ? `<p class="error-text">${escapeHtml(pesanError)}</p>` : ''}
      </form>
    </section>
  `;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const sandi = document.getElementById('password').value;
    try {
      await signIn(email, sandi);
    } catch (error) {
      renderLogin(error.message ?? 'Gagal masuk. Periksa email/password.');
    }
  });
}

async function renderShell() {
  app.innerHTML = loadingHtml('Memuat data owner…', { penuh: true });

  let context;
  let daftarBu;
  try {
    [context, daftarBu] = await Promise.all([getCurrentUserContext(), listBuOwner()]);
  } catch (error) {
    app.innerHTML = `<p style="padding:24px" class="error-text">Gagal memuat data: ${escapeHtml(error.message ?? String(error))}</p>`;
    return;
  }

  // HANYA SUPER ADMIN.
  //
  // Diperiksa dari `scopes`, bukan dari "daftar BU-nya tidak kosong". Admin BU
  // juga punya BU — kalau yang dipakai daftar BU, dia akan masuk dan melihat
  // seluruh KPI beserta angka kas outletnya. Kegagalan itu tidak akan
  // menampilkan error apa pun; halamannya cuma terbuka untuk orang yang
  // seharusnya tidak membukanya.
  const superAdmin = (context?.scopes ?? []).some((s) => s.role === 'super_admin');

  if (!context || !superAdmin || daftarBu.length === 0) {
    // Pesannya sengaja menyebut halaman lain. Orang yang punya akses admin lalu
    // salah membuka owner.html akan mengira akunnya bermasalah, padahal ia
    // hanya berada di pintu yang keliru.
    app.innerHTML = `
      <div style="padding:24px;max-width:520px">
        <h2 style="margin-top:0">Halaman ini khusus Super Admin</h2>
        <p>Akun kamu tidak punya akses super admin. Kalau kamu admin BU atau staff, gunakan halaman berikut.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
          <button id="btn-ke-staff">📱 Staff App</button>
          <button id="btn-ke-admin">🛠️ Admin Portal</button>
          <button class="primary" id="btn-logout">Keluar</button>
        </div>
      </div>
    `;
    document.getElementById('btn-ke-staff').addEventListener('click', () => (window.location.href = './index.html'));
    document.getElementById('btn-ke-admin').addEventListener('click', () => (window.location.href = './admin.html'));
    document.getElementById('btn-logout').addEventListener('click', signOut);
    return;
  }

  let buAktif = baca(KUNCI_BU);
  if (!daftarBu.some((b) => b.id === buAktif)) buAktif = daftarBu[0].id;

  gambarKerangka(context, daftarBu, buAktif);
}

function gambarKerangka(context, daftarBu, buAktifId) {
  const bu = daftarBu.find((b) => b.id === buAktifId) ?? daftarBu[0];
  terapkanTema(bu);

  // Nama BU nonaktif diberi keterangan, BUKAN disembunyikan dari daftar.
  // Menyembunyikannya terbaca sebagai "BU saya hilang", dan itu persis yang
  // dilaporkan saat daftarnya sempat disaring `is_active`.
  const namaBu = (b) => `${b.name}${b.is_active === false ? ' (nonaktif)' : ''}`;

  // Diberi LABEL yang terlihat, bukan hanya `aria-label`. Tanpa label, sebuah
  // `<select>` bernama "Admin Divisi" di pojok kiri atas terbaca sebagai judul
  // halaman — dan orang tidak mencoba menekan judul.
  const pilihBu =
    daftarBu.length > 1
      ? `<span class="bu-pilih">
           <label for="owner-bu">BU</label>
           <select id="owner-bu" aria-label="Business Unit">
             ${daftarBu.map((b) => `<option value="${b.id}"${b.id === bu.id ? ' selected' : ''}>${escapeHtml(namaBu(b))}</option>`).join('')}
           </select>
         </span>`
      : `<span class="admin-topbar-title">${escapeHtml(namaBu(bu))}</span>`;

  app.innerHTML = `
    <div class="app-shell">
      <div class="app-body">
        <header class="admin-topbar">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            <img src="${bu.logo_url || 'images/logo.svg'}" alt="" class="nav-logo" onerror="this.style.display='none'" />
            ${pilihBu}
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div class="app-switch" role="tablist" aria-label="Mode aplikasi">
              <button id="btn-ke-staff"><span>📱</span> Staff App</button>
              <button id="btn-ke-admin"><span>🛠️</span> Admin Portal</button>
              <button class="active" aria-current="page"><span>📊</span> Owner</button>
            </div>
            <button id="btn-akun" aria-label="Akun" title="${escapeHtml(context.profile.full_name)}" style="min-height:38px">⋯</button>
          </div>
        </header>

        <div id="panel-akun"></div>

        <nav class="tab-bar" id="owner-tabs" role="tablist">
          ${TAB.map((t) => `<button class="tab-btn" role="tab" data-tab="${t.kode}">${t.ikon} ${t.label}</button>`).join('')}
        </nav>

        <main class="app-content" id="module-content">${loadingHtml('Memuat…')}</main>
      </div>
    </div>
  `;

  document.getElementById('owner-bu')?.addEventListener('change', (e) => {
    simpan(KUNCI_BU, e.target.value);
    gambarKerangka(context, daftarBu, e.target.value);
  });

  document.getElementById('btn-ke-staff').addEventListener('click', () => (window.location.href = './index.html'));
  document.getElementById('btn-ke-admin').addEventListener('click', () => (window.location.href = './admin.html'));
  document.getElementById('btn-akun').addEventListener('click', () => bukaPanelAkun());

  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => bukaTab(btn.dataset.tab, context, bu));
  });

  // Tautan dokumen menang atas tab terakhir — kalau owner baru saja diminta
  // menandatangani sesuatu, itulah yang dia cari.
  const terakhir = baca(KUNCI_TAB);
  const awal = dokAwal ? 'dokumen' : TAB.some((t) => t.kode === terakhir) ? terakhir : 'actual';
  bukaTab(awal, context, bu, { pulihkan: true });
}

function bukaPanelAkun() {
  const panel = document.getElementById('panel-akun');
  if (panel.innerHTML) {
    panel.innerHTML = '';
    return;
  }
  panel.innerHTML = `
    <div style="padding:12px 16px;border-bottom:1px solid var(--color-border);display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start">
      <form id="form-sandi" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;flex:1;min-width:240px">
        <input type="password" name="sandi" placeholder="Password baru (min 6)" minlength="6" required style="flex:1;min-width:180px" />
        <button class="primary" type="submit" style="min-height:38px">Simpan</button>
      </form>
      <button id="btn-keluar" style="min-height:38px">Keluar</button>
    </div>
    <p id="pesan-sandi" style="margin:6px 16px;font-size:0.82rem"></p>
  `;
  document.getElementById('btn-keluar').addEventListener('click', signOut);
  document.getElementById('form-sandi').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pesan = document.getElementById('pesan-sandi');
    try {
      await changeOwnPassword(e.target.sandi.value);
      pesan.className = '';
      pesan.style.color = 'var(--color-primary)';
      pesan.textContent = 'Password berhasil diubah.';
      e.target.reset();
    } catch (error) {
      pesan.className = 'error-text';
      pesan.textContent = error.message ?? 'Gagal mengubah password.';
    }
  });
}

function bukaTab(kode, context, bu, { pulihkan = false } = {}) {
  simpan(KUNCI_TAB, kode);
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === kode));

  // `mulaiModul` membaca-lalu-mengosongkan ingatan dalam SATU langkah. Memisah
  // keduanya pernah membuat pemulihan konteks tidak pernah hidup sama sekali di
  // Staff App, karena `ingatModul()` menghapus ingatannya sebelum halaman
  // sempat membacanya. Alasannya di core/ingatan-layar.js.
  const { gulir, layar, konteks } = mulaiModul(`owner_${kode}`, { pulihkan });
  window.scrollTo({ top: 0, behavior: 'auto' });
  bersihkanIsian();
  bersihkanLapis();

  const isi = document.getElementById('module-content');
  isi.classList.remove('fade-in');
  void isi.offsetWidth;
  isi.classList.add('fade-in');
  isi.innerHTML = loadingHtml('Memuat…');

  const tab = TAB.find((t) => t.kode === kode) ?? TAB[0];
  const ctx = {
    businessUnitId: bu.id,
    bu,
    profile: context.profile,
    // Hanya dipakai sekali. Tanpa dikosongkan, berpindah tab lalu kembali ke
    // Dokumen akan membuka ulang dokumen lama seolah baru dikirim.
    dokumenAwal: kode === 'dokumen' ? ambilDokAwal() : null,
    layarAwal: layar,
    konteksAwal: konteks,
    catatLayar: ingatLayar,
    catatKonteks: ingatKonteks
  };

  Promise.resolve(tab.render(isi, ctx))
    .catch((error) => {
      isi.innerHTML = `<p class="error-text">Gagal memuat halaman: ${escapeHtml(error?.message ?? String(error))}</p>`;
    })
    .finally(() => {
      pulihkanGulir(gulir);
      tawarkanDraf(`owner_${kode}|${layar ?? ''}`);
    });
}

let dokTerpakai = false;
function ambilDokAwal() {
  if (dokTerpakai) return null;
  dokTerpakai = true;
  // Parameternya dibuang dari alamat setelah dipakai, supaya menyegarkan
  // halaman tidak membuka ulang dokumen yang sudah selesai diputus.
  if (dokAwal) {
    try {
      window.history.replaceState({}, '', window.location.pathname);
    } catch {
      // beberapa peramban menolak replaceState pada file:// -> abaikan
    }
  }
  return dokAwal;
}

function terapkanTema(bu) {
  const warna = bu?.theme_color;
  if (warna) {
    document.documentElement.style.setProperty('--color-primary', warna);
    document.documentElement.style.setProperty('--color-primary-hover', warna);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', warna || '#f5f5f5');
}

pasangNavigasi();
pasangPencatatGulir();
pasangPerekamDraf();
pasangPenandaKoneksi();
pasangTabelResponsif();
bootstrap();
