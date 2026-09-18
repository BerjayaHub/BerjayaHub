/**
 * AUDIT: dua HP mengisi satu draft order, dan keduanya tersimpan.
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 *   kembali mengirim SELURUH daftar  -> tambahan HP sebelah terhapus. Kedua
 *                                       orang melihat toast hijau, dan yang
 *                                       menyimpan duluan tidak pernah tahu
 *   baris yang cuma TERLIHAT ikut    -> nilai lama dikembalikan ke baris yang
 *     dikirim sebagai upsert            baru diubah orang lain. Bug yang sama,
 *                                       pindah ke tingkat baris, dan jauh lebih
 *                                       sulit dilihat karena barisnya masih ada
 *   server kembali hapus-lalu-isi     -> selisih yang dikirim rapi tetap
 *                                       menghapus segalanya
 *   catatan ditimpa saat tidak diubah -> catatan rekan hilang karena orang lain
 *                                       menambah satu barang
 *   `on conflict` dicabut             -> dua baris untuk satu produk, dan CK
 *                                       menyiapkan barangnya dua kali
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

// ---------------------------------------------------------------
// 1. Migration 0145.
// ---------------------------------------------------------------
const mig = baca('supabase/migrations/0145_draft_order_digabung.sql');
if (mig) {
  const i = mig.indexOf('create or replace function ubah_draft_order');
  const blok = i < 0 ? '' : mig.slice(i, mig.indexOf('$$;', i));
  if (!blok) salah('0145: `ubah_draft_order` tidak ada.');

  // YANG PALING PENTING: tidak ada penghapusan menyeluruh.
  if (/delete from stock_order_items\s+where order_id = p_order;/.test(mig)) {
    salah(
      '0145: ada `delete from stock_order_items where order_id = p_order` tanpa penyaring produk — itu menghapus ' +
        'SELURUH isi draft, persis bug yang migration ini ada untuk memperbaikinya.'
    );
  }
  if (!/delete from stock_order_items\s+where order_id = p_order and product_id = any\(p_hapus\)/.test(blok)) {
    salah('0145: penghapusan tidak dibatasi ke produk yang disebut `p_hapus`.');
  }
  // Upsert per produk, bukan insert polos.
  if (!/on conflict \(order_id, product_id\) do update set qty = excluded\.qty/.test(blok)) {
    salah(
      '0145: baris tidak di-upsert lewat `on conflict (order_id, product_id)`. Dua HP yang menyentuh produk yang sama ' +
        'akan menghasilkan dua baris, dan CK menyiapkan barangnya dua kali.'
    );
  }
  // Catatan: null = jangan sentuh.
  if (!/set notes = coalesce\(p_notes, notes\)/.test(blok)) {
    salah(
      '0145: catatan ditimpa apa adanya. HP yang tidak menyentuh catatan akan menghapus catatan yang baru ditulis ' +
        'rekannya di HP sebelah.'
    );
  }
  // Penjaga yang disalin dari 0111 harus tetap berdiri.
  for (const [apa, pola] of [
    ['status open', /v_o\.status = 'open'/],
    ['status bukan draft', /v_o\.status <> 'draft'/],
    ['wewenang outlet asal', /has_outlet_scope\(v_uid, v_o\.from_outlet_id\)/],
    ['harus login', /if v_uid is null then raise exception/]
  ]) {
    if (!pola.test(blok)) salah(`0145 \`ubah_draft_order\`: penjaga ${apa} hilang.`);
  }
  // Urutan: hapus DULU, baru isi.
  const iHapus = blok.indexOf('delete from stock_order_items');
  const iIsi = blok.indexOf('insert into stock_order_items');
  if (iHapus >= 0 && iIsi >= 0 && iHapus > iIsi) {
    salah(
      '0145: mengisi dulu baru menghapus. Produk yang dihapus lalu ditambahkan lagi sebelum menyimpan akan ikut ' +
        'terbuang — padahal orangnya baru saja memaksudkannya untuk ada.'
    );
  }
  // Jejak per baris.
  for (const kol of ['diubah_by', 'diubah_at']) {
    if (!new RegExp(`add column if not exists ${kol}`).test(mig)) salah(`0145: kolom \`stock_order_items.${kol}\` tidak dibuat.`);
  }
  if (!/create trigger trg_catat_pengubah_baris_order/.test(mig)) {
    salah('0145: trigger jejak per baris tidak dipasang — `edited_by` hanya menyebut penyimpan terakhir seluruh draft.');
  }
}

// ---------------------------------------------------------------
// 2. Modul murninya — yang memutuskan apa yang dikirim.
// ---------------------------------------------------------------
const murni = baca('js/modules/dispatch/perubahan-draft.js');
if (murni) {
  const kode = bersih(murni, 'perubahan-draft.js', ['export function susunPerubahan']);

  for (const f of ['susunPerubahan', 'pesanGabung']) {
    if (!new RegExp(`export function ${f}\\(`).test(kode)) salah(`perubahan-draft.js: \`${f}\` tidak diekspor.`);
  }
  // INTI: hanya yang BERBEDA yang dikirim.
  if (!/if \(lama\.get\(id\) !== qty\) ubah\.push/.test(kode)) {
    salah(
      'perubahan-draft.js: seluruh baris di layar ikut dikirim, bukan hanya yang berubah. Baris yang cuma TERLIHAT ' +
        'akan mengembalikan nilai lamanya ke baris yang baru saja diubah HP sebelah — bug yang sama, pindah ke ' +
        'tingkat baris, dan jauh lebih sulit dilihat karena barisnya masih ada.'
    );
  }
  if (!/if \(!baru\.has\(id\)\) hapus\.push\(id\)/.test(kode)) {
    salah('perubahan-draft.js: baris yang dibuang dari layar tidak masuk daftar hapus — menghapus jadi tidak mungkin.');
  }
  // Lapis kedua, dan diakui begitu: penjaga `q <= 0` di bawahnya menangkap
  // akibatnya hari ini. Dijaga karena keduanya bisa dicabut satu per satu, dan
  // `Number('') === 0` sudah menggigit di beberapa modul lain di proyek ini.
  if (!/v === null \|\| v === undefined \|\| v === ''/.test(kode)) {
    salah("perubahan-draft.js: `angka()` tidak menyaring nilai kosong — Number('') adalah 0, dan barisnya ikut terhapus diam-diam.");
  }
  if (!/if \(q === null \|\| q <= 0\) continue;/.test(kode)) {
    salah('perubahan-draft.js: qty nol tidak diperlakukan sebagai "tidak ada" — draft akan berisi baris pesanan nol.');
  }
}

// ---------------------------------------------------------------
// 3. Layar & layanannya.
// ---------------------------------------------------------------
const svc = baca('js/modules/dispatch/dispatch.service.js');
if (svc) {
  const kode = bersih(svc, 'dispatch.service.js', ['export async function ubahDraftOrder']);
  if (!/rpc\('ubah_draft_order'/.test(kode)) salah('dispatch.service.js: RPC `ubah_draft_order` tidak pernah dipanggil.');
  if (!/p_hapus: hapus \?\? \[\]/.test(kode)) {
    salah('dispatch.service.js: `p_hapus` tidak selalu dikirim sebagai larik — kunci yang hilang membuat PostgREST tidak menemukan fungsinya.');
  }
}

const page = baca('js/modules/dispatch/dispatch.page.js');
if (page) {
  const kode = bersih(page, 'dispatch.page.js', ['susunPerubahan(isiAwal, newItems)']);

  if (!/const isiAwal = items\.map/.test(kode)) {
    salah('dispatch.page.js: isi saat panel dibuka tidak disimpan — tidak ada pembanding, jadi selisihnya tidak bisa dihitung.');
  }
  if (!/susunPerubahan\(isiAwal, newItems\)/.test(kode)) {
    salah('dispatch.page.js: layar tidak menghitung selisih sebelum menyimpan.');
  }
  if (!/await ubahDraftOrder\(\{/.test(kode)) {
    salah('dispatch.page.js: layar order masih memakai jalur lama yang mengganti seluruh isi draft.');
  }
  // Jalur lama tidak boleh dipakai lagi DI SINI.
  if (/await updateStockOrder\(\{ orderId: btn\.dataset\.id/.test(kode)) {
    salah('dispatch.page.js: pemanggilan `updateStockOrder` lama masih ada di tombol simpan order.');
  }
  // Catatan hanya dikirim kalau berubah.
  if (!/notes: catatanKini === catatanAwal \? null : catatanKini/.test(kode)) {
    salah('dispatch.page.js: catatan selalu dikirim — HP yang cuma menambah barang akan menimpa catatan rekannya.');
  }
  if (!/pesanGabung\(hasil, ubah\.length\)/.test(kode)) {
    salah(
      'dispatch.page.js: hasilnya tidak dilaporkan. Orangnya menyimpan dua baris lalu membuka draft dan menemukan ' +
        'enam — dan tebakan pertama yang wajar adalah "aplikasinya menggandakan pesananku".'
    );
  }
}

if (gagal === 0) {
  console.log(
    'Draft order digabung per baris: yang tidak disentuh tidak dikirim, yang tidak disebut tidak disentuh, catatan ' +
      'rekan aman, dan hasilnya dilaporkan apa adanya. ✅'
  );
}
process.exit(gagal === 0 ? 0 : 1);
