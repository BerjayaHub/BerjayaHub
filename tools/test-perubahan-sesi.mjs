/**
 * Kapan perubahan sesi menuntut aplikasi digambar ulang.
 *
 * Ini akar dari keluhan "halaman selalu refresh, isian hilang" — di HP maupun
 * desktop. `onAuthStateChange` menyala jauh lebih sering daripada login/logout,
 * dan versi lama menggambar ulang SELURUH aplikasi setiap kali.
 *
 * Yang diuji: token boleh diperbarui berapa kali pun, selama orangnya sama,
 * tidak ada yang boleh dibuang dari layar.
 */
import { buatPenjagaSesi } from '../js/auth/perubahan-sesi.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

const sesi = (id) => (id ? { user: { id } } : null);

// ---------- Sudah login, lalu token diperbarui ----------
const p = buatPenjagaSesi('user-1');
cek('INITIAL_SESSION user sama -> abaikan', p(sesi('user-1')), 'abaikan');
cek('TOKEN_REFRESHED -> abaikan', p(sesi('user-1')), 'abaikan');
cek('USER_UPDATED -> abaikan', p(sesi('user-1')), 'abaikan');
cek('berkali-kali pun tetap abaikan', p(sesi('user-1')), 'abaikan');

// ---------- Keluar ----------
cek('SIGNED_OUT -> layar login', p(null), 'login');
cek('  dan tidak diulang', p(null), 'abaikan');

// ---------- Masuk lagi ----------
cek('SIGNED_IN -> bangun shell', p(sesi('user-1')), 'shell');
cek('  sesudahnya token refresh diabaikan', p(sesi('user-1')), 'abaikan');

// ---------- Ganti akun ----------
cek('user berbeda -> bangun shell', p(sesi('user-2')), 'shell');
cek('  lalu tenang lagi', p(sesi('user-2')), 'abaikan');

// ---------- Mulai dari belum login ----------
const q = buatPenjagaSesi(null);
cek('belum login: INITIAL_SESSION kosong -> abaikan', q(null), 'abaikan');
cek('login pertama -> shell', q(sesi('user-9')), 'shell');
cek('  token refresh sesudahnya -> abaikan', q(sesi('user-9')), 'abaikan');

// ---------- Bentuk sesi yang aneh ----------
const r = buatPenjagaSesi('user-1');
cek('sesi tanpa user dianggap keluar', r({}), 'login');
const s = buatPenjagaSesi('user-1');
cek('user tanpa id dianggap keluar', s({ user: {} }), 'login');
const u = buatPenjagaSesi(null);
cek('undefined aman', u(undefined), 'abaikan');

// ---------- Tanpa argumen awal ----------
const v = buatPenjagaSesi();
cek('tanpa uid awal, login pertama -> shell', v(sesi('a')), 'shell');

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Penjaga perubahan sesi benar untuk 17 kasus — token refresh tidak lagi membuang isian. ✅');
