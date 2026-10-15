/**
 * AUDIT: hapus supplier + tab tersendiri + banner kesiapan ESB (0161).
 *
 * ============ CARA KETIGANYA RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   policy `delete` dihidupkan lagi -> `hapus_supplier` jadi SARAN. Satu
 *                                      panggilan `DELETE /suppliers?id=eq.…`
 *                                      melewatinya tanpa menyentuh satu pun
 *                                      pemeriksaannya.
 *   cek `cash_entries` dibuang       -> "Kas Operasional" terhapus tanpa galat;
 *                                      form kas lalu menolak nilai yang SUDAH
 *                                      tersimpan di entri lama, dan membetulkan
 *                                      satu huruf di keterangannya jadi
 *                                      mustahil.
 *   kas dicocokkan dengan `=` biasa  -> ejaan yang beda satu spasi lolos, yaitu
 *                                      justru penghapusan yang paling merusak.
 *   penjaga `btrim <> ''` hilang     -> entri kas TANPA supplier ikut terhitung,
 *                                      dan tidak ada satu supplier pun yang
 *                                      bisa dihapus lagi — fitur yang mati
 *                                      sambil terlihat bekerja.
 *   tombol Hapus muncul untuk yang
 *     dipakai                        -> penolakan jadi hal biasa, dan pada
 *                                      ketukan yang benar-benar penting
 *                                      pesannya tidak dibaca lagi.
 *   banner menghitung sendiri        -> dua angka yang bertentangan di satu
 *                                      layar; orang berhenti mempercayai
 *                                      keduanya.
 *   sebab digabung jadi satu angka   -> orang disuruh memilih padanan dari
 *                                      daftar yang kosong.
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
// 1. MIGRATION 0161.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0161_hapus_supplier.sql');
if (mig) {
  const kode = tanpaSqlKomentar(mig);
  if (!/create or replace function hapus_supplier/.test(kode)) {
    salah('audit-hapus-supplier: penyaring komentar SQL ikut memakan kodenya — pemeriksaan di bawah tidak bisa dipercaya.');
  }
  if (/KENAPA INI BUTUH RPC/.test(kode)) {
    salah('audit-hapus-supplier: komentar SQL tidak tersaring — pemeriksaan di bawah bisa hijau karena kalimat penjelasnya.');
  }

  // ============ JALUR PINTAS HARUS TETAP TERTUTUP ============
  //
  // Seluruh pemeriksaan di dalam `hapus_supplier` cuma saran selama ada policy
  // yang mengizinkan `delete`.
  if (!/drop policy if exists suppliers_modify on suppliers;/.test(kode)) {
    salah(
      "0161: policy `for all` lama tidak di-drop. Selama ia hidup, `DELETE /suppliers?id=eq.…` melewati seluruh " +
        'pemeriksaan `hapus_supplier` tanpa menyentuhnya — dan 42 nota kehilangan induknya tanpa satu pun galat.'
    );
  }
  if (/create policy suppliers_\w+ on suppliers\s*\n\s*for (all|delete)/.test(kode)) {
    salah(
      '0161: ada policy yang mengizinkan DELETE lagi. Satu-satunya jalan menghapus supplier harus lewat ' +
        '`hapus_supplier`, karena di situlah pemeriksaannya berada.'
    );
  }
  for (const [pola, apa] of [
    [/for insert with check \(is_bu_admin/, 'policy insert'],
    [/for update using \(is_bu_admin/, 'policy update']
  ]) {
    if (!pola.test(kode)) salah(`0161: ${apa} hilang — Admin BU kehilangan kemampuan yang sudah ia punya sejak 0158.`);
  }

  // ============ DUA JALUR PEMAKAIAN, DUA PEMERIKSAAN ============
  if (!/select count\(\*\) into v_nota from goods_receipts where supplier_id = p_id;/.test(kode)) {
    salah('0161: pemeriksaan nota hilang — FK-nya `on delete set null`, jadi penghapusannya BERHASIL dan notanya diam-diam kehilangan induknya.');
  }
  const kas = kode.match(/select count\(\*\) into v_kas[\s\S]*?;/);
  if (!kas) {
    salah(
      '0161: pemeriksaan entri kas hilang. `cash_entries.supplier` TEKS, bukan FK — database tidak tahu hubungannya ' +
        'sama sekali, jadi ini satu-satunya yang menahannya. Tanpa itu "Kas Operasional" terhapus tanpa galat, dan ' +
        'form kas menolak nilai yang sudah tersimpan di entri lama.'
    );
  } else {
    if (!/normal_nama_supplier\(c\.supplier\) = normal_nama_supplier\(v_nama\)/.test(kas[0])) {
      salah(
        '0161: entri kas dicocokkan tanpa `normal_nama_supplier`. Entri lama ditulis sebelum daftarnya ada, jadi ' +
          'ejaannya berbeda spasi/huruf — dan perbandingan biasa meloloskan justru penghapusan yang paling merusak.'
      );
    }
    // ============ PENJAGA YANG BELUM LOAD-BEARING ============
    //
    // Saya sempat menulis bahwa tanpa baris ini "tidak ada satu supplier pun
    // yang bisa dihapus lagi". Sabotasenya membuktikan itu TIDAK benar:
    // `normal_nama_supplier(null)` memulangkan '' dan tidak pernah sama dengan
    // nama supplier mana pun, jadi mencabutnya tidak mengubah satu pun hasil
    // hari ini.
    //
    // Barisnya DIPERTAHANKAN — ia murah, dan ia yang menahan kalau suatu saat
    // perbandingannya berubah atau ada baris bernama spasi. Tapi klaimnya
    // diturunkan ke apa adanya, karena komentar yang melebih-lebihkan sebuah
    // penjaga membuat orang berikutnya mempercayai penjaga yang tidak ada.
    if (!/coalesce\(btrim\(c\.supplier\), ''\) <> ''/.test(kas[0])) {
      salah(
        "0161: penjaga `btrim <> ''` hilang dari pencocokan entri kas. Hari ini ia belum menahan apa pun — " +
          '`normal_nama_supplier(null)` tidak pernah cocok dengan nama mana pun — tapi ia yang menahan begitu ' +
          'perbandingannya berubah. Murah, dan kegagalannya mahal.'
      );
    }
  }

  if (!/is_bu_admin\(auth\.uid\(\), v_bu\)/.test(kode)) {
    salah('0161: `hapus_supplier` tidak memeriksa wewenang. Ia `security definer`, jadi RLS tidak berlaku di dalamnya sama sekali.');
  }
  // Pesannya harus menyebut jumlah DAN jalan keluarnya.
  const pesan = kode.match(/raise exception\s*\n?\s*'"%" masih dipakai[\s\S]*?;/);
  if (!pesan) {
    salah('0161: kalimat penolakannya hilang atau berubah bentuk.');
  } else {
    for (const [pola, apa] of [
      [/% nota/, 'jumlah nota'],
      [/% entri kas/, 'jumlah entri kas'],
      [/Gabungkan/, 'jalan keluar Gabungkan'],
      [/nonaktifkan/i, 'jalan keluar nonaktifkan']
    ]) {
      if (!pola.test(pesan[0])) {
        salah(
          `0161: kalimat penolakannya tidak lagi menyebut ${apa}. Pesan yang cuma berbunyi "tidak bisa dihapus" ` +
            'meninggalkan orangnya di tempat yang sama persis.'
        );
      }
    }
  }
}

// ---------------------------------------------------------------
// 2. LAYAR MASTER SUPPLIER — TABNYA SENDIRI.
// ---------------------------------------------------------------
const sup = baca('js/modules/inventory/supplier.admin.js');
if (sup) {
  const kode = bersih(sup, 'supplier.admin.js', ['renderSupplierAdmin']);
  if (!/export async function renderSupplierAdmin/.test(kode)) {
    salah('supplier.admin.js: `renderSupplierAdmin` hilang — tabnya kosong.');
  }
  if (!/sayaAdminBu\(businessUnitId\)/.test(kode)) {
    salah(
      'supplier.admin.js: penjaga wewenang hilang. Tanpa itu admin outlet melihat seluruh tombol dan tiap ketukan ' +
        'ditolak RLS satu per satu — fitur yang tampak rusak, bukan fitur yang tidak diizinkan.'
    );
  }
  if (!/hapusSupplier\(btn\.dataset\.id\)/.test(kode)) {
    salah('supplier.admin.js: aksi Hapus hilang.');
  }
  // ============ TOMBOL HAPUS DISEMBUNYIKAN, BUKAN DITOLAK ============
  if (!/b\.jumlah \? '' : `<button class="ms-hapus"/.test(kode)) {
    salah(
      'supplier.admin.js: tombol Hapus tidak lagi disembunyikan untuk supplier yang dipakai nota. Tombol yang selalu ' +
        'ada tapi hampir selalu menolak mengajari orang bahwa penolakan itu normal — dan pada ketukan yang ' +
        'benar-benar penting, pesannya tidak dibaca lagi.'
    );
  }
  // Diikat ke blok `.ms-hapus`, bukan dicari se-berkas: `confirmDialog` juga
  // dipakai aksi lain di layar ini, jadi pencarian se-berkas akan tetap hijau
  // sesudah konfirmasi Hapus dicabut — ia menemukan milik aksi lain. Mode
  // kegagalan yang sudah berkali-kali muncul di repo ini.
  const iHapus = kode.indexOf(".ms-hapus')");
  const blokHapus = iHapus < 0 ? '' : kode.slice(iHapus, iHapus + 1600);
  if (!/confirmDialog\(\{/.test(blokHapus) || !/danger: true/.test(blokHapus)) {
    salah('supplier.admin.js: Hapus tidak lagi minta konfirmasi, atau konfirmasinya tidak ditandai `danger`.');
  }
  // Dialognya muncul BUKAN yang menentukan — jawabannya dipatuhi yang
  // menentukan. Sabotase pertama saya membypass hasilnya sambil meninggalkan
  // panggilan dialognya utuh, dan audit yang cuma mencari `confirmDialog(`
  // tetap hijau untuk layar yang menghapus tanpa menunggu jawaban.
  if (!/if \(!yakin\) return;/.test(blokHapus)) {
    salah(
      'supplier.admin.js: jawaban konfirmasi Hapus tidak dipatuhi. Dialognya tetap muncul, dan menekan Batal tetap ' +
        'menghapus — bentuk kerusakan yang hanya ketahuan dari orang yang kehilangan barisnya.'
    );
  }
  // Pesan dari database diteruskan apa adanya — ia sudah memuat jumlah &
  // jalan keluarnya.
  if (!/toast\(e\.message \?\? 'Gagal menghapus supplier\.'/.test(kode)) {
    salah(
      'supplier.admin.js: pesan penolakan dari database tidak diteruskan apa adanya. Menggantinya dengan kalimat ' +
        'umum membuang jumlah pemakaian DAN jalan keluarnya sekaligus.'
    );
  }
}

const inv = baca('js/modules/inventory/inventory.admin.page.js');
if (inv) {
  const kode = bersih(inv, 'inventory.admin.page.js', ['renderSupplierAdmin']);
  if (!/\{ key: 'supplier', label: 'Master Supplier' \}/.test(kode)) {
    salah('inventory.admin.page.js: tab Master Supplier hilang dari daftar tab — layarnya ada tapi tidak bisa dicapai siapa pun.');
  }
  if (!/renderSupplierAdmin\(content, \{ businessUnitId \}\)/.test(kode)) {
    salah('inventory.admin.page.js: tab Master Supplier terdaftar tapi tidak dirender — tab yang diklik lalu tidak terjadi apa-apa.');
  }
}

// Layar ESB tidak boleh menumbuhkan salinan kecil daftarnya.
const esb = baca('js/modules/inventory/esb.admin.js');
if (esb) {
  const kode = bersih(esb, 'esb.admin.js', ['esb-kesiapan']);
  if (/susunMasterSupplier|gambarMasterSupplier/.test(kode)) {
    salah(
      'esb.admin.js: layar Master Supplier tumbuh kembali di sini. Dua layar yang menampilkan daftar yang sama ' +
        'dengan isi berbeda membuat orang mengira datanya juga berbeda — keluhan yang sudah pernah muncul di repo ' +
        'ini untuk dropdown supplier.'
    );
  }
  if (/listSuppliers\(businessUnitId, \{ semua: true \}\)/.test(kode)) {
    salah(
      'esb.admin.js: memuat kembali daftar supplier yang tidak dibaca siapa pun di berkas ini — satu permintaan ' +
        'jaringan tiap kali layar dibuka, untuk data yang langsung dibuang.'
    );
  }

  // ---------------------------------------------------------------
  // 3. BANNER KESIAPAN.
  // ---------------------------------------------------------------
  if (!/id="esb-kesiapan"/.test(kode)) {
    salah('esb.admin.js: kotak banner kesiapan hilang.');
  }
  // ============ DIHITUNG SEKALI, DIPAKAI DUA KALI ============
  //
  // Angka banner harus DATANG dari perhitungan yang sama dengan lencana tiap
  // kelompok. Kalau banner menghitung sendiri, keduanya cepat atau lambat
  // menyimpang — dan menyimpangnya berbentuk banner "semua sudah cocok" di
  // atas kelompok yang lencananya merah.
  if (!/hitungan\.push\(\{ jenis: j, label: LABEL_JENIS\[j\], belum: kurang, total, adaInduk: pilihan\.length > 0 \}\)/.test(kode)) {
    salah(
      'esb.admin.js: banner tidak lagi memakai hitungan yang sama dengan lencana tiap kelompok. Dua angka yang ' +
        'bertentangan di satu layar membuat orang berhenti mempercayai keduanya.'
    );
  }
  // ============ DIIKAT KE PEMANGGILANNYA, BUKAN NAMANYA ============
  //
  // `gambarKesiapan(hitungan)` juga muncul di BARIS DEFINISI fungsinya
  // (`function gambarKesiapan(hitungan) {`). Jadi audit yang mencari teks itu
  // se-berkas tetap HIJAU sesudah pemanggilannya dicabut — ia menemukan
  // definisinya dan melaporkan keadaan aman.
  //
  // Ditemukan sabotasenya. Ini mode kegagalan yang sama persis dengan yang
  // muncul di `audit-penerima-kas` dua hari lalu: hijau karena sasarannya ada
  // di tempat lain.
  if (!/\n    gambarKesiapan\(hitungan\);/.test(kode)) {
    salah('esb.admin.js: banner tidak digambar sesudah pemetaan berubah — ia akan tetap berkata "8 belum cocok" sesudah kedelapannya dibetulkan.');
  }
  if (!/data-jenis-peta="\$\{esc\(j\)\}"/.test(kode)) {
    salah(
      'esb.admin.js: kelompok pemetaan tidak lagi bertanda jenis, jadi tombol di banner tidak punya tujuan. Angka ' +
        'tanpa cara sampai ke barisnya adalah keluhan yang sudah pernah diperbaiki di layar ini (0141).'
    );
  }
  if (!/d\.open = true;/.test(kode)) {
    salah('esb.admin.js: tombol banner tidak lagi MEMBUKA kelompoknya — ia menggulir ke `<details>` yang tetap tertutup.');
  }
}

const kes = baca('js/modules/inventory/kesiapan-esb.js');
if (kes) {
  const kode = bersih(kes, 'kesiapan-esb.js', ['ringkasKesiapan']);
  // Dua sebab TIDAK boleh dilebur.
  if (!/TANPA_INDUK/.test(kode) || !/BELUM_COCOK/.test(kode)) {
    salah(
      'kesiapan-esb.js: kedua sebab tidak lagi dibedakan. "12 belum cocok" yang meleburnya menyuruh orang ' +
        'mengerjakan hal yang tidak bisa dikerjakan: memilih padanan dari daftar yang kosong.'
    );
  }
  if (!/h\?\.adaInduk === false \? SEBAB\.TANPA_INDUK : SEBAB\.BELUM_COCOK/.test(kode)) {
    salah(
      'kesiapan-esb.js: `adaInduk` tidak lagi diperiksa dengan `=== false`. `undefined` berarti pemanggil tidak ' +
        'memberi tahu — menebaknya sebagai "belum diimpor" akan menyuruh orang mengimpor daftar yang sudah ia impor.'
    );
  }
  // Modul ini TIDAK boleh menghitung sendiri.
  if (/susunBarisPemetaan|esb_map|normalNama/.test(kode)) {
    salah('kesiapan-esb.js: mulai menghitung sendiri mana yang belum dipetakan. Angkanya harus datang dari pemanggil — lihat kepala berkasnya.');
  }
  if (!/langkah 3/.test(kode) || !/langkah 5/.test(kode)) {
    salah('kesiapan-esb.js: kalimatnya tidak lagi menyebut langkah yang harus dikerjakan. "12 belum cocok" tidak memberitahu siapa pun apa berikutnya.');
  }
  if (!/tidak dihalangi/i.test(kode)) {
    salah(
      'kesiapan-esb.js: kalimat akibatnya hilang. Peringatan yang tidak menyebutkan akibatnya dibaca sebagai ' +
        'LARANGAN — orang yang sebenarnya boleh meneruskan berhenti, dan yang terbiasa mengabaikannya tidak membacanya lagi.'
    );
  }
}

const svc = baca('js/modules/inventory/esb.service.js');
if (svc) {
  const kode = bersih(svc, 'esb.service.js', ['hapusSupplier']);
  if (!/supabase\.rpc\('hapus_supplier', \{ p_id: id \}\)/.test(kode)) {
    salah('esb.service.js: `hapusSupplier` tidak lagi lewat RPC — `delete` langsung melewati seluruh pemeriksaannya.');
  }
  // Pemeriksaan TIDAK disalin ke klien.
  const i = kode.indexOf('export async function hapusSupplier');
  const batas = kode.indexOf('\nexport ', i + 10);
  if (i >= 0 && /goods_receipts|cash_entries/.test(kode.slice(i, batas < 0 ? undefined : batas))) {
    salah(
      'esb.service.js: pemeriksaan pemakaian disalin ke klien. Dua aturan yang sama cepat atau lambat menyimpang — ' +
        'dan menyimpangnya berbentuk tombol Hapus yang muncul untuk yang ditolak, atau tidak muncul untuk yang boleh.'
    );
  }
}

console.log('');
if (gagal === 0) console.log('Audit hapus supplier & kesiapan ESB bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
