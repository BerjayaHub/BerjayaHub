/**
 * AUDIT: penerima kas keluar yang bukan supplier (0159).
 *
 * ============ KELUHAN ASLINYA ============
 *
 *   "untuk pembayaran uang hadir staff di cash ledger yang memakai kas/kantong
 *    outlet baiknya bagaimana? karena ada pewajiban memasukkan supplier di kas
 *    keluar di cash ledger"
 *
 * Kewajiban memilih supplier (0144/0151) benar dan tetap berlaku. Yang salah
 * adalah bahwa SEBAGIAN pembayaran tidak punya supplier sama sekali — uang
 * hadir staff, iuran, ganti uang pribadi. Kasir membaca "Supplier", tidak
 * menemukan yang cocok, dan berhenti di sana. Tidak ada galat di mana pun:
 * formnya cuma tidak bisa diselesaikan, dan uang yang sudah keluar dari
 * kantong tidak tercatat.
 *
 * ============ CARA PERBAIKANNYA RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   kas menyaring `jenis: 'supplier'` -> keluhan aslinya KEMBALI UTUH. Inilah
 *                                        kerusakan yang paling mungkin terjadi,
 *                                        karena menyalin pemanggilan nota
 *                                        terlihat seperti kerapian.
 *   nota TIDAK menyaring              -> "Kas Operasional" muncul di dropdown
 *                                        nota, lalu ada nota bahan yang
 *                                        tercatat datang dari kantong kasir
 *                                        sendiri — baris yang tidak bisa
 *                                        dicocokkan dengan tagihan siapa pun,
 *                                        ditemukan berbulan-bulan kemudian.
 *   label balik jadi "Supplier"       -> kolomnya benar, daftarnya benar, dan
 *                                        kasirnya tetap berhenti. Yang
 *                                        menghalangi dia sejak awal adalah
 *                                        katanya.
 *   trigger seed BU dibuang           -> BU berikutnya lahir tanpa penerima
 *                                        internal, dan keluhannya muncul lagi
 *                                        berbulan-bulan kemudian di tempat yang
 *                                        tidak dicurigai siapa pun.
 *   `cari_atau_buat_supplier` menyaring
 *     jenis saat MENCARI              -> nota yang menyebut nama internal tidak
 *                                        menemukannya, lalu gagal membuatnya
 *                                        (indeks uniknya pada nama saja), lalu
 *                                        `supplier_id`-nya NULL — diam-diam.
 *   jenis berbeda ditawari Gabungkan  -> satu ketukan yang terlihat merapikan
 *                                        daftar membubarkan tempat uang hadir
 *                                        staff dibukukan, di seluruh BU.
 *   `jenis` kosong dibaca `undefined` -> barisnya hilang dari KEDUA saringan
 *                                        jenis sekaligus; daftar yang tidak
 *                                        memuat barisnya sendiri.
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
const bersih = (isi, rel, penanda) => {
  const kode = tanpaKomentar(isi);
  const pesan = periksaKewarasan(isi, kode, penanda);
  if (pesan) salah(`${rel}: ${pesan}`);
  return kode;
};

/** Buang komentar `--` SQL, kecuali yang di dalam string literal. */
const tanpaSqlKomentar = (sql) =>
  sql
    .split('\n')
    .map((baris) => {
      let petik = 0;
      for (let i = 0; i < baris.length; i++) {
        if (baris[i] === "'") petik++;
        else if (baris[i] === '-' && baris[i + 1] === '-' && petik % 2 === 0) return baris.slice(0, i);
      }
      return baris;
    })
    .join('\n');

// ---------------------------------------------------------------
// 1. MIGRATION 0159.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0159_penerima_bukan_supplier.sql');
if (mig) {
  const kode = tanpaSqlKomentar(mig);
  // Penyaring komentarnya diperiksa dari DUA arah: satu kalimat kode yang
  // harus bertahan, satu kalimat komentar yang harus hilang. Tanpa keduanya,
  // seluruh pemeriksaan di bawah bisa hijau karena alasan yang salah.
  if (!/alter table suppliers/.test(kode)) {
    salah('audit-penerima-kas: penyaring komentar SQL ikut memakan kodenya — pemeriksaan di bawah tidak bisa dipercaya.');
  }
  if (/DAN UNTUK BU YANG LAHIR SESUDAH INI/.test(kode)) {
    salah('audit-penerima-kas: komentar SQL tidak tersaring — pemeriksaan di bawah bisa hijau karena kalimat penjelasnya.');
  }

  if (!/jenis text not null default 'supplier'/.test(kode)) {
    salah(
      "0159: kolom `jenis` hilang atau bawaannya bukan 'supplier'. Bawaan yang lain membuat SELURUH supplier yang " +
        'sudah ada berubah jenis sekaligus — dan dropdown nota langsung kosong di setiap BU.'
    );
  }
  if (!/check \(jenis in \('supplier', 'internal'\)\)/.test(kode)) {
    salah('0159: `check` jenis hilang — jenis ketiga yang salah ketik akan tersimpan dan barisnya tidak muncul di layar mana pun.');
  }

  // ============ SEED: YANG ADA SEKARANG, DAN YANG LAHIR NANTI ============
  if (!/insert into suppliers[\s\S]{0,400}?from business_units/.test(kode)) {
    salah('0159: seed "Kas Operasional" untuk BU yang sudah ada hilang — tidak ada BU yang punya penerima internal sampai admin membuatnya satu per satu.');
  }
  if (!/after insert on business_units/.test(kode)) {
    salah(
      '0159: trigger seed pada `business_units` hilang. `insert` seed hanya mengurus BU yang ADA saat migration ' +
        'dijalankan — BU berikutnya lahir tanpa penerima internal, dan tidak ada yang tahu sampai ada staff di sana ' +
        'yang tertahan oleh form. Itu keluhan aslinya, berbulan-bulan kemudian, di tempat yang tidak dicurigai.'
    );
  }
  if (!/on conflict \(business_unit_id, normal_nama_supplier\(nama\)\) do nothing/.test(kode)) {
    salah('0159: seed-nya tanpa `on conflict do nothing` — menjalankan ulang migrationnya akan GAGAL, dan BU yang sudah punya namanya sendiri ikut menggagalkannya.');
  }

  // ============ PENCARIAN TIDAK BOLEH DISARING JENIS ============
  //
  // Indeks uniknya pada (bu, nama) saja — tanpa jenis. Jadi pencarian yang
  // disaring jenis tidak menemukan baris internal, lalu `insert`-nya ditolak
  // indeks, lalu `supplier_id`-nya NULL. Tidak ada galat yang sampai ke
  // siapa pun.
  const cari = kode.match(/create or replace function cari_atau_buat_supplier[\s\S]*?\n\$\$;/);
  if (!cari) {
    salah('0159: `cari_atau_buat_supplier` tidak lagi ditulis ulang di sini — aturan "nota selalu melahirkan supplier, bukan internal" kehilangan tempatnya.');
  } else {
    const badan = cari[0];
    if (/select id[\s\S]{0,200}?from suppliers[\s\S]{0,200}?and jenis/.test(badan)) {
      salah(
        '0159: `cari_atau_buat_supplier` menyaring `jenis` saat MENCARI. Indeks uniknya pada nama saja, jadi nota ' +
          'yang menyebut nama penerima internal tidak menemukannya, gagal membuatnya, dan `supplier_id`-nya NULL — ' +
          'tanpa satu pun galat.'
      );
    }
    if (!/values \([^)]*'supplier'/.test(badan) && !/jenis\s*\)\s*values[\s\S]{0,120}'supplier'/.test(badan)) {
      salah("0159: baris yang LAHIR dari nota tidak dipaksa berjenis 'supplier' — nota bisa melahirkan penerima internal, dan ia lalu muncul di dropdown nota berikutnya.");
    }
  }

  // ============ SATU NAMA FUNGSI, SATU TANDA TANGAN ============
  //
  // PostgREST memilih overload dari HIMPUNAN NAMA ARGUMEN. Membiarkan
  // `ubah_supplier` versi 6 argumen hidup berarti klien yang tidak mengirim
  // `p_jenis` memanggil fungsi LAMA — jadi mengubah jenis dari layar tidak
  // melakukan apa pun, dan tidak ada galat.
  if (!/drop function if exists ubah_supplier\(/.test(kode)) {
    salah(
      '0159: `ubah_supplier` lama tidak di-drop. PostgREST memilih overload dari himpunan nama argumen — klien yang ' +
        'tidak mengirim `p_jenis` akan memanggil fungsi lama, dan perubahan jenis dari layar tidak terjadi tanpa galat.'
    );
  }
  if (!/create or replace function tambah_supplier\(/.test(kode)) {
    salah('0159: `tambah_supplier` hilang — tidak ada jalan membuat penerima internal untuk BU yang dibuat sebelum migration ini.');
  }
}

// ---------------------------------------------------------------
// 2. SARINGAN JENIS: NOTA MENYARING, KAS TIDAK.
// ---------------------------------------------------------------
const svc = baca('js/modules/inventory/esb.service.js');
if (svc) {
  const kode = bersih(svc, 'esb.service.js', ['listSuppliers']);
  if (!/function listSuppliers\(businessUnitId, \{ semua = false, jenis = null \} = \{\}\)/.test(kode)) {
    salah('esb.service.js: `listSuppliers` tidak lagi menerima `jenis` — tidak ada cara menyaring dropdown nota, jadi penerima internal muncul di sana.');
  }

  // ============ DIIKAT KE BLOKNYA, BUKAN DICARI SE-BERKAS ============
  //
  // `if (jenis) q = q.eq('jenis', jenis);` juga ada di `listEsbMaster` di
  // berkas yang sama. Audit yang mencarinya se-berkas tetap HIJAU sesudah
  // saringan `listSuppliers` dicabut — ia menemukan milik fungsi lain dan
  // melaporkan keadaan aman. Itu persis mode kegagalan yang paling sering
  // terjadi pada audit di repo ini: hijau karena sasarannya ada di tempat
  // lain.
  //
  // Ditemukan oleh `sabotase-penerima-kas.mjs`, bukan dengan membacanya
  // ulang.
  const awalLS = kode.indexOf('function listSuppliers(');
  const blokLS = awalLS < 0 ? '' : kode.slice(awalLS, kode.indexOf('\n}', awalLS));
  if (!/if \(jenis\) q = q\.eq\('jenis', jenis\);/.test(blokLS)) {
    salah(
      'esb.service.js: `listSuppliers` menerima `jenis` tapi tidak memakainya menyaring kueri. Pemanggil mengira ' +
        'sudah menyaring, dan daftarnya pulang utuh — jadi "Kas Operasional" muncul di dropdown nota tanpa satu pun galat.'
    );
  }
  if (!/\.select\('id, nama, jenis,/.test(kode)) {
    salah(
      'esb.service.js: kolom `jenis` tidak diambil. Kolom yang tidak diminta terbaca sebagai "tidak ada" — bukan ' +
        'galat — jadi setiap baris terbaca `supplier`, dan kolom Jenis di admin seluruhnya salah tanpa ada yang tahu.'
    );
  }
}

const nota = baca('js/modules/inventory/inventory.page.js');
if (nota) {
  const kode = bersih(nota, 'inventory.page.js', ['listSuppliers']);
  if (!/listSuppliers\(businessUnitId, \{ jenis: 'supplier' \}\)/.test(kode)) {
    salah(
      "inventory.page.js: dropdown nota tidak lagi menyaring `jenis: 'supplier'`. \"Kas Operasional\" akan muncul " +
        'sebagai pilihan supplier, dan nota bahan yang tercatat datang dari kantong kasir sendiri tidak bisa ' +
        'dicocokkan dengan tagihan siapa pun — ketahuan berbulan-bulan kemudian.'
    );
  }
}

// ============ DAN KAS TIDAK BOLEH MENYARING ============
//
// Ini kerusakan yang paling mungkin terjadi: menyalin pemanggilan nota ke form
// kas terlihat seperti kerapian, dan hasilnya adalah keluhan aslinya kembali
// utuh — tanpa galat, tanpa baris merah di mana pun.
for (const rel of ['js/modules/cash/cash.page.js', 'js/modules/cash/cash.admin.page.js']) {
  const isi = baca(rel);
  if (!isi) continue;
  const kode = bersih(isi, path.basename(rel), ['listSuppliers']);
  if (/listSuppliers\([^)]*jenis:/.test(kode)) {
    salah(
      `${path.basename(rel)}: form kas MENYARING jenis. Uang hadir staff tidak punya supplier — itu sebab fitur ini ` +
        'lahir. Menyaringnya mengembalikan keluhan aslinya utuh: kasir membaca daftar yang tidak memuat penerima ' +
        'yang ia butuhkan, dan berhenti.'
    );
  }
  // DIHITUNG, bukan dicari: label dipakai di dua form per berkas (tambah &
  // ubah). Mencabut salah satunya menyisakan yang lain, dan satu dari dua
  // form kembali menyuruh kasir mencari supplier.
  const n = (kode.match(/label: LABEL_PENERIMA/g) ?? []).length;
  if (n < 2) {
    salah(
      `${path.basename(rel)}: hanya ${n} dari 2 form kas memakai LABEL_PENERIMA. Form yang tertinggal kembali ` +
        'menyebut "supplier", dan kasir yang membuka form itu berhenti di tempat yang sama seperti sebelum 0159.'
    );
  }
  if (/'Dibayar ke \(supplier\)'/.test(kode)) {
    salah(`${path.basename(rel)}: label lama "Dibayar ke (supplier)" kembali ditulis langsung — satu form menyimpang dari tiga lainnya.`);
  }
}

// ---------------------------------------------------------------
// 3. ATURAN MURNINYA.
// ---------------------------------------------------------------
const sk = baca('js/modules/cash/supplier-kas.js');
if (sk) {
  const kode = bersih(sk, 'supplier-kas.js', ['LABEL_PENERIMA']);
  if (!/export const LABEL_PENERIMA = 'Dibayarkan ke';/.test(kode)) {
    salah(
      'supplier-kas.js: `LABEL_PENERIMA` hilang atau bukan "Dibayarkan ke". Yang menghalangi kasir sejak awal bukan ' +
        'kewajibannya — kata "Supplier" itulah yang membuatnya berhenti.'
    );
  }
  if (/PESAN_WAJIB = '[^']*[Ss]upplier/.test(kode)) {
    salah('supplier-kas.js: pesan wajibnya menyebut "supplier" lagi — kalimat yang menyuruh kasir mencari sesuatu yang tidak ada.');
  }
  if (!/PESAN_DI_LUAR_DAFTAR[\s\S]{0,400}?Kas Operasional/.test(kode)) {
    salah(
      'supplier-kas.js: pesan penolakannya tidak lagi menyebut jalan keluarnya. Kalimat yang cuma mengatakan "tidak ' +
        'ada di daftar" meninggalkan kasir di tempat yang sama persis.'
    );
  }
  // Berkas ini TIDAK boleh menyaring jenis sendiri — saringannya di
  // `listSuppliers`, dan dua tempat menyaring berarti satu di antaranya
  // cepat atau lambat menyaring yang salah.
  if (/jenis\s*===\s*'internal'|jenis\s*!==\s*'supplier'/.test(kode)) {
    salah('supplier-kas.js: ikut menyaring jenis. Saringannya milik `listSuppliers`; dua tempat menyaring berarti satu di antaranya akan menyaring yang salah.');
  }
}

const ms = baca('js/modules/inventory/master-supplier.js');
if (ms) {
  const kode = bersih(ms, 'master-supplier.js', ['jenisSupplier']);
  if (!/jenis === JENIS\.INTERNAL \? JENIS\.INTERNAL : JENIS\.SUPPLIER/.test(kode)) {
    salah(
      'master-supplier.js: `jenisSupplier` tidak lagi memulangkan `supplier` untuk baris tanpa kolomnya. Baris lama ' +
        '(sebelum 0159) lalu berjenis `undefined`, lolos dari KEDUA saringan jenis, dan hilang dari daftarnya sendiri.'
    );
  }
  if (!/if \(jenisSupplier\(daftar\[i\]\) !== jenisSupplier\(daftar\[j\]\)\) continue;/.test(kode)) {
    salah(
      'master-supplier.js: `calonKembar` tidak lagi menolak pasangan berjenis beda. Satu-satunya aksi yang ' +
        'ditawarkan kekembaran adalah Gabungkan — dan menggabungkan "Kas Operasional" ke sebuah supplier ' +
        'memindahkan seluruh notanya lalu MEMBUBARKAN tempat uang hadir staff dibukukan, dengan satu ketukan yang ' +
        'terlihat sedang merapikan daftar.'
    );
  }
  if (!/jenis === 'internal'\) return 'penerima internal/.test(kode)) {
    salah('master-supplier.js: keterangan "penerima internal" hilang dari dropdown — "Kas Operasional" terbaca sebagai supplier bernama aneh, dan orang mencari alamat yang tidak akan pernah ada.');
  }
}

// ---------------------------------------------------------------
// 4. LAYAR ADMIN.
// ---------------------------------------------------------------
const adm = baca('js/modules/inventory/esb.admin.js');
if (adm) {
  const kode = bersih(adm, 'esb.admin.js', ['ms-tambah']);
  if (!/tambahSupplier\(businessUnitId, v\.nama, v\.jenis\)/.test(kode)) {
    salah(
      'esb.admin.js: tombol "+ Tambah penerima" tidak lagi memanggil `tambahSupplier`. Penerima internal tidak ' +
        'pernah lahir dari nota — kalau tombol ini hilang, BU yang dibuat sebelum 0159 tidak punya jalan apa pun ' +
        'membuatnya.'
    );
  }
  if (!/jenis: v\.jenis/.test(kode)) {
    salah('esb.admin.js: dialog Edit tidak lagi mengirim `jenis` — supplier yang salah jenis tidak bisa dibetulkan dari layar mana pun.');
  }
  if (!/id="ms-saring-jenis"/.test(kode)) {
    salah('esb.admin.js: saringan Jenis hilang dari Master Supplier — pada daftar empat puluh baris, satu penerima internal tidak bisa ditemukan lagi.');
  }
  if (!/data-label="Jenis"/.test(kode)) {
    salah('esb.admin.js: kolom Jenis hilang dari tabelnya — tidak ada cara melihat baris mana yang tidak akan muncul di nota.');
  }
}

console.log('');
if (gagal === 0) console.log('Audit penerima kas bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
