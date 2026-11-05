/**
 * SABOTASE: satu kode untuk satu barang, di seluruh BU (0180).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Kerusakan di sini tidak pernah berbunyi. Kode yang salah tetap kode: ia
 * tampil rapi, bisa dicari, bisa dicetak di surat jalan, dan baru ketahuan
 * berbulan-bulan kemudian saat dua BU membandingkan catatannya — atau saat
 * owner menanyakan barang yang kodenya sudah berarti barang lain.
 *
 * Dan satu bentuk kerusakan di migration ini TIDAK BISA DIBATALKAN:
 * penyelarasan yang menimpa kode yang lebih dulu ada, tanpa menyimpan kode
 * sebelumnya, menghapus satu-satunya penghubung ke catatan owner.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0180_kode_aset_global.sql';
const ATURAN = 'js/modules/asset/aturan-aset-bu.js';
const SVC = 'js/modules/asset/asset.service.js';
const PAGE = 'js/modules/asset/asset.page.js';

const BERKAS = [MIG, ATURAN, SVC, PAGE];
const asli = new Map();
for (const rel of BERKAS) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

const PENANDA = path.join(AKAR, 'tools/.sabotase-aktif');
const tandai = (rel) => fs.writeFileSync(PENANDA, `${path.basename(process.argv[1])} merusak ${rel}\n`);
const lepasTanda = () => {
  try {
    fs.unlinkSync(PENANDA);
  } catch {
    /* belum pernah ada — tidak apa-apa */
  }
};

const pulih = () => {
  if (process.env.SABOTASE_PERIKSA_POLA) return lepasTanda();
  for (const [rel, isi] of asli) fs.writeFileSync(P(rel), isi);
  lepasTanda();
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

// ============ PEMERIKSANYA HARUS HIJAU DULU ============
//
// Pemeriksa yang sudah merah sejak awal melaporkan SELURUH sabotase sebagai
// tertangkap, dan harness ini berubah jadi stempel.
const pastikanHijau = (cmd) => {
  if (process.env.SABOTASE_PERIKSA_POLA) return;
  if (!jalan(cmd)) {
    console.error(`❌ PEMERIKSANYA SUDAH MERAH SEBELUM DISABOTASE: ${cmd} — "tertangkap" di bawah tidak berarti apa-apa.`);
    process.exit(1);
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
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
    return;
  }
  if (process.env.SABOTASE_PERIKSA_POLA) {
    console.log(`   ✔ pola terpasang: ${nama}`);
    return;
  }
  tandai(rel);
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

const AUDIT = 'tools/audit-kode-aset-global.cjs';
const PG = 'tools/test-migrasi-0180.mjs';
const MURNI = 'tools/test-aturan-aset-bu.mjs';

for (const p of [AUDIT, PG, MURNI]) pastikanHijau(p);

// =====================================================================
console.log('SABOTASE PINTUNYA:');
// =====================================================================
//
// Satu trigger menutup EMPAT jalur pembuatan item sekaligus. Begitu ia tidak
// jalan, semuanya kembali membuat kode per BU — dan tidak ada satu pun galat
// yang muncul, karena membuat kode per BU memang masih sah menurut skemanya.

sabotase(
  'triggernya tidak pernah berjalan',
  MIG,
  '  before insert on asset_items\n  for each row execute function kode_global_item_aset();',
  '  before insert on asset_items\n  for each row when (false) execute function kode_global_item_aset();',
  PG
);

sabotase(
  'kode pusat ditemukan tapi tidak dipakai',
  MIG,
  '    if not v_dipakai then\n      new.kode := v_kode;',
  '    if not v_dipakai then\n      new.kode := new.kode;',
  PG
);

sabotase(
  'ganti nama tidak lagi membawa kodenya',
  MIG,
  '  after update of name, category on asset_items',
  '  after update of size on asset_items',
  PG
);

// Keadaan 3: kode pusat ternyata sudah dipakai barang LAIN di BU tujuan.
// Merampasnya berarti mengubah kode item yang sudah ada — yang kodenya bisa
// jadi sudah tertempel di barangnya.
sabotase(
  'kode item yang sudah ada dirampas',
  MIG,
  '    if not v_dipakai then',
  '    if true then',
  PG
);

// =====================================================================
console.log('\nSABOTASE NOMOR BERIKUTNYA:');
// =====================================================================

sabotase(
  'nomor baru dihitung dari daftar pusat saja',
  MIG,
  "      union all\n      select substr(upper(btrim(kode)), length(v_prefix) + 1)::int\n        from asset_kode_global\n       where upper(btrim(kode)) ~ ('^' || v_prefix || '[0-9]+$')\n",
  '',
  AUDIT
);

sabotase(
  'baris prefixnya tidak dikunci lagi',
  MIG,
  '  perform 1 from asset_category_prefix where prefix = v_prefix for update;',
  '  perform 1 from asset_category_prefix where prefix = v_prefix;',
  AUDIT
);

// Tanpa indeks ini, daftar pusatnya sendiri boleh memuat "K004 = Piring" dan
// "K004 = Mangkok" — keadaan yang migration ini ada untuk menghapusnya, cuma
// dipindahkan ke tabel yang terdengar berwibawa.
sabotase(
  'satu kode boleh berarti dua barang di daftar pusat',
  MIG,
  '  on asset_kode_global(upper(btrim(kode))) where utama;',
  '  on asset_kode_global(upper(btrim(kode)));',
  PG
);

// =====================================================================
console.log('\nSABOTASE PENYELARASANNYA:');
// =====================================================================
//
// Bagian yang TIDAK BISA DIBATALKAN. Kode yang ditimpa tanpa disimpan
// memutus satu-satunya penghubung ke catatan owner.

sabotase(
  'yang menang bukan yang duluan mendata',
  MIG,
  "   where btrim(coalesce(i.kode, '')) <> ''\n   order by kunci_item_aset(i.name, i.category), i.created_at, i.id",
  "   where btrim(coalesce(i.kode, '')) <> ''\n   order by kunci_item_aset(i.name, i.category), i.created_at desc, i.id",
  PG
);

sabotase(
  'kode lama tidak disimpan sebelum ditimpa',
  MIG,
  '     set kode_lama = coalesce(i.kode_lama, i.kode),',
  '     set kode_lama = null,',
  PG
);

sabotase(
  'penyelarasan tidak lewat kode sementara',
  MIG,
  "         kode = '~' || left(i.id::text, 8)",
  '         kode = i.kode',
  PG
);

sabotase(
  'penyimpangan di BU tujuan tidak dilaporkan',
  MIG,
  "    values (null, new.business_unit_id, new.name, new.category, v_bentrok, new.kode,\n            'Kode pusat sudah dipakai barang lain di BU ini — item ini memakai kode sendiri.');",
  '    null;',
  PG
);

sabotase(
  'penjaga "sudah pernah jalan" dicabut',
  MIG,
  '  if exists (select 1 from asset_kode_global) then',
  '  if false then',
  PG
);

// Sejak ada trigger, kode yang dihitung SEBELUM insert bukan lagi kode yang
// tersimpan — dan kode yang salah di layar adalah kode yang terlanjur ditulis
// orang di bukunya.
sabotase(
  '`tambah_item_aset` mengembalikan kode yang tidak tersimpan',
  MIG,
  '  returning id, kode into v_id, v_kode;',
  '  returning id into v_id;',
  PG
);

// =====================================================================
console.log('\nSABOTASE KLIEN:');
// =====================================================================

sabotase(
  'kode lama tidak ikut diambil',
  SVC,
  'id, kode, kode_lama, name',
  'id, kode, name',
  AUDIT
);

// Yang memegang catatan lama mencari kode LAMA. Pencarian yang tidak
// menemukannya terbaca sebagai "barangnya sudah tidak ada".
sabotase(
  'kotak Cari kode berhenti mencari kode lama',
  SVC,
  'qItem.or(`kode.ilike.%${aman}%,kode_lama.ilike.%${aman}%`)',
  'qItem.ilike(`kode`, `%${aman}%`)',
  AUDIT
);

sabotase(
  'kode lama yang sama dengan kode sekarang ikut ditampilkan',
  ATURAN,
  'teks(i?.kode_lama).trim() !== teks(i?.kode).trim()',
  "teks(i?.kode_lama).trim() !== ''",
  MURNI
);

sabotase(
  'kode lama tersimpan tapi tidak pernah terbaca di layar',
  PAGE,
  '`<div style="font-family:inherit;font-size:0.68rem;color:var(--color-text-muted)" title="Kode ini diselaraskan antar BU — barang yang sama kini berkode sama di semua BU">dulu ${esc(a.kode_lama)}</div>`',
  "''",
  AUDIT
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase kode aset global tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
