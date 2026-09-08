/**
 * Satu bahan, satu baris — di order, surat jalan, maupun nota.
 *
 * ============ MASALAHNYA ============
 *
 *   "didalam satu nomor order, jangan ada bahan dengan nama yang sama, jadi
 *    jika staff a order bahan a, maka staff b tidak bisa pilih bahan a lagi
 *    kecuali ia menambahkan jumlah order nya"
 *
 * Sejak 0110 order milik OUTLET, bukan pembuatnya: bar mengisi sirup, kitchen
 * menambah daging, semuanya ke satu nomor order. Layar edit menampilkan isi
 * yang sudah ada, lalu menyediakan tombol "+ Tambah Produk" — dan tidak ada
 * apa pun yang menahan orang kedua memilih barang yang sudah dipesan orang
 * pertama.
 *
 * Hasilnya dua baris untuk satu barang. Tidak ada error, tidak ada peringatan,
 * dan keduanya terlihat wajar. Yang menemukannya adalah staff CK yang
 * menyiapkan barang sambil membaca daftar — dan pada saat itu ia harus menebak
 * apakah 100 dan 150 berarti 250, atau salah satunya salah ketik.
 *
 * ============ DIJUMLAHKAN, TAPI DI DEPAN MATA ============
 *
 * Penggabungannya TIDAK dilakukan diam-diam. Staff B yang mengetik 150 harus
 * melihat angkanya jadi 250 sebelum menyimpan; penjumlahan senyap membuatnya
 * mengira ia memesan 150.
 *
 * Berkas ini murni — tidak ada DOM, tidak ada impor — supaya aturannya bisa
 * diuji tanpa browser.
 */

const angka = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const kunci = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Baris mana saja yang produknya kembar.
 *
 * @param {Array<{product_id?: string}>} items
 * @returns {Map<string, number[]>} product_id -> daftar INDEKS, hanya yang >1
 */
export function cariDuplikat(items) {
  const per = new Map();
  const daftar = Array.isArray(items) ? items : [];
  daftar.forEach((it, i) => {
    const id = kunci(it?.product_id);
    // Baris yang produknya belum dipilih bukan duplikat — ia baris kosong yang
    // memang selalu ada satu di bawah daftar. Menghitungnya akan membuat
    // seluruh form ditandai merah sejak dibuka.
    if (!id) return;
    if (!per.has(id)) per.set(id, []);
    per.get(id).push(i);
  });
  const kembar = new Map();
  for (const [id, idx] of per) if (idx.length > 1) kembar.set(id, idx);
  return kembar;
}

/** Apakah ada baris kembar sama sekali? */
export function adaDuplikat(items) {
  return cariDuplikat(items).size > 0;
}

/**
 * Gabungkan baris kembar jadi satu.
 *
 * Baris PERTAMA yang menang tempat: ia biasanya milik rekan yang lebih dulu
 * mengisi, dan memindahkan barangnya ke bawah daftar membuat orang mengira
 * pesanannya hilang.
 *
 * ============ HARGA TIDAK DIJUMLAHKAN KALAU SALAH SATUNYA KOSONG ============
 *
 * Di nota supplier tiap baris punya `line_total`. Kalau baris A berharga
 * Rp5.000 untuk 100 gr dan baris B belum diisi harganya, menjumlahkan begitu
 * saja menghasilkan 250 gr seharga Rp5.000 — biaya per gram anjlok dari 50 ke
 * 20, dan angka itu masuk ke rata-rata biaya bahan seolah-olah pembelian
 * sungguhan.
 *
 * Jadi harganya DIKOSONGKAN dan keadaannya dilaporkan, supaya layar bisa
 * memintanya diisi ulang. Harga kosong ditahan `0122` sebelum nota bisa
 * dilunasi; harga yang salah tidak ditahan siapa pun.
 *
 * @param {Array<{product_id?: string, qty?: any, line_total?: any}>} items
 * @returns {{items: Array, digabung: Array<{product_id: string, dari: number, qty: number, hargaHilang: boolean}>}}
 */
export function gabungDuplikat(items) {
  const daftar = Array.isArray(items) ? items : [];
  const kembar = cariDuplikat(daftar);
  if (!kembar.size) return { items: daftar.slice(), digabung: [] };

  const hasil = [];
  const digabung = [];
  const sudah = new Set();

  for (const it of daftar) {
    const id = kunci(it?.product_id);
    if (!id || !kembar.has(id)) {
      hasil.push({ ...it });
      continue;
    }
    if (sudah.has(id)) continue; // baris kembar berikutnya dibuang, isinya sudah ikut
    sudah.add(id);

    const idx = kembar.get(id);
    let qty = 0;
    let harga = 0;
    let adaHargaKosong = false;
    for (const j of idx) {
      qty += angka(daftar[j]?.qty) ?? 0;
      const h = angka(daftar[j]?.line_total);
      if (h === null) adaHargaKosong = true;
      else harga += h;
    }

    hasil.push({
      ...it,
      qty,
      // `undefined` (bukan `null`) supaya baris yang memang tidak punya konsep
      // harga — order, surat jalan — tidak tiba-tiba membawa kolom baru.
      line_total: 'line_total' in (it ?? {}) ? (adaHargaKosong ? null : harga) : it?.line_total
    });
    digabung.push({ product_id: id, dari: idx.length, qty, hargaHilang: adaHargaKosong && 'line_total' in (it ?? {}) });
  }

  return { items: hasil, digabung };
}

/**
 * Kalimat siap-tampil untuk satu baris yang kembar.
 *
 * Menyebut NAMA dan JUMLAH yang sudah ada. "Produk ini sudah dipilih" saja
 * memaksa orang menggulir daftar untuk mencari barisnya sendiri, dan di layar
 * HP daftar itu bisa panjang.
 */
export function pesanDuplikat(nama, qtyAda, satuan) {
  const n = String(nama ?? 'Bahan ini').trim() || 'Bahan ini';
  const q = angka(qtyAda);
  return q === null
    ? `${n} sudah ada di daftar. Ubah jumlah di baris itu, jangan tambah baris baru.`
    : `${n} sudah ada di daftar (${q}${satuan ? ' ' + satuan : ''}). Ubah jumlah di baris itu, jangan tambah baris baru.`;
}
