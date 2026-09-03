/**
 * Aturan pencarian nama di tabel Riwayat Stok — dipisah supaya BISA DIUJI.
 *
 * ============ JEBAKANNYA ADA DI PRODUK YANG SUDAH DIHAPUS ============
 *
 * Satu baris riwayat memegang nama produknya di DUA tempat yang berbeda:
 *
 *   r.products.name  — ikut di baris pergerakannya sendiri, dan TETAP ADA
 *                      walaupun produknya sudah dihapus dari master.
 *   r.produk.name    — hasil pencocokan ke master, jadi `null` untuk produk
 *                      yang sudah dihapus.
 *
 * Kolom Produk di tabel menampilkan yang PERTAMA. Kalau pencariannya memakai
 * yang kedua, baris milik produk terhapus punya nama kosong — sehingga baris
 * yang jelas-jelas terbaca di layar tidak bisa ditemukan dengan mengetik
 * namanya sendiri. Tidak ada error, tidak ada baris merah; barisnya hanya
 * lenyap begitu seseorang mulai menelusuri, yaitu justru saat ia paling
 * dibutuhkan.
 *
 * Buku besar stok memang sengaja menyimpan nama di barisnya sendiri supaya
 * riwayat tidak ikut hilang saat master dirapikan. Pencariannya harus
 * mengikuti keputusan itu, bukan melawannya.
 *
 * Tidak ada impor di file ini, dan sebaiknya tetap begitu.
 */

/**
 * Teks yang dicari untuk satu baris riwayat.
 *
 * Kategori & sub ikut disertakan supaya perilakunya sama dengan kotak cari di
 * tab Stok — mengetik "Beverage" di sana menemukan seisi kategorinya, dan dua
 * kotak yang terlihat sama tidak boleh mencari dengan cara berbeda. Keduanya
 * hanya ada untuk produk yang masih di master, jadi ditambahkan seadanya.
 *
 * @param {{products?:{name?:string}, produk?:{name?:string, category?:string, subcategory?:string}}} r
 */
export function namaUntukCari(r) {
  return [
    r?.products?.name ?? r?.produk?.name ?? '',
    r?.produk?.category ?? '',
    r?.produk?.subcategory ?? ''
  ]
    .filter(Boolean)
    .join(' ');
}
