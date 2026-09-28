/**
 * TAUTAN FOTO BERTANDA TANGAN — dibuat saat DIKETUK, bukan dibekukan.
 *
 *   "jika foto yang ditabel itu di tap jadi hitam … tapi hanya di beberapa
 *    staff saja, tidak semua, di saya bisa"
 *
 * ============ BENTUK KEGAGALANNYA ============
 *
 * Bucket foto bersifat privat, jadi satu-satunya cara membukanya adalah signed
 * URL — dan signed URL punya `exp`. Lewat masa itu, Storage menjawab:
 *
 *     403 · "exp" claim timestamp check failed · invalid JWT
 *
 * Layar sebelum ini membuat URL-nya SEKALI (saat tabel dimuat, untuk seluruh
 * baris) lalu menaruhnya di `img.src` dan `<a href>`. Gambarnya sudah terunduh
 * dan tinggal di cache browser, jadi tabelnya tetap terlihat normal selamanya —
 * tidak ada tanda apa pun bahwa tautannya sudah mati.
 *
 * Yang membedakan antar-orang bukan SIAPA mereka, melainkan BERAPA LAMA
 * halamannya dibiarkan terbuka. Staff yang berkeliling outlet sambil
 * mencocokkan barang, atau yang berpindah aplikasi lalu kembali (Android
 * mengembalikan halaman lama apa adanya, tanpa memuat ulang), menekan tautan
 * berumur dua jam. Yang membuka halaman lalu langsung menekan fotonya tidak
 * pernah melihatnya.
 *
 * Itu sebabnya laporannya berbunyi "hanya di beberapa staff" — dan itu pula
 * sebabnya dugaan pertama selalu jatuh ke role atau sinyal.
 *
 * ============ KENAPA UMURNYA TIDAK DIPERPANJANG SAJA ============
 *
 * Karena umur panjang justru harga yang dibayar orang lain. Tautan berumur
 * sejam yang terlanjur tersalin ke WhatsApp bisa dibuka SIAPA PUN selama sejam
 * — tanpa login, tanpa peran, tanpa jejak. Memperpanjangnya jadi sehari
 * menukar satu keluhan dengan kebocoran yang tidak ada yang memperhatikan.
 *
 * Jadi arahnya sebaliknya: dibuat saat diketuk, dan umurnya PENDEK. Selama ia
 * dibuat tepat sebelum dipakai, pendek tidak pernah mengganggu siapa pun.
 *
 * Tidak ada impor di berkas ini, supaya bisa diuji tanpa browser.
 */

/**
 * Umur tautan yang DIKETUK.
 *
 * Enam puluh detik: cukup untuk browser membuka tab dan mengunduh gambarnya,
 * dan terlalu pendek untuk berguna kalau tautannya tersalin ke mana-mana.
 */
export const UMUR_TAUTAN_KETUK = 60;

/**
 * Umur tautan THUMBNAIL yang digambar di tabel.
 *
 * Lebih panjang dari yang diketuk, dan itu memang perlu: gambar di tabel
 * bisa saja baru dimuat saat orangnya menggulir ke bawah (`loading="lazy"`),
 * jadi tautannya harus masih hidup beberapa menit sesudah tabelnya tergambar.
 *
 * Tapi TIDAK sejam. Sejam cuma memperpanjang jendela bocornya tanpa menolong
 * siapa pun — begitu tabelnya selesai digulir, tautan thumbnail tidak pernah
 * dipakai lagi.
 */
export const UMUR_TAUTAN_THUMBNAIL = 600;

export const PESAN_KEDALUWARSA =
  'Tautan fotonya sudah kedaluwarsa karena halaman ini terbuka cukup lama. Muat ulang halamannya, lalu coba lagi.';
export const PESAN_TIDAK_BERIZIN =
  'Foto ini di luar jangkauanmu. Izin membuka foto mengikuti Business Unit barangnya — hubungi admin kalau seharusnya bisa.';
export const PESAN_GAGAL_UMUM = 'Foto tidak bisa dibuka sekarang. Coba lagi sebentar lagi.';

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Terjemahkan kegagalan jadi kalimat yang menunjuk ke tindakan yang benar.
 *
 * ============ TIGA SEBAB, TIGA KALIMAT ============
 *
 * Sebelum ini semua kegagalan foto menuduh satu hal yang sama — "izin membuka
 * foto mengikuti outlet notanya" — termasuk kegagalan yang tidak ada
 * hubungannya dengan izin. Orang yang tautannya cuma kedaluwarsa lalu pergi
 * meminta hak akses yang sudah ia punya.
 *
 * @param {Error|object|null} error
 * @returns {string}
 */
export function pesanGagalFoto(error) {
  const pesan = teks(error?.message ?? error).toLowerCase();
  const kode = teks(error?.statusCode ?? error?.status);

  // Tanda tangan kedaluwarsa. Storage menyebut klaim `exp` secara harfiah,
  // dan itu satu-satunya sebab yang bisa dikenali dengan pasti dari pesannya.
  if (pesan.includes('exp') && pesan.includes('claim')) return PESAN_KEDALUWARSA;
  if (pesan.includes('jwt expired') || pesan.includes('expired')) return PESAN_KEDALUWARSA;

  // 403/401 yang BUKAN soal kedaluwarsa: izin.
  if (kode === '403' || kode === '401' || pesan.includes('not authorized') || pesan.includes('permission')) {
    return PESAN_TIDAK_BERIZIN;
  }
  // `createSignedUrl` untuk objek yang tidak boleh dibaca menjawab "not found",
  // bukan "forbidden" — Storage sengaja tidak membocorkan keberadaan berkas.
  // Jadi "tidak ketemu" di sini paling sering berarti izin, bukan berkas hilang.
  if (pesan.includes('not found') || kode === '404') return PESAN_TIDAK_BERIZIN;

  return PESAN_GAGAL_UMUM;
}
