/**
 * SEMUA TABEL IKUT UKURAN LAYAR — tanpa perlu diingat satu per satu.
 *
 * ============ MASALAHNYA ============
 *
 * Mode kartu (`kartu-sempit`) sudah ada dan sudah rapi: di bawah 560px tiap
 * baris jadi kartu dengan label di kiri dan nilai di kanan. Tapi ia OPT-IN —
 * setiap tabel harus menuliskan kelasnya sendiri, dan tiap sel harus menuliskan
 * `data-label`-nya sendiri.
 *
 * Hasilnya bisa dihitung: dari 86 tabel di aplikasi ini, **57 tidak pernah
 * memakainya**. Di ponsel, kelima puluh tujuh itu jadi tabel `white-space:
 * nowrap` yang harus digeser ke samping untuk dibaca — persis keluhan yang
 * datang dari lapangan.
 *
 * Dan ini bukan kelalaian yang bisa diselesaikan dengan "lain kali jangan
 * lupa". Tabel yang lupa memakainya tetap tampil benar di layar lebar, yaitu
 * layar tempat orang menulis kodenya. Tidak ada satu pun tanda pada saat
 * pembuatannya.
 *
 * ============ YANG DIUBAH ============
 *
 * Dibalik jadi OPT-OUT. Berkas ini mengurus tiga hal untuk setiap tabel yang
 * muncul di halaman, kapan pun ia muncul:
 *
 *   1. Menambahkan `kartu-sempit` — kecuali tabelnya menolak dengan `tabel-tetap`.
 *   2. Mengisi `data-label` tiap sel DARI JUDUL KOLOMNYA.
 *   3. Membungkusnya dengan `.table-scroll` kalau belum, supaya di lebar
 *      menengah (tablet, jendela desktop yang disempitkan) ia menggulir di
 *      dalam wadahnya alih-alih mendorong seluruh halaman melebar.
 *
 * Nomor 2 yang paling berarti. Sebelumnya `data-label` diketik tangan di
 * ratusan sel, dan sel yang terlewat muncul sebagai angka telanjang di tengah
 * kartu yang sel lainnya berlabel rapi — **lebih** membingungkan daripada
 * tabel tanpa label sama sekali. Diambil dari `<th>`-nya, labelnya tidak bisa
 * salah dan tidak bisa ketinggalan saat judul kolomnya diubah.
 *
 * ============ KENAPA MutationObserver, BUKAN DIPANGGIL TIAP RENDER ============
 *
 * Tabel di aplikasi ini digambar dari puluhan tempat: modul, tab di dalam
 * modul, panel yang dibuka, dan dialog. Kalau tiap tempat harus memanggil
 * sesuatu sesudah menggambar, kita kembali ke masalah semula — satu tempat
 * yang lupa, dan tidak ada tanda apa pun sampai seseorang membukanya di HP.
 *
 * Pengamat dipasang sekali di `document.body` dan menangkap semuanya, termasuk
 * yang belum ditulis.
 */

/** Tabel yang sengaja menolak mode kartu menuliskan kelas ini. */
const KELAS_TOLAK = 'tabel-tetap';

/**
 * Penanda sudah diurus.
 *
 * JUJURNYA: ini penghematan, BUKAN penjagaan. Sabotase yang membuangnya tidak
 * membuat satu pun tes merah, dan memang seharusnya begitu — `bungkusGulir()`
 * sudah menolak membungkus ulang tabel yang induknya `.table-scroll`, jadi
 * tidak ada gelung tak berujung walau pengamat melihat perubahan kita sendiri.
 * Yang dihemat penanda ini cuma pekerjaan yang terulang.
 *
 * Ditulis apa adanya supaya tidak ada yang mengira baris ini yang menahan
 * sesuatu, lalu membangun asumsi di atasnya.
 */
const PENANDA = 'tabelSiap';

let terpasang = false;

/**
 * Judul kolom sebuah tabel.
 *
 * `:scope >` dipakai di mana-mana di berkas ini. Tanpa itu, tabel yang punya
 * tabel lain di dalamnya (panel resep di dalam baris menu) akan mengambil
 * `<th>` milik anaknya, dan seluruh label di kartu induknya bergeser satu
 * kolom — salah dengan cara yang tetap terlihat masuk akal.
 */
function judulKolom(tabel) {
  const barisJudul = [...tabel.querySelectorAll(':scope > thead > tr')].pop();
  if (!barisJudul) return [];

  const judul = [];
  for (const th of barisJudul.querySelectorAll(':scope > th')) {
    // `colspan` di header menggeser pemetaan kolom. Diisi berulang supaya
    // indeksnya tetap sejajar dengan sel di badan tabel.
    const rentang = Math.max(1, Number(th.getAttribute('colspan') ?? 1));
    const teks = (th.textContent ?? '').trim();
    for (let i = 0; i < rentang; i++) judul.push(teks);
  }
  return judul;
}

function isiLabel(tabel) {
  const judul = judulKolom(tabel);
  if (!judul.length) return;

  for (const tbody of tabel.querySelectorAll(':scope > tbody')) {
    for (const tr of tbody.querySelectorAll(':scope > tr')) {
      let kolom = 0;
      for (const td of tr.querySelectorAll(':scope > td')) {
        const rentang = Math.max(1, Number(td.getAttribute('colspan') ?? 1));

        // Sel yang ditulis tangan menang. Beberapa tabel memberi label yang
        // lebih pendek daripada judul kolomnya justru supaya muat di kartu
        // ("Qty" untuk "Jumlah tersedia"), dan menimpanya akan merusak
        // penyesuaian yang sudah sengaja dibuat.
        //
        // Sel ber-colspan juga dilewati: ia isi yang membentang penuh (panel
        // rincian, pesan "belum ada data"), bukan nilai satu kolom. CSS sudah
        // menanganinya lewat `td[colspan]`.
        if (!td.hasAttribute('data-label') && rentang === 1 && judul[kolom]) {
          td.setAttribute('data-label', judul[kolom]);
        }
        kolom += rentang;
      }
    }
  }
}

function bungkusGulir(tabel) {
  const induk = tabel.parentElement;
  if (!induk || induk.classList.contains('table-scroll')) return;

  const wadah = document.createElement('div');
  wadah.className = 'table-scroll';
  induk.insertBefore(wadah, tabel);
  wadah.appendChild(tabel);
}

function urus(tabel) {
  if (tabel.dataset[PENANDA]) return;
  tabel.dataset[PENANDA] = '1';

  if (!tabel.classList.contains(KELAS_TOLAK)) tabel.classList.add('kartu-sempit');
  isiLabel(tabel);
  bungkusGulir(tabel);
}

/**
 * Urus semua tabel di dalam sebuah simpul.
 *
 * Diekspor supaya bisa diuji tanpa `MutationObserver` — dan supaya kalau suatu
 * saat ada layar yang menyusun DOM-nya di luar `document` (mis. untuk diukur
 * dulu sebelum ditempel), ia punya cara memanggilnya sendiri.
 */
export function sapuTabel(akar) {
  if (!akar || akar.nodeType !== 1) return;
  if (akar.matches?.('table.data-table')) urus(akar);
  for (const t of akar.querySelectorAll?.('table.data-table') ?? []) urus(t);
}

const sapu = sapuTabel;

/**
 * Pasang sekali saat aplikasi dimulai. Aman dipanggil berkali-kali.
 */
export function pasangTabelResponsif() {
  if (terpasang) return;
  terpasang = true;

  sapu(document.body);

  const pengamat = new MutationObserver((perubahan) => {
    for (const p of perubahan) {
      for (const simpul of p.addedNodes) sapu(simpul);
    }
  });

  // `subtree: true` wajib: tabel hampir tidak pernah ditambahkan langsung ke
  // body — ia muncul jauh di dalam `#module-content`, di dalam panel yang
  // dibuka, atau di dalam dialog yang ditempelkan ke body belakangan.
  pengamat.observe(document.body, { childList: true, subtree: true });
}
