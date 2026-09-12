/**
 * COGS — stok awal + pembelian − stok akhir.
 *
 * ============ CACAT YANG MELAHIRKAN BENTUK INI ============
 *
 * Versi pertama memakai nilai SATU SESI opname sebagai stok akhir. Sesi opname
 * hanya berisi bahan yang dihitung DI SESI ITU:
 *
 *   "jika ada salah jumlah bahan, saya akan buka sesi opname lagi, dan yang
 *    terisi hanya bahan yang salah saja, jadi nominalnya akan sangat kecil"
 *
 * Sesi perbaikan berisi satu bahan; nilainya Rp54.701 dipakai sebagai "nilai
 * seluruh stok outlet" — salah beberapa ratus kali lipat, dan tetap tercetak
 * rapi di laporan bulanan.
 *
 * Sekarang stoknya dari SALDO pada tanggal itu, yang mencakup semua bahan dan
 * sudah memuat hasil tiap opname (menutup opname menulis penyesuaian ke
 * pergerakan stok).
 */
import {
  nilaiStok,
  barisCogs,
  ringkasCogs,
  PERINGATAN_AWAL_TANPA_OPNAME,
  PERINGATAN_AKHIR_TANPA_OPNAME
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
// NILAI SALDO = Σ (qty × HPP)
// =====================================================================
const hpp = new Map([
  ['beras', 14000],
  ['telur', 2500],
  ['bonus', 0]
]);

cek('nilai = saldo × HPP', nilaiStok([{ product_id: 'beras', qty: 10 }, { product_id: 'telur', qty: 4 }], hpp), {
  nilai: 150000,
  tanpaHpp: 0,
  jumlahItem: 2
});

// Saldo NEGATIF ikut mengurangi. Stok boleh menembus nol di aplikasi ini
// (0020/0134); membuangnya membuat nilai stok lebih besar dari kenyataan.
cek('saldo negatif ikut mengurangi', nilaiStok([{ product_id: 'beras', qty: -2 }], hpp).nilai, -28000);

// HPP 0 adalah angka yang SAH (bahan bonus). Kalau `??` jadi `||`, nol terbaca
// "belum punya harga" dan barisnya salah dilaporkan kurang.
cek('HPP 0 dipakai apa adanya', nilaiStok([{ product_id: 'bonus', qty: 99 }], hpp), { nilai: 0, tanpaHpp: 0, jumlahItem: 1 });

// Bahan tanpa HPP TIDAK dihitung nol diam-diam — nilainya yang hilang
// menggeser COGS tanpa satu pun tanda di angkanya.
cek('bahan tanpa HPP dilaporkan', nilaiStok([{ product_id: 'baru', qty: 5 }], hpp), { nilai: 0, tanpaHpp: 1, jumlahItem: 1 });
cek('saldo nol tanpa HPP bukan kekurangan', nilaiStok([{ product_id: 'baru', qty: 0 }], hpp), {
  nilai: 0,
  tanpaHpp: 0,
  jumlahItem: 1
});
cek('qty pecahan terhitung', nilaiStok([{ product_id: 'beras', qty: 2.5 }], hpp).nilai, 35000);
cek('saldo null tidak melempar', nilaiStok(null, hpp), { nilai: 0, tanpaHpp: 0, jumlahItem: 0 });
cek('tanpa peta HPP tidak melempar', nilaiStok([{ product_id: 'beras', qty: 1 }]), { nilai: 0, tanpaHpp: 1, jumlahItem: 1 });

// =====================================================================
// RUMUSNYA
// =====================================================================
const OPN_A = { tanggal: '2026-08-31' };
const OPN_B = { tanggal: '2026-09-30' };

const lengkap = barisCogs({
  awal: { nilai: 5000000 },
  akhir: { nilai: 4000000 },
  pembelian: 12000000,
  opnameAwal: OPN_A,
  opnameAkhir: OPN_B
});
cek('COGS = 5jt + 12jt − 4jt', lengkap.cogs, 13000000);
cek('tanggal opnamenya ikut', [lengkap.tanggalAwal, lengkap.tanggalAkhir], ['2026-08-31', '2026-09-30']);
cek('dua ujungnya dikunci opname', lengkap.terkunci, true);
cek('tanpa catatan kalau lengkap', lengkap.catatan, '');

// Stok naik -> COGS lebih kecil dari pembelian. Arahnya mudah terbalik, dan
// kalau terbalik laporannya tetap terlihat wajar.
const menumpuk = barisCogs({
  awal: { nilai: 1000000 },
  akhir: { nilai: 3000000 },
  pembelian: 5000000,
  opnameAwal: OPN_A,
  opnameAkhir: OPN_B
});
cek('stok bertambah -> COGS < pembelian', menumpuk.cogs, 3000000);

// =====================================================================
// SESI PERBAIKAN TIDAK LAGI MERUSAK ANGKANYA
//
// Inti perbaikannya. Stok akhir datang dari SALDO seluruh bahan, jadi sesi
// opname yang hanya berisi satu bahan tidak punya jalan mempengaruhinya.
// =====================================================================
const saldoLengkap = [
  { product_id: 'beras', qty: 1000 },
  { product_id: 'telur', qty: 400 },
  { product_id: 'bonus', qty: 50 }
];
const akhirSaldo = nilaiStok(saldoLengkap, hpp);
cek('saldo seluruh bahan dinilai utuh', akhirSaldo.nilai, 1000 * 14000 + 400 * 2500);

// Sesi perbaikan berisi SATU bahan. Kalau ia yang dipakai, stok akhirnya
// Rp54.701-an — dan COGS melonjak sebesar hampir seluruh nilai stok.
const sesiPerbaikan = nilaiStok([{ product_id: 'telur', qty: 4 }], hpp);
cek('nilai sesi perbaikan memang kecil', sesiPerbaikan.nilai, 10000);
const benar = barisCogs({ awal: { nilai: 0 }, akhir: akhirSaldo, pembelian: 0, opnameAwal: OPN_A, opnameAkhir: OPN_B });
const salahKalauPakaiSesi = barisCogs({ awal: { nilai: 0 }, akhir: sesiPerbaikan, pembelian: 0 });
cek(
  'memakai saldo, bukan sesi: selisihnya besar dan itu yang dicegah',
  benar.cogs !== salahKalauPakaiSesi.cogs && Math.abs(salahKalauPakaiSesi.cogs - benar.cogs) > 14000000,
  true
);

// =====================================================================
// TANPA OPNAME: TETAP DIHITUNG, TAPI DIKATAKAN
//
// Saldo selalu ada, jadi COGS selalu bisa dihitung — tapi angkanya hanya
// sebaik pencatatannya sampai ada opname yang menguncinya. Perbedaan itu TIDAK
// terlihat dari angkanya sendiri.
// =====================================================================
const tanpaAkhir = barisCogs({ awal: { nilai: 5000000 }, akhir: { nilai: 4000000 }, pembelian: 1000000, opnameAwal: OPN_A });
cek('tetap dihitung tanpa opname akhir', tanpaAkhir.cogs, 2000000);
cek('tapi tidak dianggap terkunci', tanpaAkhir.terkunci, false);
cek('dan sebabnya disebut', tanpaAkhir.catatan, PERINGATAN_AKHIR_TANPA_OPNAME);
cek('tanggalnya kosong, bukan tanggal palsu', tanpaAkhir.tanggalAkhir, '');

const tanpaAwal = barisCogs({ awal: { nilai: 1000000 }, akhir: { nilai: 900000 }, pembelian: 0, opnameAkhir: OPN_B });
cek('peringatan awal disebut', tanpaAwal.catatan, PERINGATAN_AWAL_TANPA_OPNAME);

const belumPernah = barisCogs({ awal: { nilai: 0 }, akhir: { nilai: 0 }, pembelian: 500000 });
cek('dua peringatan sekaligus', belumPernah.catatan, `${PERINGATAN_AWAL_TANPA_OPNAME}; ${PERINGATAN_AKHIR_TANPA_OPNAME}`);
cek('outlet baru: COGS = pembeliannya', belumPernah.cogs, 500000);

const tanpaArgumen = barisCogs();
cek('tanpa argumen tidak melempar', tanpaArgumen.cogs, 0);
cek('pembelian bawaannya 0', tanpaArgumen.pembelian, 0);

// Bahan tanpa HPP menggeser nilainya — disebut, bukan didiamkan.
const adaYangKosong = barisCogs({
  awal: { nilai: 1000000, tanpaHpp: 2 },
  akhir: { nilai: 900000, tanpaHpp: 3 },
  pembelian: 0,
  opnameAwal: OPN_A,
  opnameAkhir: OPN_B
});
cek('bahan tanpa HPP dijumlahkan di catatannya', adaYangKosong.catatan, '5 bahan belum punya HPP');
cek('tapi COGS-nya tetap dihitung', adaYangKosong.cogs, 100000);

// =====================================================================
// TOTAL
//
// SEMUA outlet ikut. Membuang baris yang belum terkunci akan membuat total
// tidak sama dengan jumlah kolomnya sendiri, dan yang membacanya akan mengira
// ada kesalahan penjumlahan.
// =====================================================================
const semua = [
  barisCogs({ awal: { nilai: 100 }, akhir: { nilai: 60 }, pembelian: 50, opnameAwal: OPN_A, opnameAkhir: OPN_B }),
  barisCogs({ awal: { nilai: 200 }, akhir: { nilai: 150 }, pembelian: 70, opnameAwal: OPN_A, opnameAkhir: OPN_B }),
  barisCogs({ awal: { nilai: 10 }, akhir: { nilai: 5 }, pembelian: 999 }) // belum pernah opname
];
const total = ringkasCogs(semua);
cek('semua outlet ikut ke total', total.cogs, 90 + 120 + 1004);
cek('pembelian semua outlet ikut', total.pembelian, 50 + 70 + 999);
cek('stok awal total', total.awal, 310);
cek('stok akhir total', total.akhir, 215);
cek('konsisten: awal + beli − akhir = cogs', total.awal + total.pembelian - total.akhir, total.cogs);
cek('berapa yang terkunci disebut', total.outletTerkunci, 2);
cek('berapa yang belum terkunci disebut', total.outletBelumTerkunci, 1);
cek('jumlah outlet', total.outletTotal, 3);

cek('daftar kosong tidak melempar', ringkasCogs([]), {
  awal: 0,
  pembelian: 0,
  akhir: 0,
  cogs: 0,
  outletTotal: 0,
  outletTerkunci: 0,
  outletBelumTerkunci: 0
});
cek('argumen bukan array tidak melempar', ringkasCogs(null).cogs, 0);

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('COGS benar untuk 36 kasus — stoknya dari saldo, jadi sesi opname perbaikan tidak bisa merusak angkanya. ✅');
