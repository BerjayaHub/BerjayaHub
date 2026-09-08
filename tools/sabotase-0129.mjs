/**
 * SABOTASE 0129 — memeriksa bahwa tes & auditnya benar-benar MENGGIGIT.
 *
 * Satu pelonggaran di berkas ini punya akibat yang jauh lebih besar daripada
 * bahan kembar: penggabungan data lama harus MEMATIKAN trigger 0122/0128 untuk
 * sesaat. Kalau ia lupa menyalakannya lagi, nota yang sudah lunas bisa diubah
 * siapa pun, selamanya — dan tidak ada satu pun layar yang menunjukkannya.
 *
 * Jalankan: node tools/sabotase-0129.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0129_satu_bahan_satu_baris.sql';
const MOD = 'js/modules/dispatch/duplikat-item.js';
const PICK = 'js/modules/dispatch/item-picker.js';
const HAL = 'js/modules/dispatch/dispatch.page.js';
const NOTA = 'js/modules/inventory/nota-staff.js';

const asli = new Map();
for (const rel of [MIG, MOD, PICK, HAL, NOTA]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  // Pemeriksanya harus ADA. Sabotase yang "tertangkap" karena `node` gagal
  // membuka berkas yang tidak pernah ditulis sudah pernah terjadi di repo ini.
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

const TES_MIG = 'tools/test-migrasi-0129.mjs';
const TES_MOD = 'tools/test-duplikat-item.mjs';
const AUDIT = 'tools/audit-duplikat-item.cjs';

console.log('\n== Migration: penggabungan data lama ==');

sabotase(
  'trigger nota lunas dimatikan tapi TIDAK dinyalakan lagi — nota lunas bisa diubah selamanya',
  MIG,
  /  if exists \(select 1 from pg_trigger where tgname = 'trg_tolak_ubah_nota_lunas'\) then\n    alter table goods_receipt_items enable trigger trg_tolak_ubah_nota_lunas;\n  end if;\n/,
  '',
  TES_MIG
);

sabotase(
  'trigger kiriman terekspor tidak dinyalakan lagi',
  MIG,
  /  if exists \(select 1 from pg_trigger where tgname = 'trg_tolak_ubah_kiriman_terekspor'\) then\n    alter table dispatch_items enable trigger trg_tolak_ubah_kiriman_terekspor;\n  end if;\n/,
  '',
  TES_MIG
);

sabotase(
  'trigger tidak dimatikan sama sekali — migration berhenti di tengah pada nota lunas',
  MIG,
  'alter table goods_receipt_items disable trigger trg_tolak_ubah_nota_lunas;',
  '',
  TES_MIG
);

sabotase(
  'harga nota dijumlahkan walau salah satu barisnya kosong — biaya per gram anjlok diam-diam',
  MIG,
  'line_total = case when d.n_berharga = d.n then d.total_harga else null end,',
  'line_total = d.total_harga,',
  TES_MIG
);

sabotase(
  'unit_cost tidak dihitung ulang — biaya bahannya memakai angka baris lama',
  MIG,
  /unit_cost = case\n         when d\.n_berharga = d\.n and d\.total_qty > 0 then d\.total_harga \/ d\.total_qty\n         else null\n       end/,
  'unit_cost = unit_cost',
  TES_MIG
);

sabotase(
  'received_qty yang belum dicatat jadi 0 — "belum dicatat" berbeda dari "tidak sampai"',
  MIG,
  'received_qty = case when d.ada_terima > 0 then d.total_terima else null end',
  'received_qty = coalesce(d.total_terima, 0)',
  TES_MIG
);

sabotase(
  'stock_movements tidak ikut disamakan — layar nota benar, laporan biayanya tidak',
  MIG,
  /update stock_movements sm\n   set unit_cost = i\.unit_cost/,
  'update stock_movements sm\n   set unit_cost = sm.unit_cost',
  TES_MIG
);

console.log('\n== Migration: penjagaannya sendiri ==');

sabotase(
  'unique index order dilepas',
  MIG,
  'create unique index if not exists stock_order_items_produk_uk on stock_order_items(order_id, product_id);',
  '',
  AUDIT
);

sabotase(
  'trigger order dilepas — yang muncul di layar jadi galat unique constraint mentah',
  MIG,
  /drop trigger if exists trg_bahan_kembar_order on stock_order_items;\ncreate trigger trg_bahan_kembar_order[\s\S]*?tolak_bahan_kembar_order\(\);/,
  '',
  TES_MIG
);

sabotase(
  'pesan trigger berhenti menyebut nama bahan — staff outlet dapat kalimat yang tidak bisa ditindaklanjuti',
  MIG,
  /    select name into v_nama from products where id = new\.product_id;\n    raise exception '% sudah ada di order ini[^\n]*\n      coalesce\(v_nama, 'Bahan ini'\) using errcode = 'unique_violation';/,
  "    raise exception 'Bahan kembar di order ini.' using errcode = 'unique_violation';",
  TES_MIG
);

sabotase(
  'penjagaan order juga menolak produk yang BERBEDA — seluruh order jadi satu barang saja',
  MIG,
  'where s.order_id = new.order_id and s.product_id = new.product_id',
  'where s.order_id = new.order_id',
  TES_MIG
);

console.log('\n== Modul murni ==');

sabotase(
  'baris kosong ikut dihitung kembar — form ditandai merah sejak dibuka',
  MOD,
  'if (!id) return;',
  'if (false) return;',
  TES_MOD
);

sabotase(
  'qty tidak dijumlahkan, yang terakhir menimpa — 100 + 150 jadi 150',
  MOD,
  'qty += angka(daftar[j]?.qty) ?? 0;',
  'qty = angka(daftar[j]?.qty) ?? 0;',
  TES_MOD
);

sabotase(
  'harga dijumlahkan walau salah satu baris kosong',
  MOD,
  "line_total: 'line_total' in (it ?? {}) ? (adaHargaKosong ? null : harga) : it?.line_total",
  "line_total: 'line_total' in (it ?? {}) ? harga : it?.line_total",
  TES_MOD
);

sabotase(
  'baris TERAKHIR yang menang tempat — pesanan rekan pindah ke bawah daftar',
  MOD,
  /    if \(sudah\.has\(id\)\) continue;[^\n]*\n    sudah\.add\(id\);/,
  '    sudah.add(id);',
  TES_MOD
);

console.log('\n== Layar ==');

sabotase(
  'harga dibaca tanpa bacaRupiah — "12.500" jadi dua belas setengah',
  PICK,
  '...(hargaSatuan ? { line_total: bacaRupiah(e.line_total) } : {})',
  '...(hargaSatuan ? { line_total: e.line_total } : {})',
  AUDIT
);

sabotase(
  'tombol Gabungkan hilang — staff membetulkannya sendiri baris demi baris',
  PICK,
  'pf-gabung',
  'pf-gabung-nonaktif',
  AUDIT
);

sabotase(
  'satu pemilih produk di Pengiriman lupa dinyalakan penjagaannya',
  HAL,
  'tanpaDuplikat: true',
  'tanpaDuplikat: false',
  AUDIT
);

sabotase(
  'Simpan tetap bisa ditekan walau masih kembar — kotak merahnya cuma hiasan',
  HAL,
  'if (editPicker.adaDuplikat()) {',
  'if (false) {',
  AUDIT
);

sabotase(
  'nota supplier lupa dinyalakan penjagaannya',
  NOTA,
  'tanpaDuplikat: true',
  'tanpaDuplikat: false',
  AUDIT
);

sabotase(
  'nota supplier menandai tapi tidak menolak simpan',
  NOTA,
  'if (picker.adaDuplikat()) {',
  'if (false) {',
  AUDIT
);

console.log('');
if (gagal === 0) {
  console.log('Semua sabotase 0129 tertangkap. Tes & auditnya menggigit. ✅');
} else {
  console.error(`${gagal} sabotase LOLOS.`);
}
process.exit(gagal === 0 ? 0 : 1);
