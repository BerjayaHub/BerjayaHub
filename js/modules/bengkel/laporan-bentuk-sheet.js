/**
 * DUA LAPORAN DENGAN TATA KOLOM PERSIS SEPERTI SHEET OTONIX.
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase.
 *
 *   "intinya saya mau output yang hampir mirip dengan kedua link spreadsheet
 *    yang saya kirim... jadi ada 2 output yaitu laporan penjualan dan
 *    pembelian, lalu bisa di export excel"
 *
 * ============ KENAPA MENIRU BENTUKNYA, BUKAN MEMPERBAIKINYA ============
 *
 * Bentuk sheet ini sudah dibaca owner tiap bulan. Laporan baru yang "lebih
 * rapi" memaksa orang belajar membaca ulang angka yang sudah ia kenal — dan
 * yang pertama ia lakukan adalah membandingkannya dengan sheet lama kolom per
 * kolom. Kalau kolomnya tidak sejajar, yang disimpulkan bukan "formatnya
 * beda", melainkan "angkanya beda".
 *
 * Jadi kolomnya ditiru apa adanya, termasuk dua kebiasaan yang kalau dinilai
 * sendiri terlihat aneh:
 *
 *   1. Nilai JASA tidak ditulis di kolom "Total Harga Jual", melainkan di
 *      kolom "Jasa Service" sendiri. Itu yang memisahkan omzet barang dari
 *      omzet jasa tanpa perlu kolom jenis.
 *   2. Kolom milik INVOICE (Total Penjualan, Type Pembayaran, nama pelanggan,
 *      tanggal) hanya ditulis di baris PERTAMA tiap invoice; baris berikutnya
 *      dikosongkan. Di layar itu terbaca sebagai pengelompokan, dan di Excel
 *      ia tetap bisa dijumlahkan karena angkanya tidak diulang.
 *
 * Yang DITAMBAHKAN dari sheet lama cuma satu hal, dan ia memang tidak ada di
 * sana: penanda asal harga beli — dari nota pembelian (hasil pencocokan) atau
 * dari HPP Turboly. Dua angka yang artinya berbeda tidak boleh tampil seolah
 * sama.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Kolom laporan penjualan — URUTANNYA mengikuti sheet, jangan ditukar. */
export const KOLOM_JUAL = [
  { header: 'NO', width: 6 },
  { header: 'Nama Cust/Jenis Mobil/Nopol', width: 34 },
  { header: 'Tanggal', width: 12 },
  { header: 'Suplier', width: 22 },
  { header: 'Nama Barang', width: 32 },
  { header: 'QTY', numeric: true, width: 7 },
  { header: 'Harga Beli Satuan', numeric: true, width: 16 },
  { header: 'Total Harga Beli', numeric: true, width: 16 },
  { header: 'Harga Jual Satuan', numeric: true, width: 16 },
  { header: 'Diskon', numeric: true, width: 12 },
  { header: 'Total Harga Jual', numeric: true, width: 16 },
  { header: 'Jasa Service', numeric: true, width: 14 },
  { header: 'Rounding/Pembulatan', numeric: true, width: 16 },
  { header: 'Total Penjualan', numeric: true, width: 16 },
  { header: 'Type Pembayaran', width: 18 },
  { header: 'Asal Harga Beli', width: 16 }
];

/** Kolom laporan pengeluaran — mengikuti sheet Laporan Pengeluaran. */
export const KOLOM_BELI = [
  { header: 'NO', width: 6 },
  { header: 'Tanggal', width: 12 },
  { header: 'Nopol', width: 16 },
  { header: 'Supplier', width: 26 },
  { header: 'Nama Barang', width: 34 },
  { header: 'QTY', numeric: true, width: 7 },
  { header: 'Harga Satuan', numeric: true, width: 15 },
  { header: 'Diskon', numeric: true, width: 12 },
  { header: 'Total', numeric: true, width: 16 },
  { header: 'No. PO', width: 18 },
  { header: 'Outlet', width: 16 }
];

export const ASAL_HARGA = { NOTA: 'nota', HPP: 'HPP Turboly', TIDAK_ADA: '' };

/**
 * Susun baris laporan penjualan, dikelompokkan per invoice.
 *
 * @param {{baris: Array, cocok: Array}} o
 *   `baris` = baris penjualan dari view; `cocok` = hasil `cocokkanBeliJual().jual`,
 *   dipetakan lewat kunci yang sama supaya tiap baris tahu supplier &
 *   harga belinya.
 */
export function susunLaporanJual({ baris = [], cocok = [] } = {}) {
  // Kunci pencocokan: invoice + urut. Bukan SKU — satu invoice bisa memuat
  // SKU yang sama dua kali (dipasang di dua posisi), dan memakai SKU akan
  // menempelkan harga beli yang sama ke keduanya.
  const peta = new Map();
  for (const c of cocok ?? []) peta.set(`${teks(c.invoice_no)}|${teks(c.urut ?? '')}`, c);

  const perInvoice = new Map();
  for (const b of baris ?? []) {
    const k = teks(b.invoice_no);
    if (!perInvoice.has(k)) perInvoice.set(k, []);
    perInvoice.get(k).push(b);
  }

  const rows = [];
  const ringkas = { invoice: 0, baris: 0, totalJual: 0, totalJasa: 0, totalBeli: 0, dariNota: 0, dariHpp: 0, tanpaHarga: 0 };
  let no = 0;

  for (const [invoice, isi] of perInvoice) {
    no += 1;
    ringkas.invoice += 1;
    const pertama = isi[0] ?? {};
    // "Nama Cust / Jenis Mobil / Nopol" — satu kolom berisi tiga hal, persis
    // seperti di sheet. Bagian yang kosong dibuang supaya tidak menyisakan
    // garis miring menggantung.
    const judul = [teks(pertama.company) || teks(pertama.customer), [teks(pertama.merek), teks(pertama.model)].filter(Boolean).join(' '), teks(pertama.nopol)]
      .map((x) => x.trim())
      .filter(Boolean)
      .join(' / ');
    const totalInvoice = isi.reduce((t, b) => t + num(b.total), 0);

    isi.forEach((b, i) => {
      ringkas.baris += 1;
      const c = peta.get(`${invoice}|${teks(b.urut ?? '')}`);
      const sparepart = teks(b.item_type) === 'sparepart';

      // ============ HARGA BELI: NOTA DULU, BARU HPP ============
      //
      // Harga dari pencocokan bisa ditelusuri ke PO & supplier. `modal` dari
      // Turboly adalah HPP rata-rata — angka yang benar untuk menghitung laba,
      // tapi tidak bisa ditunjuk ke satu nota pun. Keduanya dipakai, dan
      // asalnya selalu disebut.
      let hargaBeli = null;
      let totalBeli = null;
      let asal = ASAL_HARGA.TIDAK_ADA;
      if (sparepart) {
        if (c && c.hargaBeli !== null && c.hargaBeli !== undefined) {
          hargaBeli = c.hargaBeli;
          totalBeli = c.totalBeli;
          asal = ASAL_HARGA.NOTA;
          ringkas.dariNota += 1;
        } else if (b.modal !== null && b.modal !== undefined) {
          // `modal` adalah TOTAL baris (bukan per unit) — lihat 0185.
          totalBeli = num(b.modal);
          hargaBeli = num(b.qty) > 0 ? bulat(totalBeli / num(b.qty)) : null;
          asal = ASAL_HARGA.HPP;
          ringkas.dariHpp += 1;
        } else {
          ringkas.tanpaHarga += 1;
        }
        ringkas.totalJual += num(b.total);
      } else {
        ringkas.totalJasa += num(b.total);
      }
      if (totalBeli !== null) ringkas.totalBeli += totalBeli;

      rows.push([
        i === 0 ? no : '',
        i === 0 ? judul : '',
        i === 0 ? teks(b.tanggal) : '',
        teks(c?.supplier ?? ''),
        teks(b.nama),
        num(b.qty),
        hargaBeli,
        totalBeli,
        b.harga_satuan === null || b.harga_satuan === undefined ? null : num(b.harga_satuan),
        num(b.diskon) || null,
        // Nilai barang di kolom "Total Harga Jual", nilai jasa di kolom
        // "Jasa Service" — pembagian yang dipakai sheet-nya.
        sparepart ? num(b.total) : null,
        sparepart ? null : num(b.total),
        null, // Rounding: tidak ada di data Turboly; kolomnya tetap ada supaya sejajar
        i === 0 ? bulat(totalInvoice) : null,
        i === 0 ? teks(b.pembayaran) : '',
        asal
      ]);
    });
  }

  rows.push([
    'TOTAL', '', '', '', '', null, null, bulat(ringkas.totalBeli), null, null,
    bulat(ringkas.totalJual), bulat(ringkas.totalJasa), null, bulat(ringkas.totalJual + ringkas.totalJasa), '', ''
  ]);

  return { kolom: KOLOM_JUAL, rows, ringkas };
}

/**
 * Susun baris laporan pengeluaran (pembelian).
 *
 * Kolom Nopol diisi dari hasil pencocokan — di sheet lama ia diketik orang.
 * Yang belum terpakai berbunyi `STOK`, persis seperti kebiasaan menulisnya
 * sekarang.
 */
export function susunLaporanBeli({ baris = [], cocok = [] } = {}) {
  // Kunci: no PO + urut. Nomor PO saja tidak cukup — satu PO berisi banyak
  // barang, dan semuanya akan mendapat nopol yang sama.
  const peta = new Map();
  for (const c of cocok ?? []) peta.set(`${teks(c.po_no)}|${teks(c.urut ?? '')}`, c);

  const rows = [];
  const ringkas = { baris: 0, qty: 0, nilai: 0, stok: 0, qtyStok: 0, tanpaNilai: 0 };
  let no = 0;

  for (const b of baris ?? []) {
    no += 1;
    ringkas.baris += 1;
    const c = peta.get(`${teks(b.po_no)}|${teks(b.urut ?? '')}`);
    const nilai = b.nilai === null || b.nilai === undefined ? null : num(b.nilai);
    ringkas.qty += num(b.qty);
    if (nilai === null) ringkas.tanpaNilai += 1;
    else ringkas.nilai += nilai;
    if (c && c.sisa > 0) {
      ringkas.stok += 1;
      ringkas.qtyStok += num(c.sisa);
    }

    rows.push([
      no,
      teks(b.tanggal),
      // Hasil pencocokan. Tanpa `cocok`, kolomnya berbunyi "—" — bukan
      // dikosongkan, supaya terlihat bahwa pencocokannya memang belum
      // dijalankan, bukan bahwa barangnya tidak terpakai.
      c ? teks(c.nopolTeks) : '—',
      teks(b.supplier),
      teks(b.nama),
      num(b.qty),
      b.harga === null || b.harga === undefined ? null : num(b.harga),
      null, // Diskon: tidak ada di ekspor Turboly; kolomnya tetap ada supaya sejajar dengan sheet
      nilai,
      teks(b.po_no),
      teks(b.outlet_nama) || 'Pusat'
    ]);
  }

  rows.push(['TOTAL', '', '', '', '', bulat(ringkas.qty), null, null, bulat(ringkas.nilai), '', '']);
  return { kolom: KOLOM_BELI, rows, ringkas };
}

/**
 * Kalimat yang ikut tercetak di subjudul kedua laporan.
 *
 * Laporan yang angkanya sebagian berasal dari tebakan FIFO harus mengatakannya
 * di tempat yang ikut terbawa saat berkasnya dikirim — bukan hanya di layar
 * yang membuatnya.
 */
export function catatanBentukSheet(ringkasJual, ringkasBeli) {
  const out = [];
  if (ringkasJual) {
    if (ringkasJual.dariHpp) {
      out.push(
        `${ringkasJual.dariHpp} baris memakai HPP Turboly sebagai harga beli (pembeliannya tidak ketemu di periode yang diimpor) — ` +
          'lihat kolom "Asal Harga Beli".'
      );
    }
    if (ringkasJual.tanpaHarga) out.push(`${ringkasJual.tanpaHarga} baris belum punya harga beli sama sekali.`);
  }
  if (ringkasBeli?.stok) out.push(`${ringkasBeli.stok} baris pembelian belum terpakai (${bulat(ringkasBeli.qtyStok)} unit) — tertulis STOK.`);
  if (ringkasBeli?.tanpaNilai) out.push(`${ringkasBeli.tanpaNilai} baris pembelian tanpa nilai (harganya tidak ikut terekspor Turboly).`);
  return out;
}

function bulat(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
