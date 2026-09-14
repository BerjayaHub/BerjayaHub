/**
 * AUDIT: koreksi kas + akses admin BU (0141).
 *
 * ============ CARA FITUR INI BISA RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   satu tempat lupa menyaring `dicoret_at`  -> saldo di satu layar berbeda dari
 *                                               layar sebelahnya, tanpa error
 *   aturan izin disalin ke klien             -> tombol yang hidup lalu selalu
 *                                               ditolak, atau hilang untuk entri
 *                                               yang sebenarnya boleh
 *   `boleh_koreksi_kas` menyebut outlet      -> kasus Seruni tertutup kembali,
 *                                               dan gejalanya cuma "tidak bisa"
 *   entri pembayaran nota boleh diubah       -> nota tetap LUNAS dengan angka
 *                                               yang tidak cocok
 *   dialog admin tidak mengirim kategori/qty -> `ubah_kas` menulis PENUH, jadi
 *                                               field itu TERHAPUS (bug 0119)
 *   layar kas masih memakai embed outlets    -> kolom Outlet kembali kosong
 *
 * Tidak satu pun melempar error.
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

/** Komentar SATU BARIS PENUH dibuang sebelum SQL diperiksa (jebakan 0137). */
const tanpaKomentarSql = (sql) => String(sql).replace(/^[ \t]*--.*$/gm, '');

/** Potongan antara dua penanda — bukan jendela sepanjang angka ajaib. */
const blokAntara = (teks, mulai, selesai) => {
  const i = teks.indexOf(mulai);
  if (i < 0) return '';
  const j = selesai ? teks.indexOf(selesai, i + mulai.length) : -1;
  return teks.slice(i, j > i ? j : undefined);
};

// ---------------------------------------------------------------
// 1. Migration 0141.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0141_koreksi_kas_dan_akses_admin_bu.sql');
if (mig) {
  const sql = tanpaKomentarSql(mig);

  for (const fn of ['boleh_koreksi_kas', 'alasan_tolak_koreksi_kas', 'alasan_tolak_koreksi_kas_banyak', 'ubah_kas', 'coret_kas', 'riwayat_kas_saya']) {
    if (!new RegExp(`function ${fn}\\(`).test(sql)) salah(`0141: fungsi \`${fn}\` tidak ada.`);
    if (!new RegExp(`grant execute on function ${fn}\\(`).test(sql)) {
      salah(`0141: \`${fn}\` tidak di-grant ke authenticated — layarnya akan menjawab 42501.`);
    }
  }

  for (const kolom of ['dicoret_at', 'dicoret_by', 'alasan_coret', 'diubah_at', 'diubah_by']) {
    // `create table if not exists` TIDAK menambah kolom ke tabel yang sudah ada;
    // tiap kolom baru wajib `alter table ... add column if not exists`. Sudah
    // menggigit di 0138 (`foto_selesai does not exist`).
    if (!new RegExp(`alter table cash_entries add column if not exists ${kolom}\\b`).test(sql)) {
      salah(`0141: kolom \`${kolom}\` tidak ditambahkan dengan \`add column if not exists\`.`);
    }
  }

  // IZIN: admin BU, TANPA menyebut outlet sama sekali.
  const blokIzin = blokAntara(sql, 'function boleh_koreksi_kas', 'grant execute on function boleh_koreksi_kas');
  if (!blokIzin) {
    salah('0141: badan `boleh_koreksi_kas` tidak ditemukan.');
  } else {
    for (const [apa, pola] of [
      ['super admin', /is_super_admin\(auth\.uid\(\)\)/],
      ['pemegangnya sendiri', /p_holder = auth\.uid\(\)/],
      ['admin BU pemegangnya', /is_bu_admin\(auth\.uid\(\), ms\.business_unit_id\)/]
    ]) {
      if (!pola.test(blokIzin)) salah(`0141 \`boleh_koreksi_kas\`: cabang "${apa}" hilang.`);
    }
    // TIDAK BOLEH MENYEBUT OUTLET SAMA SEKALI.
    //
    // Kas MASUK tidak punya peruntukan (0063): `outlet_id`-nya NULL. Syarat
    // outlet apa pun akan diam-diam menutup SELURUH baris kas masuk sementara
    // kas keluar tetap terbuka — laporan yang separuhnya hilang tanpa pesan apa
    // pun, dan angkanya tetap terlihat wajar. Bug yang persis sama sudah
    // terjadi di `laporan_kas_user` dan diperbaiki di 0063.
    if (/outlet/i.test(blokIzin)) {
      salah(
        '0141 `boleh_koreksi_kas`: ada syarat OUTLET di dalamnya. Aturannya harus murni per-BU — ' +
          'kas MASUK tidak punya outlet peruntukan, jadi syarat outlet akan menutup seluruh barisnya diam-diam.'
      );
    }
  }

  // SEBAB PENOLAKAN: satu tempat, dipakai kedua RPC.
  const blokTolak = blokAntara(sql, 'function alasan_tolak_koreksi_kas(', 'grant execute on function alasan_tolak_koreksi_kas(');
  if (!blokTolak) {
    salah('0141: badan `alasan_tolak_koreksi_kas` tidak ditemukan.');
  } else {
    if (!/payment_entry_id = p_entry/.test(blokTolak)) {
      salah(
        '0141: entri pembayaran nota tidak lagi ditolak. Mengubahnya dari modul Kas meninggalkan nota berstatus ' +
          'LUNAS dengan angka yang tidak cocok, dan tidak ada layar yang menunjukkan ketidakcocokan itu.'
      );
    }
    if (!/Batalkan Pembayaran/.test(blokTolak)) {
      salah('0141: penolakan pembayaran nota tidak menunjuk jalan keluarnya — penolakan tanpa jalan keluar terbaca sebagai aplikasi rusak.');
    }
    if (!/entry_type not in \('in', 'out'\)/.test(blokTolak)) {
      salah('0141: transfer & pindah antar kantong tidak ditolak — mengubah satu sisi membuat uang muncul atau lenyap di antara pasangannya.');
    }
    if (!/penyesuaian_nota is not null/.test(blokTolak)) {
      salah('0141: entri penyesuaian nota (0131) tidak ditolak, padahal nilainya diturunkan dari selisih notanya.');
    }
    if (!/dicoret_at is not null/.test(blokTolak)) {
      salah('0141: entri yang sudah dicoret masih bisa dikoreksi lagi.');
    }
    if (!/not boleh_koreksi_kas\(v\.holder_id\)/.test(blokTolak)) {
      salah('0141: sebab penolakan tidak memanggil `boleh_koreksi_kas` — aturan izinnya jadi disalin, bukan dibagi.');
    }
  }

  // Kedua RPC WAJIB lewat sebab penolakan yang sama.
  for (const fn of ['ubah_kas', 'coret_kas']) {
    const blok = blokAntara(sql, `function ${fn}(`, `grant execute on function ${fn}(`);
    if (!blok) salah(`0141: badan \`${fn}\` tidak ditemukan.`);
    else if (!/v_tolak := alasan_tolak_koreksi_kas\(p_entry\)/.test(blok)) {
      salah(`0141 \`${fn}\`: tidak memeriksa \`alasan_tolak_koreksi_kas\` — penjaganya jadi cuma ada di layar.`);
    }
  }

  // TANDA NOMINAL mengikuti jenis entrinya, bukan apa yang dikirim layar.
  if (!/case when v_type = 'out' then -abs\(p_amount\) else abs\(p_amount\) end/.test(sql)) {
    salah(
      '0141 `ubah_kas`: tanda nominal tidak lagi dipaksa mengikuti jenis entrinya. Layar yang keliru mengirim angka ' +
        'positif untuk kas keluar akan MENAMBAH saldo, dan angkanya tetap terlihat wajar di tabel.'
    );
  }
  if (!/raise exception 'Sebutkan alasan penghapusannya/.test(sql)) {
    salah('0141 `coret_kas`: alasan tidak lagi wajib — entri yang dihapus tanpa alasan tidak bisa dibedakan dari kesalahan sistem.');
  }
  // CORET, bukan DELETE.
  if (/delete from cash_entries/.test(sql)) {
    salah('0141: ada `delete from cash_entries`. Baris yang dibuang tidak bisa menyimpan jejak "dihapus oleh siapa" — dan jejak itulah yang diminta.');
  }

  // SEMUA tempat yang menjumlahkan saldo wajib menyaring yang dicoret.
  for (const [tempat, pola] of [
    ['view cash_balances', /create view cash_balances[\s\S]{0,400}?where dicoret_at is null/],
    ['view cash_account_balances', /create view cash_account_balances[\s\S]{0,700}?where ce\.dicoret_at is null/],
    ['daftar_kantong_kas', /function daftar_kantong_kas[\s\S]{0,1200}?where ce\.dicoret_at is null/],
    ['laporan_kas_user', /function laporan_kas_user[\s\S]{0,2000}?and ce\.dicoret_at is null/],
    ['rincian_mutasi_kas', /function rincian_mutasi_kas[\s\S]{0,2000}?and ce\.dicoret_at is null/]
  ]) {
    if (!pola.test(sql)) {
      salah(
        `0141: \`${tempat}\` tidak menyaring entri yang dicoret. Satu tempat yang terlewat tidak melempar error — ` +
          'ia cuma menjawab angka yang berbeda dari tetangganya, dan yang membacanya tidak punya cara tahu mana yang benar.'
      );
    }
  }

  // RLS admin BU.
  // NAMANYA DISEBUT LENGKAP SAMPAI ` on cash_entries`.
  //
  // Percobaan pertama mencari `create policy cash_entries_select_bu_admin` saja,
  // dan sabotase yang menamainya `..._bu_admin_nonaktif` LOLOS — nama yang
  // dicari masih jadi AWALAN nama barunya, jadi `indexOf` tetap menemukannya
  // dan seluruh pemeriksaan di bawah lulus untuk kebijakan yang sudah tidak ada.
  const blokRls = blokAntara(sql, 'create policy cash_entries_select_bu_admin on cash_entries', ';');
  if (!blokRls) salah('0141: kebijakan `cash_entries_select_bu_admin` tidak ada — admin BU tidak akan melihat satu baris pun.');
  else if (!/is_bu_admin\(auth\.uid\(\), ms\.business_unit_id\)/.test(blokRls)) {
    salah('0141: kebijakan admin BU tidak memakai `is_bu_admin` — cakupannya jadi salah.');
  }
  // Kebijakan LAMA tidak boleh ikut terhapus.
  if (/drop policy if exists cash_entries_select_own/.test(sql) || /drop policy if exists cash_entries_select_super/.test(sql)) {
    salah('0141: kebijakan lama (`_own` / `_super`) ikut dihapus — pemegang atau super admin akan kehilangan aksesnya diam-diam.');
  }

  // Kolom Outlet: diselesaikan di server.
  const blokRiwayat = blokAntara(sql, 'function riwayat_kas_saya(', 'grant execute on function riwayat_kas_saya(');
  if (!blokRiwayat) {
    salah('0141: badan `riwayat_kas_saya` tidak ditemukan.');
  } else {
    if (!/security definer/.test(blokRiwayat)) {
      salah(
        '0141 `riwayat_kas_saya`: bukan `security definer`. Seluruh gunanya adalah menyelesaikan nama outlet yang ' +
          'RLS `outlets_select` tidak buka untuk pemegangnya — sebagai invoker ia mengembalikan kolom kosong yang sama.'
      );
    }
    if (!/left join outlets o on o\.id = ce\.outlet_id/.test(blokRiwayat)) {
      salah('0141 `riwayat_kas_saya`: nama outletnya tidak diambil — kolom Outlet akan kosong lagi.');
    }
    if (!/where ce\.holder_id = auth\.uid\(\)/.test(blokRiwayat)) {
      salah('0141 `riwayat_kas_saya`: tidak dibatasi ke pemanggilnya — fungsi definer tanpa batas ini membuka kas semua orang.');
    }
    // Entri yang dicoret IKUT di sini: modul Kas satu-satunya tempat koreksinya
    // bisa dibaca.
    if (/dicoret_at is null/.test(blokRiwayat)) {
      salah('0141 `riwayat_kas_saya`: entri yang dicoret ikut disaring keluar — jejak koreksinya jadi tidak bisa dilihat siapa pun.');
    }
    if (!/alasan_tolak_koreksi_kas\(ce\.id\)/.test(blokRiwayat)) {
      salah('0141 `riwayat_kas_saya`: `alasan_tolak` tidak ikut — layar terpaksa menebak sendiri tombol mana yang boleh digambar.');
    }
  }
}

// ---------------------------------------------------------------
// 2. Modul murni.
// ---------------------------------------------------------------
const murni = baca('js/modules/cash/koreksi-kas.js');
if (murni) {
  const kode = bersih(murni, 'koreksi-kas.js', ['export function keadaanKoreksi', 'export function totalKas']);

  for (const n of ['keadaanKoreksi', 'jejakKoreksi', 'nominalEfektif', 'totalKas']) {
    if (!new RegExp(`export function ${n}\\(`).test(kode)) salah(`koreksi-kas.js: \`${n}\` tidak diekspor.`);
  }
  if (!/if \(e\?\.dicoret_at\) return 0;/.test(kode)) {
    salah('koreksi-kas.js: entri yang dicoret tidak lagi bernilai nol — total di layar akan berselisih dengan saldo di kartu atasnya.');
  }
  // ATURANNYA MILIK SERVER. Klien yang menirunya akan menyimpang.
  if (!/bolehKoreksi: !dicoret && !alasanTolak/.test(kode)) {
    salah(
      'koreksi-kas.js: keputusan boleh/tidak tidak lagi diturunkan dari `alasan_tolak` server. ' +
        'Aturan yang ditiru di klien menyimpang cepat atau lambat, dan gejalanya tombol yang hilang untuk entri yang sah.'
    );
  }
  for (const larangan of [/payment_entry_id/, /untuk_nota/, /is_bu_admin/]) {
    if (larangan.test(kode)) {
      salah(`koreksi-kas.js: memuat \`${larangan.source}\` — aturan izin/nota disalin ke klien, padahal tempatnya di server.`);
    }
  }
  if (!/Number\.isFinite\(n\) \? n : 0/.test(kode)) {
    salah('koreksi-kas.js: nominal non-finite tidak disaring — `Infinity` lolos ke formatRupiah sebagai "Rp∞".');
  }
}

// ---------------------------------------------------------------
// 3. Layanan.
// ---------------------------------------------------------------
const svc = baca('js/modules/cash/cash.service.js');
if (svc) {
  const kode = bersih(svc, 'cash.service.js', [
    'export async function riwayatKasSaya',
    'export async function ubahKas',
    'export async function coretKas'
  ]);

  for (const n of ['riwayatKasSaya', 'ubahKas', 'coretKas', 'alasanTolakKoreksiKas']) {
    if (!new RegExp(`export async function ${n}\\(`).test(kode)) salah(`cash.service.js: \`${n}\` tidak ada.`);
  }
  if (!/rpc\('riwayat_kas_saya'/.test(kode)) {
    salah('cash.service.js: riwayat kas tidak lagi lewat RPC — embed PostgREST mengembalikan kolom Outlet kosong untuk entri lintas outlet.');
  }

  // `ubah_kas` menulis PENUH: daftar kolom admin WAJIB membawa field yang
  // dialognya tidak tampilkan, kalau tidak field itu terhapus (bug 0119).
  const blokAdmin = blokAntara(kode, 'export async function listCashEntriesAdmin', '\n}\n');
  if (!blokAdmin) {
    salah('cash.service.js: `listCashEntriesAdmin` tidak ada.');
  } else {
    for (const kolom of ['category_id', 'qty', 'unit', 'outlet_id', 'penyesuaian_nota', 'dicoret_at']) {
      if (!blokAdmin.includes(kolom)) {
        salah(
          `cash.service.js \`listCashEntriesAdmin\`: kolom \`${kolom}\` tidak diambil. ` +
            '`ubah_kas` menulis PENUH — field yang tidak dikirim akan TERHAPUS, dan itu bug 0119 dalam bentuk lain.'
        );
      }
    }
    // Nama penghapus/pengubah diratakan ke nama yang sama dengan RPC, supaya
    // modul murni bisa dipakai apa adanya oleh kedua layar.
    if (!/dicoret_oleh: r\.pencoret\?\.full_name/.test(blokAdmin)) {
      salah(
        'cash.service.js `listCashEntriesAdmin`: nama penghapus tidak diratakan ke `dicoret_oleh`. ' +
          'Jejak "dihapus oleh siapa" akan muncul di Staff App dan hilang di Admin Portal — justru di layar yang dipakai memeriksanya.'
      );
    }
  }
}

// ---------------------------------------------------------------
// 4. Menu admin: Kas berdiri sendiri & bukan super-admin-only.
// ---------------------------------------------------------------
const tabs = baca('js/core/admin-tabs.js');
if (tabs) {
  const kode = bersih(tabs, 'admin-tabs.js', ['ADMIN_TAB_CATALOG']);
  const baris = (kode.match(/\{[^{}]*'cash_ledger'[^{}]*\}/) ?? [''])[0];
  if (!baris) salah("admin-tabs.js: entri 'cash_ledger' hilang dari katalog.");
  else {
    if (/superAdminOnly/.test(baris)) {
      salah("admin-tabs.js: 'cash_ledger' masih `superAdminOnly` — izinnya tidak akan pernah bisa diberikan ke admin BU.");
    }
    if (/group: 'User'/.test(baris)) {
      salah(
        "admin-tabs.js: 'cash_ledger' masih di grup 'User'. Grup itu khusus super admin, jadi Kas ikut tersembunyi " +
          'dari orang yang justru sedang diberi aksesnya.'
      );
    }
  }
}

const mainAdmin = baca('js/main-admin.js');
if (mainAdmin) {
  const kode = bersih(mainAdmin, 'main-admin.js', ['CORE_ADMIN_MENU', 'const GROUPS']);
  const grpUser = blokAntara(kode, 'grp_user:', 'grp_inventory:');
  if (grpUser && /cash_ledger/.test(grpUser)) {
    salah("main-admin.js: 'cash_ledger' masih di dalam grup User — GROUPED_CODES akan menyerapnya dan menunya tidak pernah tampil sendiri.");
  }
  const core = blokAntara(kode, 'const CORE_ADMIN_MENU', '];');
  if (!core || !/cash_ledger/.test(core)) {
    salah("main-admin.js: 'cash_ledger' tidak ada di CORE_ADMIN_MENU — menunya hilang sama sekali sesudah dikeluarkan dari grup User.");
  }
  if (!/registerModule\('cash_ledger'/.test(kode)) salah("main-admin.js: renderer 'cash_ledger' tidak terdaftar.");
}

// ---------------------------------------------------------------
// 5. Layar.
// ---------------------------------------------------------------
const page = baca('js/modules/cash/cash.page.js');
if (page) {
  const kode = bersih(page, 'cash.page.js', ['function tombolKoreksi(', 'async function bukaHapusKas(']);
  if (!/riwayatKasSaya\(\)/.test(kode)) {
    salah('cash.page.js: riwayat masih diambil lewat embed tabel — kolom Outlet akan kosong lagi untuk entri lintas outlet.');
  }
  if (!/e\.outlet_name/.test(kode)) salah('cash.page.js: nama outlet dari RPC tidak dipakai.');
  if (!/keadaanKoreksi\(e\)/.test(kode)) salah('cash.page.js: keadaan koreksi tidak dihitung lewat modul murni.');
  if (!/btn-kas-ubah/.test(kode) || !/btn-kas-hapus/.test(kode)) salah('cash.page.js: tombol Ubah/Hapus tidak digambar.');
  if (!/coretKas\(e\.id, values\.alasan\)/.test(kode)) salah('cash.page.js: alasan penghapusan tidak dikirim.');
  // Tombol yang mati tetap digambar, dengan sebabnya.
  if (!/btn-kas-info" disabled title="\$\{sebab\}"/.test(kode)) {
    salah(
      'cash.page.js: tombol yang tidak boleh ditekan disembunyikan, bukan dimatikan dengan sebabnya. ' +
        'Orang akan mencarinya, tidak menemukannya, dan menyimpulkan aplikasinya rusak.'
    );
  }
  if (!/totalKas\(entriTampil\)/.test(kode)) {
    salah('cash.page.js: total PDF tidak mengabaikan entri yang dicoret — dua angka berbeda untuk hal yang sama di satu berkas.');
  }
}

const admin = baca('js/modules/cash/cash.admin.page.js');
if (admin) {
  const kode = bersih(admin, 'cash.admin.page.js', ['function tombolKoreksi(', 'async function hapusEntriAdmin(']);
  if (!/pecahKeterangan\(ket, notas \?\? \[\]\)/.test(kode)) {
    salah(
      'cash.admin.page.js: nomor nota tidak dipecah lewat modul murni yang sama dengan Staff App. ' +
        'Aturan yang ditiru akan membuat nomor yang sama bisa diketuk di satu layar dan tidak di layar lainnya.'
    );
  }
  if (!/bukaDialogNota\(/.test(kode)) salah('cash.admin.page.js: dialog rincian nota tidak pernah dibuka.');
  if (!/class="btn-nota"/.test(kode)) salah('cash.admin.page.js: nomor nota tidak digambar sebagai tautan.');
  if (!/\.btn-nota'\)\.forEach/.test(kode)) salah('cash.admin.page.js: tautan nomor nota tidak dipasangi penangan klik.');
  if (!/alasanTolakKoreksiKas\(rows\.map/.test(kode)) salah('cash.admin.page.js: izin koreksi tidak diambil — tombolnya digambar menebak-nebak.');
  if (!/btn-kas-ubah/.test(kode) || !/btn-kas-hapus/.test(kode)) salah('cash.admin.page.js: tombol Ubah/Hapus tidak digambar.');
  if (!/totalKas\(rows\)/.test(kode)) salah('cash.admin.page.js: ringkasan Masuk/Keluar masih menghitung entri yang dicoret.');

  // Dialog admin TIDAK menampilkan kategori/qty/satuan, jadi ia wajib
  // mengirimkannya kembali apa adanya — `ubah_kas` menulis PENUH.
  const blok = blokAntara(kode, 'async function ubahEntriAdmin', '\n}\n');
  if (!blok) salah('cash.admin.page.js: `ubahEntriAdmin` tidak ada.');
  else {
    for (const [field, sumber] of [
      ['categoryId', /categoryId: r\.category_id/],
      ['qty', /qty: r\.qty/],
      ['unit', /unit: r\.unit/]
    ]) {
      if (!sumber.test(blok)) {
        salah(
          `cash.admin.page.js \`ubahEntriAdmin\`: \`${field}\` tidak dikirim ulang dari barisnya. ` +
            '`ubah_kas` menulis PENUH — menyunting keterangan akan diam-diam MENGHAPUS kategori/jumlah barangnya (bug 0119).'
        );
      }
    }
  }
}

if (gagal === 0) {
  console.log(
    'Koreksi kas: hapus = dicoret berjejak, saldo di SEMUA tempat mengabaikannya, izinnya per-BU tanpa syarat outlet, ' +
      'entri pembayaran nota ditolak dengan jalan keluarnya, dan kolom Outlet diselesaikan di server. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
