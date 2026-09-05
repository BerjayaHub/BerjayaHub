/**
 * SABOTASE 0123 — memeriksa bahwa tes & auditnya benar-benar MENGGIGIT.
 *
 * Perhatian khusus pada §4 dan §5 tesnya: `ubah_nota_terima` ditulis ulang
 * untuk KEEMPAT kalinya di 0123, dan risiko terbesarnya bukan bug baru
 * melainkan penjagaan LAMA yang hilang tanpa suara. Sabotase di bawah
 * membuang penjagaan 0118 dan 0119 satu per satu, dan tesnya harus merah.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0123_harga_beli_per_baris.sql';
const PICKER = 'js/modules/dispatch/item-picker.js';
const RUMUS = 'js/modules/inventory/biaya-rata.js';
const SVC = 'js/modules/inventory/nota.service.js';

const asli = new Map();
for (const rel of [MIG, PICKER, RUMUS, SVC]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

const pulih = () => {
  for (const [rel, isi] of asli) fs.writeFileSync(P(rel), isi);
};
process.on('exit', pulih);
process.on('SIGINT', () => process.exit(130));

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

const TES = 'tools/test-migrasi-0123.mjs';
const TES_RUMUS = 'tools/test-biaya-rata.mjs';
const AUDIT = 'tools/audit-harga-baris-nota.cjs';

console.log('SABOTASE MIGRATION — kembali ke arti lama:');

sabotase(
  'INTI: angkanya kembali ditafsirkan sebagai harga per satuan',
  MIG,
  'satuan := case when p_qty > 0 then total / p_qty else null end;',
  'satuan := total;',
  TES
);
sabotase('unit_cost menang atas line_total', MIG, 'if v_t is not null then', 'if false then', TES);
sabotase('bentuk lama (unit_cost) berhenti diterima', MIG, 'elsif v_s is not null then', 'elsif false then', TES);
sabotase(
  'total nota kembali qty x unit_cost',
  MIG,
  /coalesce\(sum\(coalesce\(i\.line_total, i\.qty \* i\.unit_cost\)\), 0\) as total/,
  'coalesce(sum(i.qty * i.unit_cost), 0) as total',
  TES
);
sabotase(
  'nominal pembayaran kembali qty x unit_cost',
  MIG,
  'select coalesce(sum(coalesce(i.line_total, i.qty * i.unit_cost)), 0) into v_total',
  'select coalesce(sum(i.qty * i.unit_cost), 0) into v_total',
  TES
);
sabotase('line_total tidak disimpan saat nota dibuat', MIG, 'values (v_id, v_pid, v_qty, v_satuan, v_total,', 'values (v_id, v_pid, v_qty, v_satuan, null,', TES);
sabotase('backfill baris lama dilewati', MIG, 'set line_total = qty * unit_cost', 'set line_total = null', TES);

console.log('\nSABOTASE PENJAGAAN LAMA — yang paling mudah hilang di penulisan ulang KEEMPAT:');

sabotase(
  'PENJAGAAN 0118: penyelarasan harga ke stock_movements dihapus',
  MIG,
  /    update stock_movements\n       set unit_cost = v_satuan\n     where receipt_id = p_id\n       and product_id = v_pid\n       and qty_delta > 0;/,
  '',
  TES
);
sabotase(
  'PENJAGAAN 0119: supplier ditimpa tanpa syarat lagi',
  MIG,
  "supplier = case when p_supplier is null then supplier else nullif(p_supplier, '') end,",
  "supplier = nullif(p_supplier, ''),",
  TES
);
sabotase(
  'PENJAGAAN 0119: p_items NULL tidak lagi berarti "jangan sentuh barangnya"',
  MIG,
  'if p_items is null then return; end if;',
  "p_items := coalesce(p_items, '[]'::jsonb);",
  TES
);
sabotase(
  'PENJAGAAN 0084: barang yang hilang dari daftar tidak lagi dibatalkan',
  MIG,
  'delete from goods_receipt_items where receipt_id = p_id and product_id = v_pid;',
  '',
  TES
);

console.log('\nSABOTASE PERHITUNGAN DI KLIEN:');

sabotase('ringkasNota mengalikan jumlahnya lagi', RUMUS, 'total += h;', 'total += angka(i?.qty) * h;', TES_RUMUS);
sabotase('hargaBaris mengabaikan line_total', RUMUS, 'if (t != null) return t;', 'if (false) return t;', TES_RUMUS);
sabotase('harga kosong dianggap nol', RUMUS, 'if (h == null) {', 'if (false) {', TES_RUMUS);

console.log('\nSABOTASE YANG HANYA AUDIT YANG BISA MENANGKAP (jalur layar):');

sabotase(
  'kotaknya kembali berlabel per-satuan',
  PICKER,
  'placeholder="harga beli"',
  'placeholder="harga/${esc(p?.base_unit ?? \'satuan\')}"',
  AUDIT
);
sabotase('isian harga tidak dikirim sebagai line_total', PICKER, /line_total: bacaRupiah\(/g, 'unit_cost: bacaRupiah(', AUDIT);
sabotase(
  'ubahNota berhenti mengirim line_total',
  SVC,
  'p_items: items === null ? null : items.map((i) => ({ product_id: i.product_id, qty: i.qty, line_total: i.line_total ?? null }))',
  'p_items: items === null ? null : items.map((i) => ({ product_id: i.product_id, qty: i.qty }))',
  AUDIT
);
sabotase(
  'itemNota berhenti mengambil line_total (dialog Edit membuka kotak kosong)',
  SVC,
  'qty, unit_cost, line_total, notes',
  'qty, unit_cost, notes',
  AUDIT
);
sabotase('harga_baris_nota cuma dipakai di satu RPC', MIG, /select total, satuan into v_total, v_satuan from harga_baris_nota\(it, v_qty\);\n\n    select qty into v_lama/, 'v_total := null; v_satuan := null;\n\n    select qty into v_lama', AUDIT);

console.log('');
if (gagal === 0) console.log('Semua sabotase 0123 tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
