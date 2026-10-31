/**
 * AUDIT: kantong utama, dan dua bug yang ditemukan bersamanya (0177).
 *
 * ============ KETIGANYA GAGAL DENGAN TENANG ============
 *
 *   daftar kantong super-admin-only  -> admin BU membuka tab yang bisa
 *                                       ditekan tombolnya dan selamanya
 *                                       berbunyi "Belum ada kantong kas"
 *   satu modul dua baris menu        -> "Kas" dan "Cash Ledger" bersebelahan
 *                                       membuka layar yang sama; yang
 *                                       membacanya mencari bedanya
 *   kantong utama ganda              -> form mengisi yang mana saja yang
 *                                       kebetulan lebih dulu terbaca, dan
 *                                       transfer mendarat di tempat berbeda
 *                                       dari yang dikira orangnya
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar, periksaKewarasan } = require('./lib/tanpa-komentar.cjs');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const baca = (rel) => {
  const p = path.join(AKAR, rel);
  if (!fs.existsSync(p)) {
    salah(`${rel} tidak ada — audit ini kehilangan sasarannya.`);
    return null;
  }
  return fs.readFileSync(p, 'utf8');
};

/**
 * Berkas JS TANPA komentarnya.
 *
 * ============ KENAPA INI PERLU ============
 *
 * Komentar di repo ini MENGUTIP kode yang dijelaskannya — "`is_primary` IKUT:
 * form kas memakainya sebagai bawaan". Memeriksa berkas mentah berarti
 * kutipan itu ikut menghijaukan audit: kolomnya bisa dicabut dari `.select()`
 * dan pemeriksanya tetap diam. Sabotasenya yang menunjukkan itu — empat dari
 * delapan lolos sebelum baris ini ada.
 */
const bacaKode = (rel) => {
  const asli = baca(rel);
  if (!asli) return null;
  const kode = tanpaKomentar(asli);
  const pesan = periksaKewarasan(asli, kode, ['is_primary', 'akunTampil', 'utamaKosong']);
  if (pesan) {
    salah(`${rel}: ${pesan} — audit ini tidak bisa dipercaya untuk berkas itu.`);
    return null;
  }
  return kode;
};

const tanpaKomentarSql = (sql) =>
  sql
    .split('\n')
    .map((b) => (b.trim().startsWith('--') ? '' : b))
    .join('\n');

const MIG = 'supabase/migrations/0177_kantong_utama.sql';
const MENU = 'js/main-admin.js';
const SVC = 'js/modules/cash/cash.service.js';
const STAFF = 'js/modules/cash/cash.page.js';
const ADMIN = 'js/modules/cash/cash.admin.page.js';
const TES_PG = 'tools/test-migrasi-0177.mjs';

// =====================================================================
// 1. SQL
// =====================================================================
const mentah = baca(MIG);
const sql = mentah ? tanpaKomentarSql(mentah) : null;
if (sql) {
  // ============ SATU UTAMA PER ORANG, DIJAGA DATABASE ============
  //
  // Dijaga di layar saja berarti dua tab yang terbuka bersamaan bisa menandai
  // dua kantong sekaligus — dan sejak itu "kantong utama" tidak berarti apa
  // pun.
  if (!/create unique index if not exists idx_cash_accounts_satu_utama[\s\S]{0,120}where is_primary/.test(sql)) {
    salah(`${MIG}: tidak ada indeks unik "satu kantong utama per pemegang".`);
  }
  // Trigger, bukan aturan di dalam satu RPC: kantong dibuat dari beberapa
  // jalur, dan aturan yang ditulis di salah satunya tertinggal di yang lain.
  if (!/create trigger trg_kantong_utama_pertama[\s\S]{0,120}before insert on cash_accounts/.test(sql)) {
    salah(`${MIG}: kantong pertama tidak otomatis jadi utama lewat trigger — jalur pembuat lain akan terlewat.`);
  }
  if (!/create or replace function kantong_utama/.test(sql)) salah(`${MIG}: \`kantong_utama\` tidak ada.`);
  if (!/create or replace function atur_kantong_utama/.test(sql)) salah(`${MIG}: \`atur_kantong_utama\` tidak ada.`);
  if (!/boleh_koreksi_kas\(v_holder\)/.test(sql)) {
    salah(`${MIG}: \`atur_kantong_utama\` tidak memeriksa wewenang atas kas pemegangnya.`);
  }
  if (!/sudah ditutup tidak bisa dijadikan kantong utama/.test(sql)) {
    salah(`${MIG}: kantong yang sudah ditutup boleh jadi bawaan — form akan mengisinya sendiri ke kantong yang tidak dipakai.`);
  }

  // ============ KEDUA JALUR MENDARAT DI TEMPAT YANG SAMA ============
  //
  // `transfer_cash` dan `ubah_transfer_kas` menulis kaki penerima di dua
  // tempat berbeda. Memperbarui satu saja membuat transfer yang DIREVISI
  // terlempar kembali ke Kas Utama — justru saat orangnya sedang membetulkan.
  const mendarat = sql.split('kantong_utama(p_to_user)').length - 1;
  if (mendarat < 2) {
    salah(
      `${MIG}: kaki penerima cuma diarahkan ke kantong utama di ${mendarat} tempat. ` +
        'Harus di `transfer_cash` DAN `ubah_transfer_kas`.'
    );
  }

  // Daftar kantong dibuka untuk admin BU — cakupannya sama dengan koreksi kas.
  if (/where is_super_admin\(auth\.uid\(\)\)/.test(sql)) {
    salah(`${MIG}: \`daftar_kantong_kas\` masih super-admin-only — tab Kantong Kas admin BU akan selamanya kosong.`);
  }
  if ((sql.split('boleh_koreksi_kas(a.holder_id)').length - 1) < 1 || (sql.split('boleh_koreksi_kas(p.holder_id)').length - 1) < 1) {
    salah(`${MIG}: kedua cabang \`daftar_kantong_kas\` tidak memakai cakupan yang sama.`);
  }
  // Kas Utama yang kosong bukan kantong, dan menampilkannya membuat orang
  // mengira ia punya dua tempat uang.
  if (!/coalesce\(s\.balance, 0\) <> 0/.test(sql)) {
    salah(`${MIG}: Kas Utama yang kosong ikut terdaftar.`);
  }
  if (!fs.existsSync(path.join(AKAR, TES_PG))) salah(`${TES_PG} tidak ada — aturan ini tidak pernah dijalankan.`);
}

// =====================================================================
// 2. Menu admin tidak boleh memuat satu modul dua kali
// =====================================================================
const menu = bacaKode(MENU);
if (menu) {
  const i = menu.indexOf('function buildAdminMenu');
  const blok = i >= 0 ? menu.slice(i, menu.indexOf('\n}', i)) : '';
  if (!blok) salah(`${MENU}: \`buildAdminMenu\` tidak ada.`);
  else if (!/sudahAda\.has\(mod\.code\)/.test(blok)) {
    salah(
      `${MENU}: modul aktif tidak disaring terhadap menu inti. ` +
        '`cash_ledger` ada di keduanya, jadi "Kas" dan "Cash Ledger" muncul bersebelahan membuka layar yang sama.'
    );
  }
}

// =====================================================================
// 3. Layanan & layar
// =====================================================================
const svc = bacaKode(SVC);
if (svc) {
  const i = svc.indexOf('export async function listMyCashAccounts');
  const blok = i >= 0 ? svc.slice(i, svc.indexOf('\n}', i)) : '';
  // Tanpa kolomnya, "bawaan kantong utama" diam-diam jatuh ke kantong pertama
  // menurut urutan tampilan — yang belum tentu kantong yang dipakai orangnya.
  if (!/is_primary/.test(blok)) salah(`${SVC}: \`listMyCashAccounts\` tidak membaca \`is_primary\`.`);
  if (!/rpc\('atur_kantong_utama'/.test(svc)) salah(`${SVC}: \`aturKantongUtama\` tidak memanggil RPC-nya.`);
}

const staff = bacaKode(STAFF);
if (staff) {
  const i = staff.indexOf('function opsiKantongAsal');
  const blok = i >= 0 ? staff.slice(i, staff.indexOf('\n  }', i)) : '';
  if (!blok) salah(`${STAFF}: \`opsiKantongAsal\` tidak ada.`);
  else {
    // Dicari pada PEMILIHAN BAWAANNYA, bukan di mana pun: `a.is_primary` juga
    // muncul di label pilihan (" · utama"), jadi mencarinya lepas membuat
    // bawaannya bisa dicabut sementara auditnya tetap hijau.
    if (!/accounts\.find\(\(a\) => a\.is_primary\)/.test(blok)) {
      salah(`${STAFF}: kantong utama tidak dipakai sebagai bawaan pilihan kantong.`);
    }
    // Kas Utama bukan kantong; menawarkannya saat kosong berarti menawarkan
    // keadaan yang sedang dibereskan sebagai jawaban yang sah.
    // DEKLARASI dan PEMAKAIANNYA diperiksa dua-duanya, dengan `\b`.
    //
    // Memeriksa pemakaiannya saja membuat deklarasinya bisa diganti nama
    // (`utamaKosongX`) — pemakaiannya lalu menunjuk variabel yang tidak ada,
    // yang MELEMPAR saat dialognya dibuka, sementara auditnya tetap hijau.
    // Memeriksa deklarasinya saja sebaliknya: ia boleh ada tanpa dipakai.
    const adaDeklarasi = /const\s+utamaKosong\s*=\s*saldoDari\(null\) === 0;/.test(blok);
    const adaPemakaian = /\butamaKosong\b\s*\?\s*\[\]\s*:/.test(blok);
    if (!adaDeklarasi || !adaPemakaian) {
      salah(`${STAFF}: Kas Utama yang kosong masih ditawarkan sebagai pilihan.`);
    }
  }
  // Yang diperiksa PENYARINGANNYA, bukan nama variabelnya: `const akunTampil =
  // saldoAkun;` tetap memuat namanya dan tetap menampilkan semuanya.
  if (!/akunTampil = saldoAkun\.filter\(\(a\) => a\.account_id \|\| Number\(a\.balance\) !== 0\)/.test(staff)) {
    salah(`${STAFF}: baris Kas Utama berisi Rp0 masih ditampilkan di kepala halaman.`);
  }
}

const admin = bacaKode(ADMIN);
if (admin) {
  if (!/btn-utama-akun/.test(admin)) salah(`${ADMIN}: tidak ada cara mengganti kantong utama dari Admin Portal.`);
  if (!/querySelectorAll\('\.btn-utama-akun'\)/.test(admin)) {
    salah(`${ADMIN}: tombol "Jadikan utama" digambar tapi tidak pernah dipasangi penangan klik.`);
  }
  if (!/UTAMA<\/span>/.test(admin)) salah(`${ADMIN}: kantong utama tidak ditandai di tabelnya.`);
}

console.log('');
if (gagal === 0) console.log('Audit kantong utama bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
