/**
 * Menyusun isi dokumen order & pengiriman — untuk dilihat di layar, diunduh
 * sebagai PDF, dan diunduh sebagai xlsx.
 *
 * SATU SUMBER untuk tiga keluaran. Kalau tiap keluaran menyusun barisnya
 * sendiri, cepat atau lambat ketiganya menyimpang — dan yang paling mungkin
 * menyimpang justru kolom jumlah. Dokumen serah-terima yang angkanya berbeda
 * antara layar dan kertas tidak bisa dipakai menyelesaikan perselisihan, yang
 * justru satu-satunya alasan dokumen itu ada.
 *
 * NILAI RUPIAH ADALAH PILIHAN PEMANGGIL, bukan pilihan file ini. Staff App
 * meminta tanpa nilai (surat jalan yang dipegang kurir tidak perlu memuat
 * modal), Admin Portal meminta dengan nilai.
 *
 * PERLU DICATAT DENGAN JUJUR: menyembunyikan kolom nilai di sini BUKAN
 * pengaman. `products_select` membuka harga beli untuk semua anggota BU, jadi
 * staff tetap bisa melihat HPP lewat layar lain. Yang diatur di sini adalah apa
 * yang IKUT BEREDAR di kertas dan WhatsApp — bukan apa yang bisa dilihat.
 *
 * Tidak ada impor di file ini, supaya bisa diuji tanpa browser.
 */

const rupiah = (n) =>
  n == null || Number.isNaN(Number(n))
    ? '-'
    : 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID');

const angka = (n) => {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? String(Math.round(v * 100) / 100).replace('.', ',') : '0';
};

const tanggal = (iso) =>
  iso
    ? new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '-';

/**
 * @param {object} o
 * @param {'order'|'dispatch'} o.jenis
 * @param {object} o.header
 * @param {object[]} o.items
 * @param {boolean} [o.denganNilai]
 * @param {Map<string, number>} [o.biaya] productId -> HPP per satuan pakai
 */
export function susunDokumen({ jenis, header, items, denganNilai = false, biaya = new Map() }) {
  const isOrder = jenis === 'order';

  const kolom = isOrder
    ? [
        { header: 'Barang', width: 2.2 },
        { header: 'Diminta', width: 0.8, align: 'right' },
        { header: 'Satuan', width: 0.7 }
      ]
    : [
        { header: 'Barang', width: 2.2 },
        { header: 'Dikirim', width: 0.8, align: 'right' },
        // Kolom "Diterima" ADA meski belum diterima — kosongnya sendiri adalah
        // informasi: dokumen yang dicetak saat barang berangkat memang punya
        // kolom yang belum terisi, dan itulah yang ditandatangani penerima.
        { header: 'Diterima', width: 0.8, align: 'right' },
        { header: 'Selisih', width: 0.8, align: 'right' },
        { header: 'Satuan', width: 0.7 }
      ];
  if (denganNilai) {
    // `numeric` dipakai exportTableXLSX untuk mengembalikan "Rp 1.500.000" jadi
    // angka mentah. Tanpa itu Excel menganggapnya teks dan SUM-nya nol — gagal
    // yang tidak terlihat, karena selnya tetap tampil rapi.
    kolom.push(
      { header: 'HPP/satuan', width: 1, align: 'right', numeric: true },
      { header: 'Nilai', width: 1.1, align: 'right', numeric: true }
    );
  }

  let total = 0;
  const baris = (items ?? []).map((it) => {
    const nama = it.products?.name ?? '(produk terhapus)';
    const satuan = it.products?.base_unit ?? '';
    const jumlah = isOrder ? Number(it.qty ?? 0) : Number(it.sent_qty ?? 0);
    const sel = [];

    if (isOrder) {
      sel.push(nama, angka(jumlah), satuan);
    } else {
      const diterima = it.received_qty;
      // Selisih hanya dihitung kalau barangnya SUDAH diterima. Menampilkan
      // "-12" untuk kiriman yang masih di jalan akan terbaca sebagai barang
      // hilang, padahal belum ada yang menghitungnya.
      const selisih = diterima == null ? '' : angka(Number(diterima) - jumlah);
      sel.push(nama, angka(jumlah), diterima == null ? '' : angka(diterima), selisih, satuan);
    }

    if (denganNilai) {
      const hpp = biaya.get(it.product_id);
      const nilai = hpp == null ? null : hpp * jumlah;
      if (nilai != null) total += nilai;
      sel.push(hpp == null ? '-' : rupiah(hpp), nilai == null ? '-' : rupiah(nilai));
    }
    return sel;
  });

  const judul = isOrder ? 'Order Stok' : 'Surat Jalan';
  const nomor = header?.code ?? '(tanpa nomor)';

  const info = [
    ['Nomor', nomor],
    ['Dari', header?.from_outlet?.name ?? '-'],
    ['Ke', header?.to_outlet?.name ?? '-'],
    [isOrder ? 'Dibuat' : 'Dikirim', tanggal(header?.created_at)],
    ['Oleh', header?.pembuat?.full_name ?? '-']
  ];
  if (isOrder) {
    info.push(['Status', header?.statusLabel ?? '-']);
    if (header?.handled_at) info.push(['Diproses', tanggal(header.handled_at)]);
    if (header?.reject_reason) info.push(['Alasan ditolak', header.reject_reason]);
  } else {
    info.push(['Status', header?.statusLabel ?? '-']);
    // Baris "Diterima" hanya muncul kalau memang sudah — baris kosong bertuliskan
    // "-" membuat dokumen terlihat seolah penerimaannya gagal dicatat.
    if (header?.received_at) {
      info.push(['Diterima', tanggal(header.received_at)]);
      info.push(['Penerima', header?.penerima?.full_name ?? '-']);
    }
  }
  if (header?.notes) info.push(['Catatan', header.notes]);

  return {
    judul,
    nomor,
    namaBerkas: `${isOrder ? 'order' : 'surat-jalan'}-${String(nomor).replace(/[^\w.-]+/g, '-')}`,
    info,
    kolom,
    baris,
    total: denganNilai ? total : null,
    totalTeks: denganNilai ? rupiah(total) : null
  };
}
