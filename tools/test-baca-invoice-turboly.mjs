/**
 * PEMBACA EKSPOR TURBOLY — tes murni.
 *
 *   §1 Header dicari dari ISINYA, bukan nomor barisnya.
 *   §2 Kolom dicari dari NAMANYA; yang wajib hilang menghentikan impor.
 *   §3 Baris cacat ditolak dengan sebab, bukan diam-diam jadi nol.
 *   §4 `Cost` adalah total baris — ringkasannya tidak mengalikan qty.
 *   §5 Jasa dipisah dari sparepart.
 *   §6 Modal yang tidak diketahui tetap `null`, bukan 0.
 *   §7 Gross Profit yang tidak cocok ditandai, barisnya tetap masuk.
 *   §8 Satu berkas boleh memuat BANYAK store.
 *   §9 Angka berformat Excel ("Rp1.234,50") terbaca.
 */
import {
  angka,
  bacaPengantar,
  cariHeader,
  bacaEksporTurboly,
  ringkasImpor,
  untukRpc,
  MASALAH,
  PESAN_MASALAH,
  KOLOM_WAJIB
} from '../js/modules/bengkel/baca-invoice-turboly.js';

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
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

const HDR = [
  'No.', 'Invoice Date', 'Store', 'Service Invoice', 'Type', 'Status', 'Customer', 'Company',
  'Registration', 'Item Type', 'SKU', 'Product Name', 'Qty', 'Price Ex Tax', 'Discount',
  'Total', 'Cost', 'Gross Profit', 'Service Order', 'Payment Types'
];
const baris = (o = {}) => {
  const d = {
    'No.': 1, 'Invoice Date': '2026-11-22', Store: 'OTONIX Malang', 'Service Invoice': 'SRI/OTXM/001',
    Type: 'Service Sale', Status: 'Completed', Customer: 'CATUR', Company: '', Registration: 'N1234AB',
    'Item Type': 'Sparepart', SKU: 'NC.300', 'Product Name': 'NYLON CABLE TIE', Qty: 1,
    'Price Ex Tax': 2500, Discount: 0, Total: 2500, Cost: 300, 'Gross Profit': 2200,
    'Service Order': 'SRO/1', 'Payment Types': 'Cash', ...o
  };
  return HDR.map((h) => d[h] ?? '');
};
const berkas = (rows, pengantar = []) => [
  ['Detailed Service Invoice'], [''], ['CV Awal Berjaya Bengkel'],
  ...pengantar, ['Store: All Stores'], ['From Date: 01-Nov-2026'], ['To Date: 30-Nov-2026'],
  ['Downloaded At: 22-Nov-2026 06:14 PM'], [''], HDR, ...rows
];

// ===============================================================
console.log('§1 Header dicari dari isinya');
// ===============================================================
const h = cariHeader(berkas([baris()]));
cek('§1 header ketemu di baris ke-8 (0-based)', h.baris, 8);
cek('§1 kolomnya terpetakan', h.peta.get('Service Invoice'), 3);
// Jumlah baris pengantar BERUBAH mengikuti saringan yang dipakai saat
// mengekspor. Pembaca yang memakai nomor baris tetap akan "berhasil" — ia cuma
// membaca baris yang salah.
const h2 = cariHeader(berkas([baris()], [['Filter A'], ['Filter B'], ['Filter C']]));
cek('§1 pengantar lebih panjang tetap ketemu', h2.baris, 11);
cek('§1 berkas tanpa header', cariHeader([['a'], ['b']]), null);
cek('§1 bukan larik tidak melempar', cariHeader(null), null);

cek('§2 pengantar terbaca', bacaPengantar(berkas([baris()])), {
  store: 'All Stores', dari: '01-Nov-2026', sampai: '30-Nov-2026', diunduh: '22-Nov-2026 06:14 PM'
});

// ===============================================================
console.log('§2 Kolom wajib');
// ===============================================================
{
  const tanpaTotal = berkas([baris()]).map((r) => (r === undefined ? r : r));
  const i = tanpaTotal.findIndex((r) => r.includes('Service Invoice'));
  tanpaTotal[i] = HDR.filter((x) => x !== 'Total');
  const hasil = bacaEksporTurboly(tanpaTotal);
  benar('§2 kolom wajib hilang menghentikan impor', /Total/.test(hasil.galat), hasil.galat);
  cek('§2 dan tidak ada invoice yang terbentuk', hasil.invoices.length, 0);
}
benar('§2 berkas lain ditolak dengan kalimat yang menyebut namanya', /Detailed Service Invoice/.test(bacaEksporTurboly([['x']]).galat));
benar('§2 daftar kolom wajib memuat yang menentukan', KOLOM_WAJIB.includes('Service Invoice') && KOLOM_WAJIB.includes('Item Type'));

// ===============================================================
console.log('§3 Baris cacat ditolak dengan sebab');
// ===============================================================
{
  const hasil = bacaEksporTurboly(
    berkas([
      baris(),
      baris({ 'Service Invoice': '' }),
      baris({ 'Invoice Date': '' }),
      baris({ Store: '' }),
      baris({ Qty: '' })
    ])
  );
  cek('§3 empat baris ditolak', hasil.ditolak.map((d) => d.sebab), [
    MASALAH.TANPA_INVOICE, MASALAH.TANPA_TANGGAL, MASALAH.TANPA_STORE, MASALAH.QTY_TIDAK_SAH
  ]);
  cek('§3 yang sehat tetap masuk', hasil.invoices.length, 1);
  benar('§3 tiap sebab punya kalimatnya', hasil.ditolak.every((d) => PESAN_MASALAH[d.sebab]));
  // Qty 0 SAH — Turboly memakainya untuk baris compliment.
  cek('§3 qty nol diterima', bacaEksporTurboly(berkas([baris({ Qty: 0 })])).ringkas.baris, 1);
  // Baris kosong = ujung tabel, bukan kesalahan.
  cek('§3 baris kosong dilewati diam-diam', bacaEksporTurboly(berkas([baris(), ['', '', '']])).ditolak.length, 0);
}

// ===============================================================
console.log('§4 `Cost` adalah TOTAL baris, bukan per unit');
// ===============================================================
//
// Oli 4 liter: Total 592.000, Cost 459.000, GP 133.000. Dikalikan qty,
// HPP-nya jadi 1,8 juta — dan angkanya tetap terlihat wajar di layar.
{
  const hasil = bacaEksporTurboly(
    berkas([baris({ Qty: 4, 'Price Ex Tax': 148000, Total: 592000, Cost: 459000, 'Gross Profit': 133000 })])
  );
  cek('§4 modal tidak dikalikan qty', hasil.ringkas.modal, 459000);
  cek('§4 laba = omzet sparepart - modal', hasil.ringkas.laba, 133000);
}

// ===============================================================
console.log('§5 Jasa dipisah dari sparepart');
// ===============================================================
{
  const hasil = bacaEksporTurboly(
    berkas([
      baris({ 'Item Type': 'Service', SKU: 'JAS0048', Total: 100000, Cost: '', 'Gross Profit': '' }),
      baris({ 'No.': 2, Total: 2500, Cost: 300, 'Gross Profit': 2200 })
    ])
  );
  const r = hasil.ringkas;
  cek('§5 omzet jasa', r.omzetJasa, 100000);
  cek('§5 omzet sparepart', r.omzetSparepart, 2500);
  cek('§5 omzet total', r.omzet, 102500);
  // Jasa tidak punya modal barang. Memasukkannya ke laba yang sama membuat
  // margin sparepart terlihat jauh lebih sehat daripada kenyataannya.
  cek('§5 laba dihitung dari sparepart saja', r.laba, 2200);
  cek('§5 jasa tidak dihitung sebagai "tanpa modal"', r.tanpaModal, 0);
}

// ===============================================================
console.log('§6 Modal yang tidak diketahui tetap null');
// ===============================================================
{
  const hasil = bacaEksporTurboly(berkas([baris({ Cost: '', 'Gross Profit': '' })]));
  cek('§6 dihitung sebagai baris tanpa modal', hasil.ringkas.tanpaModal, 1);
  cek('§6 modal tidak ikut dijumlahkan', hasil.ringkas.modal, 0);
  const rpc = untukRpc(hasil.invoices);
  cek('§6 yang dikirim ke database null, bukan 0', rpc[0].baris[0].modal, null);
  // 0 akan membuat labanya terlihat 100% — angka yang tidak akan pernah
  // dicurigai karena bentuknya wajar.
  cek('§6 modal nol SUNGGUHAN tetap 0', untukRpc(bacaEksporTurboly(berkas([baris({ Cost: 0 })])).invoices)[0].baris[0].modal, 0);
}

// ===============================================================
console.log('§7 Gross Profit yang tidak cocok ditandai');
// ===============================================================
{
  const hasil = bacaEksporTurboly(berkas([baris({ Total: 2500, Cost: 300, 'Gross Profit': 999 })]));
  cek('§7 ditandai sebagai peringatan', hasil.peringatan.map((p) => p.sebab), [MASALAH.LABA_TIDAK_COCOK]);
  // DITANDAI, bukan ditolak: angkanya mungkin benar dan pemahaman kita yang
  // keliru. Membuang barisnya berarti omzet hari itu hilang diam-diam.
  cek('§7 barisnya tetap masuk', hasil.invoices[0].baris.length, 1);
  cek('§7 selisih satu rupiah dimaafkan (pembulatan)', bacaEksporTurboly(berkas([baris({ Total: 2500, Cost: 300, 'Gross Profit': 2200.4 })])).peringatan.length, 0);
}

// ===============================================================
console.log('§8 Satu berkas, banyak store');
// ===============================================================
//
// Ekspor sungguhan berjudul `Store: All Stores` dan isinya Malang DAN
// Mojokerto. Impor yang memakai satu pilihan outlet di layar akan menaruh
// penjualan Mojokerto ke Malang — tanpa satu pun tanda.
{
  const hasil = bacaEksporTurboly(
    berkas([
      baris({ Store: 'OTONIX Malang', 'Service Invoice': 'SRI/OTXM/001' }),
      baris({ Store: 'OTONIX Mojokerto', 'Service Invoice': 'SRI/OTXMJ/009' })
    ])
  );
  cek('§8 dua store terdeteksi', hasil.ringkas.store, ['OTONIX Malang', 'OTONIX Mojokerto']);
  cek('§8 tiap invoice membawa storenya sendiri', hasil.invoices.map((i) => i.store), ['OTONIX Malang', 'OTONIX Mojokerto']);
}

// ===============================================================
console.log('§9 Angka & pengelompokan');
// ===============================================================
cek('§9 angka biasa', angka(2500), 2500);
cek('§9 kosong = null, bukan 0', angka(''), null);
cek('§9 teks sampah = null', angka('abc'), null);
cek('§9 format Indonesia', angka('1.234,5'), 1234.5);
cek('§9 berawalan Rp', angka('Rp 12.500'), 12500);
cek('§9 negatif (retur)', angka('-5000'), -5000);

{
  // Satu invoice, tiga baris: nomor urutnya dibuat ULANG di sini, bukan
  // memakai `No.` dari berkas — nomor itu cuma urutan di dalam berkas.
  const hasil = bacaEksporTurboly(
    berkas([baris({ 'No.': 7 }), baris({ 'No.': 8, SKU: 'B' }), baris({ 'No.': 9, SKU: 'C' })])
  );
  cek('§9 satu invoice', hasil.invoices.length, 1);
  cek('§9 tiga baris', hasil.invoices[0].baris.length, 3);
  cek('§9 urutnya dibuat ulang 1..3', untukRpc(hasil.invoices)[0].baris.map((b) => b.urut), [1, 2, 3]);
}
cek('§9 ringkasan larik kosong tidak melempar', ringkasImpor([]).baris, 0);
cek('§9 untukRpc tanpa argumen', untukRpc(), []);

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-baca-invoice-turboly: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
