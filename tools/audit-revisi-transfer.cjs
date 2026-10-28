/**
 * AUDIT: revisi surat jalan transfer aset (0174).
 *
 * ============ CARA FITUR INI RUSAK TANPA TERLIHAT RUSAK ============
 *
 * Revisi memindahkan stok DUA KALI dalam satu langkah — membalikkan kiriman
 * lama, lalu menerapkan yang baru — dan dokumennya sudah beredar di WhatsApp
 * sebelum revisinya ada. Jadi kerusakannya tidak berbentuk galat:
 *
 *   dibalikkan sepotong lalu
 *     berhenti di tengah          -> surat jalan yang isinya tidak cocok
 *                                    dengan stok outlet mana pun
 *   urutan dibalik (hapus baris
 *     sebelum stok dibalikkan)    -> jumlah lamanya hilang dari catatan, dan
 *                                    tidak ada lagi yang bisa dibalikkan
 *   `revisi_ke` tidak naik        -> dua pesan berisi angka berbeda dengan
 *                                    nomor SJ yang SAMA beredar berdampingan
 *   nomor revisi tidak dicetak    -> yang memegang versi lama menyerahkan
 *                                    jumlah lama, dan merasa benar
 *   kotak jumlah dibuka kosong    -> admin yang cuma membetulkan satu baris
 *                                    menghapus sisa kirimannya tanpa sadar
 *   batas jumlah memakai stok
 *     asal saja                   -> revisi yang MENURUNKAN jumlah pun
 *                                    ditolak, karena barangnya sudah keluar
 */
const fs = require('fs');
const path = require('path');

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

const MIG = 'supabase/migrations/0174_revisi_transfer_aset.sql';
const PESAN = 'js/modules/asset/pesan-transfer-aset.js';
const SVC = 'js/modules/asset/asset.service.js';
const PAGE = 'js/modules/asset/transfer-aset.page.js';

// =====================================================================
// 1. SQL — urutan pembalikan
// =====================================================================
const sql = baca(MIG);
if (sql) {
  const fn = sql.slice(sql.indexOf('function ubah_transfer_aset'));

  const iPeriksa = fn.indexOf('raise exception \'Tidak bisa direvisi');
  const iUpdate = fn.indexOf('update asset_stock set qty = qty + r.qty');
  const iHapus = fn.indexOf('delete from asset_transfer_item');
  const iKurangAsal = fn.indexOf('update asset_stock set qty = qty - v_qty');

  if (iPeriksa < 0) {
    salah(
      `${MIG}: tidak ada penjaga "Tidak bisa direvisi" untuk stok outlet tujuan. ` +
        'Tanpa itu, pembalikan bisa berhenti di barang ketiga setelah dua yang pertama sudah bergerak.'
    );
  }
  // ============ PERIKSA SELURUHNYA DULU, BARU BERGERAK ============
  //
  // Kalau pemeriksaannya ada TAPI sesudah update pertama, ia tidak menjaga
  // apa pun: yang pertama sudah berpindah saat yang ketiga ditolak.
  if (iPeriksa >= 0 && iUpdate >= 0 && iPeriksa > iUpdate) {
    salah(
      `${MIG}: pemeriksaan stok outlet tujuan berjalan SESUDAH stok mulai dibalikkan. ` +
        'Revisi yang ditolak akan meninggalkan sebagian perpindahan yang sudah terjadi.'
    );
  }
  if (iUpdate >= 0 && iHapus >= 0 && iHapus < iUpdate) {
    salah(
      `${MIG}: baris surat jalan dihapus SEBELUM stoknya dibalikkan. ` +
        'Jumlah lamanya hilang, dan tidak ada lagi yang bisa dikembalikan ke outlet asal.'
    );
  }
  if (iHapus >= 0 && iKurangAsal >= 0 && iKurangAsal < iHapus) {
    salah(`${MIG}: kiriman baru diterapkan sebelum yang lama dibalikkan — stok asal dipotong dua kali.`);
  }

  if (!/revisi_ke\s*=\s*revisi_ke\s*\+\s*1/.test(sql)) {
    salah(
      `${MIG}: \`revisi_ke\` tidak dinaikkan. Surat jalan versi lama yang sudah beredar di WhatsApp ` +
        'tidak bisa dikenali sebagai versi lama.'
    );
  }
  // `direvisi_by_nama` DIPISAH dari `direvisi_by`, dan bukan karena rewel:
  // `direvisi_by` adalah FK yang di-`set null` saat akunnya dihapus. Kalau
  // namanya tidak ikut disimpan sebagai teks, jejak perevisi hilang persis
  // saat orangnya keluar — yaitu saat jejaknya paling dibutuhkan.
  for (const [kolom, kenapa] of [
    ['direvisi_at', 'kapan'],
    ['direvisi_by', 'siapa (acuan akun)'],
    ['direvisi_by_nama', 'siapa (nama yang tetap terbaca sesudah akunnya dihapus)'],
    ['alasan_revisi', 'kenapa']
  ]) {
    if (!new RegExp(`${kolom}\\s*=`).test(sql)) {
      salah(`${MIG}: \`${kolom}\` tidak pernah diisi — perubahan stok tanpa jejak ${kenapa}.`);
    }
  }
  if (!/Alasan revisi wajib/.test(sql)) {
    salah(`${MIG}: alasan revisi tidak diwajibkan. Dua outlet yang angkanya sama-sama bergeser tidak punya keterangan apa pun.`);
  }
  if (!/is_bu_admin\(v_uid, t\.business_unit_id\)/.test(sql)) {
    salah(`${MIG}: wewenang perevisi tidak diperiksa terhadap BU pengirim.`);
  }
  if (!/sudah dibatalkan/.test(sql)) {
    salah(`${MIG}: SJ yang sudah dibatalkan masih bisa direvisi — stok bergerak untuk dokumen yang tidak berlaku.`);
  }
}

// =====================================================================
// 2. Nomor revisi harus sampai ke KERTAS dan ke WHATSAPP
// =====================================================================
const pesan = baca(PESAN);
if (pesan) {
  if (!/REVISI ke-/.test(pesan)) {
    salah(
      `${PESAN}: teks WhatsApp tidak menyebut nomor revisi. Versi lama masih beredar di grup; ` +
        'tanpa penanda, yang membacanya menyerahkan jumlah lama dan merasa benar.'
    );
  }
  // Penandanya harus TERGANTUNG pada nomornya. "REVISI ke-0" pada surat jalan
  // yang belum pernah direvisi membuat orang mencari versi sebelumnya yang
  // tidak pernah ada.
  if (!/rev\s*>\s*0/.test(pesan)) {
    salah(`${PESAN}: penanda revisi tidak dijaga \`rev > 0\` — SJ yang belum pernah direvisi ikut ditandai.`);
  }
  if (!/revisiKe/.test(pesan)) {
    salah(`${PESAN}: \`revisiKe\` tidak pernah dibaca.`);
  }
}

const page = baca(PAGE);
if (page) {
  if (!/revisiKe:\s*Number\(t\.revisi_ke\)/.test(page)) {
    salah(
      `${PAGE}: \`suratDari\` tidak memetakan \`revisi_ke\`. Modul pesannya tetap benar, ` +
        'tapi angkanya tidak pernah sampai ke sana — WA dan PDF diam-diam kehilangan penandanya.'
    );
  }
  // PDF-nya disusun di layar ini, BUKAN di modul pesan. Jadi kertas di tangan
  // supir bisa kehilangan penanda revisi walaupun pesan WhatsApp-nya punya.
  const iPdf = page.indexOf('subtitle:');
  const blokPdf = iPdf >= 0 ? page.slice(iPdf, iPdf + 500) : '';
  if (!/REVISI ke-/.test(blokPdf)) {
    salah(`${PAGE}: subjudul PDF tidak menyebut nomor revisi — kertas di tangan supir berbeda dari pesan di HP.`);
  }
  if (!/class="tr-edit"/.test(page)) {
    salah(`${PAGE}: tombol Edit tidak ada — \`ubah_transfer_aset\` tidak bisa dijangkau dari layar mana pun.`);
  }
  if (!/isAdmin && !t\.dibatalkan_at && !masuk[\s\S]{0,200}tr-edit/.test(page)) {
    salah(`${PAGE}: tombol Edit tidak dibatasi admin BU pengirim yang SJ-nya belum dibatalkan.`);
  }

  // ============ KOTAK JUMLAH HARUS DIBUKA TERISI ============
  //
  // Database membalikkan SELURUH kiriman lalu menerapkan yang dikirim layar
  // ini. Kotak yang dibuka kosong berarti admin yang cuma mau membetulkan
  // satu baris akan mengirim daftar tanpa baris lainnya — dan sisanya
  // terhapus dari surat jalan tanpa satu pun peringatan.
  const iEdit = page.indexOf('async function dialogEdit');
  const blokEdit = iEdit >= 0 ? page.slice(iEdit, page.indexOf('async function dialogBatal')) : '';
  if (!blokEdit) {
    salah(`${PAGE}: \`dialogEdit\` tidak ada.`);
  } else {
    if (!/value:\s*a\.sudah\s*>\s*0/.test(blokEdit)) {
      salah(
        `${PAGE}: kotak jumlah di dialog Revisi tidak terisi jumlah yang berlaku. ` +
          'Yang dibiarkan kosong akan DIKELUARKAN dari surat jalan — satu baris dibetulkan, sisanya hilang.'
      );
    }
    // Barang yang ada di SJ ini sudah KELUAR dari outlet asal. Batasnya harus
    // menambahkannya kembali, kalau tidak revisi yang hanya menurunkan jumlah
    // pun akan ditolak dengan "tercatat cuma 0".
    if (!/batas:\s*diOutlet\s*\+\s*sudah/.test(blokEdit)) {
      salah(
        `${PAGE}: batas jumlah dihitung dari stok outlet asal saja. ` +
          'Barang yang sudah dibawa SJ ini tidak lagi ada di sana, jadi menurunkan jumlah pun akan tertolak.'
      );
    }
    if (!/alasan/.test(blokEdit) || !/required:\s*true/.test(blokEdit)) {
      salah(`${PAGE}: alasan revisi tidak diwajibkan di layar — galatnya baru muncul dari database.`);
    }
    if (!/pakai Batalkan/.test(blokEdit)) {
      salah(`${PAGE}: revisi tanpa barang tidak diarahkan ke Batalkan — admin akan mengosongkan semuanya dan bingung kenapa ditolak.`);
    }
  }
}

// =====================================================================
// 3. Layanan harus MEMBACA kolom yang dipakai layar
// =====================================================================
const svc = baca(SVC);
if (svc) {
  const iList = svc.indexOf('listTransferAset');
  const blok = iList >= 0 ? svc.slice(iList, iList + 1600) : '';
  for (const kolom of ['revisi_ke', 'alasan_revisi']) {
    if (!blok.includes(kolom)) {
      salah(`${SVC}: \`listTransferAset\` tidak membaca \`${kolom}\` — penanda revisinya tidak pernah sampai ke layar.`);
    }
  }
  // Tanpa `asset_item_id`, kotak jumlah tidak bisa dicocokkan ke barangnya,
  // jadi dialog Revisi hanya bisa dibuka kosong — lihat alasan di atas.
  if (!/asset_transfer_item\([^)]*asset_item_id/.test(blok)) {
    salah(`${SVC}: \`asset_item_id\` tidak dibaca — dialog Revisi tidak punya cara mengisi kotak jumlahnya.`);
  }
  // ============ ARGUMENNYA DIBACA DI DALAM FUNGSINYA SAJA ============
  //
  // `p_alasan` dan `p_catatan` juga dipakai RPC aset yang lain di berkas yang
  // sama (catat/batalkan kerusakan, hapus item). Memeriksanya terhadap seluruh
  // berkas membuat audit ini tetap hijau walaupun argumennya DICABUT dari
  // `ubahTransferAset` — persis bentuk pemeriksa yang berhenti menjaga tanpa
  // satu pun tanda. Jadi blok fungsinya dipotong dulu.
  const iUbah = svc.indexOf('export async function ubahTransferAset');
  if (iUbah < 0) {
    salah(`${SVC}: \`ubahTransferAset\` tidak ada — layar Revisi tidak punya jalan ke database.`);
  } else {
    const blokUbah = svc.slice(iUbah, svc.indexOf('\n}', iUbah));
    if (!/rpc\('ubah_transfer_aset'/.test(blokUbah)) {
      salah(`${SVC}: \`ubahTransferAset\` tidak memanggil RPC-nya.`);
    }
    for (const p of ['p_id', 'p_to_outlet', 'p_tujuan_lain', 'p_pembawa', 'p_items', 'p_alasan', 'p_catatan']) {
      if (!new RegExp(`${p}:`).test(blokUbah)) {
        salah(`${SVC}: argumen \`${p}\` tidak dikirim — PostgREST akan memilih fungsi lain atau menolak diam-diam.`);
      }
    }
  }
}

console.log('');
if (gagal === 0) console.log('Audit revisi transfer aset bersih. ✅');
else console.error(`${gagal} masalah ditemukan.`);
process.exit(gagal === 0 ? 0 : 1);
