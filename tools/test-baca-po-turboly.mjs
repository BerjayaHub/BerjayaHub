/**
 * PEMBACA EKSPOR "DETAILED PURCHASE ORDERS" — tes murni.
 *
 *   §1 Header & kolom wajib.
 *   §2 Berkas yang SALAH (summary PO) ditolak dengan menyebut bedanya.
 *   §3 Baris cacat ditolak; baris tanpa SKU TETAP masuk tapi dihitung.
 *   §4 Harga nol dibedakan dari harga kosong — dan "semuanya nol" dikenali.
 *   §5 Nilai dihitung dari Total; kalau kosong, dari harga × qty.
 *   §6 Ringkasan: periode, supplier, jumlah PO.
 */
import {
  bacaEksporPo,
  cariHeaderPo,
  bacaPengantarPo,
  ringkasPo,
  semuaHarganyaNol,
  poUntukRpc,
  MASALAH_PO,
  PESAN_MASALAH_PO
} from '../js/modules/bengkel/baca-po-turboly.js';

let gagal = 0;
let n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  n++;
  if (!syarat) { gagal++; console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`); }
};

const HDR = ['No', 'Warehouse', 'Sent At', 'Sender', 'Order', 'Status', 'Supplier Name', 'Supplier Code',
  'Store Purchase Order', 'Reference No', 'SKU', 'Name', 'Product Type', 'Product Code', 'Qty', 'Price (Rp)', 'Total (Rp)', 'Deliver To'];
const baris = (o = {}) => {
  const d = {
    No: 1, Warehouse: '', 'Sent At': '16-Nov-2026', Sender: 'LUTFAN', Order: 'PO/HO/26110050',
    Status: 'Received', 'Supplier Name': '7 BERKAT', 'Supplier Code': 'S28', 'Reference No': '',
    SKU: 'VT.KKL', Name: 'VET KOKEL', 'Product Type': 'PART PENUNJANG', 'Product Code': '',
    Qty: 1, 'Price (Rp)': 35000, 'Total (Rp)': 35000, 'Deliver To': '', ...o
  };
  return HDR.map((h) => d[h] ?? '');
};
const berkas = (rows) => [
  ['CV Awal Berjaya Bengkel'], ['Detailed Purchase Orders'], ['Supplier: All Suppliers'],
  ['Warehouse: All Warehouses'], ['Status: All Status'], ['Downloaded At: 23-Nov-2026 09:44 AM'], [''], HDR, ...rows
];

// ===============================================================
console.log('§1–§2 Header & berkas yang salah');
// ===============================================================
cek('§1 header ketemu', cariHeaderPo(berkas([baris()])).baris, 7);
cek('§1 pengantar terbaca', bacaPengantarPo(berkas([])).warehouse, 'All Warehouses');
// Summary PO punya 'Document No' & 'Supplier', TIDAK punya SKU. Pesannya
// menyebut bedanya — "header tidak ketemu" saja membuat orang mengira
// berkasnya rusak, lalu mengekspor ulang laporan yang sama.
const summary = [['Summary Purchase Orders'], [''], ['No.', 'Date', 'Document No', 'Supplier', 'Total Qty', 'Total (Rp)'], ['1', '02-Nov-2026', 'PO/HO/1', 'CLASSA', '3', '1275000']];
benar('§2 summary PO ditolak', /Detailed Purchase Orders/.test(bacaEksporPo(summary).galat));
benar('§2 dan menyebut kenapa summary tidak cukup', /satu baris per PO/.test(bacaEksporPo(summary).galat));
{
  const b = berkas([baris()]);
  b[7] = HDR.filter((x) => x !== 'Qty');
  benar('§2 kolom wajib hilang menghentikan impor', /Qty/.test(bacaEksporPo(b).galat));
}

// ===============================================================
console.log('§3 Baris cacat & baris tanpa SKU');
// ===============================================================
{
  const h = bacaEksporPo(berkas([baris(), baris({ Order: '' }), baris({ 'Sent At': '' }), baris({ Qty: '' })]));
  cek('§3 tiga ditolak', h.ditolak.map((d) => d.sebab), [MASALAH_PO.TANPA_PO, MASALAH_PO.TANPA_TANGGAL, MASALAH_PO.QTY_TIDAK_SAH]);
  benar('§3 tiap sebab punya kalimatnya', h.ditolak.every((d) => PESAN_MASALAH_PO[d.sebab]));
  // Tanpa SKU: pembeliannya nyata dan tetap dicatat; yang hilang cuma
  // kemampuan mencocokkannya. Membuangnya berarti nilai pembelian berkurang
  // tanpa ada yang memintanya.
  const tanpaSku = bacaEksporPo(berkas([baris({ SKU: '' })]));
  cek('§3 baris tanpa SKU tetap masuk', tanpaSku.baris.length, 1);
  cek('§3 tapi dihitung tersendiri', tanpaSku.ringkas.tanpaSku, 1);
}

// ===============================================================
console.log('§4 Harga nol vs harga kosong');
// ===============================================================
{
  const h = bacaEksporPo(berkas([baris({ 'Price (Rp)': 0, 'Total (Rp)': 0 }), baris({ 'Price (Rp)': '', 'Total (Rp)': '' })]));
  cek('§4 nol dihitung sebagai nol', h.ringkas.hargaNol, 1);
  cek('§4 kosong dihitung sebagai kosong', h.ringkas.tanpaHarga, 1);
  cek('§4 yang dikirim: null tetap null', poUntukRpc(h.baris)[1].harga, null);
  cek('§4 nol tetap 0', poUntukRpc(h.baris)[0].harga, 0);
  // SELURUHNYA nol = harganya tidak ikut terekspor, bukan barangnya gratis.
  // Layar wajib mengatakannya sebelum ada yang memakai angkanya.
  benar('§4 "semuanya nol" dikenali', semuaHarganyaNol(h.ringkas));
  benar('§4 sebagian nol TIDAK dianggap begitu', !semuaHarganyaNol(bacaEksporPo(berkas([baris(), baris({ 'Price (Rp)': 0, 'Total (Rp)': 0 })])).ringkas));
  benar('§4 berkas kosong bukan "semuanya nol"', !semuaHarganyaNol(ringkasPo([])));
}

// ===============================================================
console.log('§5–§6 Nilai & ringkasan');
// ===============================================================
{
  const h = bacaEksporPo(
    berkas([
      baris({ Qty: 2, 'Price (Rp)': 50000, 'Total (Rp)': 100000 }),
      // Total kosong -> dihitung harga × qty, bukan dianggap nol.
      baris({ No: 2, Order: 'PO/HO/2', 'Supplier Name': 'PURNAMA BAN', Qty: 3, 'Price (Rp)': 10000, 'Total (Rp)': '', 'Sent At': '19-Nov-2026' })
    ])
  );
  cek('§5 nilai total', h.ringkas.nilai, 130000);
  cek('§6 jumlah PO unik', h.ringkas.po, 2);
  cek('§6 qty', h.ringkas.qty, 5);
  cek('§6 supplier terurut', h.ringkas.supplier, ['7 BERKAT', 'PURNAMA BAN']);
  cek('§6 periode dari isi berkas', [h.ringkas.dari, h.ringkas.sampai], ['16-Nov-2026', '19-Nov-2026']);
}
cek('§6 larik kosong tidak melempar', ringkasPo(null).baris, 0);
cek('§6 poUntukRpc tanpa argumen', poUntukRpc(), []);

// ===============================================================
console.log('§7 Tujuan pengiriman ikut dikirim');
// ===============================================================
//
// `kirim_ke` adalah SATU-SATUNYA petunjuk outlet mana yang menerima barangnya.
// Pernah tidak ikut dikirim, dan tidak ada apa pun yang menunjukkannya:
// impornya berhasil, jumlah barisnya benar, nilainya benar, dan layar impor
// tetap menampilkan daftar alamat yang perlu dipetakan — ia membacanya dari
// BERKAS, bukan dari jawaban server. Yang berubah cuma satu: seluruh pembelian
// masuk sebagai pembelian pusat, dan penyaringan per outlet tidak pernah
// bekerja untuk satu baris pun.
{
  const h = bacaEksporPo(
    berkas([baris({ 'Deliver To': 'Jl. Soekarno Hatta No. 1, Malang', Warehouse: 'GUDANG PUSAT' })])
  );
  const dikirim = poUntukRpc(h.baris)[0];
  cek('§7 kirim_ke terbaca dari berkas', h.baris[0].kirim_ke, 'Jl. Soekarno Hatta No. 1, Malang');
  cek('§7 kirim_ke IKUT ke server', dikirim.kirim_ke, 'Jl. Soekarno Hatta No. 1, Malang');
  cek('§7 warehouse ikut (untuk jejak, bukan penentu outlet)', dikirim.warehouse, 'GUDANG PUSAT');
  // Alamat kosong tetap dikirim sebagai teks kosong, bukan hilang: server
  // membedakan "belum dipetakan" dari "memang tanpa alamat".
  const kosong = poUntukRpc(bacaEksporPo(berkas([baris()])).baris)[0];
  cek('§7 alamat kosong tetap ada kuncinya', kosong.kirim_ke, '');
  benar('§7 kunci kirim_ke selalu ada', 'kirim_ke' in kosong);
}

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-baca-po-turboly: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
