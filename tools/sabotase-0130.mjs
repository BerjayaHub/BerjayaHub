/**
 * SABOTASE 0130 — memeriksa bahwa tes & auditnya benar-benar MENGGIGIT.
 *
 * Perbaikan ini jenisnya khusus: yang rusak bukan kode, melainkan KEADAAN
 * server. Tidak ada tes lama yang bisa menangkapnya, karena tidak ada yang
 * salah di kode mana pun. Maka penjagaannya harus dibuat sendiri — dan
 * penjagaan yang dibuat sendiri paling mudah jadi hiasan.
 *
 * Jalankan: node tools/sabotase-0130.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0130_bucket_foto_nota.sql';
const PESAN = 'js/modules/inventory/pesan-unggah.js';
const SVC = 'js/modules/inventory/nota.service.js';
const HAL = 'js/modules/inventory/nota-staff.js';

const asli = new Map();
for (const rel of [MIG, PESAN, SVC, HAL]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

const pulih = () => {
  for (const [rel, isi] of asli) fs.writeFileSync(P(rel), isi);
};
process.on('exit', pulih);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const jalan = (cmd) => {
  try {
    execFileSync('node', [cmd], { cwd: AKAR, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

let gagal = 0;
const sabotase = (nama, rel, dari, ke, pemeriksa) => {
  if (!fs.existsSync(P(pemeriksa))) {
    gagal++;
    console.error(`❌ PEMERIKSANYA TIDAK ADA: ${pemeriksa} — "tertangkap" di sini tidak berarti apa-apa.`);
    return;
  }
  const isi = asli.get(rel);
  const rusak = isi.replace(dari, ke);
  if (rusak === isi) {
    gagal++;
    console.error(`❌ SABOTASE TIDAK TERPASANG: ${nama} — polanya tidak ketemu di ${rel}.`);
    return;
  }
  fs.writeFileSync(P(rel), rusak);
  const hijau = jalan(pemeriksa);
  pulih();
  if (hijau) {
    gagal++;
    console.error(`❌ LOLOS: ${nama}\n   ${pemeriksa} tetap hijau padahal ${rel} sudah dirusak.`);
  } else {
    console.log(`   ✔ tertangkap: ${nama}`);
  }
};

const TES_MIG = 'tools/test-migrasi-0130.mjs';
const TES_PESAN = 'tools/test-pesan-unggah.mjs';
const AUDIT = 'tools/audit-bucket-storage.cjs';

console.log('\n== Migration ==');

sabotase(
  'bucket receipt-photos tidak jadi dibuat — keluhan aslinya tidak tersentuh',
  MIG,
  "  ('receipt-photos',     'receipt-photos',     false),  -- 0084 — foto nota supplier\n",
  '',
  TES_MIG
);

sabotase(
  'foto nota jadi bucket PUBLIK — harga beli & nama supplier terbuka bagi penebak URL',
  MIG,
  "('receipt-photos',     'receipt-photos',     false),",
  "('receipt-photos',     'receipt-photos',     true),",
  TES_MIG
);

sabotase(
  'bu-logos ikut dibuat privat — halaman reservasi publik kehilangan logonya',
  MIG,
  "values ('bu-logos', 'bu-logos', true)",
  "values ('bu-logos', 'bu-logos', false)",
  TES_MIG
);

sabotase(
  'sifat bucket yang sudah ada DITIMPA — berkas privat bisa jadi terbuka',
  MIG,
  /on conflict \(id\) do nothing;\n\n-- `bu-logos` dipisah/,
  'on conflict (id) do update set public = excluded.public;\n\n-- `bu-logos` dipisah',
  TES_MIG
);

sabotase(
  'kebijakan unggah foto nota hilang — bucketnya ada, tapi tetap ditolak RLS',
  MIG,
  /drop policy if exists receipt_photo_insert on storage\.objects;\ncreate policy receipt_photo_insert[\s\S]*?\);\n/,
  '',
  TES_MIG
);

sabotase(
  'migration berhenti idempotent — dijalankan ulang akan gagal seperti 0084',
  MIG,
  'drop policy if exists receipt_photo_select on storage.objects;\n',
  '',
  TES_MIG
);

sabotase(
  'migration berhasil diam-diam tanpa memeriksa hasilnya',
  MIG,
  /do \$\$\ndeclare\n  v_ada boolean;[\s\S]*?end \$\$;/,
  '',
  AUDIT
);

console.log('\n== Pesan di layar ==');

sabotase(
  'pesan bucket hilang kembali jadi teks Inggris Storage',
  PESAN,
  /if \(\/bucket not found\|no such bucket\|bucket\.\*not\.\*exist\/i\.test\(pesan\)\) \{/,
  'if (false) {',
  TES_PESAN
);

sabotase(
  'pesannya berhenti menyebut bahwa notanya tetap bisa disimpan',
  PESAN,
  "'Notanya tetap bisa disimpan tanpa foto — fotonya ditambahkan lewat tombol \"+ Foto\" setelah admin ' +\n      'menjalankan migration 0130.'",
  "'Hubungi admin.'",
  TES_PESAN
);

sabotase(
  'semua sebab disamaratakan — admin mencari sesuatu yang tidak pernah rusak',
  PESAN,
  /if \(\/payload too large\|413\|exceeded the maximum\/i\.test\(pesan\)\) \{[\s\S]*?\n  \}/,
  '',
  TES_PESAN
);

sabotase(
  'galat yang tidak dikenali ditelan di balik kalimat ramah',
  PESAN,
  'return `Foto nota gagal diunggah: ${pesan}`;',
  "return 'Foto nota gagal diunggah.';",
  TES_PESAN
);

sabotase(
  'penanda dan pesannya tidak lagi cocok — tawaran "Simpan tanpa foto" hilang diam-diam',
  PESAN,
  "export const PENANDA_BUCKET_HILANG = 'belum disiapkan di server';",
  "export const PENANDA_BUCKET_HILANG = 'penanda yang berbeda';",
  TES_PESAN
);

sabotase(
  'layar berhenti menawarkan Simpan tanpa foto — notanya tersandera masalah server',
  HAL,
  'if (karenaBucketHilang(pesan)) {',
  'if (false) {',
  TES_PESAN
);

console.log('\n== Audit bucket ==');

sabotase(
  'kode memakai bucket yang tidak dibuat migration mana pun',
  SVC,
  "const BUCKET = 'receipt-photos';",
  "const BUCKET = 'foto-nota-baru';",
  AUDIT
);

console.log('');
if (gagal === 0) {
  console.log('Semua sabotase 0130 tertangkap. Tes & auditnya menggigit. ✅');
} else {
  console.error(`${gagal} sabotase LOLOS.`);
}
process.exit(gagal === 0 ? 0 : 1);
