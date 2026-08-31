/**
 * Menyusun daftar bahan di layar Stok Opname.
 *
 * ============ MASALAH YANG DIPECAHKAN DI SINI ============
 *
 * Opname dikerjakan BERSAMA dan BERTAHAP. Adhe menghitung rak kering pagi ini,
 * Widyantoro melanjutkan chiller sorenya. Sebelum modul ini ada, layar staff
 * tidak pernah memuat hitungan yang sudah tersimpan — kotaknya selalu kosong,
 * dan orang kedua tidak punya satu pun cara tahu rak mana yang sudah didatangi.
 *
 * Akibatnya dua-duanya buruk dan dua-duanya senyap: bahan dihitung dua kali
 * (yang kedua menimpa yang pertama tanpa ada yang sadar), atau bahan tidak
 * dihitung sama sekali karena masing-masing mengira yang lain sudah.
 *
 * Ditulis sebagai fungsi MURNI supaya urutannya bisa diuji tanpa browser.
 * "Yang belum dihitung naik ke atas" terdengar sepele sampai daftarnya berisi
 * dua ratus bahan dan penyaringnya aktif — dan bug urutan tidak pernah
 * menghasilkan error, hanya orang yang menggulir lebih lama.
 */

/** Nilai `state.saring` yang sah. */
export const SARING = {
  SEMUA: '',
  BELUM: 'belum',
  SUDAH: 'sudah'
};

/**
 * Apakah bahan ini sudah punya hitungan yang TERSIMPAN DI SERVER?
 *
 * `0` adalah hitungan yang sah — "sudah didatangi, raknya memang kosong" —
 * dan itu informasi yang berbeda dari "belum dihitung". Jadi yang diperiksa
 * keberadaan barisnya, BUKAN kebenaran angkanya.
 *
 * Memakai `if (tersimpan.get(id))` di sini akan menganggap semua bahan bernilai
 * nol sebagai belum dihitung — persis bahan yang paling perlu ditandai selesai,
 * karena orang berikutnya akan mendatangi rak kosong itu lagi.
 */
export function sudahDihitung(tersimpan, produkId) {
  return tersimpan instanceof Map && tersimpan.has(produkId);
}

/**
 * Nilai yang harus tampil di kotak isian.
 *
 * Urutan menangnya: apa yang SEDANG DIKETIK  >  apa yang TERSIMPAN  >  kosong.
 *
 * Yang sedang diketik menang karena ia yang paling baru dan belum sempat
 * terkirim; menimpanya dengan angka server berarti membuang ketikan orang di
 * depan matanya sendiri.
 *
 * Dikembalikan sebagai STRING, bukan angka: kotak kosong dan angka 0 harus bisa
 * dibedakan, dan `Number('')` yang menjadi 0 sudah pernah menimbulkan bug di
 * modul ini (lihat `keAngka` di core/xlsx.js).
 */
export function nilaiKotak(draft, tersimpan, produkId) {
  if (draft instanceof Map && draft.has(produkId)) return String(draft.get(produkId));
  if (tersimpan instanceof Map && tersimpan.has(produkId)) {
    const n = tersimpan.get(produkId)?.counted_qty;
    return n == null ? '' : String(n);
  }
  return '';
}

/**
 * Susun daftar bahan: disaring, lalu yang BELUM dihitung diangkat ke atas.
 *
 * @param {Array}  bahan      daftar produk yang sudah lolos saringan kategori & pencarian
 * @param {Map}    tersimpan  produkId -> baris `stock_count_items` dari server
 * @param {Map}    draft      produkId -> nilai yang sedang diketik (string)
 * @param {string} saring     salah satu nilai `SARING`
 */
export function susunDaftar(bahan, { tersimpan, draft, saring = SARING.SEMUA } = {}) {
  const list = Array.isArray(bahan) ? bahan : [];

  const selesai = (p) => sudahDihitung(tersimpan, p.id);

  const disaring = list.filter((p) => {
    if (saring === SARING.BELUM) return !selesai(p);
    if (saring === SARING.SUDAH) return selesai(p);
    return true;
  });

  // URUTANNYA STABIL, dan itu bukan detail kecil.
  //
  // `Array.prototype.sort` di V8 memang stabil, tapi yang dijaga di sini bukan
  // itu: pembanding di bawah HANYA melihat status hitung, jadi bahan yang
  // status-nya sama mempertahankan urutan aslinya (nama/kategori) apa adanya.
  // Kalau ikut membandingkan nama di sini, urutan yang sudah diatur pemanggil
  // — mis. mengikuti tata letak rak — akan tertimpa diam-diam.
  //
  // `slice()` di sini REDUNDAN SECARA HASIL, dan saya menuliskannya begitu
  // apa adanya daripada mengaku ia penjaga.
  //
  // `Array.prototype.filter` sudah mengembalikan array BARU, jadi `disaring`
  // tidak pernah menunjuk array milik pemanggil — mengurutkannya di tempat pun
  // tidak akan mengacak apa pun. Sabotase yang membuang `slice()` memang tidak
  // menggagalkan satu tes pun, dan itu jujur.
  //
  // Dipertahankan sebagai pertahanan berlapis: kalau suatu saat baris `filter`
  // di atas diganti jadi jalan pintas yang mengembalikan `list` apa adanya
  // (mis. `saring === SEMUA ? list : list.filter(...)` demi menghemat satu
  // salinan), `sort()` mendadak jadi mengacak array pemanggil — dan kegagalan
  // itu tidak menghasilkan error, hanya urutan yang berubah di layar lain.
  const urut = disaring.slice().sort((a, b) => Number(selesai(a)) - Number(selesai(b)));

  const jumlahSelesai = list.filter(selesai).length;

  return {
    baris: urut,
    // Angka kemajuan dihitung dari SELURUH daftar, bukan dari yang sedang
    // tampak. "12 dari 87" yang berubah setiap kali penyaring diganti akan
    // membuat orang mengira pekerjaannya berkurang atau bertambah sendiri.
    total: list.length,
    selesai: jumlahSelesai,
    belum: list.length - jumlahSelesai,
    // Berapa yang sedang diketik tapi BELUM terkirim. Inilah yang hilang kalau
    // orangnya menutup halaman tanpa menekan Simpan.
    belumTersimpan: hitungBelumTersimpan(draft, tersimpan)
  };
}

/**
 * Berapa isian yang sedang diketik dan BERBEDA dari yang tersimpan.
 *
 * Kotak yang dibuka lalu ditutup tanpa diubah tidak dihitung — kalau ikut
 * dihitung, peringatan "ada yang belum disimpan" akan menyala terus-menerus
 * dan berhenti dipercaya, dan sesudah itu ia sama saja dengan tidak ada.
 */
export function hitungBelumTersimpan(draft, tersimpan) {
  if (!(draft instanceof Map)) return 0;
  let n = 0;
  for (const [pid, nilai] of draft.entries()) {
    if (nilai === '' || nilai == null) continue;
    const lama = tersimpan instanceof Map ? tersimpan.get(pid)?.counted_qty : undefined;
    // Dibandingkan sebagai ANGKA, bukan teks: "1000" dan "1000.0" dan 1000
    // adalah hitungan yang sama, dan menandainya "belum tersimpan" hanya
    // karena bentuk tulisannya berbeda akan membuat orang menyimpan ulang
    // sesuatu yang sudah benar.
    if (lama == null || Number(lama) !== Number(nilai)) n++;
  }
  return n;
}

/**
 * Kalimat siapa-kapan untuk satu bahan yang sudah dihitung.
 *
 * Nama penghitungnya disebut supaya "kok angkanya beda dari yang saya lihat di
 * rak" bisa ditanyakan ke orangnya langsung, bukan jadi perdebatan tanpa ujung.
 * Dikembalikan `null` — bukan string kosong — kalau belum dihitung, supaya
 * pemanggil harus memutuskan dengan sadar apa yang ditampilkan.
 */
export function keteranganHitung(tersimpan, produkId) {
  if (!sudahDihitung(tersimpan, produkId)) return null;
  const b = tersimpan.get(produkId);
  const nama = b?.penghitung?.full_name ?? 'seseorang';
  const waktu = b?.counted_at ? new Date(b.counted_at) : null;
  const jam = waktu
    ? waktu.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  return jam ? `dihitung ${nama} · ${jam}` : `dihitung ${nama}`;
}
