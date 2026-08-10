/**
 * Siapa yang ikut kehilangan HPP kalau sebuah resep dihapus.
 *
 * KENAPA PERLU DIHITUNG DULU. Menghapus resep terasa seperti tindakan lokal —
 * "saya cuma membetulkan satu produk yang salah impor". Padahal HPP dihitung
 * BERANTAI: menu memakai setengah jadi, setengah jadi memakai bahan baku. Kalau
 * resep "Produksi" sebuah setengah jadi dihapus, biayanya jadi tidak diketahui,
 * dan SEMUA menu yang memakainya ikut kehilangan HPP — diam-diam, di layar
 * lain, tanpa ada yang menghubungkannya dengan penghapusan tadi.
 *
 * Jadi dialog konfirmasinya menyebut nama-namanya. Konfirmasi yang cuma bilang
 * "yakin hapus?" tidak menambah apa pun yang belum diketahui orangnya.
 *
 * Tidak ada impor di file ini, dan sebaiknya tetap begitu — supaya bisa diuji
 * tanpa browser maupun koneksi.
 */

/**
 * Produk lain yang HPP-nya bergantung pada `productId`, langsung maupun
 * berantai.
 *
 * @param {{id: string, name: string, product_type: string}[]} products
 * @param {{product_id: string, mode: string, items: {ingredient_product_id: string}[]}[]} recipes
 * @param {string} productId produk yang resepnya akan dihapus
 * @returns {{id: string, name: string, mode: string}[]} varian resep yang terdampak
 */
export function pemakaiResep(products, recipes, productId) {
  const namaById = new Map((products ?? []).map((p) => [p.id, p.name]));

  // Peta: bahan -> daftar varian resep yang memakainya.
  const dipakaiOleh = new Map();
  for (const r of recipes ?? []) {
    for (const it of r.items ?? []) {
      const kunci = it.ingredient_product_id;
      if (!dipakaiOleh.has(kunci)) dipakaiOleh.set(kunci, []);
      dipakaiOleh.get(kunci).push(r);
    }
  }

  const hasil = [];
  const sudah = new Set([productId]);
  // Ditelusuri MELEBAR, bukan rekursif: resep yang saling memakai (siklus
  // akibat salah input) akan membuat rekursi tidak berhenti, dan yang muncul ke
  // user bukan peringatan melainkan halaman yang membeku.
  //
  // Ada DUA dedup di bawah: per varian resep, dan per produk saat masuk antrean.
  // Ditulis apa adanya supaya tidak menyesatkan — mencabut dedup per PRODUK
  // saja tidak membuat tes merah, karena dedup per varian sudah membatasi
  // penelusurannya. Yang benar-benar menjaga dari lingkaran tak berujung adalah
  // dedup per varian; yang per produk sekadar memangkas kunjungan berulang.
  // Mencabut keduanya membuat `test-dampak-hapus-resep.mjs` menggantung pada
  // fixture siklus di hulu.
  const antre = [productId];
  while (antre.length) {
    const kini = antre.shift();
    for (const r of dipakaiOleh.get(kini) ?? []) {
      const kunci = `${r.product_id}|${r.mode}`;
      if (sudah.has(kunci)) continue;
      sudah.add(kunci);
      // Varian milik produk yang resepnya SEDANG dihapus tidak ikut didaftar.
      // Ia bukan "yang ikut terdampak" — ia yang dihapus. Ini bisa terjadi
      // kalau resepnya keliru memakai produknya sendiri sebagai bahan, dan
      // menampilkannya di dialog hapus hanya membingungkan.
      if (r.product_id === productId) continue;
      hasil.push({ id: r.product_id, name: namaById.get(r.product_id) ?? '(produk terhapus)', mode: r.mode });
      // Produknya sendiri ikut ditelusuri: menu yang memakai setengah jadi ini
      // bisa saja dipakai lagi oleh sesuatu di atasnya.
      if (!sudah.has(r.product_id)) {
        sudah.add(r.product_id);
        antre.push(r.product_id);
      }
    }
  }
  return hasil;
}
