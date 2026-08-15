/**
 * Isi panel "bahan apa saja di resep ini" — dipakai Admin Portal DAN Staff App.
 *
 * Yang dikembalikan DATA, bukan HTML. Kedua sisi menggambar sendiri karena
 * bentuknya memang berbeda: Admin punya kolom rupiah dan tombol ubah, Staff
 * hanya daftar bahan dan dibaca di layar HP. Tapi ATURANNYA — bahan mana yang
 * bermasalah, apa yang dihitung, apa yang ditandai "-" — harus satu, karena
 * itulah yang paling mahal kalau menyimpang: dua layar yang menampilkan resep
 * yang sama dengan isi berbeda membuat orang berhenti percaya pada keduanya.
 *
 * `denganNilai` DIPUTUSKAN PEMANGGIL, bukan di sini. Staff App meminta tanpa
 * nilai. Perlu dicatat jujur: itu BUKAN pengaman — `products_select` membuka
 * harga beli untuk semua anggota BU, jadi staff tetap bisa melihat HPP lewat
 * layar lain. Yang diatur di sini adalah apa yang ikut beredar di layar yang
 * dibuka di tengah dapur, bukan apa yang bisa dilihat.
 *
 * Tidak ada impor di file ini, supaya bisa diuji tanpa browser.
 */

/**
 * @param {object} o
 * @param {object[]} o.products
 * @param {object[]} o.recipes    hasil listRecipesFull()
 * @param {string} o.productId
 * @param {string} o.mode
 * @param {boolean} [o.denganNilai=false]
 * @param {Function} [o.hppBahan]   (productId) -> number|null
 * @param {Function} [o.hppVarian]  (productId, mode) -> number|null
 * @param {Function} [o.sebabBahan] (productId) -> string|null
 * @param {Function} [o.sebabVarian] (productId, mode) -> string[]
 */
export function susunPanelBahan({
  products,
  recipes,
  productId,
  mode,
  denganNilai = false,
  hppBahan,
  hppVarian,
  sebabBahan,
  sebabVarian
}) {
  const produkById = new Map((products ?? []).map((p) => [p.id, p]));
  const produk = produkById.get(productId) ?? null;
  const r = (recipes ?? []).find((x) => x.product_id === productId && x.mode === mode) ?? null;

  if (!r) {
    return { ada: false, kosong: false, produk, baris: [], yieldQty: null, satuan: produk?.base_unit ?? '', hpp: null, sebab: [], totalBiaya: null };
  }

  const items = r.items ?? [];
  const hpp = hppVarian ? hppVarian(productId, mode) : null;
  // Sebab hanya dikumpulkan kalau memang HPP-nya kosong. Menjalankannya selalu
  // berarti menelusuri seluruh pohon bahan tiap kali panel dibuka, dan panel
  // ini dibuka berkali-kali di daftar yang panjang.
  const sebab = hpp == null && sebabVarian ? sebabVarian(productId, mode) : [];

  let totalBiaya = 0;
  let adaBiayaHilang = false;
  const baris = items.map((it) => {
    const b = produkById.get(it.ingredient_product_id);
    const jumlah = Number(it.qty ?? 0);
    const satuanBahan = b?.base_unit ?? '';
    // Bahan yang produknya sudah tidak ada punya masalahnya sendiri, dan
    // pesannya harus berbeda dari "harganya belum diisi" — yang satu diperbaiki
    // di Master Produk, yang satu lagi tidak bisa diperbaiki sama sekali
    // kecuali resepnya diubah.
    const masalah = !b ? 'Bahan ini sudah tidak ada di Master Produk.' : (sebabBahan ? sebabBahan(it.ingredient_product_id) : null);

    let hppSatuan = null;
    let biaya = null;
    if (denganNilai && !b) {
      // Bahan yang produknya sudah dihapus JUGA berarti biaya yang tidak
      // diketahui. Tanpa baris ini, resep berisi satu bahan hantu menghasilkan
      // total Rp 0 yang terlihat sah — dan nol adalah angka yang paling mudah
      // dipercaya karena ia tidak terlihat seperti kesalahan.
      adaBiayaHilang = true;
    }
    if (denganNilai && b) {
      hppSatuan = hppBahan ? hppBahan(it.ingredient_product_id) : null;
      // Bahan tanpa HPP TIDAK dihitung nol. Nol membuat total terlihat sah
      // padahal ada yang belum berbiaya — dan total itu dipakai menentukan
      // harga jual.
      if (hppSatuan == null) adaBiayaHilang = true;
      else {
        biaya = hppSatuan * jumlah;
        totalBiaya += biaya;
      }
    }

    return {
      id: it.ingredient_product_id,
      nama: b?.name ?? '(bahan sudah dihapus)',
      jumlah,
      satuan: satuanBahan,
      masalah: masalah ?? null,
      hppSatuan,
      biaya
    };
  });

  return {
    ada: true,
    kosong: items.length === 0,
    produk,
    baris,
    yieldQty: Number(r.yield_qty ?? 0),
    satuan: produk?.base_unit ?? '',
    hpp,
    sebab,
    // Total dibiarkan null kalau ada bahan yang belum berbiaya: angka separuh
    // lebih menyesatkan daripada tidak ada angka, karena ia tetap terlihat
    // seperti jawaban.
    totalBiaya: denganNilai && !adaBiayaHilang && baris.length ? totalBiaya : null
  };
}
