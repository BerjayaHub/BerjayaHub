/**
 * AUDIT: pindah antar aplikasi harus lewat TAUTAN, bukan tombol.
 *
 * ============ YANG DILAPORKAN ============
 *
 *   "saat saya klik kanan untuk buka di tab baru tidak bisa ... saya klik kanan
 *    tombol staff app untuk membuka staff app di tab baru, agar ada 2 yang
 *    terbuka sekaligus"
 *
 * Pintasan Staff App ↔ Admin Portal ↔ Owner dulu `<button>` yang memanggil
 * `window.location.href`. Terlihat sama persis dengan tautan, dan bekerja
 * sempurna untuk klik biasa — jadi tidak ada yang terasa salah sampai seseorang
 * mencoba membuka dua aplikasi berdampingan.
 *
 * Yang hilang diam-diam pada `<button>`:
 *
 *   - klik kanan -> "Buka tautan di tab baru" (menunya tidak muncul sama sekali)
 *   - klik tengah
 *   - Ctrl/Cmd+klik
 *   - seret ke bilah tab, salin alamat tautan, "Buka di jendela baru"
 *
 * Semuanya didapat gratis dari `<a href>`, tanpa satu baris JavaScript.
 *
 * ============ DAN PENANGAN KLIKNYA HARUS DIBUANG ============
 *
 * Menjadikannya `<a href>` tapi tetap memasang `addEventListener('click', …)`
 * yang memanggil `location.href` justru MERUSAKNYA lagi: penangan itu berjalan
 * juga saat Ctrl/Cmd+klik, sehingga tab lama ikut berpindah halaman sementara
 * tab barunya terbuka. Orangnya kehilangan layar yang sedang ia kerjakan —
 * gejala yang lebih membingungkan daripada bug aslinya.
 *
 * Karena itu audit ini memeriksa DUA hal, bukan satu.
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.dirname(__dirname);
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

/** id -> halaman tujuannya. Ditulis satu per satu supaya tidak ada yang terlewat. */
const PINTASAN = {
  'btn-to-staff': 'index.html',
  'btn-to-admin': 'admin.html',
  'btn-to-owner': 'owner.html',
  'btn-ke-staff': 'index.html',
  'btn-ke-admin': 'admin.html',
  'btn-ke-owner': 'owner.html'
};

const BERKAS = ['js/main-admin.js', 'js/main-staff.js', 'js/main-owner.js'];

let ditemukan = 0;

for (const rel of BERKAS) {
  const p = path.join(AKAR, rel);
  if (!fs.existsSync(p)) {
    salah(`${rel} tidak ada — audit ini kehilangan sasarannya.`);
    continue;
  }
  const isi = fs.readFileSync(p, 'utf8');

  for (const [id, tujuan] of Object.entries(PINTASAN)) {
    // Tiap kemunculan id-nya sebagai elemen, apa pun jenis tagnya.
    const re = new RegExp(`<(\\w+)([^>]*\\bid="${id}"[^>]*)>`, 'g');
    for (const m of isi.matchAll(re)) {
      ditemukan++;
      const tag = m[1];
      const atribut = m[2];

      if (tag !== 'a') {
        salah(
          `${rel}: \`${id}\` digambar sebagai <${tag}>, bukan <a>. ` +
            'Klik kanan "buka di tab baru", klik tengah, dan Ctrl/Cmd+klik semuanya tidak berfungsi pada ' +
            'elemen selain tautan — dan tidak ada satu pun tanda bahwa ketiganya hilang.'
        );
        continue;
      }
      if (!new RegExp(`href="\\./${tujuan.replace('.', '\\.')}"`).test(atribut)) {
        salah(
          `${rel}: \`${id}\` tidak punya \`href="./${tujuan}"\`. ` +
            'Tautan tanpa href tidak bisa dibuka di tab baru — ia hanya terlihat seperti tautan.'
        );
      }
    }

    // Penangan klik yang menavigasi = merusak Ctrl/Cmd+klik.
    const rePenangan = new RegExp(
      `getElementById\\('${id}'\\)[\\s\\S]{0,120}addEventListener\\('click'[\\s\\S]{0,200}?location\\.href`
    );
    if (rePenangan.test(isi)) {
      salah(
        `${rel}: \`${id}\` masih punya penangan klik yang memanggil \`location.href\`. ` +
          'Penangan itu berjalan juga saat Ctrl/Cmd+klik, jadi tab LAMA ikut berpindah halaman sementara ' +
          'tab barunya terbuka — orangnya kehilangan layar yang sedang ia kerjakan.'
      );
    }
  }
}

if (ditemukan < 6) {
  salah(
    `hanya ${ditemukan} pintasan antar-aplikasi yang ditemukan (diharapkan ≥ 6). ` +
      'Audit ini kehilangan sasarannya, jadi dilaporkan gagal daripada lolos tanpa memeriksa apa pun.'
  );
}

// CSS-nya harus ikut mengenali <a>, kalau tidak tautannya kehilangan bentuk
// tombolnya dan muncul bergaris bawah biru di tengah header.
const css = fs.readFileSync(path.join(AKAR, 'css/styles.css'), 'utf8');

/**
 * SELEKTORNYA HARUS BERAKHIR DI SITU — bukan sekadar diawali begitu.
 *
 * Percobaan pertama memakai `/\.app-switch\s+a\b/` dan `/\.tombol-tautan\b/`.
 * Keduanya LOLOS dari sabotase:
 *
 *   - `.app-switch a` masih cocok dengan `.app-switch a span` dan
 *     `.app-switch a:hover`, yang tetap ada walau aturan DASAR-nya dihapus.
 *     Tautannya kehilangan bentuk tombolnya, auditnya tetap hijau.
 *   - `\b` sesudah "tautan" adalah batas kata SEBELUM tanda hubung, jadi
 *     `.tombol-tautan` cocok dengan `.tombol-tautan-x` — nama yang sudah tidak
 *     dipakai siapa pun.
 *
 * Ini kelemahan substring yang sama yang sudah beberapa kali muncul di repo
 * ini. Yang dituntut sekarang: selektornya diikuti `{` atau `,` — artinya ia
 * benar-benar kepala sebuah aturan, bukan awalan dari selektor lain.
 */
const aturanAda = (selektor) =>
  new RegExp(`${selektor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[,{]`).test(css);

if (!aturanAda('.app-switch a')) {
  salah(
    'css/styles.css: tidak ada aturan yang kepalanya `.app-switch a`. ' +
      'Pintasannya sekarang tautan, jadi tanpa ini ia tampil sebagai teks bergaris bawah di tengah header.'
  );
}
if (!aturanAda('.tombol-tautan')) {
  salah('css/styles.css: kelas `.tombol-tautan` tidak ada, padahal dipakai di main-owner.js.');
}

// Dan kelasnya memang dipakai — kelas yang ada tapi tidak terpasang berarti
// tautannya tampil telanjang, dan CSS-nya lulus audit tanpa menolong siapa pun.
if (!/class="tombol-tautan"/.test(fs.readFileSync(path.join(AKAR, 'js/main-owner.js'), 'utf8'))) {
  salah('js/main-owner.js: `.tombol-tautan` tidak dipasang pada pintasannya.');
}

if (gagal === 0) {
  console.log(
    `Pindah antar aplikasi: ${ditemukan} pintasan, semuanya <a href> tanpa penangan klik yang menavigasi. ✅`
  );
}
process.exit(gagal === 0 ? 0 : 1);
