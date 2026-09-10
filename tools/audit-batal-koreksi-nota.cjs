/**
 * AUDIT: batal & koreksi nota (0131).
 *
 * ============ SATU ATURAN YANG MUDAH TERGELINCIR ============
 *
 * Nota yang berubah harus menarik TIGA hal bersamaan: stok, kas, dan jejaknya.
 * Yang tertinggal tidak akan pernah mengeluh — ia cuma membuat dua laporan
 * bercerita berbeda, dan yang menemukannya adalah orang yang menghitung barang
 * atau uang fisik berminggu-minggu kemudian.
 *
 * Yang dijaga:
 *
 *   1. Membatalkan nota membuat pergerakan stok PENYEIMBANG — bukan menghapus
 *      pergerakan lama, dan bukan menghapus notanya.
 *   2. Nota lunas yang berubah nilainya menyesuaikan kas sebesar SELISIHNYA.
 *   3. Kunci "nota lunas" hanya dibuka `koreksi_nota`. Jalur langsung tetap
 *      tertutup, dan penandanya tidak boleh tertinggal menyala.
 *   4. Alasan wajib, wewenang diperiksa, dan nota yang sudah diekspor ESB
 *      ditahan.
 *   5. Layar benar-benar menyediakan jalannya — tombol Hapus, kotak tanggal,
 *      dan Edit yang tetap hidup pada nota lunas.
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
const mig = baca('supabase/migrations/0131_nota_batal_dan_koreksi.sql');
if (mig) {
  for (const fn of ['batalkan_nota', 'koreksi_nota', 'sesuaikan_kas_nota', 'jaga_ubah_item_nota']) {
    if (!new RegExp(`create or replace function ${fn}\\(`).test(mig)) {
      salah(`0131: fungsi \`${fn}\` tidak ada.`);
    }
  }
  for (const fn of ['batalkan_nota(uuid, text)', 'koreksi_nota(uuid, date, text, text, text, text, jsonb, text)']) {
    if (!mig.includes(`grant execute on function ${fn} to authenticated`)) {
      salah(`0131: \`${fn}\` tidak diberikan ke authenticated — layarnya akan dapat 42883.`);
    }
  }

  // `sesuaikan_kas_nota` TIDAK boleh terbuka untuk klien. Ia memindahkan uang
  // tanpa memeriksa wewenang sendiri; penjaganya ada di kedua pemanggilnya.
  if (!/revoke all on function sesuaikan_kas_nota\(uuid, numeric, text\) from public/.test(mig)) {
    salah('0131: `sesuaikan_kas_nota` tidak dicabut dari public — ia memindahkan uang tanpa memeriksa wewenang sendiri.');
  }
  if (/grant execute on function sesuaikan_kas_nota/.test(mig)) {
    salah('0131: `sesuaikan_kas_nota` diberikan ke klien. Siapa pun bisa menambah/mengurangi kas dengan angka pilihannya sendiri.');
  }

  const blokBatal = mig.slice(mig.indexOf('function batalkan_nota('), mig.indexOf('revoke all on function batalkan_nota'));

  // (1) STOK — penyeimbang, bukan penghapusan.
  if (!/insert into stock_movements[\s\S]*?-r\.qty/.test(blokBatal)) {
    salah('0131 `batalkan_nota`: tidak membuat pergerakan stok penyeimbang. Stok tetap bertambah untuk barang yang notanya dibatalkan.');
  }
  if (/delete from stock_movements/.test(mig)) {
    salah(
      '0131: menghapus baris `stock_movements`. Pergerakan stok adalah catatan sejarah; menghapusnya membuat saldo hari-hari di antaranya tidak bisa direkonstruksi (lihat 0084).'
    );
  }
  if (/delete from goods_receipts\b/.test(mig)) {
    salah('0131: menghapus baris nota. Keputusannya BATALKAN, bukan buang — nomor nota yang melompat tidak bisa dijelaskan siapa pun belakangan.');
  }

  // (2) KAS — selisih, dan hanya kalau memang sudah dibayar dari kas.
  if (!/perform sesuaikan_kas_nota\(p_nota, -v_total/.test(blokBatal)) {
    salah('0131 `batalkan_nota`: kas tidak dikembalikan. Nota lunas yang dibatalkan meninggalkan uang keluar untuk barang yang sudah ditarik.');
  }
  const blokKas = mig.slice(mig.indexOf('function sesuaikan_kas_nota('), mig.indexOf('revoke all on function sesuaikan_kas_nota'));
  if (!/payment_status is distinct from 'lunas'/.test(blokKas)) {
    salah('0131 `sesuaikan_kas_nota`: tidak memeriksa apakah notanya sudah dibayar — nota yang belum dibayar akan dibuatkan entri kas untuk uang yang tidak pernah berpindah.');
  }
  if (!/payment_source = 'pusat'/.test(blokKas)) {
    salah('0131 `sesuaikan_kas_nota`: nota yang dibayar PUSAT (0125) tidak dikecualikan — padahal ia tidak pernah menyentuh kas mana pun.');
  }
  if (!/case when p_selisih > 0 then 'out' else 'in' end/.test(blokKas)) {
    salah('0131 `sesuaikan_kas_nota`: arah entri kasnya tidak mengikuti tanda selisihnya.');
  }

  const blokKoreksi = mig.slice(mig.indexOf('function koreksi_nota('), mig.indexOf('revoke all on function koreksi_nota'));
  if (!/v_selisih := v_sesudah - v_sebelum/.test(blokKoreksi)) {
    salah('0131 `koreksi_nota`: tidak menghitung selisih sebelum-sesudah, jadi kasnya tidak punya dasar penyesuaian.');
  }

  // (3) Kunci lunas: dibuka hanya di dalam koreksi_nota, dan ditutup lagi.
  const buka = (mig.match(/set_config\('berjaya\.koreksi_nota', 'on'/g) ?? []).length;
  const tutup = (mig.match(/set_config\('berjaya\.koreksi_nota', ''/g) ?? []).length;
  if (buka === 0) {
    salah('0131: penanda pembuka kunci nota lunas tidak ada — `koreksi_nota` akan ditolak oleh penjaganya sendiri.');
  }
  if (tutup < buka + 1) {
    salah(
      `0131: kunci nota lunas dibuka ${buka}x tapi ditutup hanya ${tutup}x. ` +
        'Jalur GAGAL juga harus menutupnya, kalau tidak satu koreksi yang melempar meninggalkan kunci terbuka untuk sisa transaksinya.'
    );
  }
  if (!/coalesce\(current_setting\('berjaya\.koreksi_nota', true\), ''\) <> 'on'/.test(mig)) {
    salah('0131 `jaga_ubah_item_nota`: tidak memeriksa penandanya — nota lunas jadi bisa diubah dari jalur mana pun, tanpa kas ikut bergerak.');
  }

  // (4) Penjaga lain.
  for (const [pola, pesan] of [
    [/coalesce\(btrim\(p_alasan\), ''\) = ''/, 'alasan pembatalan tidak diwajibkan'],
    [/has_outlet_scope\(v_uid, v_g\.outlet_id\)/, '`batalkan_nota` tidak memeriksa wewenang outlet'],
    [/has_outlet_scope\(auth\.uid\(\), v_g\.outlet_id\)/, '`koreksi_nota` tidak memeriksa wewenang outlet']
  ]) {
    if (!pola.test(mig)) salah(`0131: ${pesan}.`);
  }
  // Diperiksa PER FUNGSI, bukan dengan menghitung kemunculan.
  //
  // Versi pertama menghitung berapa kali `esb_exported_at is not null` muncul
  // dan menuntut tiga. Triggernya menyimpan nilainya ke variabel lebih dulu
  // (`v_esb is not null`), jadi hitungannya dua — dan audit itu menuduh kode
  // yang benar sambil tetap buta kalau salah satu fungsinya kehilangan
  // penjagaan sementara yang lain punya dua.
  const blokTrigger = mig.slice(mig.indexOf('function jaga_ubah_item_nota('), mig.indexOf('drop trigger if exists trg_tolak_ubah_nota_lunas'));
  for (const [nama, blok] of [
    ['jaga_ubah_item_nota', blokTrigger],
    ['koreksi_nota', blokKoreksi],
    ['batalkan_nota', blokBatal]
  ]) {
    if (!/(esb_exported_at|v_esb) is not null/.test(blok)) {
      salah(
        `0131 \`${nama}\`: nota yang sudah diekspor ke ESB tidak ditahan. ` +
          'ESB dan Berjaya Hub akan menyimpan angka berbeda selamanya tanpa satu pun baris yang terlihat aneh.'
      );
    }
  }
  if (!/g\.status = 'aktif'/.test(mig)) {
    salah('0131: `tandai_nota_esb` tidak menyaring nota batal — nota yang sudah ditarik stoknya bisa berangkat ke ESB sebagai pembelian sungguhan.');
  }
}

// ---------------------------------------------------------------
// Layanan
// ---------------------------------------------------------------
const svc = baca('js/modules/inventory/nota.service.js');
if (svc) {
  const kode = tanpaKomentar(svc);
  for (const fn of ['koreksi_nota', 'batalkan_nota']) {
    // `\s*` karena panggilan berargumen banyak ditulis menurun oleh formatter —
    // `rpc(\n  'koreksi_nota',`. Tanpa itu audit ini menuduh kode yang benar
    // hanya karena bentuk barisnya.
    if (!new RegExp(`rpc\\(\\s*'${fn}'`).test(kode)) salah(`nota.service.js: RPC \`${fn}\` tidak pernah dipanggil.`);
  }
  if (!/status, alasan_batal/.test(kode)) {
    salah('nota.service.js `riwayatNota`: tidak mengambil `status`/`alasan_batal` — layar tidak bisa membedakan nota batal dari nota biasa.');
  }
}

// ---------------------------------------------------------------
// Layar
// ---------------------------------------------------------------
const hal = baca('js/modules/inventory/nota-staff.js');
if (hal) {
  const kode = tanpaKomentar(hal);

  if (!/class="btn-danger nota-hapus"/.test(kode)) salah('nota-staff.js: tombol Hapus tidak ada di baris nota.');
  if (!/querySelectorAll\('\.nota-hapus'\)/.test(kode)) salah('nota-staff.js: tombol Hapus ada tapi tidak terhubung — ditekan, tidak terjadi apa-apa.');
  if (!/batalkanNota\(/.test(kode)) salah('nota-staff.js: tidak memanggil `batalkanNota`.');

  // Konsekuensinya disebut SEBELUM ditekan.
  if (!/DITARIK KEMBALI/.test(kode)) {
    salah('nota-staff.js: dialog pembatalan tidak menyebut bahwa stoknya ditarik. Kata "Hapus" saja tidak memberitahu apa pun tentang stok.');
  }
  if (!/name: 'alasan'/.test(kode)) salah('nota-staff.js: alasan pembatalan tidak diminta di layar — penolakan servernya akan datang sesudah tombol ditekan.');

  // Edit: tanggal, dan tetap hidup untuk nota lunas.
  if (!/name: 'tanggal', label: 'Tanggal nota', type: 'date'/.test(kode)) {
    salah('nota-staff.js: kotak tanggal tidak ada di dialog edit — salah ketik tanggal memindahkan biayanya ke bulan yang salah.');
  }
  if (!/koreksiNota\(/.test(kode)) salah('nota-staff.js: dialog edit tidak memakai `koreksiNota`, jadi kas tidak akan pernah menyesuaikan.');
  if (/await ubahNota\(nota\.id/.test(kode)) {
    salah('nota-staff.js: dialog edit masih memakai `ubahNota` — nota lunas akan ditolak server, dan kas tidak disesuaikan.');
  }

  // Tombol Edit tidak boleh lagi disembunyikan hanya karena notanya lunas.
  //
  // Yang diperiksa: `nota-edit` digambar SEBELUM percabangan lunas, jadi ia
  // tidak berada di dalam salah satu cabangnya. Versi pertama pemeriksaan ini
  // mencari `payment_status === 'lunas' ? <button class="nota-batal"` — pola
  // yang MASIH ADA dan memang benar, karena ia sekarang memilih antara
  // "Batalkan pembayaran" dan "Tunai/Tempo", bukan lagi menggantikan Edit.
  const iEdit = kode.indexOf('class="nota-edit"');
  const iCabang = kode.indexOf("n.payment_status === 'lunas'");
  if (iEdit < 0) {
    salah('nota-staff.js: tombol Edit hilang dari baris nota.');
  } else if (iCabang >= 0 && iEdit > iCabang) {
    salah('nota-staff.js: tombol Edit berada di dalam percabangan status bayar — pada nota lunas ia akan hilang, padahal 0131 membuatnya bisa diperbaiki langsung.');
  }

  // Nota batal: terlihat, tapi tidak bisa disentuh.
  if (!/nota-baris-batal/.test(kode)) salah('nota-staff.js: nota batal tidak ditandai di daftar.');
  if (!/const batal = n\.status === 'dibatalkan'/.test(kode)) {
    salah('nota-staff.js: status batal tidak dibaca, jadi tombol aksinya tetap muncul untuk nota yang sudah ditarik.');
  }
}

const ui = baca('js/core/ui.js');
if (ui) {
  // `danger` yang dikirim tapi tidak dikenal akan DIABAIKAN diam-diam — bentuk
  // kegagalan yang pernah menghapus kolom pemegang kas dari sebuah dialog.
  const kode = tanpaKomentar(ui);
  const i = kode.indexOf('export function formDialog');
  // Jendelanya sengaja lebar: tanda tangan fungsinya panjang, dan template
  // tombolnya ada jauh di bawah. Jendela 1200 huruf berhenti tepat sebelum
  // barisnya, lalu melaporkan opsi yang sebenarnya dipakai sebagai tidak dipakai.
  const blok = kode.slice(i, i + 3000);
  if (!/danger = false/.test(blok)) {
    salah('ui.js `formDialog`: tidak mengenal opsi `danger`, padahal layar nota mengirimnya. Opsi yang tidak dikenal diabaikan tanpa satu pun tanda.');
  }
  if (!/danger \? 'btn-danger' : 'primary'/.test(blok)) {
    salah('ui.js `formDialog`: opsi `danger` diterima tapi tidak dipakai.');
  }
}

if (gagal === 0) {
  console.log('Batal & koreksi nota: stok ditarik, kas menyesuaikan, jejaknya wajib, dan kunci lunas hanya dibuka koreksi_nota. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
