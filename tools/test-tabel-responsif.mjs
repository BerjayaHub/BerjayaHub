/**
 * Tabel yang menyesuaikan diri dengan layar.
 *
 * Yang paling ditekankan: LABEL HARUS MENDARAT DI KOLOM YANG BENAR.
 *
 * Di mode kartu, `data-label` yang bergeser satu kolom menghasilkan kartu yang
 * terlihat rapi sempurna dan isinya salah — "Stok: kg", "Satuan: 12". Tidak ada
 * yang rusak, tidak ada error, dan angkanya masuk akal. Itu jenis kesalahan
 * yang tidak akan pernah dilaporkan sebagai bug; ia cuma membuat orang
 * berhenti mempercayai layarnya.
 *
 * Dua sumber pergeseran yang diuji di sini: `colspan` di header, dan `colspan`
 * di badan tabel.
 *
 * Butuh DOM. Dipakai `linkedom` — dipasang lokal, tidak ikut ke repo
 * (`node_modules/` ada di .gitignore).
 */
let parseHTML;
try {
  ({ parseHTML } = await import('linkedom'));
} catch {
  console.log('⏭  tabel responsif: linkedom belum terpasang — jalankan `npm install --no-save linkedom` lebih dulu.');
  process.exit(0);
}

const { document } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.document = document;

const { sapuTabel } = await import('../js/core/tabel-responsif.js');

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

function pasang(html) {
  const wadah = document.createElement('div');
  wadah.innerHTML = html;
  document.body.appendChild(wadah);
  sapuTabel(wadah);
  return wadah;
}

const label = (wadah, pilih = 'table') => [...wadah.querySelector(pilih).querySelectorAll('tbody td')].map((td) => td.getAttribute('data-label'));

// =====================================================================
// DASAR
// =====================================================================
let w = pasang(`
  <table class="data-table">
    <thead><tr><th>Produk</th><th>Stok</th><th>Satuan</th></tr></thead>
    <tbody><tr><td>Gula</td><td>12</td><td>kg</td></tr></tbody>
  </table>`);

cek('label diambil dari judul kolom', label(w), ['Produk', 'Stok', 'Satuan']);
cek('mode kartu dinyalakan', w.querySelector('table').classList.contains('kartu-sempit'), true);
cek('dibungkus .table-scroll', w.querySelector('.table-scroll') !== null, true);

// =====================================================================
// OPT-OUT
// =====================================================================
w = pasang(`
  <table class="data-table tabel-tetap">
    <thead><tr><th>A</th></tr></thead>
    <tbody><tr><td>1</td></tr></tbody>
  </table>`);
cek('tabel-tetap TIDAK dijadikan kartu', w.querySelector('table').classList.contains('kartu-sempit'), false);
cek('  tapi tetap dibungkus penggulir', w.querySelector('.table-scroll') !== null, true);

// =====================================================================
// LABEL YANG DITULIS TANGAN MENANG
//
// Beberapa tabel sengaja memberi label lebih pendek daripada judul kolomnya
// supaya muat di kartu. Menimpanya merusak penyesuaian yang sudah dibuat.
// =====================================================================
w = pasang(`
  <table class="data-table">
    <thead><tr><th>Jumlah tersedia</th><th>Satuan</th></tr></thead>
    <tbody><tr><td data-label="Qty">5</td><td>pcs</td></tr></tbody>
  </table>`);
cek('label tulisan tangan tidak ditimpa', label(w), ['Qty', 'Satuan']);

// =====================================================================
// COLSPAN DI BADAN — PERGESERAN KOLOM
// =====================================================================
w = pasang(`
  <table class="data-table">
    <thead><tr><th>Nama</th><th>Stok</th><th>Satuan</th><th>Nilai</th></tr></thead>
    <tbody>
      <tr><td>Gula</td><td colspan="2">isi membentang</td><td>Rp 10</td></tr>
    </tbody>
  </table>`);
// Sel ber-colspan TIDAK diberi label (ia isi, bukan nilai satu kolom), tapi ia
// tetap menggeser indeks — sel sesudahnya harus "Nilai", bukan "Satuan".
cek('colspan tidak dilabeli tapi tetap menggeser indeks', label(w), ['Nama', null, 'Nilai']);

// =====================================================================
// COLSPAN DI HEADER
// =====================================================================
w = pasang(`
  <table class="data-table">
    <thead><tr><th colspan="2">Identitas</th><th>Stok</th></tr></thead>
    <tbody><tr><td>Gula</td><td>Bahan</td><td>12</td></tr></tbody>
  </table>`);
cek('colspan di header mengisi dua kolom', label(w), ['Identitas', 'Identitas', 'Stok']);

// =====================================================================
// HEADER BERTINGKAT — baris judul TERAKHIR yang dipakai
// =====================================================================
w = pasang(`
  <table class="data-table">
    <thead>
      <tr><th colspan="2">Ringkasan</th></tr>
      <tr><th>Nama</th><th>Stok</th></tr>
    </thead>
    <tbody><tr><td>Gula</td><td>12</td></tr></tbody>
  </table>`);
cek('baris judul terakhir yang dipakai', label(w), ['Nama', 'Stok']);

// =====================================================================
// TABEL DI DALAM TABEL — INI YANG PALING MUDAH SALAH
//
// Tanpa `:scope >`, tabel induk akan mengambil <th> milik tabel anaknya, dan
// SELURUH label di kartu induk bergeser — tetap terlihat masuk akal.
// =====================================================================
w = pasang(`
  <table class="data-table" id="induk">
    <thead><tr><th>Menu</th><th>Porsi</th></tr></thead>
    <tbody>
      <tr><td>Kopi</td><td>3</td></tr>
      <tr><td colspan="2">
        <table class="data-table" id="anak">
          <thead><tr><th>Bahan</th><th>Takaran</th></tr></thead>
          <tbody><tr><td>Gula</td><td>10 g</td></tr></tbody>
        </table>
      </td></tr>
    </tbody>
  </table>`);

const tdInduk = [...w.querySelector('#induk').querySelectorAll(':scope > tbody > tr > td')].map((td) => td.getAttribute('data-label'));
cek('tabel induk memakai judulnya SENDIRI', tdInduk, ['Menu', 'Porsi', null]);
cek('tabel anak memakai judulnya sendiri', label(w, '#anak'), ['Bahan', 'Takaran']);

// =====================================================================
// TIDAK DIPROSES DUA KALI
//
// Pengamat akan melihat perubahan yang kita buat sendiri (pembungkusan
// .table-scroll). Tanpa penanda, tabelnya dibungkus berulang kali sampai
// halaman penuh div bersarang.
// =====================================================================
w = pasang(`
  <table class="data-table">
    <thead><tr><th>A</th></tr></thead>
    <tbody><tr><td>1</td></tr></tbody>
  </table>`);
sapuTabel(w);
sapuTabel(w);
cek('pembungkus tidak digandakan', w.querySelectorAll('.table-scroll').length, 1);

// Yang sudah berada di dalam .table-scroll tidak dibungkus lagi.
w = pasang(`
  <div class="table-scroll">
    <table class="data-table">
      <thead><tr><th>A</th></tr></thead>
      <tbody><tr><td>1</td></tr></tbody>
    </table>
  </div>`);
cek('yang sudah terbungkus dibiarkan', w.querySelectorAll('.table-scroll').length, 1);

// =====================================================================
// BENTUK YANG TIDAK LENGKAP TIDAK BOLEH MELEMPAR
// =====================================================================
w = pasang('<table class="data-table"><tbody><tr><td>tanpa thead</td></tr></tbody></table>');
cek('tanpa thead: tidak melempar, tidak melabeli', label(w), [null]);
cek('  mode kartu tetap menyala', w.querySelector('table').classList.contains('kartu-sempit'), true);

w = pasang('<table class="data-table"><thead><tr><th>A</th></tr></thead></table>');
cek('tanpa tbody aman', w.querySelector('table').dataset.tabelSiap, '1');

w = pasang('<p>tidak ada tabel</p>');
cek('tanpa tabel aman', w.querySelectorAll('.table-scroll').length, 0);

// Sel LEBIH BANYAK daripada judulnya: sisanya dibiarkan tanpa label, bukan
// diberi `undefined`.
w = pasang(`
  <table class="data-table">
    <thead><tr><th>A</th></tr></thead>
    <tbody><tr><td>1</td><td>2</td></tr></tbody>
  </table>`);
cek('sel berlebih tidak dapat label karangan', label(w), ['A', null]);

// =====================================================================
// BARIS SEJAJAR — memilih tata letak lain, bukan menolak diurus
//
// Bedanya dengan `tabel-tetap` halus tapi penting: `tabel-tetap` menolak
// SEMUANYA, sedangkan `baris-sejajar` cuma menolak `kartu-sempit`. Ia tetap
// butuh `data-label` (untuk pembaca layar) dan tetap dibungkus penggulir.
//
// Kalau suatu saat ada yang menyederhanakannya jadi "sama seperti tabel-tetap",
// pembaca layar akan kehilangan judul kolomnya tanpa satu pun tanda di layar.
// =====================================================================
w = pasang(`
  <table class="data-table baris-sejajar">
    <thead><tr><th>Menu</th><th>Harga</th><th>Jumlah</th></tr></thead>
    <tbody><tr><td>Nasi Goreng</td><td>25000</td><td><input /></td></tr></tbody>
  </table>`);
sapuTabel(w);
cek('baris-sejajar: mode kartu TIDAK ditempelkan', w.querySelector('table').classList.contains('kartu-sempit'), false);
cek('baris-sejajar: kelasnya sendiri tetap ada', w.querySelector('table').classList.contains('baris-sejajar'), true);
cek('baris-sejajar: label tetap diisi untuk pembaca layar', label(w), ['Menu', 'Harga', 'Jumlah']);
cek('baris-sejajar: tetap dibungkus penggulir', w.querySelectorAll('.table-scroll').length, 1);

// Dijalankan dua kali tidak menempelkan apa pun secara diam-diam.
sapuTabel(w);
cek('baris-sejajar: sapuan kedua tetap tidak mengartukan', w.querySelector('table').classList.contains('kartu-sempit'), false);

console.log(gagal === 0 ? '✅ tabel responsif: semua lulus' : `❌ tabel responsif: ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
