/**
 * MESIN PENCOCOKAN BELI↔JUAL — tes murni.
 *
 *   §1 FIFO: yang dibeli duluan terpakai duluan.
 *   §2 Satu penjualan bisa mengambil dari BEBERAPA pembelian.
 *   §3 Pembelian SESUDAH tanggal jual tidak boleh dipakai.
 *   §4 Yang tidak ketemu DITANDAI, bukan diberi harga 0.
 *   §5 Sisa pembelian = stok, dan nopolnya "STOK".
 *   §6 Nopol & SKU dirapikan sebelum dibandingkan.
 *   §7 Jasa dilewati, bukan dicari pembeliannya.
 *   §8 Harga beli = rata-rata tertimbang; nol-semua tetap null.
 *   §9 Hasilnya sama tiap kali dijalankan.
 */
import {
  cocokkanBeliJual, kunciSku, kunciNopol, tanggalUrut, catatanCocok, ASAL, PESAN_ASAL
} from '../js/modules/bengkel/cocokkan-beli-jual.js';

let gagal = 0, n = 0;
const cek = (nama, dapat, harap) => {
  n++;
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => { n++; if (!syarat) { gagal++; console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`); } };

const B = (o) => ({ po_no: 'PO/1', tanggal: '01-Nov-2026', supplier: 'RATU', sku: 'FLT.A', nama: 'FILTER A', qty: 10, harga: 28000, ...o });
const J = (o) => ({ invoice_no: 'SRI/1', tanggal: '10-Nov-2026', nopol: 'N1732AAR', sku: 'FLT.A', nama: 'FILTER A', qty: 1, item_type: 'sparepart', ...o });

// ===============================================================
console.log('§1–§2 FIFO & lintas pembelian');
// ===============================================================
{
  const h = cocokkanBeliJual({
    pembelian: [B({ po_no: 'PO/LAMA', tanggal: '01-Nov-2026', qty: 2, harga: 10000 }), B({ po_no: 'PO/BARU', tanggal: '05-Nov-2026', qty: 10, harga: 20000 })],
    penjualan: [J({ qty: 1 })]
  });
  cek('§1 mengambil dari pembelian paling awal', h.jual[0].sumber.map((s) => s.po_no), ['PO/LAMA']);
  cek('§1 supplier ikut terisi', h.jual[0].supplier, 'RATU');
  cek('§1 harga beli dari pembelian itu', h.jual[0].hargaBeli, 10000);
  cek('§1 sisa PO/LAMA berkurang', h.beli[0].sisa, 1);
  cek('§1 PO/BARU belum tersentuh', h.beli[1].sisa, 10);

  // Qty jual > sisa PO pertama -> mengambil dari dua pembelian sekaligus.
  const h2 = cocokkanBeliJual({
    pembelian: [B({ po_no: 'PO/LAMA', qty: 2, harga: 10000 }), B({ po_no: 'PO/BARU', tanggal: '05-Nov-2026', qty: 10, harga: 20000 })],
    penjualan: [J({ qty: 4 })]
  });
  cek('§2 dua sumber', h2.jual[0].sumber.map((s) => [s.po_no, s.qty]), [['PO/LAMA', 2], ['PO/BARU', 2]]);
  cek('§2 supplier digabung tanpa kembar', h2.jual[0].supplier, 'RATU');
  // (10000×2 + 20000×2) / 4 = 15000
  cek('§8 harga beli rata-rata tertimbang', h2.jual[0].hargaBeli, 15000);
  cek('§8 total beli', h2.jual[0].totalBeli, 60000);
  cek('§2 statusnya cocok penuh', h2.jual[0].asal, ASAL.COCOK);
}

// ===============================================================
console.log('§3 Pembelian sesudah tanggal jual tidak dipakai');
// ===============================================================
{
  // Tanpa penjagaan ini, pembelian bulan depan akan "membiayai" penjualan
  // bulan ini — dan labanya tetap terlihat masuk akal.
  const h = cocokkanBeliJual({
    pembelian: [B({ tanggal: '20-Nov-2026', qty: 5 })],
    penjualan: [J({ tanggal: '10-Nov-2026' })]
  });
  cek('§3 tidak dipakai', h.jual[0].sumber, []);
  cek('§3 ditandai tidak ketemu', h.jual[0].asal, ASAL.TIDAK_KETEMU);
  cek('§3 pembeliannya tetap utuh', h.beli[0].sisa, 5);
}

// ===============================================================
console.log('§4 Tidak ketemu ditandai, bukan diberi 0');
// ===============================================================
{
  const h = cocokkanBeliJual({ pembelian: [], penjualan: [J({ qty: 2 })] });
  cek('§4 asal', h.jual[0].asal, ASAL.TIDAK_KETEMU);
  // 0 akan terbaca sebagai "untung penuh"; null berarti "belum diketahui".
  cek('§4 harga beli null, bukan 0', h.jual[0].hargaBeli, null);
  cek('§4 total beli null', h.jual[0].totalBeli, null);
  cek('§4 supplier kosong', h.jual[0].supplier, '');
  benar('§4 tiap asal punya kalimatnya', Object.values(ASAL).every((a) => PESAN_ASAL[a]));

  // Ketemu sebagian: 1 dari 3.
  const h2 = cocokkanBeliJual({ pembelian: [B({ qty: 1 })], penjualan: [J({ qty: 3 })] });
  cek('§4 sebagian ditandai sendiri', h2.jual[0].asal, ASAL.SEBAGIAN);
  cek('§4 harga beli dari yang ketemu saja', h2.jual[0].hargaBeli, 28000);
}

// ===============================================================
console.log('§5 Sisa = stok');
// ===============================================================
{
  const h = cocokkanBeliJual({
    pembelian: [B({ qty: 10 })],
    penjualan: [J({ qty: 2, nopol: 'N1' }), J({ invoice_no: 'SRI/2', qty: 3, nopol: 'N2' })]
  });
  cek('§5 terpakai 5', h.beli[0].qtyTerpakai, 5);
  cek('§5 sisa 5', h.beli[0].sisa, 5);
  cek('§5 dua nopol', h.beli[0].nopol, ['N1', 'N2']);
  cek('§5 teksnya menyebut jumlahnya', h.beli[0].nopolTeks, '2 nopol');
  cek('§5 rincian pemakaian ikut', h.beli[0].terpakai.map((t) => [t.nopol, t.qty]), [['N1', 2], ['N2', 3]]);
  cek('§5 yang belum terpakai sama sekali = STOK', cocokkanBeliJual({ pembelian: [B()], penjualan: [] }).beli[0].nopolTeks, 'STOK');
  cek('§5 satu nopol tampil apa adanya', cocokkanBeliJual({ pembelian: [B()], penjualan: [J({ nopol: 'L 1504 BDI' })] }).beli[0].nopolTeks, 'L 1504 BDI');
}

// ===============================================================
console.log('§6 Perapian kunci');
// ===============================================================
cek('§6 SKU huruf kecil & spasi', kunciSku(' flt.a '), 'FLT.A');
// `N1732AAR` (Turboly) vs `N 1732 AAR` (sheet) harus jadi kunci yang sama.
cek('§6 nopol bersih', kunciNopol('N 1732 AAR'), 'N1732AAR');
cek('§6 tanggal Turboly jadi urut', tanggalUrut('16-Nov-2026'), '2026-11-16');
cek('§6 tanggal ISO dibiarkan', tanggalUrut('2026-11-22'), '2026-11-22');
cek('§6 tanggal kosong', tanggalUrut(''), '');
{
  const h = cocokkanBeliJual({ pembelian: [B({ sku: 'flt.a' })], penjualan: [J({ sku: 'FLT.A ' })] });
  cek('§6 SKU beda huruf tetap cocok', h.jual[0].asal, ASAL.COCOK);
}

// ===============================================================
console.log('§7 Jasa dilewati');
// ===============================================================
{
  const h = cocokkanBeliJual({ pembelian: [], penjualan: [J({ item_type: 'jasa', sku: 'JAS0048' })] });
  // Jasa memang tidak punya pembelian. Menandainya "tidak ketemu" akan
  // membuat ratusan baris merah yang tidak perlu dicari siapa pun.
  cek('§7 asal null, bukan tidak-ketemu', h.jual[0].asal, null);
  cek('§7 tidak ikut dihitung', h.ringkas.jualSparepart, 0);
}
{
  const h = cocokkanBeliJual({ pembelian: [B()], penjualan: [J({ sku: '' })] });
  cek('§7 jual tanpa SKU ditandai', h.jual[0].asal, ASAL.TANPA_SKU);
  cek('§7 dan pembelian tidak terpakai', h.beli[0].sisa, 10);
}

// ===============================================================
console.log('§8–§9 Harga nol & kestabilan');
// ===============================================================
{
  // Seluruh pembeliannya berharga nol (kasus ekspor Turboly sekarang):
  // harga beli TETAP 0 karena itu angka yang tercatat — yang membedakannya
  // dari "tidak ketemu" adalah `asal`-nya tetap cocok.
  const h = cocokkanBeliJual({ pembelian: [B({ harga: 0 })], penjualan: [J()] });
  cek('§8 harga nol tetap tercatat nol', h.jual[0].hargaBeli, 0);
  cek('§8 tapi asalnya tetap ketemu', h.jual[0].asal, ASAL.COCOK);
  // Harga `null` (sel kosong) -> rata-ratanya null, bukan 0.
  cek('§8 harga kosong tidak jadi 0', cocokkanBeliJual({ pembelian: [B({ harga: null })], penjualan: [J()] }).jual[0].hargaBeli, null);
}
{
  const data = {
    pembelian: [B({ po_no: 'A', tanggal: '01-Nov-2026', qty: 3 }), B({ po_no: 'B', tanggal: '01-Nov-2026', qty: 3 })],
    penjualan: [J({ qty: 4 })]
  };
  const satu = cocokkanBeliJual(data).jual[0].sumber.map((s) => [s.po_no, s.qty]);
  // Tanggal sama: urutannya harus tetap, supaya angka tidak berubah tiap kali
  // laporan dibuka untuk data yang sama persis.
  for (let i = 0; i < 5; i++) {
    cek(`§9 hasilnya sama pada pengulangan ke-${i + 1}`, cocokkanBeliJual(data).jual[0].sumber.map((s) => [s.po_no, s.qty]), satu);
  }
}
{
  const h = cocokkanBeliJual({ pembelian: [B({ qty: 10 })], penjualan: [J(), J({ invoice_no: 'X', sku: 'LAIN' })] });
  const c = catatanCocok(h.ringkas);
  benar('§9 catatan menyebut FIFO sebagai tebakan', /FIFO/.test(c[0]) && /bukan dari catatan pemasangan/.test(c[0]));
  benar('§9 menyebut yang tidak ketemu', c.some((x) => /tidak ketemu pembeliannya/.test(x)));
  benar('§9 menyebut sisa stok', c.some((x) => /dianggap stok/.test(x)));
}
cek('§9 tanpa argumen tidak melempar', cocokkanBeliJual().jual, []);

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-cocokkan-beli-jual: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
