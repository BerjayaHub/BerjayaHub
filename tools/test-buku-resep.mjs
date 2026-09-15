/**
 * TES `js/modules/product/buku-resep.js`.
 *
 * ============ SATU JUDUL KOLOM YANG MENGALIKAN HPP 1800x ============
 *
 * Kolom Yield dulu bertuliskan "Hasil/Yield". Pengimpor resep membaca
 * `r['yield']` — nama itu tidak ditemukannya, jadi ia memakai nilai BAWAAN 1.
 *
 * Berkas hasil ekspor yang diunggah untuk mengisi resep kosong, atau untuk
 * menyalin resep ke BU baru, akan menyetel yield 1800 jadi 1. HPP produknya
 * lalu 1800 kali lipat. Tidak ada error, tidak ada baris merah — angkanya cuma
 * salah, dan harga jual ditentukan di atasnya.
 *
 * Karena itu kecocokan judulnya diuji terhadap `template-resep.csv` SUNGGUHAN,
 * bukan terhadap daftar yang ditulis ulang di sini.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { susunBukuResep, KOLOM_IMPOR_RESEP, CATATAN_RESEP_KOSONG } from '../js/modules/product/buku-resep.js';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
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

const PRODUK = [
  { id: 'gula', name: 'Gula', product_type: 'raw', base_unit: 'gram', category: 'Bahan Kering' },
  { id: 'air', name: 'Air', product_type: 'raw', base_unit: 'ml', category: 'Bahan Cair' },
  { id: 'sirup', name: 'Sirup Gula', product_type: 'semi', base_unit: 'ml', category: 'Bahan Olahan' },
  { id: 'kopi', name: 'Es Kopi Susu', product_type: 'finished', base_unit: 'gelas', category: 'Minuman', subcategory: 'Kopi' }
];
const RESEP = [
  { product_id: 'sirup', mode: 'production', yield_qty: 1800, items: [{ ingredient_product_id: 'gula', qty: 1000 }, { ingredient_product_id: 'air', qty: 1000 }] },
  { product_id: 'kopi', mode: 'standalone', yield_qty: 1, items: [{ ingredient_product_id: 'sirup', qty: 30 }] }
];
const HPP = new Map([['gula', 12], ['air', 0.01], ['sirup', 6.7], ['kopi', 201]]);
const susun = (o = {}) =>
  susunBukuResep({
    products: PRODUK,
    recipes: RESEP,
    hppVarian: (id) => HPP.get(id) ?? null,
    hppBahan: (id) => HPP.get(id) ?? null,
    ...o
  });

const judul = (b) => b.kolom.map((c) => c.header);
const kol = (b, h) => judul(b).indexOf(h);

// =====================================================================
// §1 JUDUL KOLOMNYA HARUS DIKENALI PENGIMPOR
// =====================================================================
{
  const src = fs.readFileSync(path.join(AKAR, 'js/modules/product/product-import.js'), 'utf8');
  const m = src.match(/'(Produk,Varian,[^']*)\\n'/);
  benar('§1 baris judul template-resep.csv ketemu', !!m, 'pola judulnya berubah — pemeriksaan ini kehilangan sasarannya');
  if (m) cek('§1 judulnya sama persis dengan template impor', KOLOM_IMPOR_RESEP, m[1].split(','));
}
{
  const b = susun();
  // Pengimpor membaca berdasarkan NAMA kolom, bukan posisinya — jadi urutan
  // boleh diatur demi keterbacaan, tapi tiap nama wajib ADA.
  for (const h of KOLOM_IMPOR_RESEP) {
    benar(`§1 kolom "${h}" ada di berkasnya`, judul(b).includes(h), judul(b).join(', '));
  }
  // INI bug yang diperbaiki. Jangan sampai hidup lagi.
  benar('§1 tidak ada lagi kolom "Hasil/Yield"', !judul(b).includes('Hasil/Yield'), judul(b).join(', '));
}
// Varian yang ditulis harus yang dikenali `bacaVarian`.
{
  const src = fs.readFileSync(path.join(AKAR, 'js/modules/product/product-import.js'), 'utf8');
  const i = src.indexOf('function bacaVarian');
  const blok = i >= 0 ? src.slice(i, src.indexOf('\n}', i)).toLowerCase() : '';
  benar('§1 blok bacaVarian ketemu', !!blok);
  const b = susun();
  const iv = kol(b, 'Varian');
  for (const v of [...new Set(b.baris.map((r) => r[iv]))]) {
    benar(`§1 varian "${v}" dikenali pengimpor`, blok.includes(`'${v.toLowerCase()}'`), v);
  }
}

// =====================================================================
// §2 ISI BARISNYA
// =====================================================================
{
  const b = susun();
  cek('§2 tiga baris bahan', b.baris.length, 3);
  cek('§2 tiap baris selebar kolomnya', [...new Set(b.baris.map((r) => r.length))], [b.kolom.length]);
  // Diurut nama produk, jadi "Es Kopi Susu" lebih dulu dari "Sirup Gula".
  const r = b.baris[0];
  cek('§2 produk & bahannya', [r[kol(b, 'Produk')], r[kol(b, 'Bahan')]], ['Es Kopi Susu', 'Sirup Gula']);
  cek('§2 jumlahnya', r[kol(b, 'Jumlah')], '30');
  cek('§2 yield menu ini memang 1', r[kol(b, 'Yield')], '1');
  // INI yang dulu jatuh jadi 1 saat berkasnya diunggah balik.
  const sirup = b.baris.find((x) => x[kol(b, 'Produk')] === 'Sirup Gula');
  cek('§2 yield resep produksi terbawa utuh', sirup[kol(b, 'Yield')], '1800');
  // Yield & Jumlah adalah dua kolom yang paling sering dipivot — kolom teks
  // tidak bisa dijumlah, dan menjumlah itulah alasan orang minta .xlsx.
  benar('§2 Yield ditandai numeric', b.kolom[kol(b, 'Yield')].numeric === true);
  benar('§2 Jumlah ditandai numeric', b.kolom[kol(b, 'Jumlah')].numeric === true);
  cek('§2 Catatan selalu kolom terakhir', judul(b)[judul(b).length - 1], 'Catatan');
  cek('§2 yang wajar tidak diberi catatan', r[kol(b, 'Catatan')], '');
}
{
  // Desimal ditulis dengan koma (cara Indonesia) — dan `bacaAngka` di
  // `core/nama.js` memang membacanya sebagai desimal, bukan ribuan.
  const b = susun({ recipes: [{ product_id: 'kopi', mode: 'standalone', yield_qty: 1, items: [{ ingredient_product_id: 'sirup', qty: 12.5 }] }] });
  cek('§2 desimal memakai koma', b.baris[0][kol(b, 'Jumlah')], '12,5');
}

// =====================================================================
// §3 RESEP KOSONG — CATATANNYA PINDAH DARI KOLOM BAHAN
//
// Dulu penanda "(resep kosong — ...)" ditulis di kolom Bahan. Berkas yang
// diunggah balik lalu MENCARI BAHAN dengan nama itu: satu baris galat untuk
// tiap resep kosong, tepat pada berkas yang dipakai MEMPERBAIKI resep kosong.
// =====================================================================
{
  const b = susun({ recipes: [{ product_id: 'sirup', mode: 'production', yield_qty: 1800, items: [] }] });
  cek('§3 resepnya tetap muncul', b.baris.length, 1);
  cek('§3 kolom Bahan dikosongkan', b.baris[0][kol(b, 'Bahan')], '');
  cek('§3 keterangannya di kolom Catatan', b.baris[0][kol(b, 'Catatan')], CATATAN_RESEP_KOSONG);
  cek('§3 yield-nya tetap terbawa', b.baris[0][kol(b, 'Yield')], '1800');
  cek('§3 dihitung di ringkasan', b.resepKosong, 1);
  benar('§3 dan disebut di subjudul', b.subjudul.includes('1 resep kosong'), b.subjudul);
}
{
  // Bahan yang produknya sudah dihapus: tetap muncul, dan sebabnya ditulis.
  const b = susun({ recipes: [{ product_id: 'kopi', mode: 'standalone', yield_qty: 1, items: [{ ingredient_product_id: 'hantu', qty: 5 }] }] });
  benar('§3 bahan terhapus tetap muncul', b.baris[0][kol(b, 'Bahan')].includes('dihapus'));
  benar('§3 dengan catatannya', b.baris[0][kol(b, 'Catatan')].includes('dihapus'), b.baris[0][kol(b, 'Catatan')]);
}
{
  // Bahan yang harganya belum ada ditandai "-", bukan 0 — nol membuat kolom
  // Biaya terlihat sah dan totalnya bisa dijumlah tanpa curiga.
  const b = susunBukuResep({ products: PRODUK, recipes: RESEP, hppVarian: () => null, hppBahan: () => null });
  cek('§3 HPP bahan tanpa harga ditulis "-"', b.baris[0][kol(b, 'HPP Bahan/satuan')], '-');
  cek('§3 biayanya juga', b.baris[0][kol(b, 'Biaya Bahan')], '-');
  benar('§3 sebabnya ditulis di Catatan', /harganya belum ada/.test(b.baris[0][kol(b, 'Catatan')]), b.baris[0][kol(b, 'Catatan')]);
  cek('§3 dan dihitung', b.tanpaHpp, 2);
}

// =====================================================================
// §4 SARINGAN & KEJUJURAN BERKAS
// =====================================================================
const produkDi = (b) => [...new Set(b.baris.map((r) => r[kol(b, 'Produk')]))];

cek('§4 tanpa saringan: semuanya', produkDi(susun()).sort(), ['Es Kopi Susu', 'Sirup Gula']);
cek('§4 saring tipe', produkDi(susun({ saring: { tipe: 'Menu' } })), ['Es Kopi Susu']);
cek('§4 saring kategori', produkDi(susun({ saring: { kategori: 'Bahan Olahan' } })), ['Sirup Gula']);
cek('§4 saring sub kategori', produkDi(susun({ saring: { subKategori: 'Kopi' } })), ['Es Kopi Susu']);
cek('§4 saring nama', produkDi(susun({ saring: { nama: 'sirup' } })), ['Sirup Gula']);
cek('§4 saringan digabung DAN', produkDi(susun({ saring: { tipe: 'Menu', kategori: 'Bahan Olahan' } })), []);
{
  // Nama dibakukan di KEDUA sisi — spasi ganda tidak boleh mengosongkan berkas.
  const b = susun({ products: [{ ...PRODUK[2], name: 'Sirup  Gula' }, ...PRODUK], saring: { nama: 'sirup gula' } });
  benar('§4 spasi ganda tetap ketemu', b.baris.length > 0);
}
{
  const b = susun({ saring: { tipe: 'Menu' } });
  benar('§4 subjudulnya mengaku disaring', b.subjudul.includes('Saringan'), b.subjudul);
  benar('§4 dan menyebut berapa dari berapa', b.subjudul.includes('1 dari 2 varian'), b.subjudul);
  cek('§4 penanda saringan ikut dikembalikan', b.adaSaringan, true);
}
{
  const b = susun();
  benar('§4 tanpa saringan tidak mengaku disaring', !b.subjudul.includes('Saringan'), b.subjudul);
  benar('§4 tapi tetap menyebut jumlahnya', b.subjudul.includes('2 dari 2 varian'), b.subjudul);
}

// =====================================================================
// §5 REKAP
// =====================================================================
{
  const b = susun();
  const R = Object.fromEntries(b.kolomRekap.map((c, i) => [c.header, i]));
  cek('§5 satu baris per tipe+varian', b.rekap.length, 2);
  const menu = b.rekap.find((r) => r[R['Varian']] === 'Standalone');
  cek('§5 jumlah resepnya', menu[R['Jumlah resep']], '1');
  cek('§5 baris bahannya', menu[R['Baris bahan']], '1');
  cek('§5 rekap ikut saringan', susun({ saring: { tipe: 'Menu' } }).rekap.length, 1);
  benar('§5 kolom rekap bertanda numeric', b.kolomRekap.filter((c) => c.numeric).length >= 4);
}

// =====================================================================
// §6 MASUKAN YANG TIDAK RAPI
// =====================================================================
cek('§6 tanpa argumen tidak melempar', susunBukuResep().baris, []);
cek('§6 resep yatim (produknya terhapus) dilewati', susun({ recipes: [{ product_id: 'hantu', mode: 'production', yield_qty: 1, items: [] }] }).baris, []);
{
  const b = susun({ recipes: [{ product_id: 'sirup', mode: 'production', yield_qty: Infinity, items: [{ ingredient_product_id: 'gula', qty: NaN }] }] });
  for (const r of b.baris) {
    for (const sel of r) benar('§6 tidak ada ∞ / NaN di sel mana pun', !/∞|NaN|Infinity/.test(String(sel)), String(sel));
  }
}
benar('§6 nama berkasnya bertanggal', /^daftar-resep-\d{4}-\d{2}-\d{2}$/.test(susun().namaBerkas));
{
  // `denganNilai: false` dipakai PDF ringkas — Catatan harus tetap kolom terakhir.
  const b = susun({ denganNilai: false });
  cek('§6 tanpa nilai: Catatan tetap terakhir', judul(b)[judul(b).length - 1], 'Catatan');
  benar('§6 dan kolom HPP tidak ikut', !judul(b).includes('HPP Bahan/satuan'));
  cek('§6 barisnya tetap selebar kolomnya', [...new Set(b.baris.map((r) => r.length))], [b.kolom.length]);
}

if (gagal) {
  console.error(`\n${gagal} kasus gagal.`);
  process.exit(1);
}
console.log('buku-resep.js benar — judul kolomnya dikenali pengimpor, yield tidak lagi jatuh ke 1, dan berkasnya mengaku kalau disaring. ✅');
