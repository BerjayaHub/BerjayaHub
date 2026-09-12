/**
 * COGS — Harga Pokok Penjualan dari pergerakan stok nyata.
 *
 *   "stock awal (stock akhir bulan lalu) ditambah pembelian dikurangi stock
 *    akhir bulan ini"
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
 * ============ STOKNYA DARI SALDO, BUKAN DARI SATU SESI OPNAME ============
 *
 * Versi pertama berkas ini memakai nilai SATU SESI opname sebagai stok akhir.
 * Itu keliru, dan laporan lapangannya langsung menunjukkan kenapa:
 *
 *   "jika ada salah jumlah bahan, saya akan buka sesi opname lagi, dan yang
 *    terisi hanya bahan yang salah saja, jadi nominalnya akan sangat kecil"
 *
 * Sesi opname hanya berisi bahan yang dihitung DI SESI ITU. Sesi perbaikan
 * berisi satu bahan; nilainya Rp54.701 dipakai sebagai "nilai seluruh stok
 * outlet" — salah beberapa ratus kali lipat, dan tetap tercetak rapi.
 *
 * Sekarang stoknya diambil dari SALDO pada tanggal itu (`saldo_stok_pada`,
 * 0137), yaitu `stock_balances` yang sama dengan batas waktu. Menutup opname
 * menulis penyesuaian ke `stock_movements`, jadi hasil tiap opname — termasuk
 * sesi perbaikan — sudah ikut dengan sendirinya, dan bahan yang tidak pernah
 * dihitung tetap membawa saldo terakhirnya.
 *
 * Opname tetap disebut di laporannya, tapi perannya berubah: ia bukan lagi
 * SUMBER angkanya, melainkan penanda apakah angka itu pernah DIKUNCI hitungan
 * fisik. Outlet yang belum pernah opname tetap punya COGS — hanya sebaik
 * pencatatannya, dan barisnya mengatakan itu.
 *
 * Tidak ada impor dari layar di berkas ini, supaya bisa diuji tanpa browser.
 */

export const PERINGATAN_AWAL_TANPA_OPNAME = 'Stok awal belum dikunci opname';
export const PERINGATAN_AKHIR_TANPA_OPNAME = 'Stok akhir belum dikunci opname';

const angkaAtauNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Nilai sekumpulan saldo stok = Σ (qty × HPP).
 *
 * Bahan tanpa HPP TIDAK dihitung nol diam-diam — jumlahnya dilaporkan, karena
 * nilainya yang hilang menggeser COGS tanpa satu pun tanda di angkanya.
 *
 * @param {{product_id: string, qty: number|string}[]} saldo baris `saldo_stok_pada`
 * @param {Map<string, number>} hpp productId -> HPP per satuan
 */
export function nilaiStok(saldo, hpp = new Map()) {
  let nilai = 0;
  let tanpaHpp = 0;
  let jumlahItem = 0;

  for (const b of Array.isArray(saldo) ? saldo : []) {
    if (!b) continue;
    jumlahItem++;
    const qty = angkaAtauNull(b.qty) ?? 0;
    const h = hpp instanceof Map ? angkaAtauNull(hpp.get(b.product_id)) : null;
    // `??` dan bukan `||`: HPP 0 adalah angka yang sah (bahan bonus) dan tidak
    // boleh terbaca sebagai "belum punya harga".
    if (h === null) {
      // Saldo nol tanpa HPP tidak menyumbang apa pun, jadi bukan kekurangan
      // yang perlu dilaporkan.
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
 * @param {{nilai: number, tanpaHpp?: number}} o.awal  saldo pada H-1 periode
 * @param {{nilai: number, tanpaHpp?: number}} o.akhir saldo pada hari terakhir periode
 * @param {number} o.pembelian total nota terima pada periode
 * @param {{tanggal?: string}|null} [o.opnameAwal]  opname tertutup terakhir sebelum periode
 * @param {{tanggal?: string}|null} [o.opnameAkhir] opname tertutup terakhir di dalam periode
 */
export function barisCogs({ awal, akhir, pembelian = 0, opnameAwal = null, opnameAkhir = null } = {}) {
  const beli = angkaAtauNull(pembelian) ?? 0;
  const nAwal = angkaAtauNull(awal?.nilai) ?? 0;
  const nAkhir = angkaAtauNull(akhir?.nilai) ?? 0;

  // PERINGATAN, BUKAN PENOLAKAN.
  //
  // Saldo selalu ada, jadi COGS selalu bisa dihitung — tapi angkanya hanya
  // sebaik pencatatannya sampai ada opname yang menguncinya. Perbedaan antara
  // "sudah diverifikasi fisik" dan "baru menurut catatan" TIDAK terlihat dari
  // angkanya sendiri, jadi ia harus ditulis.
  const catatan = [];
  if (!opnameAwal?.tanggal) catatan.push(PERINGATAN_AWAL_TANPA_OPNAME);
  if (!opnameAkhir?.tanggal) catatan.push(PERINGATAN_AKHIR_TANPA_OPNAME);

  const tanpaHpp = (awal?.tanpaHpp ?? 0) + (akhir?.tanpaHpp ?? 0);
  if (tanpaHpp) catatan.push(`${tanpaHpp} bahan belum punya HPP`);

  return {
    awal: nAwal,
    akhir: nAkhir,
    pembelian: beli,
    cogs: nAwal + beli - nAkhir,
    // Dua-duanya dikunci opname = angkanya berdiri di atas hitungan fisik di
    // kedua ujung periode. Hanya baris seperti ini yang layak dipakai berdebat.
    terkunci: !!(opnameAwal?.tanggal && opnameAkhir?.tanggal),
    tanggalAwal: opnameAwal?.tanggal ?? '',
    tanggalAkhir: opnameAkhir?.tanggal ?? '',
    catatan: catatan.join('; ')
  };
}

/**
 * Total seluruh outlet.
 *
 * SEMUA outlet ikut — berbeda dari versi sebelumnya, yang membuang outlet tanpa
 * opname karena angkanya memang belum ada. Sekarang angkanya selalu ada; yang
 * belum ada cuma penguncinya. Membuang barisnya dari total akan membuat total
 * tidak sama dengan jumlah kolomnya sendiri, dan yang membacanya akan mengira
 * ada kesalahan penjumlahan.
 *
 * Berapa outlet yang belum terkunci DISEBUT terpisah.
 */
export function ringkasCogs(baris) {
  const daftar = Array.isArray(baris) ? baris : [];
  const jumlah = (f) => daftar.reduce((t, b) => t + (Number(b?.[f]) || 0), 0);
  const terkunci = daftar.filter((b) => b?.terkunci).length;
  return {
    awal: jumlah('awal'),
    pembelian: jumlah('pembelian'),
    akhir: jumlah('akhir'),
    cogs: jumlah('cogs'),
    outletTotal: daftar.length,
    outletTerkunci: terkunci,
    outletBelumTerkunci: daftar.length - terkunci
  };
}
