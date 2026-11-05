/**
 * AUDIT: urutan daftar aset — yang ada di outlet ini di baris atas.
 *
 * ============ CARA PERUBAHAN INI HILANG TANPA TERLIHAT HILANG ============
 *
 * Yang dijaga di sini bukan "apakah daftarnya terurut" — daftar yang terurut
 * salah tetap terlihat terurut. Yang dijaga: apakah urutannya masih MEMBEDAKAN
 * hal yang diminta dibedakan.
 *
 *   `rows.sort(urutKode)` kembali   -> daftarnya tetap rapi, tetap berurutan,
 *     (mis. saat ada yang              dan delapan barang yang benar-benar ada
 *      merapikan import)               di rak kembali terselip di antara 135
 *                                      baris kosong. Tidak ada galat, tidak
 *                                      ada yang berubah warna.
 *
 *   kelompoknya jadi dua             -> "habis" dan "belum didata" jadi satu
 *     (belumDidata ikut ke 1)          blok. Pekerjaan opname yang belum
 *                                      pernah dikerjakan tidak lagi bisa
 *                                      dilihat dari urutannya.
 *
 *   dibandingkan sebagai TEKS        -> '0' dan '10' sama-sama "ada isinya",
 *     (`a.qty > 0` tanpa `Number`)     karena kolom numeric datang dari
 *                                      PostgREST sebagai string. Barisnya
 *                                      naik ke atas dengan angka 0 terpampang
 *                                      di sebelahnya.
 *
 *   ada yang mengurutkan lagi        -> sort kedua di layar atau di ekspor
 *     sesudahnya                       membatalkan yang pertama, dan yang
 *                                      pertama tetap ada di kode sebagai
 *                                      bukti bahwa "sudah dikerjakan".
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

/**
 * Dibaca TANPA KOMENTAR.
 *
 * Berkas-berkas ini menjelaskan dirinya panjang, dan penjelasannya MENGUTIP
 * kode yang diperiksa audit ini (`urutDaftarAset`, `belumDidata`). Audit yang
 * membaca berkas mentah tetap hijau walaupun kodenya sudah dihapus, selama
 * komentarnya belum ikut dihapus — dan komentar adalah hal terakhir yang
 * dihapus orang.
 */
const bacaKode = (rel) => {
  const asli = baca(rel);
  if (!asli) return null;
  const kode = tanpaKomentar(asli);
  const pesan = periksaKewarasan(asli, kode, ['urutDaftarAset', 'belumDidata']);
  if (pesan) {
    salah(`${rel}: ${pesan} — audit ini tidak bisa dipercaya untuk berkas itu.`);
    return null;
  }
  return kode;
};

const ATURAN = 'js/modules/asset/aturan-aset-bu.js';
const SVC = 'js/modules/asset/asset.service.js';
const PAGE = 'js/modules/asset/asset.page.js';
const TES = 'tools/test-aturan-aset-bu.mjs';

// =====================================================================
// 1. Aturannya
// =====================================================================
const aturan = bacaKode(ATURAN);
if (aturan) {
  const blok = (nama) => {
    const i = aturan.indexOf(`export function ${nama}(`);
    if (i < 0) return null;
    const j = aturan.indexOf('\n}', i);
    return j < 0 ? aturan.slice(i) : aturan.slice(i, j + 2);
  };

  const kel = blok('kelompokStok');
  if (!kel) {
    salah(`${ATURAN}: \`kelompokStok\` tidak ada — tidak ada yang memutuskan baris mana yang di atas.`);
  } else {
    // ============ TIGA KELOMPOK, DAN YANG BELUM DIDATA PALING BAWAH ============
    if (!/belumDidata\) return 2/.test(kel)) {
      salah(
        `${ATURAN}: \`belumDidata\` tidak lagi jadi kelompok tersendiri yang paling bawah. ` +
          '"Habis" adalah jawaban, "belum didata" adalah pertanyaan — digabung, keduanya jadi tidak terbaca.'
      );
    }
    // Angkanya HARUS lewat `Number()`. Kolom numeric datang sebagai teks dari
    // PostgREST, dan '0' > 0 bernilai false hanya karena JS memaksanya jadi
    // angka di operator itu — tapi '0' yang dibandingkan sebagai teks di
    // tempat lain tidak. Yang menjadikannya aman di sini adalah `Number(...)
    // || 0`, yang juga menolak NaN.
    if (!/\(Number\(a\?\.qty\) \|\| 0\) > 0/.test(kel)) {
      salah(
        `${ATURAN}: \`qty\` tidak dibaca lewat \`Number(...) || 0\`. ` +
          'Nilai cacat atau kosong akan jadi NaN, dan NaN > 0 selalu false — barisnya ikut ke bawah tanpa alasan.'
      );
    }
  }

  const urut = blok('urutDaftarAset');
  if (!urut) {
    salah(`${ATURAN}: \`urutDaftarAset\` tidak ada.`);
  } else {
    if (!/kelompokStok\(a\)/.test(urut) || !/kelompokStok\(b\)/.test(urut)) {
      salah(`${ATURAN}: \`urutDaftarAset\` tidak memakai \`kelompokStok\` untuk KEDUA sisinya.`);
    }
    // Di dalam satu kelompok urutannya tetap kode. Tanpa ini, urutan di dalam
    // kelompok ditentukan urutan masuk dari database — dan barang berpindah
    // baris tiap kali layarnya dibuka.
    if (!/urutKode\(a\?\.kode, b\?\.kode\)/.test(urut)) {
      salah(
        `${ATURAN}: di dalam satu kelompok urutannya bukan kode lagi. ` +
          'Urutan yang tidak tetap membuat barang berpindah baris tiap kali layarnya dibuka.'
      );
    }
    // Mengurutkan menurut JUMLAH akan membuat barisnya berpindah tiap ada yang
    // dipakai sebiji — itu lebih membingungkan daripada urut kode.
    if (/\bqty\b/.test(urut)) {
      salah(`${ATURAN}: \`urutDaftarAset\` mengurutkan menurut jumlah — barisnya akan berpindah tiap kali stok berubah.`);
    }
  }

  if (!fs.existsSync(path.join(AKAR, TES))) {
    salah(`${TES} tidak ada — aturannya tidak dibuktikan di mana pun.`);
  } else {
    const tes = fs.readFileSync(path.join(AKAR, TES), 'utf8');
    // Yang diperiksa: NAMANYA DIPANGGIL di tesnya, bukan cuma ikut diimpor.
    // Impor yang tidak dipakai lolos `node --check` dan lolos tesnya.
    for (const nama of ['kelompokStok', 'urutDaftarAset']) {
      if ((tes.match(new RegExp(`${nama}\\(`, 'g')) ?? []).length < 2) {
        salah(`${TES}: \`${nama}\` hampir tidak diuji — diimpor bukan berarti dijalankan.`);
      }
    }
  }
}

// =====================================================================
// 2. Yang benar-benar dipakai layanan
// =====================================================================
//
// Diperiksa DI DALAM `listAssets`, bukan di seluruh berkas: `urutKode` memang
// masih dipakai di tempat lain, dan mencari namanya di berkas utuh membuat
// pemeriksaan ini tidak pernah merah.
const svc = bacaKode(SVC);
if (svc) {
  const i = svc.indexOf('export async function listAssets(');
  const badan = i < 0 ? null : svc.slice(i, svc.indexOf('\n}', i));
  if (!badan) {
    salah(`${SVC}: \`listAssets\` tidak ditemukan.`);
  } else {
    if (!/return rows\.sort\(urutDaftarAset\);/.test(badan)) {
      salah(
        `${SVC}: \`listAssets\` tidak mengembalikan \`rows.sort(urutDaftarAset)\`. ` +
          'Aturannya boleh ada dan tetap tidak dipakai — daftarnya akan kembali urut kode saja, dan tetap terlihat rapi.'
      );
    }
    if (/\.sort\(urutKode\)/.test(badan)) {
      salah(`${SVC}: \`listAssets\` masih mengurutkan dengan \`urutKode\` saja.`);
    }
    // Dua sort di satu fungsi berarti yang terakhir yang menang, dan yang
    // pertama tinggal jadi bukti palsu bahwa urutannya sudah diatur.
    const berapa = (badan.match(/\.sort\(/g) ?? []).length;
    if (berapa > 1) {
      salah(`${SVC}: ada ${berapa} pengurutan di \`listAssets\` — yang terakhir membatalkan yang sebelumnya.`);
    }
  }
}

// =====================================================================
// 3. Tidak diurutkan ULANG di layar
// =====================================================================
//
// Layar & ekspornya memakai `rows` apa adanya. Satu `rows.sort(...)` di sini
// membatalkan seluruh perubahan ini tanpa menyentuh berkas mana pun yang
// diperiksa di atas.
const page = bacaKode(PAGE);
if (page && /\browsE?\.sort\(|\brows\.sort\(|\[\.\.\.rows\]\.sort\(/.test(page)) {
  salah(
    `${PAGE}: daftarnya diurutkan ULANG di layar. ` +
      'Urutan dari `listAssets` jadi tidak berarti, sementara kodenya di layanan tetap ada.'
  );
}

console.log('');
if (gagal === 0) console.log('Audit urutan daftar aset bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
