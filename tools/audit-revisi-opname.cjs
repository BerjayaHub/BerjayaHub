/**
 * AUDIT: revisi hasil opname yang sudah ditutup (0155).
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   koreksi bertanggal now()       -> saldo SEKARANG benar, saldo per tanggal
 *                                     opname tetap salah, dan COGS bulan itu
 *                                     memakai angka lama selamanya. Layarnya
 *                                     bilang "berhasil" di kedua keadaan.
 *   `system_qty` dibaca ulang      -> selisih dihitung terhadap stok yang SUDAH
 *                                     memuat hasil opname; koreksinya berlaku
 *                                     dua kali (bentuk bug nanas di 0114)
 *   jejak menumpang `sebelumnya`   -> setiap baris yang direvisi admin muncul
 *                                     sebagai "dihitung dua orang dengan angka
 *                                     berbeda ⚠" yang tidak pernah terjadi
 *   baris dibuang ikut dihitung    -> Nilai Opname memuat barang yang stoknya
 *                                     sudah dicabut; itu stok akhir di COGS
 *   buang mengembalikan ke NOL     -> opname tidak pernah mengklaim nol untuk
 *                                     bahan yang tidak dihitung
 *   `dibuang_at` tidak diminta     -> kolom yang tidak diminta terbaca sebagai
 *                                     TIDAK ADA, dan penyaringnya diam-diam
 *                                     tidak menyaring apa pun
 *   sesi lampau boleh direvisi     -> koreksi bertanggal lampau ditulis di bawah
 *                                     hitungan fisik yang lebih sahih
 *   alasan jadi opsional           -> laporan COGS yang berubah sendiri tidak
 *                                     bisa dibedakan dari angka yang dikarang
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

/**
 * Buang komentar `--` dari SQL.
 *
 * ============ KENAPA INI PERLU ============
 *
 * `tanpaKomentar()` dibuat untuk JavaScript; komentar `--` di dalam blok `$$`
 * Postgres tetap lolos. Akibatnya DUA ARAH, dan dua-duanya pernah terjadi di
 * berkas ini:
 *
 *   - LARANGAN jadi merah palsu. Catatan `-- BUKAN now().` di 0155 membuat
 *     pemeriksa "`now()` tidak boleh ada di sini" berteriak pada kode yang
 *     justru benar. Itu yang baru saja terjadi.
 *   - KEWAJIBAN jadi hijau palsu, dan ini yang berbahaya: potongan yang dicari
 *     bisa ada HANYA di dalam komentar yang menjelaskannya, sementara kodenya
 *     sendiri sudah hilang.
 *
 * Komentar di dalam string literal TIDAK ikut dibuang — `--` yang muncul
 * sesudah jumlah petik tunggal yang ganjil berarti ia ada di dalam teks.
 */
const tanpaSqlKomentar = (sql) =>
  sql
    .split('\n')
    .map((baris) => {
      let petik = 0;
      for (let i = 0; i < baris.length; i++) {
        if (baris[i] === "'") petik++;
        else if (baris[i] === '-' && baris[i + 1] === '-' && petik % 2 === 0) return baris.slice(0, i);
      }
      return baris;
    })
    .join('\n');

/** Potongan kode sebuah fungsi SQL, supaya pemeriksaan tidak nyasar ke fungsi lain. */
const blokSql = (kode, awal) => {
  const i = kode.indexOf(awal);
  if (i < 0) return '';
  const j = kode.indexOf('$$;', i);
  return j < 0 ? kode.slice(i) : kode.slice(i, j);
};

// ---------------------------------------------------------------
// 1. MIGRATION 0155.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0155_revisi_opname.sql');
if (mig) {
  const kode = tanpaSqlKomentar(mig);
  // Kewarasan: kalau penyaringnya terlalu rakus, seluruh pemeriksaan di bawah
  // ini jadi hijau atas berkas kosong — bentuk kegagalan yang paling meyakinkan.
  if (!/create or replace function revisi_hitungan_opname/.test(kode) || kode.length < mig.length / 3) {
    salah('audit-revisi-opname: penyaring komentar SQL memakan terlalu banyak — pemeriksaan di bawah ini tidak bisa dipercaya.');
  }

  // ============ INTI: KOREKSINYA BERTANGGAL closed_at ============
  //
  // Diikat ke blok `catat_koreksi_opname`, bukan dicari di seluruh berkas:
  // `closed_at` muncul di beberapa tempat lain di sini, jadi pencarian lepas
  // akan tetap hijau walau baris yang penting sudah hilang.
  const blokKoreksi = blokSql(kode, 'function catat_koreksi_opname');
  if (!blokKoreksi) {
    salah('0155: fungsi `catat_koreksi_opname` hilang — tidak ada lagi satu tempat yang menentukan tanggal koreksinya.');
  } else {
    if (!/insert into stock_movements[\s\S]*created_at/.test(blokKoreksi)) {
      salah(
        '0155 `catat_koreksi_opname`: `created_at` tidak lagi ikut di daftar kolom insert-nya. Tanpa itu Postgres memakai ' +
          'default `now()`, dan koreksinya jatuh di HARI INI — saldo sekarang benar, saldo per tanggal opname tetap salah, ' +
          'dan laporan COGS periode itu memakai angka lama selamanya. Tidak ada galat di mana pun.'
      );
    }
    if (!/coalesce\(c\.closed_at, c\.opened_at\)/.test(blokKoreksi)) {
      salah(
        '0155 `catat_koreksi_opname`: nilai `created_at`-nya bukan lagi `closed_at` sesi aslinya. Inilah seluruh inti 0155; ' +
          'kalau ia berubah jadi `now()`, semuanya tetap jalan dan tidak ada satu layar pun yang bisa menunjukkan bedanya.'
      );
    }
    // `now()` tidak punya satu pun alasan sah berada di dalam fungsi ini —
    // satu-satunya waktu yang dipakainya adalah `closed_at` sesi aslinya.
    // Bentuk positif di atas bisa lolos kalau seseorang MENAMBAHKAN `now()`
    // di sebelahnya; ini yang menangkap hal itu.
    if (/now\(\)/.test(blokKoreksi)) {
      salah(
        '0155 `catat_koreksi_opname`: `now()` muncul di dalamnya. Satu-satunya waktu yang boleh dipakai pergerakan koreksi ' +
          'adalah `closed_at` sesi aslinya — kalau tidak, saldo per tanggal opname tetap salah dan tidak ada yang bisa menunjukkannya.'
      );
    }
    if (!/p_delta is null or p_delta = 0/.test(blokKoreksi)) {
      salah('0155 `catat_koreksi_opname`: delta nol tidak lagi dilewati — baris pergerakan berjumlah nol cuma meramaikan riwayat stok.');
    }
  }

  // ============ INTI: `system_qty` TIDAK DIBACA ULANG ============
  const blokRevisi = blokSql(kode, 'function revisi_hitungan_opname');
  if (!blokRevisi) {
    salah('0155: `revisi_hitungan_opname` hilang.');
  } else {
    // Delta untuk baris yang SUDAH ada harus `p_counted − counted_qty lama`.
    if (!/v_delta := p_counted - v_lama\.counted_qty/.test(blokRevisi)) {
      salah(
        '0155 `revisi_hitungan_opname`: delta baris yang sudah ada tidak lagi dihitung dari `counted_qty` LAMA. Kalau ia ' +
          'dihitung terhadap stok sekarang, angkanya sudah memuat hasil opname itu sendiri dan koreksinya berlaku dua kali — ' +
          'persis bentuk bug nanas di 0114 (6.400 dihitung 4.600 jadi 11.000).'
      );
    }
    // Cabang "ubah angka" — yaitu `else` terakhir — tidak boleh menyentuh
    // `system_qty` sama sekali. Dicari di potongan itu saja, karena cabang
    // "bahan terlewat" di atasnya MEMANG menulisnya, dan pencarian lepas akan
    // selalu ketemu di sana.
    const iElse = blokRevisi.lastIndexOf('else');
    if (iElse >= 0 && /system_qty\s*=/.test(blokRevisi.slice(iElse))) {
      salah(
        '0155 `revisi_hitungan_opname`: cabang "ubah angka" menulis `system_qty` lagi. Potret itu harus DIBEKUKAN — ' +
          'membacanya ulang menerapkan koreksinya dua kali.'
      );
    }
    // Bahan terlewat: stok PADA SAAT SESI DITUTUP, bukan stok sekarang.
    if (!/created_at <= coalesce\(c\.closed_at, c\.opened_at\)/.test(blokRevisi)) {
      salah(
        '0155 `revisi_hitungan_opname`: potret sistem untuk bahan yang TERLEWAT tidak lagi dibatasi sampai `closed_at`. ' +
          'Tanpa batas itu ia memakai stok HARI INI, dan selisihnya memuat setiap nota yang masuk sesudah opname.'
      );
    }
    if (!/sm\.count_id is distinct from p_count/.test(blokRevisi)) {
      salah(
        '0155 `revisi_hitungan_opname`: pergerakan milik sesi ini sendiri tidak lagi dikecualikan dari potret sistemnya. ' +
          'Penyesuaian penutupan bertanggal `closed_at` juga, jadi tanpa pengecualian itu ia ikut terhitung.'
      );
    }
    if (!/btrim\(p_alasan\), ''\) = ''/.test(blokRevisi)) {
      salah('0155 `revisi_hitungan_opname`: alasan tidak lagi wajib. Laporan COGS yang berubah sendiri tanpa keterangan tidak bisa dipertanggungjawabkan.');
    }
    if (!/opname_tolak_revisi\(p_count\)/.test(blokRevisi)) {
      salah('0155 `revisi_hitungan_opname`: penjaganya tidak dipanggil.');
    }
  }

  // ============ BUANG: kembali ke angka SEBELUM opname ============
  const blokHapus = blokSql(kode, 'function hapus_hitungan_opname');
  if (!blokHapus) {
    salah('0155: `hapus_hitungan_opname` hilang.');
  } else {
    if (!/v_delta := v_lama\.system_qty - v_lama\.counted_qty/.test(blokHapus)) {
      salah(
        '0155 `hapus_hitungan_opname`: delta pembuangannya bukan lagi `system_qty − counted_qty`. Yang benar adalah ' +
          'KEBALIKAN penyesuaian yang dulu ditulis penutupan — stok pulih ke angka SEBELUM opname, bukan ke nol. ' +
          'Opname tidak pernah mengklaim nol untuk bahan yang tidak dihitung.'
      );
    }
    if (/delete from stock_count_items/.test(blokHapus)) {
      salah(
        '0155 `hapus_hitungan_opname`: barisnya DIHAPUS, bukan ditandai. Hitungan di bahan yang salah adalah satu-satunya ' +
          'petunjuk bahwa ada rak lain yang mungkin belum dihitung; menghapusnya menyisakan sesi yang terlihat rapi.'
      );
    }
    if (!/dibuang_at = now\(\)/.test(blokHapus)) {
      salah('0155 `hapus_hitungan_opname`: `dibuang_at` tidak lagi diisi — tidak ada yang bisa menyaringnya dari laporan.');
    }
    if (!/opname_tolak_revisi\(p_count\)/.test(blokHapus)) {
      salah('0155 `hapus_hitungan_opname`: penjaganya tidak dipanggil.');
    }
  }

  // ============ PENJAGA ============
  const blokTolak = blokSql(kode, 'function opname_tolak_revisi');
  if (!blokTolak) {
    salah('0155: `opname_tolak_revisi` hilang — penjaganya tersebar lagi ke tiap RPC.');
  } else {
    if (!/is_bu_admin\(auth\.uid\(\)/.test(blokTolak)) {
      salah('0155 `opname_tolak_revisi`: tidak lagi menuntut Admin BU. Siapa pun yang berwenang di outlet bisa mengubah stok bertanggal lampau.');
    }
    if (!/c2\.closed_at > c\.closed_at/.test(blokTolak)) {
      salah(
        '0155 `opname_tolak_revisi`: pembatas "hanya sesi tertutup TERAKHIR per outlet" hilang. Sesi lampau yang sudah ' +
          'ketiban opname berikutnya jadi bisa direvisi — koreksinya ditulis bertanggal lampau di bawah hitungan fisik ' +
          'yang lebih sahih, dan saldo hari ini bergeser sebesar koreksi yang sudah tidak relevan.'
      );
    }
    if (!/c3\.status = 'open'/.test(blokTolak)) {
      salah(
        '0155 `opname_tolak_revisi`: sesi yang SEDANG BERJALAN tidak lagi menghalangi. Revisi menggeser saldo, jadi potret ' +
          'stok yang sudah terisi di sesi itu jadi basi — dan basinya tidak terlihat sampai sesinya ditutup dengan ' +
          'penyesuaian yang salah.'
      );
    }
    if (!/c\.status = 'open'/.test(blokTolak) || !/c\.status <> 'closed'/.test(blokTolak)) {
      salah('0155 `opname_tolak_revisi`: status sesinya tidak lagi diperiksa lengkap (open & bukan-closed).');
    }
  }

  // Grant: RPC yang tidak bisa dipanggil adalah tombol yang selalu gagal.
  for (const f of [
    'revisi_hitungan_opname(uuid, uuid, numeric, text)',
    'hapus_hitungan_opname(uuid, uuid, text)',
    'opname_tolak_revisi(uuid)'
  ]) {
    if (!kode.includes(`grant execute on function ${f} to authenticated`)) {
      salah(`0155: \`${f}\` tidak di-grant ke authenticated — setiap pemakaian ditolak dengan "permission denied for function".`);
    }
  }

  // ============ JEJAKNYA TIDAK MENUMPANG `sebelumnya` ============
  if (/sebelumnya\s*=\s*sebelumnya\s*\|\|/.test(kode)) {
    salah(
      '0155: jejak revisi menumpang kolom `sebelumnya`. `laporan-opname.js` membacanya sebagai "bahan ini dihitung dua ' +
        'orang dengan angka berbeda, PERIKSA DULU" dan menghitungnya di `jumlahBentrok` — jadi setiap baris yang direvisi ' +
        'admin akan muncul sebagai pertengkaran antar-penghitung yang tidak pernah terjadi. Tidak ada galat; yang rusak artinya.'
    );
  }
  for (const kol of ['revisi jsonb', 'dibuang_at', 'dibuang_by', 'dibuang_alasan', 'direvisi_at', 'direvisi_by']) {
    if (!kode.includes(kol)) salah(`0155: kolom \`${kol}\` tidak lagi ditambahkan.`);
  }
}

// ---------------------------------------------------------------
// 2. MODUL MURNI.
// ---------------------------------------------------------------
const modul = baca('js/modules/inventory/revisi-opname.js');
if (modul) {
  const kode = bersih(modul, 'revisi-opname.js', ['export function bolehRevisiOpname', 'export function deltaHapus']);

  if (/^import /m.test(kode)) {
    salah('revisi-opname.js: ada impor — modul ini harus bisa diuji tanpa browser.');
  }
  // Delta ubah TIDAK boleh menyentuh sistem.
  const blokUbah = kode.slice(kode.indexOf('export function deltaRevisi'), kode.indexOf('export function deltaTambah'));
  if (/system|sistem/i.test(blokUbah)) {
    salah(
      'revisi-opname.js `deltaRevisi`: `system`/`sistem` muncul di dalamnya. Delta revisi harus `baru − lama` saja; ' +
        'menyertakan potret sistem menerapkan koreksinya dua kali.'
    );
  }
  if (!/return num\(item\.system_qty\) - num\(item\.counted_qty\)/.test(kode)) {
    salah('revisi-opname.js `deltaHapus`: arah selisihnya bukan lagi `sistem − dihitung`. Terbalik, ia MENGGANDAKAN koreksi opname alih-alih membatalkannya.');
  }
  // Penyaring baris dibuang harus benar-benar menyaring.
  if (!/filter\(\(it\) => !it\?\.dibuang_at\)/.test(kode)) {
    salah('revisi-opname.js `itemTerpakai`: tidak lagi menyaring `dibuang_at`. Baris yang stoknya sudah dicabut ikut masuk Nilai Opname — angka stok akhir di laporan COGS.');
  }
  // `??` BUKAN `||`: angka asli NOL tidak boleh hilang.
  if (/qty_lama \|\|/.test(kode)) {
    salah('revisi-opname.js: `qty_lama ||` memakai OR, bukan `??`. Angka asli NOL jadi terbaca sebagai "tidak ada angka asli", dan "(semula 0)" hilang dari laporan.');
  }
  if (!/pertama\?\.qty_lama \?\? null/.test(kode)) {
    salah('revisi-opname.js `qtyAsli`: tidak lagi membaca entri PERTAMA dengan `??`. Sesudah dua kali revisi, yang dicari orang adalah angka yang diketik staff — bukan angka sebelum revisi terakhir.');
  }
  // Penyaring outlet, bukan BU.
  if (!/d\?\.outlet_id === sesi\.outlet_id/.test(kode)) {
    salah('revisi-opname.js `bolehRevisiOpname`: sesi lain tidak lagi disaring per OUTLET. Satu sesi baru di outlet mana pun akan memblokir revisi di seluruh BU.');
  }
  if (!/!ini \|\|/.test(kode)) {
    salah(
      'revisi-opname.js `bolehRevisiOpname`: `closed_at` yang kosong tidak lagi dijaga. `undefined > undefined` adalah ' +
        'false, jadi sesi yang tanggalnya tidak terbaca akan dianggap "paling baru" dan revisinya ditawarkan pada sesi ' +
        'yang angkanya sudah tergantikan.'
    );
  }
}

// ---------------------------------------------------------------
// 3. LAPORAN.
// ---------------------------------------------------------------
const lap = baca('js/modules/inventory/laporan-opname.js');
if (lap) {
  const kode = bersih(lap, 'laporan-opname.js', ['export function susunLaporanOpname']);

  if (!/itemTerpakai\(items\)\.map/.test(kode)) {
    salah(
      'laporan-opname.js: barisnya tidak lagi disusun dari `itemTerpakai(items)`. Baris yang dibuang ikut dihitung, dan ' +
        '"12 item, 3 selisih" memuat hitungan yang stoknya sudah dicabut — termasuk di Nilai Opname, yaitu stok akhir di COGS.'
    );
  }
  if (!/labelDihitung\(it\)/.test(kode)) {
    salah('laporan-opname.js: kolom Dihitung tidak lagi memakai `labelDihitung`. Angka hasil revisi berdiri sendiri tanpa angka aslinya, dan laporan yang berubah sendiri terlihat seperti laporan yang tidak pernah disentuh.');
  }
  // Ringkasannya dihitung dari daftar LENGKAP, bukan dari yang sudah disaring.
  if (!/ringkasRevisi\(items\)/.test(kode)) {
    salah('laporan-opname.js: `ringkasRevisi` tidak dipanggil dengan daftar lengkap — yang dibuang justru yang perlu dilaporkan jumlahnya, dan ia sudah tidak ada sesudah disaring.');
  }
  if (/ringkasRevisi\(itemTerpakai/.test(kode)) {
    salah('laporan-opname.js: `ringkasRevisi` dipanggil atas daftar yang SUDAH disaring, jadi `jumlahDibuang` selalu nol — dan nol itu tidak bisa dibedakan dari "tidak ada yang dibuang".');
  }
  for (const k of ['jumlahDirevisi', 'jumlahDibuang']) {
    if (!new RegExp(`${k},`).test(kode)) salah(`laporan-opname.js: \`${k}\` tidak ikut dikembalikan — tidak ada layar yang bisa menyebutkannya.`);
  }
}

// ---------------------------------------------------------------
// 4. LAYANAN — kolom yang tidak diminta terbaca sebagai TIDAK ADA.
// ---------------------------------------------------------------
const svc = baca('js/modules/inventory/opname.service.js');
if (svc) {
  const kode = bersih(svc, 'opname.service.js', ['export async function itemOpname', 'export async function revisiHitungan']);

  const blokItem = kode.slice(kode.indexOf('export async function itemOpname'), kode.indexOf('export async function riwayatOpname'));
  for (const kol of ['revisi', 'dibuang_at', 'dibuang_alasan']) {
    if (!blokItem.includes(kol)) {
      salah(
        `opname.service.js \`itemOpname\`: kolom \`${kol}\` tidak diminta. Kolom yang tidak diminta terbaca sebagai TIDAK ` +
          'ADA — bukan sebagai galat — jadi penyaring baris dibuang diam-diam berhenti menyaring dan kolom Dihitung berhenti ' +
          'menulis "(semula …)".'
      );
    }
  }

  const blokRiwayat = kode.slice(kode.indexOf('export async function riwayatOpname'));
  if (!blokRiwayat.includes('closed_at')) {
    salah(
      'opname.service.js `riwayatOpname`: `closed_at` tidak diminta. Ia bukan hiasan — `bolehRevisiOpname` memakainya ' +
        'untuk memutuskan sesi mana yang TERAKHIR, dan tanpa kolom itu ia membandingkan undefined dengan undefined lalu ' +
        'menawarkan revisi pada sesi yang sudah tergantikan.'
    );
  }
  if (!blokRiwayat.includes('direvisi_at')) {
    salah('opname.service.js `riwayatOpname`: `direvisi_at` tidak diminta — lencana "direvisi admin" tidak pernah muncul, dan sesi yang pernah diubah tidak bisa dibedakan dari yang asli.');
  }

  for (const [fn, rpc] of [
    ['revisiHitungan', 'revisi_hitungan_opname'],
    ['hapusHitungan', 'hapus_hitungan_opname']
  ]) {
    if (!new RegExp(`export async function ${fn}`).test(kode)) salah(`opname.service.js: \`${fn}\` hilang.`);
    if (!kode.includes(`rpc('${rpc}'`)) salah(`opname.service.js: RPC \`${rpc}\` tidak dipanggil dari mana pun.`);
  }
}

// ---------------------------------------------------------------
// 5. LAYAR ADMIN.
// ---------------------------------------------------------------
const adm = baca('js/modules/inventory/opname.admin.js');
if (adm) {
  const kode = bersih(adm, 'opname.admin.js', ['export async function renderOpnameAdmin']);

  if (!/bolehRevisiOpname\(d, daftar/.test(kode)) {
    salah('opname.admin.js: tombol Revisi tidak lagi lewat `bolehRevisiOpname` dengan seluruh daftarnya — tanpa daftar itu, "sesi terakhir" tidak bisa ditentukan.');
  }
  // ============ PRATINJAU DAMPAKNYA WAJIB ============
  //
  // DIHITUNG, bukan dicari.
  //
  // Versi pertama pemeriksa ini cuma menuntut `teksDelta(` ada di berkasnya —
  // dan ia LOLOS saat pratinjaunya dicabut, karena `teksDelta` masih dipakai
  // di toast sesudah tersimpan. Potongan yang dicari ada; yang hilang justru
  // satu-satunya tempat yang penting.
  //
  // `d` adalah delta PRATINJAU, `d2` delta yang sungguh ditulis server. Yang
  // harus ada dua — sekali di dialog "ubah", sekali di dialog "buang" —
  // adalah yang memakai `d`.
  const pratinjau = (kode.match(/teksDelta\(d\)/g) ?? []).length;
  if (pratinjau < 2) {
    salah(
      `opname.admin.js: delta pratinjau cuma muncul ${pratinjau} kali (harus 2: dialog ubah & dialog buang). Dampak ` +
        'pergerakan stoknya tidak lagi diperlihatkan sebelum disimpan — dan yang ditulis ke buku stok adalah SELISIH, ' +
        'yang kalau tandanya terbalik menggeser stok dua kali besar kesalahannya tanpa satu pun galat.'
    );
  }
  if (!/confirmDialog\(/.test(kode)) {
    salah('opname.admin.js: revisinya tersimpan tanpa satu pun langkah konfirmasi.');
  }
  // ============ `Number('')` ADALAH 0 ============
  if (!/Number\.isFinite\(counted\)/.test(kode)) {
    salah(
      "opname.admin.js: hasil revisi tidak lagi dijaga dengan `Number.isFinite`. `Number('')` adalah 0, bukan NaN — " +
        'kotak kosong akan tersimpan sebagai hitungan NOL, menghapus seluruh stok bahan itu bertanggal lampau, dan ' +
        'pesannya berbunyi "berhasil".'
    );
  }
  if (!/kosong \|\| !Number\.isFinite\(counted\) \|\| counted < 0/.test(kode)) {
    salah('opname.admin.js: penjaga angkanya tidak lengkap (kosong / bukan angka / negatif).');
  }
  // Delta untuk baris yang sudah ada harus dari angka LAMA.
  if (!/deltaRevisi\(\{ lama: it\.counted_qty, baru: counted \}\)/.test(kode)) {
    salah('opname.admin.js: pratinjau deltanya tidak lagi dihitung dari `counted_qty` lama — angka yang diperlihatkan jadi berbeda dari yang sungguh ditulis server.');
  }
  // Menu jadi tidak punya stok fisik.
  if (!/product_type !== 'finished'/.test(kode)) {
    salah("opname.admin.js: daftar bahan untuk \"tambah yang terlewat\" tidak lagi menyaring `product_type !== 'finished'` — menu jadi tidak punya stok fisik untuk dihitung.");
  }
  // ============ TIDAK DIHITUNG ≠ TIDAK DITAMPILKAN ============
  //
  // Laporannya memang mengecualikan baris yang dibuang dari setiap angka. Tapi
  // kalau ia hilang dari layar juga, baris yang dibuang karena salah paham
  // tidak bisa ditemukan lagi dari dalam aplikasi — padahal ia satu-satunya
  // petunjuk bahwa ada rak yang mungkin belum dihitung.
  if (!/it\?\.dibuang_at\)/.test(kode) || !/pembuang\?\.full_name/.test(kode)) {
    salah(
      'opname.admin.js: dialog "Lihat" tidak lagi menampilkan baris yang dibuang beserta siapa yang membuangnya. ' +
        'Tidak ikut dihitung bukan berarti tidak ditampilkan.'
    );
  }
  // Yang ditawarkan di dropdown harus baris yang MASIH terpakai.
  if (!/itemTerpakai\(items\)/.test(kode)) {
    salah('opname.admin.js: daftar bahan di dialog revisi tidak menyaring baris yang sudah dibuang — ia akan menawarkan "dihitung 7" untuk baris yang hitungannya sudah dicabut.');
  }
}

console.log('');
if (gagal === 0) console.log('Audit revisi opname bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
