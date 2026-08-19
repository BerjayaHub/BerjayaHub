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
export function hitungBep({
  marginSatuan,
  hargaRata,
  biayaTetap,
  targetLaba = 0,
  hariKerja = 30,
  variabelPerPorsi = 0,
  variabelPersen = 0
}) {
  // Biaya variabel mengurangi MARGIN, bukan menambah biaya tetap. Kalau ia
  // ditambahkan ke pembilang, BEP-nya naik sedikit dan tetap terlihat wajar —
  // padahal arah pengaruhnya sama sekali lain: biaya variabel membuat tiap
  // porsi tambahan menutup lebih sedikit, bukan membuat bebannya lebih berat
  // di awal.
  const m = marginSetelahVariabel({ marginKotor: marginSatuan, hargaRata, variabelPerPorsi, variabelPersen });
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
    // Dibedakan: margin yang habis KARENA biaya variabel mengarahkan orang ke
    // tempat yang benar untuk memperbaikinya. Pesan "harga di bawah HPP" akan
    // mengirim orang membongkar resep yang sebenarnya sudah benar.
    const kotor = angka(marginSatuan);
    const habisKarenaVariabel = kotor != null && kotor > 0;

    return {
      ...kosong,
      sebab: habisKarenaVariabel
        ? 'Margin per porsi habis oleh biaya variabel — sebelum biaya variabel marginnya masih positif, jadi periksa daftar biaya variabelnya, bukan resepnya'
        : m === 0
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
    // Margin SESUDAH biaya variabel — dibawa keluar supaya layar dan panel
    // Target memakai angka yang sama persis, bukan menghitung ulang sendiri.
    marginEfektif: m,
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

// =====================================================================
// BIAYA YANG DIDAFTARKAN PER OUTLET (0095)
// =====================================================================

/**
 * Ringkas daftar biaya jadi tiga angka yang dipakai rumus BEP.
 *
 * Biaya variabel TIDAK ikut ke biaya tetap. Ia mengurangi margin PER PORSI,
 * dan itu tempat yang sama sekali berbeda dalam rumusnya:
 *
 *     BEP porsi = biaya tetap / (harga - HPP - variabel per porsi - harga x persen)
 *
 * Menaruh biaya variabel di pembilang akan menghasilkan angka yang tetap
 * masuk akal dan tetap salah. Constraint `outlet_costs_satuan_cocok` di 0095
 * yang mencegah satuannya tertukar sejak dari database.
 *
 * @param {Array<{name:string, jenis:string, satuan:string, amount:number, is_active?:boolean}>} daftar
 */
export function ringkasBiayaOutlet(daftar) {
  let tetapPerBulan = 0;
  let variabelPerPorsi = 0;
  let variabelPersen = 0;
  const rincian = { tetap: [], variabel: [] };

  for (const b of daftar ?? []) {
    if (b?.is_active === false) continue;
    const n = angka(b?.amount);
    if (n == null || n < 0) continue;

    if (b.jenis === 'tetap' && b.satuan === 'per_bulan') {
      tetapPerBulan += n;
      rincian.tetap.push({ nama: b.name, jumlah: n });
    } else if (b.jenis === 'variabel' && b.satuan === 'per_porsi') {
      variabelPerPorsi += n;
      rincian.variabel.push({ nama: b.name, jumlah: n, satuan: 'per_porsi' });
    } else if (b.jenis === 'variabel' && b.satuan === 'persen_omzet') {
      variabelPersen += n;
      rincian.variabel.push({ nama: b.name, jumlah: n, satuan: 'persen_omzet' });
    }
    // Kombinasi lain diabaikan, BUKAN ditebak. Baris seperti itu hanya bisa
    // lahir dari data yang menembus constraint (mis. disisipkan lewat SQL), dan
    // menebak maksudnya berarti memasukkan angka ke rumus yang belum tentu
    // tempatnya.
  }

  rincian.tetap.sort((a, b) => b.jumlah - a.jumlah);
  return { tetapPerBulan, variabelPerPorsi, variabelPersen, rincian };
}

/**
 * Margin per porsi SESUDAH biaya variabel.
 *
 * Dipisah jadi fungsi sendiri karena dipakai dua tempat — `hitungBep` dan
 * `hitungTarget` — dan kalau masing-masing menghitungnya sendiri, keduanya
 * akan menyimpang begitu satu di antaranya diubah. Menyimpangnya tidak akan
 * terlihat: dua angka yang beda tipis di dua kartu berbeda.
 */
export function marginSetelahVariabel({ marginKotor, hargaRata, variabelPerPorsi = 0, variabelPersen = 0 }) {
  const m = angka(marginKotor);
  const h = angka(hargaRata);
  if (m == null) return null;

  const perPorsi = angka(variabelPerPorsi) ?? 0;
  const persen = angka(variabelPersen) ?? 0;
  const dariPersen = h == null ? 0 : (h * persen) / 100;

  return m - perPorsi - dariPersen;
}

/**
 * TARGET — dua arah.
 *
 * Project Hub hanya menyediakan satu arah: ketik target laba, lihat porsinya.
 * Di sini ketiganya saling bisa jadi masukan, karena pertanyaannya di lapangan
 * memang datang dari arah mana saja:
 *
 *   "kalau mau untung 20 juta, harus jual berapa?"     -> jenis 'laba'
 *   "kalau omzetnya 100 juta, untungnya berapa?"       -> jenis 'omzet'
 *   "kalau jual 3.000 porsi, cukup tidak?"             -> jenis 'porsi'
 *
 * @param {{jenis:'laba'|'omzet'|'porsi', nilai:number}} target
 */
export function hitungTarget({ target, marginEfektif, hargaRata, biayaTetap, hariKerja = 30 }) {
  const m = angka(marginEfektif);
  const h = angka(hargaRata);
  const tetap = angka(biayaTetap) ?? 0;
  const hari = angka(hariKerja) ?? 0;
  const nilai = angka(target?.nilai);

  const kosong = { porsi: null, omzet: null, laba: null, porsiHarian: null, omzetHarian: null };

  if (m == null || h == null) {
    return { ...kosong, sebab: 'Belum ada penjualan yang bisa dihitung, jadi margin per porsinya belum diketahui.' };
  }
  if (m <= 0) {
    return {
      ...kosong,
      sebab:
        'Margin per porsi tidak positif sesudah biaya variabel — berapa pun targetnya, menambah penjualan justru menambah rugi.'
    };
  }
  if (nilai == null || nilai < 0) return { ...kosong, sebab: 'Angka targetnya belum diisi.' };

  let porsi;
  if (target.jenis === 'laba') porsi = (tetap + nilai) / m;
  else if (target.jenis === 'omzet') porsi = h > 0 ? nilai / h : null;
  else if (target.jenis === 'porsi') porsi = nilai;
  else return { ...kosong, sebab: `Jenis target tidak dikenal: ${target.jenis}` };

  if (porsi == null) return { ...kosong, sebab: 'Harga jual rata-rata nol, jadi omzet tidak bisa diubah jadi porsi.' };

  const omzet = porsi * h;
  // Laba di sini LABA SEBELUM biaya yang tidak pernah lewat sini — pajak,
  // penyusutan, bunga. Dinamai apa adanya di layar supaya tidak dipakai
  // sebagai laba bersih.
  const laba = porsi * m - tetap;

  return {
    porsi,
    omzet,
    laba,
    porsiHarian: hari > 0 ? porsi / hari : null,
    omzetHarian: hari > 0 ? omzet / hari : null,
    sebab: null
  };
}
