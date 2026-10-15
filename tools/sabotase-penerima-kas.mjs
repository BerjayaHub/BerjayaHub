/**
 * SABOTASE: penerima kas keluar yang bukan supplier (0159).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Keluhan yang melahirkan 0159 bukan sebuah galat. Formnya terbuka lengkap,
 * kolomnya ada, daftarnya terbaca — dan kasir yang membayar uang hadir staff
 * tetap tidak bisa menyelesaikannya, karena tidak ada satu nama pun di daftar
 * itu yang berarti "staff saya". Yang gagal adalah SEBUAH KATA.
 *
 * Seluruh perbaikannya pun berbentuk hal yang kalau hilang tidak berbunyi:
 * satu kata di label, satu `jenis:` di satu pemanggilan (ada atau tidak ada),
 * satu trigger di `business_units`, satu `continue` di pembanding nama. Tiap
 * satunya disabotase di sini, dan yang paling penting adalah SABOTASE
 * SIMETRIS — nota yang berhenti menyaring, dan kas yang mulai menyaring.
 * Keduanya terlihat seperti kerapian, dan keduanya mengembalikan keluhan
 * aslinya atau melahirkan yang baru.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0159_penerima_bukan_supplier.sql';
const MURNI = 'js/modules/inventory/master-supplier.js';
const SK = 'js/modules/cash/supplier-kas.js';
const SVC = 'js/modules/inventory/esb.service.js';
const INV = 'js/modules/inventory/inventory.page.js';
const ADM = 'js/modules/inventory/esb.admin.js';
// Layar Master Supplier pindah ke berkasnya sendiri di 0161.
const SUP = 'js/modules/inventory/supplier.admin.js';
const KAS = 'js/modules/cash/cash.page.js';

const asli = new Map();
for (const rel of [MIG, MURNI, SK, SVC, INV, ADM, KAS, SUP]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  // Mode periksa pola tidak memulihkan apa pun, karena ia tidak pernah
  // merusak apa pun — dan `writeFileSync` dengan isi yang sama tetap sebuah
  // penulisan (potong lalu isi ulang), yang pernah membuat audit lain membaca
  // berkas separuh. Alasan panjangnya di `sabotase-master-supplier.mjs`.
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

const PG = 'tools/test-migrasi-0159.mjs';
const TES_MS = 'tools/test-master-supplier.mjs';
const TES_SK = 'tools/test-supplier-kas.mjs';
const AUDIT = 'tools/audit-penerima-kas.cjs';

// ---------------------------------------------------------------
console.log('SABOTASE SIMETRIS — SARINGAN YANG SALAH ARAH:');
// ---------------------------------------------------------------
//
// Dua sabotase di bawah ini adalah inti berkas ini. Keduanya berbentuk
// perubahan yang terlihat MERAPIKAN: membuat dua pemanggilan `listSuppliers`
// terlihat seragam. Satu mengembalikan keluhan aslinya; satu melahirkan
// keluhan baru yang baru ketahuan berbulan-bulan kemudian.

sabotase(
  'form kas MULAI menyaring jenis — keluhan aslinya kembali utuh, tanpa galat',
  KAS,
  '      listSuppliers(businessUnitId).catch(() => []),',
  "      listSuppliers(businessUnitId, { jenis: 'supplier' }).catch(() => []),",
  AUDIT
);
sabotase(
  'dropdown nota BERHENTI menyaring — "Kas Operasional" jadi pilihan supplier bahan',
  INV,
  "      listSuppliers(businessUnitId, { jenis: 'supplier' }).catch(() => []),",
  '      listSuppliers(businessUnitId).catch(() => []),',
  AUDIT
);
sabotase(
  '`jenis` diterima tapi tidak dipakai menyaring — pemanggil mengira sudah menyaring',
  SVC,
  // DIIKAT ke baris `aktif` di atasnya: `q.eq('jenis', jenis)` juga ada di
  // `listEsbMaster`, dan sabotase yang mengenai fungsi yang salah menguji
  // fungsi yang salah.
  "    if (!semua) q = q.eq('aktif', true);\n    if (jenis) q = q.eq('jenis', jenis);",
  "    if (!semua) q = q.eq('aktif', true);\n    void jenis;",
  AUDIT
);
sabotase(
  'kolom `jenis` tidak diambil — kolom yang tidak diminta terbaca "tidak ada", bukan galat',
  SVC,
  "      .select('id, nama, jenis, esb_kode",
  "      .select('id, nama, esb_kode",
  AUDIT
);

// ---------------------------------------------------------------
console.log('\nSABOTASE "SEBUAH KATA":');
// ---------------------------------------------------------------

sabotase(
  'label balik jadi "Supplier" — kolomnya benar, daftarnya benar, kasirnya tetap berhenti',
  SK,
  "export const LABEL_PENERIMA = 'Dibayarkan ke';",
  "export const LABEL_PENERIMA = 'Dibayar ke (supplier)';",
  AUDIT
);
sabotase(
  'pesan penolakannya berhenti menyebut jalan keluarnya',
  SK,
  '  \'Pembayaran yang bukan ke supplier (mis. uang hadir staff) pilih penerima internal seperti "Kas Operasional".\';',
  "  '';",
  AUDIT
);
sabotase(
  'satu dari dua form kas kembali memakai label lama',
  KAS,
  '                      label: LABEL_PENERIMA,',
  "                      label: 'Dibayar ke (supplier)',",
  AUDIT
);
sabotase(
  'keterangan "penerima internal" hilang — orang mencari alamat yang tidak akan pernah ada',
  MURNI,
  "  if (s?.jenis === 'internal') return 'penerima internal — bukan supplier';",
  '  void 0;',
  TES_MS
);

// ---------------------------------------------------------------
console.log('\nSABOTASE "SATU KETUKAN YANG MERAPIKAN DAFTAR":');
// ---------------------------------------------------------------

sabotase(
  'jenis berbeda ditawari Gabungkan — penerima internal bisa dibubarkan se-BU',
  MURNI,
  '      if (jenisSupplier(daftar[i]) !== jenisSupplier(daftar[j])) continue;',
  '      void 0;',
  TES_MS
);
sabotase(
  'baris tanpa `jenis` terbaca `undefined` — hilang dari KEDUA saringan sekaligus',
  MURNI,
  '  return s?.jenis === JENIS.INTERNAL ? JENIS.INTERNAL : JENIS.SUPPLIER;',
  '  return s?.jenis;',
  TES_MS
);

// ---------------------------------------------------------------
console.log('\nSABOTASE DATABASE:');
// ---------------------------------------------------------------

sabotase(
  'trigger seed `business_units` dibuang — BU berikutnya lahir tanpa penerima internal',
  MIG,
  '  after insert on business_units',
  '  after truncate on business_units',
  AUDIT
);
sabotase(
  'BU baru tidak diseed — keluhannya muncul lagi di tempat yang tidak dicurigai',
  MIG,
  "  values (new.id, 'Kas Operasional', 'internal', true)",
  "  values (new.id, 'Kas Operasional', 'internal', true) where false",
  PG
);
// ============ KEDUA PENCARIANNYA, BUKAN CUMA YANG PERTAMA ============
//
// Versi pertama sabotase ini hanya menyaring pencarian PERTAMA, dan ia LOLOS —
// bukan karena tesnya lemah, tapi karena `cari_atau_buat_supplier` memang lebih
// tahan dari yang saya kira: `insert`-nya ditolak indeks unik, `on conflict do
// nothing` menelannya, lalu pencarian CADANGAN (yang tidak tersaring) menemukan
// baris internalnya dan memulangkannya. Hasilnya benar, cuma lewat jalan yang
// lebih panjang.
//
// Jadi yang perlu disabotase adalah keadaan di mana kedua pencariannya
// tersaring — dan DI SITU `supplier_id`-nya benar-benar pulang NULL, tanpa
// galat ke mana pun. Harness ini yang memberi tahu, bukan pembacaan ulang.
sabotase(
  'KEDUA pencarian disaring jenis — nota menyebut nama internal, `supplier_id`-nya NULL diam-diam',
  MIG,
  '   where business_unit_id = p_bu\n     and normal_nama_supplier(nama) = normal_nama_supplier(v_nama);\n  if v_id is not null then return v_id; end if;',
  "   where jenis = 'supplier' and business_unit_id = p_bu\n     and normal_nama_supplier(nama) = normal_nama_supplier(v_nama);\n  if v_id is not null then return v_id; end if;\n  if v_nama is not null then return null; end if;",
  PG
);
sabotase(
  'bawaan kolomnya bukan `supplier` — seluruh supplier yang ada berubah jenis sekaligus',
  MIG,
  "  add column if not exists jenis text not null default 'supplier'",
  "  add column if not exists jenis text not null default 'internal'",
  AUDIT
);
sabotase(
  '`ubah_supplier` lama dibiarkan hidup — PostgREST memanggil yang salah, tanpa galat',
  MIG,
  'drop function if exists ubah_supplier(',
  'drop function if exists tidak_ada_fungsi_ini(',
  AUDIT
);
sabotase(
  '`check` jenis hilang — salah ketik tersimpan, barisnya tidak muncul di layar mana pun',
  MIG,
  "  add constraint suppliers_jenis_check check (jenis in ('supplier', 'internal'));",
  '  add constraint suppliers_jenis_check check (true);',
  AUDIT
);

// ---------------------------------------------------------------
console.log('\nSABOTASE LAYAR ADMIN:');
// ---------------------------------------------------------------

sabotase(
  'tombol "+ Tambah penerima" tidak menyimpan apa pun — internal tidak pernah lahir dari nota',
  SUP,
  '        await tambahSupplier(businessUnitId, v.nama, v.jenis);',
  '        await Promise.resolve();',
  AUDIT
);
sabotase(
  'dialog Edit berhenti mengirim `jenis` — salah jenis tidak bisa dibetulkan dari mana pun',
  SUP,
  '            jenis: v.jenis\n          });',
  '          });',
  AUDIT
);
sabotase(
  'saringan Jenis hilang — satu penerima internal tak bisa ditemukan di daftar empat puluh baris',
  SUP,
  '             <select id="ms-saring-jenis" style="flex:0 1 150px">',
  '             <select id="ms-saring-lain" style="flex:0 1 150px">',
  AUDIT
);

// ---------------------------------------------------------------
console.log('\nSABOTASE ATURAN MURNI KAS:');
// ---------------------------------------------------------------

sabotase(
  'penerima internal ditolak sebagai "di luar daftar" — tepat kasus yang 0159 lahir untuk melayani',
  SK,
  '  const ada = daftarInduk.some((m) => normalNama(teks(m?.nama)) === normalNama(v));',
  "  const ada = daftarInduk.some((m) => m?.jenis !== 'internal' && normalNama(teks(m?.nama)) === normalNama(v));",
  TES_SK
);

console.log('');
if (gagal === 0) console.log('Semua sabotase penerima kas tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya tidak menjaga apa yang dikiranya dijaga.`);
process.exit(gagal === 0 ? 0 : 1);
