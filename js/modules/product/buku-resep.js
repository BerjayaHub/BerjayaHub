/**
 * Menyusun "buku resep": seluruh resep sebuah BU jadi satu tabel yang bisa
 * dibaca di kertas dan di Excel.
 *
 * SATU SUMBER untuk dua keluaran (xlsx & PDF), alasannya sama dengan dokumen
 * kiriman: kalau tiap keluaran menyusun barisnya sendiri, cepat atau lambat
 * keduanya menyimpang, dan yang paling mungkin menyimpang justru kolom jumlah.
 * Resep yang takarannya berbeda antara file Excel dan lembar yang ditempel di
 * dapur adalah resep yang tidak bisa dipakai memeriksa apa pun.
 *
 * BENTUKNYA SENGAJA DATAR (satu baris per bahan), bukan bersarang. Baris datar
 * bisa disaring, diurutkan, dan di-pivot di Excel; tabel bersarang dengan sel
 * tergabung terlihat lebih rapi di layar tapi mati begitu orangnya menekan
 * "Filter" — dan menyaring adalah alasan utama file ini diunduh. Kolom Produk
 * & Varian diulang di tiap baris justru supaya penyaringan tetap bekerja.
 *
 * Tidak ada impor di file ini, supaya bisa diuji tanpa browser.
 */

const MODE_TEKS = { production: 'Produksi (CK)', standalone: 'Standalone', served_by_ck: 'Dilayani CK' };
const TIPE_TEKS = { raw: 'Bahan Baku', semi: 'Setengah Jadi', finished: 'Menu' };

const angka = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return String(Math.round(v * 10000) / 10000).replace('.', ',');
};

const rupiah = (n) => (n == null || !Number.isFinite(Number(n)) ? '-' : 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID'));

/**
 * @param {object} o
 * @param {object[]} o.products    seluruh produk BU
 * @param {object[]} o.recipes     hasil listRecipesFull()
 * @param {Function} [o.hppVarian] (productId, mode) -> number|null
 * @param {Function} [o.hppBahan]  (productId) -> number|null
 * @param {boolean}  [o.denganNilai=true]
 * @param {string}   [o.namaBu]
 */
export function susunBukuResep({ products, recipes, hppVarian, hppBahan, denganNilai = true, namaBu = '' }) {
  const produkById = new Map((products ?? []).map((p) => [p.id, p]));

  const kolom = [
    { header: 'Produk', width: 2 },
    { header: 'Tipe', width: 1 },
    { header: 'Kategori', width: 1 },
    { header: 'Varian', width: 1.1 },
    { header: 'Hasil/Yield', width: 0.9, align: 'right' },
    { header: 'Bahan', width: 2 },
    { header: 'Jumlah', width: 0.8, align: 'right' },
    { header: 'Satuan', width: 0.7 }
  ];
  if (denganNilai) {
    kolom.push(
      { header: 'HPP Bahan/satuan', width: 1, align: 'right', numeric: true },
      { header: 'Biaya Bahan', width: 1, align: 'right', numeric: true },
      { header: 'HPP Produk/satuan', width: 1.1, align: 'right', numeric: true }
    );
  }

  // Diurutkan supaya file yang diunduh dua kali berturut-turut isinya sama
  // urutannya. Tanpa ini, membandingkan dua unduhan (mis. sebelum & sesudah
  // memperbaiki harga) berarti membandingkan dua urutan acak.
  const urut = [...(recipes ?? [])].sort((a, b) => {
    const pa = produkById.get(a.product_id)?.name ?? '';
    const pb = produkById.get(b.product_id)?.name ?? '';
    return pa.localeCompare(pb, 'id') || String(a.mode).localeCompare(String(b.mode));
  });

  const baris = [];
  let jumlahVarian = 0;
  let tanpaHpp = 0;

  for (const r of urut) {
    const p = produkById.get(r.product_id);
    if (!p) continue; // resep yatim — produknya sudah terhapus
    jumlahVarian++;
    const hppProduk = hppVarian ? hppVarian(r.product_id, r.mode) : null;
    if (hppProduk == null) tanpaHpp++;

    const items = r.items ?? [];
    if (!items.length) {
      // Resep kosong TETAP MUNCUL, dengan keterangannya. Kalau ia dilewati,
      // file unduhan terlihat lengkap sementara di aplikasi ada peringatan —
      // dan orang akan lebih percaya file yang dipegangnya.
      baris.push([
        p.name,
        TIPE_TEKS[p.product_type] ?? p.product_type,
        p.category ?? '',
        MODE_TEKS[r.mode] ?? r.mode,
        angka(r.yield_qty),
        '(resep kosong — bahannya tidak tersimpan)',
        '',
        '',
        ...(denganNilai ? ['-', '-', rupiah(hppProduk)] : [])
      ]);
      continue;
    }

    for (const it of items) {
      const b = produkById.get(it.ingredient_product_id);
      const hpp = hppBahan ? hppBahan(it.ingredient_product_id) : null;
      const biaya = hpp == null ? null : hpp * Number(it.qty ?? 0);
      baris.push([
        p.name,
        TIPE_TEKS[p.product_type] ?? p.product_type,
        p.category ?? '',
        MODE_TEKS[r.mode] ?? r.mode,
        angka(r.yield_qty),
        b?.name ?? '(bahan sudah dihapus)',
        angka(it.qty),
        b?.base_unit ?? '',
        // Bahan tanpa HPP ditandai "-", bukan 0. Nol membuat kolom Biaya
        // terlihat sah dan totalnya bisa dijumlah tanpa curiga.
        ...(denganNilai ? [hpp == null ? '-' : rupiah(hpp), biaya == null ? '-' : rupiah(biaya), rupiah(hppProduk)] : [])
      ]);
    }
  }

  const tanggal = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  return {
    judul: 'Daftar Resep' + (namaBu ? ` — ${namaBu}` : ''),
    subjudul:
      `${jumlahVarian} varian resep · ${baris.length} baris bahan · dicetak ${tanggal}` +
      (tanpaHpp ? ` · ${tanpaHpp} varian belum bisa dihitung HPP-nya` : ''),
    namaBerkas: 'daftar-resep-' + new Date().toISOString().slice(0, 10),
    kolom,
    baris,
    jumlahVarian,
    tanpaHpp
  };
}
