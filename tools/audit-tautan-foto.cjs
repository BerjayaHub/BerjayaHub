/**
 * AUDIT: tautan foto dibuat saat DIKETUK, dan izin foto aset se-BU (0154).
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   URL dibekukan di `img.src`/`href`  -> thumbnail tetap terlihat normal
 *                                         selamanya (gambarnya di cache), tapi
 *                                         ketukannya membuka layar hitam berisi
 *                                         JSON 403 — dan cuma kena SEBAGIAN
 *                                         orang, tergantung berapa lama
 *                                         halamannya terbuka
 *   umurnya diperpanjang, bukan
 *   dibuat ulang                       -> tautan yang tersalin ke WhatsApp bisa
 *                                         dibuka siapa pun, tanpa login, tanpa
 *                                         jejak
 *   satu kalimat untuk semua sebab     -> yang tautannya kedaluwarsa pergi
 *                                         meminta hak akses yang sudah ia punya
 *   policy membaca tabel langsung      -> 42501 pada query FOTONYA, tanpa
 *                                         menyebut tabel yang sesungguhnya
 *                                         kurang izin
 *   izin tulis ikut dilonggarkan       -> "sekalian saja" adalah cara paling
 *                                         sering izin melebar tanpa diputuskan
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
// 1. TIDAK ADA satu pun layar yang membekukan tautan bertanda tangan.
//
// Disapu ke SELURUH `js/`, bukan ke dua berkas yang kebetulan sedang
// diperbaiki. Bug ini lahir dua kali di dua modul yang tidak saling tahu, dan
// akan lahir ketiga kalinya di modul berikutnya yang menampilkan foto.
// ---------------------------------------------------------------
function sapuBerkas(dir) {
  const hasil = [];
  for (const nama of fs.readdirSync(dir)) {
    const p = path.join(dir, nama);
    const st = fs.statSync(p);
    if (st.isDirectory()) hasil.push(...sapuBerkas(p));
    else if (nama.endsWith('.js')) hasil.push(p);
  }
  return hasil;
}

for (const abs of sapuBerkas(path.join(AKAR, 'js'))) {
  const rel = path.relative(AKAR, abs).replace(/\\/g, '/');
  const kode = tanpaKomentar(fs.readFileSync(abs, 'utf8'));

  // `window.open(sesuatu.src)` — membuka tautan yang sudah tergambar, bukan
  // yang baru dibuat.
  if (/window\.open\(\s*\w+\.src\b/.test(kode)) {
    salah(
      `${rel}: membuka \`.src\` sebuah gambar yang sudah tergambar. Tautan itu dibuat saat halamannya dimuat — ` +
        'gambarnya tetap terlihat dari cache, tapi tautannya sudah mati, dan yang menekannya mendapat layar hitam.'
    );
  }
  // `<a href="${url}">` yang membungkus gambar bertanda tangan.
  if (/<a href="\$\{(?:escapeHtml|esc)\(url\)\}"/.test(kode)) {
    salah(
      `${rel}: membekukan tautan bertanda tangan di dalam \`<a href>\`. Ia menua selama dialognya terbuka, dan ` +
        'ketukan sepuluh menit kemudian membuka tautan yang sudah kedaluwarsa.'
    );
  }
}

// ---------------------------------------------------------------
// 2. Modul aturannya.
// ---------------------------------------------------------------
const modul = baca('js/core/tautan-foto.js');
if (modul) {
  const kode = bersih(modul, 'tautan-foto.js', ['export function pesanGagalFoto']);

  // Umurnya PENDEK. Memperpanjangnya adalah "perbaikan" yang paling menggoda
  // dan paling mahal: ia menukar satu keluhan dengan kebocoran yang tidak ada
  // yang memperhatikan.
  const ketuk = Number(kode.match(/UMUR_TAUTAN_KETUK = (\d+)/)?.[1]);
  const thumb = Number(kode.match(/UMUR_TAUTAN_THUMBNAIL = (\d+)/)?.[1]);
  if (!Number.isFinite(ketuk) || ketuk > 120) {
    salah(
      `tautan-foto.js: umur tautan yang diketuk ${ketuk} detik. Ia dibuat tepat sebelum dipakai, jadi pendek tidak ` +
        'pernah mengganggu siapa pun — sementara panjang membuat tautan yang tersalin bisa dibuka tanpa login.'
    );
  }
  if (!Number.isFinite(thumb) || thumb > 900 || thumb <= ketuk) {
    salah(`tautan-foto.js: umur thumbnail ${thumb} detik tidak masuk akal (harus di atas ${ketuk}, jauh di bawah sejam).`);
  }
  // Kedaluwarsa diperiksa SEBELUM 403 — kalau terbalik, kasus yang paling
  // sering justru yang salah dikenali.
  const iExp = kode.indexOf("pesan.includes('exp')");
  const i403 = kode.indexOf("kode === '403'");
  if (iExp < 0 || i403 < 0 || iExp > i403) {
    salah(
      'tautan-foto.js: kedaluwarsa tidak diperiksa sebelum 403. Storage menjawab 403 untuk keduanya — yang ' +
        'diperiksa belakangan tidak akan pernah menang.'
    );
  }
  if (!/return PESAN_GAGAL_UMUM;/.test(kode)) {
    salah('tautan-foto.js: sebab tak dikenal tidak punya kalimatnya sendiri — gangguan jaringan ikut dituduh soal izin.');
  }
}

// ---------------------------------------------------------------
// 3. Pemakainya.
// ---------------------------------------------------------------
const hal = baca('js/modules/asset/asset.page.js');
if (hal) {
  const kode = bersih(hal, 'asset.page.js', ['const bukaFoto']);
  if (!/const bukaFoto = async \(path\) => \{/.test(kode)) {
    salah('asset.page.js: thumbnail & tombol "Lihat" tidak lagi memakai satu jalan yang sama — yang satu akan berhenti dibuat ulang.');
  }
  if (!/await getAssetPhotoUrl\(path\)/.test(kode)) {
    salah('asset.page.js: tautannya tidak dibuat ulang saat diketuk.');
  }
  if (!/pesanGagalFoto\(error\)/.test(kode)) {
    salah('asset.page.js: sebab kegagalan tidak dibedakan.');
  }
  // Keduanya lewat `bukaFoto`, bukan salah satu saja.
  if ((kode.match(/bukaFoto\((?:img|b)\.dataset\.path\)/g) ?? []).length < 2) {
    salah('asset.page.js: cuma salah satu dari thumbnail & tombol "Lihat" yang membuat tautan baru.');
  }
}

const svcAset = baca('js/modules/asset/asset.service.js');
if (svcAset) {
  const kode = bersih(svcAset, 'asset.service.js', ['UMUR_TAUTAN_KETUK']);
  if (!/createSignedUrl\(path, UMUR_TAUTAN_KETUK\)/.test(kode)) {
    salah('asset.service.js: umur tautan ditulis angka lagi, bukan diambil dari `core/tautan-foto.js` — dua layar akan menyimpang.');
  }
  if (!/expiresIn = UMUR_TAUTAN_THUMBNAIL/.test(kode)) {
    salah('asset.service.js: umur tautan thumbnail ditulis angka lagi.');
  }
  // MELEMPAR, bukan mengembalikan null: `null` menghapus bedanya kedaluwarsa
  // dan tidak berizin.
  //
  // DIIKAT KE BLOK `getAssetPhotoUrl`, bukan dicari di seluruh berkas:
  // `if (error) throw error;` muncul di belasan fungsi lain di sini, jadi pola
  // polos tetap ketemu walau justru fungsi INI yang sudah menelan galatnya.
  // Sabotase yang membuktikannya memang lolos di percobaan pertama.
  const iFoto = kode.indexOf('export async function getAssetPhotoUrl');
  const blokFoto = iFoto < 0 ? '' : kode.slice(iFoto, kode.indexOf('\n}', iFoto));
  if (!blokFoto) salah('asset.service.js: `getAssetPhotoUrl` tidak ada.');
  else if (!/if \(error\) throw error;/.test(blokFoto)) {
    salah('asset.service.js `getAssetPhotoUrl`: menelan galatnya — pemanggilnya kehilangan bedanya kedaluwarsa dan tidak berizin.');
  }
}

const svcNota = baca('js/modules/inventory/nota.service.js');
if (svcNota) {
  const kode = bersih(svcNota, 'nota.service.js', ['export async function urlFotoNota']);
  const i = kode.indexOf('export async function urlFotoNota');
  const blok = i < 0 ? '' : kode.slice(i, i + 500);
  if (!/expiresIn = UMUR_TAUTAN_KETUK/.test(blok)) {
    salah('nota.service.js: umur tautan foto nota ditulis angka lagi.');
  }
  if (!/if \(error\) throw error;/.test(blok)) {
    salah(
      'nota.service.js `urlFotoNota`: kembali mengembalikan `null` saat gagal. Seluruh sebab lalu terbaca sama, dan ' +
        'yang tautannya cuma kedaluwarsa pergi meminta hak akses yang sudah ia punya.'
    );
  }
}

const dlg = baca('js/modules/inventory/nota-dialog.js');
if (dlg) {
  const kode = bersih(dlg, 'nota-dialog.js', ['await urlFotoNota(path)']);
  if ((kode.match(/await urlFotoNota\(path\)/g) ?? []).length < 2) {
    salah(
      'nota-dialog.js: tautannya cuma dibuat sekali. Gambarnya boleh memakai yang itu; KETUKANNYA harus membuat ' +
        'yang baru — kalau tidak, ia menua selama dialognya terbuka.'
    );
  }
  if (/PESAN_FOTO_GAGAL/.test(kode)) {
    salah('nota-dialog.js: kalimat tunggal yang menuduh peran outlet hidup lagi — ia dipakai juga untuk kegagalan yang bukan soal izin.');
  }
}

// ---------------------------------------------------------------
// 4. Migration 0154.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0154_foto_aset_terlihat_se_bu.sql');
if (mig) {
  const sql = mig.replace(/--[^\n]*/g, '');

  if (!/has_bu_scope\(auth\.uid\(\), asset_photo_bu\(name\)\)/.test(sql)) {
    salah('0154: izin baca foto aset tidak disamakan dengan izin barisnya (`has_bu_scope`).');
  }
  // Policy TIDAK boleh membaca tabel langsung — ekspresinya dinilai dengan hak
  // pemanggilnya, dan yang tidak punya SELECT atas `outlets` mendapat 42501
  // pada query FOTONYA, tanpa menyebut `outlets` sama sekali.
  const iPolicy = sql.indexOf('create policy asset_photo_select');
  const policy = iPolicy < 0 ? '' : sql.slice(iPolicy, sql.indexOf(');', iPolicy));
  if (/from\s+outlets/i.test(policy) || /from\s+assets/i.test(policy)) {
    salah(
      '0154: policy membaca tabel langsung. Ekspresi policy dinilai dengan hak PEMANGGILNYA — yang tidak punya ' +
        'SELECT atas tabel itu mendapat `42501 permission denied` pada query fotonya, tanpa petunjuk apa pun.'
    );
  }
  if (!/security definer/.test(sql.slice(sql.indexOf('function asset_photo_bu'), sql.indexOf('function asset_photo_bu') + 300))) {
    salah('0154: `asset_photo_bu` bukan `security definer` — ia membaca `outlets` atas nama pemanggilnya.');
  }
  // HANYA select yang diganti.
  for (const p of ['asset_photo_insert', 'asset_photo_update', 'asset_photo_delete']) {
    if (new RegExp(`create policy ${p}`).test(sql)) {
      salah(
        `0154: \`${p}\` ikut ditulis ulang. Yang diminta cuma MELIHAT — melonggarkan tulis/hapus "sekalian saja" ` +
          'adalah cara paling sering sebuah izin melebar tanpa ada yang memutuskan.'
      );
    }
  }
  if (!/grant execute on function asset_photo_bu\(text\) to authenticated;/.test(sql)) {
    salah('0154: `asset_photo_bu` tidak bisa dipanggil `authenticated` — setiap pembacaan foto ditolak.');
  }
}

console.log('');
if (gagal === 0) console.log('Audit tautan foto & izin foto aset bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
