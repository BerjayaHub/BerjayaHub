/**
 * AUDIT: jalan keluar untuk kiriman salah alamat (0133).
 *
 * ============ LUBANG YANG DITUTUPNYA ============
 *
 * Status `cancelled` sudah ada di batasan `dispatches` sejak 0022, tapi TIDAK
 * ADA satu pun fungsi yang pernah mengisinya, dan penerima tidak punya tombol
 * tolak. Kiriman salah alamat WAJIB diterima outlet yang salah.
 *
 * Bentuk kegagalannya khas: batasannya terlihat lengkap, layarnya terlihat
 * wajar, dan yang menemukannya adalah orang yang sedang menghadapi masalahnya.
 *
 * ============ ATURAN YANG DIJAGA ============
 *
 * Yang menentukan bukan siapa yang salah, melainkan DI MANA BARANGNYA:
 *
 *   BELUM diterima -> BATALKAN. Stok belum bergerak, jadi bersih.
 *   SUDAH diterima -> TERUSKAN. Barangnya sungguhan di sana; membatalkannya
 *     membuat pembukuan berbohong sampai ada yang mengantarkannya kembali.
 *
 * Menukar keduanya adalah kesalahan paling mahal yang bisa dibuat di berkas
 * ini, dan tidak satu pun dari keduanya melempar error saat terjadi.
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
const mig = baca('supabase/migrations/0133_kiriman_salah_alamat.sql');
if (mig) {
  for (const fn of ['batalkan_kiriman', 'teruskan_kiriman']) {
    if (!new RegExp(`create or replace function ${fn}\\(`).test(mig)) salah(`0133: fungsi \`${fn}\` tidak ada.`);
  }
  if (!/grant execute on function batalkan_kiriman\(uuid, text\) to authenticated/.test(mig)) {
    salah('0133: `batalkan_kiriman` tidak diberikan ke authenticated — layarnya akan dapat 42883.');
  }
  if (!/grant execute on function teruskan_kiriman\(uuid, uuid, text\) to authenticated/.test(mig)) {
    salah('0133: `teruskan_kiriman` tidak diberikan ke authenticated.');
  }
  for (const kol of ['dibatalkan_at', 'dibatalkan_by', 'alasan_batal', 'koreksi_dari']) {
    if (!new RegExp(`add column if not exists ${kol}`).test(mig)) salah(`0133: kolom \`dispatches.${kol}\` tidak dibuat.`);
  }

  const blokBatal = mig.slice(mig.indexOf('function batalkan_kiriman('), mig.indexOf('revoke all on function batalkan_kiriman'));
  const blokTerus = mig.slice(mig.indexOf('function teruskan_kiriman('), mig.indexOf('revoke all on function teruskan_kiriman'));

  // ---- Batalkan: hanya yang BELUM diterima ----
  if (!/v_d\.status = 'received'/.test(blokBatal)) {
    salah(
      '0133 `batalkan_kiriman`: tidak menahan kiriman yang SUDAH diterima. ' +
        'Barangnya sungguhan ada di sana — membatalkannya membuat pembukuan berbohong sampai ada yang mengantarkannya kembali.'
    );
  }
  if (!/Teruskan/i.test(blokBatal)) {
    salah('0133 `batalkan_kiriman`: penolakannya tidak mengarahkan ke "Teruskan" — orangnya ditinggalkan tanpa jalan keluar.');
  }
  if (!/v_d\.status = 'draft'/.test(blokBatal)) {
    salah('0133 `batalkan_kiriman`: draft tidak diarahkan ke "Hapus draft" — ia punya jalannya sendiri sejak 0103.');
  }

  // KEDUA SISI berwenang membatalkan (keputusan pengguna).
  if (!/has_outlet_scope\(v_uid, v_d\.from_outlet_id\) or has_outlet_scope\(v_uid, v_d\.to_outlet_id\)/.test(blokBatal)) {
    salah('0133 `batalkan_kiriman`: wewenangnya tidak mencakup kedua sisi. Penerima yang sadar duluan harus bisa menolaknya sendiri.');
  }
  if (!/coalesce\(btrim\(p_alasan\), ''\) = ''/.test(blokBatal)) {
    salah('0133 `batalkan_kiriman`: alasan tidak diwajibkan — pembatalan tanpa alasan tidak bisa dibedakan dari kesalahan sistem.');
  }
  if (!/esb_exported_at is not null/.test(blokBatal)) {
    salah('0133 `batalkan_kiriman`: kiriman yang sudah diekspor ke ESB tidak ditahan.');
  }

  // STOK kiriman LAMA harus dikembalikan.
  //
  // Sebelum 0103 stok dipotong saat kiriman DIBUAT, dan `receive_dispatch`
  // sampai kini masih memeriksanya (`v_ck_sudah`). Membatalkan kiriman lama
  // tanpa mengembalikan potongan itu menghilangkan barangnya untuk selamanya.
  if (!/from stock_movements\s+where dispatch_id = p_dispatch/.test(blokBatal)) {
    salah(
      '0133 `batalkan_kiriman`: tidak memeriksa apakah stoknya sudah terpotong. ' +
        'Kiriman lama (pra-0103) memotong stok saat DIBUAT — membatalkannya tanpa mengembalikan potongan itu menghilangkan barangnya dari pembukuan.'
    );
  }
  if (/delete from stock_movements/.test(mig)) {
    salah('0133: menghapus baris `stock_movements`. Pergerakan stok adalah catatan sejarah — pengembaliannya lewat pergerakan penyeimbang (0084).');
  }

  // ---- Teruskan: hanya yang SUDAH diterima, oleh penerimanya ----
  if (!/v_d\.status <> 'received'/.test(blokTerus)) {
    salah('0133 `teruskan_kiriman`: tidak menahan kiriman yang BELUM diterima — yang benar di situ adalah membatalkan, bukan meneruskan.');
  }
  if (!/BATALKAN/i.test(blokTerus)) {
    salah('0133 `teruskan_kiriman`: penolakannya tidak mengarahkan ke "batalkan".');
  }
  if (!/has_outlet_scope\(v_uid, v_d\.to_outlet_id\)/.test(blokTerus)) {
    salah('0133 `teruskan_kiriman`: bukan hanya outlet PENERIMA yang bisa meneruskan. Ia yang memegang barangnya.');
  }
  if (!/coalesce\(received_qty, 0\) > 0/.test(blokTerus)) {
    salah('0133 `teruskan_kiriman`: meneruskan jumlah yang DIKIRIM, bukan yang benar-benar DITERIMA. Yang tidak sampai tidak bisa diteruskan.');
  }
  if (!/buat_draft_kiriman\(/.test(blokTerus)) {
    salah('0133 `teruskan_kiriman`: tidak memakai `buat_draft_kiriman` — hasilnya harus DRAFT, karena barangnya masih harus dinaikkan ke mobil.');
  }
  if (!/koreksi_dari = p_dispatch/.test(blokTerus)) {
    salah('0133 `teruskan_kiriman`: kiriman koreksinya tidak tersambung ke kiriman yang salah — sebulan kemudian tidak ada yang bisa menjelaskannya.');
  }
  if (!/p_tujuan = v_d\.to_outlet_id/.test(blokTerus)) {
    salah('0133 `teruskan_kiriman`: tujuan yang sama dengan tempat barangnya sekarang tidak ditolak.');
  }
}

// ---------------------------------------------------------------
// Layanan
// ---------------------------------------------------------------
const svc = baca('js/modules/dispatch/dispatch.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  for (const fn of ['batalkan_kiriman', 'teruskan_kiriman']) {
    if (!new RegExp(`rpc\\(\\s*'${fn}'`).test(kode)) salah(`dispatch.service.js: RPC \`${fn}\` tidak pernah dipanggil.`);
  }
  // Layar riwayat perlu tahu siapa PENERIMAnya untuk memutuskan tombolnya.
  if (!/to_outlet_id, alasan_batal/.test(kode)) {
    salah('dispatch.service.js `listMyDispatches`: tidak mengambil `to_outlet_id`/`alasan_batal` — layar tidak bisa memutuskan tombol mana yang benar.');
  }
}

// ---------------------------------------------------------------
// Layar
// ---------------------------------------------------------------
const hal = baca('js/modules/dispatch/dispatch.page.js');
if (hal) {
  const kode = tanpaKomentar(hal);

  // Tombol tolak di sisi penerima.
  if (!/class="btn-danger btn-tolak-kiriman"/.test(kode)) {
    salah('dispatch.page.js: tombol tolak tidak ada di Kiriman Masuk — penerima kiriman salah alamat tetap wajib menerimanya.');
  }
  if (!/querySelectorAll\('\.btn-tolak-kiriman'\)/.test(kode)) {
    salah('dispatch.page.js: tombol tolak ada tapi tidak terhubung.');
  }

  // Batalkan & Teruskan di riwayat.
  for (const [kelas, apa] of [
    ['btn-batal-kiriman', 'Batalkan'],
    ['btn-teruskan-kiriman', 'Teruskan']
  ]) {
    if (!new RegExp(`class="[^"]*${kelas}"`).test(kode)) salah(`dispatch.page.js: tombol ${apa} tidak ada di Riwayat & Dokumen.`);
    if (!new RegExp(`querySelectorAll\\('\\.${kelas}'\\)`).test(kode)) salah(`dispatch.page.js: tombol ${apa} tidak terhubung.`);
  }

  // Tombolnya harus mengikuti KEADAAN, bukan muncul di mana-mana.
  if (!/d\.status === 'sent'/.test(kode) || !/d\.status === 'received' && d\.to_outlet_id === state\.outletId/.test(kode)) {
    salah(
      'dispatch.page.js: tombol Batalkan/Teruskan tidak dipilih menurut status & siapa penerimanya. ' +
        'Tombol yang salah di keadaan yang salah akan ditolak server sesudah orangnya mengisi dialog — pekerjaannya terbuang.'
    );
  }

  // Konfirmasi sebelum kirim, menyebut JENISnya.
  if (!/TRANSFER ANTAR OUTLET/.test(kode) || !/RETUR KE CENTRAL KITCHEN/.test(kode)) {
    salah(
      'dispatch.page.js: dialog konfirmasi tidak menyebut JENIS kirimannya. ' +
        'Kesalahan di lapangan adalah salah memilih jenis, bukan salah memilih outlet — dialog yang cuma menyebut nama outlet tidak menangkapnya.'
    );
  }
  const iKonfirmasi = kode.indexOf('const jenisKirim =');
  const iKirim = kode.indexOf('await buatDraftKiriman({ fromOutlet: state.outletId');
  if (iKonfirmasi < 0 || iKirim < 0 || iKonfirmasi > iKirim) {
    salah('dispatch.page.js: konfirmasi jenis kiriman tidak berada SEBELUM pembuatan surat jalan.');
  }
}

if (gagal === 0) {
  console.log('Kiriman salah alamat: belum diterima → batalkan, sudah diterima → teruskan, dan jenisnya dikonfirmasi sebelum dikirim. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
