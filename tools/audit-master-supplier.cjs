/**
 * AUDIT: supplier punya daftar pasti, dan daftarnya datang dari ESB.
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   ejaan yang DIKETIK ikut terkirim  -> "toko beras ridho" berangkat ke ESB
 *                                        apa adanya. Bagi ESB itu bukan nama
 *                                        yang sama, dan berkasnya ditolak di
 *                                        layar yang berbeda
 *   supplier tak dikenal lolos        -> persis keadaan sebelum ini: nama apa
 *                                        pun berangkat, ditolak jauh belakangan
 *   daftar kosong menahan SEMUANYA    -> BU yang belum sempat mengimpor daftar
 *                                        mendadak kehilangan seluruh notanya,
 *                                        karena aturan baru yang dinyalakan
 *   staff dipaksa memilih dari daftar -> pembelian mendadak jam 9 malam tidak
 *                                        bisa dicatat sama sekali
 *   dua aturan normalisasi            -> "AB  Sentul" cocok di satu jalur dan
 *                                        tidak di jalur lain, dan tidak ada
 *                                        layar yang bisa menunjukkan bedanya
 *   nama nota ditulis ulang           -> jejak apa yang DULU diketik hilang,
 *                                        dan tidak bisa dikembalikan
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

const JENIS_LAMA = ['branch', 'location', 'unit', 'item', 'payment_method', 'coa'];

// ---------------------------------------------------------------
// 1. Migration 0144.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0144_master_supplier_esb.sql');
if (mig) {
  for (const t of ['esb_master', 'esb_map']) {
    const i = mig.indexOf(`alter table ${t}\n  add constraint`);
    const blok = i < 0 ? '' : mig.slice(i, mig.indexOf(';', i));
    if (!blok) {
      salah(`0144: constraint jenis ${t} tidak dibuat ulang.`);
      continue;
    }
    if (!/'supplier'/.test(blok)) salah(`0144: ${t} tidak menerima jenis 'supplier'.`);
    // Memperlebar `check` berarti MENGETIK ULANG seluruh daftarnya — dan itu
    // cara paling mudah menghapus satu jenis tanpa sadar. Keenamnya disebut.
    for (const j of JENIS_LAMA) {
      if (!new RegExp(`'${j}'`).test(blok)) {
        salah(`0144: jenis '${j}' HILANG dari check ${t}. Memperlebar check berarti menulis ulang daftarnya, dan satu yang tertinggal menutup seluruh pemetaan jenis itu.`);
      }
    }
  }
  // Nama constraint lamanya DICARI di katalog, bukan ditebak — DI KEDUA blok.
  //
  // Versi pertama audit ini cuma menanyakan "apakah polanya ada", dan sabotase
  // yang merusak blok PERTAMA lolos: blok kedua masih memuat kalimat yang sama,
  // jadi polanya tetap ketemu. `String.replace` mengganti kemunculan pertama
  // saja, dan pemeriksaan "ada atau tidak" buta terhadap itu. Jebakan yang sama
  // sudah beberapa kali menggigit di proyek ini — sekarang jumlahnya dihitung.
  const nCari = (mig.match(/select conname into v_nama from pg_constraint/g) ?? []).length;
  if (nCari < 2) {
    salah(
      `0144: nama constraint lama dicari di katalog hanya di ${nCari} dari 2 blok. Yang lain menebaknya — dan ` +
        '`drop constraint` dengan nama yang salah menggagalkan migration di tengah jalan, sesudah sebagian sudah berubah.'
    );
  }
  // STAFF HARUS BISA MEMBACA. Ini yang membuat fiturnya berguna bagi orang
  // yang dituju — dan kegagalannya paling diam dari semuanya: RLS yang menolak
  // SELECT tidak melempar galat, ia mengembalikan nol baris, lalu layar nota
  // menyimpulkan "daftarnya belum diimpor" dan kembali ke kotak teks bebas.
  // Admin yang mengujinya sendiri melihat dropdown yang berfungsi.
  if (!/create policy esb_master_baca_anggota on esb_master\s+for select to authenticated\s+using \(has_bu_scope\(auth\.uid\(\), business_unit_id\)\)/.test(mig)) {
    salah(
      '0144: staff tidak diberi izin MEMBACA `esb_master`. Kebijakan 0127 adalah `for all` dengan syarat is_bu_admin — ' +
        'ia menutup SELECT juga, jadi dropdown supplier akan selalu kosong di layar staff, tanpa satu pun error.'
    );
  }
  // ...tapi hanya SELECT. Daftar induk tetap keputusan administratif.
  if (/create policy esb_master_baca_anggota[\s\S]{0,120}for all/.test(mig)) {
    salah('0144: izin baca untuk anggota BU ternyata `for all` — staff jadi bisa mengubah daftar induknya sendiri.');
  }
  if (/create policy [a-z_]+ on esb_map\s+for select/.test(mig)) {
    salah('0144: `esb_map` ikut dibuka untuk dibaca. Isinya tidak pernah dipakai layar staff, dan membuka yang tidak perlu adalah kebiasaan yang mahal.');
  }

  if (!/create or replace function nama_supplier_terpakai\(p_bu uuid\)/.test(mig)) {
    salah('0144: `nama_supplier_terpakai` tidak ada — layar pemetaan tidak punya cara tahu ejaan lama apa yang masih beredar.');
  }
  const iFn = mig.indexOf('function nama_supplier_terpakai');
  const fn = iFn < 0 ? '' : mig.slice(iFn, mig.indexOf('$$;', iFn));
  if (!/g\.status = 'aktif'/.test(fn)) {
    salah('0144 `nama_supplier_terpakai`: nota yang dibatalkan ikut terhitung — ejaannya tidak akan pernah diekspor siapa pun, jadi ia cuma menambah baris yang tidak perlu dibereskan.');
  }
  if (!/btrim\(g\.supplier\)/.test(fn)) {
    salah('0144 `nama_supplier_terpakai`: spasi tepi tidak dirapikan — "Pasar" dan "Pasar " muncul sebagai dua baris yang terlihat identik.');
  }
  if (!/filter \(where g\.esb_exported_at is null\)/.test(fn)) {
    salah('0144 `nama_supplier_terpakai`: yang belum diekspor tidak dihitung terpisah — ejaan yang menahan 40 nota dan yang menahan nol terlihat sama mendesaknya.');
  }
}

// ---------------------------------------------------------------
// 2. Modul murninya.
// ---------------------------------------------------------------
const murni = baca('js/modules/inventory/cocok-supplier.js');
if (murni) {
  const kode = bersih(murni, 'cocok-supplier.js', ['export function cocokkanSupplier']);

  for (const f of ['normalNama', 'petaSupplier', 'petaEjaanSupplier', 'cocokkanSupplier', 'supplierSiap', 'supplierPerluDibereskan']) {
    if (!new RegExp(`export function ${f}\\(`).test(kode)) salah(`cocok-supplier.js: \`${f}\` tidak diekspor.`);
  }

  // Normalisasinya DANGKAL: titik & bentuk badan hukum tidak boleh dibuang.
  if (!/\.trim\(\)\.replace\(\/\\s\+\/g, ' '\)\.toLowerCase\(\)/.test(kode)) {
    salah('cocok-supplier.js: aturan normalisasinya berubah.');
  }
  if (/replace\(\/\[\^a-z0-9\]/.test(kode)) {
    salah(
      'cocok-supplier.js: normalisasinya membuang tanda baca. "PT KIMIA YASA" dan "CV KIMIA YASA" akan dianggap sama — ' +
        'dua badan hukum berbeda, dan pembeliannya masuk ke akun yang salah tanpa satu pun tanda di layar.'
    );
  }
  // Yang dikembalikan nama DARI DAFTAR, bukan yang diketik.
  if (!/return \{ keadaan: 'daftar', nama: diDaftar\.nama/.test(kode)) {
    salah('cocok-supplier.js: yang dikembalikan bukan nama kanonik dari daftarnya — ejaan yang diketik akan terkirim ke ESB apa adanya.');
  }
  if (!/const masihAda = master\?\.get\?\.\(normalNama\(dipetakan\)\)/.test(kode)) {
    salah(
      'cocok-supplier.js: pemetaan yang menunjuk nama yang sudah lenyap dari daftar induk dianggap sah. ESB bisa ' +
        'menonaktifkan supplier, dan pemetaannya akan terus mengirim nama hantu tanpa ada yang tahu sebabnya.'
    );
  }
  if (!/if \(!peta\.has\(k\)\) peta\.set\(k/.test(kode)) {
    salah('cocok-supplier.js: nama kembar beda huruf besar-kecil membuat yang TERAKHIR menang — ejaan kanoniknya jadi tergantung urutan datangnya dari database.');
  }
}

// ---------------------------------------------------------------
// 3. Ekspor Purchase.
// ---------------------------------------------------------------
const pur = baca('js/modules/inventory/esb-purchase.js');
if (pur) {
  const kode = bersih(pur, 'esb-purchase.js', ['export function barisEsbPurchase']);

  if (!/JENIS_PETA = \[[^\]]*'supplier'/.test(kode)) {
    salah('esb-purchase.js: supplier bukan jenis pemetaan — ejaan lama tidak punya tempat untuk dibereskan.');
  }
  for (const j of JENIS_LAMA) {
    if (!new RegExp(`JENIS_PETA = \\[[^\\]]*'${j}'`).test(kode)) salah(`esb-purchase.js: jenis '${j}' hilang dari JENIS_PETA.`);
  }
  if (!/cocokkanSupplier\(n\.supplier, masterSupplier, peta\.supplier\)/.test(kode)) {
    salah('esb-purchase.js: nama supplier tidak dicocokkan dengan daftar induk.');
  }
  // Sel Supplier diisi dari hasil pencocokan, BUKAN dari yang diketik.
  if (!/^\s*supplier \?\? '',$/m.test(kode)) {
    salah('esb-purchase.js: sel Supplier tidak diisi dari hasil pencocokan.');
  }
  if (/teks\(n\.supplier\),/.test(kode)) {
    salah('esb-purchase.js: `teks(n.supplier)` kembali ke baris data — ejaan yang diketik berangkat ke ESB apa adanya.');
  }
  if (!/const kepalaBermasalah = tanggal === null \|\| !supplier \|\|/.test(kode)) {
    salah('esb-purchase.js: nota bersupplier tak dikenal tidak lagi tertahan — nama apa pun kembali berangkat ke ESB.');
  }
  // Daftar kosong MELEWATI pemeriksaan. Ini bukan kelonggaran, ini yang
  // menjaga BU lain tidak mendadak kehilangan seluruh notanya.
  if (!/const adaMasterSupplier = masterSupplier\?\.size > 0;/.test(kode)) {
    salah(
      'esb-purchase.js: daftar induk yang masih kosong tidak lagi melewati pemeriksaan. BU yang belum sempat mengimpor ' +
        'daftar supplier akan kehilangan SELURUH notanya begitu aturan ini menyala.'
    );
  }
  // Satu aturan normalisasi untuk semua jenis.
  if (!/const k = normalNama\(b\?\.kunci\);/.test(kode) || !/const k = normalNama\(nilai\);/.test(kode)) {
    salah(
      'esb-purchase.js: kunci pemetaan tidak lagi dinormalkan dengan aturan yang sama seperti supplier. Dua aturan untuk ' +
        'satu pekerjaan pasti menyimpang, dan "AB  Sentul" akan cocok di satu jalur saja.'
    );
  }
}

// ---------------------------------------------------------------
// 4. Impor daftarnya.
// ---------------------------------------------------------------
const adm = baca('js/modules/inventory/esb.admin.js');
if (adm) {
  const kode = bersih(adm, 'esb.admin.js', ['async function bacaMasterEsb']);

  if (!/supplier: \['Supplier Name'\]/.test(kode)) {
    salah('esb.admin.js: `bacaMasterEsb` tidak mengenal Master Supplier.');
  }
  if (!/supplier: 'Supplier Code'/.test(kode)) {
    salah('esb.admin.js: kode supplier tidak ikut terbaca.');
  }
  if (!/<option value="supplier">Master Supplier<\/option>/.test(kode)) {
    salah('esb.admin.js: "Master Supplier" tidak ada di dropdown impor — daftarnya tidak bisa dimasukkan dari layar mana pun.');
  }
  if (!/masterSupplier: petaSupplier\(master\)/.test(kode)) {
    salah('esb.admin.js: daftar induk supplier tidak diberikan ke `barisEsbPurchase` — pemeriksaannya tidak akan pernah menyala.');
  }
  if (!/supplier: 'Supplier'/.test(kode)) {
    salah('esb.admin.js: jenis "supplier" tidak punya label — ia muncul mentah di tabel yang tertahan.');
  }
  // Yang muncul di kelompok Supplier HANYA ejaan di luar daftar.
  if (!/!m\.has\(normalNama\(nama\)\)/.test(kode)) {
    salah(
      'esb.admin.js: kelompok pemetaan Supplier memuat SELURUH nama yang pernah dipakai. Tiga puluh baris yang sudah ' +
        'benar akan tampil sebagai "belum dipetakan", dan yang beberapa benar-benar bermasalah tenggelam di antaranya.'
    );
  }
}

// ---------------------------------------------------------------
// 5. Layar nota — dan yang TIDAK boleh terjadi di sana.
// ---------------------------------------------------------------
const nota = baca('js/modules/inventory/nota-staff.js');
if (nota) {
  const kode = bersih(nota, 'nota-staff.js', ['const bacaSupplier']);

  if (!/allowCreate: true/.test(kode)) {
    salah(
      'nota-staff.js: kolom Supplier memaksa memilih dari daftar. Pembelian mendadak dari supplier baru jadi TIDAK BISA ' +
        'DICATAT sama sekali sampai admin menambahkannya di ESB dan mengimpor ulang — dan yang memegang nota kertas di ' +
        'depan supplier tidak bisa menunggu itu.'
    );
  }
  // Satu cara membaca, apa pun bentuk kotaknya.
  if (!/const bacaSupplier = \(\) =>/.test(kode) || !/input\[name="nota-supplier"\]/.test(kode)) {
    salah(
      'nota-staff.js: nama supplier tidak dibaca lewat satu jalur. Bentuk search-select tidak punya id `#nota-supplier`; ' +
        'membacanya langsung membuat Simpan Nota mati total tanpa pesan yang menyebut supplier sama sekali.'
    );
  }
  if (/querySelector\('#nota-supplier'\)\.value/.test(kode)) {
    salah('nota-staff.js: masih ada pembacaan `#nota-supplier` langsung tanpa penjaga — akan melempar saat kotaknya berbentuk search-select.');
  }
  // Daftar kosong -> kotak teks biasa. Fitur yang belum disiapkan tidak boleh
  // mematikan layar yang selama ini jalan.
  if (!/daftarSupplier\.length\s*\n?\s*\?/.test(kode)) {
    salah('nota-staff.js: kolom Supplier tidak lagi punya jalur cadangan saat daftarnya kosong.');
  }
}

// ---------------------------------------------------------------
// 6. Teks nota TIDAK ditulis ulang. Ini janji yang dipegang ke pengguna.
// ---------------------------------------------------------------
for (const rel of ['supabase/migrations/0144_master_supplier_esb.sql']) {
  const isi = baca(rel);
  if (isi && /update goods_receipts[\s\S]{0,200}set[\s\S]{0,80}supplier\s*=/.test(isi)) {
    salah(
      `${rel}: ada UPDATE yang menimpa goods_receipts.supplier. Teks itu catatan apa yang DULU diketik orang — ` +
        'menimpanya menghapus jejak yang tidak bisa dikembalikan, dan pemetaan ada justru supaya itu tidak perlu.'
    );
  }
}

if (gagal === 0) {
  console.log(
    'Master Supplier: daftarnya dari ESB, nama kanonik yang berangkat, nota bersupplier tak dikenal tertahan, ' +
      'daftar kosong tidak menahan apa pun, dan teks nota lama tidak ditulis ulang. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
