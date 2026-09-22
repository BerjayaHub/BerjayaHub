/**
 * AUDIT: bayar dari kantong outlet lain, dan DIBAYAR PUSAT (0153).
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   satu tempat saldo terlewat     -> layar A berkata Rp55.600, layar B
 *                                     berkata Rp-444.400, untuk orang yang
 *                                     sama. Tidak ada galat, dan yang
 *                                     membacanya tidak punya cara tahu mana
 *                                     yang benar
 *   penjaga hilang saat disalin    -> lima fungsi di 0153 disalin dari
 *                                     migration lain; yang terlupa tidak
 *                                     melempar, ia cuma membuka pintu
 *   Pusat + kantong sekaligus      -> baris yang menunjuk kantong sekaligus
 *                                     menyatakan tidak menyentuhnya
 *   form kembali ke kantong sendiri-> izin 0126 tidak bisa dicapai dari mana
 *                                     pun lagi
 *   Supplier lenyap lewat RPC      -> entrinya tertahan saat diekspor dengan
 *                                     alasan yang terlihat datang entah dari
 *                                     mana
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
const bersih = (isi, rel, penanda) => {
  const kode = tanpaKomentar(isi);
  const pesan = periksaKewarasan(isi, kode, penanda);
  if (pesan) salah(`${rel}: ${pesan}`);
  return kode;
};
/** Potongan SQL sebuah fungsi, komentarnya dibuang. */
const fnSql = (sql, tanda, sampai = '$$;') => {
  const i = sql.indexOf(tanda);
  if (i < 0) return '';
  return sql.slice(i, sql.indexOf(sampai, i)).replace(/--[^\n]*/g, '');
};

const mig = baca('supabase/migrations/0153_bayar_dari_kantong_lain_dan_pusat.sql');
if (mig) {
  const sql = mig.replace(/--[^\n]*/g, '');

  // ---------------------------------------------------------------
  // 1. Kolom & constraint.
  // ---------------------------------------------------------------
  if (!/add column if not exists dibayar_pusat boolean not null default false/.test(sql)) {
    salah('0153: kolom `dibayar_pusat` tidak ditambahkan.');
  }
  for (const [nama, pola] of [
    ['cash_entries_pusat_tanpa_kantong', /check \(not dibayar_pusat or account_id is null\)/],
    ['cash_entries_pusat_hanya_keluar', /check \(not dibayar_pusat or entry_type = 'out'\)/]
  ]) {
    if (!pola.test(sql)) {
      salah(
        `0153: constraint \`${nama}\` tidak ada. Tanpa itu sebuah baris bisa menunjuk kantong sekaligus menyatakan ` +
          'tidak menyentuhnya — dan layar mana pun yang membacanya akan salah.'
      );
    }
  }

  // ---------------------------------------------------------------
  // 2. SALDO — keempat tempatnya, sekaligus.
  //
  // Ini bagian yang paling mudah setengah selesai, dan setengah selesai di
  // sini tidak melempar apa pun: ia cuma membuat dua layar menyebut angka
  // yang berbeda untuk orang yang sama.
  // ---------------------------------------------------------------
  const cbal = fnSql(sql, 'create view cash_balances', ';');
  if (!/where dicoret_at is null\s+and not dibayar_pusat/.test(cbal)) {
    salah('0153 `cash_balances`: tidak mengecualikan `dibayar_pusat` — saldo pemegang berkurang oleh uang yang tidak pernah ada di tangannya.');
  }
  if (!/where dicoret_at is null/.test(cbal)) {
    salah('0153 `cash_balances`: pengecualian `dicoret_at` (0141) HILANG saat view-nya ditulis ulang.');
  }

  const abal = fnSql(sql, 'create view cash_account_balances', ';');
  if (!/where ce\.dicoret_at is null\s+and not ce\.dibayar_pusat/.test(abal)) {
    salah('0153 `cash_account_balances`: tidak mengecualikan `dibayar_pusat`.');
  }
  if (!/coalesce\(ca\.sort_order, -1\)/.test(abal)) {
    salah('0153 `cash_account_balances`: kolom `sort_order` HILANG saat view-nya ditulis ulang — urutan kantong di layar jadi acak.');
  }

  const fnPindah = fnSql(sql, 'create or replace function pindah_kas(');
  if (!fnPindah) salah('0153: `pindah_kas` tidak ikut ditulis ulang — saldo Kas Utama-nya masih memuat baris Pusat.');
  else {
    if (!/and not dibayar_pusat/.test(fnPindah)) {
      salah(
        '0153 `pindah_kas`: pemeriksaan saldo tidak mengecualikan `dibayar_pusat`. Uang yang SUNGGUH ada di Kas ' +
          'Utama jadi tidak bisa dipindahkan, dengan pesan "saldo tidak cukup" yang tidak cocok dengan layar mana pun.'
      );
    }
    // Penjaga lamanya HARUS ikut terbawa.
    for (const [nama, pola] of [
      ['kantong asal milik pemanggil', /Kantong asal bukan milikmu/],
      ['kantong tujuan milik pemanggil', /Kantong tujuan bukan milikmu/],
      ['asal <> tujuan', /Kantong asal dan tujuan tidak boleh sama/],
      ['nominal > 0', /Jumlah pindah harus lebih dari 0/],
      ['saldo cukup', /Saldo kantong asal tidak cukup/]
    ]) {
      if (!pola.test(fnPindah)) salah(`0153 \`pindah_kas\`: penjaga "${nama}" HILANG saat fungsinya disalin.`);
    }
  }

  const fnKantong = fnSql(sql, 'create function daftar_kantong_kas()');
  if (!fnKantong) salah('0153: `daftar_kantong_kas` tidak ikut ditulis ulang — layar Kantong Kas masih menghitung baris Pusat.');
  else {
    if (!/where not ce\.dibayar_pusat/.test(fnKantong)) {
      salah('0153 `daftar_kantong_kas`: saldonya tidak mengecualikan `dibayar_pusat` — layar Kantong Kas menyebut angka yang berbeda dari `cash_balances`.');
    }
    // DIHITUNG, bukan sekadar "ada". Fungsinya punya DUA cabang `union all` —
    // kantong sungguhan dan baris semu "Kas Utama" — dan masing-masing punya
    // penjaganya sendiri. Mencari satu kemunculan membuat audit ini tetap
    // hijau saat salah satunya dicabut: yang ketemu milik cabang yang lain.
    const nSuper = (fnKantong.match(/is_super_admin\(auth\.uid\(\)\)/g) ?? []).length;
    if (nSuper < 2) {
      salah(
        `0153 \`daftar_kantong_kas\`: penjaga super-admin cuma ada di ${nSuper} dari 2 cabang \`union all\` — ` +
          'kantong seluruh organisasi terbuka lewat cabang yang tidak dijaga.'
      );
    }
    if (!/coalesce\(up\.cash_account_limit, 1\)/.test(fnKantong)) {
      salah('0153 `daftar_kantong_kas`: kolom jatah HILANG saat fungsinya disalin.');
    }
  }

  // ---------------------------------------------------------------
  // 3. LABEL — satu fungsi, dipakai semua yang menampilkan.
  // ---------------------------------------------------------------
  if (!/case\s+when coalesce\(p_pusat, false\) then 'Pusat'\s+else coalesce\(p_nama, 'Kas Utama'\)/.test(sql)) {
    salah('0153: `label_kantong_kas` tidak ada atau bentuknya berubah.');
  }
  for (const [nama, tanda, alias] of [
    ['riwayat_kas_saya', 'create or replace function riwayat_kas_saya(', 'ce'],
    ['laporan_kas_user', 'create or replace function laporan_kas_user(', 'ce'],
    ['rincian_mutasi_kas', 'create function rincian_mutasi_kas(', 't']
  ]) {
    const fn = fnSql(sql, tanda);
    if (!fn) {
      salah(`0153: \`${nama}\` tidak ikut ditulis ulang — ia akan menyebut entri Pusat sebagai "Kas Utama".`);
      continue;
    }
    if (!new RegExp(`label_kantong_kas\\(ca\\.name, ${alias}\\.dibayar_pusat\\)`).test(fn)) {
      salah(
        `0153 \`${nama}\`: nama kantongnya tidak lewat \`label_kantong_kas\`. Laporannya akan mengatakan uangnya ` +
          'keluar dari kas pemegangnya, padahal ia tidak pernah ada di tangannya.'
      );
    }
    if (/coalesce\(ca\.name, 'Kas Utama'\)/.test(fn)) {
      salah(`0153 \`${nama}\`: masih ada \`coalesce(ca.name, 'Kas Utama')\` yang tidak diubah — salah satu kolomnya terlewat.`);
    }
  }
  // Penjaga khas masing-masing, supaya salinannya tidak kehilangan isinya.
  const fnRiwayat = fnSql(sql, 'create or replace function riwayat_kas_saya(');
  if (!/where ce\.holder_id = auth\.uid\(\)/.test(fnRiwayat)) {
    salah('0153 `riwayat_kas_saya`: saringan "milikku" HILANG — riwayat orang lain bocor ke Staff App.');
  }
  if (!/alasan_tolak_koreksi_kas\(ce\.id\)/.test(fnRiwayat)) {
    salah('0153 `riwayat_kas_saya`: kolom `alasan_tolak` HILANG — tombol koreksinya kehilangan keterangannya.');
  }
  const fnLaporan = fnSql(sql, 'create or replace function laporan_kas_user(');
  if (!/and ce\.dicoret_at is null/.test(fnLaporan)) {
    salah('0153 `laporan_kas_user`: pengecualian yang dicoret HILANG saat fungsinya disalin.');
  }
  const fnRincian = fnSql(sql, 'create function rincian_mutasi_kas(');
  if (!/boleh_lihat_kas\(ce\.holder_id, ce\.outlet_id\)/.test(fnRincian)) {
    salah('0153 `rincian_mutasi_kas`: penjaga `boleh_lihat_kas` HILANG — kas seluruh organisasi terbuka.');
  }
  if (!/coalesce\(gri\.line_total, gri\.qty \* gri\.unit_cost\)/.test(fnRincian)) {
    salah('0153 `rincian_mutasi_kas`: rumus nilai baris nota berubah — ia harus sama dengan `nota_ringkas` & `bayar_nota`.');
  }
  if (!/when coalesce\(p_tanpa_kantong, false\) then ce\.account_id is null/.test(fnRincian)) {
    salah('0153 `rincian_mutasi_kas`: penanda "tanpa kantong" HILANG saat fungsinya disalin.');
  }

  // ---------------------------------------------------------------
  // 4. `catat_kas_di` — Supplier, Pusat, dan penjaga lamanya.
  // ---------------------------------------------------------------
  if (!/drop function if exists catat_kas_di\(uuid, text, numeric, uuid, uuid, text, text, date, numeric, text\);/.test(sql)) {
    salah(
      '0153: tanda tangan 10-argumen `catat_kas_di` tidak dibuang. PostgREST memilih overload lewat HIMPUNAN NAMA ' +
        'ARGUMEN — permintaan yang kehilangan `p_supplier` akan diam-diam memilih yang lama, dan Payment To lenyap.'
    );
  }
  const fnCatat = fnSql(sql, 'create or replace function catat_kas_di(');
  for (const [nama, pola] of [
    ['p_supplier', /p_supplier text default null/],
    ['p_dibayar_pusat', /p_dibayar_pusat boolean default false/],
    ['Pusat hanya kas keluar', /Hanya kas keluar yang bisa dibayar Pusat/],
    ['Pusat tanpa kantong', /bukan keduanya/],
    ['kantong wajib kalau bukan Pusat', /Pilih dulu kantong kasnya/],
    ['supplier hanya kas keluar', /case when p_type = 'out' then nullif\(btrim\(p_supplier\), ''\) else null end/],
    // Penjaga 0120 yang HARUS selamat.
    ['jenis in/out', /Jenis kas hanya boleh in atau out/],
    ['nominal > 0', /Nominal harus lebih besar dari 0/],
    ['kantong ada', /Kantong kas tidak ditemukan/],
    ['kantong aktif', /sudah ditutup/],
    ['wewenang', /boleh_membebani_kas\(v_uid, p_account\)/],
    ['tanda ditentukan fungsinya', /case when p_type = 'out' then -abs\(p_amount\) else abs\(p_amount\) end/],
    ['outlet wajib', /Kas keluar harus menyebut outlet peruntukannya/],
    ['bukti wajib', /Kas keluar harus disertai foto bukti/]
  ]) {
    if (!pola.test(fnCatat)) salah(`0153 \`catat_kas_di\`: "${nama}" tidak ada — penjaga yang terlupa saat fungsinya ditulis ulang.`);
  }
  // Holder Pusat adalah yang mencatat; holder kantong adalah PEMILIK kantong.
  if (!/v_holder := v_uid;/.test(fnCatat)) {
    salah('0153 `catat_kas_di`: entri Pusat tidak punya pemegang — `holder_id` NOT NULL akan menolaknya dengan pesan tentang kolom.');
  }
  if (!/select holder_id, is_active into v_holder, v_aktif from cash_accounts/.test(fnCatat)) {
    salah('0153 `catat_kas_di`: holder tidak lagi diambil dari kantongnya — entri akan tercatat atas nama yang MENCATAT, bukan pemilik kasnya.');
  }

  // ---------------------------------------------------------------
  // 5. Ekspor & pemindahan kantong.
  // ---------------------------------------------------------------
  const fnEsb = fnSql(sql, 'create function kas_untuk_esb(');
  if (!/ce\.dibayar_pusat,/.test(fnEsb)) {
    salah('0153 `kas_untuk_esb`: tandanya tidak ikut dikembalikan — entri Pusat tertahan dengan alasan "kantongnya belum punya outlet".');
  }
  if (!/label_kantong_kas\(ca\.name, ce\.dibayar_pusat\)/.test(fnEsb)) {
    salah('0153 `kas_untuk_esb`: nama kantongnya tidak lewat `label_kantong_kas`.');
  }
  for (const [nama, pola] of [
    ['untuk_nota', /and ce\.untuk_nota = false/],
    ['penyesuaian_nota', /and ce\.penyesuaian_nota is null/],
    ['dicoret', /and ce\.dicoret_at is null/],
    ['sumbu outlet', /and o\.business_unit_id = p_bu/],
    ['wewenang outlet', /and is_admin_of_outlet\(auth\.uid\(\), ce\.outlet_id\)/],
    ['kantong LEFT JOIN', /left join cash_accounts ca on ca\.id = ce\.account_id/],
    ['outlet kantong LEFT JOIN', /left join outlets ko on ko\.id = ca\.outlet_id/]
  ]) {
    if (!pola.test(fnEsb)) salah(`0153 \`kas_untuk_esb\`: penjaga "${nama}" HILANG saat fungsinya ditulis ulang.`);
  }
  const fnUbahKantong = fnSql(sql, 'create or replace function ubah_kantong_kas(');
  if (!/and not c\.dibayar_pusat/.test(fnUbahKantong)) {
    salah('0153 `ubah_kantong_kas`: baris Pusat bisa diberi kantong — pernyataan yang salah, dan constraint-nya menolaknya dengan pesan tentang nama constraint.');
  }
  if (!/and alasan_tolak_koreksi_kas\(c\.id\) is null/.test(fnUbahKantong)) {
    salah('0153 `ubah_kantong_kas`: penjaga 0152 HILANG saat fungsinya ditulis ulang.');
  }
}

// ---------------------------------------------------------------
// 6. Modul aturannya.
// ---------------------------------------------------------------
const modul = baca('js/modules/cash/kantong-wajib.js');
if (modul) {
  const kode = bersih(modul, 'kantong-wajib.js', ['export function sumberDana']);
  if (!/export const BAYAR_PUSAT = '__pusat__';/.test(kode)) {
    salah('kantong-wajib.js: penanda Pusat berubah bentuk. Sentinel bernama, bukan uuid nol — uuid nol terlihat seperti id sungguhan di log dan di URL.');
  }
  if (!/return pilihPusat\(nilai\) \? \{ accountId: null, dibayarPusat: true \}/.test(kode)) {
    salah(
      'kantong-wajib.js: `sumberDana` bisa mengirim `accountId` bersama `dibayarPusat`. Database menolaknya lewat ' +
        'constraint yang pesannya berbicara tentang nama constraint, bukan tentang uang.'
    );
  }
  if (!/if \(pilihPusat\(v\)\) return jenis === 'in'/.test(kode)) {
    salah('kantong-wajib.js: Pusat diterima untuk kas MASUK — uang masuk yang "dibayar pusat" tidak berarti apa-apa.');
  }
  if (!/if \(entri\?\.dibayar_pusat\) return NAMA_PUSAT;/.test(kode)) {
    salah('kantong-wajib.js: baris Pusat dinamai "Kas Utama" di tabel — berbeda dari `label_kantong_kas` di database, untuk baris yang sama.');
  }
  if (!/if \(entri\?\.dibayar_pusat\) return false;/.test(kode)) {
    salah('kantong-wajib.js: baris Pusat ditandai perlu dibereskan — menyuruh orang membetulkan sesuatu yang sudah benar.');
  }
}

// ---------------------------------------------------------------
// 7. Ekspor: kunci COA `pusat`.
// ---------------------------------------------------------------
const murni = baca('js/modules/inventory/esb-disbursement.js');
if (murni) {
  const kode = bersih(murni, 'esb-disbursement.js', ['dibayar_pusat']);
  if (!/if \(c\.dibayar_pusat\) \{/.test(kode)) {
    salah('esb-disbursement.js: entri Pusat tidak punya cabangnya sendiri — ia tertahan dengan alasan "kantongnya belum punya outlet".');
  }
  if (!/peta\?\.coa\?\.get\?\.\(normalNama\('pusat'\)\)/.test(kode)) {
    salah("esb-disbursement.js: entri Pusat tidak memakai kunci COA 'pusat' — cara bayar yang sudah punya barisnya sendiri di pemetaan sejak lama.");
  }
  if (!/catat\('coa', 'pusat', kode\)/.test(kode)) {
    salah('esb-disbursement.js: `pusat` yang belum dipetakan tertahan dengan alasan yang salah — menyuruh orang menempeli outlet pada kantong yang tidak ada.');
  }
}

const svcEsb = baca('js/modules/inventory/esb.service.js');
if (svcEsb) {
  const kode = tanpaKomentar(svcEsb);
  if (!/dibayar_pusat: c\.dibayar_pusat === true/.test(kode)) {
    salah('esb.service.js: tanda Pusat tidak diteruskan dari RPC — SELURUH entri Pusat tertahan, diam-diam.');
  }
}

// ---------------------------------------------------------------
// 8. Layar & layanan.
// ---------------------------------------------------------------
const svc = baca('js/modules/cash/cash.service.js');
if (svc) {
  const kode = bersih(svc, 'cash.service.js', ['export async function catatKasKeluar']);
  if (!/p_supplier: supplier \?\? null/.test(kode) || !/p_dibayar_pusat: !!dibayarPusat/.test(kode)) {
    salah('cash.service.js: `catatKasDi` tidak mengirim `p_supplier`/`p_dibayar_pusat` — PostgREST akan memilih tanda tangan yang sudah tidak ada.');
  }
  if (!/argumenRpc\(\{\s*p_account: accountId/.test(kode)) {
    salah(
      'cash.service.js: `catatKasDi` tidak lewat `argumenRpc`. `JSON.stringify` membuang kunci ber-nilai `undefined`, ' +
        'dan permintaan yang kehilangan satu nama argumen memilih overload yang berbeda.'
    );
  }
  // Fotonya dibuang lagi kalau RPC-nya gagal.
  // Diikat ke BLOK CATCH-nya, bukan ke potongan `remove([path])` saja:
  // `recordCashEntry` punya baris yang bentuknya sama persis, dan pola polos
  // akan menemukan yang itu — hijau, padahal `catatKasKeluar` sudah kehilangan
  // pembersihnya.
  if (!/\} catch \(e\) \{\s*await supabase\.storage\.from\('cash-proofs'\)\.remove\(\[path\]\)/.test(kode)) {
    salah('cash.service.js: `catatKasKeluar` meninggalkan foto yatim di Storage kalau RPC-nya gagal — tidak pernah ditemukan siapa pun, tidak pernah dihapus.');
  }
  // Query mutasi admin ikut mengambil tandanya.
  const i = kode.indexOf('listCashEntriesAdmin');
  const blok = i < 0 ? '' : kode.slice(i, i + 4000);
  if (!/dibayar_pusat/.test(blok)) {
    salah('cash.service.js: `listCashEntriesAdmin` tidak mengambil `dibayar_pusat` — kolom Kantong menyebutnya "Kas Utama" dan menandainya merah.');
  }
}

const hal = baca('js/modules/cash/cash.page.js');
if (hal) {
  const kode = bersih(hal, 'cash.page.js', ['async function openKeluar']);
  if (!/await catatKasKeluar\(\{/.test(kode)) {
    salah(
      'cash.page.js: form Kas Keluar tidak lewat `catatKasKeluar`. `.insert()` langsung menyimpan `holder_id = aku`, ' +
        'padahal uangnya keluar dari kas orang lain — dan saldo yang salah itu tidak melempar apa pun.'
    );
  }
  if (!/const \{ accountId, dibayarPusat \} = sumberDana\(values\.account_id\);/.test(kode)) {
    salah('cash.page.js: penerjemahan pilihan layar ditulis ulang di layar alih-alih diambil dari `sumberDana`.');
  }
  if (!/opsiKantong\(bisaDibebani, \{ pusat: true \}\)/.test(kode)) {
    salah('cash.page.js: pilihan "Dibayar Pusat" tidak digambar — kemampuannya ada di database, jalannya tidak ada di layar.');
  }
}

console.log('');
if (gagal === 0) console.log('Audit bayar-dari-kantong-lain & Pusat bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
