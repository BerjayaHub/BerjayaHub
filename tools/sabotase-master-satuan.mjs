/**
 * SABOTASE: master satuan untuk admin BU & admin outlet (0183).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Perubahan ini melonggarkan wewenang, dan kelonggaran selalu lebih mudah
 * terpeleset daripada pengetatan: satu baris yang hilang membuat staff ikut
 * bisa menambah, atau membuat admin mana pun bisa mencabut 'gram' dari
 * SELURUH BU sekaligus — dua-duanya tanpa galat di mana pun.
 *
 * Dan satu bentuk yang lebih halus: perapian nama yang hilang. Daftarnya
 * tetap bertambah, tetap tampil, cuma pelan-pelan memuat "Kg", "kg", "KG",
 * dan tidak ada momen yang bisa ditunjuk sebagai saat ia mulai rusak.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0183_master_satuan_untuk_admin.sql';
const SVC = 'js/modules/product/product.service.js';
const PAGE = 'js/modules/product/product.admin.page.js';

const BERKAS = [MIG, SVC, PAGE];
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

const AUDIT = 'tools/audit-master-satuan.cjs';
const PG = 'tools/test-migrasi-0183.mjs';

for (const p of [AUDIT, PG]) pastikanHijau(p);

// =====================================================================
console.log('SABOTASE: WEWENANGNYA');
// =====================================================================

sabotase(
  'siapa pun yang login bisa menambah satuan',
  MIG,
  "  if not adalah_admin(v_uid) then\n    raise exception 'Hanya admin (BU, outlet, atau super admin) yang bisa menambah satuan.';\n  end if;",
  '',
  PG
);

sabotase(
  'admin outlet kembali ditolak',
  MIG,
  "       and ms.role in ('super_admin', 'bu_admin', 'outlet_admin')",
  "       and ms.role in ('super_admin', 'bu_admin')",
  PG
);

// Satu salah tekan bisa mencabut 'gram' dari seluruh perusahaan.
sabotase(
  'admin bisa menghapus satuan buatan orang lain',
  MIG,
  '    if v_unit.created_by is distinct from v_uid then\n      raise exception \'Satuan ini bukan kamu yang menambahkan. Minta Super Admin kalau memang harus dihapus.\';\n    end if;',
  '',
  PG
);

sabotase(
  'satuan yang sudah dipakai produk ikut bisa dihapus',
  MIG,
  '    if v_dipakai > 0 then',
  '    if false then',
  PG
);

// `purchase_unit` ikut diperiksa: satuan beli yang dihapus membuat konversi
// pembelian kehilangan pilihannya, dan itu jalur yang berbeda dari base_unit.
sabotase(
  'satuan beli tidak ikut dihitung sebagai "dipakai"',
  MIG,
  "        or lower(btrim(coalesce(purchase_unit, ''))) = lower(btrim(v_unit.name));",
  ';',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE: PERAPIAN NAMANYA');
// =====================================================================

sabotase(
  'nama tidak dirapikan — "kg " jadi baris sendiri',
  MIG,
  "  v_nama text := regexp_replace(btrim(coalesce(p_nama, '')), '\\s+', ' ', 'g');",
  "  v_nama text := coalesce(p_nama, '');",
  PG
);

sabotase(
  'duplikat diperiksa dengan peduli huruf besar-kecil',
  MIG,
  '  select * into v_ada from units where lower(btrim(name)) = lower(v_nama) limit 1;',
  '  select * into v_ada from units where name = v_nama limit 1;',
  PG
);

sabotase(
  '"sudah ada" dilaporkan sebagai baru',
  MIG,
  "    return jsonb_build_object('id', v_ada.id, 'nama', v_ada.name, 'baru', false);",
  "    return jsonb_build_object('id', v_ada.id, 'nama', v_ada.name, 'baru', true);",
  PG
);

sabotase(
  'pembuatnya tidak dicatat',
  MIG,
  '  insert into units (name, created_by) values (v_nama, v_uid) returning id into v_id;',
  '  insert into units (name) values (v_nama) returning id into v_id;',
  PG
);

// =====================================================================
console.log('\nSABOTASE: JALAN MASUKNYA');
// =====================================================================

sabotase(
  'klien kembali menulis langsung ke tabel',
  SVC,
  "  const { data, error } = await supabase.rpc('tambah_satuan', { p_nama: String(name ?? '') });",
  "  const { data, error } = await supabase.from('units').insert({ name });",
  AUDIT
);

// Penolakan RLS pada DELETE membalas sukses dengan NOL baris — layarnya lalu
// berkata "Satuan dihapus" kepada orang yang sebenarnya ditolak.
sabotase(
  'hapus kembali memakai .delete() yang gagalnya tidak terdengar',
  SVC,
  "  const { data, error } = await supabase.rpc('hapus_satuan', { p_id: id });",
  "  const { data, error } = await supabase.from('units').delete().eq('id', id);",
  AUDIT
);

sabotase(
  'keterangan lama "hanya Super Admin" dikembalikan',
  PAGE,
  '      Satuan dipilih lewat dropdown saat menambah produk, biar konsisten. Daftar ini',
  '      Hanya Super Admin yang bisa ubah daftar ini. Daftar ini',
  AUDIT
);

sabotase(
  '"sudah ada" tidak dibedakan di layar',
  PAGE,
  '        hasil?.baru === false\n          ? `"${hasil.nama}" sudah ada di daftar — dipakai yang itu.`\n          : `Satuan "${hasil?.nama ?? v.name.trim()}" ditambahkan.`,',
  '        `Satuan ditambahkan.`,',
  AUDIT
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase master satuan tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
