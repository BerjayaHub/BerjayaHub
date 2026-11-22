/**
 * LAPORAN PENJUALAN BENGKEL — tes murni.
 *
 *   §1 Laba dihitung dari baris BERMODAL saja.
 *   §2 Baris tanpa modal dihitung & nilainya disebut.
 *   §3 Jasa tidak pernah ikut jadi laba.
 *   §4 Margin dihitung dari omzet bermodal, bukan seluruh omzet.
 *   §5 Pengelompokan per nopol/SKU hanya dari sparepart.
 *   §6 Catatan ikut ke mana pun angkanya dibawa.
 */
import { ringkasPenjualan, catatanLaporan, kelompok, susunLaporanBengkel, rupiah } from '../js/modules/bengkel/laporan-penjualan-bengkel.js';

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

const b = (o) => ({ invoice_no: 'A1', outlet_nama: 'Malang', sumber: 'turboly', item_type: 'sparepart', nopol: 'N1', sku: 'X', nama: 'X', qty: 1, total: 0, modal: null, ...o });

// ===============================================================
console.log('§1–§4 Laba, modal, margin');
// ===============================================================
const data = [
  b({ total: 100000, modal: 60000, sku: 'A' }),
  b({ total: 50000, modal: null, sku: 'B' }),                 // korporat tanpa modal
  b({ item_type: 'jasa', total: 200000, modal: null, sku: '' }),
  b({ invoice_no: 'A2', total: 30000, modal: 10000, sku: 'A' })
];
const r = ringkasPenjualan(data);
cek('§1 omzet seluruhnya', r.omzet, 380000);
cek('§1 omzet sparepart', r.omzetSparepart, 180000);
cek('§1 omzet jasa', r.omzetJasa, 200000);
cek('§1 modal (yang diketahui saja)', r.modal, 70000);
// 130.000 − 70.000, BUKAN 180.000 − 70.000: baris tanpa modal tidak boleh
// menyumbang laba yang tidak pernah dihitung modalnya.
cek('§1 laba dari baris bermodal saja', r.laba, 60000);
cek('§2 baris tanpa modal dihitung', r.tanpaModal, 1);
cek('§2 nilainya ikut disebut', r.omzetTanpaModal, 50000);
cek('§3 jasa tidak dihitung sebagai tanpa-modal', r.omzetTanpaModal, 50000);
// Margin dari omzet bermodal: kalau dari seluruh omzet, makin banyak baris
// korporat tanpa modal, makin kecil marginnya terlihat tanpa ada yang berubah.
cek('§4 margin dari omzet bermodal', r.margin, 46.15);
cek('§4 invoice unik', r.invoice, 2);
cek('§4 tanpa baris: margin null, bukan 0', ringkasPenjualan([]).margin, null);
cek('§4 bukan larik tidak melempar', ringkasPenjualan(null).baris, 0);

// Modal 0 SUNGGUHAN berbeda dari modal tidak diketahui.
const nol = ringkasPenjualan([b({ total: 10000, modal: 0 })]);
cek('§1 modal nol dihitung sebagai diketahui', [nol.tanpaModal, nol.laba], [0, 10000]);

// ===============================================================
console.log('§5 Pengelompokan');
// ===============================================================
const lap = susunLaporanBengkel({ baris: data, periode: { dari: '2026-11-01', sampai: '2026-11-30', outlet: 'Malang' } });
cek('§5 per SKU hanya sparepart', lap.perSku.map((x) => x.kunci), ['A', 'B']);
cek('§5 SKU A menggabungkan dua baris', lap.perSku[0].omzet, 130000);
cek('§5 per nopol juga hanya sparepart', lap.perNopol.map((x) => x.omzet), [180000]);
cek('§5 per sumber', lap.perSumber.map((x) => x.kunci), ['Turboly']);
// Terbesar dulu — yang dibaca lebih dulu harus yang paling berpengaruh.
const urut = kelompok([b({ sku: 'KECIL', total: 1 }), b({ sku: 'BESAR', total: 999 })], (x) => x.sku);
cek('§5 diurutkan omzet terbesar dulu', urut.map((x) => x.kunci), ['BESAR', 'KECIL']);
cek('§5 kunci kosong tidak hilang', kelompok([b({ nopol: '' })], (x) => x.nopol)[0].kunci, '(kosong)');

// ===============================================================
console.log('§6 Catatan');
// ===============================================================
const c = catatanLaporan(r);
benar('§6 menyebut baris tanpa modal beserta nilainya', c.some((x) => /1 baris sparepart belum diketahui modalnya/.test(x) && /Rp50.000/.test(x)), JSON.stringify(c));
benar('§6 menyebut jasa tidak ikut laba', c.some((x) => /[Jj]asa/.test(x)));
benar('§6 catatan ikut ke subjudul', /belum diketahui modalnya/.test(lap.subjudul));
cek('§6 tanpa masalah: tidak ada catatan yang mengada-ada',
  catatanLaporan(ringkasPenjualan([b({ total: 100, modal: 50, nopol: 'N1' })])), []);
cek('§6 rupiah', rupiah(1698000), 'Rp1.698.000');

console.log(`\n${gagal === 0 ? '✅' : '❌'} test-laporan-penjualan-bengkel: ${n - gagal}/${n} lulus`);
process.exit(gagal === 0 ? 0 : 1);
