/**
 * BEP — titik impas, dihitung dari kejadian nyata.
 *
 * ============ BEDANYA DENGAN PROJECT HUB ============
 *
 * Project Hub meminta owner MENGETIK "HPP rata-rata" dan "harga jual rata-rata",
 * lalu menghitung BEP dari dua angka itu. Rata-ratanya rata-rata DATAR: kopi
 * yang terjual 400 gelas dan nasi goreng yang terjual 3 piring dihitung
 * sama-sama satu menu.
 *
 * Akibatnya bukan meleset sedikit. Menu mahal bermargin tebal yang hampir tidak
 * pernah laku akan menarik rata-rata margin ke atas, BEP-nya terlihat rendah,
 * dan usahanya tampak sudah lewat titik impas padahal belum. Kesalahan ini
 * selalu berpihak ke arah yang menyenangkan, jadi tidak ada yang curiga.
 *
 * Berjaya Hub sudah menyimpan `sales` per produk per hari. Jadi rata-ratanya
 * DITIMBANG dengan jumlah yang benar-benar terjual.
 *
 * ============ YANG SENGAJA TIDAK DIHITUNG DI SINI ============
 *
 * `fee_online_percent` dan `promo_percent` TIDAK dipakai di berkas ini, walau
 * kolomnya ada. Alasannya: `sales.unit_price` adalah harga yang BENAR-BENAR
 * ditagihkan, jadi potongan yang sudah terjadi sudah tercermin di dalamnya.
 * Menguranginya sekali lagi berarti memotong dua kali, dan BEP-nya akan
 * terlihat lebih jauh daripada kenyataan.
 *
 * Kedua angka itu hanya dipakai `pricing.js`, yang memang menghitung harga
 * SEANDAINYA — bukan harga yang sudah terjadi.
 *
 * Tidak ada impor di berkas ini.
 */

/**
 * Angka, atau `null`. Jenisnya diperiksa lebih dulu, BUKAN hasil konversinya —
 * `Number(null)` adalah 0 dan lolos `isFinite`, sehingga HPP kosong akan
 * berubah diam-diam menjadi nol dan marginnya jadi 100%. Penjelasan panjangnya
 * di `pricing.js`.
 */
const angka = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/**
 * Biaya tetap dari buku kas.
 *
 * Hanya entri KELUAR yang kategorinya ditandai `is_fixed_cost`. Entri kas
 * lainnya — pemasukan, transfer antar orang, mutasi antar kantong — bukan biaya
 * dan tidak boleh ikut. `amount` di buku kas bertanda (keluar = negatif), jadi
 * yang dijumlahkan nilai mutlaknya.
 *
 * @param {Array<{entry_type: string, amount: number, category_id: string|null}>} entri
 * @param {Array<{id: string, is_fixed_cost?: boolean, name?: string}>} kategori
 * @returns {{total: number, perKategori: Array<{id: string, nama: string, total: number}>,
 *            tanpaKategori: number}}
 */
export function biayaTetapDariKas(entri, kategori) {
  const tetap = new Map((kategori ?? []).filter((k) => k?.is_fixed_cost).map((k) => [k.id, k.name ?? '(tanpa nama)']));
  const perKategori = new Map();
  let total = 0;
  let tanpaKategori = 0;

  for (const e of entri ?? []) {
    if (e?.entry_type !== 'out') continue;
    const n = Math.abs(angka(e.amount) ?? 0);
    if (!(n > 0)) continue;

    if (e.category_id == null) {
      // Dihitung terpisah, tidak diam-diam dibuang. Kas keluar tanpa kategori
      // tetap uang yang keluar; kalau jumlahnya besar, itu berarti penandaan
      // biaya tetapnya belum selesai — dan itu harus terlihat, bukan hilang.
      tanpaKategori += n;
      continue;
    }
    if (!tetap.has(e.category_id)) continue;

    total += n;
    perKategori.set(e.category_id, (perKategori.get(e.category_id) ?? 0) + n);
  }

  return {
    total,
    tanpaKategori,
    perKategori: [...perKategori.entries()]
      .map(([id, jumlah]) => ({ id, nama: tetap.get(id) ?? '(tanpa nama)', total: jumlah }))
      .sort((a, b) => b.total - a.total)
  };
}

/**
 * Bauran penjualan: rata-rata harga & HPP yang DITIMBANG jumlah terjual.
 *
 * @param {Array<{product_id: string, qty: number, unit_price?: number|null, revenue?: number|null}>} sales
 * @param {Array<{id: string, name: string, packaging_cost?: number}>} products
 * @param {Map<string, number|null>} biaya hasil computeCosts()
 */
export function bauranPenjualan({ sales, products, biaya }) {
  const produkById = new Map((products ?? []).map((p) => [p.id, p]));
  const hpp = biaya instanceof Map ? biaya : new Map(Object.entries(biaya ?? {}));

  const kumpul = new Map(); // productId -> {qty, omzet}
  for (const s of sales ?? []) {
    const q = angka(s?.qty);
    if (q == null || q <= 0) continue;
    const pid = s.product_id;
    if (!pid) continue;

    // Omzet baris: `revenue` kalau ada, kalau tidak qty x unit_price.
    const rev = angka(s.revenue);
    const sat = angka(s.unit_price);
    const omzet = rev != null ? rev : sat != null ? sat * q : null;

    const cur = kumpul.get(pid) ?? { qty: 0, omzet: 0, adaHarga: true };
    cur.qty += q;
    if (omzet == null) cur.adaHarga = false;
    else cur.omzet += omzet;
    kumpul.set(pid, cur);
  }

  const baris = [];
  const terlewat = [];
  let totalQty = 0;
  let totalOmzet = 0;
  let totalHpp = 0;
  let qtyTerlewat = 0;

  for (const [pid, { qty, omzet, adaHarga }] of kumpul) {
    const p = produkById.get(pid);
    const nama = p?.name ?? '(produk tidak dikenal)';
    const kemasan = angka(p?.packaging_cost) ?? 0;
    const satuanHpp = hpp.get(pid);
    const c = angka(satuanHpp);

    // Dua sebab sebuah menu tidak bisa ikut dihitung. Keduanya DIKELUARKAN dari
    // rata-rata, bukan dianggap nol.
    //
    // Menganggap HPP kosong sebagai 0 adalah kesalahan yang paling mahal di
    // seluruh berkas ini: marginnya jadi 100%, BEP-nya anjlok, dan angkanya
    // tetap terlihat masuk akal. Lebih baik menu itu absen dan absennya
    // dilaporkan.
    if (!adaHarga) {
      terlewat.push({ productId: pid, nama, qty, sebab: 'Penjualannya tidak mencatat harga' });
      qtyTerlewat += qty;
      continue;
    }
    if (c == null) {
      terlewat.push({ productId: pid, nama, qty, sebab: 'HPP belum bisa dihitung' });
      qtyTerlewat += qty;
      continue;
    }

    const hppSatuan = c + kemasan;
    const hargaRata = omzet / qty;
    baris.push({
      productId: pid,
      nama,
      qty,
      omzet,
      hargaRata,
      hppSatuan,
      marginSatuan: hargaRata - hppSatuan,
      kontribusi: omzet - hppSatuan * qty
    });

    totalQty += qty;
    totalOmzet += omzet;
    totalHpp += hppSatuan * qty;
  }

  const hargaTertimbang = totalQty > 0 ? totalOmzet / totalQty : null;
  const hppTertimbang = totalQty > 0 ? totalHpp / totalQty : null;

  for (const b of baris) b.porsiPersen = totalQty > 0 ? (b.qty / totalQty) * 100 : 0;
  baris.sort((a, b) => b.kontribusi - a.kontribusi);

  return {
    baris,
    terlewat,
    totalQty,
    totalOmzet,
    qtyTerlewat,
    // Seberapa besar bagian yang tidak terhitung. Dipakai layar untuk
    // memutuskan apakah angkanya layak ditampilkan tanpa peringatan.
    persenTerlewat: totalQty + qtyTerlewat > 0 ? (qtyTerlewat / (totalQty + qtyTerlewat)) * 100 : 0,
    hargaTertimbang,
    hppTertimbang,
    marginTertimbang: hargaTertimbang == null || hppTertimbang == null ? null : hargaTertimbang - hppTertimbang
  };
}

/**
 * Titik impas.
 *
 * @param {{marginSatuan: number|null, hargaRata: number|null, biayaTetap: number,
 *          targetLaba?: number, hariKerja?: number}} a
 * @returns {{porsi: number|null, omzet: number|null, porsiHarian: number|null,
 *            omzetHarian: number|null, sebab: string|null, peringatan: string[]}}
 */
export function hitungBep({ marginSatuan, hargaRata, biayaTetap, targetLaba = 0, hariKerja = 30 }) {
  const m = angka(marginSatuan);
  const h = angka(hargaRata);
  const tetap = angka(biayaTetap) ?? 0;
  const target = angka(targetLaba) ?? 0;
  const hari = angka(hariKerja) ?? 0;

  const kosong = { porsi: null, omzet: null, porsiHarian: null, omzetHarian: null };
  const peringatan = [];

  if (m == null || h == null) {
    return { ...kosong, sebab: 'Belum ada penjualan yang bisa dihitung pada rentang ini', peringatan };
  }

  // Margin nol atau minus: tiap porsi yang terjual justru menambah kerugian.
  // Membaginya akan menghasilkan Infinity atau angka NEGATIF — dan BEP negatif
  // terbaca seolah targetnya sudah terlampaui, yaitu kebalikan persis dari
  // keadaan sebenarnya.
  if (m <= 0) {
    return {
      ...kosong,
      sebab:
        m === 0
          ? 'Harga jual rata-rata persis sama dengan HPP — berapa pun yang terjual, biaya tetap tidak akan tertutup'
          : 'Harga jual rata-rata masih DI BAWAH HPP — setiap porsi yang terjual menambah rugi, jadi tidak ada titik impas',
      peringatan
    };
  }

  if (tetap <= 0) {
    // BEP 0 secara matematis benar, tapi hampir pasti salah secara kenyataan:
    // usaha yang punya sewa dan gaji tidak mungkin nol. Yang jauh lebih mungkin
    // adalah kategori kasnya belum ditandai sebagai biaya tetap.
    peringatan.push('Biaya tetap terbaca nol — kemungkinan besar kategori kas belum ditandai sebagai biaya tetap, bukan karena benar-benar tidak ada biaya.');
  }

  const porsi = (tetap + target) / m;
  const omzet = porsi * h;

  if (!(hari > 0)) peringatan.push('Jumlah hari kerja belum diisi, jadi target harian tidak dihitung.');

  return {
    porsi,
    omzet,
    porsiHarian: hari > 0 ? porsi / hari : null,
    omzetHarian: hari > 0 ? omzet / hari : null,
    sebab: null,
    peringatan
  };
}

/**
 * Sudah lewat titik impas atau belum, pada rentang yang sedang dilihat.
 *
 * Dipisah dari `hitungBep` karena ini pertanyaan yang berbeda: bukan "berapa
 * yang harus terjual", melainkan "yang kemarin sudah cukup atau belum".
 */
export function posisiTerhadapBep({ totalQty, bepPorsi }) {
  const q = angka(totalQty);
  const b = angka(bepPorsi);
  if (q == null || b == null || !(b > 0)) return { persen: null, lewat: null, selisih: null };
  return {
    persen: (q / b) * 100,
    lewat: q >= b,
    selisih: q - b
  };
}
