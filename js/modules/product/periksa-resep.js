/**
 * Memeriksa daftar bahan sebelum sebuah resep disimpan.
 *
 * Tiga hal yang sebelumnya lolos tanpa suara — dan ketiganya sama-sama
 * menghasilkan HPP yang SALAH tapi terlihat wajar, yang jauh lebih mahal
 * daripada gagal simpan:
 *
 * 1. BARIS DENGAN BAHAN TAPI TANPA JUMLAH DIBUANG DIAM-DIAM.
 *    Editor lama menyaringnya dengan `.filter(i => i.qty > 0)`. Orang memilih
 *    lima bahan, lupa mengisi satu jumlah, menekan Simpan, dan mendapat
 *    "Resep disimpan." Resepnya berisi empat. HPP-nya lebih murah dari
 *    kenyataan, dan harga jual ditetapkan di atas angka itu. Tidak ada satu pun
 *    layar yang bisa memberi tahu bahwa ada bahan yang hilang, karena dari
 *    sisi database resep itu memang cuma pernah punya empat bahan.
 *
 * 2. BAHAN YANG SAMA DUA KALI.
 *    `recipe_items` tidak punya unique index, jadi dua baris "Gula" tersimpan
 *    dan biayanya DIJUMLAHKAN. Hasilnya HPP yang terlalu mahal, dan penyebabnya
 *    tidak kelihatan sampai seseorang membuka panel bahan dan menghitung
 *    manual. Digabung, bukan ditolak: mengetik bahan yang sama dua kali di
 *    spreadsheet panjang itu lumrah, dan yang dimaksudkan orangnya hampir
 *    selalu total keduanya.
 *
 * 3. PRODUK JADI BAHAN BAGI DIRINYA SENDIRI.
 *    Editor sudah mencegahnya (pilihan dirinya sendiri tidak ditawarkan), tapi
 *    IMPOR tidak — dan lewat impor itu satu baris yang mudah salah ketik.
 *    Akibatnya siklus: HPP-nya jadi `null` selamanya, dengan pesan "belum bisa
 *    dihitung" yang menunjuk ke bahan yang kelihatan baik-baik saja.
 *
 * 4. MENU DIPAKAI SEBAGAI BAHAN.
 *    Editor tidak menawarkannya (dropdown-nya hanya bahan baku & setengah jadi),
 *    tapi IMPOR menerimanya begitu saja — ia cuma mencocokkan nama. Padahal
 *    "menu di dalam menu" bukan cara produksi yang dimaksudkan modul ini:
 *    barang yang dipakai membuat barang lain seharusnya bertipe Setengah Jadi,
 *    dan tipe itulah yang menentukan apakah stoknya diproduksi di CK. Dibiarkan
 *    lolos, dua layar yang seharusnya menjawab hal yang sama akan menerima
 *    resep yang salah satunya tidak bisa dibuka di editor.
 *
 * Tidak ada impor di file ini, supaya bisa diuji tanpa browser.
 */

/**
 * @param {Array<{ingredient_product_id: string, qty: number|null}>} baris
 * @param {object} o
 * @param {string} o.productId          produk yang sedang diisi resepnya
 * @param {Map<string,string>} [o.nama] id -> nama, untuk pesan yang bisa dibaca
 * @param {Map<string,string>} [o.tipe] id -> product_type; kalau diberikan,
 *   bahan bertipe `finished` (Menu) ditolak — sama seperti dropdown editor
 * @returns {{items: object[], masalah: string[]}}
 *   `masalah` tidak kosong berarti JANGAN disimpan.
 */
export function periksaBahan(baris, { productId, nama = new Map(), tipe = null } = {}) {
  const sebut = (id) => nama.get(id) ?? 'bahan ini';
  const masalah = [];
  const gabung = new Map();

  for (const b of baris ?? []) {
    const id = b?.ingredient_product_id;
    if (!id) continue; // baris kosong sepenuhnya memang baris yang belum diisi

    if (id === productId) {
      masalah.push(`"${sebut(id)}" dipakai sebagai bahan bagi dirinya sendiri — HPP-nya tidak akan pernah bisa dihitung`);
      continue;
    }

    // Hanya diperiksa kalau peta tipenya diberikan: pemanggil yang tidak
    // punya daftar produk (mis. tes lama) tidak boleh jadi ikut menolak.
    if (tipe?.get(id) === 'finished') {
      masalah.push(`"${sebut(id)}" adalah Menu — menu tidak bisa dipakai sebagai bahan. Kalau memang dipakai membuat produk lain, ubah tipenya jadi Setengah Jadi`);
      continue;
    }

    const qty = Number(b.qty);
    // `> 0`, bukan `!= null`: nol dan kosong sama-sama berarti jumlahnya belum
    // diisi, dan bahan berjumlah nol tidak menambah apa pun ke resep.
    if (!Number.isFinite(qty) || qty <= 0) {
      masalah.push(`"${sebut(id)}" sudah dipilih tapi jumlahnya belum diisi`);
      continue;
    }

    gabung.set(id, (gabung.get(id) ?? 0) + qty);
  }

  const items = [...gabung.entries()].map(([ingredient_product_id, qty]) => ({ ingredient_product_id, qty }));
  return { items, masalah };
}

/** Nama bahan yang muncul lebih dari sekali — untuk diberitahukan, bukan ditolak. */
export function bahanGanda(baris, { nama = new Map() } = {}) {
  const hitung = new Map();
  for (const b of baris ?? []) {
    const id = b?.ingredient_product_id;
    if (!id || !(Number(b.qty) > 0)) continue;
    hitung.set(id, (hitung.get(id) ?? 0) + 1);
  }
  return [...hitung.entries()].filter(([, n]) => n > 1).map(([id]) => nama.get(id) ?? id);
}
