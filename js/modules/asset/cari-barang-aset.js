/**
 * PENCARIAN BARANG SAAT MEMILIH — nama, kode, kategori, catatan.
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase.
 *
 * ============ KENAPA SATU KOTAK, BUKAN EMPAT ============
 *
 * Layar utama Inventaris Aset punya saringan terpisah (Cari nama, Cari kode,
 * Cari catatan, Kategori) karena di sana orang sedang MENELUSURI. Di dialog
 * pemilihan barang ia sedang MENCARI SATU BARANG yang sudah ada di kepalanya,
 * dan ia tidak tahu lebih dulu apakah "kaki pendek" itu bagian dari namanya,
 * catatannya, atau kategorinya. Empat kotak memaksanya menebak kotak mana
 * dulu; satu kotak tidak.
 *
 * ============ YANG DICARI DIPECAH PER KATA ============
 *
 * "gelas pendek" harus menemukan "Gelas Coctail kaki pendek". Pencocokan
 * seluruh frasa tidak menemukannya, dan orangnya akan menyimpulkan barangnya
 * tidak ada — lalu menambahkan item kembar dengan nama versinya sendiri.
 * Itu persis yang membuat satu barang punya tiga nama di tiga outlet.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));
const angka = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Seluruh kata yang bisa dicari dari satu barang, dijadikan satu kalimat. */
export function ladangCari(a) {
  return [a?.kode, a?.name, a?.nama, a?.category, a?.kategori, a?.notes, a?.catatan]
    .map((v) => teks(v))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Apakah barang ini cocok dengan yang diketik?
 *
 * Kosong = cocok semua. Tiap kata harus ada (DAN, bukan ATAU): "gelas kaki"
 * yang berarti "gelas mana pun ATAU apa pun berkata kaki" akan mengembalikan
 * setengah daftar, dan daftar yang nyaris tidak menyusut sama saja dengan
 * tidak menyaring.
 */
export function cocokBarang(a, q) {
  const kata = teks(q).toLowerCase().split(/\s+/).filter(Boolean);
  if (!kata.length) return true;
  const ladang = ladangCari(a);
  return kata.every((k) => ladang.includes(k));
}

/**
 * Saring daftar barang.
 *
 * ============ YANG SUDAH DIPILIH TIDAK PERNAH DISEMBUNYIKAN ============
 *
 * `wajibTampil` adalah kumpulan id yang sudah diisi jumlahnya. Pola
 * kegagalannya sudah pernah terjadi di layar aset: memilih 5 barang,
 * mengganti saringan, lalu mengira yang terkirim hanya yang terlihat. Di sini
 * akibatnya lebih mahal — barangnya BERPINDAH, dan tidak ada penerima yang
 * akan menghitung ulang dan menolak.
 *
 * Jadi pilihan tidak pernah hilang dari layar karena kata pencarian. Ia tetap
 * di daftar, dan tetap bisa dinolkan kembali.
 */
export function saringBarang(daftar, q, wajibTampil = null) {
  const list = Array.isArray(daftar) ? daftar : [];
  return list.filter((a) => cocokBarang(a, q) || (wajibTampil && wajibTampil.has(a?.itemId)));
}

/** Ringkasan apa yang sudah dipilih: berapa jenis, berapa unit. */
export function ringkasTerpilih(pilihan) {
  const isi = [...(pilihan instanceof Map ? pilihan.values() : [])].map(angka).filter((q) => q > 0);
  return { jenis: isi.length, unit: isi.reduce((a, b) => a + b, 0) };
}

/**
 * Kalimat berjalan "sudah dipilih", untuk ditempel di atas daftar.
 *
 * Selalu ada, juga saat masih nol. Kalimat yang muncul-hilang membuat orang
 * tidak memperhatikannya; yang selalu di tempat yang sama akan terbaca.
 */
export function kalimatTerpilih(pilihan) {
  const { jenis, unit } = ringkasTerpilih(pilihan);
  if (!jenis) return 'Belum ada barang yang diisi jumlahnya.';
  return `Dipilih: ${jenis} jenis · ${unit} unit`;
}
