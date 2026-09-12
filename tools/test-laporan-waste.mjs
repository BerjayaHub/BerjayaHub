/**
 * REKAP WASTE / SPOIL — aturan murni.
 *
 * Yang paling ditekankan KOLOM KETERANGAN. Tanpa ia, rekapnya memuat baris
 * "Beras 1,2 kg" tanpa cara membedakan dua kejadian yang artinya sepenuhnya
 * berbeda — beras karungan kena air (masalah penyimpanan) dan nasi goreng
 * gosong (masalah dapur). Keduanya memotong stok beras; keduanya menuntut
 * tindakan yang berbeda.
 */
import {
  susunRekapWaste,
  keteranganWaste,
  kunciBiaya,
  hargaSatuanBahan,
  KOLOM_WASTE,
  KOLOM_FOTO,
  KET_BAHAN_MENTAH,
  SUMBER_NOTA,
  SUMBER_HPP,
  SUMBER_TIDAK_ADA
} from '../js/modules/inventory/laporan-waste.js';

let gagal = 0;
// `JSON.stringify(Infinity)` adalah "null" — penanda dulu supaya angka tak
// hingga tidak bisa menyamar jadi nilai yang justru diharapkan.
const bertanda = (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? `<<${String(v)}>>` : v);
const tulis = (v) => JSON.stringify(v, bertanda);
const cek = (nama, dapat, harap) => {
  if (tulis(dapat) !== tulis(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${tulis(dapat)}\n   harap : ${tulis(harap)}`);
  }
};

// =====================================================================
// KETERANGAN
// =====================================================================
cek('spoil -> "Bahan mentah"', keteranganWaste({ jenis: 'spoil', sumber_nama: 'Beras' }), KET_BAHAN_MENTAH);
cek(
  'menu -> menyebut nama menunya',
  keteranganWaste({ jenis: 'menu', sumber_nama: 'Nasi Goreng', qty_kejadian: 2 }),
  'Waste menu Nasi Goreng × 2'
);
// Jumlah porsinya ikut karena "Waste menu Nasi Goreng" tidak memberi tahu
// apakah beras 1,2 kg itu dari dua porsi atau dua puluh — dan itu justru yang
// menentukan apakah angkanya masuk akal.
cek(
  'menu tanpa jumlah porsi tetap terbaca',
  keteranganWaste({ jenis: 'menu', sumber_nama: 'Soto' }),
  'Waste menu Soto'
);
cek('menu yang produknya terhapus tetap terbaca', keteranganWaste({ jenis: 'menu' }), 'Waste menu (menu terhapus)');
cek('jenis tak dikenal jatuh ke bahan mentah', keteranganWaste({ jenis: 'entah' }), KET_BAHAN_MENTAH);
cek('baris null tidak melempar', keteranganWaste(null), KET_BAHAN_MENTAH);

// =====================================================================
// BENTUK TABEL
// =====================================================================
const OUT_A = 'outlet-a';
const OUT_B = 'outlet-b';

const baris = [
  {
    waste_id: 'w1',
    outlet_id: OUT_A,
    outlet_nama: 'AB Sentul',
    code: 'WST-260912-AAAA',
    jenis: 'spoil',
    tanggal: '2026-09-10',
    qty_kejadian: 2.5,
    photo_path: 'a/1.jpg',
    notes: 'kena air',
    sumber_nama: 'Beras',
    product_id: 'p-beras',
    bahan_nama: 'Beras',
    bahan_satuan: 'kg',
    bahan_qty: 2.5,
    dicatat_oleh: 'Risma'
  },
  {
    waste_id: 'w2',
    outlet_id: OUT_A,
    outlet_nama: 'AB Sentul',
    code: 'WST-260912-BBBB',
    jenis: 'menu',
    tanggal: '2026-09-12',
    qty_kejadian: 2,
    photo_path: 'a/2.jpg',
    notes: '',
    sumber_nama: 'Nasi Goreng',
    product_id: 'p-beras',
    bahan_nama: 'Beras',
    bahan_satuan: 'kg',
    bahan_qty: 0.4,
    dicatat_oleh: 'Adhe'
  },
  {
    waste_id: 'w2',
    outlet_id: OUT_A,
    outlet_nama: 'AB Sentul',
    code: 'WST-260912-BBBB',
    jenis: 'menu',
    tanggal: '2026-09-12',
    qty_kejadian: 2,
    photo_path: 'a/2.jpg',
    notes: '',
    sumber_nama: 'Nasi Goreng',
    product_id: 'p-telur',
    bahan_nama: 'Telur',
    bahan_satuan: 'butir',
    bahan_qty: 2,
    dicatat_oleh: 'Adhe'
  }
];

const biaya = new Map([
  [kunciBiaya(OUT_A, 'p-beras'), 14000],
  [kunciBiaya(OUT_A, 'p-telur'), 2500]
]);

const lap = susunRekapWaste({ baris, biaya, periode: { dari: '2026-09-01', sampai: '2026-09-12', outlet: 'Semua outlet' } });

cek('tiga baris bahan', lap.ringkas.jumlahBaris, 3);
cek('dari dua kejadian', lap.ringkas.jumlahKejadian, 2);
cek('total = 35.000 + 5.600 + 5.000', lap.ringkas.total, 45600);
cek('semua baris punya nilai', lap.ringkas.tanpaNilai, 0);

// Kolomnya harus sama dengan yang dipakai layar dan ekspor.
cek('kolomnya sama dengan yang diekspor', lap.kolom, KOLOM_WASTE);
cek('urutan kolom', lap.kolom.map((k) => k.header), [
  'Tanggal',
  'Outlet',
  'Bahan',
  'Jumlah',
  'Satuan',
  'Nilai',
  'Sumber nilai',
  'Keterangan',
  'Catatan',
  'Dicatat oleh',
  'No.',
  'Foto'
]);
cek('tepat satu kolom foto', KOLOM_WASTE.filter((k) => k.foto).length, 1);
cek('KOLOM_FOTO menunjuk kolom terakhir', KOLOM_FOTO, KOLOM_WASTE.length - 1);
// Justru menjumlahkan yang jadi alasan orang minta xlsx, bukan PDF.
cek('kolom Nilai numeric', KOLOM_WASTE[5].numeric, true);
cek('kolom Jumlah numeric', KOLOM_WASTE[3].numeric, true);

// Urut TERBARU dulu: rekap waste dibaca untuk ditindaklanjuti.
cek('baris terbaru di atas', lap.baris[0][0], '2026-09-12');
cek('baris terlama di bawah', lap.baris[2][0], '2026-09-10');

const barisMenu = lap.baris.find((r) => r[2] === 'Beras' && r[0] === '2026-09-12');
cek('keterangan menu di barisnya', barisMenu[7], 'Waste menu Nasi Goreng × 2');
const barisSpoil = lap.baris.find((r) => r[0] === '2026-09-10');
cek('keterangan spoil di barisnya', barisSpoil[7], KET_BAHAN_MENTAH);
cek('sumber nilainya disebut', barisSpoil[6], SUMBER_NOTA);
cek('catatan ikut', barisSpoil[8], 'kena air');
cek('pencatatnya ikut', barisSpoil[9], 'Risma');
cek('nomornya ikut', barisSpoil[10], 'WST-260912-AAAA');

// Sel foto SENGAJA kosong: modul murni tidak menyentuh jaringan, dan mengubah
// path jadi data URL berarti mengunduh gambarnya.
cek('sel foto dibiarkan kosong untuk diisi layar', barisSpoil[KOLOM_FOTO], null);
cek('path fotonya ada di meta, sejajar indeksnya', lap.meta[0].photoPath, 'a/2.jpg');
cek('meta sepanjang barisnya', lap.meta.length, lap.baris.length);

// =====================================================================
// NILAI YANG BELUM ADA — "-" BUKAN Rp0
//
// Rp0 membuat total kerugian terlihat lebih kecil daripada yang sebenarnya,
// dan itu tidak akan tampak salah.
// =====================================================================
const tanpaBiaya = susunRekapWaste({ baris, biaya: new Map([[kunciBiaya(OUT_A, 'p-beras'), 14000]]) });
cek('baris tanpa biaya dihitung', tanpaBiaya.ringkas.tanpaNilai, 1);
cek('totalnya hanya yang punya biaya', tanpaBiaya.ringkas.total, 40600);
cek('selnya "-" bukan Rp0', tanpaBiaya.baris.find((r) => r[2] === 'Telur')[5], '-');
cek('sumbernya ditulis "-" juga', tanpaBiaya.baris.find((r) => r[2] === 'Telur')[6], SUMBER_TIDAK_ADA);
cek('subjudul menyebutnya', /1 baris belum punya harga sama sekali/.test(tanpaBiaya.subjudul), true);

// =====================================================================
// HPP RESEP SEBAGAI CADANGAN
//
// Barang setengah jadi TIDAK PERNAH DIBELI — ia diproduksi. "Danish Cinnamon
// (WIP)" punya HPP Rp6.764/porsi di Master Produk dan nol baris biaya
// rata-rata. Versi pertama laporan ini cuma melihat sumber pertama, jadi
// seluruh barang produksi berbunyi "-" sementara layar sebelah menampilkan
// angkanya dengan jelas.
// =====================================================================
cek(
  'nota menang atas HPP — itu yang benar-benar dibayar',
  hargaSatuanBahan(OUT_A, 'p-beras', biaya, new Map([['p-beras', 99999]])),
  { nilai: 14000, sumber: SUMBER_NOTA }
);
cek(
  'tanpa nota, HPP dipakai',
  hargaSatuanBahan(OUT_A, 'p-wip', new Map(), new Map([['p-wip', 6764]])),
  { nilai: 6764, sumber: SUMBER_HPP }
);
cek('tanpa keduanya -> null, bukan 0', hargaSatuanBahan(OUT_A, 'p-x', new Map(), new Map()), {
  nilai: null,
  sumber: SUMBER_TIDAK_ADA
});
// Harga 0 sah (bahan bonus) dan tidak boleh jatuh ke HPP.
cek('biaya nota 0 tetap menang atas HPP', hargaSatuanBahan(OUT_A, 'p-b', new Map([[kunciBiaya(OUT_A, 'p-b'), 0]]), new Map([['p-b', 5000]])), {
  nilai: 0,
  sumber: SUMBER_NOTA
});

const wip = [{ ...baris[0], waste_id: 'w7', product_id: 'p-wip', bahan_nama: 'Danish Cinnamon (WIP)', bahan_qty: 5, bahan_satuan: 'porsi' }];
const lapWip = susunRekapWaste({ baris: wip, biaya, hpp: new Map([['p-wip', 6764]]) });
cek('barang produksi tidak lagi "-"', lapWip.baris[0][5] !== '-', true);
cek('nilainya 5 x 6.764', lapWip.ringkas.total, 33820);
cek('sumbernya disebut HPP', lapWip.baris[0][6], SUMBER_HPP);
cek('jumlah baris ber-HPP dihitung', lapWip.ringkas.dariHpp, 1);
cek('subjudul menyebut campurannya', /1 baris dinilai pakai HPP resep/.test(lapWip.subjudul), true);
cek('tidak ikut dihitung sebagai tanpa harga', lapWip.ringkas.tanpaNilai, 0);

// Biaya 0 adalah angka yang SAH (bahan bonus). Kalau `??` jadi `||`, nol
// terbaca "belum ada" dan barisnya salah ditandai.
const biayaNol = susunRekapWaste({ baris: [baris[0]], biaya: new Map([[kunciBiaya(OUT_A, 'p-beras'), 0]]) });
cek('biaya 0 tetap dianggap ada', biayaNol.ringkas.tanpaNilai, 0);
cek('biaya 0 tidak ditulis "-"', biayaNol.baris[0][5] !== '-', true);

// =====================================================================
// BIAYA BERBEDA PER OUTLET (0118)
//
// Harga beli beras di Sentul bukan harga beli beras di Serpong. Kunci yang
// hanya berisi product_id akan memakai angka outlet lain — dan angkanya tetap
// masuk akal, jadi tidak ada yang memeriksanya.
// =====================================================================
const barisOutletLain = [{ ...baris[0], waste_id: 'w9', outlet_id: OUT_B, outlet_nama: 'AB Serpong' }];
const lintas = susunRekapWaste({ baris: barisOutletLain, biaya });
cek('biaya outlet lain TIDAK dipakai', lintas.ringkas.tanpaNilai, 1);
cek('kunci biaya memuat outlet', kunciBiaya('o1', 'p1'), 'o1|p1');

// =====================================================================
// CATATAN SEBELUM FOTO DIWAJIBKAN (0136)
//
// "belum ada foto" menuduh staffnya lupa. Catatan ini dibuat sebelum fotonya
// diwajibkan, jadi fotonya tidak pernah ada — dan layar harus bisa mengatakan
// yang mana, bukan menampilkan sel kosong yang sama untuk keduanya.
// =====================================================================
const campurLama = susunRekapWaste({
  baris: [
    { ...baris[0], lama: true, photo_path: null },
    { ...baris[1], lama: false }
  ],
  biaya
});
cek('baris lama dihitung', campurLama.ringkas.barisLama, 1);
cek('subjudul menyebutnya', /1 baris dicatat sebelum foto diwajibkan/.test(campurLama.subjudul), true);
const metaLama = campurLama.meta.find((m) => m.lama);
cek('meta membawa penanda lama', !!metaLama, true);
cek('meta baris lama tanpa path foto', metaLama.photoPath, '');
cek('baris baru TIDAK ikut ditandai lama', campurLama.meta.filter((m) => m.lama).length, 1);
// `lama` hanya boleh true kalau memang `true` — bukan karena kolomnya belum
// ada (jalur cadangan saat 0136 belum dijalankan mengirim `undefined`).
cek('kolom `lama` yang belum ada tidak dianggap lama', susunRekapWaste({ baris: [baris[0]] }).ringkas.barisLama, 0);

// =====================================================================
// MASUKAN RUSAK
// =====================================================================
const kosong = susunRekapWaste({});
cek('tanpa argumen: nol baris', kosong.ringkas.jumlahBaris, 0);
cek('tanpa argumen: total 0', kosong.ringkas.total, 0);
cek('nama berkasnya tetap aman', /^waste-spoil-/.test(kosong.namaBerkas), true);
cek(
  'nama berkas dibersihkan dari karakter berbahaya',
  susunRekapWaste({ periode: { dari: '2026/09/01', sampai: '2026/09/12' } }).namaBerkas,
  'waste-spoil-2026-09-01-s-d-2026-09-12'
);

const produkHilang = susunRekapWaste({ baris: [{ ...baris[0], bahan_nama: null }] });
cek('produk terhapus tetap muncul', produkHilang.baris[0][2], '(produk terhapus)');

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log(
  'Rekap waste/spoil benar untuk 56 kasus — termasuk keterangan per jenis, biaya per outlet, ' +
    'HPP resep sebagai cadangan untuk barang produksi, dan catatan sebelum foto diwajibkan. ✅'
);
