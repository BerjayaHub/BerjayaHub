import { supabase } from '../../config/supabase-client.js';
import { ambilSemua } from '../../core/ambil-semua.js';

export function todayWIB() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(wib.getUTCDate())}`;
}

/**
 * Catat penjualan.
 *
 * ============ `ref` WAJIB, DAN HARUS SAMA PADA SETIAP PERCOBAAN ULANG ============
 *
 * `record_sales()` memakai `p_ref` untuk mengenali kiriman yang sama (0098).
 * Yang membuat nilainya KLIEN — sengaja — karena hanya klien yang tahu bedanya
 * "kirim ulang karena jaringan putus" dan "shift kedua yang memang menjual lagi".
 * Dari sisi server keduanya terlihat persis sama.
 *
 * Karena itu `ref` diminta sebagai parameter, bukan dibuat di dalam fungsi ini:
 * dibuat di sini berarti setiap percobaan ulang mendapat nilai baru, dan
 * perlindungannya hilang tanpa satu pun tanda.
 *
 * Aturan pemakaiannya ada di `sales.page.js`.
 */
export async function recordSales({ businessUnitId, outletId, date, items, ref }) {
  if (!ref) throw new Error('Penanda kiriman tidak ada. Muat ulang aplikasi, lalu coba lagi.');

  const { data, error } = await supabase.rpc('record_sales', {
    p_bu: businessUnitId,
    p_outlet: outletId,
    p_date: date,
    p_items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
    p_ref: ref
  });
  if (error) throw error;
  // `{ diproses: false }` berarti kiriman ini sudah pernah tersimpan — bukan
  // kegagalan. Dikembalikan supaya layar bisa mengatakannya apa adanya
  // daripada menampilkan "tersimpan" untuk kedua kalinya.
  return data ?? { diproses: true };
}

/** Penanda kiriman baru. Dipanggil SEKALI per tindakan simpan, bukan per percobaan. */
export function buatRefKiriman() {
  return crypto.randomUUID();
}

/**
 * Baris penjualan satu outlet pada satu tanggal — SATU BARIS PER TRANSAKSI.
 *
 * Berbeda dengan `getSalesSummary()` yang menjumlahkan per menu. Untuk
 * memperbaiki atau menghapus, yang dibutuhkan justru barisnya sendiri: menu
 * yang sama bisa punya beberapa baris kalau dicatat di dua shift, dan
 * menggabungkannya membuat "yang mana yang salah" tidak bisa dijawab.
 *
 * `boleh_ubah` ikut dibawa dari server. Menghitungnya di layar berarti
 * menyalin aturan wewenang ke tempat kedua — dan salinan yang menyimpang akan
 * menampilkan tombol yang pasti ditolak, atau menyembunyikan tombol yang
 * sebenarnya boleh.
 */
export async function listSalesHariIni(outletId, date) {
  const { data, error } = await supabase
    .from('sales')
    .select('id, product_id, qty, unit_price, revenue, created_at, created_by, products(name)')
    .eq('outlet_id', outletId)
    .eq('sale_date', date)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Ubah jumlah terjual.
 *
 * Lewat RPC, BUKAN `update` langsung. Dua alasannya sama pentingnya:
 * harga tidak boleh dibaca ulang dari daftar harga sekarang (omzet historis
 * akan bergeser), dan stok bahannya harus ikut dikoreksi — keduanya mustahil
 * dijamin dari sisi klien.
 */
export async function ubahPenjualan(saleId, qty, alasan = null) {
  // `p_alasan` SELALU dikirim, walau null.
  //
  // Sejak 0112 fungsinya bertanda tangan tiga parameter dengan default null.
  // Mengirimnya secara eksplisit membuat pemanggilan ini tidak bergantung pada
  // resolusi default PostgREST — dan kalau suatu saat defaultnya dicabut,
  // yang gagal adalah SQL-nya, bukan diam-diam memanggil overload lain.
  const { data, error } = await supabase.rpc('ubah_penjualan', {
    p_sale: saleId,
    p_qty: Number(qty),
    p_alasan: alasan || null
  });
  if (error) throw error;
  return data;
}

/** Balik stok bahannya lalu hapus barisnya. Lihat 0101. */
export async function hapusPenjualan(saleId, alasan = null) {
  const { data, error } = await supabase.rpc('hapus_penjualan', {
    p_sale: saleId,
    p_alasan: alasan?.trim() || null
  });
  if (error) throw error;
  return data;
}

/** Rekap penjualan hari ini untuk sebuah outlet -> Map productId -> {qty, revenue}. */
export async function getSalesSummary(outletId, date) {
  const { data, error } = await supabase
    .from('sales')
    .select('product_id, qty, revenue')
    .eq('outlet_id', outletId)
    .eq('sale_date', date);
  if (error) throw error;
  const map = new Map();
  for (const r of data ?? []) {
    const cur = map.get(r.product_id) ?? { qty: 0, revenue: 0 };
    cur.qty += Number(r.qty) || 0;
    cur.revenue += Number(r.revenue) || 0;
    map.set(r.product_id, cur);
  }
  return map;
}

/** Laporan penjualan admin: agregat per produk (qty & omzet) dalam rentang. */
/**
 * Laporan penjualan admin.
 *
 * Dulu memakai `.limit(2000)`. Batas yang ditulis tangan lebih berbahaya
 * daripada batas bawaan PostgREST justru karena ia TERLIHAT DISENGAJA — orang
 * yang membacanya akan mengira 2.000 memang cukup, dan laporan BU yang ramai
 * diam-diam kehilangan baris tertua tanpa satu pun tanda.
 */
export async function listSalesReport({ businessUnitId, outletId, dateFrom, dateTo }) {
  return ambilSemua((dari, sampai) => {
    let query = supabase
      .from('sales')
      .select('product_id, outlet_id, qty, unit_price, revenue, sale_date, products(name, category), outlets(name)')
      .eq('business_unit_id', businessUnitId)
      .order('sale_date', { ascending: false })
      .range(dari, sampai);
    if (outletId) query = query.eq('outlet_id', outletId);
    if (dateFrom) query = query.gte('sale_date', dateFrom);
    if (dateTo) query = query.lte('sale_date', dateTo);
    return query;
  });
}

/**
 * Daftar penjualan PER TRANSAKSI untuk layar koreksi Admin Portal.
 *
 * Berbeda dengan `listSalesReport()` yang dipakai laporan: yang itu diagregat
 * per menu untuk menjawab "menu apa yang laku". Yang ini menjawab pertanyaan
 * lain — "baris mana yang salah ketik" — dan untuk itu barisnya harus utuh,
 * lengkap dengan siapa yang menginput dan jejak koreksinya kalau ada.
 *
 * `ambilSemua` dipakai karena PostgREST memotong diam-diam di ~1000 baris.
 * Satu outlet ramai bisa melewati itu dalam sebulan, dan yang hilang adalah
 * baris paling lama — persis yang sedang dicari kalau kesalahannya baru
 * ketahuan belakangan.
 */
export async function listSalesTransaksi({ businessUnitId, outletId, dateFrom, dateTo }) {
  return ambilSemua((dari, sampai) => {
    let query = supabase
      .from('sales')
      .select(
        'id, sale_date, product_id, qty, unit_price, revenue, created_at, created_by, ' +
          'qty_awal, dikoreksi_at, dikoreksi_alasan, ' +
          'products(name, category), outlets(name), ' +
          'pencatat:user_profiles!created_by(full_name), pengoreksi:user_profiles!dikoreksi_by(full_name)',
        { count: 'exact' }
      )
      .eq('business_unit_id', businessUnitId)
      .order('sale_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(dari, sampai);
    if (outletId) query = query.eq('outlet_id', outletId);
    if (dateFrom) query = query.gte('sale_date', dateFrom);
    if (dateTo) query = query.lte('sale_date', dateTo);
    return query;
  });
}

export async function listRecentSalesActivity({ limit = 25, before = null } = {}) {
  let query = supabase
    .from('sales')
    // `user_profiles!created_by`, BUKAN `user_profiles` polos.
    //
    // Sejak 0112 tabel `sales` punya DUA foreign key ke `user_profiles`
    // (`created_by` dan `dikoreksi_by`). Embed polos jadi ambigu, dan PostgREST
    // menolak SELURUH query-nya — bukan cuma kolom itu. Akibatnya kartu
    // "Aktivitas Penjualan Terbaru" di Dashboard Admin akan kosong total.
    //
    // Ini ditemukan `audit-embed-ambigu.cjs`, bukan oleh saya. Kolom baru yang
    // menunjuk tabel yang SUDAH pernah di-embed di tempat lain adalah cara
    // paling mudah merusak layar yang tidak sedang disentuh sama sekali.
    .select(
      'created_at, qty, revenue, products(name), outlets(name), business_units(name), ' +
        'user_profiles!created_by(full_name)'
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
