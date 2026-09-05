/**
 * AUDIT: kantong kas 0120 benar-benar BISA DINYALAKAN oleh seseorang.
 *
 * ============ KENAPA AUDIT INI ADA ============
 *
 * 0120 lengkap di database — kolom, fungsi izin, RPC, kebijakan baca, tes,
 * dan auditnya sendiri semua hijau — lalu ternyata tidak ada satu orang pun
 * yang bisa mengisi `cash_accounts.outlet_id` yang menjadi tumpuan seluruh
 * fiturnya:
 *
 *   - layarnya cuma ada di Staff App, di balik tombol yang hanya digambar
 *     kalau `cash_account_limit > 1`;
 *   - pemegang berjatah 1 bahkan tidak punya baris kantong sama sekali;
 *   - Admin Portal → User → Kas hanya baca;
 *   - RLS 0063 melarang super admin menulis kantong orang lain.
 *
 * `audit-kas-outlet.cjs` memeriksa bahwa layar STAFF punya jalannya, dan itu
 * benar — tapi tidak ada yang memeriksa bahwa jalan itu bisa DICAPAI. Audit
 * ini menutup selisih tersebut: ia menjaga jalur ADMIN, satu-satunya yang
 * bisa menyalakan fitur untuk pemegang berjatah 1.
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar } = require('./lib/tanpa-komentar.cjs');

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

// ---------------------------------------------------------------
// 1. Migration: RPC daftar + RPC tulis, dengan penjagaannya.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0121_kelola_kantong_kas_dari_admin.sql');
if (mig) {
  for (const [pola, apa] of [
    [/create function daftar_kantong_kas\(\)/, 'RPC `daftar_kantong_kas`'],
    [/create or replace function atur_kantong_kas\(/, 'RPC `atur_kantong_kas`'],
    [/if not is_super_admin\(auth\.uid\(\)\) then/, 'penjagaan super admin pada `atur_kantong_kas`'],
    [/where is_super_admin\(auth\.uid\(\)\)/, 'penyaringan super admin pada `daftar_kantong_kas`']
  ]) {
    if (!pola.test(mig)) salah(`supabase/migrations/0121: ${apa} tidak ada.`);
  }

  // Kantong tidak boleh pindah tangan: memindahkannya berarti memindahkan
  // seluruh riwayat uangnya ke orang lain tanpa satu pun entri yang mencatat
  // perpindahan itu, dan saldo KEDUA orangnya berubah tanpa jejak.
  if (!/p_holder is not null and p_holder <> v_holder/.test(mig)) {
    salah(
      'supabase/migrations/0121: kantong bisa dipindahkan ke pemegang lain. ' +
        'Itu memindahkan seluruh riwayat uangnya tanpa satu pun entri yang mencatatnya — ' +
        'saldo dua orang berubah, dan tidak ada baris mana pun yang bisa menjelaskan kenapa.'
    );
  }

  // Menutup kantong berisi membuat saldonya tidak bisa disentuh siapa pun:
  // tetap terhitung di total, tapi tidak ada jalan masuk maupun keluar.
  if (!/if p_id is not null and not p_aktif then/.test(mig) || !/masih berisi/.test(mig)) {
    salah(
      'supabase/migrations/0121: kantong yang masih berisi uang bisa ditutup. ' +
        'Saldonya tetap terhitung di total tapi tidak bisa lagi disentuh siapa pun — ' +
        'uang yang hilang dari layar tanpa hilang dari angka.'
    );
  }

  // Pesan jatah harus ditujukan kepada ADMIN. Trigger 0063 berkata "Minta admin
  // menambah jatahnya" — kalimat untuk staff, sementara yang berdiri di depan
  // layar ini justru adminnya sendiri, dan ia akan mencari orang yang tidak ada.
  if (!/Master User/.test(mig)) {
    salah(
      'supabase/migrations/0121: pesan jatah penuh tidak memberi tahu admin ke mana harus pergi. ' +
        'Pesan bawaan trigger 0063 berbunyi "Minta admin menambah jatahnya" — dan pembacanya ADALAH adminnya.'
    );
  }

  // Kebijakan 0063 tidak boleh disentuh. Melonggarkan `with check` membuat
  // super admin bisa menulis kantong siapa pun lewat jalur TABEL, sehingga
  // seluruh pemeriksaan di `atur_kantong_kas` bisa dilewati begitu saja.
  if (/policy cash_accounts_own/.test(mig)) {
    salah(
      'supabase/migrations/0121: menyentuh kebijakan `cash_accounts_own`. ' +
        'Kalau `with check`-nya dilonggarkan, jatah kantong, larangan pindah pemegang, dan larangan menutup ' +
        'kantong berisi semuanya bisa dilewati lewat PostgREST tanpa menyentuh RPC ini sama sekali.'
    );
  }

  // Baris semu "Kas Utama": uang tanpa kantong harus terlihat di layar admin.
  if (!/kantong_nyata/.test(mig) || !/'Kas Utama'/.test(mig)) {
    salah(
      'supabase/migrations/0121: daftar kantong tidak menyertakan baris Kas Utama. ' +
        'Pemegang berjatah 1 menyimpan uangnya di `account_id` NULL — tanpa baris itu admin melihat daftar ' +
        'yang tampak lengkap sementara sebagian besar uangnya justru tidak ada di dalamnya.'
    );
  }
}

// ---------------------------------------------------------------
// 2. Service memakai kedua RPC.
// ---------------------------------------------------------------
const svc = baca('js/modules/cash/cash.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  for (const [pola, apa] of [
    [/rpc\('daftar_kantong_kas'/, '`daftar_kantong_kas`'],
    [/rpc\('atur_kantong_kas'/, '`atur_kantong_kas`']
  ]) {
    if (!pola.test(kode)) salah(`js/modules/cash/cash.service.js: tidak memanggil RPC ${apa}.`);
  }
  // Kelima parameter wajib dikirim. RPC-nya sengaja tanpa default, jadi
  // pemanggil yang kurang satu akan gagal keras — tapi hanya kalau ia memang
  // memanggilnya dengan bentuk lengkap ini.
  //
  // DIPOTONG KE BLOK PANGGILANNYA DULU. Percobaan pertama mencari `p_outlet:`
  // di SELURUH file, dan file ini juga berisi `catat_kas_di` yang punya
  // `p_outlet:` sendiri — jadi menghapus `p_outlet` dari `atur_kantong_kas`
  // lolos begitu saja. Bentuk kelemahan yang sudah tercatat di README:
  // pemeriksaan yang puas karena NAMANYA ada di suatu tempat.
  const mulai = kode.indexOf("rpc('atur_kantong_kas'");
  const blok = mulai === -1 ? '' : kode.slice(mulai, kode.indexOf('});', mulai));
  if (blok) {
    for (const p of ['p_id', 'p_holder', 'p_name', 'p_outlet', 'p_aktif']) {
      if (!new RegExp(`${p}:`).test(blok)) {
        salah(
          `js/modules/cash/cash.service.js: \`atur_kantong_kas\` dipanggil tanpa \`${p}\`. ` +
            'RPC-nya tulis penuh — parameter yang tidak dikirim akan MENGOSONGKAN kolomnya, ' +
            'bukan membiarkannya. Bentuknya persis bug "+ Foto menghapus supplier" (0119).'
        );
      }
    }
  }
}

// ---------------------------------------------------------------
// 3. Layar admin: tabnya ada, dan bisa dicapai.
//
// Ini inti auditnya. Migrationnya boleh sempurna; kalau tabnya tidak
// terdaftar, hasilnya sama persis dengan 0120 — kemampuannya ada di database,
// jalannya tidak ada di layar.
// ---------------------------------------------------------------
const hal = baca('js/modules/cash/cash.admin.page.js');
if (hal) {
  const kode = tanpaKomentar(hal);
  if (!/key: 'accounts'/.test(kode)) {
    salah(
      "js/modules/cash/cash.admin.page.js: tab 'accounts' tidak terdaftar di TABS. " +
        'Fungsi penggambarnya boleh ada dan lengkap — tanpa baris ini tidak ada tombol yang memanggilnya, ' +
        'dan seluruh 0120 tetap tidak bisa dinyalakan oleh siapa pun.'
    );
  }
  if (!/if \(key === 'accounts'\) await renderAccountsTab\(content\)/.test(kode)) {
    salah(
      "js/modules/cash/cash.admin.page.js: tab 'accounts' terdaftar tapi tidak dihubungkan ke penggambarnya. " +
        'Tombolnya muncul, ditekan, dan tidak terjadi apa-apa.'
    );
  }
  if (!/daftarKantongKas\(\)/.test(kode) || !/aturKantongKas\(/.test(kode)) {
    salah('js/modules/cash/cash.admin.page.js: tab kantong tidak memakai RPC-nya.');
  }
  // Menuntut PEMAKAIANNYA, bukan sekadar keberadaan namanya. Sabotase
  // `help: null` lolos dari pemeriksaan `/KET_OUTLET_KANTONG_ADMIN/` polos,
  // karena deklarasi konstantanya tetap ada di file — teksnya ditulis, disimpan,
  // dan tidak pernah sampai ke layar.
  if (!/help: KET_OUTLET_KANTONG_ADMIN/.test(kode)) {
    salah(
      'js/modules/cash/cash.admin.page.js: akibat memilih outlet tidak dijelaskan DI DIALOGNYA. ' +
        'Admin sedang membuka kas seseorang kepada orang lain — atas nama orang yang tidak ada di ruangan itu.'
    );
  }
  // Mencabut outlet dikonfirmasi (bentuk yang sama dengan layar staff).
  if (!/existing\.outlet_id && !values\.outlet_id/.test(kode)) {
    salah(
      'js/modules/cash/cash.admin.page.js: mencabut outlet dari kantong tidak dikonfirmasi. ' +
        'Staff yang selama ini bisa mencatat nota akan berhenti bisa, dan yang ia lihat cuma pilihan kasnya ' +
        'menghilang — lalu ia akan mencatatnya ke kasnya sendiri, persis masalah yang semula dilaporkan.'
    );
  }
  // Field yang "dikunci" adalah jebakan: formDialog tidak mengenal `disabled`.
  if (/disabled: true/.test(kode)) {
    salah(
      'js/modules/cash/cash.admin.page.js: ada field dengan `disabled: true`. ' +
        '`formDialog` tidak mengenal opsi itu — field-nya tampil biasa saja dan bisa diubah, ' +
        'lalu penolakannya baru datang dari server setelah orangnya mengira berhasil.'
    );
  }
}

if (gagal === 0) {
  console.log('Kelola kantong kas dari admin: RPC ada, tabnya terdaftar & terhubung, kebijakan 0063 utuh. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
