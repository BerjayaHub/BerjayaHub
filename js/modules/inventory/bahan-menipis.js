/**
 * BAHAN MENIPIS — stok akhir dibagi takaran resep = CUKUP BERAPA PORSI LAGI.
 *
 * Tidak ada impor di file ini, dan sebaiknya tetap begitu: angkanya dipakai
 * menyusun daftar belanja, dan angka yang tidak bisa diuji di luar browser
 * adalah angka yang tidak pernah benar-benar diperiksa.
 *
 * =====================================================================
 * KENAPA PORSI, BUKAN HARI (perubahan dari 0087 ke 0091)
 * =====================================================================
 *
 * Versi sebelumnya menghitung pemakaian/hari dari penjualan 28 hari terakhir.
 * Itu menuntut penjualan diinput rajin setiap hari — dan outlet yang belum
 * pernah mengisinya mendapat pemakaian nol untuk semua bahan, sehingga
 * daftarnya selalu kosong. Layar yang selalu bilang "tidak ada yang menipis"
 * persis sama tidak bergunanya dengan layar yang tidak ada.
 *
 * "Cukup berapa porsi lagi" hanya butuh dua hal yang memang selalu ada: stok
 * dan resep. Ia bekerja di hari pertama outlet dipakai.
 *
 * =====================================================================
 * SATU BAHAN, BANYAK MENU — RATA-RATA
 * =====================================================================
 *
 * Ayam dipakai Nasi Ayam (0,2 kg/porsi) dan Soto (0,1 kg/porsi). Takaran yang
 * dipakai adalah RATA-RATA dari semua menu yang memakainya: 0,15 kg/porsi.
 *
 * Ini pilihan yang diminta, dan konsekuensinya perlu ditulis terang-terangan:
 * rata-rata bisa TERLAMBAT memperingatkan kalau menu yang paling laris
 * kebetulan yang paling boros. Ayam 5 kg terbaca "cukup 33 porsi", padahal
 * kalau yang terjual semuanya Nasi Ayam ia hanya cukup 25.
 *
 * Yang menutup celah itu adalah BATAS MANUAL per bahan — bahan yang terbukti
 * sering meleset bisa dikunci ke angka tetap oleh admin.
 *
 * Rata-ratanya TIDAK ditimbang penjualan. Menimbangnya akan mengembalikan
 * ketergantungan pada data penjualan yang justru baru saja dibuang.
 *
 * =====================================================================
 * MENU "DILAYANI CK" TIDAK IKUT
 * =====================================================================
 *
 * Kalau sebuah menu hanya punya resep varian "Dilayani CK", Central Kitchen
 * yang membuatnya dan outlet menerimanya jadi. Bahan-bahannya tidak pernah ada
 * di gerai, dan tidak seharusnya ada. Ikut menghitungnya akan menyuruh gerai
 * membeli cabai yang bukan urusannya — dan daftar seperti itu berhenti dibaca
 * orang.
 *
 * =====================================================================
 * DUA JENIS BATAS, SATU SATUAN
 * =====================================================================
 *
 *   batas (dalam satuan bahannya, mis. kg)
 *     = batas manual            kalau ada barisnya
 *     = takaran rata × minPorsi kalau tidak
 *
 * Disamakan satuannya dengan sengaja: seluruh tabel jadi satu perbandingan
 * "stok vs batas", dan kolom porsi tinggal keterangan. Kalau dibiarkan dua
 * satuan yang berbeda, tiap baris menuntut pembacanya ingat sedang melihat
 * yang mana.
 *
 * `batasManual = 0` BUKAN "belum diatur" — itu pernyataan sadar "jangan
 * diawasi". Yang dibedakan ADA/TIDAK ADA barisnya, bukan nilainya nol atau
 * bukan.
 */

/** Ambang yang dianggap "nol" — melindungi dari sisa pembagian floating point. */
const EPS = 1e-9;

/**
 * Bentangkan resep satu produk jadi bahan per 1 satuan hasil.
 *
 * Sama bentuknya dengan `buildCostFn` di `hpp.js` — menelusuri resep secara
 * rekursif dengan memo dan penjaga siklus. Yang berbeda hanya apa yang
 * dijumlahkan: di sana rupiah, di sini jumlah bahan.
 *
 * Pemakaian dijumlahkan di SETIAP tingkat, bukan hanya di daun: menjual Nasi
 * Ayam memakai sambal (setengah jadi), dan membuat sambal memakai cabai. Dua-
 * duanya habis, dua-duanya perlu diawasi.
 */
export function pembentangResep(products, recipes) {
  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const recipeByKey = new Map((recipes ?? []).map((r) => [`${r.product_id}|${r.mode}`, r]));
  const memo = new Map();

  /** Resep yang berlaku untuk produk ini DI OUTLET (bukan di CK). */
  function resepBerlaku(p) {
    if (!p) return null;
    if (p.product_type === 'semi') return recipeByKey.get(`${p.id}|production`) ?? null;
    // Sengaja hanya 'standalone'. Kalau cuma ada varian CK, kembalikan null.
    if (p.product_type === 'finished') return recipeByKey.get(`${p.id}|standalone`) ?? null;
    return null;
  }

  function bentang(pid, sedangDilalui) {
    if (memo.has(pid)) return memo.get(pid);

    const r = resepBerlaku(productById.get(pid));
    const hasil = new Map();

    if (!r || !r.items?.length || !(Number(r.yield_qty) > 0)) {
      memo.set(pid, hasil);
      return hasil;
    }

    // SIKLUS. Resep bersiklus tidak seharusnya ada (dijaga saat menyimpan),
    // tapi data lama bisa memuatnya. Yang penting: berhenti, JANGAN melempar.
    // Satu resep bersiklus tidak boleh membuat seluruh daftar belanja gagal
    // tampil — itu menukar satu baris salah dengan layar kosong.
    if (sedangDilalui.has(pid)) return hasil;
    sedangDilalui.add(pid);

    const yieldQty = Number(r.yield_qty);
    for (const it of r.items) {
      const bid = it.ingredient_product_id;
      const per = Number(it.qty) / yieldQty;
      if (!Number.isFinite(per)) continue;

      hasil.set(bid, (hasil.get(bid) ?? 0) + per);
      for (const [cid, cper] of bentang(bid, sedangDilalui)) {
        hasil.set(cid, (hasil.get(cid) ?? 0) + per * cper);
      }
    }

    sedangDilalui.delete(pid);
    memo.set(pid, hasil);
    return hasil;
  }

  return (id) => bentang(id, new Set());
}

/**
 * Takaran rata-rata tiap bahan per SATU PORSI menu.
 *
 * @returns {Map<string, {rata: number, jumlahMenu: number, min: number, maks: number}>}
 */
export function takaranPerPorsi(products, recipes) {
  const bentang = pembentangResep(products, recipes);
  const kumpul = new Map(); // bahanId -> number[]

  for (const p of products ?? []) {
    if (p.product_type !== 'finished') continue;
    if (p.is_active === false) continue;
    const isi = bentang(p.id);
    // Menu tanpa resep standalone (termasuk yang hanya dilayani CK) tidak
    // menyumbang takaran apa pun di outlet ini.
    if (!isi.size) continue;
    for (const [bid, per] of isi) {
      if (!(per > 0)) continue;
      if (!kumpul.has(bid)) kumpul.set(bid, []);
      kumpul.get(bid).push(per);
    }
  }

  const out = new Map();
  for (const [bid, daftar] of kumpul) {
    const total = daftar.reduce((a, b) => a + b, 0);
    out.set(bid, {
      rata: total / daftar.length,
      jumlahMenu: daftar.length,
      min: Math.min(...daftar),
      maks: Math.max(...daftar)
    });
  }
  return out;
}

/**
 * Susun tabel bahan menipis.
 *
 * @param {object}   o
 * @param {object[]} o.products
 * @param {object[]} o.recipes
 * @param {Map}      o.stok         productId → jumlah stok sekarang
 * @param {number}   o.minPorsi     `outlets.min_porsi`
 * @param {Map}      [o.batasManual] productId → min_qty (ADA/TIDAK ADA berarti)
 */
export function susunBahanMenipis({ products, recipes, stok, minPorsi, batasManual = new Map() }) {
  const takaran = takaranPerPorsi(products, recipes);
  const porsiTarget = Number(minPorsi) > 0 ? Number(minPorsi) : 30;

  const baris = [];
  let tersembunyi = 0;

  for (const p of products ?? []) {
    // Menu tidak dibeli, jadi tidak masuk daftar belanja. Yang diawasi hanya
    // yang benar-benar distok di gudang outlet.
    if (p.product_type === 'finished') continue;
    if (p.is_active === false) continue;

    const t = takaran.get(p.id) ?? null;
    const punyaManual = batasManual.has(p.id);
    const ada = Number(stok?.get(p.id) ?? 0);

    // Bahan yang tidak dipakai resep mana pun (gas, tisu, sedotan, kemasan)
    // tidak punya angka porsi. Ia hanya diawasi kalau admin memberinya batas
    // manual — dan itu satu-satunya cara barang seperti itu bisa muncul di
    // daftar mana pun. Yang tidak punya keduanya disembunyikan, tapi JUMLAHNYA
    // tetap dilaporkan lewat `tersembunyi` supaya tidak hilang tanpa jejak.
    if (!t && !punyaManual) {
      tersembunyi++;
      continue;
    }

    const batas = punyaManual ? Number(batasManual.get(p.id)) : t.rata * porsiTarget;

    // Batas 0 = sengaja tidak diawasi. Bukan "aman" — memang tidak ikut.
    if (!(batas > EPS)) continue;

    // Porsi hanya punya arti kalau bahannya dipakai resep.
    const porsi = t ? ada / t.rata : null;

    baris.push({
      productId: p.id,
      nama: p.name,
      satuan: p.base_unit,
      kategori: p.category ?? null,
      stok: ada,
      takaran: t ? t.rata : null,
      jumlahMenu: t ? t.jumlahMenu : 0,
      // Selisih takaran antar menu — dipakai layar untuk menandai bahan yang
      // rata-ratanya paling mungkin menyesatkan.
      takaranMin: t ? t.min : null,
      takaranMaks: t ? t.maks : null,
      porsi,
      minPorsi: punyaManual ? null : porsiTarget,
      batas,
      batasManual: punyaManual,
      saranBeli: Math.max(0, batas - ada),
      status: ada <= EPS ? 'habis' : ada < batas - EPS ? 'menipis' : 'aman'
    });
  }

  // Urutan: habis dulu, lalu yang porsinya paling sedikit. Yang aman tetap
  // ikut supaya layarnya bisa dipakai memeriksa satu bahan tertentu, tapi
  // tidak pernah menghalangi yang mendesak.
  const pangkat = { habis: 0, menipis: 1, aman: 2 };
  baris.sort((a, b) => {
    if (pangkat[a.status] !== pangkat[b.status]) return pangkat[a.status] - pangkat[b.status];
    const pa = a.porsi ?? Infinity;
    const pb = b.porsi ?? Infinity;
    if (pa !== pb) return pa - pb;
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
    minPorsi: porsiTarget
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

  if (!lap.perlu?.length) {
    return [...kepala, '', 'Tidak ada bahan yang menipis. 👍'].join('\n');
  }

  const garis = lap.perlu.map((r) => {
    const sisa =
      r.status === 'habis'
        ? 'HABIS'
        : r.porsi != null
          ? `sisa ${angka(r.stok)} ${r.satuan} (± ${angka(r.porsi)} porsi)`
          : `sisa ${angka(r.stok)} ${r.satuan}`;
    return `• ${r.nama} — beli ± ${angka(r.saranBeli)} ${r.satuan}\n  ${sisa}`;
  });

  return [...kepala, '', ...garis, '', `${lap.perlu.length} bahan · target cukup ${lap.minPorsi} porsi`].join('\n');
}
