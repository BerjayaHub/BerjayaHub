/**
 * SURAT JALAN TRANSFER ASET — teks WhatsApp & baris PDF dari SATU sumber.
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase, tidak memanggil
 * `Date.now()`.
 *
 * ============ KENAPA SATU SUMBER ============
 *
 * Pesan WhatsApp dan PDF memuat fakta yang sama: nomor SJ, dari mana ke mana,
 * siapa pembawanya, dan daftar barangnya. Kalau keduanya disusun terpisah,
 * yang menyimpang bukan tampilannya melainkan ISINYA — dan penyimpangannya
 * baru ketahuan saat orang membandingkan kertas di tangannya dengan pesan di
 * HP-nya, yaitu tepat saat barangnya sedang diserahkan.
 *
 * Pengiriman bahan sudah belajar ini di `dispatch/pesan-kiriman.js`. Berkas
 * ini mengikuti bentuk yang sama.
 *
 * ============ TIDAK ADA PENERIMA — DAN ITU DIKATAKAN ============
 *
 * Transfer aset tidak punya langkah terima: stok sudah berpindah saat surat
 * jalan ini dibuat. Yang menerimanya di seberang perlu tahu bahwa tidak ada
 * yang menunggu konfirmasinya — kalau tidak, ia akan menunggu tombol yang
 * tidak pernah ada, dan barangnya menumpuk tanpa dicatat.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));
const angka = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** "1.234" — pemisah ribuan Indonesia, tanpa desimal kalau bulat. */
function jml(v) {
  const x = angka(v);
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(x);
}

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

/**
 * "2026-10-28T03:11:00Z" -> "28 Oktober 2026".
 *
 * Dipecah dari bagian tanggalnya saja. `toLocaleDateString` pada peramban
 * dengan zona berbeda akan menggeser tanggalnya satu hari — dan surat jalan
 * yang tanggalnya meleset tidak terlihat seperti kesalahan program, ia
 * terlihat seperti barang yang dikirim di hari yang berbeda.
 */
export function tanggalSurat(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(teks(iso));
  if (!m) return teks(iso);
  const [, th, bl, hr] = m;
  return `${Number(hr)} ${NAMA_BULAN[Number(bl) - 1] ?? bl} ${th}`;
}

/**
 * Ke mana barangnya pergi — satu kalimat, apa pun bentuk tujuannya.
 *
 * Tujuan "lain-lain" ditandai terang-terangan. Menuliskannya seperti outlet
 * biasa membuat yang membacanya mengira barangnya ada di salah satu outlet,
 * dan ia akan mencarinya di sana.
 */
export function tujuanTeks(t) {
  const outlet = teks(t?.tujuanOutlet).trim();
  if (outlet) return outlet;
  const lain = teks(t?.tujuanLain).trim();
  return lain ? `${lain} (di luar outlet)` : '(tujuan tidak disebut)';
}

/** Satu baris barang: "1. Kursi Bar (B001) — 5" */
export function barisBarang(it, i) {
  const kode = teks(it?.kode).trim();
  return `${i + 1}. ${teks(it?.nama) || '(tanpa nama)'}${kode ? ` (${kode})` : ''} — ${jml(it?.qty)}`;
}

/**
 * Teks surat jalan untuk WhatsApp.
 *
 * @param {object} t
 * @param {string} t.kode nomor surat jalan
 * @param {string} t.tanggal ISO
 * @param {string} t.asal nama outlet asal
 * @param {string} [t.tujuanOutlet] nama outlet tujuan
 * @param {string} [t.tujuanLain] tujuan di luar sistem
 * @param {string} t.pembawa
 * @param {Array<{kode:string,nama:string,qty:number}>} t.items
 * @param {string} [t.catatan]
 * @param {string} [t.oleh] nama pengirim
 * @param {boolean} [t.dibatalkan]
 * @param {string} [t.alasanBatal]
 */
export function transferWaText(t) {
  const items = Array.isArray(t?.items) ? t.items : [];
  const baris = [];

  // ============ PEMBATALAN DI PALING ATAS ============
  //
  // Surat jalan yang sudah dibatalkan beredar di WhatsApp persis seperti yang
  // masih berlaku. Kalau penandanya ditaruh di bawah daftar barang, yang
  // membaca sambil berjalan sudah terlanjur menyerahkan barangnya.
  if (t?.dibatalkan) {
    baris.push('*⚠️ SURAT JALAN INI DIBATALKAN*');
    if (teks(t?.alasanBatal).trim()) baris.push(`Alasan: ${teks(t.alasanBatal).trim()}`);
    baris.push('');
  }

  baris.push(
    '*SURAT JALAN — TRANSFER ASET*',
    `No. ${teks(t?.kode) || '-'}`,
    tanggalSurat(t?.tanggal),
    '',
    `Dari    : ${teks(t?.asal) || '-'}`,
    `Ke      : ${tujuanTeks(t)}`,
    `Pembawa : ${teks(t?.pembawa) || '-'}`,
    '',
    `*Barang (${items.length})*`
  );

  if (items.length) {
    for (let i = 0; i < items.length; i++) baris.push(barisBarang(items[i], i));
    baris.push('', `Total unit: ${jml(items.reduce((a, b) => a + angka(b?.qty), 0))}`);
  } else {
    baris.push('(tidak ada barang)');
  }

  if (teks(t?.catatan).trim()) baris.push('', `Catatan: ${teks(t.catatan).trim()}`);
  if (teks(t?.oleh).trim()) baris.push('', `Dikirim oleh: ${teks(t.oleh).trim()}`);

  // Dikatakan terang-terangan. Yang menerimanya akan mencari tombol "Terima"
  // kalau tidak diberi tahu — dan selama ia mencari, barangnya belum dicatat
  // di mana pun kecuali di sini.
  if (!t?.dibatalkan) {
    baris.push('', '_Stok sudah otomatis berpindah. Tidak perlu konfirmasi terima._');
  }

  return baris.join('\n');
}

/** Baris tabel untuk PDF — isinya SAMA dengan yang di WhatsApp. */
export function barisPdfTransfer(t) {
  const items = Array.isArray(t?.items) ? t.items : [];
  return items.map((it, i) => [String(i + 1), teks(it?.kode), teks(it?.nama), jml(it?.qty)]);
}

/** Ringkasan untuk subjudul PDF & daftar riwayat. */
export function ringkasTransfer(t) {
  const items = Array.isArray(t?.items) ? t.items : [];
  return {
    jenis: items.length,
    unit: items.reduce((a, b) => a + angka(b?.qty), 0),
    tujuan: tujuanTeks(t),
    keLuar: !teks(t?.tujuanOutlet).trim() && Boolean(teks(t?.tujuanLain).trim())
  };
}
