/**
 * SABOTASE: COA Disbursement dari kantong, dan supplier kas yang wajib.
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Kerusakan yang dikejar di sini tidak melempar apa pun. Ia menghasilkan
 * berkas yang DITERIMA ESB dengan tenang dan mendarat di akun yang salah —
 * dan tidak ada satu pun layar Berjaya Hub yang bisa menunjukkannya. Yang
 * menemukannya membaca laporan ESB berminggu-minggu kemudian, saat tidak ada
 * lagi yang ingat pengeluaran mana itu.
 *
 * Bentuk keduanya sama-sama diam: kotak isian yang TIDAK DIGAMBAR terlihat
 * persis seperti kotak yang memang tidak ada di rancangannya.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0151_coa_disbursement_dari_kantong.sql';
const MURNI = 'js/modules/inventory/esb-disbursement.js';
const SUP = 'js/modules/cash/supplier-kas.js';
const ESVC = 'js/modules/inventory/esb.service.js';
const CSVC = 'js/modules/cash/cash.service.js';
const EADM = 'js/modules/inventory/esb.admin.js';
const CPAGE = 'js/modules/cash/cash.page.js';
const CADM = 'js/modules/cash/cash.admin.page.js';

const asli = new Map();
for (const rel of [MIG, MURNI, SUP, ESVC, CSVC, EADM, CPAGE, CADM]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  // `String.replace` dengan string hanya mengganti kemunculan PERTAMA. Pola
  // yang muncul lebih dari sekali berarti sabotasenya mengenai tempat yang
  // bukan sasarannya — dan "tertangkap"-nya tidak membuktikan apa pun.
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
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

const PG = 'tools/test-migrasi-0151.mjs';
const TES = 'tools/test-esb-disbursement.mjs';
const TES_SUP = 'tools/test-supplier-kas.mjs';
const AUDIT = 'tools/audit-disbursement.cjs';

console.log('SABOTASE AKUN YANG SALAH — berkas yang diterima ESB dengan tenang:');

sabotase(
  'COA kembali dibaca dari KATEGORI BIAYA — akun biaya dikirim ke kolom akun harta',
  MURNI,
  'akun = peta?.coa?.get?.(normalNama(c.kantong_outlet_nama)) ?? null;',
  'akun = peta?.coa?.get?.(normalNama(c.kategori_nama)) ?? null;',
  TES
);
sabotase(
  'COA jatuh ke outlet PERUNTUKAN — uangnya mendarat di kas outlet yang bukan sumbernya',
  MURNI,
  'akun = peta?.coa?.get?.(normalNama(c.kantong_outlet_nama)) ?? null;',
  'akun = peta?.coa?.get?.(normalNama(c.outlet_nama)) ?? null;',
  AUDIT
);
sabotase(
  'entri tanpa outlet kantong TIDAK ditahan — berangkat dengan sel Account kosong',
  MURNI,
  "if (!teks(c.kantong_outlet_nama)) {",
  'if (false) {',
  TES
);
sabotase(
  'alasan tertahannya jadi "coa", bukan "kantong" — menunjuk ke layar yang tidak bisa menyelesaikannya',
  MURNI,
  "catat('kantong', c.kantong_nama, kode);",
  "catat('coa', c.kantong_nama, kode);",
  TES
);

console.log('\nSABOTASE 0151 DI DATABASE:');

sabotase(
  'kantongnya di-JOIN biasa — entri tanpa kantong LENYAP, termasuk dari daftar tertahan',
  MIG,
  'left join cash_accounts ca on ca.id = ce.account_id',
  'join cash_accounts ca on ca.id = ce.account_id',
  PG
);
sabotase(
  'outlet kantongnya di-JOIN biasa — kantong tanpa outlet lenyap tanpa satu pun jejak',
  MIG,
  'left join outlets ko on ko.id = ca.outlet_id',
  'join outlets ko on ko.id = ca.outlet_id',
  PG
);
sabotase(
  'outlet kantong diganti outlet peruntukan di database — salahnya pindah ke tempat yang tidak dibaca siapa pun',
  MIG,
  '    ko.name,\n    ce.esb_exported_at',
  '    o.name,\n    ce.esb_exported_at',
  PG
);
sabotase(
  'kantong tanpa baris tidak dinamai "Kas Utama" — alasannya tidak cocok dengan layar Staff App',
  MIG,
  "coalesce(ca.name, 'Kas Utama')",
  'ca.name',
  PG
);
sabotase(
  'fungsinya tidak di-drop dulu — Postgres menolak "cannot change return type"',
  MIG,
  'drop function if exists kas_untuk_esb(uuid, date, date, uuid, boolean);',
  '',
  PG
);
// PENJAGA 0150 harus selamat dari penulisan ulang. Menulis ulang fungsi
// berarti mengetik ulang seluruh isinya — dan yang terlupa tidak melempar.
sabotase(
  'saringan pembayaran nota hilang saat fungsinya ditulis ulang — pengeluaran tercatat dua kali di ESB',
  MIG,
  // Polanya harus UNIK: `and ce.untuk_nota = false` muncul di kedua fungsi,
  // dan `String.replace` hanya mengenai yang pertama.
  "  where ce.entry_type = 'out'\n    -- HANYA PENGELUARAN SELAIN BAHAN. Keduanya dijaga constraint trigger\n    -- (0122/0131), jadi flag-nya tidak bisa dikarang dari klien.\n    and ce.untuk_nota = false\n",
  "  where ce.entry_type = 'out'\n",
  PG
);
sabotase(
  'saringan penyesuaian nota hilang saat fungsinya ditulis ulang',
  MIG,
  '    and ce.penyesuaian_nota is null\n    and ce.dicoret_at is null\n    and o.business_unit_id = p_bu\n    and (p_outlet is null or ce.outlet_id = p_outlet)',
  '    and ce.dicoret_at is null\n    and o.business_unit_id = p_bu\n    and (p_outlet is null or ce.outlet_id = p_outlet)',
  PG
);
sabotase(
  'wewenang outlet hilang saat fungsinya ditulis ulang — siapa pun membaca kas BU mana pun',
  MIG,
  '    and is_admin_of_outlet(auth.uid(), ce.outlet_id)\n  order by ce.entry_date, ce.id;',
  '  order by ce.entry_date, ce.id;',
  PG
);
sabotase(
  'daftar outlet kantong memuat entri yang tidak akan pernah diekspor',
  MIG,
  "  where ce.entry_type = 'out'\n    and ce.untuk_nota = false\n    and ce.penyesuaian_nota is null\n    and ce.dicoret_at is null\n    and o.business_unit_id = p_bu\n    and is_admin_of_outlet(auth.uid(), ce.outlet_id)\n  order by 1;",
  "  where ce.entry_type = 'out'\n    and o.business_unit_id = p_bu\n    and is_admin_of_outlet(auth.uid(), ce.outlet_id)\n  order by 1;",
  PG
);
sabotase(
  'daftar outlet kantong bisa dibaca siapa pun',
  MIG,
  '  join outlets ko on ko.id = ca.outlet_id\n  where',
  '  join outlets ko on ko.id = ca.outlet_id\n  where true or',
  PG
);
sabotase(
  'RPC daftar outlet kantong tidak bisa dipanggil — balas 404, dan layarnya diam saja',
  MIG,
  'grant execute on function outlet_kantong_kas_esb(uuid) to authenticated;',
  '',
  AUDIT
);

console.log('\nSABOTASE LAYAR PEMETAAN — alasan tertahan tanpa baris untuk memperbaikinya:');

sabotase(
  'kategori biaya kembali jadi kunci COA — tiga baris merah abadi yang tidak dipakai berkas mana pun',
  EADM,
  'coa: [...CARA_BAYAR, ...outlets.map((o) => o.name), ...outletKantong]',
  'coa: [...CARA_BAYAR, ...kategoriKas.map((k) => k.name)]',
  AUDIT
);
sabotase(
  'outlet kantong lintas BU tidak dimuat — namanya menahan entri tanpa satu pun baris untuk memetakannya',
  EADM,
  'outletKantongKasEsb(businessUnitId).catch(() => [])',
  'Promise.resolve([])',
  AUDIT
);
sabotase(
  'alasan "kantong" tidak punya label — tabel penahan menampilkan kode mentah',
  EADM,
  "  kantong: 'Kantong kasnya belum punya outlet (Kas → Kantong Kas)',\n",
  '',
  AUDIT
);
sabotase(
  'layanannya membuang keterangan kantong — SELURUH kas keluar tertahan, untuk kantong yang outletnya ada',
  ESVC,
  "kantong_outlet_nama: c.kantong_outlet_nama ?? ''",
  "kantong_outlet_nama: ''",
  AUDIT
);

console.log('\nSABOTASE SUPPLIER KAS — kotak yang tidak digambar:');

sabotase(
  'BU kembali dibaca dari kolom yang selalu NULL — kotak Supplier tidak pernah muncul lagi',
  SUP,
  'return entri.outlets?.business_unit_id ?? entri.business_unit_id ?? null;',
  'return entri.business_unit_id ?? null;',
  TES_SUP
);
sabotase(
  'embed outletnya dicabut dari query — `buKasEntri` tidak punya apa pun untuk dibaca',
  CSVC,
  "'outlets!outlet_id(name, business_unit_id), ' +\n",
  '',
  AUDIT
);
sabotase(
  'kewajiban berlaku walau daftar induknya kosong — BU tanpa Master Supplier tidak bisa mencatat kas keluar sama sekali',
  SUP,
  'return Array.isArray(daftarInduk) && daftarInduk.length > 0;',
  'return true;',
  TES_SUP
);
sabotase(
  'nilai lama di luar daftar tidak ditawarkan — koreksi hal lain MENGHAPUS nama yang sudah tersimpan',
  SUP,
  'opsi.unshift({ value: lama, label: lama, hint: HINT_DI_LUAR_DAFTAR });',
  '',
  TES_SUP
);
sabotase(
  'nilai lama ditolak setiap kali — dialog koreksi entri lama jadi form yang mustahil disimpan',
  SUP,
  'if (lama && normalNama(v) === normalNama(lama)) return null;',
  '',
  TES_SUP
);
sabotase(
  'nama di luar daftar diterima — ESB menolaknya nanti, jauh dari yang mengetiknya',
  SUP,
  'return PESAN_DI_LUAR_DAFTAR;',
  'return null;',
  TES_SUP
);
sabotase(
  'yang kosong diterima — Payment To kosong menahan entrinya saat diekspor',
  SUP,
  'if (!v) return PESAN_WAJIB;',
  '',
  TES_SUP
);
sabotase(
  'pembanding namanya disalin, bukan dipinjam dari cocok-supplier.js',
  SUP,
  "import { normalNama } from '../inventory/cocok-supplier.js';",
  'const normalNama = (s) => String(s ?? []).toLowerCase();',
  AUDIT
);

console.log('\nSABOTASE FORM — aturan yang digambar tapi tidak dipakai:');

sabotase(
  'form Catat Kas Keluar tidak memeriksa suppliernya',
  CPAGE,
  'const salahSupplier = periksaSupplierKas(values.supplier, daftarSupplier);',
  'const salahSupplier = null;',
  AUDIT
);
sabotase(
  'kolom supplier di form staff tidak wajib lagi',
  CPAGE,
  "                type: 'searchselect',\n                required: true,\n                options: opsiSupplier,",
  "                type: 'searchselect',\n                options: opsiSupplier,",
  AUDIT
);
sabotase(
  'nama bebas dihidupkan lagi di form staff — ESB menolaknya saat berkasnya diimpor',
  CPAGE,
  "                type: 'searchselect',\n                required: true,\n                options: opsiSupplier,",
  "                type: 'searchselect',\n                required: true,\n                allowCreate: true,\n                options: opsiSupplier,",
  AUDIT
);
sabotase(
  'dialog admin tidak memeriksa suppliernya',
  CADM,
  'const salahSupplier = periksaSupplierKas(values.supplier ?? r.supplier ?? \'\', daftarSupplier, { nilaiLama: r.supplier ?? \'\' });',
  'const salahSupplier = null;',
  AUDIT
);
sabotase(
  'dialog admin kembali memuat daftar supplier lewat kolom yang selalu NULL',
  CADM,
  "listEsbMaster(buKasEntri(r), 'supplier').catch(() => [])",
  "listEsbMaster(r.business_unit_id, 'supplier').catch(() => [])",
  AUDIT
);
sabotase(
  'aksi massal "Isi Supplier" kembali memakai kolom yang selalu NULL',
  CADM,
  'const bu = buKasEntri(semuaPerId.get(ids[0]));',
  'const bu = semuaPerId.get(ids[0])?.business_unit_id ?? null;',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase 0151 tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya tidak menjaga apa yang dikiranya dijaga.`);
process.exit(gagal === 0 ? 0 : 1);
