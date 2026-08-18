/**
 * BAHAN MENIPIS — dari penjualan × resep, per outlet.
 *
 * Tidak ada impor di file ini, dan sebaiknya tetap begitu: angkanya dipakai
 * menyusun daftar belanja, dan angka yang tidak bisa diuji di luar browser
 * adalah angka yang tidak pernah benar-benar diperiksa.
 *
 * =====================================================================
 * MODELNYA — bagian yang paling mungkin salah dan paling tidak kelihatan
 * =====================================================================
 *
 * 1. MENJUAL MENU MEMAKAI BAHAN DI SETIAP TINGKAT, bukan cuma bahan bakunya.
 *
 *    Menjual "Nasi Ayam" memakai sambal (setengah jadi); membuat sambal itu
 *    memakai cabai (bahan baku). Dua-duanya habis, dan dua-duanya perlu
 *    diawasi — sambal karena itu yang diambil dari kulkas saat jam sibuk,
 *    cabai karena itu yang harus dibeli.
 *
 *    Jadi pemakaian dijumlahkan di SETIAP simpul, bukan hanya di daun.
 *
 * 2. YANG TIDAK DILAKUKAN: mengurangi kebutuhan bahan baku dengan stok
 *    setengah jadi yang sudah ada.
 *
 *    Kalau ada 5 kg sambal siap pakai di kulkas, sebenarnya cabainya belum
 *    perlu dibeli sekarang. Perhitungan di sini TIDAK memperhitungkan itu —
 *    yang dihitung kebutuhan KOTOR. Akibatnya daftar belanja bisa sedikit
 *    berlebih, tidak pernah kurang.
 *
 *    Arah kesalahannya dipilih dengan sadar. Berlebih artinya membeli terlalu
 *    cepat; kurang artinya kehabisan di tengah jam ramai. Yang kedua jauh
 *    lebih mahal, dan yang pertama terlihat dari raknya.
 *
 * 3. MENU "DILAYANI CK" TIDAK MEMAKAI BAHAN DI OUTLETNYA.
 *
 *    Kalau sebuah menu hanya punya resep varian "Dilayani CK", berarti Central
 *    Kitchen yang membuatnya dan outlet menerimanya jadi. Menjualnya memakai
 *    STOK MENU ITU SENDIRI, bukan bahan-bahannya.
 *
 *    Membentangkannya jadi bahan baku akan melaporkan outlet gerai kehabisan
 *    cabai — padahal cabainya tidak pernah ada di sana, dan tidak seharusnya
 *    ada. Daftar belanja yang menyuruh gerai membeli bahan yang bukan
 *    urusannya adalah daftar yang akan berhenti dibaca orang.
 *
 * =====================================================================
 * BATAS "MENIPIS"
 * =====================================================================
 *
 *   batas = batasManual  kalau ada barisnya
 *         = pemakaianHarian × hariAman  kalau tidak
 *
 * Manual menang karena ia menyatakan sesuatu yang tidak bisa disimpulkan dari
 * penjualan: barang langka yang harus selalu ditimbun, atau bahan yang
 * pembeliannya minimal satu dus.
 *
 * `batasManual = 0` BUKAN "belum diatur" — itu pernyataan sadar "jangan
 * diawasi". Karena itu yang dibedakan adalah ADA/TIDAK ADA barisnya, bukan
 * nilainya nol atau bukan. Menyamakan keduanya berarti satu-satunya cara
 * mematikan peringatan adalah menghapus barisnya, dan niatnya jadi hilang.
 */

/** Ambang yang dianggap "nol" — melindungi dari sisa pembagian floating point. */
const EPS = 1e-9;

/**
 * Susun fungsi pembentang resep.
 *
 * Bentuknya sengaja meniru `buildCostFn` di `hpp.js` — sama-sama menelusuri
 * resep secara rekursif dengan memo dan penjaga siklus. Yang berbeda hanya apa
 * yang dijumlahkan: di sana rupiah, di sini jumlah bahan.
 *
 * @returns {(menuId: string) => Map<string, number>} bahan per 1 unit terjual
 */
export function pembentangResep(products, recipes) {
  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const recipeByKey = new Map((recipes ?? []).map((r) => [`${r.product_id}|${r.mode}`, r]));
  const memo = new Map();

  /** Resep yang berlaku untuk sebuah produk di OUTLET (bukan di CK). */
  function resepBerlaku(p) {
    if (!p) return null;
    if (p.product_type === 'semi') return recipeByKey.get(`${p.id}|production`) ?? null;
    if (p.product_type === 'finished') {
      // Standalone lebih dulu: kalau outlet bisa membuatnya sendiri, itu yang
      // memakai bahan. Kalau hanya ada varian CK, sengaja mengembalikan null —
      // lihat catatan (3) di kepala berkas.
      return recipeByKey.get(`${p.id}|standalone`) ?? null;
    }
    return null;
  }

  function bentang(pid, sedangDilalui) {
    if (memo.has(pid)) return memo.get(pid);

    const p = productById.get(pid);
    const r = resepBerlaku(p);
    const hasil = new Map();

    if (!r || !r.items?.length || !(Number(r.yield_qty) > 0)) {
      // Bahan baku, atau menu yang dilayani CK, atau resep yang belum diisi:
      // tidak membentang lebih jauh. Yang memakainya adalah produk itu sendiri.
      memo.set(pid, hasil);
      return hasil;
    }

    // SIKLUS. Resep bersiklus tidak seharusnya ada (dijaga saat menyimpan),
    // tapi data lama bisa memuatnya. Yang penting di sini: berhenti, JANGAN
    // melempar error. Satu resep bersiklus tidak boleh membuat seluruh daftar
    // belanja gagal tampil — itu menukar satu baris salah dengan layar kosong.
    if (sedangDilalui.has(pid)) return hasil;
    sedangDilalui.add(pid);

    const yieldQty = Number(r.yield_qty);
    for (const it of r.items) {
      const bid = it.ingredient_product_id;
      const per = Number(it.qty) / yieldQty;
      if (!Number.isFinite(per)) continue;

      // Tingkat ini sendiri ikut dihitung — lihat catatan (1).
      hasil.set(bid, (hasil.get(bid) ?? 0) + per);

      for (const [cid, cper] of bentang(bid, sedangDilalui)) {
        hasil.set(cid, (hasil.get(cid) ?? 0) + per * cper);
      }
    }

    sedangDilalui.delete(pid);
    memo.set(pid, hasil);
    return hasil;
  }

  return (menuId) => bentang(menuId, new Set());
}

/**
 * Pemakaian bahan per hari, dari penjualan.
 *
 * @param {object[]} sales baris `{product_id, qty}` — sudah disaring outlet & rentang
 * @param {number} hari panjang rentangnya dalam hari
 * @returns {Map<string, number>} productId → jumlah per hari
 */
export function pemakaianHarian({ products, recipes, sales, hari }) {
  const out = new Map();
  // Rentang nol/negatif akan menghasilkan Infinity yang menyebar diam-diam ke
  // seluruh kolom. Lebih baik mengembalikan peta kosong: tidak ada data lebih
  // jujur daripada angka tak hingga yang tampil sebagai "∞ kg/hari".
  if (!(Number(hari) > 0)) return out;

  const bentang = pembentangResep(products, recipes);
  const tambah = (pid, qty) => {
    if (!(qty > 0)) return;
    out.set(pid, (out.get(pid) ?? 0) + qty);
  };

  for (const s of sales ?? []) {
    const terjual = Number(s.qty);
    if (!Number.isFinite(terjual) || terjual === 0) continue;

    const isi = bentang(s.product_id);
    if (isi.size === 0) {
      // Tidak punya resep yang berlaku di outlet: yang terpakai barangnya
      // sendiri. Ini yang terjadi pada menu "Dilayani CK", dan juga pada
      // bahan baku yang kebetulan dijual langsung (air mineral botol).
      tambah(s.product_id, terjual);
      continue;
    }
    for (const [bid, per] of isi) tambah(bid, terjual * per);
  }

  for (const [k, v] of out) out.set(k, v / Number(hari));
  return out;
}

/**
 * Susun tabel bahan menipis.
 *
 * @param {object}   o
 * @param {object[]} o.products
 * @param {object[]} o.recipes
 * @param {object[]} o.sales      penjualan outlet ini pada rentangnya
 * @param {number}   o.hari       panjang rentang penjualan (hari)
 * @param {Map}      o.stok       productId → jumlah stok sekarang
 * @param {number}   o.hariAman   `outlets.safety_days`
 * @param {Map}      [o.batasManual] productId → min_qty (ADA/TIDAK ADA berarti)
 */
export function susunBahanMenipis({ products, recipes, sales, hari, stok, hariAman, batasManual = new Map() }) {
  const perHari = pemakaianHarian({ products, recipes, sales, hari });
  const aman = Number(hariAman) > 0 ? Number(hariAman) : 7;

  const baris = [];
  let tersembunyi = 0;

  for (const p of products ?? []) {
    // Menu tidak dibeli, jadi tidak masuk daftar belanja. Yang diawasi hanya
    // yang benar-benar distok di gudang outlet.
    if (p.product_type === 'finished') continue;
    if (p.is_active === false) continue;

    const pakai = perHari.get(p.id) ?? 0;
    const punyaManual = batasManual.has(p.id);
    const ada = Number(stok?.get(p.id) ?? 0);

    // PILIHAN YANG DIMINTA: bahan tanpa riwayat pemakaian DISEMBUNYIKAN.
    //
    // Perlu dikatakan terus terang bahwa ini punya sisi buruk — bahan menu
    // baru yang stoknya habis tidak akan muncul di sini sama sekali. Yang
    // menutupinya adalah batas MANUAL: begitu admin memberi batas, bahan itu
    // ikut diawasi walau belum pernah terjual. Jumlah yang disembunyikan tetap
    // dilaporkan lewat `tersembunyi` supaya tidak hilang tanpa jejak.
    if (pakai <= EPS && !punyaManual) {
      tersembunyi++;
      continue;
    }

    const batas = punyaManual ? Number(batasManual.get(p.id)) : pakai * aman;

    // Batas 0 = sengaja tidak diawasi. Bukan "semua aman" — memang tidak ikut.
    if (!(batas > EPS)) continue;

    // Cukup berapa hari lagi. Tanpa pemakaian, pertanyaannya tidak punya
    // jawaban — `null`, bukan Infinity, supaya yang menggambar tidak perlu
    // menebak arti angka raksasa.
    const cukupHari = pakai > EPS ? ada / pakai : null;
    const kurang = Math.max(0, batas - ada);

    baris.push({
      productId: p.id,
      nama: p.name,
      satuan: p.base_unit,
      kategori: p.category ?? null,
      stok: ada,
      perHari: pakai,
      hariAman: punyaManual ? null : aman,
      batas,
      batasManual: punyaManual,
      cukupHari,
      saranBeli: kurang,
      status: ada <= EPS ? 'habis' : ada < batas - EPS ? 'menipis' : 'aman'
    });
  }

  // Urutan: habis dulu, lalu yang paling cepat habis. Yang aman tetap ikut
  // supaya layarnya bisa dipakai memeriksa satu bahan tertentu, tapi tidak
  // pernah menghalangi yang mendesak.
  const pangkat = { habis: 0, menipis: 1, aman: 2 };
  baris.sort((a, b) => {
    if (pangkat[a.status] !== pangkat[b.status]) return pangkat[a.status] - pangkat[b.status];
    const ha = a.cukupHari ?? Infinity;
    const hb = b.cukupHari ?? Infinity;
    if (ha !== hb) return ha - hb;
    return String(a.nama).localeCompare(String(b.nama));
  });

  const perlu = baris.filter((r) => r.status !== 'aman');
  return {
    baris,
    perlu,
    jumlahHabis: baris.filter((r) => r.status === 'habis').length,
    jumlahMenipis: baris.filter((r) => r.status === 'menipis').length,
    jumlahAman: baris.filter((r) => r.status === 'aman').length,
    tersembunyi,
    hariAman: aman,
    hariData: Number(hari) > 0 ? Number(hari) : 0
  };
}

/**
 * Teks daftar belanja untuk dikirim lewat WhatsApp.
 *
 * Dibuat di modul murni supaya isinya bisa diuji. Yang dikirim lewat chat
 * adalah bentuk yang paling sering dipakai orang di luar aplikasi — dan
 * satu-satunya bentuk yang tidak bisa diperbaiki setelah terkirim.
 */
export function teksBelanja(lap, { outlet = '', tanggal = '' } = {}) {
  const angka = (n) => {
    const b = Math.round(Number(n) * 100) / 100;
    return String(b).replace('.', ',');
  };
  const kepala = ['*Bahan Perlu Dibeli*', [outlet, tanggal].filter(Boolean).join(' · ')].filter(Boolean);

  if (!lap.perlu.length) {
    return [...kepala, '', 'Tidak ada bahan yang menipis. 👍'].join('\n');
  }

  const garis = lap.perlu.map((r) => {
    const sisa =
      r.status === 'habis'
        ? 'HABIS'
        : r.cukupHari != null
          ? `sisa ${angka(r.stok)} ${r.satuan} (± ${angka(r.cukupHari)} hari)`
          : `sisa ${angka(r.stok)} ${r.satuan}`;
    return `• ${r.nama} — beli ± ${angka(r.saranBeli)} ${r.satuan}\n  ${sisa}`;
  });

  return [
    ...kepala,
    '',
    ...garis,
    '',
    `${lap.perlu.length} bahan · target stok ${lap.hariAman} hari`
  ].join('\n');
}
