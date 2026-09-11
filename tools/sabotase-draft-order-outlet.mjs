/**
 * SABOTASE draft order outlet — memeriksa bahwa tes & auditnya MENGGIGIT.
 *
 * Fitur ini seluruhnya di layar, dan itu justru yang membuatnya rapuh:
 * jaminannya ada di tempat lain (indeks unik 0111), jadi kalau peringatannya
 * hilang tidak ada satu pun error yang muncul — dua staff cuma kembali saling
 * menimpa pekerjaan tanpa tahu.
 *
 * Jalankan: node tools/sabotase-draft-order-outlet.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MURNI = 'js/modules/dispatch/draft-outlet.js';
const HAL = 'js/modules/dispatch/dispatch.page.js';
const MIG = 'supabase/migrations/0111_draft_order_ck.sql';
const CSS = 'css/styles.css';
const SVC = 'js/modules/dispatch/dispatch.service.js';

const asli = new Map();
for (const rel of [MURNI, HAL, MIG, CSS, SVC]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES = 'tools/test-draft-outlet.mjs';
const AUDIT = 'tools/audit-draft-order-outlet.cjs';

console.log('\n== Jaminan 0111 yang disandari seluruh fitur ini ==');

sabotase(
  'indeks unik "satu draft per outlet" dilepas — dua nomor draft jadi mungkin lagi',
  MIG,
  /create unique index if not exists stock_orders_satu_draft\n  on stock_orders\(from_outlet_id, to_outlet_id\) where status = 'draft';/,
  '',
  AUDIT
);

sabotase(
  'buat_atau_ambil_draft_order berhenti mencari draft yang sudah ada',
  MIG,
  "  select id into v_id from stock_orders\n   where from_outlet_id = p_from and to_outlet_id = p_to and status = 'draft';",
  '',
  AUDIT
);

console.log('\n== Aturan keadaan ==');

sabotase(
  'draft tidak lagi ditemukan di antara order lain',
  MURNI,
  "return daftar.find((o) => o?.status === 'draft') ?? null;",
  'return null;',
  TES
);

sabotase(
  'order selesai ikut dianggap draft — layar menawarkan membuka order berbulan lalu',
  MURNI,
  "return daftar.filter((o) => o?.status === 'draft');",
  "return daftar.filter((o) => o?.status !== 'cancelled');",
  TES
);

sabotase(
  'order menunggu menang atas draft — staff diarahkan ke dokumen yang sudah terkunci',
  MURNI,
  /  if \(ganda\.length === 1\) return \{ mode: 'ada-draft', draft: ganda\[0\], menunggu \};\n  if \(menunggu\.length\) return \{ mode: 'menunggu', menunggu \};/,
  "  if (menunggu.length) return { mode: 'menunggu', menunggu };\n  if (ganda.length === 1) return { mode: 'ada-draft', draft: ganda[0], menunggu };",
  TES
);

sabotase(
  'draft ganda disembunyikan — layar diam-diam memilih salah satu',
  MURNI,
  "if (ganda.length > 1) return { mode: 'ada-draft-ganda', draft: ganda[0], ganda, menunggu };",
  '',
  TES
);

sabotase(
  'order yang sudah dikirim tidak lagi disebut — dobel order lewat pintu kedua',
  MURNI,
  "return daftar.filter((o) => o?.status === 'open');",
  'return [];',
  TES
);

console.log('\n== Kalimat & label ==');

sabotase(
  'label tombolnya kembali tetap, tidak menyebut nomor draftnya',
  MURNI,
  /    return `📝 Buka draft \$\{teks\(keadaan\.draft\?\.code\) \|\| 'yang sudah ada'\}`;/,
  "    return '📝 Buka / Buat Draft Order';",
  TES
);

sabotase(
  'pesannya berhenti menyebut nomor & pembuat draftnya',
  MURNI,
  /      `Outlet ini SUDAH punya draft order \$\{teks\(d\?\.code\)\}\$\{isi\}` \+\n      \(oleh \? `, dibuat \$\{oleh\}` : ''\) \+\n      '\. Tambahkan pesananmu ke draft itu — jangan buat order baru, supaya tidak dobel\.'/,
  "      'Sudah ada draft.'",
  TES
);

sabotase(
  'draft kosong dilaporkan sebagai "0 bahan", bukan "masih kosong"',
  MURNI,
  "const isi = jumlahBaris === null ? '' : jumlahBaris === 0 ? ', masih kosong' : `, sudah berisi ${jumlahBaris} bahan`;",
  "const isi = `, sudah berisi ${jumlahBaris} bahan`;",
  TES
);

sabotase(
  'peringatan draft ganda berhenti menyebut admin',
  MURNI,
  "'Gabungkan isinya jadi satu, kirim salah satu, lalu hapus sisanya, dan laporkan ke admin.'",
  "'Periksa lagi.'",
  TES
);

console.log('\n== Layar ==');

sabotase(
  'keadaan draft tidak dibaca sama sekali',
  HAL,
  'const keadaanOrder = keadaanOrderKeCk(myOrders);',
  "const keadaanOrder = { mode: 'kosong', menunggu: [] };",
  AUDIT
);

sabotase(
  'label tombolnya kembali dipatok "Buka / Buat"',
  HAL,
  '${esc(labelTombolDraft(keadaanOrder))}',
  '📝 Buka / Buat Draft Order',
  AUDIT
);

sabotase(
  'peringatannya tidak jadi digambar',
  HAL,
  /                 pesanDraft\n                   \? `<div class="\$\{keadaanOrder\.mode === 'ada-draft-ganda' \? 'draft-ganda' : 'draft-ada'\}">\$\{esc\(pesanDraft\)\}<\/div>`\n                   : ''/,
  "                 ''",
  AUDIT
);

sabotase(
  'jumlah bahan di draft tidak diambil — "sudah ada draft" tanpa isinya',
  HAL,
  'const isiDraft = keadaanOrder.draft ? await getOrderItems(keadaanOrder.draft.id).catch(() => null) : null;',
  'const isiDraft = null;',
  AUDIT
);

sabotase(
  'baris draft di tabel Order Saya tidak ditandai',
  HAL,
  "o.status === 'draft' ? ' class=\"ord-draft-aktif\"' : ''",
  "''",
  AUDIT
);

console.log('\n== Tujuan terkunci selama draft berjalan ==');

sabotase(
  'tujuan tidak lagi diambil dari draft — memilih CK lain membuat nomor order KEDUA',
  HAL,
  'const toOutlet = keadaanOrder.draft?.to_outlet_id ?? (servedCk ? servedCk.id : box.querySelector(\'#ord-to\')?.value);',
  'const toOutlet = servedCk ? servedCk.id : box.querySelector(\'#ord-to\')?.value;',
  AUDIT
);

sabotase(
  'setelan outlet dibaca sebelum draft yang hidup — setelan yang baru diubah membuat nomor kedua',
  HAL,
  'const toOutlet = keadaanOrder.draft?.to_outlet_id ?? (servedCk ? servedCk.id : box.querySelector(\'#ord-to\')?.value);',
  'const toOutlet = (servedCk ? servedCk.id : box.querySelector(\'#ord-to\')?.value) ?? keadaanOrder.draft?.to_outlet_id;',
  AUDIT
);

sabotase(
  'dropdown CK tetap tampil walau draftnya ada — pintunya terbuka lagi',
  HAL,
  '                   : keadaanOrder.draft\n                     ? ',
  '                   : false\n                     ? ',
  AUDIT
);

console.log('\n== Menekan tombolnya benar-benar sampai ke draftnya ==');

sabotase(
  'pemulihan gulir bawaan dikembalikan — layar ditarik menjauh dari panel yang baru dibuka',
  HAL,
  '      }, { jagaGulir: false }));',
  '      }));',
  AUDIT
);

sabotase(
  'kegagalan membuka panel ditelan lagi oleh `?.click()`',
  HAL,
  `          const tombolEdit = contentBox.querySelector(\`.btn-edit-order[data-id="\${id}"]\`);
          if (tombolEdit) {`,
  `          contentBox.querySelector(\`.btn-edit-order[data-id="\${id}"]\`)?.click();
          if (false) {`,
  AUDIT
);

sabotase(
  'panel edit berhenti menjemput layarnya — lahir di luar layar di HP',
  HAL,
  "        editBox.scrollIntoView({ behavior: 'smooth', block: 'start' });",
  '',
  AUDIT
);

sabotase(
  '`to_outlet_id` berhenti diambil — tujuan draft tidak punya sumber untuk dikunci',
  SVC,
  "'id, code, status, notes, reject_reason, created_at, handled_at, edited_at, to_outlet_id, ' +",
  "'id, code, status, notes, reject_reason, created_at, handled_at, edited_at, ' +",
  AUDIT
);

sabotase(
  'kelas peringatannya hilang dari CSS — digambar tapi tidak terlihat berbeda',
  CSS,
  /\.draft-ada \{[\s\S]*?\n\}/,
  '',
  AUDIT
);

console.log('');
if (gagal === 0) {
  console.log('Semua sabotase draft-order-outlet tertangkap. Tes & auditnya menggigit. ✅');
} else {
  console.error(`${gagal} sabotase LOLOS.`);
}
process.exit(gagal === 0 ? 0 : 1);
