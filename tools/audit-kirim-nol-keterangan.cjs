/**
 * AUDIT: baris kiriman ber-jumlah NOL & kolom keterangan (0132).
 *
 * ============ SATU AKAR, TIGA KELUHAN ============
 *
 * Ketiga permintaan pengguna berasal dari keputusan yang sama di 0103: baris
 * ber-qty nol DIBUANG. Akibatnya barang yang diorder tapi tidak dikirim lenyap
 * dari surat jalan — bukan tercatat sebagai nol, melainkan seolah-olah tidak
 * pernah diminta.
 *
 * Di lapangan itu jadi pertanyaan yang tidak bisa dijawab siapa pun: outlet
 * yakin sudah memesan, CK yakin tidak ada di daftar, dan tidak ada dokumen yang
 * menengahi.
 *
 * Yang dijaga:
 *
 *   1. RPC menyimpan baris nol (`< 0`, bukan `<= 0`), tapi menolak minus.
 *   2. Menyunting draft tidak menghapus `keterangan`/`ordered_qty` yang tidak
 *      dikirim ulang klien — PWA lama tidak mengenal kedua kolom itu.
 *   3. Outlet hanya MELENGKAPI keterangan yang kosong, tidak menimpa milik CK.
 *   4. Kotak "Dikirim" di layar CK KOSONG, dan seluruh baris ikut terkirim
 *      (termasuk yang nol) saat draft dibuat.
 *   5. Sisi outlet menampilkan jumlah diminta, baris nol, dan kotak keterangan.
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
// Migration
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0132_kiriman_nol_dan_keterangan.sql');
if (mig) {
  for (const kol of ['keterangan', 'ordered_qty']) {
    if (!new RegExp(`alter table dispatch_items add column if not exists ${kol}`).test(mig)) {
      salah(`0132: kolom \`dispatch_items.${kol}\` tidak dibuat.`);
    }
  }

  const blokBuat = mig.slice(mig.indexOf('function buat_draft_kiriman('), mig.indexOf('function ubah_draft_kiriman('));
  const blokUbah = mig.slice(mig.indexOf('function ubah_draft_kiriman('), mig.indexOf('function lengkapi_keterangan_kiriman('));

  for (const [nama, blok] of [
    ['buat_draft_kiriman', blokBuat],
    ['ubah_draft_kiriman', blokUbah]
  ]) {
    // 1. NOL LOLOS, MINUS DITOLAK. Ini inti seluruh migration-nya.
    if (/v_qty <= 0 then continue/.test(blok)) {
      salah(
        `0132 \`${nama}\`: masih membuang baris ber-qty nol (\`v_qty <= 0\`). ` +
          'Barang yang diorder tapi tidak dikirim akan lenyap dari surat jalan, persis keluhan yang sedang diperbaiki.'
      );
    }
    if (!/v_qty < 0 then continue/.test(blok)) {
      salah(`0132 \`${nama}\`: tidak menolak jumlah kirim MINUS. Nol punya arti; minus akan menambah stok CK saat diterima.`);
    }
    for (const kol of ['keterangan', 'ordered_qty']) {
      if (!new RegExp(`${kol}`).test(blok)) salah(`0132 \`${nama}\`: tidak menyimpan \`${kol}\`.`);
    }
    // Draft yang SELURUH barisnya nol bukan surat jalan.
    if (!/v_positif = 0 then/.test(blok)) {
      salah(`0132 \`${nama}\`: draft yang seluruh barisnya nol tidak ditolak — surat jalan kosong tetap harus diterima, dicetak, dan diarsipkan.`);
    }
  }

  // 2. Penyelamatan nilai lama saat draft disunting.
  if (!/jsonb_object_agg\(product_id::text/.test(blokUbah)) {
    salah(
      '0132 `ubah_draft_kiriman`: nilai lama tidak diselamatkan sebelum baris dihapus. ' +
        'Satu kali "Simpan perubahan" dari PWA lama akan menghapus seluruh keterangan dan jejak jumlah yang diminta.'
    );
  }
  if (/create temp table/.test(mig)) {
    salah('0132: memakai temp table di fungsi yang dipanggil per-permintaan — koneksi dipakai bergantian, dan keadaan yang menumpang di sana bocor antar permintaan.');
  }

  // Batasan lama harus benar-benar dicabut.
  if (!/pg_get_constraintdef\(oid\) ilike '%sent_qty%'/.test(mig)) {
    salah('0132: batasan lama `sent_qty > 0` tidak dicari untuk dicabut — baris nol pertama akan ditolak database.');
  }
  if (/ilike '%> 0%'/.test(mig)) {
    salah(
      "0132: batasan lama dicari lewat teks '> 0'. Postgres menyimpannya sebagai `(sent_qty > (0)::numeric)`, " +
        'jadi pencarian itu tidak menemukan apa pun dan migration-nya lolos tanpa melakukan apa-apa.'
    );
  }

  // 3. Outlet melengkapi, tidak menimpa.
  const blokKet = mig.slice(mig.indexOf('function lengkapi_keterangan_kiriman('), mig.indexOf('revoke all on function lengkapi_keterangan_kiriman'));
  if (!/and keterangan is null/.test(blokKet)) {
    salah('0132 `lengkapi_keterangan_kiriman`: menimpa keterangan yang sudah ada. Keterangan pengirim bukan milik penerima.');
  }
  if (!/has_outlet_scope\(v_uid, v_d\.from_outlet_id\) or has_outlet_scope\(v_uid, v_d\.to_outlet_id\)/.test(blokKet)) {
    salah('0132 `lengkapi_keterangan_kiriman`: wewenangnya tidak dibatasi ke kedua outlet yang terlibat.');
  }
  if (!/grant execute on function lengkapi_keterangan_kiriman\(uuid, jsonb\) to authenticated/.test(mig)) {
    salah('0132: `lengkapi_keterangan_kiriman` tidak diberikan ke authenticated — layarnya akan dapat 42883.');
  }
}

// ---------------------------------------------------------------
// Layanan
// ---------------------------------------------------------------
const svc = baca('js/modules/dispatch/dispatch.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  if (!/keterangan, ordered_qty/.test(kode)) {
    salah('dispatch.service.js `getDispatchItems`: tidak mengambil `keterangan`/`ordered_qty` — layar tidak punya apa pun untuk ditampilkan.');
  }
  if (!/rpc\(\s*'lengkapi_keterangan_kiriman'/.test(kode)) {
    salah('dispatch.service.js: RPC `lengkapi_keterangan_kiriman` tidak pernah dipanggil.');
  }
  // Kolom baru yang belum ada di server tidak boleh menghapus seluruh daftar.
  if (!/column .\* does not exist|does not exist/.test(kode)) {
    salah(
      'dispatch.service.js `getDispatchItems`: tidak punya jalur cadangan kalau 0132 belum dijalankan. ' +
        'PostgREST menolak SELURUH permintaan karena satu kolom tidak dikenal, dan yang hilang adalah seluruh isi kirimannya.'
    );
  }
}

// ---------------------------------------------------------------
// Layar
// ---------------------------------------------------------------
const hal = baca('js/modules/dispatch/dispatch.page.js');
if (hal) {
  const kode = tanpaKomentar(hal);

  // 4. Kotak Dikirim KOSONG.
  if (/class="ord-send-input[^"]*"[^>]*value="\$\{round\(it\.qty\)\}"/.test(kode)) {
    salah(
      'dispatch.page.js: kotak "Dikirim" masih terisi otomatis sebanyak yang diminta. ' +
        'Kotak yang sudah berisi angka masuk akal tidak menuntut siapa pun memeriksanya — dan yang lewat tetap berangkat.'
    );
  }
  if (!/class="ord-send-input[^"]*"[^>]*placeholder="0"/.test(kode)) {
    salah('dispatch.page.js: kotak "Dikirim" tidak punya placeholder — kotak kosong tanpa petunjuk terbaca seperti belum siap dipakai.');
  }
  if (!/data-diminta=/.test(kode)) salah('dispatch.page.js: jumlah yang diminta tidak dibawa ke pengiriman, jadi `ordered_qty` tidak akan pernah terisi.');
  if (!/class="ord-ket-input"/.test(kode)) salah('dispatch.page.js: kolom Keterangan tidak ada di layar CK.');

  // Seluruh baris ikut, termasuk yang nol.
  const iFulfill = kode.indexOf("querySelectorAll('.ord-send-input')");
  const blokFulfill = kode.slice(iFulfill, iFulfill + 900);
  if (/\.filter\(\(i\) => i\.qty > 0\)/.test(blokFulfill)) {
    salah('dispatch.page.js: baris ber-qty 0 masih disaring sebelum dikirim ke server — barisnya tidak akan pernah sampai ke surat jalan.');
  }
  if (!/ordered_qty:/.test(blokFulfill) || !/keterangan:/.test(blokFulfill)) {
    salah('dispatch.page.js: `ordered_qty`/`keterangan` tidak ikut dikirim saat menyiapkan draft.');
  }
  if (!/some\(\(i\) => i\.qty > 0\)/.test(blokFulfill)) {
    salah('dispatch.page.js: tidak menahan draft yang seluruh barisnya nol — server akan menolaknya sesudah orangnya menekan tombol.');
  }

  // 5. Sisi outlet.
  if (!/class="recv-ket-input"/.test(kode)) salah('dispatch.page.js: kotak keterangan tidak ada di sisi outlet — CK yang lupa mengisi tidak bisa dilengkapi siapa pun.');
  if (!/lengkapiKeteranganKiriman\(/.test(kode)) salah('dispatch.page.js: keterangan dari outlet tidak pernah dikirim ke server.');
  // Kelasnya harus ADA *dan* benar-benar dihitung dari jumlah kirimnya.
  //
  // Mencari nama kelasnya saja tidak cukup: `nol ? ' class="kirim-nol"' : ''`
  // tetap memuat teks itu walau `nol` dipaksa `false` — sorotannya mati,
  // auditnya hijau, dan sebuah sabotase memang lolos lewat celah itu.
  if (!/kirim-nol/.test(kode)) salah('dispatch.page.js: baris "dikirim 0" tidak disorot di sisi outlet — angka 0 di antara belasan angka lain terlewat.');
  if (!/const nol = Number\(it\.sent_qty\) === 0;/.test(kode)) {
    salah('dispatch.page.js: sorotan baris nol tidak dihitung dari `sent_qty` — kelasnya ada, tapi tidak pernah menyala.');
  }
  if (!/it\.ordered_qty/.test(kode)) salah('dispatch.page.js: jumlah yang diminta tidak ditampilkan di sisi outlet, padahal itu yang menutup perdebatan.');

  // Draft SJ: menyunting tidak boleh membuang baris nol.
  if (!/bolehNol: true/.test(kode)) {
    salah('dispatch.page.js: picker draft SJ masih membuang baris nol saat disimpan — justru baris yang paling perlu dibaca outlet.');
  }
}

const picker = baca('js/modules/dispatch/item-picker.js');
if (picker) {
  const kode = tanpaKomentar(picker);
  if (!/bolehNol = false/.test(kode)) salah('item-picker.js: opsi `bolehNol` tidak ada, padahal layar draft mengirimnya — opsi tak dikenal diabaikan diam-diam.');
  if (!/bolehNol \? i\.qty >= 0 : i\.qty > 0/.test(kode)) salah('item-picker.js: opsi `bolehNol` diterima tapi tidak dipakai menyaring.');
}

const pdf = baca('js/modules/dispatch/dispatch-pdf.js');
if (pdf) {
  const kode = tanpaKomentar(pdf);
  if (!/it\.keterangan/.test(kode) || !/it\.ordered/.test(kode)) {
    salah(
      'dispatch-pdf.js: surat jalan cetak tidak memuat keterangan & jumlah diminta. ' +
        'Perselisihannya terjadi saat barang diserahkan, dan yang dipegang orang saat itu adalah kertasnya.'
    );
  }
}

if (gagal === 0) {
  console.log('Kiriman nol & keterangan: baris nol bertahan, keterangan tidak tertimpa, dan kotak Dikirim kosong. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
