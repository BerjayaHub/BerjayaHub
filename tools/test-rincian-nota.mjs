/**
 * TES `js/modules/inventory/rincian-nota.js`.
 *
 * ============ YANG PALING PERLU DIJAGA ============
 *
 * TOTAL YANG RAPI TAPI SALAH. Dialog ini dibuka justru saat orang sedang
 * menyandingkan pengeluaran kasnya dengan tagihan supplier — kalau totalnya
 * dihitung dari `unit_cost × qty` alih-alih harga barisnya, ia meleset ribuan
 * rupiah pada qty yang tidak membagi habis (100.000 / 3 → 33.333 × 3 = 99.999)
 * dan tidak ada satu pun angka di layar yang terlihat salah.
 *
 * Yang kedua: baris belum berharga. Ditulis "-", bukan Rp0, dan jumlahnya
 * disebut — kalau tidak, totalnya lebih kecil dari tagihan tanpa penjelasan.
 */
import { formatRupiah, formatNum } from '../js/core/format.js';
import { susunRincianNota, KOLOM_RINCIAN_NOTA, STATUS_BATAL } from '../js/modules/inventory/rincian-nota.js';

let gagal = 0;
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat) !== JSON.stringify(harap)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat)}\n   harap : ${JSON.stringify(harap)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

const K = Object.fromEntries(KOLOM_RINCIAN_NOTA.map((c, i) => [c.header, i]));
const item = (nama, o) => ({ qty: 1, products: { name: nama, base_unit: 'kg' }, ...o });

const NOTA = {
  code: 'TRM-260912-56F0',
  receipt_date: '2026-09-12',
  supplier: 'Toko Sayur Pagi',
  invoice_no: 'INV/9912',
  status: 'aktif',
  payment_status: 'lunas',
  payment_source: 'kas',
  photo_path: 'outlet/abc.jpg',
  outlets: { name: 'Central Kitchen Tangerang' }
};

// =====================================================================
// §1 BENTUK DASAR
// =====================================================================
{
  const r = susunRincianNota({
    nota: NOTA,
    items: [
      item('Lombok', { qty: 1, unit_cost: 10000, line_total: 10000 }),
      item('Beras', { qty: 12.5, unit_cost: 14000, line_total: 175000 })
    ]
  });

  cek('§1 judulnya menyebut nomor notanya', r.judul, 'Nota TRM-260912-56F0');
  cek('§1 dua baris', r.rows.length, 2);
  cek('§1 tiap baris selebar kolomnya', [...new Set(r.rows.map((x) => x.length))], [KOLOM_RINCIAN_NOTA.length]);
  // Diurut nama supaya dialog yang dibuka dua kali tidak menampilkan urutan
  // berbeda — urutan baris dari database tidak dijamin.
  cek('§1 diurut nama bahan', r.rows.map((x) => x[K['Bahan']]), ['Beras', 'Lombok']);
  cek('§1 jumlah & satuannya ikut', r.rows[0][K['Jumlah']], formatNum(12.5));
  cek('§1 total dari harga baris', r.total, 185000);
  cek('§1 totalnya ditulis rupiah', r.totalTeks, formatRupiah(185000));
  cek('§1 tidak ada baris tanpa harga', r.tanpaHarga, 0);
  cek('§1 fotonya terdeteksi', r.adaFoto, true);
  cek('§1 path fotonya diteruskan', r.photoPath, 'outlet/abc.jpg');
  benar('§1 tidak ditandai batal', r.batal === false);

  const label = r.info.map((i) => i.label);
  benar('§1 keterangan notanya lengkap', ['Tanggal nota', 'Supplier', 'No. invoice', 'Outlet', 'Status bayar'].every((l) => label.includes(l)));
  // Kolom yang kosong DIBUANG, bukan ditulis "-": di dialog sempit, deretan
  // "-" membuat yang benar-benar terisi jadi sulit ditemukan.
  benar('§1 keterangan kosong tidak ikut', !label.includes('Catatan'), label.join(','));
}

// =====================================================================
// §2 HARGA BARIS MENANG ATAS unit_cost × qty
//
// Inti berkas ini. Angka yang dipakai harus SAMA dengan yang dibayarkan.
// =====================================================================
{
  // 33.333 × 3 = 99.999, tapi yang diketik orangnya 100.000.
  const r = susunRincianNota({ nota: NOTA, items: [item('Cabai', { qty: 3, unit_cost: 33333, line_total: 100000 })] });
  cek('§2 total memakai line_total', r.total, 100000);
  cek('§2 dan bukan unit_cost x qty', r.total === 99999, false);
  // Harga/satuan DITURUNKAN dari total barisnya, bukan dibaca sendiri dari
  // `unit_cost`. Kalau keduanya dibaca terpisah, kolom "harga/satuan" dan
  // "harga beli" di baris yang sama bisa tidak saling mengalikan.
  cek('§2 harga/satuan konsisten dengan harga barisnya', r.rows[0][K['Harga/satuan']], formatRupiah(100000 / 3));
}
{
  // `unit_cost` yang TERTINGGAL dari harga lama, sementara `line_total` sudah
  // dibetulkan. Membaca keduanya terpisah menghasilkan baris yang kolom
  // "harga/satuan" × "jumlah"-nya TIDAK sama dengan kolom "harga beli" — dan
  // yang membacanya akan mengira salah satunya salah ketik.
  const r = susunRincianNota({ nota: NOTA, items: [item('Bawang', { qty: 2, unit_cost: 7000, line_total: 15000 })] });
  cek('§2 harga/satuan diturunkan dari harga baris, bukan dari unit_cost', r.rows[0][K['Harga/satuan']], formatRupiah(7500));
  cek('§2 dan harga belinya tetap harga barisnya', r.rows[0][K['Harga beli']], formatRupiah(15000));
}
{
  // Baris lama sebelum 0124: `line_total` belum ada, `unit_cost` yang dipakai.
  const r = susunRincianNota({ nota: NOTA, items: [item('Gula', { qty: 2, unit_cost: 15000, line_total: null })] });
  cek('§2 baris lama mundur ke unit_cost x qty', r.total, 30000);
}
{
  // Harga 0 adalah harga yang SAH (barang bonus/promo) — bukan "belum diisi".
  const r = susunRincianNota({ nota: NOTA, items: [item('Sampel', { qty: 1, unit_cost: 0, line_total: 0 })] });
  cek('§2 harga nol tetap harga', r.tanpaHarga, 0);
  cek('§2 dan totalnya Rp0, bukan "-"', r.totalTeks, formatRupiah(0));
}

// =====================================================================
// §3 BARIS BELUM BERHARGA
// =====================================================================
{
  const r = susunRincianNota({
    nota: NOTA,
    items: [item('Gula', { qty: 2, unit_cost: 10000, line_total: 20000 }), item('Lombok', { qty: 3, unit_cost: null, line_total: null })]
  });
  cek('§3 jumlahnya dihitung', r.tanpaHarga, 1);
  const lombok = r.rows.find((x) => x[K['Bahan']] === 'Lombok');
  cek('§3 ditulis "-" di kolom harga beli', lombok[K['Harga beli']], '-');
  cek('§3 dan di kolom harga/satuan', lombok[K['Harga/satuan']], '-');
  cek('§3 tidak ikut total', r.total, 20000);
}
{
  const r = susunRincianNota({ nota: NOTA, items: [item('Lombok', { qty: 3, unit_cost: null, line_total: null })] });
  // SELURUH barisnya belum berharga -> "-", bukan Rp0. Nol berarti gratis.
  cek('§3 nota yang seluruhnya belum berharga: totalnya "-"', r.totalTeks, '-');
}

// =====================================================================
// §4 NOTA BATAL
// =====================================================================
{
  const r = susunRincianNota({
    nota: { ...NOTA, status: STATUS_BATAL, alasan_batal: 'salah input' },
    items: [item('Gula', { qty: 1, line_total: 5000 })]
  });
  benar('§4 ditandai batal', r.batal === true);
  cek('§4 alasannya ikut', r.alasanBatal, 'salah input');
}

// =====================================================================
// §5 MASUKAN YANG TIDAK RAPI
// =====================================================================
{
  const r = susunRincianNota({ nota: {}, items: [] });
  cek('§5 nota tanpa nomor punya judul yang jujur', r.judul, 'Nota (tanpa nomor)');
  cek('§5 tanpa isi: tidak ada baris', r.rows, []);
  cek('§5 tanpa isi: totalnya "-"', r.totalTeks, '-');
  cek('§5 tanpa foto', r.adaFoto, false);
}
cek('§5 tanpa argumen sama sekali tidak melempar', susunRincianNota().rows, []);
cek('§5 items bukan array diabaikan', susunRincianNota({ nota: NOTA, items: 'bukan array' }).rows, []);
{
  // Produk yang sudah dihapus dari master TETAP MUNCUL: barangnya pernah
  // benar-benar masuk dan uangnya benar-benar keluar. Membuangnya membuat
  // total dialog tidak cocok dengan nominal yang dibayarkan.
  const r = susunRincianNota({ nota: NOTA, items: [{ qty: 2, line_total: 8000, products: null }] });
  cek('§5 produk terhapus tetap muncul', r.rows[0][K['Bahan']], '(produk terhapus)');
  cek('§5 dan nilainya tetap dihitung', r.total, 8000);
}
{
  const r = susunRincianNota({ nota: NOTA, items: [item('Gula', { qty: 1, line_total: 5000, notes: 'kemasan 1 kg' })] });
  benar('§5 catatan baris ikut ditulis', r.rows[0][K['Bahan']].includes('kemasan 1 kg'));
}

// =====================================================================
// §6 ANGKA YANG TIDAK MASUK AKAL TIDAK BOLEH LOLOS
//
// `formatRupiah(Infinity)` mencetak "Rp∞" — di dialog yang dipakai
// menyandingkan angka dengan tagihan supplier.
// =====================================================================
{
  const r = susunRincianNota({
    nota: NOTA,
    items: [item('Rusak', { qty: 1, line_total: Infinity }), item('Rusak juga', { qty: 1, line_total: NaN })]
  });
  for (const baris of r.rows) {
    for (const sel of baris) benar('§6 tidak ada ∞ / NaN di sel mana pun', !/∞|NaN|Infinity/.test(String(sel)), String(sel));
  }
  benar('§6 totalnya juga bersih', !/∞|NaN|Infinity/.test(r.totalTeks), r.totalTeks);
  cek('§6 keduanya dianggap belum berharga', r.tanpaHarga, 2);
}

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('rincian-nota.js benar — total dari harga BARIS, baris tanpa harga tidak dipalsukan jadi nol, dan nota batal disebut. ✅');
