/**
 * Teks pengumuman cuti — SATU sumber untuk Telegram dan WhatsApp.
 *
 * ============ KENAPA DISATUKAN ============
 *
 *   "saya ingin teks yang di share whatsapp diubah sama dengan yang di telegram,
 *    jadi bukan hanya bertuliskan pengajuan anda telah disetujui .... tetapi
 *    berisikan informasi sama seperti chat bot yang ada di telegram"
 *
 * Sebelumnya dua saluran punya teksnya masing-masing, ditulis di tempat yang
 * berbeda:
 *
 *   Telegram (`notify-telegram/index.ts`) — nama, jenis, rentang, jumlah hari,
 *                                            siapa yang memutuskan, catatan.
 *   WhatsApp (`leave.admin.page.js`)      — satu kalimat.
 *
 * Yang menerima WhatsApp adalah orang yang paling berkepentingan: staff yang
 * mengajukan. Justru dia yang mendapat versi paling miskin — dan harus bertanya
 * balik "tanggal berapa yang disetujui?" untuk keputusan tentang dirinya
 * sendiri.
 *
 * ============ BEDANYA HANYA PENANDAAN TEBAL ============
 *
 * Telegram memakai HTML (`<b>`), WhatsApp memakai bintang (`*teks*`). Isinya —
 * baris mana, urutannya, kata-katanya — harus sama persis. Kalau dibiarkan
 * ditulis dua kali, keduanya akan menyimpang perlahan, dan yang menyimpang
 * duluan selalu yang lebih jarang dibaca pengembangnya.
 *
 * Jadi bentuk baris disusun sekali di sini, lalu digubah ke penanda masing-
 * masing saluran.
 *
 * ============ KENAPA MODUL SENDIRI ============
 *
 * `leave.admin.page.js` mengimpor klien Supabase, jadi tidak bisa dijalankan di
 * luar browser. Teks yang tidak bisa diuji hanya diperiksa dengan cara
 * membacanya ulang — dan yang paling mudah salah di sini justru hal yang tidak
 * kelihatan salah: rentang tanggal yang ditulis terbalik, atau jumlah hari yang
 * masih memakai angka pengajuan padahal tanggalnya sudah dipersempit admin.
 *
 * Tidak ada impor di file ini, dan sebaiknya tetap begitu.
 */

/** Tanggal `YYYY-MM-DD` -> `4 Sep 2026`. */
export function fmtTanggal(v) {
  if (!v) return '-';
  const s = typeof v === 'string' ? v.slice(0, 10) : '';
  const d = s ? new Date(`${s}T00:00:00`) : new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Rentang yang tidak mengulang dirinya sendiri saat cutinya cuma sehari. */
export function fmtRentang(mulai, selesai) {
  const a = fmtTanggal(mulai);
  const b = fmtTanggal(selesai);
  return a === b ? a : `${a} – ${b}`;
}

/**
 * Baris-baris pesan keputusan cuti, dalam bentuk NETRAL.
 *
 * Tiap baris `{ teks, tebal }`. Bagian yang tebal ditandai dengan `**` di
 * dalam `teks`, dan penggubah tiap saluran yang menerjemahkannya.
 *
 * @param {object} r baris `leave_requests` + relasinya
 * @returns {string[]} baris siap gabung (masih memakai penanda `**`)
 */
export function barisKeputusanCuti(r) {
  const disetujui = (r?.status ?? '') === 'approved';
  const nama = r?.user_profiles?.full_name ?? r?.nama ?? '-';
  const jenis = r?.leave_types?.name ?? r?.jenis ?? 'Cuti';
  const pemutus = r?.reviewer?.full_name ?? r?.pemutus ?? null;

  // TANGGAL YANG DIPAKAI ADALAH YANG DISETUJUI, bukan yang diajukan.
  //
  // Sejak admin bisa mempersempit rentangnya (0117), keduanya bisa berbeda —
  // dan yang perlu diketahui staff untuk merencanakan harinya adalah yang
  // BERLAKU. Yang diajukan tetap disebut, tapi sebagai keterangan, bukan
  // sebagai jawaban.
  const baris = [
    disetujui ? '✅ **Cuti Disetujui**' : '❌ **Cuti Ditolak**',
    '',
    `👤 **${nama}**`,
    `🗂 Jenis: ${jenis}`,
    `📅 ${fmtRentang(r?.start_date, r?.end_date)} (**${r?.day_count ?? '-'} hari**)`
  ];

  if (disetujui && diubahAdmin(r)) {
    // DISEBUT TERANG-TERANGAN.
    //
    // Staff yang mengajukan 4–8 lalu menerima pesan berisi 6–8 tanpa
    // keterangan akan mengira ia salah mengetik pengajuannya sendiri. Yang
    // sebenarnya terjadi — sebagian harinya tidak disetujui — adalah hal yang
    // justru paling perlu ia ketahui, dan paling mudah hilang kalau hanya
    // hasil akhirnya yang ditampilkan.
    baris.push(
      `✏️ Diajukan ${fmtRentang(r.start_date_awal, r.end_date_awal)}` +
        (r.day_count_awal ? ` (${r.day_count_awal} hari)` : '') +
        ' — dipersempit oleh admin'
    );
  }

  if (pemutus) baris.push(`🧑‍💼 Diputuskan oleh: ${pemutus}`);
  if (r?.review_note) baris.push(`💬 ${r.review_note}`);

  return baris.filter((b) => b !== null && b !== undefined);
}

/** Benarkah tanggalnya diubah admin saat menyetujui? */
export function diubahAdmin(r) {
  if (!r?.start_date_awal || !r?.end_date_awal) return false;
  return r.start_date_awal !== r.start_date || r.end_date_awal !== r.end_date;
}

/**
 * Versi WhatsApp: `**tebal**` -> `*tebal*`.
 *
 * WhatsApp memakai SATU bintang, bukan dua. Memakai dua membuat bintangnya
 * terlihat apa adanya di layar penerima — teks yang seharusnya menonjol justru
 * jadi berantakan.
 */
export function pesanCutiWa(r) {
  return barisKeputusanCuti(r)
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '*$1*');
}

/**
 * Versi Telegram: `**tebal**` -> `<b>tebal</b>`, dan teksnya di-escape.
 *
 * Dipakai Edge Function; disediakan di sini supaya bentuk barisnya benar-benar
 * satu sumber. Escape dikerjakan SEBELUM penanda tebal diubah, kalau tidak
 * `<b>` yang baru dibuat ikut ter-escape jadi `&lt;b&gt;`.
 */
export function pesanCutiTelegram(r) {
  const escHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return barisKeputusanCuti(r)
    .map((b) => escHtml(b).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'))
    .join('\n');
}
