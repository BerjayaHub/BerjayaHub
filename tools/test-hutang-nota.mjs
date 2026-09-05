/**
 * Aturan hutang supplier (0122) — modul murni.
 *
 * Yang dijaga di sini adalah hal-hal yang KELIHATAN benar kalau salah:
 * total hutang yang diam-diam memuat nota lunas, tombol Bayar yang menyala
 * untuk nota yang barisnya belum berharga, dan urutan yang menaruh tagihan
 * paling mendesak di bawah layar.
 */
import { statusTempo, bolehDibayar, kelompokPerSupplier, ringkasTempo, TANPA_SUPPLIER } from '../js/modules/inventory/hutang-nota.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};

const HARI = '2026-09-05';
const nota = (o) => ({
  id: o.id ?? o.code,
  code: o.code,
  supplier: o.supplier ?? 'Gerobak Telur',
  outlet_id: o.outlet ?? 'OUT-1',
  payment_status: o.status ?? 'belum',
  due_date: o.due ?? null,
  total: o.total ?? 0,
  baris_tanpa_harga: o.kurang ?? 0
});

// ---------------------------------------------------------------
// 1. statusTempo
// ---------------------------------------------------------------
cek('1 lunas menang atas tanggal apa pun', statusTempo(nota({ code: 'A', status: 'lunas', due: '2020-01-01' }), HARI), 'lunas');
cek('1 lewat tempo', statusTempo(nota({ code: 'A', due: '2026-09-04' }), HARI), 'terlambat');
cek('1 tepat hari ini BUKAN terlambat', statusTempo(nota({ code: 'A', due: HARI }), HARI), 'hari-ini');
cek('1 besok', statusTempo(nota({ code: 'A', due: '2026-09-06' }), HARI), 'akan-datang');
cek('1 tanpa tempo bukan berarti lunas', statusTempo(nota({ code: 'A' }), HARI), 'tanpa-tempo');

// ---------------------------------------------------------------
// 2. bolehDibayar
// ---------------------------------------------------------------
cek('2 kosong ditolak', bolehDibayar([]).boleh, false);
cek('2 satu nota berharga lengkap boleh', bolehDibayar([nota({ code: 'A', total: 300000 })]), {
  boleh: true,
  alasan: null,
  total: 300000
});

// HARGA 0 SAH. Barang bonus/sampel memang bernilai nol; yang ditolak adalah
// harga yang BELUM DIISI. Membedakan keduanya adalah inti aturan ini —
// `Number('')` dan `Number(null)` sama-sama 0, dan itu sudah menggigit
// berkali-kali di repo ini.
cek('2 total 0 dengan harga terisi tetap boleh dibayar', bolehDibayar([nota({ code: 'A', total: 0, kurang: 0 })]).boleh, true);
cek('2 baris tanpa harga menolak', bolehDibayar([nota({ code: 'A', total: 5000, kurang: 1 })]).boleh, false);
cek(
  '2 alasannya menyebut nota mana',
  bolehDibayar([nota({ code: 'TRM-01', kurang: 2 }), nota({ code: 'TRM-02' })]).alasan.includes('TRM-01'),
  true
);
cek('2 nota yang sudah lunas ikut tercentang -> ditolak', bolehDibayar([nota({ code: 'A', status: 'lunas' })]).boleh, false);
cek(
  '2 dua outlet ditolak',
  bolehDibayar([nota({ code: 'A', outlet: 'OUT-1' }), nota({ code: 'B', outlet: 'OUT-2' })]).boleh,
  false
);
cek('2 totalnya dijumlahkan', bolehDibayar([nota({ code: 'A', total: 1000 }), nota({ code: 'B', total: 2500 })]).total, 3500);

// ---------------------------------------------------------------
// 3. kelompokPerSupplier
// ---------------------------------------------------------------
const daftar = [
  nota({ code: 'A', supplier: 'Pasar Modern', total: 100000, due: '2026-09-20' }),
  nota({ code: 'B', supplier: 'Pasar Modern', total: 50000, due: '2026-09-10' }),
  nota({ code: 'C', supplier: 'Gerobak Telur', total: 700000, due: '2026-09-01' }), // terlambat
  nota({ code: 'D', supplier: 'Toko Beras', total: 900000 }), // tanpa tempo
  nota({ code: 'E', supplier: 'Pasar Modern', total: 999999, status: 'lunas' }), // TIDAK boleh ikut
  nota({ code: 'F', supplier: '   ', total: 25000 })
];
const grup = kelompokPerSupplier(daftar, HARI);

cek('3 supplier yang punya tunggakan terlambat di paling atas', grup[0].supplier, 'Gerobak Telur');
cek('3 tanpa tempo diletakkan setelah yang bertempo', grup[grup.length - 1].supplier, 'Toko Beras');
cek(
  '3 total per supplier TIDAK memuat nota lunas',
  grup.find((g) => g.supplier === 'Pasar Modern').total,
  150000
);
cek(
  '3 nota lunas juga tidak ikut dihitung barisnya',
  grup.find((g) => g.supplier === 'Pasar Modern').notas.length,
  2
);
cek('3 supplier kosong diberi nama yang bisa dibaca', grup.some((g) => g.supplier === TANPA_SUPPLIER), true);

// BEDA HURUF BESAR-KECIL BUKAN DUA SUPPLIER.
//
// Terlihat di layar: "Mitra Plastik" dan "Mitra plastik" jadi dua kartu dengan
// dua total terpisah, dan orang yang menagih membawa angka yang kurang tanpa
// satu pun tanda bahwa sisanya ada beberapa baris di bawah.
const ejaan = kelompokPerSupplier(
  [
    nota({ code: 'X1', supplier: 'Mitra Plastik', total: 100000 }),
    nota({ code: 'X2', supplier: 'Mitra plastik', total: 25000 }),
    nota({ code: 'X3', supplier: '  mitra plastik  ', total: 5000 })
  ],
  HARI
);
cek('3 beda huruf besar-kecil & spasi tetap satu supplier', ejaan.length, 1);
cek('3 totalnya digabung', ejaan[0].total, 130000);
cek('3 ejaan yang ditampilkan yang pertama ditemui', ejaan[0].supplier, 'Mitra Plastik');
cek(
  '3 tempo terdekat per supplier, bukan yang terakhir dilihat',
  grup.find((g) => g.supplier === 'Pasar Modern').tempoTerdekat,
  '2026-09-10'
);
cek('3 supplier tanpa tempo: tempoTerdekat null, bukan string kosong', grup.find((g) => g.supplier === 'Toko Beras').tempoTerdekat, null);

// ---------------------------------------------------------------
// 4. ringkasTempo
// ---------------------------------------------------------------
const r = ringkasTempo(
  [
    nota({ code: 'A', due: '2026-09-01', total: 10000 }),
    nota({ code: 'B', due: HARI, total: 20000 }),
    nota({ code: 'C', due: '2026-12-01', total: 30000 }),
    nota({ code: 'D', due: '2020-01-01', total: 777, status: 'lunas' })
  ],
  HARI
);
cek('4 lencana: terlambat, hari ini, dan total hutang', [r.terlambat, r.hariIni, r.totalHutang], [1, 1, 60000]);

// Data kosong/aneh tidak boleh melempar: layar yang gagal memuat karena satu
// baris rusak jauh lebih buruk daripada angka yang kurang satu.
cek('4 null aman', ringkasTempo(null, HARI), { terlambat: 0, hariIni: 0, totalHutang: 0 });
cek('4 kelompok dari null aman', kelompokPerSupplier(null, HARI), []);

if (gagal === 0) console.log('Aturan hutang supplier: 4 bagian LULUS. ✅');
process.exit(gagal === 0 ? 0 : 1);
