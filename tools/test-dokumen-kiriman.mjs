/**
 * Penyusunan dokumen order & surat jalan.
 *
 * SATU SUMBER untuk tiga keluaran — layar, PDF, dan xlsx. Kalau ketiganya
 * menyusun barisnya sendiri, cepat atau lambat menyimpang, dan yang paling
 * mungkin menyimpang justru kolom jumlah. Dokumen serah-terima yang angkanya
 * berbeda antara layar dan kertas tidak bisa dipakai menyelesaikan
 * perselisihan — padahal itu satu-satunya alasan dokumen itu ada.
 *
 * Yang dijaga di sini terutama dua hal yang mudah salah dan sulit terlihat:
 *   - kolom NILAI hanya ada kalau diminta (Staff App tidak memintanya);
 *   - SELISIH hanya dihitung kalau barangnya sudah benar-benar diterima.
 */
import { susunDokumen } from '../js/modules/dispatch/dokumen.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

const header = {
  code: 'SJ-2026-0007',
  status: 'sent',
  statusLabel: 'Dikirim (belum diterima)',
  created_at: '2026-08-12T03:00:00.000Z',
  from_outlet: { name: 'Central Kitchen' },
  to_outlet: { name: 'Gading Serpong' },
  pembuat: { full_name: 'Budi' }
};
const items = [
  { product_id: 'gula', sent_qty: 1000, received_qty: null, products: { name: 'Gula', base_unit: 'gram' } },
  { product_id: 'susu', sent_qty: 12, received_qty: null, products: { name: 'Susu UHT', base_unit: 'pcs' } }
];
const biaya = new Map([
  ['gula', 15],
  ['susu', 18000]
]);

// ---- Staff App: tanpa nilai ----
const tanpa = susunDokumen({ jenis: 'dispatch', header, items });
cek('tanpa nilai: kolomnya lima', tanpa.kolom.map((k) => k.header), ['Barang', 'Dikirim', 'Diterima', 'Selisih', 'Satuan']);
cek('tanpa nilai: tidak ada total', tanpa.totalTeks, null);
cek('baris pertama apa adanya', tanpa.baris[0], ['Gula', '1000', '', '', 'gram']);

// Kiriman yang MASIH DI JALAN: kolom diterima & selisih dibiarkan KOSONG.
// Menampilkan "-1000" untuk barang yang belum dihitung akan terbaca sebagai
// barang hilang, dan itu tuduhan yang tidak dimaksudkan siapa pun.
cek('belum diterima -> selisih kosong, bukan negatif', tanpa.baris.map((b) => b[3]), ['', '']);

// ---- Admin Portal: dengan nilai ----
const dengan = susunDokumen({ jenis: 'dispatch', header, items, denganNilai: true, biaya });
cek('dengan nilai: dua kolom tambahan', dengan.kolom.slice(-2).map((k) => k.header), ['HPP/satuan', 'Nilai']);
cek('kolom nilai ditandai numeric untuk Excel', dengan.kolom.slice(-2).map((k) => k.numeric), [true, true]);
cek('nilai dihitung dari jumlah DIKIRIM', dengan.total, 1000 * 15 + 12 * 18000);
cek('total diformat rupiah', dengan.totalTeks, 'Rp 231.000');

// Bahan tanpa HPP tidak boleh diam-diam dihitung nol — nol membuat total
// terlihat sah padahal ada yang belum berbiaya.
const sebagian = susunDokumen({
  jenis: 'dispatch',
  header,
  items,
  denganNilai: true,
  biaya: new Map([['gula', 15]])
});
cek('bahan tanpa HPP ditandai "-"', sebagian.baris[1].slice(-2), ['-', '-']);
cek('dan tidak ikut menambah total', sebagian.total, 1000 * 15);

// ---- Sudah diterima: selisih muncul ----
const diterima = susunDokumen({
  jenis: 'dispatch',
  header: { ...header, status: 'received', statusLabel: 'Diterima', received_at: '2026-08-12T09:00:00.000Z', penerima: { full_name: 'Sari' } },
  items: [
    { product_id: 'gula', sent_qty: 1000, received_qty: 980, products: { name: 'Gula', base_unit: 'gram' } },
    { product_id: 'susu', sent_qty: 12, received_qty: 12, products: { name: 'Susu UHT', base_unit: 'pcs' } }
  ]
});
cek('kurang 20 ditandai negatif', diterima.baris[0][3], '-20');
cek('pas ditandai nol', diterima.baris[1][3], '0');
cek('baris penerima ikut muncul', diterima.info.some(([k]) => k === 'Penerima'), true);
cek('sedangkan yang belum diterima tidak punya baris itu', tanpa.info.some(([k]) => k === 'Penerima'), false);

// ---- Order: kolomnya berbeda, dan itu memang seharusnya ----
const order = susunDokumen({
  jenis: 'order',
  header: {
    code: 'ORD-2026-0003',
    statusLabel: 'Menunggu diproses',
    created_at: '2026-08-12T03:00:00.000Z',
    from_outlet: { name: 'Gading Serpong' },
    to_outlet: { name: 'Central Kitchen' },
    pembuat: { full_name: 'Rina' }
  },
  items: [{ product_id: 'gula', qty: 500, products: { name: 'Gula', base_unit: 'gram' } }]
});
cek('order: hanya jumlah diminta', order.kolom.map((k) => k.header), ['Barang', 'Diminta', 'Satuan']);
cek('order: judulnya beda', order.judul, 'Order Stok');
cek('order: barisnya apa adanya', order.baris[0], ['Gula', '500', 'gram']);

// ---- Nama berkas: aman dipakai sebagai nama file ----
cek('nama berkas dari nomor dokumen', dengan.namaBerkas, 'surat-jalan-SJ-2026-0007');
cek('order punya awalan sendiri', order.namaBerkas, 'order-ORD-2026-0003');
// Nomor yang memuat garis miring akan membuat nama file tidak sah di Windows
// dan memotong path di beberapa browser.
cek(
  'karakter yang tidak sah dibersihkan',
  susunDokumen({ jenis: 'dispatch', header: { ...header, code: 'SJ/2026/07 #1' }, items: [] }).namaBerkas,
  'surat-jalan-SJ-2026-07-1'
);

// ---- Nilai batas ----
cek('tanpa item: barisnya kosong, bukan error', susunDokumen({ jenis: 'order', header, items: [] }).baris, []);
cek('items null aman', susunDokumen({ jenis: 'order', header, items: null }).baris, []);
cek('tanpa nomor tetap punya penamaan', susunDokumen({ jenis: 'order', header: {}, items: [] }).nomor, '(tanpa nomor)');
cek('produk terhapus tetap disebut', susunDokumen({ jenis: 'order', header, items: [{ qty: 1 }] }).baris[0][0], '(produk terhapus)');
cek('catatan hanya muncul kalau ada', tanpa.info.some(([k]) => k === 'Catatan'), false);
cek(
  'catatan muncul kalau diisi',
  susunDokumen({ jenis: 'dispatch', header: { ...header, notes: 'titip di pos' }, items: [] }).info.some(([k]) => k === 'Catatan'),
  true
);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('Dokumen order & surat jalan benar untuk 24 kasus, termasuk selisih yang belum boleh dihitung. ✅');
