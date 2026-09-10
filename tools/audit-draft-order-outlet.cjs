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
