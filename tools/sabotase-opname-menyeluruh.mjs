/**
 * SABOTASE: opname menyeluruh — yang tidak diisi dianggap habis (0182).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Ini satu-satunya tempat di aplikasi yang menghapus stok barang yang TIDAK
 * disebut siapa pun. Satu saringan yang meleset tidak menghasilkan galat; ia
 * menghasilkan gudang kosong — rak outlet lain, produk arsip, atau stok menu —
 * dan tidak ada yang akan mencurigainya, karena opname MEMANG mengubah stok.
 *
 * Yang kedua: dialog penutupan. Angka pratinjau yang berbohong lebih berbahaya
 * daripada tidak ada angka sama sekali, karena yang membacanya menekan
 * tombolnya dengan yakin — dan penutupan tidak bisa dibatalkan.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0182_opname_menyeluruh.sql';
const SVC = 'js/modules/inventory/opname.service.js';
const ADM = 'js/modules/inventory/opname.admin.js';
const STAF = 'js/modules/inventory/inventory.page.js';

const BERKAS = [MIG, SVC, ADM, STAF];
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

const AUDIT = 'tools/audit-opname-menyeluruh.cjs';
const PG = 'tools/test-migrasi-0182.mjs';

for (const p of [AUDIT, PG]) pastikanHijau(p);

// =====================================================================
console.log('SABOTASE: SARINGAN YANG MENENTUKAN APA YANG LENYAP');
// =====================================================================

sabotase(
  'stok outlet lain ikut dibaca — rak gudang lain ikut dikosongkan',
  MIG,
  "           (select coalesce(sum(sm.qty_delta), 0) from stock_movements sm\n             where sm.outlet_id = v_outlet and sm.product_id = p.id) as sistem\n      from products p",
  "           (select coalesce(sum(sm.qty_delta), 0) from stock_movements sm\n             where sm.product_id = p.id) as sistem\n      from products p",
  PG
);

sabotase(
  'BU lain ikut dinolkan',
  MIG,
  '     where p.business_unit_id = v_bu\n       and coalesce(p.is_active, true)',
  '     where coalesce(p.is_active, true)',
  PG
);

sabotase(
  'produk nonaktif ikut dinolkan',
  MIG,
  "       and coalesce(p.is_active, true)\n       and p.product_type <> 'finished'\n       and not exists",
  "       and p.product_type <> 'finished'\n       and not exists",
  PG
);

sabotase(
  'stok menu ikut dinolkan',
  MIG,
  "       and p.product_type <> 'finished'\n       and not exists (select 1 from stock_count_items i where i.count_id = p_count and i.product_id = p.id)\n  loop",
  '       and not exists (select 1 from stock_count_items i where i.count_id = p_count and i.product_id = p.id)\n  loop',
  PG
);

// Tanpa ini, bahan yang BARU SAJA dihitung orangnya ikut dinolkan — angka yang
// baru diketik dibuang dan diganti nol.
sabotase(
  'bahan yang sudah dihitung ikut dinolkan',
  MIG,
  '       and not exists (select 1 from stock_count_items i where i.count_id = p_count and i.product_id = p.id)\n  loop',
  '  loop',
  PG
);

sabotase(
  'bahan berstok nol tetap menghasilkan pergerakan kosong',
  MIG,
  '    if r.sistem <> 0 then',
  '    if true then',
  PG
);

// =====================================================================
console.log('\nSABOTASE: JEJAKNYA');
// =====================================================================

sabotase(
  'penolan tidak meninggalkan baris hitungan',
  MIG,
  "      insert into stock_count_items (count_id, product_id, system_qty, counted_qty, counted_by, notes, otomatis)\n      values (p_count, r.product_id, r.sistem, 0, auth.uid(), 'Tidak dihitung — dianggap habis', true);",
  '      null;',
  PG
);

// Keduanya nol; hanya satu yang berarti "sudah dilihat, memang habis".
sabotase(
  'baris otomatis tidak dibedakan dari angka yang diketik orang',
  MIG,
  "'Tidak dihitung — dianggap habis', true);",
  "'Tidak dihitung — dianggap habis', false);",
  PG
);

sabotase(
  'pergerakan stoknya tidak menjelaskan dirinya',
  MIG,
  "              'Opname ' || v_code || ' — tidak dihitung, dianggap habis', auth.uid(), p_count);",
  "              'Opname ' || v_code, auth.uid(), p_count);",
  PG
);

// =====================================================================
console.log('\nSABOTASE: TAHAP 1 YANG DISALIN');
// =====================================================================

sabotase(
  'wewenang menutup sesi hilang saat fungsinya disalin',
  MIG,
  "  if not is_bu_admin(auth.uid(), v_bu) then\n    raise exception 'Hanya Admin BU atau Super Admin yang bisa menutup sesi opname.';\n  end if;",
  '',
  PG
);

sabotase(
  'sesi yang sudah ditutup bisa ditutup lagi',
  MIG,
  "  if v_status <> 'open' then raise exception 'Opname ini sudah ditutup.'; end if;",
  '',
  PG
);

sabotase(
  'penyesuaian dari hitungan yang masuk hilang',
  MIG,
  '    if r.counted_qty - r.system_qty <> 0 then',
  '    if false then',
  PG
);

// =====================================================================
console.log('\nSABOTASE: PRATINJAU YANG BERBOHONG');
// =====================================================================

// Dialog berkata "3 bahan", yang terjadi 300 — dan yang membacanya menekan
// tombolnya dengan yakin.
sabotase(
  'pratinjau memakai saringan yang berbeda dari penutupan',
  MIG,
  "         and p.product_type <> 'finished'\n         and not exists (select 1 from stock_count_items i where i.count_id = p_count and i.product_id = p.id)\n    ) x",
  '         and not exists (select 1 from stock_count_items i where i.count_id = p_count and i.product_id = p.id)\n    ) x',
  AUDIT
);

sabotase(
  'pratinjau menghitung bahan yang stoknya sudah nol',
  MIG,
  '   where x.sistem <> 0;',
  '   where true;',
  PG
);

// =====================================================================
console.log('\nSABOTASE: YANG DIKATAKAN DI LAYAR');
// =====================================================================

sabotase(
  'dialog tutup berhenti memeriksa berapa yang akan dinolkan',
  ADM,
  '          pra = await pratinjauTutupOpname(btn.dataset.id);',
  '          pra = { dihitung: 0, akan_dinolkan: 0, contoh: [] };',
  AUDIT
);

sabotase(
  'pratinjau yang gagal dibaca dianggap "tidak ada yang terlewat"',
  ADM,
  '        let praGagal = \'\';',
  "        const gagalBaca = '';",
  AUDIT
);

sabotase(
  'layar staff tidak lagi mengatakan aturannya',
  STAF,
  'Opname ini <strong>menyeluruh</strong>: bahan yang tidak kamu isi akan\n            <strong>dianggap habis (0)</strong> saat admin menutup sesi.',
  'Isi stok fisik tiap bahan.',
  AUDIT
);

// ---------------------------------------------------------------
console.log('');
if (gagal === 0) console.log('Semua sabotase opname menyeluruh tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS / tidak terpasang.`);
process.exit(gagal === 0 ? 0 : 1);
