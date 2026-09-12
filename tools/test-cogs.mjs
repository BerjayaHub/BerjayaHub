/**
 * COGS — stok awal + pembelian − stok akhir.
 *
 * Yang paling ditekankan: OPNAME YANG TIDAK ADA. Rumusnya cuma tiga angka, dan
 * dua di antaranya dari opname. Kalau salah satunya diperlakukan nol:
 *
 *   stok akhir hilang -> COGS melonjak sebesar seluruh nilai stok
 *   stok awal hilang  -> COGS anjlok, bisa jadi negatif
 *
 * Dua-duanya menghasilkan angka yang masih terbaca masuk akal di laporan
 * bulanan — tidak ada error, tidak ada baris kosong, cuma angka yang salah
 * besar. Itu bentuk kegagalan yang paling mahal di berkas ini.
 */
import {
  nilaiOpname,
  barisCogs,
  ringkasCogs,
  SEBAB_TANPA_AWAL,
  SEBAB_TANPA_AKHIR,
  SEBAB_TANPA_KEDUANYA
} from '../js/modules/report/cogs.js';

let gagal = 0;
const bertanda = (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? `<<${String(v)}>>` : v);
const tulis = (v) => JSON.stringify(v, bertanda);
const cek = (nama, dapat, harap) => {
  if (tulis(dapat) !== tulis(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${tulis(dapat)}\n   harap : ${tulis(harap)}`);
  }
};

// =====================================================================
// NILAI OPNAME = Σ (dihitung × HPP)
// =====================================================================
const hpp = new Map([
  ['beras', 14000],
  ['telur', 2500],
  ['bonus', 0]
]);

cek(
  'nilai = dihitung × HPP',
  nilaiOpname([{ product_id: 'beras', counted_qty: 10 }, { product_id: 'telur', counted_qty: 4 }], hpp),
  { nilai: 150000, tanpaHpp: 0, jumlahItem: 2 }
);

// HPP 0 adalah angka yang SAH (bahan bonus). Kalau `??` jadi `||`, nol terbaca
// "belum punya harga" dan barisnya salah dilaporkan kurang.
cek('HPP 0 dipakai apa adanya, bukan dianggap kosong', nilaiOpname([{ product_id: 'bonus', counted_qty: 99 }], hpp), {
  nilai: 0,
  tanpaHpp: 0,
  jumlahItem: 1
});

// Bahan tanpa HPP TIDAK dihitung nol diam-diam — jumlahnya dilaporkan, karena
// nilainya yang hilang membuat stok akhir lebih kecil dan COGS lebih besar.
cek('bahan tanpa HPP dilaporkan', nilaiOpname([{ product_id: 'baru', counted_qty: 5 }], hpp), {
  nilai: 0,
  tanpaHpp: 1,
  jumlahItem: 1
});
cek('yang dihitung nol tanpa HPP bukan kekurangan', nilaiOpname([{ product_id: 'baru', counted_qty: 0 }], hpp), {
  nilai: 0,
  tanpaHpp: 0,
  jumlahItem: 1
});
cek('qty berbentuk teks tetap terhitung', nilaiOpname([{ product_id: 'beras', counted_qty: '2,5'.replace(',', '.') }], hpp).nilai, 35000);
cek('items null tidak melempar', nilaiOpname(null, hpp), { nilai: 0, tanpaHpp: 0, jumlahItem: 0 });
cek('tanpa peta HPP tidak melempar', nilaiOpname([{ product_id: 'beras', counted_qty: 1 }]), {
  nilai: 0,
  tanpaHpp: 1,
  jumlahItem: 1
});

// =====================================================================
// RUMUSNYA
// =====================================================================
const lengkap = barisCogs({
  awal: { tanggal: '2026-08-31', nilai: 5000000 },
  akhir: { tanggal: '2026-09-30', nilai: 4000000 },
  pembelian: 12000000
});
cek('COGS = 5jt + 12jt − 4jt', lengkap.cogs, 13000000);
cek('bisa dihitung', lengkap.bisaDihitung, true);
cek('tanggal opnamenya ikut', [lengkap.tanggalAwal, lengkap.tanggalAkhir], ['2026-08-31', '2026-09-30']);
cek('tanpa catatan kalau lengkap', lengkap.catatan, '');

// Stok naik -> COGS lebih kecil dari pembelian. Arahnya mudah terbalik, dan
// kalau terbalik laporannya tetap terlihat wajar.
const menumpuk = barisCogs({
  awal: { tanggal: '2026-08-31', nilai: 1000000 },
  akhir: { tanggal: '2026-09-30', nilai: 3000000 },
  pembelian: 5000000
});
cek('stok bertambah -> COGS < pembelian', menumpuk.cogs, 3000000);

// =====================================================================
// OPNAME YANG TIDAK ADA -> null, BUKAN NOL
// =====================================================================
const tanpaAkhir = barisCogs({ awal: { tanggal: '2026-08-31', nilai: 5000000 }, pembelian: 12000000 });
cek('tanpa stok akhir: TIDAK dihitung', tanpaAkhir.cogs, null);
cek('dan bukan 0', tanpaAkhir.cogs !== 0, true);
// Kalau akhirnya dianggap nol, angkanya jadi 17jt — masih terbaca masuk akal.
cek('bukan diam-diam jadi awal + beli', tanpaAkhir.cogs !== 17000000, true);
cek('sebabnya disebut', tanpaAkhir.catatan, SEBAB_TANPA_AKHIR);
cek('bisaDihitung false', tanpaAkhir.bisaDihitung, false);

const tanpaAwal = barisCogs({ akhir: { tanggal: '2026-09-30', nilai: 4000000 }, pembelian: 1000000 });
cek('tanpa stok awal: TIDAK dihitung', tanpaAwal.cogs, null);
// Kalau awalnya dianggap nol, angkanya jadi −3jt: COGS negatif yang tidak
// mungkin, tapi tetap tercetak rapi di laporan.
cek('tidak jadi angka negatif yang mustahil', tanpaAwal.cogs !== -3000000, true);
cek('sebabnya disebut', tanpaAwal.catatan, SEBAB_TANPA_AWAL);

const kosong = barisCogs({ pembelian: 500000 });
cek('tanpa keduanya: satu kalimat, bukan dua', kosong.catatan, SEBAB_TANPA_KEDUANYA);
cek('pembeliannya tetap dicatat apa adanya', kosong.pembelian, 500000);

const tanpaArgumen = barisCogs();
cek('tanpa argumen tidak melempar', tanpaArgumen.cogs, null);
cek('pembelian bawaannya 0', tanpaArgumen.pembelian, 0);

// Bahan tanpa HPP membuat nilai opnamenya lebih kecil — disebut, bukan didiamkan.
const adaYangKosong = barisCogs({
  awal: { tanggal: '2026-08-31', nilai: 1000000, tanpaHpp: 2 },
  akhir: { tanggal: '2026-09-30', nilai: 900000, tanpaHpp: 3 },
  pembelian: 0
});
cek('bahan tanpa HPP dijumlahkan di catatannya', adaYangKosong.catatan, '5 bahan belum punya HPP');
cek('tapi COGS-nya tetap dihitung', adaYangKosong.cogs, 100000);

// =====================================================================
// TOTAL
// =====================================================================
const semua = [
  barisCogs({ awal: { tanggal: 'a', nilai: 100 }, akhir: { tanggal: 'b', nilai: 60 }, pembelian: 50 }),
  barisCogs({ awal: { tanggal: 'a', nilai: 200 }, akhir: { tanggal: 'b', nilai: 150 }, pembelian: 70 }),
  // Outlet ini belum opname — TIDAK boleh ikut ke total mana pun.
  barisCogs({ pembelian: 999 })
];
const total = ringkasCogs(semua);
cek('COGS total hanya dari yang terhitung', total.cogs, 90 + 120);
// Pembelian outlet yang tidak terhitung TIDAK ikut. Menjumlahkannya membuat
// total tidak konsisten dengan barisnya sendiri, dan yang membacanya akan
// mengira ada kesalahan penjumlahan.
cek('pembelian outlet tak terhitung tidak ikut', total.pembelian, 120);
cek('stok awal total', total.awal, 300);
cek('stok akhir total', total.akhir, 210);
cek('jumlah outlet terhitung', total.outletTerhitung, 2);
cek('jumlah outlet terlewat disebut', total.outletTerlewat, 1);
cek('konsisten: awal + beli − akhir = cogs', total.awal + total.pembelian - total.akhir, total.cogs);

cek('daftar kosong tidak melempar', ringkasCogs([]), {
  awal: 0,
  pembelian: 0,
  akhir: 0,
  cogs: 0,
  outletTerhitung: 0,
  outletTotal: 0,
  outletTerlewat: 0
});
cek('argumen bukan array tidak melempar', ringkasCogs(null).cogs, 0);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('COGS benar untuk 31 kasus — termasuk opname yang tidak ada, yang menghasilkan "-" bukan angka yang salah besar. ✅');
