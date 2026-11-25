/**
 * ATURAN BARIS PEMBELIAN MANUAL (0191).
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase.
 *
 * Saudara kembar `baris-korporat.js` (sisi penjualan), dan sengaja BUKAN
 * fungsi yang sama dipakai dua kali: kedua sisi memang mirip di layar, tapi
 * aturannya berbeda di tempat yang justru paling mudah tertukar.
 *
 *   penjualan : harga JUAL wajib, modal boleh kosong (= tidak diketahui)
 *   pembelian : harga BELI boleh kosong (= belum tahu / nota menyusul),
 *               dan tidak ada modal sama sekali
 *
 * Disatukan, satu-satunya cara membedakannya adalah sebuah bendera — dan
 * bendera yang salah nilainya menukar "boleh kosong" dengan "wajib" tanpa satu
 * pun galat: harga beli yang kosong akan tersimpan sebagai 0, lalu laporan
 * pengeluaran membacanya sebagai barang gratis.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/** Angka dari isian manusia: "150.000", "Rp 150000", "1,5" — menolak sampah. */
export function angkaIsian(v) {
  if (v === null || v === undefined) return null;
  const s = teks(v)
    .replace(/[Rr][Pp]\.?/g, '')
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  if (s === '') return null;
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function barisBeliKosong() {
  return { sparepart_id: '', sku: '', nama: '', qty: '', harga: '', catatan: '' };
}

/** Isi baris dari master sparepart. Harga BELI yang diusulkan, bukan jual. */
export function beliDariMaster(sp) {
  if (!sp) return barisBeliKosong();
  return {
    sparepart_id: teks(sp.id),
    sku: teks(sp.sku),
    nama: teks(sp.name),
    qty: '',
    // `harga_beli`, BUKAN `harga_jual`. Tertukar, seluruh laporan pengeluaran
    // membengkak sebesar marginnya — dan angkanya tetap terlihat wajar karena
    // ia memang harga yang pernah ada di master.
    harga: sp.harga_beli === null || sp.harga_beli === undefined ? '' : String(sp.harga_beli),
    catatan: ''
  };
}

/** Nilai satu baris = harga × qty. Dihitung, tidak pernah diketik. */
export function nilaiBarisBeli(b) {
  const q = angkaIsian(b?.qty);
  const h = angkaIsian(b?.harga);
  if (q === null || h === null) return null;
  return Math.round(q * h * 100) / 100;
}

export function barisBeliKosongSemua(b) {
  return ['sku', 'nama', 'qty', 'harga', 'catatan'].every((k) => teks(b?.[k]).trim() === '');
}

/**
 * Periksa satu baris. Mengembalikan '' kalau sah.
 *
 * Harga BOLEH kosong: bon tulis tangan sering baru menyebut harganya di akhir
 * bulan. Yang tidak boleh adalah harga yang DIISI tapi bukan angka — itu
 * kekeliruan ketik, dan membiarkannya lewat berarti menyimpannya sebagai
 * "tidak diketahui" yang tidak pernah dibetulkan siapa pun.
 */
export function sahkanBarisBeli(b) {
  if (barisBeliKosongSemua(b)) return '';
  if (!teks(b?.nama).trim()) return 'nama barang belum diisi';
  const q = angkaIsian(b?.qty);
  if (q === null) return 'qty bukan angka';
  if (q <= 0) return 'qty harus lebih dari 0';
  const h = teks(b?.harga).trim();
  if (h !== '') {
    const n = angkaIsian(h);
    if (n === null) return 'harga beli bukan angka';
    if (n < 0) return 'harga beli tidak boleh minus';
  }
  return '';
}

/**
 * Susun baris siap-kirim.
 *
 * @returns {{baris: Array, salah: string[]}}
 */
export function susunBarisBeli(rows) {
  const baris = [];
  const salah = [];
  (Array.isArray(rows) ? rows : []).forEach((b, i) => {
    if (barisBeliKosongSemua(b)) return;
    const pesan = sahkanBarisBeli(b);
    if (pesan) {
      salah.push(`Baris ${i + 1}: ${pesan}.`);
      return;
    }
    const h = teks(b.harga).trim();
    baris.push({
      sku: teks(b.sku).trim(),
      nama: teks(b.nama).trim(),
      qty: angkaIsian(b.qty),
      // Kosong tetap KOSONG, bukan nol — lihat kepala berkas. Nol adalah
      // harga; kosong berarti belum tahu, dan laporan pengeluaran yang
      // menjumlahkan nol sebagai harga akan diam saja.
      harga: h === '' ? '' : String(angkaIsian(h)),
      total: h === '' ? '' : String(nilaiBarisBeli(b)),
      catatan: teks(b.catatan).trim()
    });
  });
  return { baris, salah };
}

/** Ringkasan untuk ditampilkan di bawah daftar saat masih mengetik. */
export function ringkasBarisBeli(rows) {
  const { baris } = susunBarisBeli(rows);
  const r = { baris: baris.length, qty: 0, nilai: 0, tanpaHarga: 0 };
  for (const b of baris) {
    r.qty += Number(b.qty) || 0;
    if (b.harga === '') r.tanpaHarga += 1;
    else r.nilai += Number(b.total) || 0;
  }
  r.nilai = Math.round(r.nilai * 100) / 100;
  r.qty = Math.round(r.qty * 1000) / 1000;
  return r;
}
