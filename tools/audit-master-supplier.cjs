/**
 * AUDIT: master supplier (0158).
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   dropdown kembali ke esb_master -> keluhan aslinya kembali persis: supplier
 *                                     yang diketik staff hilang pada nota
 *                                     berikutnya
 *   penautan diserahkan layar      -> PWA lama & RPC `simpan_nota` lama
 *                                     menghasilkan nota tanpa supplier_id, dan
 *                                     masternya tetap tidak pernah terisi
 *   indeks unik ternormalkan hilang-> "Toko Berkah" dan "toko  berkah" jadi dua
 *                                     baris; daftar beranak tiap kali ada yang
 *                                     menekan spasi dua kali
 *   teks nota tidak ditimpa induk  -> salinan menyimpang dari sumbernya, dan
 *                                     nama yang sudah dibetulkan tetap salah di
 *                                     ekspor & laporan
 *   rename tidak disebar           -> "edit sekali, semua ikut" cuma berlaku
 *                                     untuk dropdown; nota lama tetap lama
 *   gabung dihapus                 -> daftar master beranak sendiri dan dalam
 *                                     hitungan minggu tidak ada gunanya dibaca
 *   `on conflict` dibuang          -> dua HP menyimpan nota bersupplier baru
 *                                     yang sama pada detik yang sama, dan yang
 *                                     kedua GAGAL menyimpan notanya
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar, periksaKewarasan } = require('./lib/tanpa-komentar.cjs');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const baca = (rel) => {
  const p = path.join(AKAR, rel);
  if (!fs.existsSync(p)) {
    salah(`${rel} tidak ada — audit ini kehilangan sasarannya.`);
    return null;
  }
  return fs.readFileSync(p, 'utf8');
};
const bersih = (isi, rel, penanda) => {
  const kode = tanpaKomentar(isi);
  const pesan = periksaKewarasan(isi, kode, penanda);
  if (pesan) salah(`${rel}: ${pesan}`);
  return kode;
};

/** Buang komentar `--` SQL, kecuali yang di dalam string literal. */
const tanpaSqlKomentar = (sql) =>
  sql
    .split('\n')
    .map((baris) => {
      let petik = 0;
      for (let i = 0; i < baris.length; i++) {
        if (baris[i] === "'") petik++;
        else if (baris[i] === '-' && baris[i + 1] === '-' && petik % 2 === 0) return baris.slice(0, i);
      }
      return baris;
    })
    .join('\n');

// ---------------------------------------------------------------
// 1. MIGRATION 0158.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0158_master_supplier.sql');
if (mig) {
  const kode = tanpaSqlKomentar(mig);
  if (!/create table if not exists suppliers/.test(kode)) {
    salah('audit-master-supplier: penyaring komentar SQL ikut memakan kodenya — pemeriksaan di bawah tidak bisa dipercaya.');
  }
  if (/KENAPA IA HILANG/.test(kode)) {
    salah('audit-master-supplier: komentar SQL tidak tersaring — pemeriksaan di bawah bisa hijau karena kalimat penjelasnya.');
  }

  // ============ SATU BARIS PER NAMA ============
  if (!/create unique index if not exists suppliers_nama_uk\s*\n\s*on suppliers\(business_unit_id, normal_nama_supplier\(nama\)\);/.test(kode)) {
    salah(
      '0158: indeks unik ternormalkan hilang. Tanpa itu "Toko Berkah" dan "toko  berkah" jadi dua baris — dan karena ' +
        'supplier sekarang lahir dari ketikan, daftarnya beranak tiap kali ada yang menekan spasi dua kali.'
    );
  }
  if (!/^create or replace function normal_nama_supplier/m.test(kode) || !/immutable/.test(kode)) {
    salah('0158: `normal_nama_supplier` hilang atau bukan `immutable` — indeks uniknya tidak bisa dibuat sama sekali.');
  }

  // ============ PENAUTAN DI DATABASE ============
  if (!/before insert or update on goods_receipts/.test(kode)) {
    salah(
      '0158: penautan supplier bukan lagi trigger. PWA lama di HP staff dan RPC `simpan_nota` lama hanya mengirim ' +
        'teks — kalau penautannya diserahkan layar, nota dari sana tidak pernah punya supplier_id, dan masternya ' +
        'tetap tidak terisi. Itu keluhan aslinya, persis.'
    );
  }
  if (!/new\.supplier_id := cari_atau_buat_supplier\(new\.business_unit_id, new\.supplier\)/.test(kode)) {
    salah('0158: trigger-nya tidak lagi membuat baris master dari teks yang diketik.');
  }
  // Teks notanya DITIMPA dari induknya — itu yang membuat salinannya tidak
  // bisa menyimpang, bahkan dari klien yang mengirim keduanya sekaligus.
  if (!/if v_nama is not null then new\.supplier := v_nama; end if;/.test(kode)) {
    salah(
      '0158: kolom teks `goods_receipts.supplier` tidak lagi ditimpa dari induknya. Ia salinan — dan salinan yang ' +
        'boleh ditulis klien akan menyimpang dari sumbernya, lalu nama yang sudah dibetulkan tetap salah di ekspor.'
    );
  }
  if (!/update goods_receipts set supplier = new\.nama where supplier_id = new\.id;/.test(kode)) {
    salah(
      '0158: rename supplier tidak lagi disebar ke notanya. "Edit sekali, semua ikut" jadi cuma berlaku untuk ' +
        'dropdown — nota lama, laporan, dan ekspor tetap menyebut nama yang salah.'
    );
  }

  // ============ DUA HP MENYIMPAN BERSAMAAN ============
  // Diikat ke BLOK `cari_atau_buat_supplier`, bukan dicari lepas: dua `insert`
  // backfill di bawah memakai klausa `on conflict` yang sama persis, jadi
  // mencabutnya dari fungsi ini tetap menyisakan dua kemunculan yang membuat
  // pencarian lepas hijau.
  const iCari = kode.indexOf('create or replace function cari_atau_buat_supplier');
  const blokCari = iCari >= 0 ? kode.slice(iCari, kode.indexOf('$$;', iCari)) : '';
  if (!blokCari) {
    salah('0158: `cari_atau_buat_supplier` hilang — tidak ada lagi satu pintu yang membuat baris master.');
  } else if (!/on conflict \(business_unit_id, normal_nama_supplier\(nama\)\) do nothing/.test(blokCari)) {
    salah(
      '0158 `cari_atau_buat_supplier`: tabrakan nama tidak lagi ditelan. Dua staff yang menyimpan nota bersupplier ' +
        'baru yang sama pada detik yang sama membuat yang kedua GAGAL — dan notanya ikut gagal, padahal barangnya ' +
        'sudah ada di gudang.'
    );
  }

  // ============ ADMIN ============
  for (const [f, pesan] of [
    ['ubah_supplier', 'betulkan nama / kode ESB'],
    ['gabung_supplier', 'gabungkan supplier kembar']
  ]) {
    if (!new RegExp(`create or replace function ${f}`).test(kode)) salah(`0158: fungsi \`${f}\` (${pesan}) hilang.`);
    if (!new RegExp(`grant execute on function ${f}`).test(kode)) salah(`0158: \`${f}\` tidak di-grant ke authenticated.`);
  }
  if (!/is_bu_admin\(auth\.uid\(\), v_bu\)/.test(kode)) {
    salah('0158: `ubah_supplier` tidak lagi menuntut Admin BU — siapa pun bisa mengubah nama yang dipakai seluruh nota.');
  }
  if (!/update goods_receipts set supplier_id = p_ke where supplier_id = p_dari;/.test(kode)) {
    salah('0158 `gabung_supplier`: notanya tidak dipindahkan — penggabungan yang meninggalkan notanya menghapus datanya.');
  }
  // Galat bentrok menyebut jalan keluarnya.
  if (!/pakai Gabungkan/i.test(mig)) {
    salah('0158: galat bentrok nama tidak menyebut Gabungkan — orangnya dikirim mencari sendiri fitur yang ada di layar yang sama.');
  }
  // RLS: staff boleh BACA (dropdown), hanya admin yang boleh menulis langsung.
  if (!/create policy suppliers_select on suppliers\s*\n\s*for select using \(has_bu_scope/.test(kode)) {
    salah('0158: staff tidak bisa membaca `suppliers` — dropdown-nya kosong untuk semua orang kecuali admin.');
  }
  if (!/drop policy if exists suppliers_select on suppliers;/.test(kode)) {
    salah('0158: policy-nya tidak di-`drop ... if exists` dulu — menjalankan berkas ini dua kali berhenti di tengah.');
  }
}

// ---------------------------------------------------------------
// 2. MODUL MURNI.
// ---------------------------------------------------------------
const modul = baca('js/modules/inventory/master-supplier.js');
if (modul) {
  const kode = bersih(modul, 'master-supplier.js', ['export function susunMasterSupplier', 'export function calonKembar']);
  const impor = (kode.match(/^import .*$/gm) ?? []).filter((b) => !/cocok-supplier\.js/.test(b));
  if (impor.length) salah(`master-supplier.js: ada impor di luar cocok-supplier.js (${impor.join(' | ')}) — harus bisa diuji tanpa browser.`);

  // Nonaktif diperiksa DULU.
  if (!/if \(s\?\.aktif === false\) return STATUS\.NONAKTIF;/.test(kode)) {
    salah(
      'master-supplier.js `statusSupplier`: nonaktif tidak lagi diperiksa lebih dulu. Supplier yang sudah dibatalkan ' +
        'akan muncul sebagai pekerjaan ("kode ESB kosong") yang tidak akan pernah dikerjakan siapa pun.'
    );
  }
  // Kembar: batas kata & panjang minimum.
  if (!/if \(panjang\[pendek\.length\] !== ' '\) continue;/.test(kode)) {
    salah(
      'master-supplier.js `calonKembar`: pemisahnya bukan lagi batas kata. "PT Sari" dan "PT Sarinah" akan ditandai ' +
        'kembar — dan menggabungkannya memindahkan nota ke supplier yang salah.'
    );
  }
  if (!/if \(pendek\.length < 4\) continue;/.test(kode)) {
    salah('master-supplier.js `calonKembar`: batas panjang minimum hilang — "CV" jadi awalan hampir semua nama dan seluruh daftar saling ditandai.');
  }
}

// ---------------------------------------------------------------
// 3. DROPDOWN TIDAK BOLEH KEMBALI KE `esb_master`.
// ---------------------------------------------------------------
for (const rel of [
  'js/modules/inventory/inventory.page.js',
  'js/modules/cash/cash.page.js',
  'js/modules/cash/cash.admin.page.js'
]) {
  const isi = baca(rel);
  if (!isi) continue;
  const kode = tanpaKomentar(isi);
  if (/listEsbMaster\([^)]*'supplier'\)/.test(kode)) {
    salah(
      `${rel}: dropdown supplier kembali membaca \`esb_master\`. Itu salinan daftar ESB — supplier yang diketik staff ` +
        'tidak ada di sana, dan keluhan aslinya kembali persis: namanya hilang pada nota berikutnya.'
    );
  }
  if (!/listSuppliers\(/.test(kode)) {
    salah(`${rel}: tidak memanggil \`listSuppliers\` — daftar suppliernya tidak diisi dari mana pun.`);
  }
}

const svc = baca('js/modules/inventory/esb.service.js');
if (svc) {
  const kode = bersih(svc, 'esb.service.js', ['export async function listSuppliers']);
  for (const f of ['listSuppliers', 'ubahSupplier', 'gabungSupplier']) {
    if (!new RegExp(`export async function ${f}`).test(kode)) salah(`esb.service.js: \`${f}\` hilang.`);
  }
  // Bawaannya hanya yang aktif.
  if (!/if \(!semua\) q = q\.eq\('aktif', true\);/.test(kode)) {
    salah('esb.service.js `listSuppliers`: supplier nonaktif ikut muncul di dropdown — menonaktifkan jadi tidak berarti apa-apa.');
  }
  // `null` berarti "jangan ubah", BUKAN `false`.
  if (!/p_terverifikasi: terverifikasi === undefined \? null : terverifikasi/.test(kode)) {
    salah(
      'esb.service.js `ubahSupplier`: `terverifikasi` yang tidak disentuh dikirim sebagai `false`, bukan `null`. ' +
        'Itu membatalkan verifikasi orang lain diam-diam setiap kali ada yang menyimpan kolom lain.'
    );
  }
}

const adm = baca('js/modules/inventory/esb.admin.js');
if (adm) {
  const kode = bersih(adm, 'esb.admin.js', ['gambarMasterSupplier']);
  // DIHITUNG, bukan dicari. Dipanggil dua kali — saat layar dimuat, dan saat
  // dimuat ulang sesudah Edit/Gabung. Mencabut salah satunya menyisakan yang
  // lain, dan daftarnya diam-diam kehilangan baris nonaktif sesudah tiap edit.
  const muatSemua = (kode.match(/listSuppliers\(businessUnitId, \{ semua: true \}\)/g) ?? []).length;
  if (muatSemua < 2) {
    salah(
      `esb.admin.js: hanya ${muatSemua} dari 2 pemuatan Master Supplier yang membawa yang nonaktif (muat awal & muat ` +
        'ulang sesudah edit). Yang tidak membawanya membuat supplier yang dinonaktifkan lenyap dari layar — dan tidak ' +
        'akan pernah bisa diaktifkan kembali.'
    );
  }
  for (const [pola, apa] of [
    [/ubahSupplier\(b\.id/, 'aksi Edit'],
    [/gabungSupplier\(b\.id, v\.ke\)/, 'aksi Gabungkan']
  ]) {
    if (!pola.test(kode)) salah(`esb.admin.js: ${apa} hilang dari layar Master Supplier.`);
  }
}

console.log('');
if (gagal === 0) console.log('Audit master supplier bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
