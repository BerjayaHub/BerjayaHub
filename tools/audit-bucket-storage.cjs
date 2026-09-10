/**
 * AUDIT: tiap bucket yang dipakai kode harus benar-benar dibuat migration —
 * dan migration pembuatnya harus AMAN DIJALANKAN ULANG.
 *
 * ============ KEJADIAN YANG MELAHIRKAN AUDIT INI ============
 *
 *   "di terima dari supplier masih tidak bisa upload foto nota,
 *    keterangan no bucket"
 *
 * Bucket `receipt-photos` memang tidak ada. Sebabnya bukan di isi `0084`
 * melainkan di BENTUKNYA:
 *
 *   baris  71  create policy gr_select on goods_receipts     <-- tanpa drop
 *   ...
 *   baris 263  insert into storage.buckets ... receipt-photos  <-- di ujung
 *
 * `create policy` tanpa `drop policy if exists` GAGAL kalau kebijakannya sudah
 * ada. Begitu `0084` dijalankan ulang — hal yang wajar setelah sesuatu di
 * tengah gagal — ia berhenti di baris 71 dan tidak pernah sampai ke baris 263.
 *
 * Bentuk kegagalannya yang paling mahal: SEMUANYA BEKERJA kecuali satu tombol,
 * dan tombol itu menjawab dengan kalimat teknis yang tidak menyebut sebabnya.
 * Tidak ada tes yang bisa menangkapnya, karena tidak ada yang salah di kode.
 *
 * Yang dijaga:
 *   1. Tiap `storage.from('x')` di js/ punya bucket `x` di suatu migration.
 *      Termasuk yang namanya lewat KONSTANTA — `nota.service.js` memakai
 *      `from(BUCKET)`, dan pencarian yang cuma melihat string literal akan
 *      melewatkannya. Justru bucket itulah yang hilang.
 *   2. Migration yang membuat bucket harus idempotent: `on conflict do nothing`,
 *      dan `create policy`-nya didahului `drop policy if exists`.
 *      Aturan (2) hanya berlaku untuk migration BARU (>= 0130); yang lama sudah
 *      terlanjur dijalankan dan menulis ulangnya justru berbahaya.
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

// ---------------------------------------------------------------
// Kumpulkan bucket yang DIBUAT migration.
// ---------------------------------------------------------------
const DIR_MIG = path.join(AKAR, 'supabase/migrations');
const berkasMig = fs.existsSync(DIR_MIG) ? fs.readdirSync(DIR_MIG).filter((f) => f.endsWith('.sql')).sort() : [];
if (!berkasMig.length) {
  salah('supabase/migrations kosong — audit ini kehilangan sasarannya.');
  process.exit(1);
}

const dibuat = new Map(); // nama bucket -> berkas migration
for (const f of berkasMig) {
  const isi = fs.readFileSync(path.join(DIR_MIG, f), 'utf8');
  for (const m of isi.matchAll(/insert into storage\.buckets[\s\S]{0,400}?;/g)) {
    for (const b of m[0].matchAll(/\('([a-z0-9-]+)',\s*'\1'/g)) {
      if (!dibuat.has(b[1])) dibuat.set(b[1], f);
    }
  }
}

// ---------------------------------------------------------------
// 1. Bucket yang DIPAKAI kode — literal maupun lewat konstanta.
// ---------------------------------------------------------------
const berkasJs = [];
(function telusur(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) telusur(p);
    else if (e.name.endsWith('.js')) berkasJs.push(p);
  }
})(path.join(AKAR, 'js'));

for (const p of berkasJs) {
  const rel = path.relative(AKAR, p).replace(/\\/g, '/');
  const kode = tanpaKomentar(fs.readFileSync(p, 'utf8'));

  for (const m of kode.matchAll(/storage\.from\(\s*([^)]+?)\s*\)/g)) {
    const arg = m[1].trim();
    let nama = null;

    if (/^['"][a-z0-9-]+['"]$/.test(arg)) {
      nama = arg.slice(1, -1);
    } else if (/^[A-Z][A-Z0-9_]*$/.test(arg)) {
      // KONSTANTA MODUL (HURUF BESAR). Nilainya dicari di berkas yang sama —
      // inilah jalur yang melewatkan `receipt-photos` sampai staff melapor dari
      // outlet, karena pencarian yang cuma melihat string literal tidak
      // menemukannya.
      const konst = new RegExp(`const\\s+${arg}\\s*=\\s*['"]([a-z0-9-]+)['"]`).exec(kode);
      if (!konst) {
        salah(`${rel}: \`storage.from(${arg})\` — nilai konstantanya tidak bisa ditelusuri, jadi bucketnya tidak bisa diperiksa.`);
        continue;
      }
      nama = konst[1];
    } else {
      // Huruf kecil = PARAMETER, bukan konstanta.
      //
      // `dokumen.service.js` punya `urlSementara(bucket, path)` dan
      // `unduhBytes(bucket, path)` — penolong yang memang menerima bucket mana
      // pun dari pemanggilnya. Nilainya tidak bisa dan tidak perlu ditelusuri
      // di sini; yang menentukan bucketnya adalah pemanggil, dan pemanggil itu
      // sudah diperiksa lewat jalur literal di atas.
      //
      // Versi pertama audit ini menuduh keduanya. Audit yang menuduh kode benar
      // akan dimatikan orang, dan sesudah itu ia tidak menjaga apa pun.
      continue;
    }

    if (!dibuat.has(nama)) {
      salah(
        `${rel}: memakai bucket \`${nama}\`, tapi tidak ada satu pun migration yang membuatnya. ` +
          'Di layar staff ini muncul sebagai "Bucket not found" — kalimat yang tidak bisa ditindaklanjuti siapa pun.'
      );
    }
  }
}

// ---------------------------------------------------------------
// 2. Migration BARU yang menyentuh storage harus idempotent.
//
// Batasnya 0130 ke atas: berkas lama sudah terlanjur dijalankan di server
// sungguhan, dan mengubahnya sekarang tidak memperbaiki apa pun sambil
// mengaburkan riwayat.
// ---------------------------------------------------------------
for (const f of berkasMig) {
  const nomor = Number(f.slice(0, 4));
  if (!Number.isFinite(nomor) || nomor < 130) continue;
  const isi = fs.readFileSync(path.join(DIR_MIG, f), 'utf8');
  if (!/storage\.(buckets|objects)/.test(isi)) continue;

  if (/insert into storage\.buckets/.test(isi) && !/on conflict \(id\) do nothing/.test(isi)) {
    salah(`${f}: membuat bucket tanpa \`on conflict (id) do nothing\` — dijalankan ulang akan gagal.`);
  }

  // Tiap `create policy ... on storage.objects` harus punya `drop` sebelumnya.
  const buat = [...isi.matchAll(/create policy (\w+) on storage\.objects/g)].map((m) => m[1]);
  for (const nama of buat) {
    if (!new RegExp(`drop policy if exists ${nama} on storage\\.objects`).test(isi)) {
      salah(
        `${f}: \`create policy ${nama}\` tanpa \`drop policy if exists\` di depannya. ` +
          'Persis bentuk yang membuat 0084 berhenti di tengah dan bucketnya tidak pernah lahir.'
      );
    }
  }
}

// ---------------------------------------------------------------
// 3. Perbaikannya sendiri harus ada dan menyebut bucket yang dilaporkan.
// ---------------------------------------------------------------
const perbaikan = berkasMig.find((f) => Number(f.slice(0, 4)) >= 130 && /receipt-photos/.test(fs.readFileSync(path.join(DIR_MIG, f), 'utf8')));
if (!perbaikan) {
  salah('Tidak ada migration >= 0130 yang memastikan bucket `receipt-photos` ada — keluhan aslinya tidak tersentuh.');
} else {
  const isi = fs.readFileSync(path.join(DIR_MIG, perbaikan), 'utf8');
  // Migration yang "berhasil" tanpa berkata apa-apa adalah persis cara masalah
  // ini bisa bertahan berbulan-bulan.
  if (!/raise (notice|exception)/.test(isi)) {
    salah(`${perbaikan}: tidak melaporkan hasilnya. Kalau bucketnya tetap tidak ada, ketahuannya harus SEKARANG, bukan saat staff menekan tombol unggah.`);
  }
}

if (gagal === 0) {
  console.log(`Bucket storage: ${dibuat.size} bucket dibuat migration, semua yang dipakai kode ada, dan yang baru aman dijalankan ulang. ✅`);
}
process.exit(gagal === 0 ? 0 : 1);
