/**
 * TES `js/modules/product/ekspor-produk.js`.
 *
 * ============ YANG PALING PERLU DIJAGA ============
 *
 * 1. SEMBILAN KOLOM PERTAMANYA HARUS SAMA PERSIS dengan template impor.
 *    "Download data" hampir selalu berarti "sunting di Excel lalu masukkan
 *    lagi". Judul kolom yang bergeser sedikit tidak gagal dengan jelas — ia
 *    terimpor SEBAGIAN, kolom yang tidak dikenali dibaca kosong, dan harga beli
 *    ratusan produk lenyap tanpa satu pun pesan.
 *
 * 2. KOSONG PUNYA DUA ARTI, dan keduanya tidak boleh tertukar. Sel kosong di
 *    kolom yang bisa diimpor = "belum diisi". Tanda "-" di kolom turunan =
 *    "tidak bisa dihitung". Menulis "-" di kolom impor membuat orang mengetiknya
 *    balik apa adanya; menulis kosong di kolom HPP membuatnya terlihat seperti
 *    isian yang terlupa.
 *
 * 3. BERKASNYA HARUS MENGAKU KALAU IA SEBAGIAN. Berkas 40 baris dari master 785
 *    produk yang terkirim lewat WhatsApp tidak punya cara lain memberi tahu
 *    penerimanya bahwa ada saringan yang aktif.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatRupiah, formatNum } from '../js/core/format.js';
import {
  susunEksporProduk,
  catatanProduk,
  KOLOM_IMPOR,
  KOLOM_PRODUK,
  KOLOM_REKAP_PRODUK,
  TYPE_LABEL
} from '../js/modules/product/ekspor-produk.js';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let gagal = 0;
const tandai = (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? `NON-FINITE:${String(v)}` : v);
const cek = (nama, dapat, harap) => {
  if (JSON.stringify(dapat, tandai) !== JSON.stringify(harap, tandai)) {
    gagal++;
    console.error(`❌ ${nama}\n   dapat : ${JSON.stringify(dapat, tandai)}\n   harap : ${JSON.stringify(harap, tandai)}`);
  }
};
const benar = (nama, syarat, ket = '') => {
  if (!syarat) {
    gagal++;
    console.error(`❌ ${nama}${ket ? ' — ' + ket : ''}`);
  }
};

const K = Object.fromEntries(KOLOM_PRODUK.map((c, i) => [c.header, i]));

const raw = (o) => ({
  id: o.id ?? o.name,
  product_type: 'raw',
  base_unit: 'gram',
  purchase_unit: 'karung',
  purchase_qty: 25000,
  purchase_price: 250000,
  is_active: true,
  ...o
});
const menu = (o) => ({ id: o.id ?? o.name, product_type: 'finished', base_unit: 'gelas', sale_price: 20000, is_active: true, ...o });

// =====================================================================
// §1 KOLOM 1-9 SAMA PERSIS DENGAN TEMPLATE IMPOR
//
// Dibandingkan langsung dengan baris template di `product-import.js`, bukan
// dengan salinan yang ditulis ulang di sini — salinan akan menyimpang bersama
// berkas yang disalinnya.
// =====================================================================
{
  const src = fs.readFileSync(path.join(AKAR, 'js/modules/product/product-import.js'), 'utf8');
  const m = src.match(/'(Nama,Tipe,[^']*)\\n'/);
  benar('§1 baris judul template impor ketemu', !!m, 'pola judul template berubah — pemeriksaan ini kehilangan sasarannya');
  if (m) {
    cek('§1 judul kolomnya sama persis, berikut urutannya', KOLOM_IMPOR, m[1].split(','));
  }
  cek(
    '§1 dan KOLOM_PRODUK memakainya apa adanya',
    KOLOM_PRODUK.slice(0, 9).map((c) => c.header),
    KOLOM_IMPOR
  );
}
// Ejaan tipe harus yang dikenali `TYPE_MAP` pengimpor.
//
// Dicari DI DALAM blok TYPE_MAP saja, dan kuncinya boleh berkutip atau tidak:
// `'bahan baku'` wajib berkutip karena berspasi, sementara `menu` ditulis polos
// karena ia pengenal yang sah. Pemeriksaan yang menuntut kutip lolos untuk yang
// pertama dan merah untuk yang kedua — padahal dua-duanya benar.
{
  const src = fs.readFileSync(path.join(AKAR, 'js/modules/product/product-import.js'), 'utf8');
  const i = src.indexOf('const TYPE_MAP');
  const blok = i >= 0 ? src.slice(i, src.indexOf('};', i)) : '';
  benar('§1 blok TYPE_MAP ketemu', !!blok, 'pemeriksaan ejaan tipe kehilangan sasarannya');
  for (const label of Object.values(TYPE_LABEL)) {
    const pola = new RegExp(`(^|[{,\\s])['"]?${label.toLowerCase()}['"]?\\s*:`, 'm');
    benar(`§1 tipe "${label}" dikenali pengimpor`, pola.test(blok.toLowerCase()), label);
  }
}

// =====================================================================
// §2 BENTUK BARISNYA
// =====================================================================
{
  const { rincian, ringkas } = susunEksporProduk({
    produk: [
      raw({ name: 'Gula', category: 'Bahan Kering' }),
      menu({ name: 'Es Kopi Susu', category: 'Minuman', subcategory: 'Kopi' })
    ],
    hpp: new Map([
      ['Gula', 10],
      ['Es Kopi Susu', 8000]
    ])
  });

  cek('§2 dua baris', rincian.length, 2);
  cek('§2 tiap baris selebar kolomnya', [...new Set(rincian.map((r) => r.length))], [KOLOM_PRODUK.length]);
  // Bahan baku lebih dulu, lalu menu — urutan yang sama dengan cara master
  // produk dibaca orang.
  cek('§2 diurut per tipe', rincian.map((r) => r[K['Nama']]), ['Gula', 'Es Kopi Susu']);

  const gula = rincian[0];
  cek('§2 tipenya memakai label impor', gula[K['Tipe']], 'Bahan Baku');
  cek('§2 satuan pakai & satuan beli', [gula[K['Satuan Pakai']], gula[K['Satuan Beli']]], ['gram', 'karung']);
  cek('§2 isi per satuan beli', gula[K['Isi per Satuan Beli']], formatNum(25000, 4));
  cek('§2 harga beli', gula[K['Harga Beli (per Satuan Beli)']], formatRupiah(250000));
  cek('§2 HPP-nya ikut', gula[K['HPP / Satuan']], formatRupiah(10));
  cek('§2 bahan baku tidak punya harga jual', gula[K['Harga Jual']], '');

  const kopi = rincian[1];
  cek('§2 menu punya harga jual', kopi[K['Harga Jual']], formatRupiah(20000));
  cek('§2 marginnya dihitung', kopi[K['Margin']], formatRupiah(12000));
  cek('§2 dan persentasenya', kopi[K['Margin %']], `${formatNum(60, 1)}%`);
  cek('§2 menu tidak punya kolom beli', [kopi[K['Satuan Beli']], kopi[K['Isi per Satuan Beli']], kopi[K['Harga Beli (per Satuan Beli)']]], ['', '', '']);
  cek('§2 statusnya', kopi[K['Status']], 'Aktif');
  cek('§2 tidak ada yang perlu dicatat', kopi[K['Catatan']], '');
  cek('§2 tidak ada yang kurang', [ringkas.tanpaHpp, ringkas.tanpaHargaJual, ringkas.perluCek, ringkas.nonaktif], [0, 0, 0, 0]);
}

// =====================================================================
// §3 KOSONG vs "-" — DUA ARTI YANG BERBEDA
// =====================================================================
{
  const { rincian } = susunEksporProduk({
    produk: [raw({ name: 'Garam', purchase_price: null, purchase_qty: null, purchase_unit: '' })],
    hpp: new Map()
  });
  const r = rincian[0];
  // Kolom yang BISA DIIMPOR: kosong, sama seperti template. Menulis "-" di sini
  // membuat orang mengetiknya balik apa adanya lalu mengimpornya.
  cek('§3 kolom impor yang belum diisi = sel KOSONG', [r[K['Satuan Beli']], r[K['Isi per Satuan Beli']], r[K['Harga Beli (per Satuan Beli)']]], ['', '', '']);
  // Kolom TURUNAN: "-", karena ia bukan isian yang lupa, melainkan angka yang
  // tidak bisa dihitung.
  cek('§3 kolom turunan yang tak bisa dihitung = "-"', [r[K['HPP / Satuan']], r[K['Margin']], r[K['Margin %']]], ['-', '-', '-']);
  benar('§3 dan sebabnya ditulis', r[K['Catatan']].includes('Harga beli belum diisi'), r[K['Catatan']]);
}
{
  // Harga beli SUDAH diisi tapi isinya belum — sebabnya berbeda, dan kolom yang
  // harus dibetulkan juga berbeda.
  const { rincian } = susunEksporProduk({ produk: [raw({ name: 'Beras', purchase_qty: null })], hpp: new Map() });
  benar('§3 sebab "isi per satuan beli" dibedakan', rincian[0][K['Catatan']].includes('Isi per Satuan Beli'), rincian[0][K['Catatan']]);
}
{
  // Harga 0 adalah harga yang SAH (barang bonus) — bukan "belum diisi".
  const { rincian, ringkas } = susunEksporProduk({ produk: [raw({ name: 'Sampel', purchase_price: 0 })], hpp: new Map([['Sampel', 0]]) });
  cek('§3 harga nol tetap harga', rincian[0][K['Harga Beli (per Satuan Beli)']], formatRupiah(0));
  cek('§3 dan HPP nol tetap HPP', rincian[0][K['HPP / Satuan']], formatRupiah(0));
  cek('§3 tidak dihitung sebagai belum ada HPP', ringkas.tanpaHpp, 0);
}

// =====================================================================
// §4 CATATAN
// =====================================================================
{
  const { rincian, ringkas } = susunEksporProduk({
    produk: [menu({ name: 'Teh Manis', sale_price: null, is_active: false })],
    hpp: new Map([['Teh Manis', 1000]])
  });
  const c = rincian[0][K['Catatan']];
  benar('§4 menu tanpa harga jual disebut', c.includes('Harga jual belum diisi'), c);
  benar('§4 nonaktif disebut', c.includes('nonaktif'), c);
  cek('§4 dan statusnya', rincian[0][K['Status']], 'Nonaktif');
  cek('§4 ikut dihitung di ringkasan', [ringkas.tanpaHargaJual, ringkas.nonaktif], [1, 1]);
}
{
  // Harga tertukar: peringatannya dipakai APA ADANYA dari `harga-curiga.js`,
  // tidak ditulis ulang — dua penjelasan untuk satu aturan pasti menyimpang.
  const { rincian, ringkas } = susunEksporProduk({
    produk: [raw({ name: 'Gula', purchase_price: 10, purchase_qty: 25000 })],
    hpp: new Map([['Gula', 0.0004]])
  });
  benar('§4 harga yang terlihat terbalik ditandai', /terbalik/i.test(rincian[0][K['Catatan']]), rincian[0][K['Catatan']]);
  cek('§4 dan dihitung', ringkas.perluCek, 1);
}
cek('§4 produk yang lengkap tidak diberi catatan kosong-kosongan', catatanProduk(raw({ name: 'Gula' }), 10), '');
cek('§4 baris null tidak melempar', typeof catatanProduk(null, null), 'string');

// =====================================================================
// §5 SARINGAN — BERKASNYA HARUS SAMA DENGAN YANG DILIHAT ORANGNYA
// =====================================================================
const CONTOH = [
  raw({ name: 'Gula  Pasir', category: 'Bahan Kering' }),
  raw({ name: 'Beras', category: 'Bahan Kering' }),
  menu({ name: 'Es Kopi Susu', category: 'Minuman', subcategory: 'Kopi' }),
  menu({ name: 'Lemon Tea', category: 'Minuman', subcategory: 'Teh' })
];
const nama = (o) => susunEksporProduk(o).rincian.map((r) => r[K['Nama']]);

cek('§5 tanpa saringan: semuanya', nama({ produk: CONTOH }).length, 4);
cek('§5 saring tipe', nama({ produk: CONTOH, saring: { tipe: 'Menu' } }), ['Es Kopi Susu', 'Lemon Tea']);
cek('§5 saring kategori', nama({ produk: CONTOH, saring: { kategori: 'Bahan Kering' } }), ['Beras', 'Gula  Pasir']);
cek('§5 saring sub kategori', nama({ produk: CONTOH, saring: { subKategori: 'Kopi' } }), ['Es Kopi Susu']);
// SPASI GANDA. "gula pasir" harus menemukan "Gula  Pasir" — kegagalan yang sama
// yang dulu membuat impor menolak bahan yang jelas ada.
cek('§5 nama dibakukan di kedua sisi', nama({ produk: CONTOH, saring: { nama: 'gula pasir' } }), ['Gula  Pasir']);
cek('§5 saringan digabung DAN, bukan ATAU', nama({ produk: CONTOH, saring: { tipe: 'Menu', kategori: 'Bahan Kering' } }), []);

{
  const { subjudul, ringkas } = susunEksporProduk({ produk: CONTOH, saring: { tipe: 'Menu' } });
  cek('§5 jumlah yang disaring keluar dihitung', ringkas.disaring, 2);
  // Berkas yang sebagian HARUS mengaku — yang menerimanya lewat WhatsApp tidak
  // melihat layar tempat saringannya dipasang.
  benar('§5 subjudulnya mengaku disaring', subjudul.includes('Saringan'), subjudul);
  benar('§5 dan menyebut berapa dari berapa', subjudul.includes('2 dari 4'), subjudul);
}
{
  const { subjudul } = susunEksporProduk({ produk: CONTOH });
  benar('§5 tanpa saringan: disebut seluruhnya', subjudul.includes('Seluruh produk'), subjudul);
}

// =====================================================================
// §6 REKAP KELENGKAPAN
// =====================================================================
{
  const { rekap } = susunEksporProduk({
    produk: [
      raw({ name: 'Gula', category: 'Bahan Kering' }),
      raw({ name: 'Garam', category: 'Bahan Kering', purchase_price: null }),
      raw({ name: 'Entah', category: '' }),
      menu({ name: 'Lemon Tea', category: 'Minuman', sale_price: null, is_active: false })
    ],
    hpp: new Map([['Gula', 10]])
  });
  const R = Object.fromEntries(KOLOM_REKAP_PRODUK.map((c, i) => [c.header, i]));
  const kering = rekap.find((r) => r[R['Kategori']] === 'Bahan Kering');
  cek('§6 jumlah per kategori', kering[R['Jumlah']], formatNum(2));
  cek('§6 yang belum ada HPP dihitung', kering[R['Belum ada HPP']], formatNum(1));
  // Kategori kosong jadi kelompok sendiri, bukan ikut kategori mana pun —
  // kalau ia menyatu, orangnya tidak akan pernah membetulkannya.
  benar('§6 kategori kosong jadi kelompok sendiri', rekap.some((r) => r[R['Kategori']] === '(tanpa kategori)'));
  const minuman = rekap.find((r) => r[R['Kategori']] === 'Minuman');
  cek('§6 menu tanpa harga jual dihitung', minuman[R['Menu tanpa harga jual']], formatNum(1));
  cek('§6 nonaktif dihitung', minuman[R['Nonaktif']], formatNum(1));
  cek('§6 rekap ikut saringan', susunEksporProduk({ produk: CONTOH, saring: { tipe: 'Menu' } }).rekap.length, 1);
}

// =====================================================================
// §7 ANGKA YANG TIDAK MASUK AKAL & MASUKAN YANG TIDAK RAPI
// =====================================================================
{
  const { rincian } = susunEksporProduk({
    produk: [raw({ name: 'Rusak', purchase_price: Infinity }), menu({ name: 'Rusak juga', sale_price: NaN })],
    hpp: new Map([['Rusak', Infinity]])
  });
  for (const r of rincian) {
    for (const sel of r) benar('§7 tidak ada ∞ / NaN di sel mana pun', !/∞|NaN|Infinity/.test(String(sel)), String(sel));
  }
}
cek('§7 tanpa argumen tidak melempar', susunEksporProduk().rincian, []);
cek('§7 produk bukan array diabaikan', susunEksporProduk({ produk: 'bukan array' }).rincian, []);
cek('§7 hpp bukan Map diabaikan', susunEksporProduk({ produk: [raw({ name: 'Gula' })], hpp: {} }).rincian[0][K['HPP / Satuan']], '-');
benar('§7 kolom nominal ditandai numeric', KOLOM_PRODUK.filter((c) => c.numeric).length >= 4);
benar('§7 rekap juga', KOLOM_REKAP_PRODUK.filter((c) => c.numeric).length >= 4);
benar('§7 nama berkasnya bertanggal', /^master-produk-\d{4}-\d{2}-\d{2}$/.test(susunEksporProduk({ produk: [] }).namaBerkas));

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('ekspor-produk.js benar — sembilan kolom pertamanya cocok template impor, kosong & "-" tidak tertukar, dan berkasnya mengaku kalau disaring. ✅');
