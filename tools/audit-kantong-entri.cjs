/**
 * AUDIT: kantong kas pada entri kas (0152).
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   gerbangnya kembali `limit > 1`   -> pemegang berjatah 1 tidak pernah
 *                                       ditanya kantongnya; seluruh entrinya
 *                                       mendarat di Kas Utama, tercatat penuh
 *                                       dan tidak bisa diekspor
 *   kas MASUK tidak ditanya          -> uang menumpuk di Kas Utama sementara
 *                                       belanjanya membebani kantong; saldo
 *                                       kantong jadi NEGATIF, keadaan yang
 *                                       mustahil di dunia nyata
 *   "Kas Utama" jadi pilihan         -> keadaan yang sedang diperbaiki
 *                                       ditawarkan sebagai jawaban yang sah
 *   syarat boleh-tidaknya disalin    -> dialog koreksi menolak sebuah entri
 *                                       sementara aksi massal menerimanya,
 *                                       untuk baris yang sama
 *   kantong milik orang lain lolos   -> saldo dua orang berubah sekaligus dan
 *                                       tidak ada layar yang menyebutnya
 *                                       transfer
 *   kolom Kantong tidak digambar     -> "2 tertahan" di layar ekspor, tanpa
 *                                       satu pun cara menemukan baris mana
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

// ---------------------------------------------------------------
// 1. Migration 0152.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0152_pindahkan_entri_ke_kantong.sql');
if (mig) {
  for (const [nama, tanda] of [
    ['kantong_pemegang', 'create or replace function kantong_pemegang(p_holder uuid)'],
    ['ubah_kantong_kas', 'create or replace function ubah_kantong_kas(p_entries uuid[], p_account uuid)']
  ]) {
    if (!mig.includes(tanda)) salah(`0152: \`${nama}\` tidak ada.`);
  }
  for (const fn of ['kantong_pemegang(uuid)', 'ubah_kantong_kas(uuid[], uuid)', 'boleh_koreksi_kas(uuid)']) {
    if (!mig.includes(`grant execute on function ${fn} to authenticated;`)) {
      salah(`0152: \`${fn}\` tidak bisa dipanggil siapa pun — RPC-nya balas 404, dan layarnya diam saja.`);
    }
    if (!mig.includes(`revoke all on function ${fn} from public;`)) {
      salah(`0152: \`${fn}\` masih terbuka untuk public.`);
    }
  }

  // ---- LUBANG NULL di `boleh_koreksi_kas` ----
  //
  // `p_holder = auth.uid()` bernilai NULL saat tidak ada sesi, jadi seluruh
  // ekspresinya NULL — dan `if not NULL` TIDAK menyalakan IF mana pun. Fungsi
  // yang jadi satu-satunya sumber jawaban "boleh atau tidak" tidak boleh
  // menjawab NULL.
  const iBoleh = mig.indexOf('function boleh_koreksi_kas');
  const fnBoleh = iBoleh < 0 ? '' : mig.slice(iBoleh, mig.indexOf('$$;', iBoleh));
  if (!fnBoleh) salah('0152: `boleh_koreksi_kas` tidak ditulis ulang — lubang NULL-nya tetap terbuka.');
  else {
    if (!/select coalesce\(/.test(fnBoleh)) {
      salah(
        '0152: `boleh_koreksi_kas` tidak dibungkus `coalesce` — tanpa sesi ia menjawab NULL, `not NULL` tidak ' +
          'menyalakan IF, dan pemanggil tanpa sesi dinyatakan BOLEH.'
      );
    }
    // Ketiga penjaga lamanya HARUS ikut terbawa. Menulis ulang fungsi berarti
    // mengetik ulang seluruh isinya, dan yang terlupa di sini berbentuk
    // "admin BU mendadak tidak bisa mengoreksi apa pun".
    for (const [nama, pola] of [
      ['super admin', /is_super_admin\(auth\.uid\(\)\)/],
      ['pemegangnya sendiri', /p_holder = auth\.uid\(\)/],
      ['admin BU', /is_bu_admin\(auth\.uid\(\), ms\.business_unit_id\)/]
    ]) {
      if (!pola.test(fnBoleh)) {
        salah(`0152: penjaga "${nama}" HILANG saat \`boleh_koreksi_kas\` ditulis ulang.`);
      }
    }
    // Syarat outlet TIDAK boleh muncul — kas masuk tidak punya peruntukan.
    //
    // Dibaca dari SQL yang komentarnya dibuang. Versi pertama membaca berkas
    // mentah, dan komentar yang MENJELASKAN kenapa outlet tidak boleh disebut
    // membuat audit ini merah terhadap dirinya sendiri. Bentuk kegagalan yang
    // sama pernah membuat `audit-disbursement` HIJAU karena alasan terbalik.
    const fnBolehKode = fnBoleh.replace(/--[^\n]*/g, '');
    if (/outlet/.test(fnBolehKode)) {
      salah('0152 `boleh_koreksi_kas`: menyebut outlet. Kas masuk `outlet_id`-nya NULL, jadi syarat itu menutup SELURUH baris kas masuk.');
    }
  }

  const iUbah = mig.indexOf('function ubah_kantong_kas');
  const fnUbah = iUbah < 0 ? '' : mig.slice(iUbah, mig.indexOf('$$;', iUbah));
  // SYARATNYA MENUMPANG, tidak disalin.
  if (!/and alasan_tolak_koreksi_kas\(c\.id\) is null/.test(fnUbah)) {
    salah(
      '0152 `ubah_kantong_kas`: syarat boleh-tidaknya tidak menumpang `alasan_tolak_koreksi_kas`. Daftar yang ' +
        'disalin akan menyimpang, dan menyimpangnya berbentuk dialog koreksi menolak baris yang aksi massal ini terima.'
    );
  }
  if (!/and c\.holder_id = v_akun\.holder_id/.test(fnUbah)) {
    salah(
      '0152 `ubah_kantong_kas`: kantong tidak diwajibkan milik pemegang entrinya. Uang seseorang bisa pindah ke ' +
        'kantong orang lain — saldo keduanya berubah sekaligus, dan tidak ada layar yang menyebutnya transfer.'
    );
  }
  if (!/and c\.account_id is distinct from p_account/.test(fnUbah)) {
    salah('0152 `ubah_kantong_kas`: baris yang sudah di kantong itu ikut ditulisi jejak perubahan yang tidak pernah terjadi.');
  }
  if (!/if p_account is null then/.test(fnUbah)) {
    salah('0152 `ubah_kantong_kas`: memindahkan KEMBALI ke Kas Utama diterima — itu justru keadaan yang sedang dibereskan.');
  }
  if (!/if not v_akun\.is_active then/.test(fnUbah)) {
    salah('0152 `ubah_kantong_kas`: kantong nonaktif diterima — uangnya pindah ke kantong yang tidak muncul di layar mana pun.');
  }
  if (!/if not boleh_koreksi_kas\(v_akun\.holder_id\) then/.test(fnUbah)) {
    salah('0152 `ubah_kantong_kas`: wewenang atas kantong tujuannya tidak diperiksa.');
  }
  if (!/diubah_by = v_uid/.test(fnUbah) || !/diubah_at = now\(\)/.test(fnUbah)) {
    salah('0152 `ubah_kantong_kas`: tidak meninggalkan jejak siapa yang memindahkan.');
  }
  if (!/returns int/.test(mig.slice(iUbah, iUbah + 200))) {
    salah('0152 `ubah_kantong_kas`: tidak mengembalikan jumlah baris — layarnya tidak bisa membedakan "3 dipindahkan" dari "0 dipindahkan".');
  }

  const iDaftar = mig.indexOf('function kantong_pemegang');
  const fnDaftar = iDaftar < 0 ? '' : mig.slice(iDaftar, mig.indexOf('$$;', iDaftar));
  if (!/and boleh_koreksi_kas\(p_holder\)/.test(fnDaftar)) {
    salah('0152 `kantong_pemegang`: siapa pun bisa membaca kantong siapa pun. Fungsinya `security definer`.');
  }
  if (!/and a\.is_active/.test(fnDaftar)) {
    salah('0152 `kantong_pemegang`: kantong nonaktif ikut ditawarkan sebagai tujuan.');
  }
}

// ---------------------------------------------------------------
// 2. Modul aturannya.
// ---------------------------------------------------------------
const modul = baca('js/modules/cash/kantong-wajib.js');
if (modul) {
  const kode = bersih(modul, 'kantong-wajib.js', ['export function kantongWajib']);
  // GERBANGNYA: punya kantong, bukan jatahnya.
  if (!/return Array\.isArray\(kantong\) && kantong\.length > 0;/.test(kode)) {
    salah(
      'kantong-wajib.js: gerbangnya bukan lagi "punya kantong". Kalau ia kembali membaca jatah, pemegang berjatah 1 ' +
        'tidak pernah ditanya kantongnya dan seluruh entrinya mendarat di Kas Utama.'
    );
  }
  if (/limit/.test(kode)) {
    salah('kantong-wajib.js: menyebut `limit` (jatah). Jatah menjawab "berapa banyak boleh punya", bukan "apakah perlu ditanya".');
  }
  // "Kas Utama" tidak pernah jadi pilihan.
  const iOpsi = kode.indexOf('export function opsiKantong');
  const fnOpsi = iOpsi < 0 ? '' : kode.slice(iOpsi, iOpsi + 700);
  if (/NAMA_TANPA_KANTONG/.test(fnOpsi)) {
    salah('kantong-wajib.js: "Kas Utama" ikut jadi pilihan — keadaan yang sedang diperbaiki ditawarkan sebagai jawaban yang sah.');
  }
  // Kantong tanpa outlet TETAP ditawarkan.
  if (!/hint: k\.outlet_id \? namaOutlet\(k\) : HINT_TANPA_OUTLET/.test(kode)) {
    salah(
      'kantong-wajib.js: kantong tanpa outlet dibuang dari daftar. Orang yang seluruh kantongnya belum ber-outlet ' +
        'akan menghadapi dropdown kosong yang wajib diisi — form yang tidak bisa disimpan.'
    );
  }
  if (!/if \(!kantongWajib\(kantong\)\) return null;/.test(kode)) {
    salah('kantong-wajib.js: yang belum punya kantong ikut ditolak — pengeluaran jam 9 malam jadi tidak tercatat sama sekali.');
  }
}

// ---------------------------------------------------------------
// 3. Layar Kas staff — DUA arah, dan arah kedua yang biasanya terlewat.
// ---------------------------------------------------------------
const hal = baca('js/modules/cash/cash.page.js');
if (hal) {
  const kode = bersih(hal, 'cash.page.js', ['async function openKeluar', 'async function openMasuk']);
  // Kas MASUK ikut ditanya. Tanpa itu keadaannya justru MEMBURUK: uang masuk
  // menumpuk di Kas Utama sementara belanjanya membebani kantong.
  // Kas MASUK bertanya dari kantong SENDIRI (`accounts`); kas KELUAR dari
  // kantong yang boleh dibebani (`bisaDibebani`, 0153) — daftar yang berbeda,
  // pertanyaan yang sama. Dihitung bersama supaya mencabut salah satunya tidak
  // bisa disembunyikan di balik yang lain.
  const nTanya = (kode.match(/kantongWajib\((?:accounts|bisaDibebani)\)/g) ?? []).length;
  if (nTanya < 2) {
    salah(
      `cash.page.js: kantong cuma ditanyakan di ${nTanya} dari 2 arah (Kas Masuk & Kas Keluar). Kalau hanya kas ` +
        'keluar yang diwajibkan, uang masuk menumpuk di Kas Utama sementara belanjanya membebani kantong — dan ' +
        'saldo kantongnya jadi negatif, keadaan yang mustahil di dunia nyata.'
    );
  }
  // Dan kas keluar HARUS memakai daftar yang lebih luas — kalau ia kembali ke
  // `accounts`, kantong outlet lain hilang dari pilihannya tanpa satu pun galat.
  if (!/kantongWajib\(bisaDibebani\)/.test(kode) || !/opsiKantong\(bisaDibebani, \{ pusat: true \}\)/.test(kode)) {
    salah(
      'cash.page.js: form Kas Keluar tidak memakai daftar kantong yang boleh dibebani + pilihan Pusat. Izinnya ada ' +
        'di database sejak 0126; tanpa daftarnya di layar, kemampuan itu tidak bisa dicapai dari mana pun.'
    );
  }
  if (!/listKantongBisaKubebani\(\)\.catch\(\(\) => \[\]\)/.test(kode)) {
    salah('cash.page.js: daftar kantong yang boleh dibebani tidak dimuat, atau kegagalannya tidak ditangkap.');
  }
  const nPeriksa = (kode.match(/periksaKantong\(/g) ?? []).length;
  if (nPeriksa < 2) {
    salah(`cash.page.js: isian kantong cuma diperiksa di ${nPeriksa} dari 2 arah.`);
  }
  if (/pakaiKantong/.test(kode)) {
    salah(
      'cash.page.js: `pakaiKantong` (jatah > 1) hidup lagi. Ia menjawab pertanyaan yang salah — pemegang berjatah 1 ' +
        'yang sudah punya kantong tidak pernah ditanya, tidak melihat kolom Kantong, dan tidak punya ⇄ Pindah Kas.'
    );
  }
  // ⇄ Pindah Kas digantung pada PUNYA kantong, bukan jatah: tanpa itu uang di
  // Kas Utama terkunci di sana.
  if (!/\$\{punyaKantong \? '<button id="cash-move">/.test(kode)) {
    salah('cash.page.js: tombol ⇄ Pindah Kas masih digantung pada jatah — uang yang terlanjur di Kas Utama terkunci di sana.');
  }
}

// ---------------------------------------------------------------
// 4. Mutasi Kas admin — kolomnya, dan aksi yang membereskannya.
// ---------------------------------------------------------------
const adm = baca('js/modules/cash/cash.admin.page.js');
if (adm) {
  const kode = bersih(adm, 'cash.admin.page.js', ['cm-pindah-kantong']);
  // Header TABEL MUTASI, bukan sekadar teks "Kantong": tab Kantong Kas di
  // halaman yang sama punya kolom bernama persis sama, dan mencari teksnya
  // saja membuat audit ini hijau walau kolomnya dicabut dari tabel mutasi.
  if (!/<th>Pemegang<\/th><th>Kantong<\/th><th>Jenis<\/th>/.test(kode)) {
    salah(
      'cash.admin.page.js: kolom Kantong tidak digambar. Layar ekspor berkata "2 tertahan" dan tidak ada satu pun ' +
        'cara di layar ini untuk tahu baris mana itu.'
    );
  }
  if (!/tanpaKantong\(r\)/.test(kode)) {
    salah('cash.admin.page.js: baris tanpa kantong tidak ditandai — ia terbaca sama saja dengan baris yang sudah benar.');
  }
  if (!/ubahKantongKas\(ids, v\.account_id\)/.test(kode)) {
    salah('cash.admin.page.js: tidak ada jalan memindahkan entri ke kantong — jalan keluarnya kembali jadi SQL Editor.');
  }
  // SATU PEMEGANG SAJA, dikatakan SEBELUM dialognya dibuka.
  if (!/if \(pemegang\.length !== 1\)/.test(kode)) {
    salah(
      'cash.admin.page.js: entri beberapa pemegang bisa dicentang sekaligus. Database menolak sebagian, dan hasilnya ' +
        '"3 dari 7 dipindahkan" yang tidak menjelaskan apa-apa.'
    );
  }
  // DIHITUNG. Tabel ini punya DUA aksi massal — "Isi Supplier" dan
  // "Pindahkan ke kantong" — dan keduanya menulis baris pembanding yang
  // bentuknya identik. Mencari satu kemunculan membuat audit ini tetap hijau
  // saat pembanding salah satunya dicabut: yang ketemu milik aksi yang lain.
  const nBanding = (kode.match(/if \(n === ids\.length\)/g) ?? []).length;
  if (nBanding < 2) {
    salah(
      `cash.admin.page.js: hasil aksi massal cuma dibandingkan dengan yang dicentang di ${nBanding} dari 2 aksi. ` +
        '"0 dipindahkan" akan dilaporkan sebagai berhasil, dan yang membacanya mengira pekerjaannya selesai.'
    );
  }
  // Kolom kantongnya ikut diambil query-nya.
  const svc = baca('js/modules/cash/cash.service.js');
  if (svc) {
    const k2 = tanpaKomentar(svc);
    const i = k2.indexOf('listCashEntriesAdmin');
    const blok = i < 0 ? '' : k2.slice(i, i + 4000);
    if (!/cash_accounts\(name\)/.test(blok)) {
      salah('cash.service.js: `listCashEntriesAdmin` tidak mengambil `cash_accounts(name)` — kolom Kantong digambar kosong untuk semua baris.');
    }
    if (!/rpc\('ubah_kantong_kas'/.test(k2)) salah('cash.service.js: `ubahKantongKas` tidak lewat RPC-nya.');
    if (!/rpc\('kantong_pemegang'/.test(k2)) salah('cash.service.js: `kantongPemegang` tidak lewat RPC-nya.');
  }
}

console.log('');
if (gagal === 0) console.log('Audit kantong entri kas bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
