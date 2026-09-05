/**
 * Nota penerimaan barang dari supplier (0084).
 *
 * BENTUKNYA MENGIKUTI ORDER, bukan penerimaan lama: satu kali isi, banyak
 * barang, satu nomor. Penerimaan lama menuntut satu tombol per produk —
 * padahal barang datang dalam satu nota berisi belasan item, dan sesudahnya
 * tidak ada tempat yang bisa menjawab "nota nomor berapa isinya apa saja".
 *
 * FOTO NOTA OPSIONAL DAN BISA MENYUSUL. Nota fisik sering datang beberapa jam
 * setelah barangnya; mewajibkannya berarti stok tidak tercatat sampai kertasnya
 * ada. Menambahkan foto belakangan TIDAK menuntut mengirim ulang isi notanya.
 *
 * EDIT MENGOREKSI STOK LEWAT PERGERAKAN PENYEIMBANG, bukan mengubah pergerakan
 * lama — alasan panjangnya ada di 0084. Yang penting diketahui dari sisi sini:
 * memanggil `ubahNota` dengan `items: null` hanya menyentuh kepala notanya.
 */

import { supabase } from '../../config/supabase-client.js';
import { ambilSemua } from '../../core/ambil-semua.js';
import { argumenRpc } from '../../core/rpc-args.js';

const BUCKET = 'receipt-photos';

/** Simpan nota baru. Mengembalikan id-nya; nomornya dibuat server. */
export async function simpanNota({ outletId, receiptDate, supplier, invoiceNo, photoPath, notes, items }) {
  const { data, error } = await supabase.rpc('simpan_nota_terima', argumenRpc({
    p_outlet: outletId,
    p_receipt_date: receiptDate || null,
    p_supplier: supplier || null,
    p_invoice_no: invoiceNo || null,
    p_photo_path: photoPath || null,
    p_notes: notes || null,
    // `line_total` = harga beli SELURUH baris, angka yang diketik orang.
    // Pembagiannya jadi harga per satuan dikerjakan server (`harga_baris_nota`,
    // 0123) supaya menyimpan dan mengedit tidak pernah memakai dua pembulatan
    // yang berbeda.
    p_items: (items ?? []).map((i) => ({ product_id: i.product_id, qty: i.qty, line_total: i.line_total ?? null }))
  }));
  if (error) throw new Error(error.message ?? String(error));
  return data;
}

/**
 * Ubah nota.
 *
 * `items` = `null` berarti JANGAN SENTUH barangnya — dipakai saat cuma
 * menambahkan foto nota yang menyusul, yang justru kasus paling sering.
 * `photoPath` = `null` berarti jangan sentuh fotonya; string kosong = hapus.
 */
export async function ubahNota(id, { receiptDate, supplier, invoiceNo, photoPath, notes, items = null }) {
  const { error } = await supabase.rpc('ubah_nota_terima', argumenRpc({
    p_id: id,
    p_receipt_date: receiptDate || null,
    // `?? null`, BUKAN `?? ''` — dan itu perbedaan yang menghapus data.
    //
    // Servernya membedakan NULL ("jangan sentuh") dari string kosong ("hapus").
    // Mengubah `undefined` jadi `''` di sini berarti tiap pemanggil yang tidak
    // menyebut sebuah kolom secara diam-diam MEMINTA kolom itu dikosongkan.
    //
    // Jalur "+ Foto" persis begitu: ia cuma mengirim `photoPath`, dan tiga
    // kolom lain — nama supplier, no. invoice, catatan — ikut terhapus. Toast
    // hijau, foto tersimpan, supplier lenyap.
    p_supplier: supplier ?? null,
    p_invoice_no: invoiceNo ?? null,
    // `?? null` DI SINI JUGA — dan ketiadaannya membunuh seluruh tombol Edit.
    //
    // ============ BUG YANG DIPERBAIKI ============
    //
    //   "Could not find the function public.ubah_nota_terima(p_id,
    //    p_invoice_no, p_items, p_notes, p_receipt_date, p_supplier)
    //    in the schema cache"
    //
    // Dialog Edit memanggil `ubahNota(id, { supplier, invoiceNo, items })` —
    // tanpa menyebut foto. `photoPath` jadi `undefined`, dan **`JSON.stringify`
    // MEMBUANG kunci yang bernilai `undefined`**. Yang sampai ke server bukan
    // tujuh argumen dengan satu berisi NULL, melainkan ENAM argumen.
    //
    // PostgREST memilih fungsi berdasarkan HIMPUNAN NAMA argumen yang dikirim.
    // Tidak ada `ubah_nota_terima` berargumen enam, jadi ia menjawab 42883 —
    // pesan yang menyebut fungsi yang tidak pernah ada, dan tidak menyinggung
    // sama sekali bahwa masalahnya satu kunci yang hilang di klien.
    //
    // Tiga kolom di atas selamat justru karena sudah ber-`?? null`. Komentar
    // panjang di atas ditulis tentang foto, dan fotonya sendiri yang terlewat.
    p_photo_path: photoPath ?? null,
    p_notes: notes ?? null,
    p_items: items === null ? null : items.map((i) => ({ product_id: i.product_id, qty: i.qty, line_total: i.line_total ?? null }))
  }));
  if (error) throw new Error(error.message ?? String(error));
}

/**
 * Riwayat nota; rentang tanggal memakai TANGGAL NOTA, bukan waktu input.
 *
 * `denganPembuat` DEFAULTNYA MATI dan itu disengaja. Nama penginput cuma
 * ditampilkan di Admin Portal; Staff App tidak memakainya sama sekali.
 *
 * Alasannya bukan penghematan query — melainkan bahwa **embed yang gagal
 * membatalkan SELURUH permintaan**. Waktu FK `created_by` masih salah menunjuk
 * `auth.users`, layar "Terima dari Supplier" di Staff App mati total sambil
 * memuat satu kolom yang tidak pernah digambar di mana pun. Meminta sesuatu
 * yang tidak dipakai bukan cuma mubazir; ia menambah cara untuk gagal.
 */
export async function riwayatNota(
  businessUnitId,
  { outletId = null, dateFrom = null, dateTo = null, denganPembuat = false } = {}
) {
  const dasar =
    'id, code, receipt_date, supplier, invoice_no, photo_path, notes, outlet_id, created_at, outlets!outlet_id(name)' +
    (denganPembuat ? ', pembuat:user_profiles!created_by(full_name)' : '');
  // Status bayarnya ikut sejak 0122.
  const bayar = ', payment_status, due_date, payment_entry_id';

  const ambil = (kolom) =>
    ambilSemua((dari, sampai) => {
      let q = supabase
        .from('goods_receipts')
        .select(kolom, { count: 'exact' })
        .eq('business_unit_id', businessUnitId)
        .order('receipt_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (outletId) q = q.eq('outlet_id', outletId);
      if (dateFrom) q = q.gte('receipt_date', dateFrom);
      if (dateTo) q = q.lte('receipt_date', dateTo);
      return q.range(dari, sampai);
    });

  try {
    return await ambil(dasar + bayar);
  } catch (e) {
    // MIGRATION 0122 BELUM DIJALANKAN -> SELURUH RIWAYAT NOTA MENGHILANG.
    //
    // Ini terjadi sungguhan. Kode yang meminta `payment_status` di-push lebih
    // dulu daripada migrationnya dijalankan; PostgREST menolak seluruh
    // permintaan karena satu kolom tidak dikenal, dan layarnya kehilangan
    // BUKAN kolom status — melainkan seluruh daftar notanya, berikut tombol
    // Lihat, Edit, dan + Foto. Yang tersisa cuma satu baris merah.
    //
    // Jeda antara push dan menjalankan migration itu wajar dan akan terjadi
    // lagi. Kolom baru tidak boleh menyandera fungsi yang sudah jalan: kalau
    // ia tidak ada, notanya tetap tampil tanpa status bayar.
    if (!/payment_status|due_date|payment_entry_id/.test(String(e?.message ?? ''))) throw e;
    return await ambil(dasar);
  }
}

/**
 * Nota + total + berapa barisnya yang belum berharga + status bayarnya (0122).
 *
 * Totalnya dihitung SERVER lewat view `nota_ringkas`, bukan di sini. Angka yang
 * sama dipakai untuk memutuskan boleh-tidaknya sebuah nota dibayar; kalau
 * klien menghitungnya sendiri, dua sumber itu cepat atau lambat menyimpang —
 * dan yang terlihat cuma pembayaran yang ditolak tanpa sebab yang jelas.
 *
 * @param {string} businessUnitId
 * @param {{outletId?: string|null, status?: 'lunas'|'belum'|null}} opsi
 */
export async function ringkasanNota(businessUnitId, { outletId = null, status = null } = {}) {
  return ambilSemua((dari, sampai) => {
    let q = supabase
      .from('nota_ringkas')
      .select('*', { count: 'exact' })
      .eq('business_unit_id', businessUnitId)
      .order('receipt_date', { ascending: false });
    if (outletId) q = q.eq('outlet_id', outletId);
    if (status) q = q.eq('payment_status', status);
    return q.range(dari, sampai);
  });
}

/**
 * Lunasi beberapa nota sekaligus dengan SATU entri kas (0122).
 *
 * `notaIds` boleh berisi banyak nota, tapi semuanya harus dari satu outlet dan
 * belum lunas. Server yang memeriksanya — kalau satu saja gagal, tidak ada yang
 * dibayar.
 *
 * @returns {Promise<string|null>} id entri kasnya, atau `null` kalau totalnya 0
 *   (nota bonus/sampel ditandai lunas tanpa memindahkan uang).
 */
export async function bayarNota({ notaIds, accountId, date, notes, sumber = 'kas' }) {
  const { data, error } = await supabase.rpc(
    'bayar_nota',
    argumenRpc({
      p_notas: notaIds,
      // `pusat` tidak menyentuh kas mana pun, jadi kantongnya memang null —
      // dan `argumenRpc` yang menjaga kuncinya tetap terkirim. Tanpa itu
      // PostgREST melihat empat argumen dan memilih pembungkus lama, yang
      // artinya "bayar dari kas" — diam-diam mengerjakan hal yang berbeda dari
      // yang dipilih orangnya di layar.
      p_account: accountId ?? null,
      p_date: date || null,
      p_notes: notes || null,
      p_sumber: sumber || 'kas'
    })
  );
  if (error) throw new Error(error.message ?? String(error));
  return data;
}

/**
 * Batalkan pembayaran — membuat entri kas BALIK, tidak menghapus yang asli.
 *
 * Berlaku untuk SELURUH pembayaran yang memuat nota ini. Kembaliannya jumlah
 * nota yang ikut dibatalkan, supaya layar bisa mengatakannya sebelum & sesudah.
 *
 * @returns {Promise<number>}
 */
export async function batalkanPembayaranNota(notaId) {
  const { data, error } = await supabase.rpc('batalkan_pembayaran_nota', { p_nota: notaId });
  if (error) throw new Error(error.message ?? String(error));
  return Number(data) || 0;
}

/**
 * Geser harga nota dari arti lama (per satuan) ke harga beli baris (0124).
 *
 * Hanya menyentuh nota yang DISEBUT. Nota yang harganya sudah benar akan rusak
 * kalau ikut digeser — `line_total` yang benar jadi dibagi jumlahnya — jadi
 * tidak ada jalur "geser semua" di sini; daftarnya selalu datang dari layar
 * yang sudah menampilkan sebelum/sesudahnya.
 *
 * @returns {Promise<number>} jumlah BARIS yang berubah
 */
export async function geserHargaNota(notaIds) {
  const { data, error } = await supabase.rpc('geser_harga_nota', { p_notas: notaIds });
  if (error) throw new Error(error.message ?? String(error));
  return Number(data) || 0;
}

/** Pasang/ubah jatuh tempo nota yang belum lunas (0122). */
export async function setJatuhTempoNota(notaId, dueDate) {
  const { error } = await supabase.rpc('set_jatuh_tempo_nota', { p_nota: notaId, p_due: dueDate || null });
  if (error) throw new Error(error.message ?? String(error));
}

/** Isi satu nota. */
export async function itemNota(receiptId) {
  if (!receiptId) return [];
  const { data, error } = await supabase
    // baris-terbatas: item SATU nota.
    .from('goods_receipt_items')
    .select('product_id, qty, unit_cost, line_total, notes, products(name, base_unit)')
    .eq('receipt_id', receiptId);
  if (error) throw error;
  return data ?? [];
}

/**
 * Unggah foto nota. Nama berkasnya memuat outlet & waktu supaya dua nota yang
 * diunggah bersamaan tidak saling menimpa.
 */
export async function unggahFotoNota(outletId, file) {
  if (!file) return null;
  const ext = (file.name?.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${outletId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw new Error(`Foto nota gagal diunggah: ${error.message}`);
  return path;
}

/** URL sementara untuk melihat foto nota. */
export async function urlFotoNota(path, expiresIn = 600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}
