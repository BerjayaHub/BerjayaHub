/**
 * EKSPOR BAHAN MASUK SATU RENTANG TANGGAL.
 *
 * Yang ditekankan: angka yang dipakai orang untuk mencocokkan tagihan supplier.
 * Seluruh kegagalan di sini berbentuk sama — berkasnya tetap rapi, totalnya
 * tetap masuk akal, hanya saja salah. Tidak ada satu pun yang melempar error.
 *
 *   - nota batal ikut terhitung  -> pembelian terlihat lebih besar
 *   - `unit_cost × qty` dipakai  -> meleset karena pembulatan
 *   - baris tanpa harga jadi 0   -> total lebih kecil, tanpa tanda
 */
import { hargaBeliBaris, hargaSatuanBaris } from '../js/modules/inventory/harga-baris.js';
import { susunBahanMasuk, KOLOM_BAHAN_MASUK, KOLOM_REKAP_BAHAN } from '../js/modules/inventory/laporan-bahan-masuk.js';

let gagal = 0;

/**
 * `JSON.stringify(Infinity)` ADALAH `"null"`.
 *
 * Begitu juga `NaN`. Pembanding yang memakai `JSON.stringify` apa adanya —
 * bentuk yang dipakai hampir seluruh tes di folder ini — akan membaca
 * `Infinity` sebagai `null`, dan `null` seringkali justru nilai yang
 * DIHARAPKAN.
 *
 * Ini bukan kemungkinan teoretis. Sabotase "harga satuan dibagi qty 0" LOLOS
 * persis lewat lubang ini: penjaga `if (!qty) return null` dicabut,
 * `hargaSatuanBaris` mengembalikan `Infinity`, dan tesnya tetap hijau karena
 * pembandingnya menerjemahkannya jadi `null`.
 *
 * Angka tak-hingga diberi penanda dulu supaya tidak bisa menyamar.
 */
const bertanda = (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? `<<${String(v)}>>` : v);
const tulis = (v) => JSON.stringify(v, bertanda);

const cek = (nama, dapat, harap) => {
  if (tulis(dapat) !== tulis(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${tulis(dapat)}\n   harap : ${tulis(harap)}`);
  }
};

// =====================================================================
// HARGA BELI SATU BARIS
// =====================================================================
cek('line_total menang atas unit_cost', hargaBeliBaris({ qty: 3, line_total: 100000, unit_cost: 33333 }), 100000);
cek('tanpa line_total: unit_cost × qty', hargaBeliBaris({ qty: 3, unit_cost: 33333 }), 99999);

// Inti perbaikannya. 100.000 untuk 3 kg -> unit_cost 33.333 (dibulatkan).
// Mengalikannya kembali memberi 99.999 — dan seribu rupiah itu yang membuat
// laporan tidak pernah cocok dengan tagihan, tanpa sebab yang bisa ditunjuk.
cek(
  'pembulatan tidak merusak angka yang diketik orang',
  hargaBeliBaris({ qty: 3, line_total: 100000, unit_cost: 33333 }) - hargaBeliBaris({ qty: 3, unit_cost: 33333 }),
  1
);

cek('HPP jadi cadangan terakhir', hargaBeliBaris({ qty: 2, product_id: 'gula' }, new Map([['gula', 15000]])), 30000);
cek('tanpa harga apa pun -> null, bukan 0', hargaBeliBaris({ qty: 2, product_id: 'x' }), null);

// Nol adalah harga yang SAH (barang bonus/promo). Kalau `??` jadi `||`, nol
// terbaca "kosong" dan diam-diam diganti HPP — nota bonus jadi bernilai.
cek('line_total 0 tetap 0, tidak jatuh ke HPP', hargaBeliBaris({ qty: 5, line_total: 0, product_id: 'gula' }, new Map([['gula', 15000]])), 0);
cek('unit_cost 0 tetap 0', hargaBeliBaris({ qty: 5, unit_cost: 0, product_id: 'gula' }, new Map([['gula', 15000]])), 0);

// `Number('')` adalah 0, bukan NaN — jebakan yang sudah menggigit dua kali di
// repo ini. Kolom kosong TIDAK boleh terbaca sebagai harga nol.
cek('line_total string kosong bukan 0', hargaBeliBaris({ qty: 2, line_total: '', unit_cost: 5000 }), 10000);
cek('unit_cost string kosong bukan 0', hargaBeliBaris({ qty: 2, unit_cost: '', product_id: 'g' }, new Map([['g', 3000]])), 6000);

cek('item null tidak melempar', hargaBeliBaris(null), null);
cek('harga satuan diturunkan dari total baris', hargaSatuanBaris({ qty: 12.5, line_total: 175000 }), 14000);
cek('harga satuan qty 0 -> null, bukan Infinity', hargaSatuanBaris({ qty: 0, line_total: 50000 }), null);
// Diperiksa SEKALI LAGI tanpa lewat pembanding mana pun. Yang satu ini berdiri
// sendiri kalau `bertanda` di atas suatu saat ikut disederhanakan orang.
cek('qty 0 benar-benar `null` (bukan Infinity yang menyamar)', hargaSatuanBaris({ qty: 0, line_total: 50000 }) === null, true);

// =====================================================================
// LAPORAN RENTANG
// =====================================================================
const notas = [
  { id: 'n1', code: 'TRM-260911-AAAA', receipt_date: '2026-09-10', supplier: 'Pasar Modern', outlets: { name: 'AB Sentul' } },
  { id: 'n2', code: 'TRM-260911-BBBB', receipt_date: '2026-09-11', supplier: 'PD Es Cristal', outlets: { name: 'AB Gading Serpong' } },
  { id: 'n3', code: 'TRM-260911-CCCC', receipt_date: '2026-09-11', supplier: 'Jokowi', outlets: { name: 'AB Sentul' }, status: 'dibatalkan' }
];

const items = [
  { receipt_id: 'n1', product_id: 'beras', qty: 12.5, line_total: 175000, products: { name: 'Beras', base_unit: 'kg' } },
  { receipt_id: 'n1', product_id: 'gula', qty: 5, line_total: 75000, products: { name: 'Gula Pasir', base_unit: 'kg' } },
  { receipt_id: 'n2', product_id: 'beras', qty: 10, line_total: 145000, products: { name: 'Beras', base_unit: 'kg' } },
  { receipt_id: 'n2', product_id: 'es', qty: 20, line_total: 60000, products: { name: 'Es Balok', base_unit: 'pcs' } },
  // Milik nota BATAL — tidak boleh ikut ke mana pun.
  { receipt_id: 'n3', product_id: 'beras', qty: 100, line_total: 1400000, products: { name: 'Beras', base_unit: 'kg' } }
];

const lap = susunBahanMasuk({ notas, items, periode: { dari: '2026-09-01', sampai: '2026-09-11', outlet: 'Semua outlet' } });

cek('nota batal tidak dihitung', lap.ringkas.jumlahNota, 2);
cek('nota batal dilaporkan jumlahnya', lap.ringkas.notaBatal, 1);
cek('baris milik nota batal ikut terbuang', lap.ringkas.jumlahBaris, 4);
cek('total = 175 + 75 + 145 + 60 ribu', lap.ringkas.total, 455000);
cek('subjudul menyebut nota batal', /1 nota batal tidak diikutkan/.test(lap.subjudul), true);

// ---- Kolom ----
cek('rincian delapan kolom', lap.kolomRincian.length, 8);
cek('kolom rincian sama dengan yang diekspor', lap.kolomRincian, KOLOM_BAHAN_MASUK);
cek('kolom rekap sama dengan yang diekspor', lap.kolomRekap, KOLOM_REKAP_BAHAN);
cek('urutan kolom persis yang diminta', lap.kolomRincian.map((k) => k.header), [
  'Tanggal',
  'No. Nota',
  'Outlet',
  'Bahan',
  'Jumlah',
  'Satuan',
  'Harga beli',
  'Supplier'
]);

// Kolom uang & jumlah ditandai numeric — justru MENJUMLAHKAN itulah alasan
// orang meminta xlsx alih-alih PDF.
cek('kolom Harga beli numeric', KOLOM_BAHAN_MASUK[6].numeric, true);
cek('kolom Jumlah numeric', KOLOM_BAHAN_MASUK[4].numeric, true);
cek('kolom Total harga beli di rekap numeric', KOLOM_REKAP_BAHAN[3].numeric, true);

// ---- Urutan & isi baris ----
cek('urut tanggal lebih dulu', lap.rincian[0][0], '2026-09-10');
cek('baris pertama nomor notanya', lap.rincian[0][1], 'TRM-260911-AAAA');
cek('dalam satu nota urut nama bahan', [lap.rincian[0][3], lap.rincian[1][3]], ['Beras', 'Gula Pasir']);
cek('supplier ikut tiap baris', lap.rincian[0][7], 'Pasar Modern');
cek('outlet ikut tiap baris', lap.rincian[0][2], 'AB Sentul');
cek('tidak ada baris dari nota batal', lap.rincian.some((r) => r[1] === 'TRM-260911-CCCC'), false);

// ---- Rekap ----
cek('rekap tiga bahan', lap.ringkas.jumlahBahan, 3);
const beras = lap.rekap.find((r) => r[0] === 'Beras');
// Pemisah desimalnya mengikuti locale `id-ID`; yang diuji jumlahnya, bukan
// tanda bacanya — tes yang mengunci "22,5" akan merah di Node ber-ICU kecil,
// dan itu kegagalan yang tidak ada hubungannya dengan laporan ini.
cek('rekap beras qty 12,5 + 10', ['22,5', '22.5'].includes(beras[1]), true);
cek('rekap beras satuan', beras[2], 'kg');
cek('rekap beras dari 2 nota', beras[4], '2');
cek('rekap beras menyebut kedua suppliernya', beras[6], 'Pasar Modern, PD Es Cristal');
cek('rekap diurut dari nilai terbesar', lap.rekap[0][0], 'Beras');

// =====================================================================
// BARIS TANPA HARGA — TIDAK BOLEH JADI NOL DIAM-DIAM
// =====================================================================
const kurang = susunBahanMasuk({
  notas: [notas[0]],
  items: [
    { receipt_id: 'n1', product_id: 'beras', qty: 10, line_total: 100000, products: { name: 'Beras', base_unit: 'kg' } },
    { receipt_id: 'n1', product_id: 'baru', qty: 3, products: { name: 'Bahan Baru', base_unit: 'pcs' } }
  ]
});
cek('total hanya yang berharga', kurang.ringkas.total, 100000);
cek('baris tanpa harga dihitung', kurang.ringkas.barisTanpaHarga, 1);
cek('subjudul menyebutnya', /1 baris belum berharga/.test(kurang.subjudul), true);
const baru = kurang.rekap.find((r) => r[0] === 'Bahan Baru');
cek('sel harga "-" bukan Rp0', kurang.rincian.find((r) => r[3] === 'Bahan Baru')[6], '-');
cek('rekap tanpa harga "-" bukan Rp0', baru[3], '-');
cek('rekap menghitung baris tanpa harganya', baru[5], '1');

// =====================================================================
// BARIS LAMA (sebelum 0124) YANG CUMA PUNYA unit_cost
// =====================================================================
const lama = susunBahanMasuk({
  notas: [notas[0]],
  items: [{ receipt_id: 'n1', product_id: 'gula', qty: 4, unit_cost: 12000, products: { name: 'Gula', base_unit: 'kg' } }]
});
cek('baris lama tetap terhitung', lama.ringkas.total, 48000);
cek('baris lama tidak dianggap tanpa harga', lama.ringkas.barisTanpaHarga, 0);

// =====================================================================
// PRODUK YANG SUDAH DIHAPUS DARI MASTER
//
// Barangnya pernah benar-benar masuk dan uangnya benar-benar keluar.
// Membuangnya membuat total laporan tidak cocok dengan tagihan.
// =====================================================================
const yatim = susunBahanMasuk({
  notas: [notas[0]],
  items: [{ receipt_id: 'n1', product_id: null, qty: 2, line_total: 20000, products: null }]
});
cek('produk terhapus tetap muncul', yatim.rincian[0][3], '(produk terhapus)');
cek('produk terhapus tetap dihitung', yatim.ringkas.total, 20000);
cek('produk terhapus tidak menabrak pengelompokan', yatim.ringkas.jumlahBahan, 1);

// =====================================================================
// MASUKAN RUSAK TIDAK BOLEH MELEMPAR
// =====================================================================
const kosong = susunBahanMasuk({});
cek('tanpa argumen: nol baris', kosong.ringkas.jumlahBaris, 0);
cek('tanpa argumen: total 0', kosong.ringkas.total, 0);
cek('tanpa argumen: nama berkas tetap aman', /^bahan-masuk-/.test(kosong.namaBerkas), true);

const yatimItem = susunBahanMasuk({ notas: [], items });
cek('item tanpa induk dibuang', yatimItem.ringkas.jumlahBaris, 0);

cek(
  'nama berkas bersih dari karakter berbahaya',
  susunBahanMasuk({ periode: { dari: '2026/09/01', sampai: '2026/09/11' } }).namaBerkas,
  'bahan-masuk-2026-09-01-s-d-2026-09-11'
);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Ekspor bahan masuk benar untuk 46 kasus — termasuk nota batal, harga bonus 0, pembulatan line_total, dan Infinity yang menyamar jadi null. ✅');
