/**
 * ATURAN BARIS INVOICE KORPORAT.
 *
 * Murni: tidak menyentuh DOM, tidak menyentuh Supabase.
 *
 *   "di input korporate jadikan input dropdown sparepart yang terdaftar di
 *    berjaya hub, dan text box nya satu satu jangan dijadikan satu text box"
 *
 * ============ KENAPA BUKAN SATU KOTAK TEKS ============
 *
 * Versi pertamanya meminta seluruh baris diketik sebagai teks
 * (`sparepart | SKU | nama | qty | harga | modal`). Itu memang cepat ditulis
 * — oleh yang MEMBUATNYA. Bagi yang mengisinya tiap hari, satu pemisah `|`
 * yang hilang menggeser seluruh kolom sesudahnya: harga masuk ke kolom modal,
 * dan labanya tetap berupa angka yang masuk akal. Tidak ada galat, dan yang
 * menemukannya adalah orang yang membaca laporan sebulan kemudian.
 *
 * Berkas ini memegang aturan per BARIS, supaya layar cukup menggambar
 * kotaknya dan pemeriksaannya tidak disalin ulang di tempat lain.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/** Angka dari isian manusia: "150.000", "Rp 150000", "1.5" — menolak sampah. */
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

export function barisKosong() {
  return { item_type: 'sparepart', sparepart_id: '', sku: '', nama: '', qty: '', harga: '', modal: '' };
}

/**
 * Isi baris dari master sparepart yang dipilih.
 *
 * Harga jual ikut terisi sebagai USULAN, dan modal dari `harga_beli` kalau
 * ada. Keduanya TETAP bisa diubah: harga korporat sering berbeda dari harga
 * umum, dan mengunci isinya akan memaksa orang membatalkan pilihannya untuk
 * sekadar mengubah angka.
 *
 * Yang TIDAK diisi otomatis: qty. Angka itu satu-satunya yang benar-benar
 * harus datang dari orangnya, dan nilai bawaan "1" adalah cara tercepat
 * menyimpan jumlah yang tidak pernah dihitung siapa pun.
 */
export function dariMaster(sp) {
  if (!sp) return barisKosong();
  return {
    item_type: teks(sp.jenis) === 'jasa' ? 'jasa' : 'sparepart',
    sparepart_id: teks(sp.id),
    sku: teks(sp.sku),
    nama: teks(sp.name),
    qty: '',
    harga: sp.harga_jual === null || sp.harga_jual === undefined ? '' : String(sp.harga_jual),
    modal: sp.harga_beli === null || sp.harga_beli === undefined ? '' : String(sp.harga_beli)
  };
}

/** Total satu baris = harga × qty. Dihitung, tidak pernah diketik. */
export function totalBaris(b) {
  const q = angkaIsian(b?.qty);
  const h = angkaIsian(b?.harga);
  if (q === null || h === null) return null;
  return Math.round(q * h * 100) / 100;
}

/**
 * Periksa satu baris. Mengembalikan '' kalau sah.
 *
 * Baris yang SELURUHNYA kosong bukan kesalahan — ia baris yang memang belum
 * diisi, dan selalu ada satu di bawah daftar.
 */
export function sahkanBaris(b) {
  if (barisKosongSemua(b)) return '';
  if (!teks(b?.nama).trim()) return 'nama barang/jasa belum diisi';
  const q = angkaIsian(b?.qty);
  if (q === null) return 'qty bukan angka';
  if (q <= 0) return 'qty harus lebih dari 0';
  const h = angkaIsian(b?.harga);
  if (h === null) return 'harga jual bukan angka';
  if (h < 0) return 'harga jual tidak boleh minus';
  const m = teks(b?.modal).trim();
  if (m !== '' && angkaIsian(m) === null) return 'modal bukan angka';
  return '';
}

export function barisKosongSemua(b) {
  return ['nama', 'qty', 'harga', 'modal', 'sku'].every((k) => teks(b?.[k]).trim() === '');
}

/**
 * Susun baris siap-kirim.
 *
 * @returns {{baris: Array, salah: string[]}}
 */
export function susunBarisKorporat(rows) {
  const baris = [];
  const salah = [];
  (Array.isArray(rows) ? rows : []).forEach((b, i) => {
    if (barisKosongSemua(b)) return;
    const pesan = sahkanBaris(b);
    if (pesan) {
      salah.push(`Baris ${i + 1}: ${pesan}.`);
      return;
    }
    const m = teks(b.modal).trim();
    baris.push({
      item_type: teks(b.item_type) === 'jasa' ? 'jasa' : 'sparepart',
      sku: teks(b.sku).trim(),
      nama: teks(b.nama).trim(),
      qty: angkaIsian(b.qty),
      harga_satuan: angkaIsian(b.harga),
      total: totalBaris(b),
      // Modal yang DIKOSONGKAN tetap kosong — bukan 0. Lihat 0185: nol
      // membuat labanya terlihat 100%, dan laporan tidak punya cara
      // membedakannya dari laba sungguhan.
      modal: m === '' ? '' : String(angkaIsian(m))
    });
  });
  return { baris, salah };
}

/** Ringkasan untuk ditampilkan di bawah daftar saat masih mengetik. */
export function ringkasBarisKorporat(rows) {
  const { baris } = susunBarisKorporat(rows);
  const r = { baris: baris.length, total: 0, sparepart: 0, jasa: 0, tanpaModal: 0 };
  for (const b of baris) {
    r.total += Number(b.total) || 0;
    if (b.item_type === 'jasa') r.jasa += Number(b.total) || 0;
    else {
      r.sparepart += Number(b.total) || 0;
      if (b.modal === '') r.tanpaModal += 1;
    }
  }
  r.total = Math.round(r.total * 100) / 100;
  return r;
}
