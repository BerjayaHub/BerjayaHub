/**
 * SABOTASE 0132 — memeriksa bahwa tes & auditnya benar-benar MENGGIGIT.
 *
 * Yang dijaga di sini bukan angka melainkan BUKTI: baris "diminta 10, dikirim
 * 0, keterangan stok habis" adalah satu-satunya hal yang bisa menengahi
 * perselisihan antara outlet dan CK. Tiap pelonggaran di bawah menghapus
 * salah satu dari tiga fakta itu, dan tidak satu pun meninggalkan error.
 *
 * Jalankan: node tools/sabotase-0132.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0132_kiriman_nol_dan_keterangan.sql';
const SVC = 'js/modules/dispatch/dispatch.service.js';
const HAL = 'js/modules/dispatch/dispatch.page.js';
const PICK = 'js/modules/dispatch/item-picker.js';
const PDF = 'js/modules/dispatch/dispatch-pdf.js';

const asli = new Map();
for (const rel of [MIG, SVC, HAL, PICK, PDF]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES = 'tools/test-migrasi-0132.mjs';
const AUDIT = 'tools/audit-kirim-nol-keterangan.cjs';

console.log('\n== Baris nol ==');

sabotase(
  'baris nol dibuang lagi saat draft DIBUAT — barang yang tidak dikirim lenyap dari surat jalan',
  MIG,
  /    if v_pid is null or v_qty is null or v_qty < 0 then continue; end if;\n    insert into dispatch_items\(dispatch_id, product_id, sent_qty, keterangan, ordered_qty\)\n    values \(v_did/,
  '    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;\n    insert into dispatch_items(dispatch_id, product_id, sent_qty, keterangan, ordered_qty)\n    values (v_did',
  TES
);

sabotase(
  'baris nol dibuang saat draft DISUNTING',
  MIG,
  /    if v_pid is null or v_qty is null or v_qty < 0 then continue; end if;\n    insert into dispatch_items\(dispatch_id, product_id, sent_qty, keterangan, ordered_qty\)\n    values \(p_dispatch/,
  '    if v_pid is null or v_qty is null or v_qty <= 0 then continue; end if;\n    insert into dispatch_items(dispatch_id, product_id, sent_qty, keterangan, ordered_qty)\n    values (p_dispatch',
  TES
);

sabotase(
  'batasan lama sent_qty > 0 tidak jadi dicabut — baris nol ditolak database',
  MIG,
  "       and pg_get_constraintdef(oid) ilike '%sent_qty%'\n       and conname <> 'dispatch_items_sent_qty_chk'",
  "       and pg_get_constraintdef(oid) ilike '%sent_qty%'\n       and pg_get_constraintdef(oid) ilike '%> 0%'",
  TES
);

sabotase(
  'jumlah kirim MINUS ikut diterima — stok CK justru bertambah saat diterima',
  MIG,
  'alter table dispatch_items add constraint dispatch_items_sent_qty_chk check (sent_qty >= 0);',
  'alter table dispatch_items add constraint dispatch_items_sent_qty_chk check (true);',
  TES
);

sabotase(
  'draft yang SELURUH barisnya nol diterbitkan — surat jalan kosong yang tetap harus diarsipkan',
  MIG,
  /  if v_positif = 0 then\n    raise exception 'Semua barang jumlah kirimnya 0\. Kalau memang tidak ada yang bisa dikirim, pakai "Tolak Order" beserta alasannya\.';\n  end if;/,
  '',
  TES
);

console.log('\n== Keterangan & jumlah diminta ==');

sabotase(
  'menyunting draft menghapus keterangan yang tidak dikirim ulang klien',
  MIG,
  /            coalesce\(\n              nullif\(btrim\(coalesce\(it->>'keterangan', ''\)\), ''\),\n              v_lama -> v_pid::text ->> 'k'\n            \),/,
  "            nullif(btrim(coalesce(it->>'keterangan', '')), ''),",
  TES
);

sabotase(
  'menyunting draft menghapus jejak jumlah yang diminta',
  MIG,
  /            coalesce\(\n              nullif\(it->>'ordered_qty', ''\)::numeric,\n              \(v_lama -> v_pid::text ->> 'o'\)::numeric\n            \)\);/,
  "            nullif(it->>'ordered_qty', '')::numeric);",
  TES
);

sabotase(
  'ordered_qty tidak disimpan sama sekali saat draft dibuat',
  MIG,
  /            nullif\(it->>'ordered_qty', ''\)::numeric\);\n    v_jumlah := v_jumlah \+ 1;\n    if v_qty > 0 then v_positif := v_positif \+ 1; end if;\n  end loop;\n\n  if v_jumlah = 0 then\n    raise exception 'Draft tidak jadi dibuat/,
  "            null);\n    v_jumlah := v_jumlah + 1;\n    if v_qty > 0 then v_positif := v_positif + 1; end if;\n  end loop;\n\n  if v_jumlah = 0 then\n    raise exception 'Draft tidak jadi dibuat",
  TES
);

sabotase(
  'outlet MENIMPA keterangan CK, bukan melengkapi yang kosong',
  MIG,
  '       and keterangan is null;',
  ';',
  TES
);

sabotase(
  'siapa pun bisa mengubah keterangan kiriman orang lain',
  MIG,
  /  if not \(has_outlet_scope\(v_uid, v_d\.from_outlet_id\) or has_outlet_scope\(v_uid, v_d\.to_outlet_id\)\) then\n    raise exception 'Kiriman ini bukan wewenangmu\.';\n  end if;/,
  '',
  TES
);

console.log('\n== Layar CK ==');

sabotase(
  'kotak Dikirim terisi otomatis lagi sebanyak yang diminta — keluhan aslinya kembali',
  HAL,
  'data-product="${it.product_id}" data-diminta="${round(it.qty)}"\n                            placeholder="0"',
  'data-product="${it.product_id}" data-diminta="${round(it.qty)}" value="${round(it.qty)}"\n                            placeholder="0"',
  AUDIT
);

sabotase(
  'baris nol disaring lagi sebelum dikirim ke server',
  HAL,
  /        const items = \[\.\.\.card\.querySelectorAll\('\.ord-send-input'\)\]\.map\(\(el\) => \(\{/,
  "        const items = [...card.querySelectorAll('.ord-send-input')].filter((i) => i.qty > 0).map((el) => ({",
  AUDIT
);

sabotase(
  'kolom Keterangan hilang dari layar CK',
  HAL,
  'class="ord-ket-input"',
  'class="ord-ket-input-nonaktif"',
  AUDIT
);

sabotase(
  'jumlah diminta tidak dibawa — ordered_qty tidak akan pernah terisi',
  HAL,
  'ordered_qty: Number(el.dataset.diminta) || 0,',
  '',
  AUDIT
);

console.log('\n== Layar outlet ==');

sabotase(
  'kotak keterangan hilang dari sisi outlet — CK yang lupa tidak bisa dilengkapi siapa pun',
  HAL,
  'class="recv-ket-input"',
  'class="recv-ket-input-nonaktif"',
  AUDIT
);

sabotase(
  'keterangan dari outlet tidak pernah dikirim ke server',
  HAL,
  'await lengkapiKeteranganKiriman(btn.dataset.id, ket);',
  'void ket;',
  AUDIT
);

sabotase(
  'baris nol tidak disorot — angka 0 di antara belasan angka lain terlewat',
  HAL,
  "const nol = Number(it.sent_qty) === 0;",
  'const nol = false;',
  AUDIT
);

console.log('\n== Layanan, picker, kertas ==');

sabotase(
  'getDispatchItems berhenti mengambil kolom barunya',
  SVC,
  'keterangan, ordered_qty, products(name, base_unit)',
  'products(name, base_unit)',
  AUDIT
);

sabotase(
  'tidak ada jalur cadangan kalau 0132 belum dijalankan — seluruh isi kiriman menghilang',
  SVC,
  /    if \(!\/column \.\* does not exist\|keterangan\|ordered_qty\/i\.test\(error\.message \?\? ''\)\) throw error;[\s\S]*?    return ulang\.data \?\? \[\];/,
  '    throw error;',
  AUDIT
);

sabotase(
  'picker draft membuang baris nol lagi',
  PICK,
  'bolehNol ? i.qty >= 0 : i.qty > 0',
  'i.qty > 0',
  AUDIT
);

sabotase(
  'surat jalan cetak berhenti memuat keterangan & jumlah diminta',
  PDF,
  /    const catatan = \[\];[\s\S]*?      y \+= 12;\n    \}/,
  '',
  AUDIT
);

console.log('');
if (gagal === 0) {
  console.log('Semua sabotase 0132 tertangkap. Tes & auditnya menggigit. ✅');
} else {
  console.error(`${gagal} sabotase LOLOS.`);
}
process.exit(gagal === 0 ? 0 : 1);
