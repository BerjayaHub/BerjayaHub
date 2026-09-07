/**
 * Menangkap pengambilan daftar yang bisa DIPOTONG DIAM-DIAM oleh server.
 *
 * KENAPA AUDIT INI ADA. PostgREST membatasi jawaban pada sekitar 1.000 baris
 * kalau tidak diminta lain, dan potongan itu BUKAN error — jawabannya sukses,
 * cuma kurang. `listRecipesFull()` mengambil seluruh `recipe_items` satu BU
 * sekaligus; begitu bahannya melewati seribu baris, resep yang berada di
 * belakang antrean pulang tanpa bahan. Layarnya menulis "resep kosong",
 * padahal di database bahannya lengkap dan editor menampilkannya utuh.
 *
 * Yang membuatnya sulit ditemukan: aplikasi ini berjalan bertahun-tahun dengan
 * data kecil tanpa gejala apa pun, lalu mulai kehilangan data begitu tabelnya
 * tumbuh. Tidak ada perubahan kode yang bisa disalahkan, dan tidak ada error
 * yang bisa dicari.
 *
 * ATURANNYA: setiap `select()` pada tabel yang barisnya tumbuh mengikuti
 * pemakaian harus punya SALAH SATU dari:
 *   - `.range(` — diambil bertahap lewat `ambilSemua()`
 *   - `.limit(` — memang sengaja dibatasi (mis. "20 aktivitas terakhir")
 *   - `.single()` / `.maybeSingle()` — memang satu baris
 *
 * Tabel acuan (mis. `units`, `business_units`) sengaja tidak diawasi: jumlahnya
 * ditentukan manusia dan tidak akan pernah mendekati seribu.
 *
 * PENGECUALIAN harus DITULIS ALASANNYA, bukan sekadar dimatikan: taruh komentar
 * `baris-terbatas: <alasan>` tepat di atas querynya. Sebagian pembacaan memang
 * terbatas oleh bentuk datanya sendiri — bahan SATU resep, item SATU kiriman,
 * reservasi SATU tanggal — dan memaksanya bertahap cuma menambah permintaan
 * tanpa menambah keamanan. Yang tidak boleh adalah pengecualian tanpa alasan:
 * setahun lagi tidak ada yang bisa membedakannya dari kelalaian.
 */

const fs = require('fs');
const path = require('path');
const { tanpaKomentar } = require('./lib/tanpa-komentar.cjs');

const AKAR = path.join(__dirname, '..', 'js');

/** Tabel yang barisnya tumbuh mengikuti pemakaian — inilah yang berisiko. */
const TABEL_TUMBUH = [
  'products',
  'recipes',
  'recipe_items',
  'stock_balances',
  'stock_movements',
  'attendance_logs',
  'reservations',
  'cash_entries',
  'checklist_runs',
  'checklist_run_items',
  'dispatches',
  'dispatch_items',
  'orders',
  'order_items',
  'production_logs',
  'menu_plans',
  'sales_entries',
  // Satu baris per orang per hari. Tabel yang paling pasti tumbuh di sistem
  // ini, dan justru tidak diawasi sampai Rekap NBM kehilangan tanggal 31
  // Agustus: `.limit(500)` tanpa paginasi, diurutkan MENURUN, jadi yang
  // terpotong justru tanggal paling lama.
  'attendance_records',
  'goods_receipts',
  'goods_receipt_items'
];

/**
 * Ambang "ini laporan, bukan daftar sepuluh terakhir".
 *
 * `.limit(20)` untuk "aktivitas terbaru" itu batas yang DIMAKSUD: orangnya
 * memang cuma ingin sepuluh baris teratas. `.limit(500)` pada query yang juga
 * menyaring RENTANG TANGGAL adalah hal yang berbeda — orangnya meminta seluruh
 * periode itu, dan yang ia terima diam-diam dipotong.
 *
 * Diperparah oleh urutan menurun: yang hilang selalu bagian TERTUA dari
 * rentang, yaitu tepat bagian yang paling mungkin sedang dicari orang.
 */
const AMBANG_LAPORAN = 100;

/**
 * Seberapa jauh sesudah rantai query masih dianggap bagian dari query itu.
 *
 * 400 karakter sempat cukup, lalu tidak lagi: query yang dibangun bertahap —
 * `.or(...)` panjang, beberapa `if (…) q = q.eq(…)`, baru `.range(...)` —
 * melewatinya, dan `.range()` yang SUDAH ADA jadi tidak terlihat.
 */
const JENDELA = 1200;

function berkasJs(dir, keluar = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) berkasJs(p, keluar);
    else if (e.name.endsWith('.js')) keluar.push(p);
  }
  return keluar;
}

/**
 * Rantai pemanggilan sesudah `.from('tabel')`, sampai `;` di kedalaman kurung 0.
 * Dipisah begini karena rantainya sering menyebar ke banyak baris dan sering
 * disela `if (...) query = query.eq(...)`.
 */
function rantaiSesudah(src, mulai) {
  let i = mulai;
  let dalam = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') dalam++;
    else if (c === ')' || c === ']' || c === '}') dalam--;
    else if (c === ';' && dalam <= 0) break;
    i++;
  }
  return src.slice(mulai, i);
}

let temuan = 0;
let diperiksa = 0;
let dikecualikan = 0;

for (const berkas of berkasJs(AKAR)) {
  // KOMENTAR DIBUANG DULU.
  //
  // Audit ini sempat menuduh `attendance.service.js` memakai `.limit(500)` —
  // padahal yang ditemukannya adalah komentar yang MENJELASKAN kenapa
  // `.limit(500)` sudah dibuang. Kelemahan yang berulang di repo ini: pola
  // dicari di teks mentah, lalu penjelasan tentang sebuah bug dibaca sebagai
  // bug itu sendiri.
  //
  // `tanpaKomentar` mengganti komentar dengan SPASI, jadi panjang & nomor
  // barisnya tetap sama.
  const mentah = fs.readFileSync(berkas, 'utf8');
  const src = tanpaKomentar(mentah);
  const rel = path.relative(path.join(__dirname, '..'), berkas);

  for (const tabel of TABEL_TUMBUH) {
    const pola = new RegExp(`\\.from\\(['"]${tabel}['"]\\)`, 'g');
    for (const m of src.matchAll(pola)) {
      // Hanya pembacaan yang diawasi. Penulisan sudah dijaga audit lain.
      const rantai = rantaiSesudah(src, m.index);
      if (!/\.select\(/.test(rantai)) continue;
      if (/\.(insert|update|upsert|delete)\(/.test(rantai)) continue;
      diperiksa++;

      // LAPORAN BERENTANG TANGGAL TIDAK BOLEH DIBATASI `.limit()` SAJA.
      //
      // `.limit(20)` untuk "aktivitas terbaru" adalah batas yang DIMAKSUD.
      // `.limit(500)` pada query yang juga menyaring rentang tanggal adalah
      // hal lain: orangnya meminta seluruh periode itu, dan yang ia terima
      // diam-diam dipotong. Diperparah urutan menurun — yang hilang selalu
      // bagian TERTUA dari rentangnya.
      //
      // Persis yang terjadi di Rekap NBM: rentang 31 Agustus–5 September
      // tampil, 31 Agustusnya tidak ada, dan tidak ada satu pun error.
      // DIPERIKSA PADA JENDELA YANG LEBAR, bukan cuma rantai sampai `;`.
      //
      // Query begini dibangun bertahap:
      //
      //     let q = supabase.from('attendance_records').select(...).order(...);
      //     if (dateFrom) q = q.gte('clock_in_at', dateFrom);
      //     return q.limit(500);
      //
      // Rantai sampai titik-koma pertamanya berhenti di `.order(...)` dan tidak
      // memuat `.gte(` maupun `.limit(` sama sekali. Percobaan pertama aturan
      // ini memeriksa rantai itu saja — dan sabotase yang mengembalikan
      // `.limit(500)` LOLOS.
      const jendela = src.slice(m.index, m.index + rantai.length + JENDELA);
      const batas = jendela.match(/\.limit\(\s*(\d+)/);
      const berentang = /\.gte\(|\.lte\(/.test(jendela);
      if (batas && berentang && Number(batas[1]) >= AMBANG_LAPORAN && !/\.range\(/.test(jendela)) {
        const sebelumnya = mentah.slice(0, m.index).split('\n').slice(-6).join('\n');
        if (!/baris-terbatas:/.test(sebelumnya)) {
          temuan++;
          const baris = src.slice(0, m.index).split('\n').length;
          console.error(
            `❌ ${rel}:${baris} — "${tabel}" disaring rentang tanggal tapi dibatasi .limit(${batas[1]}) tanpa paginasi. ` +
              'Orangnya meminta seluruh periode; yang dipotong justru bagian TERTUA dari rentang itu, dan potongannya bukan error. ' +
              'Pakai ambilSemua() dari js/core/ambil-semua.js.'
          );
          continue;
        }
      }

      const aman = /\.range\(|\.limit\(|\.single\(|\.maybeSingle\(/.test(rantai);
      if (aman) continue;

      // Pengecualian beralasan: komentar `baris-terbatas: …` dalam 6 baris
      // sebelum querynya.
      // Dibaca dari sumber MENTAH: pengecualiannya justru ditulis DI KOMENTAR,
      // dan `src` sudah dibersihkan dari komentar. Percobaan pertama membacanya
      // dari `src` — seluruh delapan pengecualian beralasan langsung hangus.
      const sebelum = mentah.slice(0, m.index).split('\n').slice(-6).join('\n');
      if (/baris-terbatas:/.test(sebelum)) {
        dikecualikan++;
        continue;
      }

      // Variabel query yang dibangun bertahap: cari `.range(`/`.limit(` di
      // sekitar rantainya, karena batasnya sering ditambahkan beberapa baris
      // sesudah `.from(...)`.
      const sekitar = src.slice(m.index, m.index + rantai.length + JENDELA);
      if (/\.range\(|\.limit\(/.test(sekitar)) continue;

      temuan++;
      const baris = src.slice(0, m.index).split('\n').length;
      console.error(
        `❌ ${rel}:${baris} — membaca "${tabel}" tanpa .range()/.limit(). ` +
          `Server memotong di ~1.000 baris TANPA error; sisanya hilang diam-diam. ` +
          `Pakai ambilSemua() dari js/core/ambil-semua.js.`
      );
    }
  }
}

if (temuan) {
  console.error(`\n${temuan} pembacaan berisiko terpotong. Gejalanya baru muncul setelah datanya besar, dan tidak akan terlihat sebagai error.`);
  process.exit(1);
}
console.log(`${diperiksa} pembacaan tabel yang bisa tumbuh diperiksa — ${dikecualikan} dikecualikan beralasan, sisanya bertahap atau dibatasi. ✅`);
