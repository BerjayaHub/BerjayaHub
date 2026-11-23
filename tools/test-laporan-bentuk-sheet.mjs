/**
 * LAPORAN BENTUK SHEET — tes murni.
 *
 *   §1 Kolomnya SEJAJAR dengan sheet Otonix, urutan tidak boleh berubah.
 *   §2 Kolom milik invoice hanya di baris pertama.
 *   §3 Jasa masuk kolom "Jasa Service", barang masuk "Total Harga Jual".
 *   §4 Harga beli: nota dulu, baru HPP — dan asalnya selalu disebut.
 *   §5 `modal` Turboly adalah TOTAL baris, jadi harga satuannya dibagi qty.
 *   §6 Laporan beli: Nopol dari pencocokan, yang sisa jadi STOK.
 *   §7 Baris TOTAL di kedua laporan.
 */
import {
  susunLaporanJual, susunLaporanBeli, catatanBentukSheet, KOLOM_JUAL, KOLOM_BELI, ASAL_HARGA
} from '../js/modules/bengkel/laporan-bentuk-sheet.js';

let gagal = 0, n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => { n++; if (!syarat) { gagal++; console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`); } };

// ===============================================================
console.log('§1 Kolom sejajar sheet');
// ===============================================================
// Urutan ini dibaca owner tiap bulan. Kolom yang bergeser membuat orang
// menyimpulkan "angkanya beda", bukan "formatnya beda".
cek('§1 kolom penjualan', KOLOM_JUAL.map((k) => k.header), [
  'NO', 'Nama Cust/Jenis Mobil/Nopol', 'Tanggal', 'Suplier', 'Nama Barang', 'QTY',
  'Harga Beli Satuan', 'Total Harga Beli', 'Harga Jual Satuan', 'Diskon', 'Total Harga Jual',
  'Jasa Service', 'Rounding/Pembulatan', 'Total Penjualan', 'Type Pembayaran', 'Asal Harga Beli'
]);
cek('§1 kolom pembelian', KOLOM_BELI.map((k) => k.header), [
  'NO', 'Tanggal', 'Nopol', 'Supplier', 'Nama Barang', 'QTY', 'Harga Satuan', 'Diskon', 'Total', 'No. PO', 'Outlet'
]);

// ===============================================================
console.log('§2–§5 Laporan penjualan');
// ===============================================================
const jual = [
  { invoice_no: 'SRI/1', urut: 1, tanggal: '2026-11-01', customer: 'ANTOK', company: '', merek: 'TOYOTA', model: 'INNOVA', nopol: 'L 1504 BDI', pembayaran: 'CASH', item_type: 'jasa', nama: 'TAMBAL BAN', qty: 1, harga_satuan: 25000, diskon: 0, total: 25000, modal: null },
  { invoice_no: 'SRI/1', urut: 2, tanggal: '2026-11-01', customer: 'ANTOK', company: '', merek: 'TOYOTA', model: 'INNOVA', nopol: 'L 1504 BDI', pembayaran: 'CASH', item_type: 'sparepart', nama: 'OLI SHELL', qty: 3, harga_satuan: 100000, diskon: 0, total: 300000, modal: 210000 },
  { invoice_no: 'SRI/2', urut: 1, tanggal: '2026-11-02', customer: 'JALU', company: 'PT SEMEN', merek: '', model: '', nopol: '', pembayaran: 'Transfer', item_type: 'sparepart', nama: 'FILTER', qty: 1, harga_satuan: 65000, diskon: 0, total: 65000, modal: null }
];
const cocok = [{ invoice_no: 'SRI/1', urut: 2, supplier: '7 BERKAT', hargaBeli: 60000, totalBeli: 180000 }];
const L = susunLaporanJual({ baris: jual, cocok });

cek('§2 dua invoice + baris TOTAL', L.rows.length, 4);
cek('§2 NO hanya di baris pertama invoice', [L.rows[0][0], L.rows[1][0], L.rows[2][0]], [1, '', 2]);
cek('§2 judul gabungan cust/mobil/nopol', L.rows[0][1], 'ANTOK / TOYOTA INNOVA / L 1504 BDI');
cek('§2 baris kedua judulnya kosong', L.rows[1][1], '');
// Company dipakai kalau ada (korporat), dan bagian kosong tidak menyisakan "/".
cek('§2 korporat tanpa mobil/nopol', L.rows[2][1], 'PT SEMEN');
cek('§2 tanggal & pembayaran hanya di baris pertama', [L.rows[0][2], L.rows[1][2], L.rows[0][14], L.rows[1][14]], ['2026-11-01', '', 'CASH', '']);
cek('§2 Total Penjualan per invoice di baris pertama', [L.rows[0][13], L.rows[1][13]], [325000, null]);

// §3 — pembagian kolom yang dipakai sheet.
cek('§3 jasa masuk kolom Jasa Service', [L.rows[0][10], L.rows[0][11]], [null, 25000]);
cek('§3 barang masuk kolom Total Harga Jual', [L.rows[1][10], L.rows[1][11]], [300000, null]);

// §4 — nota dulu, baru HPP, dan asalnya disebut.
cek('§4 baris yang ketemu notanya', [L.rows[1][3], L.rows[1][6], L.rows[1][7], L.rows[1][15]], ['7 BERKAT', 60000, 180000, ASAL_HARGA.NOTA]);
// §5 — `modal` Turboly TOTAL baris: 210000 untuk 3 liter -> 70000/liter.
// Dipakai apa adanya sebagai harga satuan, HPP-nya jadi 3x lipat.
const L2 = susunLaporanJual({ baris: jual, cocok: [] });
cek('§5 HPP dibagi qty jadi harga satuan', [L2.rows[1][6], L2.rows[1][7]], [70000, 210000]);
cek('§5 asalnya disebut HPP, bukan nota', L2.rows[1][15], ASAL_HARGA.HPP);
cek('§5 dan suppliernya kosong', L2.rows[1][3], '');
// Tanpa nota & tanpa modal: kosong, bukan 0 — 0 akan terbaca untung penuh.
cek('§4 tanpa keduanya: null', [L.rows[2][6], L.rows[2][7], L.rows[2][15]], [null, null, ASAL_HARGA.TIDAK_ADA]);

// §7 — baris TOTAL.
const total = L.rows[3];
cek('§7 label TOTAL', total[0], 'TOTAL');
cek('§7 total harga beli', total[7], 180000);
cek('§7 total barang & jasa dipisah', [total[10], total[11]], [365000, 25000]);
cek('§7 total penjualan', total[13], 390000);
cek('§7 ringkasannya sejalan', [L.ringkas.invoice, L.ringkas.dariNota, L.ringkas.dariHpp, L.ringkas.tanpaHarga], [2, 1, 0, 1]);

// ===============================================================
console.log('§6 Laporan pembelian');
// ===============================================================
const beli = [
  { po_no: 'PO/1', urut: 1, tanggal: '2026-10-01', supplier: '7 BERKAT', nama: 'SHOCK BAGASI', qty: 1, harga: 200000, nilai: 200000, outlet_nama: 'Malang' },
  { po_no: 'PO/2', urut: 1, tanggal: '2026-10-02', supplier: 'GARUDA MAS', nama: 'RING 8X20', qty: 6, harga: 250, nilai: 1500, outlet_nama: null },
  { po_no: 'PO/3', urut: 1, tanggal: '2026-10-03', supplier: 'ABB', nama: 'OLI DRUM', qty: 2, harga: null, nilai: null, outlet_nama: 'Malang' }
];
const cocokBeli = [
  { po_no: 'PO/1', urut: 1, nopolTeks: 'N1785AAZ', sisa: 0 },
  { po_no: 'PO/2', urut: 1, nopolTeks: 'STOK', sisa: 6 }
];
const B = susunLaporanBeli({ baris: beli, cocok: cocokBeli });
cek('§6 nopol dari pencocokan', B.rows[0][2], 'N1785AAZ');
cek('§6 yang belum terpakai jadi STOK', B.rows[1][2], 'STOK');
// "—" membedakan "pencocokan belum dijalankan" dari "tidak terpakai".
cek('§6 tanpa hasil cocok: "—", bukan kosong', B.rows[2][2], '—');
cek('§6 outlet kosong berarti Pusat', B.rows[1][10], 'Pusat');
cek('§6 harga & nilai null tetap null', [B.rows[2][6], B.rows[2][8]], [null, null]);
cek('§6 no urut berjalan', [B.rows[0][0], B.rows[1][0], B.rows[2][0]], [1, 2, 3]);
cek('§7 baris TOTAL pembelian', [B.rows[3][0], B.rows[3][5], B.rows[3][8]], ['TOTAL', 9, 201500]);
cek('§7 nilai yang null tidak dihitung', B.ringkas.tanpaNilai, 1);
cek('§7 sisa stok terhitung', [B.ringkas.stok, B.ringkas.qtyStok], [1, 6]);

// ===============================================================
console.log('§8 Catatan ikut tercetak');
// ===============================================================
const c = catatanBentukSheet(L2.ringkas, B.ringkas);
benar('§8 menyebut baris yang pakai HPP', c.some((x) => /HPP Turboly/.test(x)), JSON.stringify(c));
benar('§8 menyebut stok', c.some((x) => /STOK/.test(x)));
benar('§8 menyebut baris tanpa nilai', c.some((x) => /tidak ikut terekspor/.test(x)));
cek('§8 tanpa masalah: tidak mengarang catatan', catatanBentukSheet({ dariHpp: 0, tanpaHarga: 0 }, { stok: 0, tanpaNilai: 0 }), []);
cek('§8 tanpa argumen tidak melempar', catatanBentukSheet(), []);
cek('§8 larik kosong', susunLaporanJual().rows.length, 1);

// ===============================================================
console.log('§9 QTY bukan rupiah');
// ===============================================================
//
// Sheet lama memformat kolom QTY sebagai mata uang — baris TOTAL-nya
// berbunyi "Rp191" untuk 191 unit. Itu kekeliruan format, dan meniru bentuk
// sheet TIDAK berarti ikut meniru kekeliruannya.
{
  const qtyJual = KOLOM_JUAL.find((k) => k.header === 'QTY');
  const qtyBeli = KOLOM_BELI.find((k) => k.header === 'QTY');
  cek('§9 QTY penjualan tidak ber-uang', qtyJual.uang, false);
  cek('§9 QTY pembelian tidak ber-uang', qtyBeli.uang, false);
  // Tetap `numeric`: di Excel ia harus tetap ANGKA supaya bisa dijumlahkan.
  benar('§9 QTY tetap numeric', qtyJual.numeric === true && qtyBeli.numeric === true);
  // Semua kolom rupiah memang ditandai ber-uang.
  const uangJual = KOLOM_JUAL.filter((k) => k.numeric && k.uang).map((k) => k.header);
  cek('§9 kolom rupiah penjualan', uangJual, [
    'Harga Beli Satuan', 'Total Harga Beli', 'Harga Jual Satuan', 'Diskon',
    'Total Harga Jual', 'Jasa Service', 'Rounding/Pembulatan', 'Total Penjualan'
  ]);
  cek('§9 kolom rupiah pembelian', KOLOM_BELI.filter((k) => k.numeric && k.uang).map((k) => k.header),
    ['Harga Satuan', 'Diskon', 'Total']);
  // Tidak ada kolom numeric yang lupa ditandai.
  benar('§9 tiap kolom numeric punya penanda uang',
    [...KOLOM_JUAL, ...KOLOM_BELI].filter((k) => k.numeric).every((k) => typeof k.uang === 'boolean'));
}

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-laporan-bentuk-sheet: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
