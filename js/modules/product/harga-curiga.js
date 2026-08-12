/**
 * Menandai harga beli yang kemungkinan besar diisi dengan satuan yang salah.
 *
 * KENAPA INI ADA. Rumusnya `HPP = Harga Beli ÷ Isi per Satuan Beli`, jadi
 * "Harga Beli" berarti harga SATU SATUAN BELI — harga sekarung, bukan harga
 * segram. Kolom di template impor dulu cuma bertuliskan "Harga Beli", dan itu
 * bisa dibaca dua arah.
 *
 * Kalau terbaca salah, tidak ada yang menolak dan tidak ada yang merah. Gula
 * sekarung 25 kg seharga Rp 250.000 yang diisi "10" (harga per gram) menghasilkan
 * HPP Rp 0,0004/gram. Semua menu lalu terlihat untung hampir 100%, laporannya
 * rapi, angkanya berjalan — dan keputusan harga jual diambil di atasnya selama
 * berbulan-bulan. Kesalahan yang terlihat langsung jauh lebih murah daripada ini.
 *
 * INI DUGAAN, BUKAN ATURAN. Karena itu keluarannya peringatan, bukan penolakan:
 * tidak ada rumus yang bisa memastikan angka mana yang dimaksud orangnya, dan
 * impor yang menolak data yang sebenarnya benar akan lebih cepat membuat orang
 * berhenti memakai fitur ini daripada salah hitung yang sesekali lolos.
 *
 * Tidak ada impor di file ini, supaya bisa diuji tanpa browser.
 */

/** Perbandingan nama satuan yang longgar — "Gram" dan "gram " harus sama. */
const samaSatuan = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * @param {object} p produk (bentuk mentah dari form/impor/database)
 * @returns {string|null} peringatan untuk manusia, atau null kalau wajar
 */
export function curigaHargaTertukar(p) {
  if (!p || p.product_type !== 'raw') return null;
  const harga = Number(p.purchase_price);
  const isi = Number(p.purchase_qty);
  if (!(harga > 0) || !(isi > 0)) return null; // belum lengkap — bukan urusan di sini

  const beli = String(p.purchase_unit ?? '').trim();
  const pakai = String(p.base_unit ?? '').trim();
  const beda = beli && pakai && !samaSatuan(beli, pakai);

  // Kasus 1: hasil baginya di bawah Rp 1 per satuan pakai.
  //
  // Rp 1 dipilih bukan karena mustahil, tapi karena di rupiah tidak ada bahan
  // dapur yang harganya di bawah satu rupiah per gram/ml — itu setara Rp 1.000
  // per kilo, di bawah harga air kemasan. Angka di bawah ambang ini hampir
  // selalu berarti kolomnya terbalik.
  if (harga / isi < 1) {
    return (
      `Harga beli ${p.name ? `"${p.name}" ` : ''}terlihat terbalik: HPP-nya jadi Rp ${(harga / isi).toFixed(4)} per ${pakai || 'satuan pakai'}. ` +
      `Kolom "Harga Beli" diisi harga SATU ${beli || 'satuan beli'} (mis. harga sekarung), bukan harga per ${pakai || 'satuan pakai'}.`
    );
  }

  // Kasus 2: satuan belinya berbeda tapi isinya cuma 1.
  //
  // "1 karung = 1 gram" tidak berarti apa-apa. Biasanya ini terjadi saat kolom
  // isi dibiarkan default 1 sementara harganya diisi harga sekarung — HPP-nya
  // lalu jadi seharga sekarung untuk satu gram, arah salah yang berlawanan
  // dengan kasus 1 dan tidak tertangkap olehnya.
  if (beda && isi === 1) {
    return (
      `${p.name ? `"${p.name}": ` : ''}satuan beli "${beli}" berbeda dari satuan pakai "${pakai}", tapi "Isi per Satuan Beli" cuma 1. ` +
      `Akibatnya HPP dihitung Rp ${Math.round(harga).toLocaleString('id-ID')} per ${pakai}. Isi berapa ${pakai} dalam satu ${beli}.`
    );
  }

  return null;
}

/** Peringatan untuk sekumpulan produk sekaligus; yang wajar tidak ikut. */
export function curigaBanyak(produk) {
  return (produk ?? []).map((p) => curigaHargaTertukar(p)).filter(Boolean);
}
