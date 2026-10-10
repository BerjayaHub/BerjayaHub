/**
 * SABOTASE: master supplier (0158).
 *
 * ============ KENAPA BERKAS INI ADA ============
 *
 * Keluhan yang melahirkan fitur ini berbunyi "supplier barunya tidak muncul
 * lagi" — bukan "aplikasinya error". Tidak ada galat di mana pun; satu daftar
 * saja yang tidak memuat apa yang dikira memuatnya.
 *
 * Seluruh perbaikannya berbentuk hal-hal yang kalau hilang tidak berbunyi
 * apa-apa: satu indeks unik, satu trigger, satu nama tabel di satu panggilan.
 * Itu sebabnya tiap satunya disabotase di sini.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MIG = 'supabase/migrations/0158_master_supplier.sql';
const MURNI = 'js/modules/inventory/master-supplier.js';
const SVC = 'js/modules/inventory/esb.service.js';
const INV = 'js/modules/inventory/inventory.page.js';
const ADM = 'js/modules/inventory/esb.admin.js';
const KAS = 'js/modules/cash/cash.page.js';


const asli = new Map();
for (const rel of [MIG, MURNI, SVC, INV, ADM, KAS]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

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
  // ============ MODE PERIKSA POLA TIDAK MEMULIHKAN APA PUN ============
  //
  // Karena ia tidak pernah merusak apa pun. `fs.writeFileSync` dengan isi yang
  // SAMA tetap sebuah penulisan: berkasnya dipotong lebih dulu, lalu diisi
  // ulang. Proses lain yang kebetulan membacanya pada milidetik itu melihat
  // berkas kosong atau separuh.
  //
  // Itu benar-benar terjadi: `audit-sabotase-terpasang.cjs` menjalankan 53
  // harness sekaligus, ketiganya-puluh-tiga menulis ulang berkasnya saat
  // keluar, dan `audit-import-ekspor.cjs` yang berjalan berbarengan melaporkan
  // "mengimpor REPORTS tapi berkasnya tidak mengekspornya" — untuk berkas yang
  // isinya tidak pernah berubah sedetik pun.
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
  // `String.replace` dengan string hanya mengganti kemunculan PERTAMA.
  if (typeof dari === 'string' && isi.split(dari).length > 2) {
    gagal++;
    console.error(`❌ POLANYA MUNCUL >1 KALI: ${nama} di ${rel} — sabotasenya cuma mengenai yang pertama.`);
    return;
  }
  // ============ MODE PERIKSA POLA ============
  //
  // Dipakai `tools/audit-sabotase-terpasang.cjs`: berhenti TEPAT sesudah pola
  // `dari` dipastikan cocok, sebelum satu berkas pun disentuh.
  //
  // Alasannya satu kejadian nyata: `sabotase-0132.mjs` basi sejak `0142` —
  // tiga polanya tidak cocok lagi dengan kodenya — dan tidak ada yang tahu
  // berbulan-bulan, karena harness sabotase berat (tiap sabotase menjalankan
  // pemeriksanya sendiri) sehingga tidak pernah ikut sweep rutin. Harness yang
  // polanya tidak terpasang TIDAK menguji apa pun, dan ia melaporkannya hanya
  // kalau ada yang menjalankannya.
  //
  // Mode ini tidak menjalankan pemeriksa sama sekali, jadi seluruh 50+ harness
  // bisa disapu dalam hitungan detik.
  if (process.env.SABOTASE_PERIKSA_POLA) {
    console.log(`   \u2714 pola terpasang: ${nama}`);
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

const PG = 'tools/test-migrasi-0158.mjs';
const TES = 'tools/test-master-supplier.mjs';
const AUDIT = 'tools/audit-master-supplier.cjs';

console.log('SABOTASE "SUPPLIER BARUNYA HILANG LAGI":');

sabotase(
  'dropdown nota kembali membaca daftar ESB — keluhan aslinya kembali persis',
  INV,
  '      listSuppliers(businessUnitId).catch(() => []),',
  "      listEsbMaster(businessUnitId, 'supplier').catch(() => []),",
  AUDIT
);
sabotase(
  'dropdown kas kembali membaca daftar ESB',
  KAS,
  '      listSuppliers(businessUnitId).catch(() => []),',
  "      listEsbMaster(businessUnitId, 'supplier').catch(() => []),",
  AUDIT
);
sabotase(
  'penautan diserahkan layar — PWA lama & RPC lama tidak pernah mengisi masternya',
  MIG,
  '  before insert or update on goods_receipts',
  '  after truncate on goods_receipts',
  AUDIT
);
sabotase(
  'trigger berhenti membuat baris master dari teks yang diketik',
  MIG,
  '    new.supplier_id := cari_atau_buat_supplier(new.business_unit_id, new.supplier);',
  '    new.supplier_id := null;',
  PG
);

console.log('\nSABOTASE "DAFTARNYA BERANAK":');

sabotase(
  'indeks unik ternormalkan hilang — tiap spasi ganda melahirkan supplier baru',
  MIG,
  '  on suppliers(business_unit_id, normal_nama_supplier(nama));',
  '  on suppliers(business_unit_id, nama);',
  PG
);
sabotase(
  'dua HP menyimpan bersamaan — yang kedua gagal menyimpan notanya',
  MIG,
  '  on conflict (business_unit_id, normal_nama_supplier(nama)) do nothing\n  returning id into v_id;',
  '  returning id into v_id;',
  AUDIT
);
sabotase(
  'calon kembar memotong di tengah kata — "PT Sari" dan "PT Sarinah" disarankan digabung',
  MURNI,
  "      if (panjang[pendek.length] !== ' ') continue;",
  '      void panjang;',
  TES
);
sabotase(
  'batas panjang minimum hilang — seluruh daftar saling ditandai kembar',
  MURNI,
  '      if (pendek.length < 4) continue;',
  '      if (false) continue;',
  TES
);

console.log('\nSABOTASE "EDIT SEKALI, SEMUA IKUT":');

sabotase(
  'rename tidak disebar — nota lama tetap menyebut nama yang salah',
  MIG,
  '    update goods_receipts set supplier = new.nama where supplier_id = new.id;',
  '    null;',
  PG
);
sabotase(
  'teks nota tidak ditimpa induknya — salinannya boleh menyimpang',
  MIG,
  '    if v_nama is not null then new.supplier := v_nama; end if;',
  '    null;',
  PG
);
sabotase(
  'gabung tidak memindahkan notanya — penggabungan jadi penghapusan data',
  MIG,
  '  update goods_receipts set supplier_id = p_ke where supplier_id = p_dari;',
  '  perform 1;',
  PG
);
sabotase(
  'siapa pun bisa mengubah nama yang dipakai seluruh nota',
  MIG,
  '  if not is_bu_admin(auth.uid(), v_bu) then',
  '  if false then',
  PG
);

console.log('\nSABOTASE LAYAR & LAYANAN:');

sabotase(
  'supplier nonaktif ikut muncul di dropdown — menonaktifkan jadi tidak berarti',
  SVC,
  "    if (!semua) q = q.eq('aktif', true);",
  '    void semua;',
  AUDIT
);
sabotase(
  'verifikasi orang lain dibatalkan diam-diam tiap kali kolom lain disimpan',
  SVC,
  '    p_terverifikasi: terverifikasi === undefined ? null : terverifikasi,',
  '    p_terverifikasi: terverifikasi === true,',
  AUDIT
);
sabotase(
  'layar Master Supplier tidak memuat yang nonaktif — tidak ada jalan mengaktifkannya lagi',
  ADM,
  // Dipanggil DUA kali (muat awal & muat ulang sesudah edit), jadi polanya
  // diikat ke yang di dalam `muatMaster`.
  '    masterSupplier = await listSuppliers(businessUnitId, { semua: true }).catch(() => []);',
  '    masterSupplier = await listSuppliers(businessUnitId).catch(() => []);',
  AUDIT
);
sabotase(
  'nonaktif tidak lagi menang atas "kode kosong" — daftar pekerjaan berisi yang sudah dibatalkan',
  MURNI,
  '  if (s?.aktif === false) return STATUS.NONAKTIF;',
  '  void 0;',
  TES
);

console.log('');
if (gagal === 0) console.log('Semua sabotase master supplier tertangkap. \u2705');
else console.error(`${gagal} sabotase LOLOS — pemeriksanya tidak menjaga apa yang dikiranya dijaga.`);
process.exit(gagal === 0 ? 0 : 1);
