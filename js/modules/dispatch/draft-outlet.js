/**
 * Keadaan "Order ke CK" di mata staff outlet yang baru membuka layarnya.
 *
 * ============ APA YANG SEBENARNYA KURANG ============
 *
 *   "apabila di tanggal sekian sudah terbentuk draft order di sisi outlet ke ck
 *    dan belum dikirim ke ck status order nya, maka akan muncul draft order
 *    yang sudah dibuat itu, jadi staff b tidak membuat draft order baru
 *    sekaligus nomor order baru"
 *
 * Dua nomor draft SEKALIGUS sebenarnya sudah tidak mungkin sejak 0111:
 *
 *     create unique index stock_orders_satu_draft
 *       on stock_orders(from_outlet_id, to_outlet_id) where status = 'draft';
 *
 * dan `buat_atau_ambil_draft_order` mengembalikan draft yang sudah ada alih-alih
 * membuat yang baru. Jadi jaminannya ada di tempat yang benar.
 *
 * Yang TIDAK ada adalah tanda di layar. Staff B membuka tab Order ke CK dan
 * melihat tombol "Buka / Buat Draft Order" — kalimat yang tidak memberi tahu
 * mana yang akan terjadi. Ia menekannya, mendapat draft milik staff A yang
 * sudah berisi setengah pesanan, dan tidak ada apa pun yang mengatakan bahwa
 * itu bukan daftar kosong miliknya sendiri.
 *
 * Jaminan yang bekerja diam-diam tetap terasa seperti tidak ada.
 *
 * ============ SATU KEADAAN LAGI YANG LEBIH BERBAHAYA ============
 *
 * Draft yang belum dikirim bukan satu-satunya sumber dobel order. Kalau staff A
 * sudah MENGIRIM ordernya pagi tadi, draftnya tidak ada lagi — dan staff B yang
 * membuat draft baru siang harinya benar-benar boleh, karena ordernya memang
 * dua dokumen yang berbeda.
 *
 * Barangnya tetap dobel. Yang menahan hanya ingatan orang, dan ingatan orang
 * adalah hal pertama yang habis saat sedang sibuk. Jadi order yang MASIH
 * MENUNGGU DIPROSES CK juga disebut di layar.
 *
 * Tidak ada impor di berkas ini, supaya aturannya bisa diuji tanpa browser.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Draft yang masih berjalan untuk outlet ini, atau null.
 *
 * @param {Array<{id:string, code?:string, status?:string}>} orders
 * @returns {object|null}
 */
export function draftBerjalan(orders) {
  const daftar = Array.isArray(orders) ? orders : [];
  return daftar.find((o) => o?.status === 'draft') ?? null;
}

/**
 * Order yang SUDAH dikirim tapi belum diproses CK.
 *
 * Statusnya `open` — CK sudah melihatnya, isinya terkunci, tapi barangnya
 * belum datang. Inilah yang paling mudah terlupakan saat staff berikutnya
 * hendak memesan.
 */
export function orderMenunggu(orders) {
  const daftar = Array.isArray(orders) ? orders : [];
  return daftar.filter((o) => o?.status === 'open');
}

/**
 * Ada lebih dari satu draft? Seharusnya MUSTAHIL sejak 0111.
 *
 * Diperiksa juga di sini bukan karena diragukan, melainkan karena kalau
 * indeks uniknya suatu saat hilang — migration yang gagal separuh, restore
 * dari cadangan lama — layar tidak boleh diam-diam memilih salah satu dan
 * menyembunyikan yang lain. Itu justru bentuk dobel order yang paling sulit
 * dilacak: dua nomor yang keduanya "benar" menurut layar.
 */
export function draftGanda(orders) {
  const daftar = Array.isArray(orders) ? orders : [];
  return daftar.filter((o) => o?.status === 'draft');
}

/**
 * Keadaan layar Order ke CK, siap dipakai menggambar.
 *
 * @returns {{mode: 'ada-draft'|'ada-draft-ganda'|'menunggu'|'kosong',
 *            draft?: object, ganda?: object[], menunggu: object[]}}
 */
export function keadaanOrderKeCk(orders) {
  const ganda = draftGanda(orders);
  const menunggu = orderMenunggu(orders);
  if (ganda.length > 1) return { mode: 'ada-draft-ganda', draft: ganda[0], ganda, menunggu };
  if (ganda.length === 1) return { mode: 'ada-draft', draft: ganda[0], menunggu };
  if (menunggu.length) return { mode: 'menunggu', menunggu };
  return { mode: 'kosong', menunggu: [] };
}

/**
 * Label tombolnya mengikuti keadaan.
 *
 * "Buka / Buat" adalah dua kemungkinan dalam satu kalimat, dan yang membacanya
 * tidak tahu mana yang akan terjadi. Tombol yang menyebut nomor draftnya
 * sudah menjawab pertanyaannya sebelum ditekan.
 */
export function labelTombolDraft(keadaan) {
  if (keadaan?.mode === 'ada-draft' || keadaan?.mode === 'ada-draft-ganda') {
    return `📝 Buka draft ${teks(keadaan.draft?.code) || 'yang sudah ada'}`;
  }
  return '📝 Buat Draft Order Baru';
}

/**
 * Kalimat peringatan di atas tombolnya.
 *
 * Menyebut NAMA pembuatnya dan KAPAN. "Sudah ada draft" saja tidak memberi
 * tahu apakah itu pekerjaan lima menit lalu yang masih diisi rekan di sebelah,
 * atau sisa kemarin yang terlupakan.
 */
export function pesanKeadaan(keadaan, { jumlahBaris = null } = {}) {
  if (!keadaan) return '';
  const d = keadaan.draft;
  const isi = jumlahBaris === null ? '' : jumlahBaris === 0 ? ', masih kosong' : `, sudah berisi ${jumlahBaris} bahan`;

  if (keadaan.mode === 'ada-draft-ganda') {
    return (
      `Ada ${keadaan.ganda.length} draft order sekaligus di outlet ini — seharusnya tidak mungkin. ` +
      'Gabungkan isinya jadi satu, kirim salah satu, lalu hapus sisanya, dan laporkan ke admin.'
    );
  }
  if (keadaan.mode === 'ada-draft') {
    const oleh = teks(d?.pembuat?.full_name);
    return (
      `Outlet ini SUDAH punya draft order ${teks(d?.code)}${isi}` +
      (oleh ? `, dibuat ${oleh}` : '') +
      '. Tambahkan pesananmu ke draft itu — jangan buat order baru, supaya tidak dobel.'
    );
  }
  if (keadaan.mode === 'menunggu') {
    const kode = keadaan.menunggu.map((o) => teks(o.code)).filter(Boolean).join(', ');
    return (
      `Belum ada draft, tapi ${keadaan.menunggu.length} order sudah dikirim ke CK dan belum diproses` +
      (kode ? ` (${kode})` : '') +
      '. Periksa dulu isinya sebelum memesan lagi — barangnya bisa dobel.'
    );
  }
  return '';
}
