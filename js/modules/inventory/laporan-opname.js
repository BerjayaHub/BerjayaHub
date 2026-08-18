/**
 * Menyusun laporan satu sesi Stok Opname.
 *
 * SATU SUMBER untuk tiga keluaran — layar staff, layar admin, dan xlsx —
 * dengan alasan yang sama seperti dokumen kiriman: laporan opname dipakai
 * menjelaskan selisih ke pemilik, dan angka yang berbeda antara layar dan file
 * unduhan membuat seluruh laporannya tidak bisa dipakai.
 *
 * NILAI RUPIAH ADALAH PILIHAN PEMANGGIL. Staff App meminta tanpa nilai
 * (yang dibutuhkan di lapangan cuma "berapa selisihnya"), Admin Portal
 * memintanya. Perlu dicatat jujur: menyembunyikannya di sini BUKAN pengaman —
 * `products_select` membuka harga beli untuk semua anggota BU. Yang diatur
 * adalah apa yang IKUT BEREDAR di kertas dan WhatsApp.
 *
 * ============ ARAH SELISIH ============
 *
 * `selisih = dihitung − sistem`. Positif berarti barangnya LEBIH banyak
 * daripada catatan; negatif berarti KURANG.
 *
 * Arahnya ditulis di sini sekali dan dipakai semua keluaran, karena inilah
 * angka yang paling mudah terbalik: "kurang 5" dan "lebih 5" sama-sama masuk
 * akal dibaca, tidak menghasilkan error, dan kalau tertukar maka laporan
 * kehilangan barang berubah jadi laporan kelebihan barang.
 *
 * Tidak ada impor di file ini, supaya bisa diuji tanpa browser.
 */

const rupiah = (n) =>
  n == null || !Number.isFinite(Number(n)) ? '-' : 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID');

const angka = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v * 10000) / 10000).replace('.', ',');
};

/**
 * @param {object} o
 * @param {object} o.sesi   { code, count_date, status, outletName, opened, closed }
 * @param {object[]} o.items hasil stock_count_items + produknya
 * @param {Map<string,number|null>} [o.hpp] productId -> HPP per satuan
 * @param {boolean} [o.denganNilai=false]
 */
export function susunLaporanOpname({ sesi, items, hpp = new Map(), denganNilai = false } = {}) {
  const kolom = [
    { header: 'Produk', width: 2.2 },
    { header: 'Satuan', width: 0.7 },
    { header: 'Sistem', width: 0.8, align: 'right' },
    { header: 'Dihitung', width: 0.8, align: 'right' },
    { header: 'Selisih', width: 0.8, align: 'right' },
    { header: 'Dihitung oleh', width: 1.2 }
  ];
  if (denganNilai) {
    kolom.push(
      { header: 'HPP/satuan', width: 1, align: 'right', numeric: true },
      { header: 'Nilai Selisih', width: 1.1, align: 'right', numeric: true }
    );
  }

  let nilaiKurang = 0;
  let nilaiLebih = 0;
  let adaTanpaHpp = false;
  let jumlahSelisih = 0;
  let jumlahBentrok = 0;

  const baris = (items ?? []).map((it) => {
    const sistem = Number(it.system_qty ?? 0);
    const dihitung = Number(it.counted_qty ?? 0);
    const selisih = dihitung - sistem;
    if (selisih !== 0) jumlahSelisih++;

    // Item yang pernah dihitung orang lain dengan angka berbeda ditandai.
    // Angka mana pun yang akhirnya dipakai, YANG PENTING justru selisihnya:
    // salah satu penghitung melihat tempat yang berbeda, dan itu perlu
    // ditanyakan sebelum selisihnya masuk laporan.
    const bentrok = Array.isArray(it.sebelumnya) && it.sebelumnya.length > 0;
    if (bentrok) jumlahBentrok++;

    const sel = [
      it.products?.name ?? '(produk terhapus)',
      it.products?.base_unit ?? '',
      angka(sistem),
      angka(dihitung),
      // Tanda + ditulis eksplisit untuk yang positif. Tanpa itu "5" dan "-5"
      // beda satu karakter di kolom yang dibaca cepat.
      (selisih > 0 ? '+' : '') + angka(selisih),
      (it.penghitung?.full_name ?? '-') + (bentrok ? ' ⚠' : '')
    ];

    if (denganNilai) {
      const h = hpp.get(it.product_id);
      const nilai = h == null ? null : h * selisih;
      if (h == null && selisih !== 0) adaTanpaHpp = true;
      if (nilai != null) {
        if (nilai < 0) nilaiKurang += nilai;
        else nilaiLebih += nilai;
      }
      // Bahan tanpa HPP ditandai "-", bukan 0 — nol membuat total terlihat sah
      // padahal ada selisih yang belum bernilai.
      sel.push(h == null ? '-' : rupiah(h), nilai == null ? '-' : rupiah(nilai));
    }
    return sel;
  });

  const tanggal = sesi?.count_date ?? '';
  return {
    judul: `Stok Opname ${sesi?.code ?? '(tanpa nomor)'}`,
    subjudul:
      [sesi?.outletName, tanggal, sesi?.status === 'open' ? 'MASIH BERJALAN' : 'selesai']
        .filter(Boolean)
        .join(' · ') + ` · ${baris.length} item, ${jumlahSelisih} selisih` + (jumlahBentrok ? `, ${jumlahBentrok} perlu dicek ⚠` : ''),
    namaBerkas: 'opname-' + String(sesi?.code ?? 'tanpa-nomor').replace(/[^\w.-]+/g, '-'),
    kolom,
    baris,
    jumlahItem: baris.length,
    jumlahSelisih,
    jumlahBentrok,
    // Kurang dan lebih DIPISAH, tidak dijumlahkan jadi satu angka bersih.
    // Kehilangan 2 juta yang tertutup kelebihan 2 juta bukan "impas": itu dua
    // masalah, dan angka bersih nol menyembunyikan keduanya.
    nilaiKurang: denganNilai ? nilaiKurang : null,
    nilaiLebih: denganNilai ? nilaiLebih : null,
    nilaiKurangTeks: denganNilai ? rupiah(nilaiKurang) : null,
    nilaiLebihTeks: denganNilai ? rupiah(nilaiLebih) : null,
    adaTanpaHpp
  };
}
