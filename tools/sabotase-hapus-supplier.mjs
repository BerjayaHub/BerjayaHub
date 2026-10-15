/**
 * SABOTASE: hapus supplier + tab tersendiri + banner kesiapan ESB (0161).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Tiga perubahan, dan ketiganya punya bentuk kegagalan yang sama: BERHASIL
 * tanpa melakukan yang seharusnya.
 *
 *   Hapus yang tidak menolak  -> `on delete set null`, jadi 42 nota kehilangan
 *                                induknya dan tidak ada satu pun galat.
 *   Tab yang terdaftar tapi
 *     tidak dirender          -> diklik, lalu tidak terjadi apa-apa.
 *   Banner yang menghitung
 *     sendiri                 -> dua angka yang bertentangan di satu layar.
 *
 * Tidak satu pun dari ketiganya akan muncul sebagai pesan merah di mana pun.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0161_hapus_supplier.sql';
const M162 = 'supabase/migrations/0162_hapus_supplier_hanya_hitung_yang_aktif.sql';
const SUP = 'js/modules/inventory/supplier.admin.js';
const INV = 'js/modules/inventory/inventory.admin.page.js';
const ESB = 'js/modules/inventory/esb.admin.js';
const KES = 'js/modules/inventory/kesiapan-esb.js';
const SVC = 'js/modules/inventory/esb.service.js';

const asli = new Map();
for (const rel of [MIG, M162, SUP, INV, ESB, KES, SVC]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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

const PG = 'tools/test-migrasi-0161.mjs';
const TES = 'tools/test-kesiapan-esb.mjs';
const AUDIT = 'tools/audit-hapus-supplier.cjs';

// ---------------------------------------------------------------
console.log('SABOTASE PENJAGA PENGHAPUSAN:');
// ---------------------------------------------------------------
//
// ============ DIARAHKAN KE 0162, BUKAN 0161 ============
//
// 0162 `create or replace` SELURUH `hapus_supplier`. Jadi merusak versi 0161
// tidak berakibat apa-apa: definisi terakhir yang berlaku, dan tesnya tetap
// hijau untuk sabotase yang mengenai KODE MATI.
//
// Kelima sabotase ini sempat menyasar 0161 dan LOLOS karena itu. Bentuk
// kegagalan yang sudah dikenal di repo ini — harness yang berhenti menguji apa
// pun tanpa bersuara — kali ini muncul lewat jalur baru: bukan polanya yang
// basi, melainkan SASARANNYA yang sudah digantikan migration berikutnya.

sabotase(
  'cek NOTA dibuang — 42 nota kehilangan induknya tanpa satu pun galat',
  M162,
  `  select count(*) into v_nota
    from goods_receipts
   where supplier_id = p_id
     and status = 'aktif';`,
  '  v_nota := 0;',
  PG
);
sabotase(
  'cek ENTRI KAS dibuang — "Kas Operasional" terhapus, form kas menolak nilai yang sudah tersimpan',
  M162,
  `  select count(*) into v_kas
    from cash_entries c
   where coalesce(btrim(c.supplier), '') <> ''
     and c.dicoret_at is null
     and normal_nama_supplier(c.supplier) = normal_nama_supplier(v_nama);`,
  '  v_kas := 0;',
  PG
);
sabotase(
  'kas dicocokkan dengan `=` biasa — ejaan beda satu spasi lolos',
  M162,
  '     and c.dicoret_at is null\n     and normal_nama_supplier(c.supplier) = normal_nama_supplier(v_nama);',
  '     and c.dicoret_at is null\n     and c.supplier = v_nama;',
  PG
);
// Sabotase `btrim <> ''` DIHAPUS dari sini, bukan dipindah pemeriksanya.
//
// Ia LOLOS, dan yang salah adalah klaim saya tentang penjaganya:
// `normal_nama_supplier(null)` memulangkan '' dan tidak pernah cocok dengan
// nama supplier mana pun, jadi mencabut baris itu tidak mengubah satu pun
// hasil. Barisnya tetap dipertahankan di migration sebagai penjaga murah, dan
// `audit-hapus-supplier` tetap memeriksanya — tapi ia tidak disabotase di sini,
// karena sabotase yang tidak mewakili kegagalan nyata cuma melatih orang
// mengabaikan laporan harness ini.
sabotase(
  'wewenang tidak diperiksa — staff bisa menghapus supplier',
  M162,
  '  if not is_bu_admin(auth.uid(), v_bu) then',
  '  if false then',
  PG
);

// ---------------------------------------------------------------
console.log('\nSABOTASE JALUR PINTAS:');
// ---------------------------------------------------------------
//
// Seluruh penjaga di atas cuma SARAN selama ada policy yang mengizinkan
// `delete`. Ini sabotase yang paling mudah terjadi tanpa sengaja: menulis
// ulang policy `for all` "supaya seperti tabel lain".

sabotase(
  'policy `for all` dihidupkan lagi — `DELETE` langsung melewati seluruh pemeriksaannya',
  MIG,
  `create policy suppliers_insert on suppliers
  for insert with check (is_bu_admin(auth.uid(), business_unit_id));`,
  `create policy suppliers_modify on suppliers
  for all using (is_bu_admin(auth.uid(), business_unit_id))
  with check (is_bu_admin(auth.uid(), business_unit_id));`,
  PG
);
sabotase(
  'policy lama tidak di-drop — `for all` tetap hidup berdampingan',
  MIG,
  'drop policy if exists suppliers_modify on suppliers;',
  '-- (dicabut)',
  AUDIT
);
sabotase(
  'layanan memakai `delete` langsung, bukan RPC',
  SVC,
  "  const { error } = await supabase.rpc('hapus_supplier', { p_id: id });",
  "  const { error } = await supabase.from('suppliers').delete().eq('id', id);",
  AUDIT
);

// ---------------------------------------------------------------
console.log('\nSABOTASE KALIMAT PENOLAKAN:');
// ---------------------------------------------------------------

sabotase(
  'kalimatnya berhenti menyebut jalan keluarnya',
  M162,
  'Kalau ini nama kembar, pakai Gabungkan supaya dokumennya pindah ke induk yang benar. Kalau supplier ini memang sudah tidak dipakai lagi, batalkan dulu dokumennya, atau nonaktifkan saja lewat Edit.',
  '',
  PG
);
sabotase(
  'kalimatnya berhenti menyebut jumlahnya',
  M162,
  "'\"%\" masih dipakai % nota dan % entri kas yang AKTIF",
  "'\"%\" masih dipakai nota dan entri kas",
  AUDIT
);
sabotase(
  'layar mengganti pesan database dengan kalimat umum — jumlah & jalan keluarnya hilang',
  SUP,
  "          toast(e.message ?? 'Gagal menghapus supplier.', 'error');",
  "          toast('Gagal menghapus supplier.', 'error');",
  AUDIT
);

// ---------------------------------------------------------------
console.log('\nSABOTASE LAYAR & TAB:');
// ---------------------------------------------------------------

sabotase(
  'tombol Hapus muncul juga untuk supplier yang dipakai — penolakan jadi hal biasa',
  SUP,
  "                     b.jumlah ? '' : `<button class=\"ms-hapus\"",
  '                     true ? `<button class="ms-hapus"',
  AUDIT
);
// ============ JAWABAN KONFIRMASI DIABAIKAN ============
//
// Versi pertama sabotase ini membypass `confirmDialog` dengan `true || (…` —
// yang meninggalkan kurung tak seimbang, jadi berkasnya tidak bisa di-parse
// sama sekali dan audit teksnya tetap hijau. Sabotase yang merusak SINTAKS
// tidak menguji apa yang dikiranya diuji.
//
// Yang nyata: dialognya tetap muncul, jawabannya yang tidak dipatuhi. Menekan
// Batal tetap menghapus — dan itu hanya ketahuan dari orang yang kehilangan
// barisnya.
sabotase(
  'jawaban konfirmasi Hapus diabaikan — menekan Batal tetap menghapus',
  SUP,
  '        if (!yakin) return;',
  '        void yakin;',
  AUDIT
);
sabotase(
  'penjaga wewenang layar hilang — admin outlet melihat tombol yang semuanya ditolak RLS',
  SUP,
  '  if (!(await sayaAdminBu(businessUnitId).catch(() => false))) {',
  '  if (false) {',
  AUDIT
);
sabotase(
  'tab terdaftar tapi tidak dirender — diklik, lalu tidak terjadi apa-apa',
  INV,
  "    if (key === 'supplier') await renderSupplierAdmin(content, { businessUnitId });",
  '    // (dicabut)',
  AUDIT
);
sabotase(
  'tab hilang dari daftar — layarnya ada tapi tidak bisa dicapai siapa pun',
  INV,
  "  { key: 'supplier', label: 'Master Supplier' },",
  '',
  AUDIT
);
sabotase(
  'layar ESB memuat kembali daftar supplier yang tidak dibaca siapa pun',
  ESB,
  // Pola diperbarui: pemuatannya sekarang berbentuk `{ apa, janji }` sejak
  // dibungkus `semuaDenganBatas`. Harness yang polanya basi TIDAK menguji
  // apa pun — ia cuma terlihat menguji.
  "      { apa: 'Outlet pemilik kantong kas', janji: outletKantongKasEsb(businessUnitId).catch(() => []) }",
  "      { apa: 'Outlet pemilik kantong kas', janji: outletKantongKasEsb(businessUnitId).catch(() => []) },\n      { apa: 'X', janji: listSuppliers(businessUnitId, { semua: true }).catch(() => []) }",
  AUDIT
);

// ---------------------------------------------------------------
console.log('\nSABOTASE BANNER KESIAPAN:');
// ---------------------------------------------------------------

// Polanya menyertakan baris barunya supaya hanya mengenai PEMANGGILAN, bukan
// baris definisi `function gambarKesiapan(hitungan) {` yang memuat teks yang
// sama — itulah yang membuat versi pertama audit ini hijau untuk banner yang
// sudah tidak pernah digambar ulang.
sabotase(
  'banner tidak digambar ulang — tetap "8 belum cocok" sesudah kedelapannya dibetulkan',
  ESB,
  '\n    gambarKesiapan(hitungan);',
  '\n    void hitungan;',
  AUDIT
);
sabotase(
  'kelompok pemetaan tidak bertanda jenis — tombol banner tidak punya tujuan',
  ESB,
  '<details ${kurang ? \'open\' : \'\'} data-jenis-peta="${esc(j)}"',
  "<details ${kurang ? 'open' : ''}",
  AUDIT
);
sabotase(
  'tombol banner menggulir ke `<details>` yang tetap tertutup',
  ESB,
  '        d.open = true;',
  '        void d;',
  AUDIT
);
sabotase(
  'banner berhenti memakai hitungan yang sama dengan lencana kelompoknya',
  ESB,
  '      hitungan.push({ jenis: j, label: LABEL_JENIS[j], belum: kurang, total, adaInduk: pilihan.length > 0 });',
  '      hitungan.push({ jenis: j, label: LABEL_JENIS[j], belum: 0, total, adaInduk: true });',
  AUDIT
);
sabotase(
  'dua sebab dilebur — orang disuruh memilih padanan dari daftar yang kosong',
  KES,
  '      sebab: h?.adaInduk === false ? SEBAB.TANPA_INDUK : SEBAB.BELUM_COCOK',
  '      sebab: SEBAB.BELUM_COCOK',
  TES
);
sabotase(
  '`adaInduk` yang tidak disebut ditebak sebagai "belum diimpor"',
  KES,
  '      sebab: h?.adaInduk === false ? SEBAB.TANPA_INDUK : SEBAB.BELUM_COCOK',
  '      sebab: h?.adaInduk ? SEBAB.BELUM_COCOK : SEBAB.TANPA_INDUK',
  TES
);
sabotase(
  'yang terkunci tidak lagi naik ke atas — pekerjaan yang mustahil ditaruh di atas yang bisa',
  KES,
  "    if (a.sebab !== b.sebab) return a.sebab === SEBAB.TANPA_INDUK ? -1 : 1;",
  '    void 0;',
  TES
);
sabotase(
  'angka cacat lolos — "−3 belum cocok" muncul di banner',
  KES,
  '  return Number.isFinite(n) && n > 0 ? n : 0;',
  '  return n;',
  TES
);
sabotase(
  'kalimatnya berhenti menyebut langkah yang harus dikerjakan',
  KES,
  '— impor dulu berkas ESB-nya di langkah 3',
  '',
  AUDIT
);
sabotase(
  'kalimat akibat hilang — peringatannya dibaca sebagai larangan',
  KES,
  "    'Unduhan tidak dihalangi: baris yang memakai kode ini memang sudah tertahan sendiri saat diekspor, ' +",
  "    'Ada yang belum cocok. ' +",
  AUDIT
);

// ---------------------------------------------------------------
console.log('\nSABOTASE 0162 — DOKUMEN YANG DIBATALKAN:');
// ---------------------------------------------------------------

sabotase(
  'hitungan nota berhenti menyaring `aktif` — tombol muncul, lalu ditolak (keluhan aslinya)',
  M162,
  "   where supplier_id = p_id\n     and status = 'aktif';",
  '   where supplier_id = p_id;',
  PG
);
sabotase(
  'hitungan kas berhenti menyaring `dicoret_at` — satu entri yang dicoret menahan selamanya',
  M162,
  '     and c.dicoret_at is null\n',
  '',
  PG
);
sabotase(
  'kalimat penolakan berhenti menyebut jalan keluarnya',
  M162,
  'batalkan dulu dokumennya, atau nonaktifkan saja lewat Edit.',
  'tidak bisa dihapus.',
  AUDIT
);

// ============ YANG PALING HALUS DARI SELURUHNYA ============
//
// Penghapusannya BERHASIL, lalu FK `on delete set null` memicu
// `tautkan_supplier_nota`, dan triggernya MEMBUAT ULANG supplier yang baru saja
// dihapus. Dari layar: tombol Hapus yang ditekan berkali-kali tanpa hasil.
sabotase(
  'trigger membangkitkan kembali supplier yang baru dihapus',
  M162,
  "     and coalesce(new.status, 'aktif') = 'aktif'\n",
  '',
  PG
);

console.log('');
if (gagal === 0) console.log('Semua sabotase hapus supplier & kesiapan ESB tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya tidak menjaga apa yang dikiranya dijaga.`);
process.exit(gagal === 0 ? 0 : 1);
