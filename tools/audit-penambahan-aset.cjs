/**
 * AUDIT: penambahan aset (0190).
 *
 * ============ TIGA HAL YANG DIJAGA ============
 *
 * 1. DITAMBAHKAN, BUKAN DITETAPKAN.
 *    `qty = p_jumlah` dan `qty = qty + p_jumlah` sama-sama berjalan, sama-sama
 *    menghasilkan angka yang masuk akal di layar, dan sama-sama tidak pernah
 *    melempar galat. Bedanya baru terlihat saat dua orang mencatat pembelian
 *    pada menit yang sama: yang pertama menimpa yang lain diam-diam.
 *
 * 2. SEBABNYA IKUT TERCATAT.
 *    Seluruh alasan perubahan ini ada adalah supaya riwayatnya tidak cuma
 *    "28 jadi 30". Kalau baris log penjelasnya hilang, fiturnya tetap
 *    berjalan, stoknya tetap benar, dan satu-satunya yang hilang adalah
 *    hal yang diminta.
 *
 * 3. STOK TIDAK BOLEH JADI MINUS.
 *    Pembatalan yang melebihi sisa harus DITOLAK, bukan dipaksakan. Stok
 *    minus tidak pernah diperiksa siapa pun karena ia terlihat seperti galat
 *    sistem, bukan seperti selisih yang perlu dijelaskan.
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

const bacaKode = (rel, penanda) => {
  const asli = baca(rel);
  if (!asli) return null;
  const kode = tanpaKomentar(asli);
  const pesan = periksaKewarasan(asli, kode, penanda);
  if (pesan) {
    salah(`${rel}: ${pesan} — audit ini tidak bisa dipercaya untuk berkas itu.`);
    return null;
  }
  return kode;
};

const tanpaKomentarSql = (sql) =>
  sql
    .split('\n')
    .map((b) => (b.trim().startsWith('--') ? '' : b))
    .join('\n');

const MIG = 'supabase/migrations/0190_penambahan_aset.sql';
const SVC = 'js/modules/asset/asset.service.js';
const PAGE = 'js/modules/asset/asset.page.js';
const ATURAN = 'js/modules/asset/aturan-aset-bu.js';
const TES = 'tools/test-migrasi-0190.mjs';

if (!fs.existsSync(path.join(AKAR, TES))) salah(`${TES} tidak ada — aturannya tidak pernah dijalankan.`);

const mentah = baca(MIG);
const sql = mentah ? tanpaKomentarSql(mentah) : null;
const fungsi = (nama) => {
  if (!sql) return '';
  const i = sql.indexOf(`function ${nama}(`);
  if (i < 0) return '';
  const j = sql.indexOf('\n$$;', i);
  return sql.slice(i, j < 0 ? undefined : j);
};

if (sql) {
  const tambah = fungsi('tambah_stok_aset');
  if (!tambah) {
    salah(`${MIG}: \`tambah_stok_aset\` tidak ada.`);
  } else {
    // ---- 1. DITAMBAHKAN ----
    if (!/set qty = qty \+ p_jumlah/.test(tambah)) {
      salah(`${MIG}: jumlahnya tidak DITAMBAHKAN ke angka yang ada — dua orang yang mencatat pembelian bersamaan akan saling menimpa, dan yang kalah hilang tanpa galat.`);
    }
    // Dikunci dulu. Tanpa `for update`, dua transaksi membaca angka yang sama
    // sebelum salah satunya menulis.
    if (!/for update/.test(tambah)) {
      salah(`${MIG}: baris stoknya tidak dikunci sebelum ditambah — angka sebelum/sesudah yang disimpan bisa tidak cocok dengan kenyataannya.`);
    }
    // ---- 2. SEBABNYA ----
    if (!/insert into asset_penambahan/.test(tambah)) {
      salah(`${MIG}: kejadiannya tidak disimpan — stoknya berubah tanpa ada baris yang bisa ditanya "dari mana".`);
    }
    if (!/insert into asset_log[\s\S]{0,400}'tambah'/.test(tambah)) {
      salah(`${MIG}: tidak ada baris riwayat yang menjelaskan sebabnya — riwayatnya kembali jadi perubahan angka tanpa keterangan, yaitu persis keadaan yang membuat perubahan ini diminta.`);
    }
    if (!/qty_sebelum, qty_sesudah/.test(tambah)) {
      salah(`${MIG}: angka sebelum & sesudah tidak disimpan di barisnya — Edit, kerusakan dan transfer ikut menggeser stok, jadi barisnya tidak bisa dibaca sendirian lagi nanti.`);
    }
    // ---- Penjagaan isian ----
    if (!/p_jumlah <= 0/.test(tambah)) {
      salah(`${MIG}: jumlah nol/minus tidak ditolak — "tambah -5" adalah pengurangan yang menyamar jadi pembelian.`);
    }
    if (!/tidak boleh di masa depan/.test(tambah)) {
      salah(`${MIG}: tanggal maju tidak ditolak — rekap bulan berjalan akan memuat kejadian yang belum terjadi (0170).`);
    }
    if (!/has_outlet_scope\(v_uid, p_outlet\)/.test(tambah)) {
      salah(`${MIG}: wewenang outlet tidak diperiksa.`);
    }
    // Barang yang belum didata: ditolak dengan MENUNJUK jalan yang benar.
    // "Tidak ditemukan" saja membuat orang menekan tombol yang sama berkali-kali.
    if (!/belum didata[\s\S]{0,120}Tambah Aset/.test(tambah)) {
      salah(`${MIG}: barang yang belum didata ditolak tanpa menyebut jalan yang benar.`);
    }
  }

  const batal = fungsi('batalkan_penambahan_aset');
  if (!batal) {
    salah(`${MIG}: \`batalkan_penambahan_aset\` tidak ada — salah ketik "20" yang seharusnya "2" cuma bisa dibetulkan lewat Edit, dan itu meninggalkan catatan pembelian 20 yang berdiri sendiri.`);
  } else {
    // ---- 3. TIDAK BOLEH MINUS ----
    if (!/r\.jumlah > v_sisa/.test(batal)) {
      salah(`${MIG}: pembatalan yang melebihi sisa tidak ditolak — stoknya jadi minus, dan stok minus tidak pernah diperiksa siapa pun karena ia terlihat seperti galat sistem.`);
    }
    if (!/btrim\(coalesce\(p_alasan, ''\)\) = ''/.test(batal)) {
      salah(`${MIG}: alasan pembatalan tidak wajib — "angkanya kok turun" tidak akan punya jawaban.`);
    }
    if (!/r\.dibatalkan_at is not null/.test(batal)) {
      salah(`${MIG}: pembatalan ganda tidak ditolak — stoknya akan dipotong dua kali untuk satu catatan.`);
    }
    // Barisnya DITANDAI, bukan dihapus: yang dibatalkan harus tetap terlihat.
    if (/delete from asset_penambahan/.test(batal)) {
      salah(`${MIG}: baris penambahan DIHAPUS saat dibatalkan — yang dibatalkan harus tetap terlihat beserta alasannya (0170).`);
    }
    if (!/insert into asset_log[\s\S]{0,400}'batal-tambah'/.test(batal)) {
      salah(`${MIG}: pembatalan tidak meninggalkan baris riwayat.`);
    }
    if (!/is_admin_of_outlet\(v_uid, r\.outlet_id\)/.test(batal)) {
      salah(`${MIG}: siapa pun bisa membatalkan catatan penambahan.`);
    }
  }

  // ---- RLS: tulis hanya lewat RPC ----
  if (!/alter table asset_penambahan enable row level security/.test(sql)) {
    salah(`${MIG}: RLS tidak dinyalakan untuk \`asset_penambahan\`.`);
  }
  const policyTulis = /create policy[^;]*on asset_penambahan[^;]*for (insert|update|delete)/i.test(sql);
  if (policyTulis) {
    salah(`${MIG}: ada policy tulis langsung ke \`asset_penambahan\` — \`insert\` dari klien akan menambah catatan pembelian TANPA menyentuh stoknya, dan dua angka itu sama-sama terlihat benar di layarnya masing-masing.`);
  }
  // Sumbernya pilihan tetap di DATABASE juga, bukan cuma di dropdown: layar
  // bukan satu-satunya jalan masuk, dan `check` adalah yang tersisa kalau
  // dropdownnya dilewati.
  if (!/check \(sumber in \('pembelian', 'hibah', 'temuan', 'kembali', 'lainnya'\)\)/.test(sql)) {
    salah(`${MIG}: kolom \`sumber\` tidak dibatasi \`check\` — ejaan bebas akan masuk lewat jalur mana pun selain dropdown, dan rekap yang mengelompokkannya salah tanpa terlihat salah.`);
  }
}

// =====================================================================
// KLIEN
// =====================================================================
const svc = bacaKode(SVC, ['tambahStokAset', 'saveAsset']);
if (svc) {
  const i = svc.indexOf('export async function tambahStokAset(');
  const f = i < 0 ? '' : svc.slice(i, svc.indexOf('\n}', i));
  if (!f) {
    salah(`${SVC}: \`tambahStokAset\` tidak ada.`);
  } else if (!/rpc\('tambah_stok_aset'/.test(f)) {
    salah(`${SVC}: penambahan tidak lewat RPC — lewat \`saveAsset\` ia akan MENETAPKAN angka akhir, dan pencatatan bersamaan saling menimpa.`);
  }
  if (!/rpc\('batalkan_penambahan_aset'/.test(svc)) {
    salah(`${SVC}: pembatalan penambahan tidak tersedia di layanan.`);
  }
}

const aturan = bacaKode(ATURAN, ['kalimatRiwayat', 'SUMBER_TAMBAH']);
if (aturan) {
  const i = aturan.indexOf('export function kalimatRiwayat(');
  const f = i < 0 ? '' : aturan.slice(i, aturan.indexOf('\n}', i));
  if (!/aksi === 'tambah'/.test(f)) {
    salah(`${ATURAN}: baris 'tambah' tidak punya kalimatnya sendiri — ia akan terbaca sebagai perubahan kolom bernama "pembelian", yang tidak berarti apa-apa.`);
  }
  if (!/aksi === 'batal-tambah'/.test(f)) {
    salah(`${ATURAN}: baris 'batal-tambah' tidak punya kalimatnya sendiri.`);
  }
  // Selisihnya, bukan angka akhirnya: mengulang angka akhir memaksa pembacanya
  // menghitung sendiri berapa yang masuk.
  if (!/\+\$\{masuk\}/.test(f)) {
    salah(`${ATURAN}: kalimat penambahan tidak menyebut SELISIHNYA — pembacanya harus menghitung sendiri berapa unit yang masuk.`);
  }
}

const page = bacaKode(PAGE, ['dialogTambahStok', 'dialogKerusakan']);
if (page) {
  if (!/class="as-tambah"/.test(page)) {
    salah(`${PAGE}: tombol Tambah tidak ada di daftar aset.`);
  }
  if (!/dialogTambahStok\(rows\.find/.test(page)) {
    salah(`${PAGE}: tombol Tambah tidak terhubung ke dialognya — tombol yang tidak melakukan apa-apa saat diklik terbaca sebagai aplikasi yang hang.`);
  }
  const i = page.indexOf('async function dialogTambahStok(');
  const f = i < 0 ? '' : page.slice(i, page.indexOf('\n  }', i));
  if (!f) {
    salah(`${PAGE}: \`dialogTambahStok\` tidak ada.`);
  } else {
    // Kotak "berapa unit" pernah salah diisi dengan jumlah AKHIR di hampir
    // setiap aplikasi yang punya dua-duanya. Kalimatnya harus tegas.
    if (!/bukan jumlah akhir/i.test(f)) {
      salah(`${PAGE}: dialog Tambah tidak mengatakan bahwa yang diisi adalah TAMBAHANNYA — diisi jumlah akhir, stoknya melonjak tanpa ada yang merasa melakukannya.`);
    }
    if (!/name: 'sumber'/.test(f) || !/name: 'tanggal'/.test(f)) {
      salah(`${PAGE}: dialog Tambah tidak menanyakan sumber & tanggal — riwayatnya kembali cuma berisi angka.`);
    }
    if (!/SUMBER_TAMBAH_OPTIONS/.test(f)) {
      salah(`${PAGE}: pilihan sumber tidak diambil dari daftar bersama — dua daftar yang disalin akan menyimpang dari \`check\` di database.`);
    }
    // Angka sesudahnya disebut di toast: itu satu-satunya cara orangnya tahu
    // angkanya ditambahkan, bukan ditetapkan.
    if (!/hasil\?\.sesudah/.test(f)) {
      salah(`${PAGE}: toast tidak menyebut jumlah sesudahnya — orang yang keliru mengisi jumlah akhir tidak akan melihatnya saat itu juga.`);
    }
  }
}

console.log('');
if (gagal === 0) console.log('Audit penambahan aset bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
