/**
 * SABOTASE 0134 — memeriksa bahwa tes & auditnya MENGGIGIT.
 *
 * Bongkar MENAMBAH stok. Satu pelonggaran di sini menghasilkan angka stok yang
 * lebih besar dari kenyataan, dan angka itu terlihat persis seperti stok yang
 * sungguhan — tidak ada laporan yang bisa membedakannya.
 *
 * Jalankan: node tools/sabotase-0134.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0134_bongkar_bahan.sql';
const MURNI = 'js/modules/inventory/bongkar.js';
const SVC = 'js/modules/inventory/inventory.service.js';
const LAYAR = 'js/modules/inventory/bongkar-staff.js';
const HAL = 'js/modules/inventory/inventory.page.js';

const asli = new Map();
for (const rel of [MIG, MURNI, SVC, LAYAR, HAL]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES_MIG = 'tools/test-migrasi-0134.mjs';
const TES_MOD = 'tools/test-bongkar.mjs';
const AUDIT = 'tools/audit-bongkar.cjs';

console.log('\n== Batas atas: yang menahan pencetakan stok ==');

sabotase(
  'batas porsi dilepas di server — 5 pack bisa jadi 500kg udang',
  MIG,
  /    if v_qty > v_maks \+ 1e-9 then\n      raise exception[\s\S]*?\n    end if;/,
  '',
  TES_MIG
);

sabotase(
  'bahan di luar resep diterima — bongkar jadi alat mengubah stok apa pun jadi apa pun',
  MIG,
  /    if v_maks is null then\n      raise exception[\s\S]*?\n    end if;/,
  '',
  TES_MIG
);

sabotase(
  'porsinya dihitung tanpa membagi yield — 2 pack dari resep yield 4 mengembalikan resep penuh',
  MIG,
  'ri.qty * (p_qty / nullif(r.yield_qty, 0))',
  'ri.qty * p_qty',
  TES_MIG
);

sabotase(
  'batas atas di layar dilepas — penolakannya baru datang dari server',
  MURNI,
  'if (q > maks + TOLERANSI) {',
  'if (false) {',
  TES_MOD
);

sabotase(
  'yield nol membagi dengan nol — Infinity yang terlihat seperti angka',
  MURNI,
  'if (!yieldQty || yieldQty <= 0 || !n || n <= 0) return hasil;',
  'if (!n || n <= 0) return hasil;',
  TES_MOD
);

console.log('\n== Biaya ==');

sabotase(
  'bahan yang kembali membawa unit_cost — ongkos olahan merembes ke bahan baku',
  MIG,
  /    insert into stock_movements \(business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by\)\n    values \(v_bu, p_outlet, v_pid, 'bongkar_in', v_qty, 'Hasil bongkar ' \|\| v_nama, v_uid\);/,
  "    insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, unit_cost, notes, created_by)\n    values (v_bu, p_outlet, v_pid, 'bongkar_in', v_qty, 999, 'Hasil bongkar ' || v_nama, v_uid);",
  TES_MIG
);

console.log('\n== Penjaga lain ==');

sabotase(
  'produk tanpa resep boleh dibongkar',
  MIG,
  /  if not exists \(select 1 from recipes where product_id = p_product and yield_qty > 0\) then\n    raise exception[^\n]*\n  end if;/,
  '',
  TES_MIG
);

sabotase(
  'bongkar tanpa bahan kembali diterima diam-diam, bukan diarahkan ke Waste',
  MIG,
  /  if v_n = 0 then\n[\s\S]*?\n  end if;\n\n  return v_id;/,
  '  return v_id;',
  TES_MIG
);

sabotase(
  'siapa pun bisa membongkar di outlet mana pun',
  MIG,
  /  if not has_outlet_scope\(v_uid, p_outlet\) then\n    raise exception[^\n]*\n  end if;/,
  '',
  TES_MIG
);

sabotase(
  'jumlah nol/minus diterima',
  MIG,
  "  if p_qty is null or p_qty <= 0 then raise exception 'Jumlah yang dibongkar harus lebih dari 0.'; end if;",
  '',
  TES_MIG
);

sabotase(
  'packnya tidak jadi berkurang — bahan bertambah dari udara',
  MIG,
  /  insert into stock_movements \(business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by\)\n  values \(v_bu, p_outlet, p_product, 'bongkar_out', -p_qty, 'Dibongkar jadi bahan baku', v_uid\);/,
  '',
  TES_MIG
);

console.log('\n== Pembatalan ==');

sabotase(
  'pembatalan tidak mengembalikan packnya',
  MIG,
  /  insert into stock_movements \(business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by\)\n  values \(v_b\.business_unit_id, v_b\.outlet_id, v_b\.product_id, 'bongkar_in', v_b\.qty,/,
  "  insert into stock_movements (business_unit_id, outlet_id, product_id, movement_type, qty_delta, notes, created_by)\n  values (v_b.business_unit_id, v_b.outlet_id, v_b.product_id, 'bongkar_in', 0,",
  TES_MIG
);

sabotase(
  'pembatalan tidak menarik kembali bahan yang tadi dikembalikan',
  MIG,
  /  for r in select product_id, qty from bongkar_items where bongkar_id = p_bongkar loop\n[\s\S]*?\n  end loop;/,
  '',
  TES_MIG
);

sabotase(
  'bisa dibatalkan dua kali — stoknya dikembalikan dua kali juga',
  MIG,
  "  if v_b.dibatalkan_at is not null then raise exception 'Bongkar % memang sudah dibatalkan.', coalesce(v_b.code, ''); end if;",
  '',
  TES_MIG
);

sabotase(
  'alasan pembatalan tidak lagi wajib',
  MIG,
  /  if coalesce\(btrim\(p_alasan\), ''\) = '' then\n    raise exception 'Sebutkan alasan pembatalannya[^\n]*\n  end if;/,
  '',
  TES_MIG
);

console.log('\n== Layar ==');

sabotase(
  'label jenis pergerakan hilang — laporan menampilkan "bongkar_in" mentah',
  SVC,
  "  bongkar_in: 'Bongkar (masuk)'",
  '',
  AUDIT
);

sabotase(
  'pilihan staff tidak diperiksa sebelum dikirim',
  LAYAR,
  'const { boleh, masalah } = periksaBongkar(resepByProduk.get(pid), qty, pilihan);',
  'const boleh = pilihan; const masalah = [];',
  AUDIT
);

sabotase(
  'batas per bahan tidak lagi disebut di sebelah kotaknya',
  LAYAR,
  'data-maks="${maks}"',
  '',
  AUDIT
);

sabotase(
  'produk tanpa resep ikut ditawarkan di dropdown',
  LAYAR,
  'return r && Number(r.yield_qty) > 0 && Array.isArray(r.items) && r.items.length > 0;',
  'return true;',
  AUDIT
);

sabotase(
  'peringatan stok hilang dari layar',
  LAYAR,
  'const pesan = pesanStok(p?.name, stockMap.get(pid) ?? 0, qty, p?.base_unit);',
  "const pesan = '';",
  AUDIT
);

sabotase(
  'panel bongkar tidak ikut ditutup saat outlet berganti — bongkarnya masuk ke outlet sebelumnya',
  HAL,
  "      ['#inv-bongkar-panel', 'Panel bongkar bahan ditutup karena outletnya berganti.']",
  '',
  AUDIT
);

sabotase(
  'stok tidak disegarkan sebelum panelnya dibuka — peringatannya dihitung dari angka basi',
  HAL,
  // Polanya harus menyertakan argumen pertamanya (`bongkarPanel`) — versi
  // pertama menulis `renderBongkarStaff({` dan tidak pernah terpasang.
  // Sabotase yang tidak terpasang tidak menguji apa pun.
  '    stockMap = (await refresh()) ?? stockMap;\n    renderBongkarStaff(bongkarPanel, {',
  '    renderBongkarStaff(bongkarPanel, {',
  AUDIT
);

sabotase(
  'tombol Bongkar Bahan hilang dari modul Bahan',
  HAL,
  'id="inv-bongkar"',
  'id="inv-bongkar-nonaktif"',
  AUDIT
);

console.log('');
if (gagal === 0) {
  console.log('Semua sabotase 0134 tertangkap. Tes & auditnya menggigit. ✅');
} else {
  console.error(`${gagal} sabotase LOLOS.`);
}
process.exit(gagal === 0 ? 0 : 1);
