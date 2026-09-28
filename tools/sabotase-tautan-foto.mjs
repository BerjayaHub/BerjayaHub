/**
 * SABOTASE: tautan foto dibuat saat diketuk + izin foto aset se-BU (0154).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Bug yang diperbaiki di sini bertahan berbulan-bulan karena gejalanya
 * BERBOHONG: layarnya terlihat normal, fotonya terpampang, dan yang gagal cuma
 * ketukannya — pada SEBAGIAN orang saja. Dugaan pertamanya selalu jatuh ke
 * role atau sinyal, dan dua-duanya salah.
 *
 * Bentuk yang sama akan lahir lagi di modul berikutnya yang menampilkan foto.
 * Itu sebabnya auditnya menyapu SELURUH `js/`, bukan dua berkas yang kebetulan
 * sedang diperbaiki — dan itu pula yang disabotase di sini.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MURNI = 'js/core/tautan-foto.js';
const MIG = 'supabase/migrations/0154_foto_aset_terlihat_se_bu.sql';
const APAGE = 'js/modules/asset/asset.page.js';
const ASVC = 'js/modules/asset/asset.service.js';
const NSVC = 'js/modules/inventory/nota.service.js';
const NDLG = 'js/modules/inventory/nota-dialog.js';

const asli = new Map();
for (const rel of [MURNI, MIG, APAGE, ASVC, NSVC, NDLG]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  // `String.replace` dengan string hanya mengganti kemunculan PERTAMA.
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
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

const PG = 'tools/test-migrasi-0154.mjs';
const TES = 'tools/test-tautan-foto.mjs';
const AUDIT = 'tools/audit-tautan-foto.cjs';

console.log('SABOTASE TAUTAN YANG DIBEKUKAN — layar normal, ketukan hitam:');

sabotase(
  'thumbnail aset kembali membuka `img.src` — tautan yang lahir bersama halaman',
  APAGE,
  "    list.querySelectorAll('.as-thumb').forEach((img) => img.addEventListener('click', () => bukaFoto(img.dataset.path)));",
  "    list.querySelectorAll('.as-thumb').forEach((img) => img.addEventListener('click', () => window.open(img.src, '_blank')));",
  AUDIT
);
sabotase(
  'dialog nota membekukan tautannya lagi di dalam `<a href>`',
  NDLG,
  '    <img src="${escapeHtml(url)}" alt="Foto nota" loading="lazy" style="cursor:zoom-in" />',
  '    <a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="Foto nota" /></a>',
  AUDIT
);
sabotase(
  'ketukan di dialog nota tidak lagi membuat tautan baru',
  NDLG,
  '      const baru = await urlFotoNota(path);',
  '      const baru = url;',
  AUDIT
);
sabotase(
  'thumbnail & tombol "Lihat" berhenti memakai satu jalan yang sama',
  APAGE,
  '  const bukaFoto = async (path) => {',
  '  const bukaFotoLama = async (path) => {',
  AUDIT
);
sabotase(
  'tautan aset tidak dibuat ulang saat diketuk',
  APAGE,
  '        const url = await getAssetPhotoUrl(path);',
  '        const url = fotoUrl.get(path);',
  AUDIT
);

console.log('\nSABOTASE "PERPANJANG SAJA UMURNYA":');

sabotase(
  'umur tautan ketuk dinaikkan jadi sejam — tautan yang tersalin bisa dibuka siapa pun',
  MURNI,
  'export const UMUR_TAUTAN_KETUK = 60;',
  'export const UMUR_TAUTAN_KETUK = 3600;',
  TES
);
sabotase(
  'umur thumbnail dinaikkan jadi sehari',
  MURNI,
  'export const UMUR_TAUTAN_THUMBNAIL = 600;',
  'export const UMUR_TAUTAN_THUMBNAIL = 86400;',
  TES
);
sabotase(
  'umurnya ditulis angka lagi di layanan aset — dua layar menyimpang',
  ASVC,
  'createSignedUrl(path, UMUR_TAUTAN_KETUK)',
  'createSignedUrl(path, 3600)',
  AUDIT
);
sabotase(
  'umurnya ditulis angka lagi di layanan nota',
  NSVC,
  'export async function urlFotoNota(path, expiresIn = UMUR_TAUTAN_KETUK) {',
  'export async function urlFotoNota(path, expiresIn = 3600) {',
  AUDIT
);

console.log('\nSABOTASE SATU KALIMAT UNTUK SEMUA SEBAB:');

sabotase(
  'kedaluwarsa diperiksa SESUDAH 403 — kasus yang paling sering jadi salah dikenali',
  MURNI,
  "  if (pesan.includes('exp') && pesan.includes('claim')) return PESAN_KEDALUWARSA;",
  '',
  TES
);
sabotase(
  'gangguan jaringan ikut dituduh soal izin',
  MURNI,
  '  return PESAN_GAGAL_UMUM;',
  '  return PESAN_TIDAK_BERIZIN;',
  TES
);
sabotase(
  'kalimat kedaluwarsa menyuruh menghubungi admin, bukan memuat ulang',
  MURNI,
  "  'Tautan fotonya sudah kedaluwarsa karena halaman ini terbuka cukup lama. Muat ulang halamannya, lalu coba lagi.';",
  "  'Foto tidak bisa dibuka. Hubungi admin.';",
  TES
);
sabotase(
  'ketiga kalimatnya disamakan',
  MURNI,
  "export const PESAN_TIDAK_BERIZIN =\n  'Foto ini di luar jangkauanmu. Izin membuka foto mengikuti Business Unit barangnya — hubungi admin kalau seharusnya bisa.';",
  'export const PESAN_TIDAK_BERIZIN = PESAN_KEDALUWARSA;',
  TES
);
sabotase(
  '"not found" tidak lagi dibaca sebagai izin — Storage memang tidak membocorkan keberadaan berkas',
  MURNI,
  "  if (pesan.includes('not found') || kode === '404') return PESAN_TIDAK_BERIZIN;",
  '',
  TES
);
sabotase(
  'layanan aset menelan galatnya — pemanggilnya kehilangan bedanya',
  ASVC,
  '  const { data, error } = await supabase.storage.from(\'asset-photos\').createSignedUrl(path, UMUR_TAUTAN_KETUK);\n  if (error) throw error;',
  "  const { data, error } = await supabase.storage.from('asset-photos').createSignedUrl(path, UMUR_TAUTAN_KETUK);\n  if (error) return null;",
  AUDIT
);
sabotase(
  'layanan nota menelan galatnya lagi',
  NSVC,
  '  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);\n  if (error) throw error;',
  '  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);\n  if (error) return null;',
  AUDIT
);
sabotase(
  'kalimat tunggal yang menuduh peran outlet hidup lagi di dialog nota',
  NDLG,
  '      kotak.innerHTML = `<p class="nota-foto-status error-text">${escapeHtml(pesanGagalFoto(error))}</p>`;',
  '      const PESAN_FOTO_GAGAL = \'Izin membuka foto nota mengikuti OUTLET notanya.\';\n      kotak.innerHTML = `<p class="nota-foto-status error-text">${escapeHtml(PESAN_FOTO_GAGAL)}</p>`;',
  AUDIT
);

console.log('\nSABOTASE 0154 DI DATABASE:');

sabotase(
  'izin baca foto kembali ke outlet — staff satu BU tidak bisa melihat foto outlet tetangga',
  MIG,
  '    and has_bu_scope(auth.uid(), asset_photo_bu(name))',
  '    and has_outlet_scope(auth.uid(), asset_photo_outlet(name))',
  PG
);
sabotase(
  'policy membaca `outlets` langsung — 42501 pada query fotonya, tanpa petunjuk',
  MIG,
  '    and has_bu_scope(auth.uid(), asset_photo_bu(name))',
  '    and exists (select 1 from outlets o where o.id = asset_photo_outlet(name) and has_bu_scope(auth.uid(), o.business_unit_id))',
  AUDIT
);
sabotase(
  '`asset_photo_bu` bukan `security definer` — ia membaca outlets atas nama pemanggilnya',
  MIG,
  'returns uuid\nlanguage sql\nsecurity definer\nstable',
  'returns uuid\nlanguage sql\nstable',
  PG
);
sabotase(
  'izin MENGUNGGAH ikut dilonggarkan — "sekalian saja"',
  MIG,
  'drop policy if exists asset_photo_select on storage.objects;',
  "drop policy if exists asset_photo_select on storage.objects;\ndrop policy if exists asset_photo_insert on storage.objects;\ncreate policy asset_photo_insert on storage.objects\n  for insert to authenticated\n  with check (bucket_id = 'asset-photos' and has_bu_scope(auth.uid(), asset_photo_bu(name)));",
  PG
);
sabotase(
  'RPC-nya tidak bisa dipanggil — setiap pembacaan foto ditolak',
  MIG,
  'grant execute on function asset_photo_bu(text) to authenticated;',
  '',
  AUDIT
);
sabotase(
  'BU lain ikut terbuka — bukan "se-BU", tapi "semua orang"',
  MIG,
  '    and has_bu_scope(auth.uid(), asset_photo_bu(name))',
  '    and asset_photo_bu(name) is not null',
  PG
);

console.log('');
if (gagal === 0) console.log('Semua sabotase tautan foto tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya tidak menjaga apa yang dikiranya dijaga.`);
process.exit(gagal === 0 ? 0 : 1);
