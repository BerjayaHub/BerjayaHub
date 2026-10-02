/**
 * AUDIT: ada sabotase yang TERTINGGAL di berkas repo?
 *
 * ============ KEJADIAN YANG MELAHIRKANNYA ============
 *
 * Setiap `tools/sabotase-*.mjs` bekerja dengan merusak berkas sungguhan, lalu
 * memulihkannya lewat `process.on('exit', pulih)`. Itu menutup keluar normal,
 * Ctrl-C, dan SIGTERM — tapi TIDAK menutup SIGKILL.
 *
 * Dan SIGKILL itu bukan hal langka: ia terjadi setiap kali harness-nya kena
 * batas waktu dari luar, atau kehabisan memori saat beberapa PGlite berjalan
 * sekaligus. Keduanya terjadi di sesi yang sama.
 *
 * Yang tertinggal TIDAK terlihat sebagai apa pun:
 *
 *     if false then
 *       raise exception 'Kas keluar harus menyebut outlet peruntukannya.';
 *     end if;
 *
 * Migration-nya tetap sah, aplikasinya tetap jalan, auditnya tetap hijau —
 * `grep` untuk kalimat penjaganya tetap ketemu, karena kalimatnya memang masih
 * di sana. Satu-satunya tandanya adalah satu tes PGlite yang merah entah
 * kenapa, berjam-jam kemudian, pada migration yang tidak sedang disentuh
 * siapa pun. Mencarinya dari situ berarti mencari di tempat yang salah.
 *
 * Sekarang setiap harness menulis `tools/.sabotase-aktif` SEBELUM berkas
 * pertama dirusak dan membuangnya sesudah semuanya pulih. Berkas itu yang
 * dibaca di sini — satu-satunya hal yang bisa bertahan melewati SIGKILL.
 *
 * ============ KENAPA BUKAN MEMERIKSA POLANYA ============
 *
 * Karena bentuk sabotasenya tidak terbatas: `if false then`, konstanta yang
 * diganti, satu baris yang dihapus. Yang terakhir khususnya tidak meninggalkan
 * jejak tekstual apa pun untuk dicari. Penanda kehadiran bisa; penanda bentuk
 * tidak.
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.dirname(__dirname);
const PENANDA = path.join(AKAR, 'tools/.sabotase-aktif');

let gagal = 0;

if (fs.existsSync(PENANDA)) {
  gagal++;
  const isi = fs.readFileSync(PENANDA, 'utf8').trim();
  console.error('❌ ADA SABOTASE YANG TERTINGGAL DI BERKAS REPO.');
  console.error(`   ${isi || '(penandanya kosong)'}`);
  console.error('');
  console.error('   Harness-nya mati sebelum memulihkan berkasnya — hampir selalu karena di-SIGKILL');
  console.error('   (kena batas waktu dari luar, atau kehabisan memori).');
  console.error('');
  console.error('   JALANKAN ULANG harness yang disebut di atas sampai selesai; ia memulihkan');
  console.error('   seluruh berkasnya di awal dan di akhir. Sesudah itu penanda ini hilang sendiri.');
  console.error('   Kalau harness-nya sudah tidak ada, pulihkan berkas yang disebut dari git.');
}

// Kewarasan: audit yang sasarannya tidak ada tidak boleh melapor "bersih".
const jumlahHarness = fs.readdirSync(path.join(AKAR, 'tools')).filter((f) => /^sabotase-.*\.mjs$/.test(f)).length;
if (jumlahHarness === 0) {
  gagal++;
  console.error('❌ tidak ada satu pun tools/sabotase-*.mjs — audit ini kehilangan sasarannya.');
}

// Dan setiap harness HARUS memasang penandanya. Yang tidak memasangnya adalah
// lubang persis sebesar harness itu: kalau ia yang di-SIGKILL, tidak ada yang
// tertinggal untuk dibaca di sini.
const tanpaPenanda = fs
  .readdirSync(path.join(AKAR, 'tools'))
  .filter((f) => /^sabotase-.*\.mjs$/.test(f))
  .filter((f) => {
    const isi = fs.readFileSync(path.join(AKAR, 'tools', f), 'utf8');
    return !isi.includes('.sabotase-aktif') || !/\btandai\(/.test(isi) || !/\blepasTanda\(\);/.test(isi);
  });
if (tanpaPenanda.length) {
  gagal++;
  console.error(
    `❌ ${tanpaPenanda.length} harness tidak memasang penanda "sabotase sedang terpasang": ${tanpaPenanda.join(', ')}.\n` +
      '   Kalau salah satunya di-SIGKILL, sabotasenya tertinggal tanpa satu pun jejak yang bisa dibaca.'
  );
}

console.log('');
if (gagal === 0) console.log(`Tidak ada sisa sabotase; ${jumlahHarness} harness semuanya berpenanda. ✅`);
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
