/**
 * AUDIT: tab "Order Masuk" harus MENUNJUKKAN order yang sudah jadi draft.
 *
 * ============ MASALAHNYA BUKAN DATA, TAPI PEKERJAAN TERBUANG ============
 *
 *   "saat nomor order masuk sudah dibuat menjadi draft ... tidak ada staff yang
 *    mengisi di tab order masuk, padahal sudah jadi draft, walaupun memang saat
 *    di tap buat draft akan ditolak, tetapi ini akan jadi pekerjaan sia sia"
 *
 * `siapkan_order_jadi_draft` (0103) sengaja TIDAK menutup ordernya — draft
 * belum berangkat, dan menutup order untuk barang yang masih di rak membuat
 * outlet pemesan mengira pesanannya beres. Keputusan itu benar dan tidak
 * diubah di sini.
 *
 * Akibatnya ordernya tetap tampil lengkap dengan kotak isian jumlahnya. Staff
 * bisa mengisi belasan baris, menekan "Siapkan & Buat Draft SJ", dan baru DI
 * DETIK ITU ditolak: "Order ini sudah punya draft surat jalan."
 *
 * ============ YANG DIKUNCI AUDIT INI ============
 *
 * Bahwa layarnya benar-benar memakai aturannya. Modul `order-draft.js` bisa
 * lulus seluruh tesnya sambil tidak dipanggil satu kali pun — bentuk kegagalan
 * yang di repo ini sudah berulang: kemampuannya ada, jalannya tidak ada di
 * layar.
 *
 * Dan yang paling menentukan: kartu "sudah jadi draft" TIDAK BOLEH punya kotak
 * isian. Label saja tidak cukup — selama kotaknya masih ada, mengisinya tetap
 * terasa seperti pekerjaan yang wajar, dan pekerjaan itu tetap berakhir
 * ditolak.
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.dirname(__dirname);
const HAL = 'js/modules/dispatch/dispatch.page.js';
const MODUL = 'js/modules/dispatch/order-draft.js';
let gagal = 0;
const salah = (pesan) => {
  gagal++;
  console.error(`❌ ${pesan}`);
};

const isi = fs.readFileSync(path.join(AKAR, HAL), 'utf8');

if (!fs.existsSync(path.join(AKAR, MODUL))) {
  salah(`${MODUL} tidak ada — aturannya hilang, audit ini kehilangan sasarannya.`);
}

/** Badan sebuah blok, dihitung dari kurung kurawal pertama sesudah `dari`. */
function badan(teks, dari) {
  let j = teks.indexOf('{', dari);
  if (j === -1) return '';
  let dalam = 0;
  const awal = j;
  for (; j < teks.length; j++) {
    if (teks[j] === '{') dalam++;
    else if (teks[j] === '}') {
      dalam--;
      if (dalam === 0) break;
    }
  }
  return teks.slice(awal, j + 1);
}

// ---------------------------------------------------------------
// 1. Aturannya diimpor dan dipakai — bukan cuma ada di berkasnya.
// ---------------------------------------------------------------
for (const fn of ['petaDraftPerOrder', 'keadaanOrder']) {
  if (!new RegExp(`\\b${fn}\\b`).test(isi)) {
    salah(`${HAL}: \`${fn}\` tidak dipakai. Aturannya ada di ${MODUL} tapi layarnya tidak memanggilnya.`);
  }
}

// ---------------------------------------------------------------
// 2. Daftar draft benar-benar dimuat di tab Order Masuk, dan
//    kegagalannya tidak ditelan jadi "belum ada draft".
// ---------------------------------------------------------------
const iOrders = isi.indexOf('async function renderIncomingOrders');
if (iOrders === -1) {
  salah(`${HAL}: \`renderIncomingOrders\` tidak ditemukan — audit kehilangan sasarannya.`);
} else {
  const badanOrders = badan(isi, iOrders);

  if (!/listDraftKiriman\(/.test(badanOrders)) {
    salah(
      `${HAL}: tab Order Masuk tidak memuat daftar draft (\`listDraftKiriman\`). ` +
        'Tanpa itu tidak ada cara apa pun mengetahui order mana yang sudah disiapkan.'
    );
  }

  if (!/gagalMemuatDraft\s*=\s*true/.test(badanOrders)) {
    salah(
      `${HAL}: kegagalan memuat draft tidak ditandai (\`gagalMemuatDraft = true\`). ` +
        'Daftar draft yang gagal dimuat menghasilkan peta KOSONG, dan peta kosong tidak bisa dibedakan ' +
        'dari "belum ada draft" — layar akan berkata "silakan kerjakan" pada order yang sudah disiapkan.'
    );
  }

  // ---------------------------------------------------------------
  // 3. YANG PALING MENENTUKAN: kartu "sudah jadi draft" tanpa kotak isian.
  // ---------------------------------------------------------------
  const iCabang = badanOrders.indexOf("keadaan.mode === 'sudah-draft'");
  if (iCabang === -1) {
    salah(
      `${HAL}: tidak ada cabang untuk order yang sudah jadi draft (\`keadaan.mode === 'sudah-draft'\`). ` +
        'Semua order digambar sama, dan staff tidak punya cara membedakannya.'
    );
  } else {
    const badanCabang = badan(badanOrders, iCabang);
    for (const [pola, kenapa] of [
      ['ord-send-input', 'kotak isian jumlah kirim'],
      ['btn-fulfill', 'tombol "Siapkan & Buat Draft SJ"']
    ]) {
      if (badanCabang.includes(pola)) {
        salah(
          `${HAL}: kartu order yang SUDAH jadi draft masih memuat ${kenapa} (\`${pola}\`). ` +
            'Label saja tidak menghentikan siapa pun — selama kotaknya ada, mengisinya terasa wajar, ' +
            'dan pekerjaannya tetap berakhir ditolak server.'
        );
      }
    }
    if (!/btn-buka-draft/.test(badanCabang)) {
      salah(
        `${HAL}: kartu order yang sudah jadi draft tidak menawarkan jalan ke draftnya (\`btn-buka-draft\`). ` +
          'Memberi tahu tanpa memberi jalan hanya memindahkan pekerjaan mencari.'
      );
    }
  }

  if (!/state\.fokusDraft\s*=/.test(badanOrders)) {
    salah(`${HAL}: tab Order Masuk tidak pernah menyetel \`state.fokusDraft\` — tautan ke draftnya tidak terhubung.`);
  }
}

// ---------------------------------------------------------------
// 4. Tab Draft membuka draft yang dituju, DAN membuang penandanya
//    sebelum jalan keluar mana pun.
// ---------------------------------------------------------------
const iDrafts = isi.indexOf('async function renderDrafts');
if (iDrafts === -1) {
  salah(`${HAL}: \`renderDrafts\` tidak ditemukan — audit kehilangan sasarannya.`);
} else {
  const badanDrafts = badan(isi, iDrafts);

  // KOMENTARNYA DIBUANG DULU.
  //
  // Percobaan pertama audit ini gagal pada kode yang sudah benar: kata `return`
  // yang ia temukan paling awal ada DI DALAM KOMENTAR yang menjelaskan kenapa
  // penandanya dibuang lebih dulu. Audit yang memarahi penjelasan dari penjaga
  // yang sedang dijaganya akan segera diabaikan — dan audit yang diabaikan sama
  // saja dengan tidak ada. Ini kali kesekian pola yang sama muncul di repo ini.
  //
  // Barisnya diganti spasi supaya urutan posisinya tetap sepadan.
  const tanpaKomentar = badanDrafts
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

  const iAmbil = tanpaKomentar.search(/const fokus = state\.fokusDraft/);
  const iBuang = tanpaKomentar.search(/state\.fokusDraft\s*=\s*null/);
  const iReturnPertama = tanpaKomentar.search(/\breturn\b/);

  if (iAmbil === -1 || iBuang === -1) {
    salah(
      `${HAL}: \`renderDrafts\` tidak mengambil & membuang \`state.fokusDraft\`. ` +
        'Tanpa itu, tautan dari tab Order Masuk tidak membuka apa pun.'
    );
  } else if (iReturnPertama !== -1 && (iAmbil > iReturnPertama || iBuang > iReturnPertama)) {
    salah(
      `${HAL}: \`state.fokusDraft\` dibuang SESUDAH jalan keluar pertama di \`renderDrafts\`. ` +
        'Tiap `return` lebih awal (daftar kosong, gagal memuat) akan meninggalkan penandanya menempel, ' +
        'dan draft yang sama memaksa dirinya terbuka pada penggambaran berikutnya — termasuk sesudah ' +
        'draft itu dikirim atau dihapus.'
    );
  }

  if (!/drf-toggle\[data-id="\$\{fokus\}"\]/.test(badanDrafts)) {
    salah(
      `${HAL}: draft yang dituju tidak dicari & dibuka di \`renderDrafts\`. ` +
        '"Buka draftnya" yang hanya memindahkan orang ke daftar panjang masih pekerjaan sia-sia, cuma berubah bentuk.'
    );
  }
}

if (gagal === 0) {
  console.log('Order Masuk: yang sudah jadi draft ditandai, tanpa kotak isian, dan tertaut ke draftnya. ✅');
}
process.exit(gagal === 0 ? 0 : 1);
