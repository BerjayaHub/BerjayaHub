/**
 * AUDIT: kas yang bisa dibebani orang lain (0120) benar-benar terpasang,
 *        dan tidak melonggarkan apa pun yang seharusnya tetap ketat.
 *
 * ============ KASUSNYA ============
 *
 *   "yang pegang kas user risma, tetapi user shenda boleh input terima dari
 *    supplier ... maka kasnya akan mines, sedangkan kas user yang pegang kas
 *    tidak berkurang"
 *
 * ============ TIGA HAL YANG DIKUNCI ============
 *
 * 1. Penulisannya lewat RPC. Aturan siapa-boleh-membebani-apa, tanda nominal,
 *    dan kewajiban outlet/bukti untuk kas keluar semuanya ada di server.
 *    `.insert()` langsung berarti menirukan keempatnya di klien.
 *
 * 2. Kebijakan RLS LAMA tidak dilonggarkan. `cash_entries_insert_own` tetap
 *    `holder_id = auth.uid()`. Melonggarkannya berarti setiap jalur tulis —
 *    termasuk yang belum ada — ikut longgar.
 *
 * 3. Kantongnya TERLIHAT. Tanpa kebijakan baca untuk kantong ber-outlet,
 *    daftar "kas mana yang boleh kubebani" selalu kosong — tombolnya ada,
 *    RPC-nya ada, izinnya ada, dan tidak ada satu pun pilihan yang bisa
 *    dipilih. Bentuk kegagalan yang paling sering muncul di repo ini.
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
// 1. Migration: fungsi izin, RPC, dan DUA kebijakan baca.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0120_kas_outlet_boleh_dibebani.sql');
if (mig) {
  for (const [pola, apa] of [
    [/alter table cash_accounts add column if not exists outlet_id/, 'kolom `cash_accounts.outlet_id`'],
    [/create or replace function boleh_membebani_kas\(/, 'fungsi `boleh_membebani_kas`'],
    [/create or replace function catat_kas_di\(/, 'RPC `catat_kas_di`'],
    [/create policy cash_accounts_baca_outlet on cash_accounts/, 'kebijakan baca kantong ber-outlet'],
    [/create policy cash_entries_select_pembuat on cash_entries/, 'kebijakan baca entri untuk pembuatnya']
  ]) {
    if (!pola.test(mig)) salah(`supabase/migrations/0120: ${apa} tidak ada.`);
  }

  // Izin outlet harus benar-benar memeriksa CAKUPAN, bukan sekadar "ada outletnya".
  if (!/has_outlet_scope\(p_uid, a\.outlet_id\)/.test(mig)) {
    salah(
      'supabase/migrations/0120: izin kantong ber-outlet tidak memeriksa `has_outlet_scope`. ' +
        'Tanpa itu, kantong yang menyebut outlet mana pun bisa dibebani SIAPA SAJA di seluruh organisasi.'
    );
  }
  // Kantong pribadi harus tetap tertutup.
  if (!/a\.outlet_id is not null and has_outlet_scope/.test(mig)) {
    salah(
      'supabase/migrations/0120: syarat `outlet_id is not null` hilang dari izinnya. ' +
        'Kantong PRIBADI ikut terbuka, dan itu kebalikan dari yang dijanjikan opt-in.'
    );
  }
  // Tanda nominal ditentukan server.
  if (!/case when p_type = 'out' then -abs\(p_amount\)/.test(mig)) {
    salah(
      'supabase/migrations/0120: tanda nominal tidak ditentukan servernya. ' +
        'Satu layar yang lupa memberi minus akan MENAMBAH kas ketika seharusnya mengurangi — ' +
        'dan saldonya tetap terlihat wajar sampai ada yang menghitung uang fisiknya.'
    );
  }
  // Uangnya mendarat di PEMEGANG.
  if (!/values \(\s*v_holder, p_account/.test(mig)) {
    salah(
      'supabase/migrations/0120: entri tidak dicatat atas nama pemegang kantongnya. ' +
        'Kalau `created_by` yang dipakai sebagai `holder_id`, masalah aslinya kembali persis seperti semula.'
    );
  }

  // Kebijakan LAMA tidak boleh dilonggarkan di migration ini.
  if (/drop policy if exists cash_entries_insert_own/.test(mig)) {
    salah(
      'supabase/migrations/0120: menyentuh `cash_entries_insert_own`. ' +
        'Kebijakan itu sengaja dibiarkan ketat — melonggarkannya membuat SETIAP jalur tulis ikut longgar, ' +
        'termasuk yang belum ada, dan RLS tidak bisa memaksakan hal-hal yang harus benar bersamaan.'
    );
  }
}

// ---------------------------------------------------------------
// 2. Service menulis lewat RPC, bukan tabel.
// ---------------------------------------------------------------
const svc = baca('js/modules/cash/cash.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  if (!/rpc\('catat_kas_di'/.test(kode)) {
    salah(
      "js/modules/cash/cash.service.js: tidak ada pemanggilan RPC `catat_kas_di`. " +
        'Mencatat kas atas nama orang lain lewat `.insert()` akan ditolak RLS — dan PostgREST tidak ' +
        'menganggap penolakan RLS sebagai error pada semua jalur, jadi kegagalannya bisa lewat tanpa suara.'
    );
  }
  if (!/listKantongBisaKubebani/.test(kode)) {
    salah('js/modules/cash/cash.service.js: tidak ada cara mengambil daftar kantong yang boleh dibebani.');
  }
  // `outletId` undefined harus berarti "jangan sentuh".
  if (!/outletId === undefined \? \{\} :/.test(kode)) {
    salah(
      'js/modules/cash/cash.service.js: `saveCashAccount` tidak membedakan `undefined` dari kosong. ' +
        'Pemanggil yang cuma mengganti NAMA kantong akan diam-diam mencabut outletnya — dan bersamanya ' +
        'izin staff outlet untuk membebani kantong itu. Bentuknya persis bug "+ Foto menghapus supplier" (0119).'
    );
  }
}

// ---------------------------------------------------------------
// 3. Layar Kas: outlet bisa dipilih, dan akibatnya dijelaskan.
// ---------------------------------------------------------------
const hal = baca('js/modules/cash/cash.page.js');
if (hal) {
  const kode = tanpaKomentar(hal);
  if (!/opsiOutletKantong\(\)/.test(kode)) {
    salah(
      'js/modules/cash/cash.page.js: kantong kas tidak punya pilihan outlet. ' +
        'Kolomnya ada di database dan RPC-nya sudah memakainya, tapi tidak ada jalan mengisinya — ' +
        'kemampuannya ada, jalannya tidak ada di layar.'
    );
  }
  if (!/KET_OUTLET_KANTONG/.test(kode)) {
    salah(
      'js/modules/cash/cash.page.js: akibat memilih outlet tidak dijelaskan di dialognya. ' +
        'Pemegang kas sedang membuka kantongnya kepada orang lain — itu keputusan yang tidak boleh ' +
        'diambil tanpa tahu apa yang berubah.'
    );
  }
  if (!/kk-terbuka/.test(kode)) {
    salah(
      'js/modules/cash/cash.page.js: kantong yang terbuka tidak ditandai di daftarnya. ' +
        'Pemegang kas menanggung selisihnya, jadi ia berhak tahu sekilas mana yang bisa dibebani orang lain.'
    );
  }
  // Mencabut outlet harus dikonfirmasi.
  if (!/a\.outlet_id && !values\.outlet/.test(kode)) {
    salah(
      'js/modules/cash/cash.page.js: mencabut outlet dari kantong tidak dikonfirmasi. ' +
        'Akibatnya tidak terlihat di layar ini: staff yang selama ini bisa mencatat nota akan berhenti bisa, ' +
        'dan yang ia lihat cuma pilihan kasnya menghilang tanpa sebab yang bisa ditelusuri.'
    );
  }
}

if (gagal === 0) {
  console.log('Kas per outlet: RPC dipakai, kebijakan lama tetap ketat, dan kantongnya terlihat & bisa diatur. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
