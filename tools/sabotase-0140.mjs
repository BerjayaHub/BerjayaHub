/**
 * SABOTASE: laporan Rincian Mutasi Kas (0140).
 *
 * Yang dijaga bukan "laporannya muncul", melainkan bahwa angkanya tidak pernah
 * berselisih dengan buku kas sambil tetap terlihat wajar. Tiap sabotase di
 * bawah menghasilkan laporan yang tetap tercetak rapi.
 *
 * ============ JEBAKAN YANG SUDAH MENGGIGIT EMPAT KALI ============
 *
 * `String.replace` dengan STRING hanya mengganti kemunculan PERTAMA. Pola yang
 * muncul lebih dari sekali di berkas yang sama harus memakai regex `/…/g` —
 * kalau tidak, yang tersabotase adalah tempat yang salah dan "tertangkap"-nya
 * tidak membuktikan apa-apa. `boleh_lihat_kas(...)` di bawah adalah salah satu
 * kasus itu, dan `ambilSemua((dari, sampai) =>` di cash.service.js adalah
 * kasus lain: ia juga dipakai `listCashEntriesAdmin` BEBERAPA RATUS BARIS
 * LEBIH DULU, jadi polanya sengaja dibuat memuat nama RPC-nya.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0140_rincian_mutasi_kas.sql';
const MURNI = 'js/modules/report/mutasi-kas.js';
const CASH = 'js/modules/cash/cash.service.js';
const SVC = 'js/modules/report/report.service.js';
const PAGE = 'js/modules/report/report.admin.page.js';

const asli = new Map();
for (const rel of [MIG, MURNI, CASH, SVC, PAGE]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const TES_MIG = 'tools/test-migrasi-0140.mjs';
const TES = 'tools/test-mutasi-kas.mjs';
const AUDIT = 'tools/audit-mutasi-kas.cjs';

console.log('SABOTASE SERVER (0140):');

sabotase(
  'pembedanya kembali `untuk_nota` — entri PENYESUAIAN lenyap dari laporan',
  MIG,
  '  where not exists (select 1 from nota n where n.payment_entry_id = t.id)',
  '  where coalesce(t.untuk_nota, false) = false',
  TES_MIG
);
sabotase(
  'nilai baris dihitung `unit_cost x qty` — meleset ribuan rupiah pada qty yang tidak membagi habis',
  MIG,
  'coalesce(gri.line_total, gri.qty * gri.unit_cost)',
  'gri.qty * gri.unit_cost',
  TES_MIG
);
sabotase(
  'baris tanpa harga dijadikan Rp0 — total rapi dan lebih kecil dari kenyataan',
  MIG,
  'coalesce(gri.line_total, gri.qty * gri.unit_cost)',
  'coalesce(gri.line_total, gri.qty * gri.unit_cost, 0)',
  TES_MIG
);
sabotase(
  'tanda nominalnya dipaksa positif — pembelian terbaca sebagai kas MASUK',
  MIG,
  'case when t.amount < 0 then -1 else 1 end * coalesce(gri.line_total, gri.qty * gri.unit_cost)',
  'coalesce(gri.line_total, gri.qty * gri.unit_cost)',
  TES_MIG
);
sabotase(
  '`entry_amount` diisi nominal BARISNYA — nota terkoreksi jadi tidak bisa direkonsiliasi',
  MIG,
  '    t.amount,\n    n.code,',
  '    coalesce(gri.line_total, gri.qty * gri.unit_cost),\n    n.code,',
  TES_MIG
);
sabotase(
  'rentang tanggalnya diabaikan — laporan sebulan memuat seluruh sejarah kas',
  MIG,
  '    where ce.entry_date between p_from and p_to',
  '    where true',
  TES_MIG
);

console.log('\nSABOTASE IZIN:');

sabotase(
  'izinnya dibuka untuk siapa saja — kas orang lain terbaca semua orang',
  MIG,
  '    is_super_admin(auth.uid())',
  '    true',
  TES_MIG
);
sabotase(
  'cabang admin BU dicabut — admin BU melihat pengeluaran anak buahnya, tidak pemasukannya',
  MIG,
  '        and is_bu_admin(auth.uid(), ms.business_unit_id)',
  '        and false',
  TES_MIG
);
// `/…/g`: polanya muncul DUA KALI (di `kantong_kas_terlihat` dan di CTE
// `terlihat`). Dengan string biasa, hanya yang pertama tersabotase dan
// laporannya tetap tertutup rapat — "tertangkap" yang tidak membuktikan apa pun.
sabotase(
  'penyaring izin dilepas dari kedua fungsinya',
  MIG,
  /boleh_lihat_kas\(ce\.holder_id, ce\.outlet_id\)/g,
  'true',
  TES_MIG
);

console.log('\nSABOTASE FILTER KANTONG:');

sabotase(
  '"Kas Utama" tidak lagi menyaring — jawabannya sama dengan "semua kantong"',
  MIG,
  '          when coalesce(p_tanpa_kantong, false) then ce.account_id is null',
  '          when false then true',
  TES_MIG
);
sabotase(
  'filter kantong diabaikan — memilih satu kantong tetap menampilkan semuanya',
  MIG,
  '          else ce.account_id = p_account',
  '          else true',
  TES_MIG
);
sabotase(
  'Kas Utama hilang dari daftar kantong — sebagian besar uang jadi tidak bisa disaring',
  MIG,
  '  left join cash_accounts ca on ca.id = ce.account_id\n  left join outlets o on o.id = ca.outlet_id',
  '  join cash_accounts ca on ca.id = ce.account_id\n  left join outlets o on o.id = ca.outlet_id',
  TES_MIG
);
sabotase(
  'nota disambung ke seluruh buku kas, bukan ke baris yang terlihat',
  MIG,
  '    join terlihat t on t.id = g.payment_entry_id',
  '    join cash_entries t on t.id = g.payment_entry_id',
  AUDIT
);

console.log('\nSABOTASE REKONSILIASI (inti laporannya):');

sabotase(
  'rekonsiliasi dimatikan — nota yang dikoreksi sesudah dibayar terhitung dua kali',
  MURNI,
  '  const beda = induk - jumlah;',
  '  const beda = 0;',
  TES
);
sabotase(
  'arah selisihnya terbalik — koreksi mahal terbaca sebagai uang kembali',
  MURNI,
  '  const beda = induk - jumlah;',
  '  const beda = jumlah - induk;',
  TES
);
sabotase(
  'baris tanpa harga ikut direkonsiliasi — laporan menuduh "koreksi nota" yang tidak pernah terjadi',
  MURNI,
  '    if (n === null) return null;',
  '    if (n === null) continue;',
  TES
);
sabotase(
  'toleransi pembulatan dibesarkan — koreksi sungguhan ikut tertelan',
  MURNI,
  'export const TOLERANSI_REKONSILIASI = 1;',
  'export const TOLERANSI_REKONSILIASI = 1000000;',
  TES
);
sabotase(
  'baris rekonsiliasi menuduh satu nomor nota, padahal satu entri bisa melunasi beberapa nota',
  MURNI,
  "      nota: kode.length === 1 ? kode[0] : '',",
  '      nota: r.nota,',
  TES
);

console.log('\nSABOTASE ANGKA:');

sabotase(
  'baris tanpa harga dijadikan 0 di layar — dan Infinity ikut lolos jadi "Rp∞"',
  MURNI,
  '    nominal: angkaAtauNull(r?.nominal),',
  '    nominal: Number(r?.nominal) || 0,',
  TES
);
sabotase(
  'angka non-finite berhenti disaring',
  MURNI,
  '  return Number.isFinite(n) ? n : null;',
  '  return n;',
  TES
);
sabotase(
  'Masuk & Keluar digabung jadi satu kolom bertanda minus — "keluar masuk saldo" tidak lagi terbaca',
  MURNI,
  "    r.nominal === null ? '-' : r.nominal >= 0 ? formatRupiah(r.nominal) : '',",
  "    r.nominal === null ? '-' : formatRupiah(r.nominal),",
  TES
);

console.log('\nSABOTASE PENGAMBILAN DATA & LAYAR:');

// Polanya memuat nama RPC-nya supaya menyasar `rincianMutasiKas`, BUKAN
// `listCashEntriesAdmin` yang memakai `ambilSemua((dari, sampai) =>` yang sama
// beberapa ratus baris lebih dulu di berkas ini.
sabotase(
  'diambil tanpa paginasi — sebulan belanja bahan terpotong di 1000 baris tanpa error',
  CASH,
  "  return ambilSemua((dari, sampai) =>\n    supabase\n      .rpc(\n        'rincian_mutasi_kas',",
  "  return await (async (dari, sampai) =>\n    supabase\n      .rpc(\n        'rincian_mutasi_kas',",
  AUDIT
);
sabotase(
  'kunci urut `baris_id` dicabut — halaman berikutnya bisa melewatkan sekaligus menggandakan baris',
  CASH,
  "      .order('baris_id')\n",
  '',
  AUDIT
);
sabotase(
  'bendera Kas Utama tidak pernah sampai ke server',
  CASH,
  '          p_tanpa_kantong: !!tanpaKantong,',
  '          p_tanpa_kantong: false,',
  AUDIT
);
sabotase('laporan dicabut dari katalog', SVC, "    key: 'cash_mutation_detail',", "    key: 'cash_mutation_detail_off',", AUDIT);
sabotase('dropdown kantong tidak pernah muncul', SVC, '    pakaiFilterKantong: true,', '', AUDIT);
sabotase(
  'galat pengambilan ditelan — laporan gagal tampil kosong, sama seperti periode tanpa transaksi',
  SVC,
  '    categoryId\n  });\n  return susunMutasiKas',
  '    categoryId\n  }).catch(() => []);\n  return susunMutasiKas',
  AUDIT
);
sabotase(
  "penanda 'utama' dikirim sebagai id kantong — servernya menolak seluruh permintaan",
  PAGE,
  "        accountId: state.accountId === 'utama' ? null : state.accountId || null,",
  '        accountId: state.accountId || null,',
  AUDIT
);
sabotase(
  'memilih Kas Utama jadi sama saja dengan "semua kantong"',
  PAGE,
  "        tanpaKantong: state.accountId === 'utama',",
  '        tanpaKantong: false,',
  AUDIT
);
sabotase(
  'daftar kantong tidak menyempit saat pemegang diganti — hasilnya kosong tanpa sebab yang terlihat',
  PAGE,
  '    if (!kantongWrap.hidden) isiOpsiKantong();',
  '',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase Rincian Mutasi Kas tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
