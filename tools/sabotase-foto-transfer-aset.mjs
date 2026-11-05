/**
 * SABOTASE: foto aset yang ikut berpindah saat transfer antar BU (0179).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Perbaikannya punya DUA bagian — penunjuk fotonya, dan izin membacanya — dan
 * masing-masing sendirian menghasilkan keadaan yang LEBIH BURUK daripada tidak
 * ada: gambar yang selalu gagal dimuat, yang di layar terbaca persis seperti
 * "barangnya belum difoto". Tidak ada galat di satu pun jalurnya.
 *
 * Ditambah satu bahaya khas migration ini: dua fungsi transfer ditulis ulang
 * UTUH hanya untuk menyisipkan satu baris.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0179_foto_aset_ikut_transfer.sql';
const SVC = 'js/modules/asset/asset.service.js';
const ATURAN = 'js/modules/asset/aturan-aset-bu.js';
const PAGE = 'js/modules/asset/asset.page.js';

const BERKAS = [MIG, SVC, ATURAN, PAGE];
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
// "Tertangkap" hanya berarti sesuatu kalau pemeriksanya memang hijau sebelum
// kodenya dirusak. Pemeriksa yang sudah merah sejak awal akan melaporkan
// SELURUH sabotase sebagai tertangkap, dan harness ini berubah jadi stempel.
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

const AUDIT = 'tools/audit-foto-transfer-aset.cjs';
const PG = 'tools/test-migrasi-0179.mjs';

for (const p of [AUDIT, PG]) pastikanHijau(p);

// =====================================================================
console.log('SABOTASE PENUNJUK FOTONYA:');
// =====================================================================

sabotase(
  'transfer berhenti mewariskan fotonya',
  MIG,
  // Blok DIAWALI `if v_bu_tujuan = v_bu then` — kalimat yang hanya ada di
  // `kirim_transfer_aset`; yang di `ubah_transfer_aset` berbunyi
  // `= t.business_unit_id`. Tanpa jangkar itu polanya cocok di dua tempat dan
  // harness menolaknya.
  //
  // Yang dicabut HANYA baris `perform`-nya. Percobaan pertama menonaktifkan
  // seluruh cabangnya (`and false`), dan itu justru membuat transfer SATU BU
  // ikut lewat jalur lintas-BU — kerusakan yang berbeda, dan kebetulan tidak
  // tertangkap pemeriksaan mana pun.
  'if v_bu_tujuan = v_bu then\n        v_item_tujuan := v_item;\n      else\n        -- Lintas BU: kode milik BU, jadi tidak ikut pindah. Item padanannya\n        -- dicari lewat nama + kategori yang SAMA PERSIS, dibuatkan kalau belum\n        -- ada — beserta kodenya sendiri di BU tujuan.\n        select id into v_item_tujuan from asset_items\n         where business_unit_id = v_bu_tujuan and name = v_nama_item and category is not distinct from v_kat\n         limit 1;\n        if v_item_tujuan is null then\n          insert into asset_items (business_unit_id, kode, name, category, size, created_by)\n          values (v_bu_tujuan, kode_aset_berikutnya(v_bu_tujuan, v_kat), v_nama_item, v_kat, v_size, v_uid)\n          returning id into v_item_tujuan;\n        end if;\n        -- BARIS INTI 0179: fotonya ikut berpindah sebagai PENUNJUK.\n        --\n        -- Diletakkan tepat sesudah item tujuan dipastikan ada (dicari atau\n        -- dibuat), dan hanya di cabang LINTAS BU — dalam satu BU itemnya sama\n        -- persis, jadi fotonya memang sudah yang itu.\n        perform wariskan_foto_item_aset(v_item, v_item_tujuan);',
  'if v_bu_tujuan = v_bu then\n        v_item_tujuan := v_item;\n      else\n        -- Lintas BU: kode milik BU, jadi tidak ikut pindah. Item padanannya\n        -- dicari lewat nama + kategori yang SAMA PERSIS, dibuatkan kalau belum\n        -- ada — beserta kodenya sendiri di BU tujuan.\n        select id into v_item_tujuan from asset_items\n         where business_unit_id = v_bu_tujuan and name = v_nama_item and category is not distinct from v_kat\n         limit 1;\n        if v_item_tujuan is null then\n          insert into asset_items (business_unit_id, kode, name, category, size, created_by)\n          values (v_bu_tujuan, kode_aset_berikutnya(v_bu_tujuan, v_kat), v_nama_item, v_kat, v_size, v_uid)\n          returning id into v_item_tujuan;\n        end if;',
  PG
);

// Kalau hanya `kirim` yang mewariskan, transfer yang DIREVISI kehilangan
// fotonya — justru saat orangnya sedang membetulkan.
sabotase(
  'hanya satu jalur yang mewariskan — revisi kehilangan fotonya',
  MIG,
  'if v_bu_tujuan = t.business_unit_id then',
  'if v_bu_tujuan = t.business_unit_id or true then',
  AUDIT
);

sabotase(
  'warisan menimpa foto yang sudah ada di BU tujuan',
  MIG,
  "       and (btrim(coalesce(photo_path, '')) <> '' or btrim(coalesce(foto_asal_path, '')) <> '')",
  '       and false',
  AUDIT
);

// ============ MENUMPANG `photo_path` ============
//
// Trigger 0171 mengosongkan kolom itu kalau tidak ada foto di stok BU-nya
// sendiri — warisannya terhapus sendiri pada perubahan foto berikutnya.
sabotase(
  'warisan ditulis ke photo_path, bukan kolomnya sendiri',
  MIG,
  '     set foto_asal_path = v_path,\n         foto_asal_outlet_id = v_outlet',
  '     set photo_path = v_path,\n         photo_outlet_id = v_outlet',
  PG
);

sabotase(
  'backfill dicabut — transfer yang sudah terlanjur tetap tanpa foto',
  MIG,
  '    perform wariskan_foto_item_aset(r.asal, r.tujuan);',
  '    null;',
  PG
);

// =====================================================================
console.log('\nSABOTASE IZIN BACANYA:');
// =====================================================================

// Penunjuk yang benar tanpa izin = gambar yang SELALU gagal dimuat, dan di
// layar itu terbaca persis seperti "barangnya belum difoto".
sabotase(
  'izin baca foto warisan dicabut dari policy',
  MIG,
  '      or boleh_lihat_foto_warisan(name)',
  '',
  PG
);

sabotase(
  'jalur izin LAMA ikut hilang — BU pemilik berkasnya sendiri ditolak',
  MIG,
  '      has_bu_scope(auth.uid(), asset_photo_bu(name))\n',
  '      false\n',
  PG
);

// ============ IZIN YANG MELEBAR ============
//
// Tidak diikat ke berkas yang ditunjuk, satu warisan membuka SELURUH folder
// outlet asal untuk BU penerimanya.
sabotase(
  'izin tidak diikat ke berkas yang ditunjuk',
  MIG,
  '     where i.foto_asal_path = p_name',
  '     where i.foto_asal_path is not null',
  PG
);

// =====================================================================
console.log('\nSABOTASE PENULISAN ULANG FUNGSINYA:');
// =====================================================================

// ============ YANG SUDAH TERJADI SEKALI ============
//
// Percobaan pertama 0179 menulis ulang `kirim_transfer_aset` dari ingatan dan
// kehilangan DUA insert `asset_log` — riwayat aset berhenti menyebutkan
// transfer sama sekali, tanpa satu pun galat.
sabotase(
  'jejak asset_log transfer-keluar hilang saat fungsinya ditulis ulang',
  MIG,
  "    values (v_item, v_bu, p_from_outlet, 'transfer-keluar', v_kode, v_qty::text, null,",
  "    values (v_item, v_bu, p_from_outlet, 'transfer-masuk', v_kode, v_qty::text, null,",
  AUDIT
);

sabotase(
  'satu baris penjaga hilang dari fungsi yang disalin',
  MIG,
  "raise exception 'Belum ada barang yang dipilih.';",
  "raise exception 'Kosong.';",
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE KLIEN:');
// =====================================================================

sabotase(
  'kolom warisan tidak ikut diambil — item hasil transfer tampil tanpa foto',
  SVC,
  ', foto_asal_path, foto_asal_outlet_id',
  '',
  AUDIT
);

sabotase(
  'warisan didahulukan di atas foto se-BU',
  ATURAN,
  'i?.photo_path ?? i?.foto_asal_path ?? null',
  'i?.foto_asal_path ?? i?.photo_path ?? null',
  AUDIT
);

sabotase(
  'asal fotonya tidak lagi dibedakan di layar',
  PAGE,
  "      ? 'Foto bawaan dari BU asal saat aset ini ditransfer — bukan foto barang di outlet ini'",
  "      ? 'Foto acuan'",
  AUDIT
);

sabotase('penanda "foto dari BU asal" dicabut', PAGE, "'foto dari BU asal'", "'foto outlet lain'", AUDIT);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase foto transfer aset tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
