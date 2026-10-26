/**
 * TEKS LAPORAN PENJUALAN BENGKEL untuk WhatsApp.
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase, tidak memanggil
 * `Date.now()`.
 *
 * ============ SATU SUMBER UNTUK DUA TOMBOL ============
 *
 * Teks ini dipakai dua kali: tepat sesudah staff menekan Simpan, dan belakangan
 * dari daftar riwayat ketika laporan hari itu perlu dikirim ulang.
 *
 * Kalau keduanya menyusun teksnya sendiri-sendiri, keduanya akan menyimpang —
 * dan yang menyimpang bukan tampilannya, melainkan ANGKANYA. Pesan "kirim
 * ulang" yang lupa ikut diperbaiki saat rumus totalnya berubah akan mengirim
 * angka lama ke grup WhatsApp, terlihat resmi, dan tidak ada yang bisa tahu
 * mana yang benar tanpa membuka aplikasinya.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));
const angka = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** "Rp1.250.000" — sama dengan tampilan di layar. */
function rupiah(n) {
  return 'Rp' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(angka(n)));
}

const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

/**
 * "2026-10-26" -> "Senin, 26 Oktober 2026".
 *
 * Tanggalnya dipecah sendiri, TIDAK lewat `new Date('2026-10-26')`. String
 * seperti itu dibaca sebagai tengah malam UTC, dan di WIB (UTC+7) ia tetap
 * tanggal yang sama — tapi di zona barat UTC ia mundur satu hari. Laporan
 * yang judulnya meleset satu hari tidak terlihat seperti kesalahan program;
 * ia terlihat seperti staff yang salah pilih tanggal.
 */
export function tanggalPanjang(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(teks(iso).trim());
  if (!m) return teks(iso);
  const [, th, bl, hr] = m;
  const d = new Date(Date.UTC(Number(th), Number(bl) - 1, Number(hr)));
  return `${NAMA_HARI[d.getUTCDay()]}, ${Number(hr)} ${NAMA_BULAN[Number(bl) - 1]} ${th}`;
}

/**
 * Susun teks laporan satu hari.
 *
 * @param {object} o
 * @param {string} o.outlet nama outlet
 * @param {string} o.tanggal ISO (YYYY-MM-DD)
 * @param {number} o.sparepart omzet sparepart
 * @param {number} o.jasa omzet jasa
 * @param {string} [o.catatan]
 * @param {string} [o.oleh] nama pelapor
 * @returns {string}
 */
export function pesanPenjualanHarian({ outlet, tanggal, sparepart, jasa, catatan, oleh } = {}) {
  const s = angka(sparepart);
  const j = angka(jasa);
  const baris = [
    '*LAPORAN PENJUALAN BENGKEL*',
    teks(outlet) || '(outlet tidak disebut)',
    tanggalPanjang(tanggal),
    '',
    `Sparepart : ${rupiah(s)}`,
    `Jasa      : ${rupiah(j)}`,
    `*TOTAL    : ${rupiah(s + j)}*`
  ];
  if (teks(catatan).trim()) {
    baris.push('', `Catatan: ${teks(catatan).trim()}`);
  }
  if (teks(oleh).trim()) {
    baris.push('', `Dilaporkan oleh: ${teks(oleh).trim()}`);
  }
  return baris.join('\n');
}

/**
 * Susun teks rekap beberapa hari (dipakai saat membagikan hasil saringan).
 *
 * @param {object} o
 * @param {string} o.outlet
 * @param {string} o.dari ISO
 * @param {string} o.sampai ISO
 * @param {Array<{sale_date:string, omzet_sparepart:any, omzet_jasa:any}>} o.baris
 */
export function pesanRekapPeriode({ outlet, dari, sampai, baris = [] } = {}) {
  const urut = [...(Array.isArray(baris) ? baris : [])].sort((a, b) =>
    teks(a?.sale_date).localeCompare(teks(b?.sale_date))
  );
  const totS = urut.reduce((a, b) => a + angka(b?.omzet_sparepart), 0);
  const totJ = urut.reduce((a, b) => a + angka(b?.omzet_jasa), 0);

  const keluar = [
    '*REKAP PENJUALAN BENGKEL*',
    teks(outlet) || '(semua outlet)',
    `${tanggalPanjang(dari)} s/d ${tanggalPanjang(sampai)}`,
    ''
  ];

  for (const b of urut) {
    const t = angka(b?.omzet_sparepart) + angka(b?.omzet_jasa);
    keluar.push(`${teks(b?.sale_date)} : ${rupiah(t)}`);
  }

  if (!urut.length) {
    keluar.push('(belum ada laporan di rentang ini)');
  }

  keluar.push(
    '',
    `Sparepart : ${rupiah(totS)}`,
    `Jasa      : ${rupiah(totJ)}`,
    `*TOTAL    : ${rupiah(totS + totJ)}*`,
    // Jumlah HARI YANG DILAPORKAN, bukan jumlah hari dalam rentang.
    //
    // Yang membaca rekap ini akan membagi totalnya untuk mencari rata-rata
    // harian. Membagi dengan hari kalender membuat rata-ratanya terlihat
    // turun hanya karena ada hari yang lupa dilapor — dan itu terbaca seperti
    // penjualan yang melemah, bukan seperti laporan yang belum lengkap.
    `(${urut.length} hari dilaporkan)`
  );
  return keluar.join('\n');
}
