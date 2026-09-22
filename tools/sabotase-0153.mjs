/**
 * SABOTASE: bayar dari kantong outlet lain, dan DIBAYAR PUSAT (0153).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * 0153 MENYALIN lima fungsi dari migration lain dan mengubah satu ekspresi di
 * masing-masing. Salinan yang kehilangan satu penjaga tidak melempar apa pun —
 * ia cuma membuka pintu, atau membuat satu layar menyebut angka yang berbeda
 * dari tetangganya.
 *
 * Bentuk paling mahalnya: saldo. "Satu tempat yang terlewat tidak melempar
 * error; ia cuma menjawab angka yang berbeda dari tetangganya, dan yang
 * membacanya tidak punya cara tahu mana yang benar." (0141)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0153_bayar_dari_kantong_lain_dan_pusat.sql';
const MURNI = 'js/modules/cash/kantong-wajib.js';
const DISB = 'js/modules/inventory/esb-disbursement.js';
const ESVC = 'js/modules/inventory/esb.service.js';
const CSVC = 'js/modules/cash/cash.service.js';
const CPAGE = 'js/modules/cash/cash.page.js';

const asli = new Map();
for (const rel of [MIG, MURNI, DISB, ESVC, CSVC, CPAGE]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const PG = 'tools/test-migrasi-0153.mjs';
const TES = 'tools/test-kantong-wajib.mjs';
const TES_DISB = 'tools/test-esb-disbursement.mjs';
const AUDIT = 'tools/audit-bayar-pusat.cjs';

console.log('SABOTASE SALDO — dua layar, dua angka, untuk orang yang sama:');

sabotase(
  'cash_balances ikut menghitung uang Pusat — saldo pemegang berkurang oleh uang yang tak pernah di tangannya',
  MIG,
  '  where dicoret_at is null\n    and not dibayar_pusat\n  group by holder_id;',
  '  where dicoret_at is null\n  group by holder_id;',
  PG
);
sabotase(
  'cash_account_balances ikut menghitungnya',
  MIG,
  '  where ce.dicoret_at is null\n    and not ce.dibayar_pusat\n  group by ce.holder_id',
  '  where ce.dicoret_at is null\n  group by ce.holder_id',
  PG
);
sabotase(
  'pemeriksaan saldo `pindah_kas` ikut menghitungnya — uang yang SUNGGUH ada tidak bisa dipindahkan',
  MIG,
  '     and not dibayar_pusat\n',
  '',
  PG
);
sabotase(
  'layar Kantong Kas ikut menghitungnya — angkanya berbeda dari cash_balances',
  MIG,
  '     where not ce.dibayar_pusat\n',
  '',
  PG
);
// Pengecualian LAMA (0141) harus ikut selamat saat view-nya ditulis ulang.
sabotase(
  'pengecualian "yang dicoret" hilang dari cash_balances saat ditulis ulang',
  MIG,
  '  where dicoret_at is null\n    and not dibayar_pusat',
  '  where not dibayar_pusat',
  AUDIT
);
sabotase(
  'kolom sort_order hilang dari cash_account_balances — urutan kantong di layar jadi acak',
  MIG,
  '         coalesce(ca.sort_order, -1) as sort_order,\n',
  '         -1 as sort_order,\n',
  AUDIT
);

console.log('\nSABOTASE PENJAGA YANG HILANG SAAT DISALIN:');

sabotase(
  'pindah_kas: kantong tujuan tidak harus milik pemanggil — transfer terselubung yang tidak tercatat sebagai transfer',
  MIG,
  "    raise exception 'Kantong tujuan bukan milikmu.';",
  '    null;',
  AUDIT
);
sabotase(
  'daftar_kantong_kas: penjaga super-admin hilang — kantong seluruh organisasi terbuka',
  MIG,
  '   where is_super_admin(auth.uid())\n\n  union all',
  '   where true\n\n  union all',
  AUDIT
);
sabotase(
  'riwayat_kas_saya: saringan "milikku" hilang — riwayat orang lain bocor ke Staff App',
  MIG,
  '  where ce.holder_id = auth.uid()\n  order by ce.created_at desc',
  '  order by ce.created_at desc',
  AUDIT
);
sabotase(
  'rincian_mutasi_kas: penjaga boleh_lihat_kas hilang — kas seluruh organisasi terbuka',
  MIG,
  '      and boleh_lihat_kas(ce.holder_id, ce.outlet_id)\n',
  '',
  AUDIT
);
sabotase(
  'rincian_mutasi_kas: rumus nilai baris nota berubah — tidak lagi sama dengan nota_ringkas & bayar_nota',
  MIG,
  'coalesce(gri.line_total, gri.qty * gri.unit_cost)',
  'gri.qty * gri.unit_cost',
  AUDIT
);
sabotase(
  'laporan_kas_user: pengecualian yang dicoret hilang',
  MIG,
  '    and ce.dicoret_at is null\n    and (p_user is null or ce.holder_id = p_user)',
  '    and (p_user is null or ce.holder_id = p_user)',
  AUDIT
);

console.log('\nSABOTASE LABEL — laporan yang mengatakan hal yang salah dengan tenang:');

sabotase(
  'riwayat Staff App menyebut entri Pusat sebagai "Kas Utama"',
  MIG,
  '    ce.account_id,\n    label_kantong_kas(ca.name, ce.dibayar_pusat),\n    ce.outlet_id,\n    o.name,\n    cp.full_name,',
  "    ce.account_id,\n    coalesce(ca.name, 'Kas Utama'),\n    ce.outlet_id,\n    o.name,\n    cp.full_name,",
  PG
);
sabotase(
  'laporan kas menyebutnya "Kas Utama"',
  MIG,
  "    up.full_name,\n    label_kantong_kas(ca.name, ce.dibayar_pusat),\n    ce.outlet_id,",
  "    up.full_name,\n    coalesce(ca.name, 'Kas Utama'),\n    ce.outlet_id,",
  PG
);
sabotase(
  'label_kantong_kas berubah bentuk — "Pusat" tidak lagi keluar dari mana pun',
  MIG,
  "           when coalesce(p_pusat, false) then 'Pusat'",
  "           when false then 'Pusat'",
  PG
);

console.log('\nSABOTASE BENTUK BARISNYA:');

sabotase(
  'Pusat boleh menunjuk kantong sekaligus — baris yang membantah dirinya sendiri',
  MIG,
  '      check (not dibayar_pusat or account_id is null);',
  '      check (true);',
  PG
);
sabotase(
  'kas MASUK boleh ditandai Pusat',
  MIG,
  "      check (not dibayar_pusat or entry_type = 'out');",
  '      check (true);',
  PG
);
sabotase(
  'kolomnya tidak dibuat sama sekali',
  MIG,
  'alter table cash_entries add column if not exists dibayar_pusat boolean not null default false;',
  '',
  PG
);

console.log('\nSABOTASE `catat_kas_di`:');

sabotase(
  'tanda tangan lamanya tidak dibuang — permintaan tanpa p_supplier diam-diam memilih yang lama',
  MIG,
  'drop function if exists catat_kas_di(uuid, text, numeric, uuid, uuid, text, text, date, numeric, text);',
  '',
  AUDIT
);
sabotase(
  'Supplier tidak ikut disimpan — entrinya tertahan saat diekspor, tanpa sebab yang terlihat',
  MIG,
  "    case when p_type = 'out' then nullif(btrim(p_supplier), '') else null end,",
  '    null,',
  PG
);
sabotase(
  'holder-nya yang MENCATAT, bukan pemilik kantongnya — saldo dua orang salah sekaligus',
  MIG,
  '    select holder_id, is_active into v_holder, v_aktif from cash_accounts where id = p_account;',
  '    v_holder := v_uid;\n    select is_active into v_aktif from cash_accounts where id = p_account;',
  PG
);
sabotase(
  'wewenang membebani kantong tidak diperiksa — siapa pun membebani kas siapa pun',
  MIG,
  '    if not boleh_membebani_kas(v_uid, p_account) then',
  '    if false then',
  PG
);
sabotase(
  'kantong yang sudah ditutup diterima',
  MIG,
  '    if not v_aktif then',
  '    if false then',
  PG
);
sabotase(
  'kas keluar tanpa bukti diterima',
  MIG,
  "  if p_type = 'out' and nullif(p_proof, '') is null then",
  '  if false then',
  PG
);
sabotase(
  'kas keluar tanpa outlet peruntukan diterima',
  MIG,
  "  if p_type = 'out' and p_outlet is null then",
  '  if false then',
  PG
);
sabotase(
  'tandanya ditentukan pemanggil — satu layar yang lupa minus akan MENAMBAH kas',
  MIG,
  "  v_amount := case when p_type = 'out' then -abs(p_amount) else abs(p_amount) end;",
  '  v_amount := p_amount;',
  PG
);
sabotase(
  'Pusat + kantong diterima fungsinya',
  MIG,
  "      raise exception 'Pengeluaran yang dibayar Pusat tidak keluar dari kantong mana pun. Pilih salah satu, bukan keduanya.';",
  '      null;',
  PG
);
sabotase(
  'kas MASUK bisa ditandai Pusat lewat fungsinya',
  MIG,
  "      raise exception 'Hanya kas keluar yang bisa dibayar Pusat.';",
  '      null;',
  PG
);

console.log('\nSABOTASE EKSPOR:');

sabotase(
  'tandanya tidak ikut dikembalikan — SELURUH entri Pusat tertahan, diam-diam',
  MIG,
  '    ce.dibayar_pusat,\n    ce.esb_exported_at',
  '    false,\n    ce.esb_exported_at',
  AUDIT
);
sabotase(
  'entri Pusat tidak punya cabangnya sendiri — tertahan karena "kantongnya belum punya outlet"',
  DISB,
  '    if (c.dibayar_pusat) {',
  '    if (false) {',
  TES_DISB
);
sabotase(
  'entri Pusat memakai kunci COA yang salah',
  DISB,
  "      akun = peta?.coa?.get?.(normalNama('pusat')) ?? null;",
  "      akun = peta?.coa?.get?.(normalNama('kas')) ?? null;",
  TES_DISB
);
sabotase(
  'alasan tertahannya "kantong", bukan "coa" — menyuruh menempeli outlet pada kantong yang tidak ada',
  DISB,
  "        catat('coa', 'pusat', kode);",
  "        catat('kantong', 'pusat', kode);",
  TES_DISB
);
sabotase(
  'layanannya membuang tanda Pusat',
  ESVC,
  'dibayar_pusat: c.dibayar_pusat === true',
  'dibayar_pusat: false',
  AUDIT
);
sabotase(
  'baris Pusat bisa diberi kantong — pernyataan yang salah, ditolak constraint dengan pesan tentang nama constraint',
  MIG,
  '     and not c.dibayar_pusat\n',
  '',
  PG
);

console.log('\nSABOTASE MODUL & LAYAR:');

sabotase(
  '`sumberDana` mengirim accountId bersama dibayarPusat — keduanya ditolak database',
  MURNI,
  "  return pilihPusat(nilai) ? { accountId: null, dibayarPusat: true } : { accountId: teks(nilai) || null, dibayarPusat: false };",
  '  return { accountId: teks(nilai) || null, dibayarPusat: pilihPusat(nilai) };',
  TES
);
sabotase(
  'Pusat diterima untuk kas MASUK',
  MURNI,
  "  if (pilihPusat(v)) return jenis === 'in' ? 'Kas masuk tidak bisa \"dibayar Pusat\". Pilih kantongnya.' : null;",
  '  if (pilihPusat(v)) return null;',
  TES
);
sabotase(
  'penandanya jadi uuid nol — terlihat seperti id sungguhan di log, di URL, dan di kepala orang',
  MURNI,
  "export const BAYAR_PUSAT = '__pusat__';",
  "export const BAYAR_PUSAT = '00000000-0000-0000-0000-000000000000';",
  TES
);
sabotase(
  'baris Pusat dinamai "Kas Utama" di tabel admin — berbeda dari database, untuk baris yang sama',
  MURNI,
  '  if (entri?.dibayar_pusat) return NAMA_PUSAT;',
  '',
  TES
);
sabotase(
  'baris Pusat ditandai perlu dibereskan — menyuruh membetulkan yang sudah benar',
  MURNI,
  '  if (entri?.dibayar_pusat) return false;',
  '',
  TES
);
sabotase(
  'Pusat ditawarkan di SEMUA daftar, termasuk kas masuk',
  MURNI,
  '  return pusat ? [...daftar, { value: BAYAR_PUSAT, label: LABEL_PUSAT, hint: HINT_PUSAT }] : daftar;',
  '  return [...daftar, { value: BAYAR_PUSAT, label: LABEL_PUSAT, hint: HINT_PUSAT }];',
  TES
);
sabotase(
  'keterangan outlet & pemegang pindah ke `hint` — `select` membuangnya, dropdown jadi tidak bisa dibedakan',
  MURNI,
  '  const outlet = namaOutlet(k);\n  const pemegang = teks(k?.user_profiles?.full_name);',
  '  const outlet = \'\';\n  const pemegang = \'\';',
  TES
);
sabotase(
  'label Pusat tidak lagi menjelaskan dirinya — terbaca seperti nama kantong',
  MURNI,
  "export const LABEL_PUSAT = 'Dibayar Pusat — tidak mengurangi kas siapa pun';",
  "export const LABEL_PUSAT = 'Pusat';",
  TES
);
sabotase(
  'nama outlet cuma dibaca dari satu bentuk — separuh layar kehilangan keterangannya',
  MURNI,
  "  return teks(k?.outlet_name) || teks(k?.outlets?.name);",
  '  return teks(k?.outlet_name);',
  TES
);
sabotase(
  'form Kas Keluar kembali menulis langsung — holder-nya jadi yang mencatat, bukan pemilik kasnya',
  CPAGE,
  '      await catatKasKeluar({',
  '      await recordCashEntry({',
  AUDIT
);
sabotase(
  'pilihan "Dibayar Pusat" tidak digambar — kemampuannya ada di database, jalannya tidak ada di layar',
  CPAGE,
  'options: opsiKantong(bisaDibebani, { pusat: true }),',
  'options: opsiKantong(bisaDibebani),',
  AUDIT
);
sabotase(
  'penerjemahan pilihan ditulis ulang di layar',
  CPAGE,
  'const { accountId, dibayarPusat } = sumberDana(values.account_id);',
  'const accountId = values.account_id;\n    const dibayarPusat = false;',
  AUDIT
);
sabotase(
  'foto yatim ditinggalkan di Storage kalau RPC-nya gagal',
  CSVC,
  "    await supabase.storage.from('cash-proofs').remove([path]).catch(() => {});\n    throw e;",
  '    throw e;',
  AUDIT
);
sabotase(
  '`catatKasDi` tidak lagi lewat argumenRpc — kunci ber-nilai undefined dibuang, dan overload-nya berubah',
  CSVC,
  "  const { data, error } = await supabase.rpc(\n    'catat_kas_di',\n    argumenRpc({",
  "  const { data, error } = await supabase.rpc(\n    'catat_kas_di',\n    ({",
  AUDIT
);
sabotase(
  'kolom `dibayar_pusat` tidak ikut diambil tabel Mutasi Kas',
  CSVC,
  "'cash_accounts(name), dibayar_pusat, ' +",
  "'cash_accounts(name), ' +",
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase 0153 tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya tidak menjaga apa yang dikiranya dijaga.`);
process.exit(gagal === 0 ? 0 : 1);
