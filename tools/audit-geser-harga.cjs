/**
 * AUDIT: penggeseran harga lama ke harga beli (0124).
 *
 * ============ KENAPA INI PERLU DIJAGA KETAT ============
 *
 * Ini satu-satunya fungsi di repo ini yang MENULIS ULANG ANGKA UANG yang sudah
 * tersimpan. Tiga hal yang membuatnya aman, dan ketiganya tidak terlihat dari
 * layar kalau hilang:
 *
 * 1. **Hanya nota yang disebut.** Nota yang harganya sudah benar akan RUSAK
 *    kalau ikut digeser — `line_total` yang benar dibagi jumlahnya — dan
 *    hasilnya tetap terlihat seperti angka.
 * 2. **Sekali saja.** Tanpa penanda, menekan tombolnya untuk kedua kalinya
 *    membagi harganya lagi.
 * 3. **`stock_movements` ikut.** Itu satu-satunya sumber biaya rata-rata
 *    bahan; kalau tertinggal, layar nota benar sementara laporan biayanya
 *    tetap memakai angka puluhan juta.
 */
const fs = require('fs');
const path = require('path');
const { tanpaKomentar } = require('./lib/tanpa-komentar.cjs');

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

// ---------------------------------------------------------------
// 1. Migration
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0124_geser_harga_ke_harga_beli.sql');
if (mig) {
  if (!/create or replace function geser_harga_nota\(/.test(mig)) {
    salah('supabase/migrations/0124: RPC `geser_harga_nota` tidak ada.');
  }
  if (!/add column if not exists harga_digeser_at/.test(mig)) {
    salah('supabase/migrations/0124: penanda `harga_digeser_at` tidak ada.');
  }

  // Penggeserannya SATU pernyataan. Dua pernyataan terpisah membaca
  // `unit_cost` yang sudah berubah dan membaginya untuk kedua kalinya.
  if (!/set line_total = unit_cost,\s*\n\s*unit_cost = unit_cost \/ qty/.test(mig)) {
    salah(
      'supabase/migrations/0124: penggeseran harga bukan satu `update` dengan sisi kanan nilai lama. ' +
        'Dipecah jadi dua pernyataan, yang kedua membaca `unit_cost` yang sudah berubah — harganya dibagi dua kali, ' +
        'dan hasilnya tetap terlihat seperti angka.'
    );
  }

  // Hanya nota yang disebut.
  if (!/where receipt_id = any\(p_notas\)/.test(mig)) {
    salah(
      'supabase/migrations/0124: penggeserannya tidak dibatasi pada nota yang disebut. ' +
        'Nota yang harganya SUDAH benar akan ikut dibagi jumlahnya, dan tidak ada satu pun error yang menandainya.'
    );
  }

  // Sekali saja.
  if (!/if v_nota\.harga_digeser_at is not null then/.test(mig)) {
    salah(
      'supabase/migrations/0124: nota bisa digeser dua kali. ' +
        'Penekanan kedua membagi harganya lagi — Rp9.000 jadi Rp18, lalu Rp0,036.'
    );
  }

  // Nota lunas ditolak: nominal kasnya dihitung dari harga lama.
  if (!/if v_nota\.payment_status = 'lunas' then/.test(mig)) {
    salah(
      'supabase/migrations/0124: nota yang sudah lunas ikut bisa digeser. ' +
        'Nominal kasnya dihitung dari harga LAMA, jadi entri kasnya berhenti cocok dengan notanya — dan tidak ada ' +
        'baris yang salah, cuma dua angka yang tidak bisa dijumlahkan lagi.'
    );
  }

  // `stock_movements` ikut.
  if (!/update stock_movements sm\s*\n\s*set unit_cost = i\.unit_cost/.test(mig)) {
    salah(
      'supabase/migrations/0124: `stock_movements` tidak ikut digeser. ' +
        'Itu satu-satunya sumber yang dibaca `biaya_rata_bahan` — layar nota akan menampilkan harga yang sudah ' +
        'dibetulkan sementara biaya rata-rata bahannya masih memakai angka puluhan juta.'
    );
  }

  // Pratinjaunya dihitung server, bukan klien.
  if (!/total_jika_digeser/.test(mig)) {
    salah(
      'supabase/migrations/0124: `nota_ringkas` tidak menyediakan total-seandainya-digeser. ' +
        'Kalau klien menghitungnya sendiri, yang dilihat orang sebelum menekan tombol bisa berbeda dari yang terjadi.'
    );
  }
}

// ---------------------------------------------------------------
// 2. Layar: ada jalannya, dan pratinjaunya ditampilkan.
// ---------------------------------------------------------------
const hal = baca('js/modules/inventory/nota-staff.js');
if (hal) {
  const kode = tanpaKomentar(hal);

  if (!/id="nota-geser-harga"/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: tidak ada tombol untuk memperbaiki harga yang kebalik. ' +
        'RPC-nya ada di database dan tidak bisa dicapai siapa pun — bentuk kegagalan yang sudah terjadi pada 0120.'
    );
  }
  if (!/#nota-geser-harga'\)\.addEventListener\('click', sekaliJalan\(bukaGeserHarga\)\)/.test(kode)) {
    salah('js/modules/inventory/nota-staff.js: tombolnya tidak terhubung ke penggambarnya.');
  }

  // PRATINJAU WAJIB. Ini yang membedakan "perbaikan" dari "menulis ulang angka
  // uang orang berdasarkan firasat".
  if (!/total_jika_digeser/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: dialognya tidak menampilkan total SESUDAH digeser. ' +
        'Tanpa itu orang menyetujui penulisan ulang angka uang tanpa melihat hasilnya — dan nota yang harganya ' +
        'sudah benar akan ikut rusak tanpa ada yang menyadarinya.'
    );
  }
  // Nota lunas & yang sudah digeser tidak ditawarkan.
  if (!/!n\.harga_digeser_at/.test(kode) || !/payment_status !== 'lunas'/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: daftar calonnya tidak menyaring nota yang sudah digeser atau sudah lunas. ' +
        'Keduanya akan ditolak server, dan yang dilihat orang cuma tombol yang gagal tanpa sebab yang bisa ditelusuri.'
    );
  }
}

// ---------------------------------------------------------------
// 3. Service
// ---------------------------------------------------------------
const svc = baca('js/modules/inventory/nota.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  if (!/rpc\('geser_harga_nota'/.test(kode)) {
    salah('js/modules/inventory/nota.service.js: tidak memanggil RPC `geser_harga_nota`.');
  }
}

if (gagal === 0) {
  console.log('Geser harga: satu pernyataan, sekali saja, hanya nota yang dipilih, dan stok ikut. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
