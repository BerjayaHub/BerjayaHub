/**
 * AUDIT: angka harga di nota adalah HARGA BELI BARIS (0123).
 *
 * ============ KESALAHANNYA ============
 *
 *   "beras, qty 5000 gr, harga 180.000 ... yang dimaksud adalah harga 5000 gr
 *    itu 180.000 bukan harga per gram nya 180.000"
 *
 * Kotaknya berlabel "harga/gr" dan disimpan sebagai `unit_cost`, jadi
 * 5.000 x 180.000 = Rp900.000.000. Lima ribu kali lipat, dan seluruh angkanya
 * tetap terlihat seperti angka: notanya tersimpan, biaya rata-ratanya terisi,
 * HPP menunya ikut terhitung.
 *
 * ============ YANG DIKUNCI ============
 *
 * 1. Kotaknya TIDAK boleh kembali berlabel per-satuan. Label yang salah adalah
 *    seluruh sebab bug ini — bukan kodenya.
 * 2. Pembagiannya dikerjakan SERVER, di SATU tempat (`harga_baris_nota`).
 * 3. Total nota & nominal pembayaran memakai `line_total`, bukan qty x harga.
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
const mig = baca('supabase/migrations/0123_harga_beli_per_baris.sql');
if (mig) {
  if (!/add column if not exists line_total/.test(mig)) {
    salah('supabase/migrations/0123: kolom `line_total` tidak ada.');
  }
  if (!/create or replace function harga_baris_nota\(/.test(mig)) {
    salah(
      'supabase/migrations/0123: tidak ada fungsi tunggal penerjemah harga baris. ' +
        'Kalau `simpan_nota_terima` dan `ubah_nota_terima` menulis aturannya sendiri-sendiri, menyimpan dan ' +
        'mengedit nota yang sama bisa menghasilkan harga berbeda — dan yang terlihat cuma angka yang ' +
        'berubah sendiri setelah dibuka.'
    );
  }
  // Kedua RPC harus MEMAKAI fungsi itu, bukan sekadar fungsinya ada.
  const pakai = (mig.match(/harga_baris_nota\(it, v_qty\)/g) ?? []).length;
  if (pakai < 2) {
    salah(
      `supabase/migrations/0123: \`harga_baris_nota\` cuma dipakai ${pakai}x — seharusnya di simpan_nota_terima DAN ubah_nota_terima.`
    );
  }
  // `line_total` menang atas `unit_cost`.
  if (!/if v_t is not null then/.test(mig)) {
    salah('supabase/migrations/0123: `line_total` tidak diprioritaskan atas `unit_cost`.');
  }
  // Bentuk lama tetap diterima — PWA di HP staff belum tentu sudah memperbarui diri.
  if (!/elsif v_s is not null then/.test(mig)) {
    salah(
      'supabase/migrations/0123: bentuk lama (`unit_cost`) tidak lagi diterima. ' +
        'HP staff yang belum memuat ulang akan menyimpan nota TANPA harga sama sekali — dan itu tidak ' +
        'muncul sebagai error, cuma sebagai nota yang harganya kosong.'
    );
  }
  // Total & pembayaran memakai line_total.
  if (!/coalesce\(sum\(coalesce\(i\.line_total, i\.qty \* i\.unit_cost\)\), 0\)/.test(mig)) {
    salah(
      'supabase/migrations/0123: total nota tidak memakai `line_total`. ' +
        'Layarnya menampilkan satu angka dan kasnya berkurang sebesar angka yang lain.'
    );
  }
  // Penjagaan 0118 wajib ikut terbawa di penulisan ulang keempat ini.
  if (!/update stock_movements\s+set unit_cost = v_satuan/.test(mig)) {
    salah(
      'supabase/migrations/0123: penyelarasan harga ke `stock_movements` (0118) hilang saat `ubah_nota_terima` ' +
        'ditulis ulang. Kalau HANYA harganya yang diubah, tidak ada pergerakan baru yang membawanya — barisnya ' +
        'benar sementara biaya rata-ratanya memakai harga lama.'
    );
  }
  // Penjagaan 0119 juga.
  if (!/case when p_supplier is null then supplier else nullif\(p_supplier, ''\) end/.test(mig)) {
    salah(
      'supabase/migrations/0123: aturan "NULL = jangan sentuh" (0119) hilang saat `ubah_nota_terima` ditulis ulang. ' +
        'Menekan "+ Foto" akan kembali menghapus nama supplier, no. invoice, dan catatan notanya.'
    );
  }
}

// ---------------------------------------------------------------
// 2. Kotak isiannya menanyakan HARGA BELI, bukan harga per satuan.
//
// Ini inti auditnya. Kodenya tidak pernah salah — LABELNYA yang salah, dan
// orang yang memegang nota supplier mengetik angka yang tertulis di kertasnya.
// ---------------------------------------------------------------
const picker = baca('js/modules/dispatch/item-picker.js');
if (picker) {
  const kode = tanpaKomentar(picker);
  if (/placeholder="harga\/\$\{/.test(kode)) {
    salah(
      'js/modules/dispatch/item-picker.js: kotak harga kembali berlabel "harga/<satuan>". ' +
        'Label itulah seluruh sebab bug 0123 — orang mengetik Rp180.000 dari kertas notanya, lalu dikalikan ' +
        '5.000 gram jadi Rp900.000.000 tanpa satu pun error.'
    );
  }
  if (!/placeholder="harga beli"/.test(kode)) {
    salah('js/modules/dispatch/item-picker.js: kotak harga tidak berlabel "harga beli".');
  }
  if (!/line_total:\s*bacaRupiah\(/.test(kode)) {
    salah('js/modules/dispatch/item-picker.js: isian harga tidak dikirim sebagai `line_total`.');
  }
}

// ---------------------------------------------------------------
// 3. Perhitungan di klien tidak boleh mengalikan lagi.
// ---------------------------------------------------------------
const rumus = baca('js/modules/inventory/biaya-rata.js');
if (rumus) {
  const kode = tanpaKomentar(rumus);
  if (!/export function hargaBaris\(/.test(kode)) {
    salah('js/modules/inventory/biaya-rata.js: `hargaBaris` tidak ada — tiap layar akan menghitungnya sendiri.');
  }
  if (/total \+= qty \* h/.test(kode)) {
    salah(
      'js/modules/inventory/biaya-rata.js: `ringkasNota` masih mengalikan jumlah dengan harga. ' +
        'Sejak 0123 angkanya SUDAH harga seluruh baris; mengalikannya lagi menghasilkan Rp900.000.000 ' +
        'untuk beras seharga Rp180.000.'
    );
  }
}

// ---------------------------------------------------------------
// 4. Service mengirim `line_total`, bukan `unit_cost`.
// ---------------------------------------------------------------
const svc = baca('js/modules/inventory/nota.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  const kirim = (kode.match(/line_total: i\.line_total \?\? null/g) ?? []).length;
  if (kirim < 2) {
    salah(
      `js/modules/inventory/nota.service.js: \`line_total\` cuma dikirim ${kirim}x — seharusnya di simpanNota DAN ubahNota. ` +
        'Yang tertinggal akan menyimpan harga dengan arti yang berbeda dari saudaranya.'
    );
  }
  if (!/line_total, notes, products/.test(kode)) {
    salah(
      'js/modules/inventory/nota.service.js: `itemNota` tidak mengambil `line_total`. ' +
        'Dialog Edit akan membuka kotak harga dalam keadaan KOSONG untuk nota yang sebenarnya sudah berharga — ' +
        'lalu menyimpannya kembali sebagai nota tanpa harga.'
    );
  }
}

if (gagal === 0) {
  console.log('Harga beli per baris: kotaknya menanyakan harga beli, pembagiannya di server, totalnya memakai line_total. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
