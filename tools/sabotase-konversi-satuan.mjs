/**
 * SABOTASE: ekspor ESB dalam satuan beli.
 *
 * Yang paling dijaga: Unit, Qty, dan Price ketiganya datang dari konversi yang
 * SAMA. Mengonversi sebagiannya menghasilkan berkas yang DITERIMA ESB dengan
 * nilai rupiah yang salah — dan kesalahan yang diterima jauh lebih mahal
 * daripada kesalahan yang ditolak.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = (rel) => path.join(AKAR, rel);

const MURNI = 'js/modules/inventory/konversi-satuan.js';
const PUR = 'js/modules/inventory/esb-purchase.js';
const ADM = 'js/modules/inventory/esb.admin.js';
const SVC = 'js/modules/inventory/esb.service.js';

const asli = new Map();
for (const rel of [MURNI, PUR, ADM, SVC]) asli.set(rel, fs.readFileSync(P(rel), 'utf8'));

// ============ JEJAK "SABOTASE SEDANG TERPASANG" ============
//
// `process.on('exit')` TIDAK berjalan kalau prosesnya di-SIGKILL — mis. saat
// harness ini kena batas waktu di luar. Yang tertinggal adalah berkas repo
// yang masih tersabotase, dan ia TIDAK terlihat sebagai apa pun: migration-nya
// tetap sah, aplikasinya tetap jalan, dan satu-satunya tanda adalah satu tes
// yang merah entah kenapa berjam-jam kemudian.
//
// Itu benar-benar terjadi: `0153` tertinggal dengan `if false then` di tempat
// penjaga "kas keluar harus menyebut outlet peruntukannya".
//
// Jadi penanda ini ditulis SEBELUM berkas pertama dirusak dan dibuang sesudah
// semuanya pulih. `tools/audit-sisa-sabotase.cjs` berteriak kalau ia tertinggal.
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
    console.error(`❌ PEMERIKSANYA TIDAK ADA: ${pemeriksa}`);
    return;
  }
  const isi = asli.get(rel);
  const rusak = isi.replace(dari, ke);
  if (rusak === isi) {
    gagal++;
    console.error(`❌ SABOTASE TIDAK TERPASANG: ${nama} — polanya tidak ketemu di ${rel}.`);
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

const TES = 'tools/test-konversi-satuan.mjs';
const AUDIT = 'tools/audit-konversi-satuan.cjs';

console.log('SABOTASE SETENGAH KONVERSI — yang DITERIMA ESB dengan nilai salah:');

sabotase(
  'qty dikonversi, harga tidak — 3 PACK @Rp40 = Rp120 untuk barang seharga Rp12.000',
  PUR,
  '      const perSatuan = bulatkanHarga(konv.harga);',
  '      const perSatuan = bulatkanHarga(angka(it.unit_cost));',
  TES
);
sabotase(
  'harga dikonversi, qty tidak — 300 PACK @Rp4.000 = Rp1,2 juta',
  PUR,
  '        konv.qty ?? 0,',
  '        angka(it.qty) ?? 0,',
  TES
);
sabotase(
  'satuannya tidak ikut dikonversi — angkanya per pack, labelnya tetap pcs',
  PUR,
  '      const unit = padanan(peta.unit, konv.unitLokal);',
  '      const unit = padanan(peta.unit, it.base_unit);',
  TES
);
sabotase(
  'konversinya dihitung lalu dibuang seluruhnya',
  PUR,
  '      const konv = keSatuanBeli(it, it);',
  "      const konv = { unitLokal: it.base_unit, qty: it.qty, harga: it.unit_cost, dikonversi: false, isi: null };",
  TES
);

console.log('\nSABOTASE ATURAN KONVERSI:');

sabotase(
  'pengalinya diambil dari kolom Qty ESB — yang terbalik pada 234 dari 647 produk',
  MURNI,
  '  const isi = angka(produk?.purchase_qty);',
  '  const isi = angka(produk?.esb_qty);',
  AUDIT
);
sabotase(
  'qty dibulatkan ke pack terdekat — 100 pcs berangkat sebagai 124 pcs',
  MURNI,
  '  const qtyPenuh = qtyKecil === null ? null : qtyKecil / isi;',
  '  const qtyPenuh = qtyKecil === null ? null : Math.round(qtyKecil / isi);',
  TES
);
sabotase(
  'harga dihitung dari unit_cost × isi — galat pembulatan ditumpuk dua kali',
  MURNI,
  '      ? total / qtyBeli',
  '      ? hargaKecil * isi',
  TES
);

console.log('\nSABOTASE BATAS DESIMAL QTY:');

sabotase(
  'batas desimal qty dilonggarkan jadi 6 — ESB menolak "qty cannot have more than 4 decimal places"',
  MURNI,
  // Angkanya pindah ke `desimal-esb.js`; yang dirusak di sini penurunannya.
  'export const DESIMAL_QTY_MAKS = DESIMAL_ESB_MAKS;',
  'export const DESIMAL_QTY_MAKS = 6;',
  TES
);
// Urutannya, dan inilah setengah kedua dari perbaikannya.
sabotase(
  'harga dihitung dari qty PENUH lalu qty-nya dipotong belakangan — Qty × Price meleset dari total nota',
  MURNI,
  '  const qtyBeli = bulat(qtyPenuh, DESIMAL_QTY_MAKS);',
  '  const qtyBeli = qtyPenuh;',
  TES
);
sabotase(
  'qty tidak dibulatkan sama sekali — 1,6129032258064515 berangkat apa adanya',
  MURNI,
  '  const qtyBeli = bulat(qtyPenuh, DESIMAL_QTY_MAKS);',
  '  const qtyBeli = qtyPenuh === null ? null : Number(qtyPenuh);',
  TES
);
sabotase(
  'qty yang membulat jadi NOL tetap berangkat — ESB mencatat barang yang tidak pernah datang',
  MURNI,
  '  if (qtyBeli === 0 && qtyPenuh !== null && qtyPenuh !== 0) {',
  '  if (false) {',
  TES
);
sabotase(
  'isi nol & kosong tidak disaring — qty dibagi nol',
  MURNI,
  '  if (!unitBeli || isi === null || isi <= 0 || isi === 1) {',
  '  if (!unitBeli) {',
  TES
);
// Diperiksa AUDIT, bukan TES, dan alasannya jujur: penjaga `isi <= 0` di
// sebelahnya menangkap akibatnya, jadi tidak ada keluaran yang berubah hari
// ini. Penjaga ini tetap dijaga karena keduanya bisa dicabut satu per satu —
// dan `Number('') === 0` sudah menggigit di modul lain di proyek ini.
sabotase(
  "Number('') yang bernilai 0 lolos jadi pengali — lapis kedua di balik penjaga isi <= 0",
  MURNI,
  "  if (v === null || v === undefined || v === '') return null;",
  '  if (v === undefined) return null;',
  AUDIT
);
sabotase(
  'satuan beli yang sama dengan satuan kecil ikut dikonversi — "1 pcs = 30 pcs"',
  MURNI,
  '  if (unitKecil && unitBeli.toLowerCase() === unitKecil.toLowerCase()) {',
  '  if (false) {',
  TES
);
sabotase(
  'produk TANPA satuan beli ikut dikonversi — nota eceran mendadak berubah angkanya',
  MURNI,
  '  if (!unitBeli || isi === null',
  '  if (isi === null',
  TES
);

console.log('\nSABOTASE JALAN BUNTU DI LAYAR:');

// Kemampuannya ada, jalannya tidak ada di layar — pola yang sudah beberapa kali
// muncul di proyek ini, dan di sini bentuknya paling halus: notanya tertahan
// dengan alasan yang benar, di layar yang tidak punya barisnya.
sabotase(
  'daftar pemetaan Unit kembali berisi satuan kecil saja — setiap nota tertahan tanpa baris untuk memperbaikinya',
  ADM,
  '    unit: satuanPerluDipetakan(produk),',
  "    unit: [...new Set(produk.map((p) => p.base_unit).filter(Boolean))].sort(),",
  AUDIT
);
sabotase(
  'satuan beli dicabut dari daftar pemetaan',
  MURNI,
  '    if (beli && isi !== null && isi > 1 && beli.toLowerCase() !== kecil.toLowerCase()) keluar.add(beli);',
  '    void beli;',
  TES
);
sabotase(
  'satuan kecil dicabut dari daftar pemetaan — produk eceran tidak bisa dipetakan lagi',
  MURNI,
  '    if (kecil) keluar.add(kecil);',
  '    void kecil;',
  TES
);
sabotase(
  'alasan unit tak terpetakan menyebut satuan kecil — orangnya mencari baris yang tidak bermasalah',
  PUR,
  "        catat('unit', konv.unitLokal, kode);",
  "        catat('unit', it.base_unit, kode);",
  TES
);

console.log('\nSABOTASE SUMBER DATA:');

sabotase(
  'purchase_unit & purchase_qty tidak ikut diambil — konversinya diam-diam berhenti jalan',
  SVC,
  'products(name, base_unit, purchase_unit, purchase_qty)',
  'products(name, base_unit)',
  AUDIT
);
sabotase(
  'keduanya diambil tapi tidak diteruskan ke baris item',
  SVC,
  "      purchase_unit: it.products?.purchase_unit ?? '',\n      purchase_qty: it.products?.purchase_qty ?? null,\n",
  '',
  AUDIT
);

console.log('');
if (gagal === 0) console.log('Semua sabotase konversi satuan tertangkap. ✅');
else console.error(`${gagal} sabotase LOLOS.`);
process.exit(gagal === 0 ? 0 : 1);
