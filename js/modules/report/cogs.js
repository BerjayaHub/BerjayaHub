/**
 * COGS — Harga Pokok Penjualan dari pergerakan stok nyata.
 *
 *   "stock awal (stock akhir bulan lalu) ditambah pembelian dikurangi stock
 *    akhir bulan ini (nilai opname bulan ini)"
 *
 *     COGS = stok awal + pembelian − stok akhir
 *
 * ============ KENAPA INI BERBEDA DARI "LABA KOTOR" YANG SUDAH ADA ============
 *
 * Laporan Laba Kotor menghitung HPP dari RESEP: tiap menu yang terjual
 * dikalikan takaran resepnya. Itu HPP **teoretis** — ia menganggap tiap porsi
 * memakai bahan sebanyak yang tertulis.
 *
 * COGS ini menghitung dari BARANG YANG BENAR-BENAR HILANG DARI RAK. Selisih
 * keduanya adalah tumpahan, kelebihan takar, waste yang tidak tercatat, dan
 * kehilangan — yaitu justru angka yang paling ingin diketahui pemilik, dan
 * satu-satunya yang tidak bisa dilihat dari laporan resep.
 *
 * ============ YANG PALING BERBAHAYA: OPNAME YANG TIDAK ADA ============
 *
 * Rumusnya cuma tiga angka, dan dua di antaranya berasal dari opname. Kalau
 * salah satunya tidak ada dan diperlakukan sebagai NOL:
 *
 *   stok akhir hilang -> COGS melonjak sebesar seluruh nilai stok
 *   stok awal hilang  -> COGS anjlok, bisa jadi negatif
 *
 * Dua-duanya menghasilkan angka yang MASIH TERBACA MASUK AKAL di laporan
 * bulanan — tidak ada error, tidak ada baris kosong, cuma angka yang salah
 * besar. Maka opname yang tidak ada menghasilkan `null` dan barisnya berkata
 * kenapa; ia TIDAK PERNAH diam-diam jadi nol.
 *
 * Tidak ada impor dari layar di berkas ini, supaya bisa diuji tanpa browser.
 */

/** Alasan sebuah baris tidak bisa dihitung — dipakai layar & tes. */
export const SEBAB_TANPA_AWAL = 'Belum ada opname sebelum periode ini';
export const SEBAB_TANPA_AKHIR = 'Belum ada opname di dalam periode ini';
export const SEBAB_TANPA_KEDUANYA = 'Belum ada opname sama sekali';

const angkaAtauNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Nilai satu sesi opname = Σ (dihitung × HPP).
 *
 * Bahan tanpa HPP TIDAK dihitung nol — ia dihitung jumlahnya dan dilaporkan,
 * karena nilainya yang hilang membuat stok akhir lebih kecil dan COGS lebih
 * besar, tanpa satu pun tanda di angkanya.
 *
 * @param {{product_id: string, counted_qty: number|string}[]} items
 * @param {Map<string, number>} hpp productId -> HPP per satuan
 */
export function nilaiOpname(items, hpp = new Map()) {
  let nilai = 0;
  let tanpaHpp = 0;
  let jumlahItem = 0;

  for (const it of Array.isArray(items) ? items : []) {
    if (!it) continue;
    jumlahItem++;
    const qty = angkaAtauNull(it.counted_qty) ?? 0;
    const h = hpp instanceof Map ? angkaAtauNull(hpp.get(it.product_id)) : null;
    // `??` dan bukan `||`: HPP 0 adalah angka yang sah (bahan bonus) dan tidak
    // boleh terbaca sebagai "belum punya harga".
    if (h === null) {
      // Barang berjumlah nol tanpa HPP tidak menyumbang apa pun ke nilainya,
      // jadi ia bukan kekurangan yang perlu dilaporkan.
      if (qty !== 0) tanpaHpp++;
      continue;
    }
    nilai += h * qty;
  }

  return { nilai, tanpaHpp, jumlahItem };
}

/**
 * Satu baris COGS untuk satu outlet.
 *
 * @param {object} o
 * @param {{tanggal: string, nilai: number, tanpaHpp?: number}|null} o.awal
 *   opname TERAKHIR sebelum periode — stok awal
 * @param {{tanggal: string, nilai: number, tanpaHpp?: number}|null} o.akhir
 *   opname TERAKHIR di dalam periode — stok akhir
 * @param {number} o.pembelian total nota terima pada periode
 */
export function barisCogs({ awal = null, akhir = null, pembelian = 0 } = {}) {
  const beli = angkaAtauNull(pembelian) ?? 0;
  const nAwal = awal ? angkaAtauNull(awal.nilai) : null;
  const nAkhir = akhir ? angkaAtauNull(akhir.nilai) : null;

  const catatan = [];
  if (nAwal === null && nAkhir === null) catatan.push(SEBAB_TANPA_KEDUANYA);
  else {
    if (nAwal === null) catatan.push(SEBAB_TANPA_AWAL);
    if (nAkhir === null) catatan.push(SEBAB_TANPA_AKHIR);
  }

  // Bahan tanpa HPP membuat nilai opnamenya lebih kecil dari seharusnya —
  // dan COGS-nya ikut bergeser. Disebut, bukan didiamkan.
  const tanpaHpp = (awal?.tanpaHpp ?? 0) + (akhir?.tanpaHpp ?? 0);
  if (tanpaHpp) catatan.push(`${tanpaHpp} bahan belum punya HPP`);

  const bisa = nAwal !== null && nAkhir !== null;
  return {
    awal: nAwal,
    akhir: nAkhir,
    pembelian: beli,
    // `null`, BUKAN 0. Nol di kolom COGS terbaca sebagai "tidak ada biaya
    // pokok bulan ini" — pernyataan yang sepenuhnya berbeda dari "belum bisa
    // dihitung", dan keduanya sama-sama terlihat wajar di laporan bulanan.
    cogs: bisa ? nAwal + beli - nAkhir : null,
    bisaDihitung: bisa,
    tanggalAwal: awal?.tanggal ?? '',
    tanggalAkhir: akhir?.tanggal ?? '',
    catatan: catatan.join('; ')
  };
}

/**
 * Total seluruh outlet.
 *
 * Outlet yang COGS-nya tidak bisa dihitung TIDAK ikut ke total mana pun —
 * termasuk ke total pembeliannya. Menjumlahkan pembelian sebuah outlet tanpa
 * stok awal/akhirnya menghasilkan total yang tidak konsisten dengan barisnya
 * sendiri, dan yang membacanya akan mengira ada kesalahan penjumlahan.
 */
export function ringkasCogs(baris) {
  const daftar = (Array.isArray(baris) ? baris : []).filter((b) => b?.bisaDihitung);
  const jumlah = (f) => daftar.reduce((t, b) => t + (Number(b[f]) || 0), 0);
  const semua = Array.isArray(baris) ? baris.length : 0;
  return {
    awal: jumlah('awal'),
    pembelian: jumlah('pembelian'),
    akhir: jumlah('akhir'),
    cogs: jumlah('cogs'),
    outletTerhitung: daftar.length,
    outletTotal: semua,
    outletTerlewat: semua - daftar.length
  };
}
