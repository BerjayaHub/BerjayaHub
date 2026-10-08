/**
 * TEKS SURAT JALAN — satu penyusun untuk kertas dan untuk WhatsApp.
 *
 *   "di template whatsapp atau text pesan yang akan dikirimkan atau dibagikan
 *    juga tambahkan keterangan/catatan itu di text nya juga"
 *
 * ============ KENAPA DISATUKAN, BUKAN DISALIN ============
 *
 * Sebelum ini PDF menyusun catatan barisnya sendiri (`diminta 10 — stok CK
 * habis`) sementara teks WhatsApp hanya menulis nama dan jumlah. Keduanya
 * dibaca orang yang sama, pada hari yang sama, untuk kiriman yang sama — dan
 * yang satu memuat jawaban yang tidak ada di yang lain.
 *
 * Itu bukan sekadar kurang lengkap. Pesan WhatsApp adalah yang dibaca DULU,
 * biasanya sebelum mobilnya sampai; kertasnya baru dibaca saat barang
 * diserahkan. Jadi justru dokumen yang datang lebih awal yang kehilangan
 * keterangan "barang ini tidak ikut karena stok CK habis" — persis informasi
 * yang membuat outlet tidak perlu menunggu dan bertanya.
 *
 * Menyalin logikanya ke dua tempat akan menyimpang: satu sisi diperbaiki, yang
 * lain tidak, dan tidak ada apa pun yang melempar error saat itu terjadi.
 *
 * ============ YANG TIDAK DISATUKAN: PEMOTONGAN ============
 *
 * PDF memotong keterangan di 60 karakter karena kertas A5 punya lebar fisik.
 * WhatsApp tidak punya batas itu, dan memotong di sana berarti membuang
 * kalimat yang muat hanya karena dokumen LAIN tidak muat.
 *
 * Jadi pemotongannya tetap milik pemanggil, bukan aturan bersama — lihat
 * parameter `potong`.
 *
 * Satu-satunya impor di berkas ini adalah pemformat angka, yang tidak
 * menyentuh DOM — supaya bisa diuji tanpa browser.
 */
import { formatNum } from '../../core/format.js';

const qty = (n) => (n == null ? '-' : formatNum(n));
const teks = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Catatan untuk SATU baris barang: berapa yang diminta, dan keterangannya.
 *
 * @param {{sent?: any, ordered?: any, unit?: string, keterangan?: string}} it
 * @param {{potong?: number}} [opsi] potong keterangan di n karakter (0 = tidak dipotong)
 * @returns {string[]} potongan catatan, kosong kalau tidak ada yang perlu dikatakan
 */
export function catatanBaris(it, { potong = 0 } = {}) {
  const hasil = [];

  // "Diminta 10, dikirim 0" adalah jawaban yang menutup perdebatan "outlet
  // tidak pesan" versus "CK tidak kirim" (0132). Disebut HANYA kalau berbeda:
  // menulis "diminta 10" di baris yang memang dikirim 10 cuma keramaian, dan
  // keramaian membuat baris yang sungguh berbeda ikut tidak dibaca.
  //
  // `!= null` menangkap `undefined` sekaligus `null`. `Number(null)` adalah 0,
  // jadi tanpa penjaga ini setiap baris tanpa `ordered` akan berbunyi
  // "diminta 0" — tuduhan yang tidak pernah dibuat siapa pun.
  if (it?.ordered != null && Number(it.ordered) !== Number(it.sent)) {
    hasil.push(`diminta ${qty(it.ordered)} ${teks(it.unit)}`.trim());
  }

  const ket = teks(it?.keterangan).trim();
  if (ket) hasil.push(potong > 0 ? ket.slice(0, potong) : ket);

  return hasil;
}

/**
 * Satu baris barang untuk pesan teks.
 *
 * Catatannya ditaruh di BARIS SENDIRI, menjorok — bukan disambung di belakang
 * jumlahnya. Di WhatsApp baris panjang dibungkus sendiri oleh aplikasinya, dan
 * "• Beras: 0 kg — diminta 10 kg — stok CK habis" yang terbungkus jadi dua
 * baris tidak bisa dibedakan dari dua barang.
 */
export function barisPesan(it, { showReceived = false } = {}) {
  const inti =
    `• ${teks(it?.name) || '-'}: ${qty(it?.sent)}` +
    (showReceived ? ` (diterima ${qty(it?.received)})` : '') +
    (teks(it?.unit) ? ` ${teks(it.unit)}` : '');

  const catatan = catatanBaris(it);
  return catatan.length ? `${inti}\n   _${catatan.join(' — ')}_` : inti;
}

/**
 * Teks ringkas surat jalan untuk dikirim lewat WhatsApp / dibagikan.
 *
 * PDF-nya dilampirkan manual oleh orangnya; pesan ini yang dibaca lebih dulu.
 *
 * @param {object} data bentuk yang sama dengan `buildSuratJalanPDF`
 */
export function suratJalanWaText(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const showReceived = !!data?.showReceived;

  const lines = [
    `*${teks(data?.title) || 'Surat Jalan'} ${teks(data?.code)}`.trim() + '*',
    `Dari: ${teks(data?.fromName) || '-'} → ${teks(data?.toName) || '-'}`,
    `Tanggal: ${teks(data?.dateStr) || '-'}`,
    '',
    ...items.map((it) => barisPesan(it, { showReceived }))
  ];

  // Baris yang TIDAK dikirim diringkas tersendiri di bawah.
  //
  // Di daftar tiga puluh baris, "0" di tengah tenggelam — dan justru baris
  // itulah yang perlu ditindaklanjuti outlet hari itu juga. Ringkasan ini
  // tidak menggantikan barisnya; ia membuat barisnya ditemukan.
  const kosong = items.filter((it) => Number(it?.sent) === 0);
  if (kosong.length) {
    lines.push('', `⚠ *${kosong.length} barang TIDAK dikirim:* ${kosong.map((it) => teks(it?.name) || '-').join(', ')}`);
  }

  if (teks(data?.notes).trim()) lines.push('', `Catatan: ${teks(data.notes).trim()}`);
  lines.push('', '(PDF surat jalan terlampir)');
  return lines.join('\n');
}
