/**
 * SABOTASE: kantong kas pada entri kas (0152).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Kerusakan yang dikejar di sini tidak melempar, tidak menghilangkan uang, dan
 * tidak membuat satu pun angka di layar terlihat salah. Ia cuma membuat uang
 * tercatat DI TEMPAT YANG SALAH — dan akibatnya baru terlihat dua layar
 * kemudian, sebagai saldo kantong yang negatif dan ekspor yang menahan entri
 * tanpa ada yang tahu kenapa.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0152_pindahkan_entri_ke_kantong.sql';
const MURNI = 'js/modules/cash/kantong-wajib.js';
const CSVC = 'js/modules/cash/cash.service.js';
const CPAGE = 'js/modules/cash/cash.page.js';
const CADM = 'js/modules/cash/cash.admin.page.js';

const asli = new Map();
for (const rel of [MIG, MURNI, CSVC, CPAGE, CADM]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  // `String.replace` dengan string hanya mengganti kemunculan PERTAMA.
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

const PG = 'tools/test-migrasi-0152.mjs';
const TES = 'tools/test-kantong-wajib.mjs';
const AUDIT = 'tools/audit-kantong-entri.cjs';

console.log('SABOTASE GERBANG YANG SALAH PERTANYAAN:');

sabotase(
  'gerbangnya kembali ke JATAH — pemegang berjatah 1 tidak pernah ditanya kantongnya lagi',
  MURNI,
  'return Array.isArray(kantong) && kantong.length > 0;',
  'return Array.isArray(kantong) && kantong.length > 1;',
  TES
);
sabotase(
  'yang belum punya kantong ikut ditolak — pengeluaran jam 9 malam tidak tercatat sama sekali',
  MURNI,
  'if (!kantongWajib(kantong)) return null;',
  '',
  TES
);
sabotase(
  '"Kas Utama" ditawarkan sebagai pilihan — keadaan yang diperbaiki jadi jawaban yang sah',
  MURNI,
  "    .filter((k) => k && k.id)\n    .map((k) => ({\n      value: k.id,",
  "    .filter((k) => k && k.id)\n    .concat([{ id: '', name: NAMA_TANPA_KANTONG }])\n    .map((k) => ({\n      value: k.id,",
  AUDIT
);
sabotase(
  'kantong tanpa outlet dibuang dari daftar — dropdown kosong yang wajib diisi',
  MURNI,
  '      hint: k.outlet_id ? teks(k.outlet_name) : HINT_TANPA_OUTLET',
  '      hint: teks(k.outlet_name)',
  AUDIT
);
sabotase(
  'id kantong asing diteruskan ke database — pesannya di sana berbicara tentang foreign key',
  MURNI,
  "  return kantong.some((k) => k?.id === v) ? null : 'Kantong itu bukan milikmu. Muat ulang halamannya.';",
  '  return null;',
  TES
);
sabotase(
  'kas masuk & kas keluar memakai kalimat yang sama — "keluar dari kantong mana" untuk uang yang masuk',
  MURNI,
  "  if (!v) return jenis === 'in' ? PESAN_WAJIB_MASUK : PESAN_WAJIB;",
  '  if (!v) return PESAN_WAJIB;',
  TES
);
sabotase(
  'entri tanpa kantong dinamai berbeda dari layar lain — empat layar yang tidak bisa dicocokkan',
  MURNI,
  "export const NAMA_TANPA_KANTONG = 'Kas Utama';",
  "export const NAMA_TANPA_KANTONG = 'Tanpa kantong';",
  TES
);

console.log('\nSABOTASE 0152 DI DATABASE:');

sabotase(
  'lubang NULL dibuka lagi — pemanggil TANPA SESI dinyatakan boleh mengoreksi kas siapa pun',
  MIG,
  '  select coalesce(\n    is_super_admin(auth.uid())',
  '  select (\n    is_super_admin(auth.uid())',
  PG
);
sabotase(
  'penjaga "admin BU" hilang saat boleh_koreksi_kas ditulis ulang',
  MIG,
  '        and is_bu_admin(auth.uid(), ms.business_unit_id)',
  '        and false',
  PG
);
sabotase(
  'syaratnya DISALIN, bukan menumpang — dialog koreksi & aksi massal jadi dua aturan yang berbeda',
  MIG,
  '     and alasan_tolak_koreksi_kas(c.id) is null;',
  '     and c.dicoret_at is null;',
  PG
);
sabotase(
  'kantong tidak wajib milik pemegang entrinya — saldo dua orang berubah sekaligus, tanpa disebut transfer',
  MIG,
  '     and c.holder_id = v_akun.holder_id\n',
  '',
  PG
);
sabotase(
  'baris yang sudah di kantong itu ikut ditulisi jejak perubahan yang tidak pernah terjadi',
  MIG,
  '     and c.account_id is distinct from p_account\n',
  '',
  PG
);
sabotase(
  'memindahkan KEMBALI ke Kas Utama diterima — pekerjaan mundur tanpa satu pun pesan',
  MIG,
  "    raise exception 'Pilih kantong tujuannya dulu. Memindahkan kembali ke Kas Utama tidak membereskan apa pun.';",
  '    return 0;',
  PG
);
sabotase(
  'kantong NONAKTIF diterima — uangnya pindah ke kantong yang tidak muncul di layar mana pun',
  MIG,
  '  if not v_akun.is_active then',
  '  if false then',
  PG
);
sabotase(
  'wewenang atas kantong tujuannya tidak diperiksa',
  MIG,
  '  if not boleh_koreksi_kas(v_akun.holder_id) then',
  '  if false then',
  PG
);
sabotase(
  'tidak meninggalkan jejak siapa yang memindahkan',
  MIG,
  '         diubah_by = v_uid,\n         diubah_at = now()',
  '         diubah_by = c.diubah_by,\n         diubah_at = c.diubah_at',
  PG
);
sabotase(
  'daftar kantong tujuannya bisa dibaca siapa pun',
  MIG,
  '     and boleh_koreksi_kas(p_holder)\n',
  '',
  PG
);
sabotase(
  'kantong nonaktif ikut ditawarkan sebagai tujuan',
  MIG,
  '   where a.holder_id = p_holder\n     and a.is_active',
  '   where a.holder_id = p_holder\n     and true',
  PG
);
sabotase(
  'RPC pemindahnya tidak bisa dipanggil siapa pun — balas 404, dan layarnya diam saja',
  MIG,
  'grant execute on function ubah_kantong_kas(uuid[], uuid) to authenticated;',
  '',
  AUDIT
);

console.log('\nSABOTASE LAYAR STAFF:');

sabotase(
  'kas MASUK tidak lagi ditanya kantongnya — uang menumpuk di Kas Utama, saldo kantong jadi negatif',
  CPAGE,
  "        ...(kantongWajib(accounts)\n          ? [\n              {\n                name: 'account_id',\n                label: 'Masuk ke kantong',",
  "        ...(false\n          ? [\n              {\n                name: 'account_id',\n                label: 'Masuk ke kantong',",
  AUDIT
);
sabotase(
  'kas KELUAR tidak lagi ditanya kantongnya',
  CPAGE,
  "        ...(kantongWajib(accounts)\n          ? [\n              {\n                name: 'account_id',\n                label: 'Diambil dari kantong',",
  "        ...(false\n          ? [\n              {\n                name: 'account_id',\n                label: 'Diambil dari kantong',",
  AUDIT
);
sabotase(
  'isian kantong kas keluar tidak diperiksa sebelum dikirim',
  CPAGE,
  "    const salahKantong = periksaKantong(values.account_id, accounts, 'out');",
  '    const salahKantong = null;',
  AUDIT
);
sabotase(
  'isian kantong kas masuk tidak diperiksa sebelum dikirim',
  CPAGE,
  "    const salahKantongMasuk = periksaKantong(values.account_id, accounts, 'in');",
  '    const salahKantongMasuk = null;',
  AUDIT
);
sabotase(
  '⇄ Pindah Kas kembali digantung pada jatah — uang di Kas Utama terkunci di sana',
  CPAGE,
  // Kutip TUNGGAL, bukan template literal: `${punyaKantong}` di dalam backtick
  // akan diinterpolasi JS, bukan dicari di berkasnya.
  '        ${punyaKantong ? \'<button id="cash-move">⇄ Pindah Kas</button>\' : \'\'}',
  '        ${bolehTambahKantong ? \'<button id="cash-move">⇄ Pindah Kas</button>\' : \'\'}',
  AUDIT
);

console.log('\nSABOTASE LAYAR ADMIN:');

sabotase(
  'kolom Kantong tidak digambar — "2 tertahan" tanpa cara menemukan barisnya',
  CADM,
  // Konteks disertakan supaya sasarannya UNIK: tab Kantong Kas di halaman yang
  // sama punya kolom bernama persis sama.
  '<th>Pemegang</th><th>Kantong</th><th>Jenis</th>',
  '<th>Pemegang</th><th>Jenis</th>',
  AUDIT
);
sabotase(
  'baris tanpa kantong tidak ditandai — terbaca sama saja dengan baris yang sudah benar',
  CADM,
  '                tanpaKantong(r)',
  '                false',
  AUDIT
);
sabotase(
  'entri beberapa pemegang bisa dicentang sekaligus — "3 dari 7 dipindahkan" yang tidak menjelaskan apa-apa',
  CADM,
  '      if (pemegang.length !== 1) {',
  '      if (false) {',
  AUDIT
);
sabotase(
  'hasil pemindahannya tidak dibandingkan dengan yang dicentang',
  CADM,
  '        if (n === ids.length) toast(`${n} entri dipindahkan.`, \'success\');',
  "        toast('Selesai.', 'success');",
  AUDIT
);
sabotase(
  'kolom kantongnya tidak ikut diambil query — kolom Kantong kosong untuk SEMUA baris',
  CSVC,
  "          'cash_accounts(name), ' +\n",
  '',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase 0152 tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya tidak menjaga apa yang dikiranya dijaga.`);
process.exit(gagal === 0 ? 0 : 1);
