/**
 * Biaya rata-rata bahan dari nota penerimaan — aturannya, dipisah supaya BISA DIUJI.
 *
 * ============ APA YANG DIHITUNG ============
 *
 * Rata-rata TERTIMBANG STOK (moving average), cara yang dipakai akuntansi
 * persediaan pada umumnya:
 *
 *     rata_baru = (stok_lama × rata_lama + qty_masuk × harga_nota)
 *                 ÷ (stok_lama + qty_masuk)
 *
 * Pemakaian bahan TIDAK mengubah angkanya — ia keluar pada harga rata-rata yang
 * sedang berlaku. Yang menggeser rata-rata hanya PEMBELIAN. Itu sebabnya
 * perhitungannya bisa diputar ulang dari riwayat nota saja, asalkan stok pada
 * tiap saat pembelian diketahui.
 *
 * ============ APA YANG TIDAK DILAKUKAN ============
 *
 * Angka ini TIDAK dipakai menghitung HPP menu. HPP tetap memakai "Harga Beli"
 * di Master Produk, dan itu keputusan yang disengaja: satu salah ketik harga di
 * nota tidak boleh menggeser HPP, margin, dan pertimbangan harga jual seluruh
 * menu yang memakai bahan itu — tanpa ada seorang pun yang menyetujuinya.
 *
 * Yang disediakan di sini adalah PEMBANDING: berapa harga sebenarnya yang
 * dibayar belakangan, dan seberapa jauh ia dari angka yang sedang dipakai
 * menghitung. Admin yang memutuskan kapan memperbaruinya.
 *
 * ============ PER OUTLET ============
 *
 * Stok dan nota keduanya milik outlet, jadi rata-ratanya pun per outlet. AB
 * Sentul yang membeli beras dari supplier berbeda punya angkanya sendiri.
 *
 * Ini murah justru KARENA angkanya tidak masuk HPP: mesin HPP, Profitabilitas,
 * BEP, dan Owner semuanya tetap berskala BU dan tidak perlu disentuh.
 *
 * Tidak ada impor di file ini, dan sebaiknya tetap begitu.
 */

/** Beda kecil karena pembagian floating point, bukan beda yang berarti. */
const EPS = 1e-9;

/**
 * Angka, atau `null` kalau memang TIDAK ADA.
 *
 * `Number(null)`, `Number('')`, dan `Number(undefined ?? '')` semuanya
 * menghasilkan **0** — bukan NaN. Jebakan ini sudah beberapa kali menggigit di
 * repo ini, dan di sini akibatnya paling mahal: harga yang belum diisi terbaca
 * sebagai "gratis", rata-rata anjlok, dan perbandingannya melaporkan −100%
 * sebagai temuan yang layak ditindaklanjuti.
 *
 * Tes yang menemukannya ditulis sebelum kodenya dianggap selesai; tanpa itu,
 * dua cabang di bawah akan salah tanpa satu pun error.
 */
function angka(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Putar ulang rata-rata tertimbang dari daftar pembelian.
 *
 * @param {Array<{qty:number, unitCost:number, stokSebelum:number}>} beli
 *        Urut menaik menurut waktu. `stokSebelum` = stok outlet itu untuk bahan
 *        itu PERSIS sebelum pembelian ini masuk.
 * @returns {{rata:number|null, dasar:number}} `rata` null = belum pernah ada
 *        nota berharga; `dasar` = total qty yang pernah dibeli berharga.
 */
export function rataTertimbang(beli) {
  const daftar = Array.isArray(beli) ? beli : [];
  let rata = null;
  let dasar = 0;

  for (const b of daftar) {
    const qty = angka(b?.qty);
    const harga = angka(b?.unitCost);
    // Pembelian tanpa harga TIDAK menarik rata-rata ke nol.
    //
    // Nota lama diinput sebelum kotak harganya ada, dan staff boleh
    // mengosongkannya kalau memang belum tahu harganya. Memperlakukan kosong
    // sebagai 0 akan membuat rata-rata anjlok setiap kali itu terjadi — dan
    // angka yang anjlok tanpa sebab jauh lebih merusak kepercayaan daripada
    // angka yang belum ada.
    if (qty == null || qty <= EPS) continue;
    if (harga == null || harga < 0) continue;

    // Stok sebelumnya <= 0 -> tidak ada apa pun untuk dirata-ratakan, jadi
    // harga nota ini yang berlaku seluruhnya.
    //
    // Stok MINUS bisa terjadi di sistem ini (penjualan sengaja boleh membuat
    // stok negatif). Memasukkan angka negatif ke rumusnya menghasilkan
    // rata-rata negatif atau pembagian mendekati nol — angka gila yang muncul
    // justru pada bahan yang paling sibuk.
    const stokLama = angka(b?.stokSebelum);
    const lamaSah = rata != null && stokLama != null && stokLama > EPS;

    rata = lamaSah ? (stokLama * rata + qty * harga) / (stokLama + qty) : harga;
    dasar += qty;
  }

  return { rata: rata == null ? null : bulatkan(rata), dasar };
}

/** Dua desimal — rupiah per satuan pakai (gram, ml) sering pecahan kecil. */
function bulatkan(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Harga master per satuan-pakai, dari kolom Master Produk.
 *
 * Bentuknya `purchase_price / purchase_qty` — persis yang dipakai mesin HPP
 * (`hpp.js`). Ditulis ulang di sini alih-alih diimpor supaya modul ini tetap
 * tanpa impor; kalau rumusnya berubah di sana, `audit-biaya-rata.cjs` yang
 * meneriakkannya.
 */
export function hargaMaster(p) {
  const harga = angka(p?.purchase_price);
  const qty = angka(p?.purchase_qty);
  if (harga == null || qty == null || qty <= 0) return null;
  return bulatkan(harga / qty);
}

/**
 * Perbandingan harga master vs rata-rata nota untuk satu bahan.
 *
 * `arah` sengaja dibedakan dari sekadar tanda selisih: yang ingin diketahui
 * orangnya adalah "HPP-ku kemurahan atau kemahalan", bukan angka mentahnya.
 *
 * @returns {{master:number|null, nota:number|null, selisih:number|null,
 *            persen:number|null, arah:'naik'|'turun'|'sama'|'tak-tahu'}}
 */
export function bandingHarga(produk, rataNota) {
  const master = hargaMaster(produk);
  const nota = angka(rataNota);

  if (master == null || nota == null) {
    // TIDAK menebak dengan angka yang ada saja.
    //
    // Kalau salah satunya belum ada, tidak ada perbandingan yang bisa dibuat —
    // dan menampilkan "0%" atau "-100%" untuk keadaan itu akan dibaca sebagai
    // temuan, lalu ditindaklanjuti.
    return { master, nota, selisih: null, persen: null, arah: 'tak-tahu' };
  }

  const selisih = bulatkan(nota - master);
  const persen = master > EPS ? Math.round((selisih / master) * 1000) / 10 : null;
  let arah = 'sama';
  if (selisih > EPS) arah = 'naik';
  else if (selisih < -EPS) arah = 'turun';
  return { master, nota, selisih, persen, arah };
}

/**
 * Layak ditandai untuk diperiksa admin?
 *
 * Ambangnya PERSEN, bukan rupiah: selisih Rp50 pada bahan seharga Rp200/gr
 * berarti 25%, sementara Rp50 pada bahan Rp20.000/kg tidak berarti apa-apa.
 * Ambang rupiah akan menyorot bahan mahal terus-menerus dan mendiamkan bahan
 * murah yang justru meleset jauh.
 */
export function perluDitinjau(banding, ambangPersen = 10) {
  if (!banding || banding.persen == null) return false;
  return Math.abs(banding.persen) >= ambangPersen;
}

/**
 * Ringkasan satu nota: total rupiah, dan berapa baris yang harganya kosong.
 *
 * Jumlah yang kosong disebut TERPISAH, bukan diam-diam dianggap nol. Total yang
 * terlihat wajar padahal separuh barisnya belum berharga adalah angka yang
 * paling mudah dipercaya dan paling salah.
 */
export function ringkasNota(items) {
  const daftar = Array.isArray(items) ? items : [];
  let total = 0;
  let berharga = 0;
  let tanpaHarga = 0;

  for (const i of daftar) {
    const qty = angka(i?.qty);
    const h = angka(i?.unit_cost ?? i?.unitCost);
    if (qty == null || qty <= 0) continue;
    if (h == null) {
      tanpaHarga++;
      continue;
    }
    total += qty * h;
    berharga++;
  }
  return { total: bulatkan(total), berharga, tanpaHarga, lengkap: tanpaHarga === 0 && berharga > 0 };
}
