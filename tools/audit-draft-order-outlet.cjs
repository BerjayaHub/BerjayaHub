/**
 * AUDIT: draft order outlet yang sudah ada harus TERLIHAT.
 *
 * ============ APA YANG SEBENARNYA KURANG ============
 *
 *   "jadi staff b tidak membuat draft order baru sekaligus nomor order baru
 *    bila masih ada draft order yang belum dikirim"
 *
 * Jaminannya sudah ada sejak 0111 dan tidak perlu dibangun ulang:
 *
 *     create unique index stock_orders_satu_draft
 *       on stock_orders(from_outlet_id, to_outlet_id) where status = 'draft';
 *
 * plus `buat_atau_ambil_draft_order` yang mengembalikan draft yang ada. Dua
 * nomor draft sekaligus memang tidak mungkin.
 *
 * Yang tidak ada adalah TANDANYA di layar. Staff B menekan tombol
 * "Buka / Buat Draft Order" — kalimat yang tidak memberi tahu mana yang akan
 * terjadi — lalu mendapat draft milik staff A yang sudah berisi setengah
 * pesanan, tanpa satu pun kalimat yang mengatakan itu bukan daftar kosong
 * miliknya sendiri.
 *
 * Jaminan yang bekerja diam-diam tetap terasa seperti tidak ada.
 *
 * Yang dijaga:
 *   1. Jaminan 0111 masih utuh — kalau ia hilang, seluruh fitur ini jadi
 *      hiasan di atas lubang.
 *   2. Layar membaca keadaannya dan menampilkan peringatannya DI ATAS tombol.
 *   3. Label tombolnya mengikuti keadaan, bukan "Buka / Buat" selamanya.
 *   4. Keadaan draft-ganda (yang seharusnya mustahil) tidak disembunyikan.
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
// 1. Jaminan 0111 masih utuh.
//
// Diperiksa walau bukan berkas yang diubah: seluruh fitur ini bersandar
// padanya. Kalau indeks uniknya suatu saat hilang — migration yang gagal
// separuh, atau seseorang yang menganggapnya penghalang — peringatan di layar
// jadi hiasan di atas lubang yang sudah terbuka.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0111_draft_order_ck.sql');
if (mig) {
  if (!/create unique index if not exists stock_orders_satu_draft\s+on stock_orders\(from_outlet_id, to_outlet_id\) where status = 'draft'/.test(mig)) {
    salah(
      '0111: indeks unik "satu draft per outlet-tujuan" hilang atau berubah bentuk. ' +
        'Itu satu-satunya yang benar-benar menahan dua nomor draft sekaligus — peringatan di layar hanya menjelaskannya.'
    );
  }
  if (!/select id into v_id from stock_orders\s+where from_outlet_id = p_from and to_outlet_id = p_to and status = 'draft';/.test(mig)) {
    salah('0111 `buat_atau_ambil_draft_order`: tidak lagi mencari draft yang sudah ada — menekan tombolnya akan membuat nomor baru.');
  }
}

// ---------------------------------------------------------------
// Modul murni
// ---------------------------------------------------------------
const murni = baca('js/modules/dispatch/draft-outlet.js');
if (murni) {
  const kode = tanpaKomentar(murni);
  for (const fn of ['draftBerjalan', 'orderMenunggu', 'draftGanda', 'keadaanOrderKeCk', 'labelTombolDraft', 'pesanKeadaan']) {
    if (!new RegExp(`export function ${fn}\\(`).test(kode)) salah(`draft-outlet.js: \`${fn}\` tidak diekspor.`);
  }

  // Draft menang atas order menunggu: draft bisa langsung ditambahi, order
  // yang sudah dikirim tidak. Terbalik = staff diarahkan ke dokumen terkunci.
  const iGanda = kode.indexOf("if (ganda.length === 1)");
  const iMenunggu = kode.indexOf("if (menunggu.length)");
  if (iGanda < 0 || iMenunggu < 0 || iGanda > iMenunggu) {
    salah('draft-outlet.js: order menunggu diperiksa sebelum draft — staff akan diarahkan ke dokumen yang sudah terkunci.');
  }

  // Keadaan yang "mustahil" tidak boleh disembunyikan.
  if (!/'ada-draft-ganda'/.test(kode)) {
    salah(
      'draft-outlet.js: draft ganda tidak dikenali sendiri. Kalau indeks 0111 suatu saat hilang, layar akan diam-diam memilih salah satu — ' +
        'dan dua nomor yang keduanya "benar" menurut layar adalah dobel order yang paling sulit dilacak.'
    );
  }
}

// ---------------------------------------------------------------
// Layar
// ---------------------------------------------------------------
const hal = baca('js/modules/dispatch/dispatch.page.js');
if (hal) {
  const kode = tanpaKomentar(hal);

  if (!/keadaanOrderKeCk\(myOrders\)/.test(kode)) {
    salah('dispatch.page.js: keadaan draft tidak dibaca sama sekali di tab Order ke CK.');
  }
  if (!/labelTombolDraft\(keadaanOrder\)/.test(kode)) {
    salah(
      'dispatch.page.js: label tombolnya tetap. "Buka / Buat Draft Order" adalah dua kemungkinan dalam satu kalimat, ' +
        'dan yang membacanya tidak tahu mana yang akan terjadi.'
    );
  }
  if (/Buka \/ Buat Draft Order/.test(kode)) {
    salah('dispatch.page.js: label lama "Buka / Buat Draft Order" masih ada.');
  }
  if (!/pesanKeadaan\(keadaanOrder/.test(kode)) {
    salah('dispatch.page.js: peringatannya tidak pernah dibentuk.');
  }
  if (!/class="\$\{keadaanOrder\.mode === 'ada-draft-ganda' \? 'draft-ganda' : 'draft-ada'\}"/.test(kode)) {
    salah('dispatch.page.js: peringatannya tidak digambar, atau keadaan draft-ganda tidak dibedakan tampilannya.');
  }

  // PERINGATAN DI ATAS TOMBOL. Di bawahnya, ia dibaca sesudah keputusannya
  // diambil — dan keputusan itulah yang hendak dicegah.
  const iPesan = kode.indexOf("? `<div class=\"${keadaanOrder.mode ===");
  const iTombol = kode.indexOf('id="ord-buka-draft"');
  if (iPesan < 0 || iTombol < 0 || iPesan > iTombol) {
    salah('dispatch.page.js: peringatan draft tidak berada DI ATAS tombolnya — dibaca sesudah tombolnya ditekan tidak menolong siapa pun.');
  }

  // Isi draftnya disebut jumlahnya, dan hanya diambil kalau draftnya ada.
  if (!/keadaanOrder\.draft \? await getOrderItems\(keadaanOrder\.draft\.id\)/.test(kode)) {
    salah('dispatch.page.js: jumlah bahan di draft tidak diambil — "sudah ada draft" tanpa isinya tidak memberi tahu apakah perlu dibuka.');
  }

  // Baris draft di tabel riwayat ikut ditandai.
  if (!/ord-draft-aktif/.test(kode)) {
    salah('dispatch.page.js: baris draft di tabel "Order Saya" tidak ditandai — ia satu-satunya baris yang masih bisa ditambahi.');
  }

  // ---------------------------------------------------------------
  // TUJUAN TERKUNCI SELAMA DRAFT MASIH BERJALAN.
  //
  // Ini lubang yang tersisa sesudah peringatan dipasang, dan bentuknya halus:
  // indeks unik 0111 berlaku per PASANGAN (from_outlet_id, to_outlet_id). Untuk
  // outlet tanpa `served_by_outlet_id` di BU yang punya dua Central Kitchen,
  // memilih CK yang BERBEDA dari dropdown menghasilkan draft kedua yang SAH
  // menurut database. Dua nomor order sekaligus, tanpa satu pun error.
  //
  // Peringatan di atas tombol tidak menutupnya — ia menjelaskan, tidak
  // menghalangi. Yang menutupnya: dropdownnya hilang, dan tujuannya diambil
  // dari draft yang sedang berjalan.
  // ---------------------------------------------------------------
  if (!/keadaanOrder\.draft\?\.to_outlet_id \?\?/.test(kode)) {
    salah(
      'dispatch.page.js: tujuan order tidak dikunci ke draft yang sedang berjalan. ' +
        'Indeks 0111 unik per pasangan outlet-CK, jadi memilih CK lain akan membuat NOMOR ORDER KEDUA yang sah — ' +
        'persis dobel order yang hendak dicegah.'
    );
  }
  // Urutannya penting: draft harus dibaca SEBELUM `servedCk`. Kalau setelan
  // outlet diubah ke CK lain sementara draft lama masih hidup, menuruti setelan
  // membuat nomor kedua.
  const iDraftTujuan = kode.indexOf('keadaanOrder.draft?.to_outlet_id');
  const iServed = kode.indexOf('servedCk ? servedCk.id');
  if (iDraftTujuan >= 0 && iServed >= 0 && iDraftTujuan > iServed) {
    salah('dispatch.page.js: setelan outlet dibaca sebelum draft yang berjalan — draft yang hidup adalah fakta, setelan cuma niat.');
  }
  // ---------------------------------------------------------------
  // MENEKAN TOMBOLNYA HARUS BENAR-BENAR MEMBAWA ORANGNYA KE DRAFT.
  //
  // Laporan lapangan: "bila di tap dia tidak beralih ke draft", "tidak bisa
  // isi bahan untuk order". Panelnya sebenarnya terbuka — di bawah tabel, di
  // luar layar — lalu `sekaliJalan` MENARIK LAYAR KEMBALI ke posisi semula
  // (`pulihkanGulir`, dua frame sesudah handlernya selesai). Perilaku itu benar
  // untuk hampir semua tombol dan salah persis untuk tombol ini.
  //
  // Fitur yang "sudah jadi" tapi tidak bisa dicapai sama saja dengan tidak ada.
  // ---------------------------------------------------------------
  const iTombolDraft = kode.indexOf("#ord-buka-draft");
  const iKirim = kode.indexOf('.btn-kirim-order');
  const blokTombol = iTombolDraft >= 0 && iKirim > iTombolDraft ? kode.slice(iTombolDraft, iKirim) : '';
  if (!blokTombol) {
    salah('dispatch.page.js: penangan tombol `#ord-buka-draft` tidak ditemukan.');
  } else {
    if (!/jagaGulir:\s*false/.test(blokTombol)) {
      salah(
        'dispatch.page.js: tombol "Buka draft" masih memakai pemulihan gulir bawaan `sekaliJalan`. ' +
          'Panel editnya dibuka di bawah tabel, lalu layarnya ditarik kembali ke posisi semula — ' +
          'yang terlihat: tombolnya ditekan dan tidak terjadi apa-apa.'
      );
    }
    // Bentuk lamanya `…?.click()` menelan kegagalannya: draft sudah dibuat di
    // server, barisnya tidak ketemu, dan layar diam sepenuhnya.
    if (/\.btn-edit-order\[data-id="\$\{id\}"\]`\)\?\.click\(\)/.test(blokTombol)) {
      salah(
        'dispatch.page.js: pembukaan panel draft memakai `?.click()` yang menelan kegagalannya. ' +
          'Kalau barisnya tidak ketemu, tidak ada klik dan tidak ada pesan — dan draftnya sudah terlanjur dibuat di server.'
      );
    }
  }

  // Panel editnya harus menjemput layarnya. Ia berada di paling bawah tab,
  // sesudah kartu penjelasan, peringatan, tombol, dan seluruh tabel.
  if (!/editBox\.scrollIntoView\(/.test(kode)) {
    salah(
      'dispatch.page.js: panel "Ubah Order" tidak menggulirkan layar ke dirinya sendiri. ' +
        'Ia lahir di luar layar di HP, dan menekan "Tambah / Edit" jadi terlihat seperti tidak melakukan apa-apa.'
    );
  }

  // Dropdownnya sendiri harus berada DI BALIK pemeriksaan draft.
  //
  // Diperiksa lewat jarak, bukan lewat pola tunggal: yang menentukan bukan
  // adanya kata `keadaanOrder.draft` di suatu tempat di berkas, melainkan
  // adanya ia ANTARA cabang `servedCk` dan `<select id="ord-to">`. Kalau
  // pemeriksaannya pindah ke tempat lain, dropdownnya kembali tampil.
  const iSelect = kode.indexOf('id="ord-to"');
  if (iSelect < 0) {
    salah('dispatch.page.js: pemilih CK tujuan (`#ord-to`) hilang — outlet tanpa setelan CK tidak punya cara memesan sama sekali.');
  } else {
    const iServedRender = kode.lastIndexOf('servedCk', iSelect);
    const antara = iServedRender >= 0 ? kode.slice(iServedRender, iSelect) : '';
    // Dicari sebagai PENJAGA ternary (`: keadaanOrder.draft ?`), bukan sekadar
    // kata `keadaanOrder.draft` di mana saja dalam potongan itu. Cabang yang
    // terkunci menyebut nama CK-nya lewat `keadaanOrder.draft.to_outlet?.name`,
    // jadi pemeriksaan "ada kata itu" akan tetap hijau walau penjaganya sudah
    // diganti `false`. Sabotase pertama pada aturan ini lolos persis begitu.
    if (!/:\s*keadaanOrder\.draft\s*\?/.test(antara)) {
      salah(
        'dispatch.page.js: dropdown `#ord-to` tidak disembunyikan saat draft sedang berjalan. ' +
          'Selama ia tampil, staff berikutnya bisa memilih CK lain dan membuat nomor order kedua.'
      );
    }
  }
}

// Tujuannya tidak bisa dikunci kalau id-nya tidak pernah diambil.
const svc = baca('js/modules/dispatch/dispatch.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  const blok = kode.slice(kode.indexOf('export async function listMyOrders'));
  if (!/to_outlet_id,/.test(blok.slice(0, 1200))) {
    salah(
      'dispatch.service.js `listMyOrders`: `to_outlet_id` tidak ikut diambil. ' +
        'Tanpa id mentahnya layar cuma punya nama CK, dan tujuan draft tidak bisa dikunci — ' +
        'satu-satunya jalan tersisa adalah membiarkan staff memilih CK lagi.'
    );
  }
}

const css = baca('css/styles.css');
if (css) {
  for (const kelas of ['.draft-ada', '.draft-ganda', '.ord-draft-aktif']) {
    if (!new RegExp(`\\${kelas}\\s*\\{`).test(css)) {
      salah(`css/styles.css: kelas \`${kelas}\` tidak ada — peringatannya digambar tapi tidak terlihat berbeda dari teks biasa.`);
    }
  }
}

if (gagal === 0) {
  console.log('Draft order outlet: jaminan 0111 utuh, keadaannya dibaca, dan peringatannya berdiri di atas tombolnya. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
