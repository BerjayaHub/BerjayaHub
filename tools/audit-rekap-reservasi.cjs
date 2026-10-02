/**
 * AUDIT: rekap reservasi harian bisa dijalankan & didiagnosa dari Admin Portal.
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   CORS/OPTIONS hilang       -> permintaan mati di preflight, dan yang muncul
 *                                di layar "Failed to fetch" — menuduh jaringan,
 *                                bukan menyebut sebabnya
 *   gerbang admin dilonggarkan-> setiap staff yang login bisa menyuruh bot
 *                                membanjiri grup Telegram kapan saja
 *   "lolos gerbang" = admin   -> gerbang Supabase cuma memastikan tokennya sah
 *                                sebagai token; ia tidak tahu apa pun soal peran
 *   urutan rute diwariskan    -> rekap masuk ke grup "Reservasi baru" dan tidak
 *                                ada yang menduga sebabnya saat grupnya dipisah
 *   `force` bisa dipakai cron -> satu cron salah jadwal membanjiri grup, karena
 *                                dedupe-nya tidak berarti apa-apa lagi
 *   `insert` saat kirim paksa -> pesannya terkirim, lalu unique (kind,ref)
 *                                melempar; layar bilang gagal padahal sudah masuk
 *   vonis "siap" berhenti di  -> satu-satunya sebab yang tersisa (cron tidak
 *   situ                         pernah dipasang) justru tidak pernah disebut
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
// 1. EDGE FUNCTION.
// ---------------------------------------------------------------
const fn = baca('supabase/functions/send-reservation-digest/index.ts');
if (fn) {
  const kode = bersih(fn, 'send-reservation-digest', ['Deno.serve', 'tolakPemanggil']);

  // ---- Dipanggil dari browser ----
  if (!/req\.method === 'OPTIONS'/.test(kode)) {
    salah(
      'send-reservation-digest: preflight `OPTIONS` tidak dijawab. Permintaan dari browser mati sebelum sampai ke kode ' +
        'ini, dan yang terbaca di layar adalah "Failed to fetch" — kalimat yang menuduh jaringan dan tidak menyebut CORS sama sekali.'
    );
  }
  if (!/Access-Control-Allow-Origin/.test(kode)) {
    salah('send-reservation-digest: header CORS hilang.');
  }
  // Header CORS harus ikut di JAWABAN, bukan cuma didefinisikan. Konstanta yang
  // ada tapi tidak dipakai adalah bentuk hijau-palsu yang paling sering di sini.
  if (!/new Response\(JSON\.stringify\(b\), \{ status: s, headers: \{ 'Content-Type': 'application\/json', \.\.\.CORS_HEADERS \} \}\)/.test(kode)) {
    salah('send-reservation-digest: `json()` tidak lagi menyertakan CORS_HEADERS — konstantanya ada, jawabannya tidak memakainya.');
  }

  // ---- Gerbang ----
  if (!/function tolakPemanggil/.test(kode)) {
    salah('send-reservation-digest: `tolakPemanggil` hilang — tidak ada lagi satu tempat yang memutuskan siapa boleh menjalankan ini.');
  }
  if (!/auth\.getUser\(\)/.test(kode)) {
    salah(
      'send-reservation-digest: JWT pemanggilnya tidak lagi DIVERIFIKASI lewat `auth.getUser()`. Membaca klaim dari token ' +
        'tanpa memverifikasinya berarti menerima token karangan.'
    );
  }
  if (!/\.in\('role', \['super_admin', 'bu_admin'\]\)/.test(kode)) {
    salah(
      'send-reservation-digest: perannya tidak lagi diperiksa. Gerbang Supabase hanya memastikan tokennya sah sebagai ' +
        'token — ia tidak tahu apa pun tentang peran orangnya, jadi SETIAP staff yang login bisa menyuruh bot ' +
        'membanjiri grup Telegram kapan saja.'
    );
  }
  if (!/createClient\(SUPABASE_URL, ANON_KEY/.test(kode)) {
    salah('send-reservation-digest: verifikasi JWT memakai service-role, bukan anon key + token orangnya — itu tidak memverifikasi siapa pun.');
  }

  // ---- Urutan rute ----
  if (!/event_key === u\.k/.test(kode)) {
    salah(
      'send-reservation-digest: rute tidak lagi dipilih berdasarkan `event_key`. Kalau sebuah BU punya rute ' +
        '`reservation_digest` DAN `reservation`, tujuannya ditentukan urutan baris yang dikembalikan PostgREST — bisa ' +
        'benar hari ini dan berubah sendiri besok tanpa ada yang mengubah apa pun.'
    );
  }
  const urut = kode.indexOf("{ k: 'reservation_digest', bu: true }");
  const urutUmum = kode.indexOf("{ k: 'reservation', bu: true }");
  if (urut < 0 || urutUmum < 0 || urut > urutUmum) {
    salah('send-reservation-digest: `reservation_digest` tidak lagi didahulukan atas `reservation` dalam urutan pencarian rutenya.');
  }
  // Diikat ke tempat ia DIISI, bukan dicari lepas: `sumber_rute` muncul juga
  // di blok dry-run dan di hasil kiriman, jadi mencabut pengisiannya tetap
  // menyisakan dua kemunculan yang membuat pencarian lepas hijau.
  if (!/sumber_rute: rute\.sumber/.test(kode)) {
    salah('send-reservation-digest: rute yang dipakai tidak lagi diisi ke `sumber_rute` — "jatuh ke rute Reservasi baru" jadi hal yang harus disimpulkan sendiri.');
  }

  // ---- force & dedupe ----
  if (!/const paksa = body\?\.force === true;/.test(kode)) {
    salah('send-reservation-digest: `force` tidak dibaca — kiriman manual untuk hari yang penandanya sudah ada tidak bisa dilakukan sama sekali.');
  }
  if (!/if \(!dryRun && sudahTerkirim && !paksa\)/.test(kode)) {
    salah('send-reservation-digest: penjaga dedupe-nya berubah bentuk. `dry_run` tidak boleh tertahan, dan `force` hanya boleh melewati saat BUKAN dry run.');
  }
  if (/\.insert\(\{ kind: 'reservation_digest'/.test(kode)) {
    salah(
      'send-reservation-digest: penanda dedupe ditulis dengan `insert`. Saat dikirim paksa, barisnya sudah ada — ' +
        '`insert` melanggar unique (kind, ref) dan melempar SESUDAH pesannya terkirim. Yang dilihat orangnya: pesan ' +
        'masuk ke grup, layar bilang gagal.'
    );
  }
  if (!/ignoreDuplicates: true/.test(kode)) {
    salah('send-reservation-digest: penanda dedupe tidak lagi memakai upsert yang mengabaikan duplikat.');
  }
  if (!/sudah_dikirim_hari_ini/.test(kode)) {
    salah(
      'send-reservation-digest: pratinjau tidak lagi menyebut apakah penanda hari ini sudah ada. Pratinjau yang mulus ' +
        'lalu membuat orangnya menyimpulkan semuanya beres, padahal kiriman sungguhannya akan dilewati.'
    );
  }
}

// ---------------------------------------------------------------
// 2. MODUL MURNI.
// ---------------------------------------------------------------
const modul = baca('js/modules/notifications/diagnosa-rekap.js');
if (modul) {
  const kode = bersih(modul, 'diagnosa-rekap.js', ['export function diagnosaRekap']);

  if (/^import /m.test(kode)) {
    salah('diagnosa-rekap.js: ada impor — modul ini harus bisa diuji tanpa browser.');
  }

  // ============ URUTAN PEMERIKSAAN ============
  const iSkip = kode.indexOf('jawaban.skipped');
  const iKosong = kode.indexOf('if (!daftar.length)');
  if (iSkip < 0 || iKosong < 0 || iSkip > iKosong) {
    salah(
      'diagnosa-rekap.js: `skipped` tidak lagi diperiksa SEBELUM "daftarnya kosong". Jawaban yang dilewati dedupe tidak ' +
        'membawa daftar `telegram` sama sekali, jadi ia akan terbaca sebagai "modul Reservasi mati" — dan orangnya ' +
        'dikirim memeriksa pengaturan modul yang sebenarnya tidak apa-apa.'
    );
  }

  // `reservation_digest` DIAWALI `reservation`.
  if (!/startsWith\('reservation_digest'\)/.test(kode)) {
    salah(
      "diagnosa-rekap.js `pakaiRuteCadangan`: pembedanya bukan lagi `startsWith('reservation_digest')`. `includes('reservation')` " +
        'akan menganggap rute yang BENAR sebagai cadangan, karena nama yang benar memang diawali nama yang salah.'
    );
  }

  // ============ VONIS "SIAP" HARUS TETAP MENUNJUK KE CRON ============
  //
  // Diikat ke blok vonis SIAP lewat indexOf, bukan dicari lepas: kata "cron"
  // muncul juga di kepala berkas, jadi pencarian lepas akan tetap hijau walau
  // kalimat yang penting sudah hilang.
  const iSiap = kode.indexOf('vonis: VONIS.SIAP,\n    ringkas: `${baris.length} outlet siap');
  const blokSiap = iSiap >= 0 ? kode.slice(iSiap, iSiap + 900) : '';
  if (!blokSiap || !/cron/i.test(blokSiap) || !/401|Authorization/.test(blokSiap)) {
    salah(
      'diagnosa-rekap.js: vonis "siap" tidak lagi menunjuk ke CRON sebagai sebab yang tersisa. "Siap" di sini cuma ' +
        'berarti "kalau ADA yang memanggil, pesannya masuk" — ia tidak mengatakan apa pun tentang apakah ada yang ' +
        'memanggil, dan justru itu keadaan yang sedang dicari orangnya.'
    );
  }

  for (const v of ['SIAP', 'MODUL_MATI', 'TANPA_RUTE', 'RUTE_CADANGAN', 'SUDAH_DIKIRIM', 'GAGAL']) {
    if (!new RegExp(`${v}:`).test(kode)) salah(`diagnosa-rekap.js: vonis \`${v}\` hilang — satu keadaan jadi tidak bisa dibedakan.`);
  }
  if (!/saran: teks\(galat\.message \?\? galat\)/.test(kode)) {
    salah(
      'diagnosa-rekap.js: pesan galat aslinya tidak lagi dibawa. "Unauthorized" dan "Failed to fetch" menunjuk ke dua ' +
        'sebab yang berbeda jauh; merangkum keduanya jadi "gagal" menghapus satu-satunya petunjuk yang ada.'
    );
  }
}

// ---------------------------------------------------------------
// 3. LAYANAN & LAYAR.
// ---------------------------------------------------------------
const svc = baca('js/modules/notifications/telegram.service.js');
if (svc) {
  const kode = bersih(svc, 'telegram.service.js', ['export async function jalankanRekapReservasi']);
  if (!/invokeFunction\('send-reservation-digest'/.test(kode)) {
    salah('telegram.service.js: `send-reservation-digest` tidak dipanggil dari mana pun.');
  }
  // `dry_run` dikirim EKSPLISIT. Kunci yang hilang berarti "kirim sungguhan".
  if (!/dry_run: dryRun === true/.test(kode)) {
    salah(
      "telegram.service.js `jalankanRekapReservasi`: `dry_run` tidak lagi dikirim eksplisit sebagai boolean. Edge Function " +
        'memeriksa `=== true`, jadi kunci yang hilang atau bernilai aneh berarti KIRIM SUNGGUHAN — dan tombol pratinjau ' +
        'akan membanjiri grup.'
    );
  }
}

const page = baca('js/modules/notifications/telegram.admin.page.js');
if (page) {
  const kode = bersih(page, 'telegram.admin.page.js', ['function wireRekap']);

  if (!/jalankanRekapReservasi\(\{ dryRun: true \}\)/.test(kode)) {
    salah('telegram.admin.page.js: tombol Pratinjau tidak lagi memanggil dengan `dryRun: true` — ia akan mengirim sungguhan.');
  }
  if (!/confirmDialog\(/.test(kode) || !/rk-kirim/.test(kode)) {
    salah('telegram.admin.page.js: "Kirim sekarang" tidak lagi dikonfirmasi — satu ketukan tak sengaja membanjiri grup.');
  }
  // Isi pesannya harus bisa dilihat. Ringkasan "3 reservasi" tidak bisa
  // menjawab "kenapa outlet ini tertulis kosong padahal ada booking".
  if (!/t\.preview/.test(kode)) {
    salah(
      'telegram.admin.page.js: isi pesan yang akan dikirim tidak ditampilkan. Ringkasan jumlah tidak bisa menjawab ' +
        '"kenapa outlet ini tertulis kosong padahal ada booking" — yang menjawab itu cuma teks yang sungguh akan dikirim.'
    );
  }
  // DIHITUNG, bukan dicari. Ada DUA jalur yang bisa gagal — pratinjau dan
  // kirim — dan masing-masing punya `catch`-nya sendiri. Mencabut salah satunya
  // menyisakan yang lain, jadi pencarian lepas tetap hijau sementara separuh
  // kegagalan kehilangan pesan aslinya.
  const lewatDiagnosa = (kode.match(/diagnosaRekap\(null, error\)/g) ?? []).length;
  if (lewatDiagnosa < 2) {
    salah(
      `telegram.admin.page.js: hanya ${lewatDiagnosa} dari 2 jalur gagal yang lewat \`diagnosaRekap\` (pratinjau & kirim). ` +
        'Yang tidak lewat kehilangan pesan aslinya — dan "Unauthorized" vs "Failed to fetch" adalah dua sebab yang berbeda jauh.'
    );
  }
  if (!/jawaban\?\.skipped/.test(kode)) {
    salah(
      'telegram.admin.page.js: jawaban `skipped` tidak ditangani. Orang menekan tombol ini justru karena rekap paginya ' +
        'tidak sampai — ditolak diam-diam oleh penanda dedupe adalah jawaban yang paling tidak membantu di situ.'
    );
  }
  if (!/force: true/.test(kode)) {
    salah('telegram.admin.page.js: tidak ada jalan untuk mengirim ulang paksa saat penandanya ada tapi pesannya tidak pernah sampai.');
  }
}

// ---------------------------------------------------------------
// 4. DEPLOY.md menyebut cron-nya.
// ---------------------------------------------------------------
const deploy = baca('DEPLOY.md');
if (deploy) {
  if (!/send-reservation-digest/.test(deploy)) {
    salah('DEPLOY.md: `send-reservation-digest` tidak disebut — function yang tidak pernah di-deploy terlihat persis seperti cron yang diam.');
  }
  if (!/x-cron-secret/.test(deploy)) {
    salah('DEPLOY.md: `x-cron-secret` tidak disebut di contoh cron-nya.');
  }
  // Diikat ke PERINGATANNYA, bukan ke kata "Authorization" — kata itu muncul di
  // setiap potongan `jsonb_build_object` di sana, jadi menghapus peringatannya
  // tidak mengubah apa pun bagi pencarian lepas. Dan peringatan itulah yang
  // penting: tanpa header tersebut balasannya 401 SEBELUM kode function jalan,
  // sementara `cron.job_run_details` tetap melaporkan "succeeded".
  if (!/Header \*\*`Authorization` wajib\*\*/.test(deploy)) {
    salah(
      'DEPLOY.md: peringatan "Header `Authorization` wajib" hilang. Itu satu-satunya tempat yang menjelaskan kenapa cron ' +
        'bisa melaporkan "succeeded" sambil tidak pernah menjalankan apa pun — kegagalan yang dulu membuat reminder ' +
        'clock-in diam berminggu-minggu.'
    );
  }
}

console.log('');
if (gagal === 0) console.log('Audit rekap reservasi harian bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
