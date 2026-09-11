/**
 * Menyusun isi satu nota penerimaan jadi tabel.
 *
 * SATU SUMBER untuk dua keluaran — dialog rincian di layar dan berkas xlsx.
 * Alasannya sama seperti laporan opname: angka ini dipakai mencocokkan tagihan
 * supplier, dan kalau layar dan file unduhannya berbeda, keduanya jadi tidak
 * bisa dipakai berdebat dengan supplier.
 *
 * ============ HARGA MANA YANG DIPAKAI ============
 *
 * Urutan lengkapnya ada di `harga-baris.js` dan dipakai bersama dengan laporan
 * bahan masuk per rentang — satu jawaban untuk satu pertanyaan. Singkatnya:
 * `line_total` (yang diketik orang sejak 0123) menang, lalu `unit_cost × qty`
 * untuk baris lama, lalu HPP sebagai cadangan terakhir.
 *
 * Harga yang tercatat DI NOTA ITU didahulukan; HPP produk cuma cadangan.
 * Urutan ini bukan selera:
 *
 *   - `unit_cost` = harga yang BENAR-BENAR dibayar pada nota tersebut.
 *   - HPP produk  = harga yang berlaku SEKARANG.
 *
 * Nota bulan lalu yang dinilai dengan harga hari ini akan menghasilkan total
 * yang tidak pernah cocok dengan tagihan mana pun — dan tidak akan tampak
 * salah, karena angkanya tetap masuk akal.
 *
 * ============ BARANG TANPA HARGA ============
 *
 * Ditulis "-", bukan 0. Nol membuat total terlihat sah padahal ada barang yang
 * belum bernilai; "-" plus penanda `adaTanpaHarga` membuat kekurangannya
 * kelihatan. Ini kegagalan yang paling mungkin lolos: totalnya rapi, hanya
 * saja lebih kecil dari yang seharusnya.
 */

import { formatNum, formatRupiah } from '../../core/format.js';
import { hargaBeliBaris, hargaSatuanBaris } from './harga-baris.js';

export const KOLOM_NOTA = [
  { header: 'Barang', width: 2.2 },
  { header: 'Jumlah', width: 0.8, align: 'right' },
  { header: 'Satuan', width: 0.7 },
  { header: 'Harga/satuan', width: 1, align: 'right', numeric: true },
  { header: 'Nilai', width: 1.1, align: 'right', numeric: true }
];

/**
 * @param {object} o
 * @param {object} o.nota baris goods_receipts (boleh null)
 * @param {object[]} o.items baris goods_receipt_items + embed products
 * @param {Map<string, number>} [o.hpp] cadangan harga kalau nota tidak menyimpannya
 */
export function susunLaporanNota({ nota, items, hpp = new Map() }) {
  let total = 0;
  let adaTanpaHarga = false;

  const baris = (items ?? []).map((i) => {
    // NILAINYA DIAMBIL DARI `line_total`, BUKAN DIHITUNG ULANG.
    //
    // Sejak 0123 yang diketik orang adalah harga beli seluruh baris. `0` tetap
    // harga yang sah (barang bonus) dan tidak boleh jatuh ke HPP — aturan
    // lengkapnya, termasuk kenapa perkalian balik tidak selalu kembali ke angka
    // semula, ada di `harga-baris.js`.
    //
    // Yang diperbaiki di sini bukan soal gaya: `nota_ringkas` dan `bayar_nota`
    // di server sudah memakai `coalesce(line_total, qty * unit_cost)`, sedangkan
    // baris ini masih `unit_cost * qty`. Untuk 100.000 dibagi 3, keduanya
    // berbeda seribu rupiah — dan angka inilah yang dipakai orang berdebat
    // dengan supplier.
    const jumlah = Number(i.qty ?? 0);
    const nilai = hargaBeliBaris(i, hpp);
    // Harga/satuan DITURUNKAN dari nilainya, supaya dua kolom di baris yang
    // sama selalu saling mengalikan.
    const harga = hargaSatuanBaris(i, hpp);
    if (nilai == null) adaTanpaHarga = true;
    else total += nilai;
    return [
      i.products?.name ?? '(produk terhapus)',
      formatNum(jumlah),
      i.products?.base_unit ?? '',
      harga == null ? '-' : formatRupiah(harga),
      nilai == null ? '-' : formatRupiah(nilai)
    ];
  });

  const kode = nota?.code ?? '(tanpa nomor)';
  return {
    judul: `Nota Terima ${kode}`,
    subjudul: [
      nota?.outlets?.name,
      nota?.receipt_date,
      nota?.supplier,
      nota?.invoice_no ? `no. supplier ${nota.invoice_no}` : ''
    ]
      .filter(Boolean)
      .join(' · '),
    // Nama berkas dibersihkan: kode nota ikut jadi nama file, dan karakter
    // seperti "/" pada nomor supplier akan diam-diam memotong namanya.
    namaBerkas: 'nota-' + String(kode).replace(/[^\w.-]+/g, '-'),
    kolom: KOLOM_NOTA,
    baris,
    jumlahItem: baris.length,
    total,
    totalTeks: formatRupiah(total),
    adaTanpaHarga
  };
}
