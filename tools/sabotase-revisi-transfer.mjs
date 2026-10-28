/**
 * SABOTASE: revisi surat jalan transfer aset (0174).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Revisi memindahkan stok DUA KALI dalam satu langkah, dan dokumennya sudah
 * beredar di WhatsApp sebelum revisinya ada. Setiap cara ia rusak
 * menghasilkan layar yang tampak benar sementara stok atau kertas di tangan
 * supir diam-diam melenceng.
 *
 * Yang diuji di sini bukan kodenya, melainkan apakah PEMERIKSANYA masih
 * benar-benar menjaga sesuatu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0174_revisi_transfer_aset.sql';
const PESAN = 'js/modules/asset/pesan-transfer-aset.js';
const SVC = 'js/modules/asset/asset.service.js';
const PAGE = 'js/modules/asset/transfer-aset.page.js';

const BERKAS = [MIG, PESAN, SVC, PAGE];
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

const AUDIT = 'tools/audit-revisi-transfer.cjs';
const PG = 'tools/test-migrasi-0173.mjs';
const MURNI = 'tools/test-pesan-transfer-aset.mjs';

// =====================================================================
console.log('SABOTASE STOK — pembalikan yang berhenti di tengah:');
// =====================================================================

// ============ PENJAGA SEBELUM BERGERAK ============
//
// Tanpa pemeriksaan ini, revisi yang membalikkan dua barang lalu gagal di
// barang ketiga meninggalkan stok yang tidak cocok dengan surat jalan mana
// pun — dan tidak ada galat yang menyebutkan barang mana.
sabotase(
  'penjaga stok outlet tujuan dicabut — penarikan membuat stoknya MINUS',
  MIG,
  'if coalesce(v_ada, 0) < r.qty then',
  'if false then',
  PG
);

sabotase(
  'baris SJ dihapus SEBELUM stoknya dibalikkan — jumlah lamanya hilang',
  MIG,
  `  -- ============ 2. BALIKKAN ============`,
  `  delete from asset_transfer_item where transfer_id = p_id;\n  -- ============ 2. BALIKKAN ============`,
  AUDIT
);

sabotase(
  'stok outlet asal tidak dikembalikan — barangnya hilang dari kedua sisi',
  MIG,
  'update asset_stock set qty = qty + r.qty, updated_by = v_uid, updated_at = now()\n       where asset_item_id = r.asset_item_id and outlet_id = t.from_outlet_id;',
  '/* dibuang */',
  PG
);

sabotase(
  'stok outlet tujuan tidak ditarik kembali — barangnya terhitung DUA KALI',
  MIG,
  'update asset_stock set qty = qty - r.qty, updated_by = v_uid, updated_at = now()\n       where asset_item_id = r.item_tujuan_id and outlet_id = t.to_outlet_id;',
  '/* dibuang */',
  PG
);

// =====================================================================
console.log('\nSABOTASE PENJAGA & JEJAK:');
// =====================================================================

sabotase(
  'wewenang perevisi dicabut — staff outlet bisa menggeser stok dua outlet',
  MIG,
  'if not is_bu_admin(v_uid, t.business_unit_id) then',
  'if false then',
  PG
);

sabotase(
  'alasan revisi tidak lagi wajib — stok bergeser tanpa sebab yang tercatat',
  MIG,
  "if btrim(coalesce(p_alasan, '')) = '' then",
  'if false then',
  PG
);

sabotase(
  'SJ yang sudah dibatalkan boleh direvisi — stok bergerak untuk dokumen tak berlaku',
  MIG,
  'if t.dibatalkan_at is not null then',
  'if false then',
  PG
);

sabotase(
  'nomor revisi tidak naik — dua angka berbeda beredar dengan nomor SJ yang SAMA',
  MIG,
  'revisi_ke = revisi_ke + 1,',
  'revisi_ke = revisi_ke,',
  PG
);

sabotase(
  'nomor revisi tidak naik — DAN auditnya harus merah juga',
  MIG,
  'revisi_ke = revisi_ke + 1,',
  'revisi_ke = revisi_ke,',
  AUDIT
);

sabotase(
  'jejak perevisi dibuang — perubahan stok tanpa nama pelaku',
  MIG,
  'direvisi_by_nama = v_nama,',
  '',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE DOKUMEN — versi lama yang tidak bisa dikenali:');
// =====================================================================

// Versi lama surat jalan sudah beredar di WhatsApp dan tidak bisa ditarik.
// Tanpa penandanya, yang memegang versi lama menyerahkan jumlah lama.
sabotase(
  'penanda REVISI dicabut dari teks WhatsApp',
  PESAN,
  "`No. ${teks(t?.kode) || '-'}${rev > 0 ? `  (REVISI ke-${rev})` : ''}`,",
  "`No. ${teks(t?.kode) || '-'}`,",
  MURNI
);

sabotase(
  'penandanya dipasang TANPA syarat — SJ yang belum pernah direvisi ikut ditandai "ke-0"',
  PESAN,
  'rev > 0 ? `  (REVISI ke-${rev})` : \'\'',
  '`  (REVISI ke-${rev})`',
  MURNI
);

sabotase(
  'nomor revisi tidak pernah sampai ke modul pesan — WA & PDF kehilangan penandanya',
  PAGE,
  'revisiKe: Number(t.revisi_ke) || 0,',
  'revisiKe: 0,',
  AUDIT
);

sabotase(
  'subjudul PDF kehilangan penanda revisi — kertas di tangan supir berbeda dari pesan di HP',
  PAGE,
  "(s.revisiKe > 0 ? `REVISI ke-${s.revisiKe} · ` : '') +",
  '',
  AUDIT
);

sabotase(
  'layanan tidak lagi membaca kolom revisinya — penandanya selalu kosong',
  SVC,
  "'revisi_ke, direvisi_at, direvisi_by_nama, alasan_revisi, ' +",
  '',
  AUDIT
);

// =====================================================================
console.log('\nSABOTASE LAYAR REVISI:');
// =====================================================================

sabotase(
  'tombol Edit dicabut — RPC revisinya tidak bisa dijangkau dari mana pun',
  PAGE,
  '`<button class="tr-edit" data-id="${t.id}">Edit</button>',
  '`<button class="tr-sembunyi" data-id="${t.id}">Edit</button>',
  AUDIT
);

// ============ KOTAK YANG DIBUKA KOSONG MENGHAPUS SISA KIRIMAN ============
//
// Database membalikkan SELURUH kiriman lalu menerapkan daftar yang dikirim
// layar ini. Admin yang cuma mau membetulkan satu baris akan mengirim daftar
// berisi satu baris — dan sisanya terhapus dari surat jalan tanpa peringatan.
sabotase(
  'kotak jumlah dibuka kosong — membetulkan satu baris menghapus sisanya',
  PAGE,
  "value: a.sudah > 0 ? String(a.sudah) : ''",
  "value: ''",
  AUDIT
);

// Barang yang ada di SJ ini sudah KELUAR dari outlet asal.
sabotase(
  'batas jumlah memakai stok outlet asal saja — menurunkan jumlah pun ditolak',
  PAGE,
  'batas: diOutlet + sudah',
  'batas: diOutlet',
  AUDIT
);

sabotase(
  'asset_item_id tidak dibaca — kotak jumlah tidak punya cara dicocokkan ke barangnya',
  SVC,
  'asset_transfer_item(id, asset_item_id, item_kode, item_nama, qty)',
  'asset_transfer_item(id, item_kode, item_nama, qty)',
  AUDIT
);

sabotase(
  'argumen RPC dihilangkan — PostgREST menolak atau memilih fungsi lain',
  SVC,
  'p_alasan: alasan,',
  '',
  AUDIT
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase revisi transfer aset tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
