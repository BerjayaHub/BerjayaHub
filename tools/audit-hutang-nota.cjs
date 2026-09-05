/**
 * AUDIT: status bayar nota & hutang supplier (0122).
 *
 * ============ TIGA HAL YANG DIKUNCI ============
 *
 * 1. **Jalannya ada di layar, dan bisa dicapai.** Pelajaran 0120/0121:
 *    migration lengkap + tes hijau + audit hijau, dan tetap tidak ada seorang
 *    pun yang bisa memakainya karena tombolnya tidak pernah digambar. Di sini
 *    tab "Hutang Supplier" harus TERDAFTAR dan TERHUBUNG ke penggambarnya.
 *
 * 2. **Kegagalan setelah nota tersimpan tidak boleh terbaca sebagai "gagal
 *    simpan".** Notanya sudah ada, stoknya sudah bertambah; orang yang mengira
 *    gagal akan menginputnya untuk kedua kalinya, dan stok bertambah dua kali.
 *
 * 3. **Pelonggaran kewajiban foto bukti tetap SEMPIT.** `untuk_nota` hanya
 *    boleh menggantikan foto untuk entri yang benar-benar ditunjuk sebuah
 *    nota — dijaga pemeriksa yang ditunda sampai commit, bukan kepercayaan.
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
const mig = baca('supabase/migrations/0122_nota_status_bayar.sql');
if (mig) {
  for (const [pola, apa] of [
    [/add column if not exists payment_status/, 'kolom `payment_status`'],
    [/add column if not exists due_date/, 'kolom `due_date`'],
    [/add column if not exists payment_entry_id/, 'kolom `payment_entry_id`'],
    [/add column if not exists untuk_nota/, 'kolom `cash_entries.untuk_nota`'],
    [/create or replace function bayar_nota\(/, 'RPC `bayar_nota`'],
    [/create or replace function batalkan_pembayaran_nota\(/, 'RPC `batalkan_pembayaran_nota`'],
    [/create view nota_ringkas/, 'view `nota_ringkas`']
  ]) {
    if (!pola.test(mig)) salah(`supabase/migrations/0122: ${apa} tidak ada.`);
  }

  // Pelonggaran foto bukti harus SEMPIT: hanya untuk entri ber-`untuk_nota`.
  if (!/check \(entry_type <> 'out' or proof_path is not null or untuk_nota\)/.test(mig)) {
    salah(
      'supabase/migrations/0122: batasan `cash_entries_nota_wajib` tidak berbentuk pelonggaran sempit. ' +
        'Kalau kewajiban foto dicabut seluruhnya, setiap kas keluar di seluruh sistem berhenti butuh bukti — ' +
        'dan tidak akan ada satu pun error yang menandainya.'
    );
  }

  // ...dan `untuk_nota` harus DIVERIFIKASI, bukan dipercaya.
  if (!/deferrable initially deferred/.test(mig) || !/cek_untuk_nota_punya_nota/.test(mig)) {
    salah(
      'supabase/migrations/0122: `untuk_nota` tidak diverifikasi oleh pemeriksa yang ditunda sampai commit. ' +
        'Tanpa itu ia cuma boolean yang bisa dikirim siapa saja dari klien untuk melewati kewajiban foto bukti. ' +
        'Pemeriksaan saat insert TIDAK bisa dipakai: notanya baru menunjuk entri ini beberapa pernyataan kemudian.'
    );
  }

  // Nota lunas tidak boleh berubah nilainya — lewat trigger, bukan lewat
  // penulisan ulang `ubah_nota_terima` untuk keempat kalinya.
  if (!/create trigger trg_tolak_ubah_nota_lunas/.test(mig)) {
    salah(
      'supabase/migrations/0122: tidak ada trigger yang menolak perubahan isi nota lunas. ' +
        'Mengubah jumlah/harga nota yang sudah dibayar membuat entri kasnya tidak lagi cocok dengan notanya — ' +
        'dua angka yang tidak salah di baris mana pun, tapi tidak pernah bisa dijumlahkan lagi.'
    );
  }

  // Harga harus LENGKAP sebelum dibayar.
  if (!/i\.unit_cost is null/.test(mig) || !/tanpa harga/.test(mig)) {
    salah(
      'supabase/migrations/0122: nota berbaris tanpa harga bisa dibayar. ' +
        'Kasnya akan berkurang sebesar angka yang kebetulan sudah terisi saja, dan selisihnya tidak pernah muncul ' +
        'sebagai error — cuma sebagai kas yang tidak cocok.'
    );
  }

  // Satu outlet per pembayaran.
  if (!/count\(distinct outlet_id\)/.test(mig)) {
    salah(
      'supabase/migrations/0122: pembayaran lintas outlet tidak ditolak. ' +
        '`cash_entries.outlet_id` cuma satu, jadi separuh biayanya akan tercatat atas nama outlet yang tidak ' +
        'pernah menerima barangnya.'
    );
  }

  // Pembatalan lewat entri BALIK, bukan penghapusan.
  if (/delete from cash_entries/.test(mig)) {
    salah(
      'supabase/migrations/0122: pembatalan MENGHAPUS entri kas. ' +
        'Saldo hari ini jadi benar, tapi laporan yang sudah dicetak kemarin tidak akan pernah bisa dijelaskan lagi.'
    );
  }
  if (!/'Pembatalan: '/.test(mig)) {
    salah('supabase/migrations/0122: pembatalan tidak membuat entri balik yang bisa dikenali di buku kas.');
  }
}

// ---------------------------------------------------------------
// 2. Service
// ---------------------------------------------------------------
const svc = baca('js/modules/inventory/nota.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  for (const [pola, apa] of [
    [/rpc\('bayar_nota'/, '`bayar_nota`'],
    [/rpc\('batalkan_pembayaran_nota'/, '`batalkan_pembayaran_nota`'],
    [/rpc\('set_jatuh_tempo_nota'/, '`set_jatuh_tempo_nota`'],
    [/from\('nota_ringkas'\)/, "view `nota_ringkas`"]
  ]) {
    if (!pola.test(kode)) salah(`js/modules/inventory/nota.service.js: tidak memakai ${apa}.`);
  }
  // Status bayar harus ikut di riwayat, kalau tidak kolomnya kosong selamanya.
  if (!/payment_status, due_date, payment_entry_id/.test(kode)) {
    salah(
      'js/modules/inventory/nota.service.js: `riwayatNota` tidak mengambil kolom status bayar. ' +
        'Kolom "Bayar" di tabelnya akan kosong untuk SEMUA nota, dan itu terbaca sebagai "belum ada yang dibayar".'
    );
  }
}

// ---------------------------------------------------------------
// 3. Aturan hutangnya satu tempat, bukan disalin ke layar.
// ---------------------------------------------------------------
const aturan = baca('js/modules/inventory/hutang-nota.js');
if (aturan) {
  const kode = tanpaKomentar(aturan);
  for (const n of ['statusTempo', 'bolehDibayar', 'kelompokPerSupplier', 'ringkasTempo']) {
    if (!new RegExp(`export function ${n}\\(`).test(kode)) {
      salah(`js/modules/inventory/hutang-nota.js: \`${n}\` tidak diekspor.`);
    }
  }
  // `hariIni` harus DIKIRIM, bukan dibaca dari jam sistem di dalam modulnya.
  if (/new Date\(\)/.test(kode)) {
    salah(
      'js/modules/inventory/hutang-nota.js: membaca jam sistem sendiri. ' +
        'Seluruh gunanya adalah perbandingan tanggal, dan fungsi yang mengambil "hari ini" sendiri tidak bisa ' +
        'diuji untuk besok — jadi aturan jatuh temponya tidak pernah benar-benar teruji.'
    );
  }
}

// ---------------------------------------------------------------
// 4. Layar: tabnya ada, terhubung, dan akibatnya dijelaskan.
// ---------------------------------------------------------------
const hal = baca('js/modules/inventory/nota-staff.js');
if (hal) {
  const kode = tanpaKomentar(hal);

  if (!/data-nota-tab="hutang"/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: tab "Hutang Supplier" tidak ada di layar. ' +
        'Seluruh 0122 hidup di database dan tidak bisa dicapai siapa pun — bentuk kegagalan yang sudah terjadi ' +
        'pada 0120 dan baru ditutup oleh 0121.'
    );
  }
  if (!/=== 'hutang'\) gambarHutang\(\)/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: tab "Hutang Supplier" tidak terhubung ke penggambarnya. ' +
        'Tombolnya muncul, ditekan, dan tidak terjadi apa-apa.'
    );
  }
  if (!/nota-bayar-cara/.test(kode)) {
    salah('js/modules/inventory/nota-staff.js: tidak ada pilihan Tunai vs Tempo saat menyimpan nota.');
  }

  // KEGAGALAN SESUDAH NOTA TERSIMPAN.
  if (!/Nota TERSIMPAN/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: kegagalan pembayaran setelah nota tersimpan tidak dibedakan dari gagal simpan. ' +
        'Notanya sudah ada dan stoknya sudah bertambah — orang yang membaca "gagal" akan menginputnya lagi, ' +
        'dan stok bertambah dua kali tanpa satu pun error.'
    );
  }

  // Penjelasan biaya vs kas lintas bulan.
  if (!/tanggal notanya/.test(kode) || !/tanggal pembayaran/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: perbedaan tanggal biaya vs tanggal kas tidak dijelaskan di layar. ' +
        'Nota Agustus yang dibayar September memang muncul di dua bulan berbeda; tanpa penjelasan, orang akan ' +
        'mencari selisih itu tiap bulan dan mengira ada yang rusak.'
    );
  }

  // Pembatalan menyebutkan nota lain yang ikut terbawa — DI PESANNYA, bukan
  // di komentar mana pun. (Komentarnya memang sudah dibuang `tanpaKomentar`,
  // tapi menuntut bentuk pesannya membuat maksudnya jelas bagi pembaca audit.)
  if (!/nota lain<\/strong>/.test(kode)) {
    salah(
      'js/modules/inventory/nota-staff.js: pembatalan tidak memberi tahu bahwa nota lain ikut terbawa. ' +
        'Pembatalan berlaku untuk SELURUH pembayaran; orang yang mengira membatalkan satu nota lalu mendapati ' +
        'enam nota lain terbuka tidak punya cara mengetahui bahwa itu memang perilakunya.'
    );
  }

  // Aturannya dipakai, bukan ditulis ulang di layar.
  if (!/bolehDibayar\(/.test(kode) || !/kelompokPerSupplier\(/.test(kode)) {
    salah('js/modules/inventory/nota-staff.js: aturan hutang ditulis ulang di layar alih-alih memakai modulnya.');
  }
}

if (gagal === 0) {
  console.log('Hutang supplier: RPC ada, tabnya terhubung, pelonggaran bukti sempit & diverifikasi. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
