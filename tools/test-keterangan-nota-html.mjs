/**
 * KETERANGAN KAS JADI HTML — tes murni.
 *
 * ============ KENAPA TES, BUKAN CUKUP AUDIT ============
 *
 * `audit-html-escape.cjs` mendaftarkan fungsi ini sebagai penghasil HTML yang
 * boleh tidak dibungkus `esc()` di tempat pemanggilannya. Pengecualian seperti
 * itu adalah cara paling rapi sebuah pemeriksa berhenti menjaga — dan audit
 * berbasis pola TIDAK BISA membuktikan sebuah fungsi meng-escape seluruh
 * keluarannya: `esc(b.teks)` yang berubah jadi `b.teks` di tengah rantai
 * `map().join()` tidak terlihat beda bagi regex mana pun.
 *
 * Jadi pembuktiannya di sini: keterangan bermuatan markup DIMASUKKAN, lalu
 * keluarannya diperiksa. Satu-satunya `<` yang boleh ada di hasil adalah
 * `<` milik tag yang memang dibuat fungsi ini sendiri.
 */
import { ketNotaHtml } from '../js/modules/cash/keterangan-nota-html.js';

let gagal = 0;
let n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  n++;
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

/** Markup yang DIBUAT fungsi ini dibuang, supaya sisanya pasti dari datanya. */
const sisaSetelahTagSendiri = (html) =>
  html
    .replace(/<button type="button" class="btn-nota" data-id="[^"]*">/g, '')
    .replace(/<\/button>/g, '')
    .replace(/<div class="kas-nota-ekor">/g, '')
    .replace(/<\/div>/g, '');

const JAHAT = '<img src=x onerror=alert(1)>';

// ===============================================================
console.log('§1 Keterangan biasa');
// ===============================================================
cek('§1 tanpa nota, teks apa adanya', ketNotaHtml('Beli galon', []), 'Beli galon');
// Teks kosong keluar kosong, BUKAN "-": fallback `?? '-'` hanya untuk
// null/undefined. Kedua pemanggilnya sudah menjaga kasus ini sendiri
// (`r.notes ? … : ''`), jadi yang diuji di sini perilaku yang memang berlaku,
// bukan yang kelihatan rapi.
cek('§1 teks kosong keluar kosong', ketNotaHtml('', []), '');
cek('§1 null jadi strip', ketNotaHtml(null, []), '-');
cek('§1 tanpa argumen', ketNotaHtml(), '-');

const satu = ketNotaHtml('Pembayaran nota TRM-1', [{ id: 'n1', code: 'TRM-1' }]);
benar('§1 kode nota jadi tombol', satu.includes('class="btn-nota" data-id="n1"'), satu);
benar('§1 teks kodenya ikut tercetak', satu.includes('>TRM-1<'), satu);

// Nota yang kodenya tidak tertulis tetap ditawarkan — kalau tidak, nota itu
// jadi mustahil dibuka hanya karena kalimatnya tidak menyebutnya.
const ekor = ketNotaHtml('Belanja mingguan', [{ id: 'n9', code: 'TRM-9' }]);
benar('§1 nota yang tidak disebut tetap muncul di ekor', ekor.includes('kas-nota-ekor') && ekor.includes('n9'), ekor);

// ===============================================================
console.log('§2 Markup dari keterangan TIDAK boleh lolos');
// ===============================================================

// ============ INI PEMERIKSAAN INTINYA ============
//
// Keterangan kas diketik orang. Satu salinan yang lupa meng-escape tidak
// terlihat rusak sama sekali — sampai ada yang menulis keterangan memuat `<`,
// dan sejak itu markup orang lain ikut masuk ke tabel admin.
for (const [nama, teks] of [
  ['tag mentah', JAHAT],
  ['tanda kurung sudut saja', 'biaya < 100rb'],
  ['kutip ganda', 'beli "galon" 2'],
  ['kutip tunggal', "beli 'galon'"],
  ['ampersand', 'A & B']
]) {
  const hasil = ketNotaHtml(teks, []);
  benar(`§2 ${nama}: tidak ada < yang lolos`, !sisaSetelahTagSendiri(hasil).includes('<'), hasil);
  benar(`§2 ${nama}: tidak ada " yang lolos`, !sisaSetelahTagSendiri(hasil).includes('"'), hasil);
}
// Kata "onerror=" BOLEH muncul — sebagai teks. Yang menentukan aman atau
// tidak adalah `<`-nya sudah jadi `&lt;`, sehingga peramban tidak pernah
// melihat tag untuk dipasangi atribut itu.
benar('§2 tag jahat tercetak sebagai teks, bukan tag', ketNotaHtml(JAHAT, []).startsWith('&lt;img'), ketNotaHtml(JAHAT, []));

// ============ DAN SAAT ADA TOMBOL NOTA DI KALIMAT YANG SAMA ============
//
// Jalur `bagian.map(...)` punya DUA cabang: potongan bernota jadi tombol,
// potongan biasa jadi teks. Yang lupa di-escape biasanya cabang yang kedua,
// dan ia cuma kelihatan kalau keduanya dipakai sekaligus.
const campur = ketNotaHtml(`Bayar nota TRM-1 ${JAHAT}`, [{ id: 'n1', code: 'TRM-1' }]);
benar('§2 tombolnya tetap terbentuk', campur.includes('data-id="n1"'), campur);
benar('§2 dan markup di kalimat yang sama tetap di-escape', !sisaSetelahTagSendiri(campur).includes('<'), campur);

// Kode nota sendiri pun bisa memuat markup — ia datang dari database, dan
// database tidak menjamin apa pun soal isinya.
const kodeJahat = ketNotaHtml('Bayar nota <b>X</b>', [{ id: '"><b>', code: '<b>X</b>' }]);
benar('§2 kode nota bermarkup tidak lolos', !sisaSetelahTagSendiri(kodeJahat).includes('<b>'), kodeJahat);
benar('§2 id nota bermarkup tidak keluar dari atribut', !/data-id="[^"]*"[^>]*><b>/.test(kodeJahat), kodeJahat);

// Ekor juga, jalurnya terpisah.
const ekorJahat = ketNotaHtml('Belanja', [{ id: 'n1', code: JAHAT }]);
benar('§2 ekor ikut di-escape', !sisaSetelahTagSendiri(ekorJahat).includes('<img'), ekorJahat);

// ---------------------------------------------------------------
console.log(`\n${gagal === 0 ? '✅' : '❌'} test-keterangan-nota-html: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
