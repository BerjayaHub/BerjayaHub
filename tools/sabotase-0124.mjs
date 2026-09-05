/**
 * SABOTASE 0124 — memeriksa bahwa tes & auditnya benar-benar MENGGIGIT.
 *
 * `geser_harga_nota` adalah satu-satunya fungsi di repo ini yang MENULIS ULANG
 * angka uang yang sudah tersimpan, jadi tiap penjagaannya dirusak satu per
 * satu di sini.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0124_geser_harga_ke_harga_beli.sql';
const HAL = 'js/modules/inventory/nota-staff.js';
const SVC = 'js/modules/inventory/nota.service.js';

const asli = new Map();
for (const rel of [MIG, HAL, SVC]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES = 'tools/test-migrasi-0124.mjs';
const AUDIT = 'tools/audit-geser-harga.cjs';

console.log('SABOTASE MIGRATION:');

sabotase(
  'INTI: penggeserannya dibalik (per satuan jadi harga beli)',
  MIG,
  'set line_total = unit_cost,\n         unit_cost = unit_cost / qty',
  'set line_total = qty * unit_cost,\n         unit_cost = unit_cost',
  TES
);
sabotase(
  'harganya dibagi dua kali (dipecah jadi dua pernyataan)',
  MIG,
  'set line_total = unit_cost,\n         unit_cost = unit_cost / qty',
  'set unit_cost = unit_cost / qty,\n         line_total = unit_cost / qty',
  TES
);
sabotase('nota bisa digeser dua kali', MIG, 'if v_nota.harga_digeser_at is not null then', 'if false then', TES);
sabotase('nota lunas ikut bisa digeser', MIG, "if v_nota.payment_status = 'lunas' then", 'if false then', TES);
sabotase('wewenang outlet tidak diperiksa', MIG, 'if not has_outlet_scope(v_uid, v_nota.outlet_id) then', 'if false then', TES);
sabotase(
  'stock_movements tertinggal — biaya rata-rata tetap salah',
  MIG,
  /  update stock_movements sm\n     set unit_cost = i\.unit_cost\n    from goods_receipt_items i\n   where sm\.receipt_id = any\(p_notas\)\n     and i\.receipt_id = sm\.receipt_id\n     and i\.product_id = sm\.product_id\n     and sm\.qty_delta > 0;/,
  '',
  TES
);
sabotase('penandanya tidak dipasang', MIG, 'set harga_digeser_at = now(), harga_digeser_by = v_uid', 'set harga_digeser_by = v_uid', TES);
sabotase(
  'baris tanpa harga ikut disentuh',
  MIG,
  'and unit_cost is not null\n     and qty > 0;',
  'and qty > 0;',
  TES
);
sabotase(
  'pratinjaunya salah hitung',
  MIG,
  'coalesce(sum(i.unit_cost) filter (where i.unit_cost is not null), 0) as total_jika_digeser',
  'coalesce(sum(i.qty * i.unit_cost), 0) as total_jika_digeser',
  TES
);

console.log('\nSABOTASE YANG HANYA AUDIT YANG BISA MENANGKAP (jalur layar):');

sabotase('tombolnya dihapus', HAL, 'id="nota-geser-harga"', 'id="nota-geser-x"', AUDIT);
sabotase(
  'tombolnya ada tapi tidak terhubung',
  HAL,
  "wadah.querySelector('#nota-geser-harga').addEventListener('click', sekaliJalan(bukaGeserHarga));",
  '',
  AUDIT
);
sabotase('pratinjau sesudah-digeser dihapus dari dialognya', HAL, /total_jika_digeser/g, 'total', AUDIT);
sabotase('nota lunas ikut ditawarkan', HAL, "payment_status !== 'lunas'", 'true', AUDIT);
sabotase('nota yang sudah digeser ikut ditawarkan lagi', HAL, '!n.harga_digeser_at', 'true', AUDIT);
sabotase('service berhenti memanggil RPC-nya', SVC, "rpc('geser_harga_nota'", "rpc('x'", AUDIT);

console.log('');
if (gagal === 0) console.log('Semua sabotase 0124 tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
