/**
 * Ekspor ke ESB — pengambilan & penyimpanan data (0127).
 *
 * Dua hal yang umurnya berbeda dan karena itu dipisah:
 *   `esb_master` — salinan daftar induk ESB, diganti tiap kali diimpor ulang.
 *   `esb_map`    — keputusan manusia, harus bertahan melewati impor itu.
 */

import { supabase } from '../../config/supabase-client.js';
import { ambilSemua } from '../../core/ambil-semua.js';
import { argumenRpc } from '../../core/rpc-args.js';
import { isoFrom, isoTo } from '../../core/dates.js';

// ---- Daftar induk ESB ----

export async function listEsbMaster(businessUnitId, jenis = null) {
  return ambilSemua((dari, sampai) => {
    let q = supabase
      .from('esb_master')
      .select('id, jenis, kode, nama, keterangan', { count: 'exact' })
      .eq('business_unit_id', businessUnitId)
      .order('jenis')
      .order('nama');
    if (jenis) q = q.eq('jenis', jenis);
    return q.range(dari, sampai);
  });
}

/**
 * Ganti seluruh daftar induk untuk SATU jenis.
 *
 * Hapus-lalu-isi, bukan upsert: daftar ESB bisa MENYUSUT (produk dinonaktifkan
 * di sana), dan upsert akan meninggalkan nama-nama lama yang sudah tidak ada
 * lagi di ESB. Nama hantu seperti itu tetap bisa dipilih di editor pemetaan,
 * lalu berkasnya ditolak berminggu-minggu kemudian.
 *
 * Pemetaannya sendiri TIDAK ikut terhapus — itu tabel yang berbeda, dan itulah
 * seluruh alasan keduanya dipisah.
 */
export async function gantiEsbMaster(businessUnitId, jenis, baris) {
  const { error: hapusErr } = await supabase.from('esb_master').delete().eq('business_unit_id', businessUnitId).eq('jenis', jenis);
  if (hapusErr) throw hapusErr;
  if (!baris?.length) return 0;

  // Nama kembar dibuang di klien: berkas ekspor ESB memuat satu baris per
  // SATUAN, jadi satu produk muncul beberapa kali. Membiarkannya akan ditolak
  // indeks unik dengan pesan yang tidak menyebut nama produknya sama sekali.
  const seen = new Set();
  const bersih = [];
  for (const b of baris) {
    const nama = String(b?.nama ?? '').trim();
    if (!nama) continue;
    const k = nama.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    bersih.push({
      business_unit_id: businessUnitId,
      jenis,
      kode: b.kode ? String(b.kode).trim() : null,
      nama,
      keterangan: b.keterangan ? String(b.keterangan).trim() : null
    });
  }

  // Disisipkan bertahap: 279 produk dalam satu permintaan menghasilkan payload
  // besar yang sebagian perantara jaringan tolak dengan galat yang tidak
  // menyebut sebabnya.
  const UKURAN = 200;
  for (let i = 0; i < bersih.length; i += UKURAN) {
    const { error } = await supabase.from('esb_master').insert(bersih.slice(i, i + UKURAN));
    if (error) throw error;
  }
  return bersih.length;
}

/**
 * Nama supplier yang PERNAH diketik di nota BU ini (0144).
 *
 * Bukan daftar supplier — itu `esb_master` berjenis 'supplier'. Ini daftar
 * ejaan yang terlanjur beredar, beserta berapa notanya dan berapa yang belum
 * diekspor. Tanpa ini layar pemetaan cuma bisa menampilkan daftar ESB, padahal
 * yang justru perlu dibereskan adalah nama yang TIDAK ada di daftar itu.
 */
export async function namaSupplierTerpakai(businessUnitId) {
  const { data, error } = await supabase.rpc('nama_supplier_terpakai', argumenRpc({ p_bu: businessUnitId }));
  if (error) throw new Error(error.message ?? String(error));
  return Array.isArray(data) ? data : [];
}

// ---- Pemetaan ----

export async function listEsbMap(businessUnitId) {
  return ambilSemua((dari, sampai) =>
    supabase
      .from('esb_map')
      .select('id, jenis, kunci, nilai', { count: 'exact' })
      .eq('business_unit_id', businessUnitId)
      .order('jenis')
      .order('kunci')
      .range(dari, sampai)
  );
}

/**
 * Simpan/ubah satu pemetaan. `nilai` kosong berarti HAPUS pemetaannya.
 *
 * Dibedakan dengan sengaja: menyimpan string kosong akan membuat sel template
 * terisi "" dan lolos pemeriksaan "sudah dipetakan", lalu ditolak ESB.
 */
export async function simpanEsbMap(businessUnitId, { jenis, kunci, nilai }) {
  const k = String(kunci ?? '').trim();
  const v = String(nilai ?? '').trim();
  if (!k) throw new Error('Nilai lokal tidak boleh kosong.');

  if (!v) {
    const { error } = await supabase
      .from('esb_map')
      .delete()
      .eq('business_unit_id', businessUnitId)
      .eq('jenis', jenis)
      .ilike('kunci', k);
    if (error) throw error;
    return;
  }

  // Indeks uniknya `lower(btrim(kunci))`, dan PostgREST tidak bisa menyebut
  // indeks berekspresi pada `on conflict`. Jadi: hapus yang cocok lalu sisipkan.
  const { error: hapusErr } = await supabase
    .from('esb_map')
    .delete()
    .eq('business_unit_id', businessUnitId)
    .eq('jenis', jenis)
    .ilike('kunci', k);
  if (hapusErr) throw hapusErr;

  const {
    data: { user }
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('esb_map').insert({
    business_unit_id: businessUnitId,
    jenis,
    kunci: k,
    nilai: v,
    diperbarui_by: user?.id ?? null
  });
  if (error) throw error;
}

// ---- Nota untuk diekspor ----

/**
 * Nota beserta itemnya, siap diberikan ke `barisEsbPurchase`.
 *
 * @param {{businessUnitId: string, from: string, to: string, outletId?: string|null,
 *          termasukSudahEkspor?: boolean}} o
 */
export async function notaUntukEsb({ businessUnitId, from, to, outletId = null, termasukSudahEkspor = false }) {
  const notas = await ambilSemua((dari, sampai) => {
    let q = supabase
      .from('goods_receipts')
      .select(
        'id, code, receipt_date, supplier, invoice_no, notes, outlet_id, payment_status, payment_source, esb_exported_at, outlets!outlet_id(name)',
        { count: 'exact' }
      )
      .eq('business_unit_id', businessUnitId)
      // `receipt_date` bertipe DATE, bukan timestamptz — jadi TIDAK memakai
      // `isoFrom`/`isoTo`. Membubuhkan jam & offset WIB pada kolom DATE justru
      // menggeser batasnya satu hari, kebalikan dari gunanya helper itu.
      .gte('receipt_date', from)
      .lte('receipt_date', to)
      .order('receipt_date')
      .order('code');
    if (outletId) q = q.eq('outlet_id', outletId);
    // Nota yang sudah pernah berangkat disembunyikan secara default.
    // Pembelian ganda di ESB sulit ditelusuri: kedua barisnya terlihat wajar.
    if (!termasukSudahEkspor) q = q.is('esb_exported_at', null);
    return q.range(dari, sampai);
  });

  if (!notas.length) return { notas: [], itemsPerNota: new Map() };

  const ids = notas.map((n) => n.id);
  const items = await ambilSemua((dari, sampai) =>
    supabase
      .from('goods_receipt_items')
      // `purchase_unit` & `purchase_qty` IKUT sejak ekspor memakai satuan beli.
      // Tanpa keduanya `keSatuanBeli` tidak punya pengali, dan SELURUH nota
      // diam-diam berangkat dalam satuan kecil lagi — persis keadaan yang
      // ditolak ESB, tanpa satu pun tanda bahwa konversinya tidak jalan.
      .select('receipt_id, qty, unit_cost, line_total, products(name, base_unit, purchase_unit, purchase_qty)', {
        count: 'exact'
      })
      .in('receipt_id', ids)
      .range(dari, sampai)
  );

  const peta = new Map();
  for (const it of items) {
    if (!peta.has(it.receipt_id)) peta.set(it.receipt_id, []);
    peta.get(it.receipt_id).push({
      product_name: it.products?.name ?? '',
      base_unit: it.products?.base_unit ?? '',
      purchase_unit: it.products?.purchase_unit ?? '',
      purchase_qty: it.products?.purchase_qty ?? null,
      qty: it.qty,
      unit_cost: it.unit_cost,
      line_total: it.line_total
    });
  }

  return {
    notas: notas.map((n) => ({ ...n, outlet_name: n.outlets?.name ?? '' })),
    itemsPerNota: peta
  };
}

/** Tandai nota yang BENAR-BENAR ikut terunduh. Dipanggil sesudah berkasnya jadi. */
export async function tandaiNotaEsb(notaIds) {
  const { data, error } = await supabase.rpc('tandai_nota_esb', argumenRpc({ p_notas: notaIds }));
  if (error) throw new Error(error.message ?? String(error));
  return Number(data) || 0;
}

/**
 * Nota yang SUDAH bertanda ekspor, untuk layar "Batalkan tanda ekspor".
 *
 * Ringan dengan sengaja: tanpa itemnya. Layar ini tidak membangun berkas, ia
 * cuma perlu menampilkan kode, tanggal, supplier, dan jejaknya — memuat seluruh
 * item untuk ratusan nota cuma memperlambat halaman yang dibuka justru saat
 * orangnya sedang buru-buru.
 */
export async function notaBertandaEsb({ businessUnitId, from, to, outletId = null }) {
  const baris = await ambilSemua((dari, sampai) => {
    let q = supabase
      .from('goods_receipts')
      .select(
        'id, code, receipt_date, supplier, invoice_no, outlet_id, esb_exported_at, esb_dibatalkan_at, esb_alasan_batal, ' +
          'outlets!outlet_id(name), pembatal:user_profiles!esb_dibatalkan_by(full_name)',
        { count: 'exact' }
      )
      .eq('business_unit_id', businessUnitId)
      .not('esb_exported_at', 'is', null)
      // `receipt_date` bertipe DATE — tanpa jam & offset, sama seperti di
      // `notaUntukEsb`. Lihat catatan panjangnya di sana.
      .gte('receipt_date', from)
      .lte('receipt_date', to)
      .order('esb_exported_at', { ascending: false });
    if (outletId) q = q.eq('outlet_id', outletId);
    return q.range(dari, sampai);
  });
  return baris.map((n) => ({ ...n, outlet_name: n.outlets?.name ?? '' }));
}

/** Kiriman yang SUDAH bertanda ekspor. Bentuknya disamakan dengan nota. */
export async function kirimanBertandaEsb({ businessUnitId, from, to, outletId = null }) {
  const baris = await ambilSemua((dari, sampai) => {
    let q = supabase
      .from('dispatches')
      .select(
        'id, code, received_at, from_outlet_id, to_outlet_id, esb_exported_at, esb_dibatalkan_at, esb_alasan_batal, ' +
          'from_outlet:outlets!from_outlet_id(name), to_outlet:outlets!to_outlet_id(name), ' +
          'pembatal:user_profiles!esb_dibatalkan_by(full_name)',
        { count: 'exact' }
      )
      .eq('business_unit_id', businessUnitId)
      .not('esb_exported_at', 'is', null)
      // `received_at` timestamptz — di sini batas WIB eksplisit memang perlu.
      .gte('received_at', isoFrom(from))
      .lte('received_at', isoTo(to))
      .order('esb_exported_at', { ascending: false });
    // Dua sisi, sama seperti `kirimanUntukEsb`: menyaring satu sisi saja
    // menyembunyikan separuh mutasi tergantung dari mana admin melihatnya.
    if (outletId) q = q.or(`from_outlet_id.eq.${outletId},to_outlet_id.eq.${outletId}`);
    return q.range(dari, sampai);
  });
  return baris.map((d) => ({
    ...d,
    receipt_date: d.received_at,
    outlet_name: `${d.from_outlet?.name ?? ''} → ${d.to_outlet?.name ?? ''}`
  }));
}

/**
 * Batalkan penandaan nota. Alasan WAJIB (0143).
 *
 * `p_alasan` selalu dikirim, termasuk saat kosong: biar databasenya yang
 * menolak dengan kalimatnya sendiri. Kalau kunci ini dibuang saat kosong,
 * `argumenRpc` menghilangkannya dari muatan dan PostgREST tidak menemukan
 * fungsi yang cocok — galatnya jadi "function not found", yang tidak
 * memberitahu siapa pun bahwa yang kurang adalah alasannya.
 */
export async function batalkanTandaEsb(notaIds, alasan) {
  const { data, error } = await supabase.rpc(
    'batalkan_tanda_esb',
    argumenRpc({ p_notas: notaIds, p_alasan: String(alasan ?? '') })
  );
  if (error) throw new Error(error.message ?? String(error));
  return Number(data) || 0;
}

// ---- Kiriman untuk diekspor (Simple Transfer, 0128) ----

/**
 * Kiriman beserta itemnya, siap diberikan ke `barisEsbTransfer`.
 *
 * Hanya status 'received'. Aturannya juga ada di `tandai_kiriman_esb` (0128) —
 * ditulis dua kali dengan sengaja: yang di sini menentukan apa yang TERLIHAT,
 * yang di database menentukan apa yang boleh DITANDAI. Kalau suatu saat query
 * ini berubah, database tetap menolak.
 *
 * @param {{businessUnitId: string, from: string, to: string, outletId?: string|null,
 *          termasukSudahEkspor?: boolean}} o
 */
export async function kirimanUntukEsb({ businessUnitId, from, to, outletId = null, termasukSudahEkspor = false }) {
  const kiriman = await ambilSemua((dari, sampai) => {
    let q = supabase
      .from('dispatches')
      .select(
        'id, code, status, notes, received_at, from_outlet_id, to_outlet_id, esb_exported_at, ' +
          'from_outlet:outlets!from_outlet_id(name), to_outlet:outlets!to_outlet_id(name)',
        { count: 'exact' }
      )
      .eq('business_unit_id', businessUnitId)
      .eq('status', 'received')
      // `received_at` bertipe timestamptz — berbeda dengan `receipt_date` di
      // nota, yang DATE. Di sini batas WIB eksplisit memang diperlukan, kalau
      // tidak kiriman sore hari terakhir rentang akan hilang.
      .gte('received_at', isoFrom(from))
      .lte('received_at', isoTo(to))
      .order('received_at')
      .order('code');
    // Penyaringan outlet memakai `.or()` supaya kiriman KELUAR maupun MASUK
    // outlet itu ikut. Menyaring satu sisi saja akan membuat separuh mutasi
    // hilang dari ESB tergantung dari mana admin melihatnya.
    if (outletId) q = q.or(`from_outlet_id.eq.${outletId},to_outlet_id.eq.${outletId}`);
    if (!termasukSudahEkspor) q = q.is('esb_exported_at', null);
    return q.range(dari, sampai);
  });

  if (!kiriman.length) return { kiriman: [], itemsPerKiriman: new Map() };

  const ids = kiriman.map((d) => d.id);
  const items = await ambilSemua((dari, sampai) =>
    supabase
      .from('dispatch_items')
      .select('dispatch_id, sent_qty, received_qty, products(name, base_unit)', { count: 'exact' })
      .in('dispatch_id', ids)
      .range(dari, sampai)
  );

  const peta = new Map();
  for (const it of items) {
    if (!peta.has(it.dispatch_id)) peta.set(it.dispatch_id, []);
    peta.get(it.dispatch_id).push({
      product_name: it.products?.name ?? '',
      base_unit: it.products?.base_unit ?? '',
      sent_qty: it.sent_qty,
      received_qty: it.received_qty
    });
  }

  return {
    kiriman: kiriman.map((d) => ({
      ...d,
      from_outlet_name: d.from_outlet?.name ?? '',
      to_outlet_name: d.to_outlet?.name ?? ''
    })),
    itemsPerKiriman: peta
  };
}

/** Tandai kiriman yang BENAR-BENAR ikut terunduh. Dipanggil sesudah berkasnya jadi. */
export async function tandaiKirimanEsb(kirimanIds) {
  const { data, error } = await supabase.rpc('tandai_kiriman_esb', argumenRpc({ p_kiriman: kirimanIds }));
  if (error) throw new Error(error.message ?? String(error));
  return Number(data) || 0;
}

/** Batalkan penandaan kiriman. Alasan WAJIB (0143) — lihat catatan di atas. */
export async function batalkanTandaKirimanEsb(kirimanIds, alasan) {
  const { data, error } = await supabase.rpc(
    'batalkan_tanda_kiriman_esb',
    argumenRpc({ p_kiriman: kirimanIds, p_alasan: String(alasan ?? '') })
  );
  if (error) throw new Error(error.message ?? String(error));
  return Number(data) || 0;
}

// ---- Waste untuk diekspor (Item Journal, 0146) ----

/**
 * Waste/spoil beserta rincian bahannya, siap diberikan ke `barisEsbJournal`.
 *
 * `outletId` WAJIB, dan itu bukan kelonggaran yang bisa dicabut: template Item
 * Journal tidak punya kolom outlet sama sekali, jadi outletnya ditentukan saat
 * diimpor di ESB. Berkas gabungan beberapa outlet akan masuk seluruhnya ke
 * outlet yang dipilih saat impor — stok outlet lain berkurang di ESB tanpa
 * pernah berkurang di sini, dan tidak ada satu pun pesan yang menandakannya.
 */
export async function wasteUntukEsb({ businessUnitId, from, to, outletId, termasukSudahEkspor = false }) {
  if (!outletId) throw new Error('Pilih satu outlet dulu — berkas Item Journal tidak punya kolom outlet.');

  const runs = await ambilSemua((dari, sampai) => {
    let q = supabase
      .from('waste_runs')
      .select('id, code, jenis, notes, purpose, outlet_id, created_at, esb_exported_at', { count: 'exact' })
      .eq('business_unit_id', businessUnitId)
      .eq('outlet_id', outletId)
      // `created_at` timestamptz — batas WIB eksplisit memang diperlukan, kalau
      // tidak waste sore hari di ujung rentang akan hilang.
      .gte('created_at', isoFrom(from))
      .lte('created_at', isoTo(to))
      .order('created_at')
      .order('code');
    if (!termasukSudahEkspor) q = q.is('esb_exported_at', null);
    return q.range(dari, sampai);
  });

  if (!runs.length) return { waste: [], itemsPerWaste: new Map() };

  const ids = runs.map((w) => w.id);
  const items = await ambilSemua((dari, sampai) =>
    supabase
      .from('waste_items')
      .select('waste_id, product_id, qty, products(name, base_unit)', { count: 'exact' })
      .in('waste_id', ids)
      .range(dari, sampai)
  );

  const peta = new Map();
  for (const it of items) {
    if (!peta.has(it.waste_id)) peta.set(it.waste_id, []);
    peta.get(it.waste_id).push({
      product_id: it.product_id,
      product_name: it.products?.name ?? '',
      base_unit: it.products?.base_unit ?? '',
      qty: it.qty
    });
  }

  return { waste: runs, itemsPerWaste: peta };
}

/** Tandai waste yang BENAR-BENAR ikut terunduh. Dipanggil sesudah berkasnya jadi. */
export async function tandaiWasteEsb(wasteIds) {
  const { data, error } = await supabase.rpc('tandai_waste_esb', argumenRpc({ p_waste: wasteIds }));
  if (error) throw new Error(error.message ?? String(error));
  return Number(data) || 0;
}

/** Batalkan penandaan waste. Alasan WAJIB (0146). */
export async function batalkanTandaWasteEsb(wasteIds, alasan) {
  const { data, error } = await supabase.rpc(
    'batalkan_tanda_waste_esb',
    argumenRpc({ p_waste: wasteIds, p_alasan: String(alasan ?? '') })
  );
  if (error) throw new Error(error.message ?? String(error));
  return Number(data) || 0;
}

// ---- Kas keluar untuk diekspor (Disbursement, 0149) ----

/**
 * Kode yang bisa dibaca manusia untuk sebuah entri kas.
 *
 * `cash_entries` tidak punya kolom nomor — ia tidak pernah perlu satu, karena
 * tidak ada dokumen fisik yang menunjuknya. Untuk berkas ESB kolom itu wajib
 * ada: `Additional Information` adalah satu-satunya cara mencocokkan baris di
 * ESB kembali ke entri kas di sini saat angkanya dipertanyakan.
 *
 * Diturunkan dari id-nya, bukan nomor berjalan baru: nomor berjalan menuntut
 * tabel penghitung dan bisa berulang kalau dua orang mencatat bersamaan.
 */
export function kodeKas(id) {
  return `KAS-${String(id ?? '').slice(0, 8).toUpperCase()}`;
}

/**
 * Kas keluar yang siap diekspor sebagai Disbursement.
 *
 * ============ HANYA PENGELUARAN SELAIN BAHAN ============
 *
 * Empat saringan, dan tiga di antaranya bukan selera:
 *
 *   entry_type = 'out'      -> kas masuk & transfer bukan pengeluaran
 *   untuk_nota = false      -> pembayaran nota; bahannya sudah berangkat lewat
 *                              Simple Purchase, dan mengirimnya lagi di sini
 *                              mencatat pengeluaran yang sama dua kali
 *   penyesuaian_nota null   -> koreksi otomatis dari nota, bukan catatan kas
 *                              yang berdiri sendiri
 *   dicoret_at null         -> entri yang sudah dihapus (0141)
 *
 * Keduanya yang pertama dijaga CONSTRAINT TRIGGER di database (0122/0131),
 * jadi flag-nya tidak bisa dikarang dari klien — pemisahannya bisa dipercaya.
 */
export async function kasUntukEsb({ businessUnitId, from, to, outletId = null, termasukSudahEkspor = false }) {
  const baris = await ambilSemua((dari, sampai) => {
    let q = supabase
      .from('cash_entries')
      .select(
        'id, entry_date, amount, notes, supplier, outlet_id, category_id, esb_exported_at, ' +
          'outlets!outlet_id(name), cash_categories!category_id(name)',
        { count: 'exact' }
      )
      .eq('business_unit_id', businessUnitId)
      .eq('entry_type', 'out')
      .eq('untuk_nota', false)
      .is('penyesuaian_nota', null)
      .is('dicoret_at', null)
      // `entry_date` bertipe DATE — disaring apa adanya, tanpa batas WIB.
      // Membubuhkan jam pada kolom DATE justru menggeser hasilnya.
      .gte('entry_date', from)
      .lte('entry_date', to)
      .order('entry_date')
      .order('id');
    if (!termasukSudahEkspor) q = q.is('esb_exported_at', null);
    if (outletId) q = q.eq('outlet_id', outletId);
    return q.range(dari, sampai);
  });

  return baris.map((c) => ({
    id: c.id,
    kode: kodeKas(c.id),
    entry_date: c.entry_date,
    amount: c.amount,
    notes: c.notes,
    supplier: c.supplier,
    outlet_nama: c.outlets?.name ?? '',
    kategori_nama: c.cash_categories?.name ?? ''
  }));
}

/** Tandai kas keluar yang BENAR-BENAR ikut terunduh. Dipanggil sesudah berkasnya jadi. */
export async function tandaiKasEsb(ids) {
  const { data, error } = await supabase.rpc('tandai_kas_esb', argumenRpc({ p_entries: ids }));
  if (error) throw new Error(error.message ?? String(error));
  return Number(data) || 0;
}

/** Batalkan penandaan kas keluar. Alasan WAJIB (0143). */
export async function batalkanTandaKasEsb(ids, alasan) {
  const { data, error } = await supabase.rpc(
    'batalkan_tanda_kas_esb',
    argumenRpc({ p_entries: ids, p_alasan: String(alasan ?? '') })
  );
  if (error) throw new Error(error.message ?? String(error));
  return Number(data) || 0;
}

/** Kas keluar yang SUDAH bertanda ekspor, untuk layar "Batalkan tanda ekspor". */
export async function kasBertandaEsb({ businessUnitId, from, to, outletId = null }) {
  const baris = await ambilSemua((dari, sampai) => {
    let q = supabase
      .from('cash_entries')
      .select(
        'id, entry_date, amount, notes, supplier, outlet_id, esb_exported_at, esb_dibatalkan_at, esb_alasan_batal, ' +
          'outlets!outlet_id(name), pembatal:user_profiles!esb_dibatalkan_by(full_name)',
        { count: 'exact' }
      )
      .eq('business_unit_id', businessUnitId)
      .eq('entry_type', 'out')
      .not('esb_exported_at', 'is', null)
      .gte('entry_date', from)
      .lte('entry_date', to)
      .order('esb_exported_at', { ascending: false });
    if (outletId) q = q.eq('outlet_id', outletId);
    return q.range(dari, sampai);
  });
  // Bentuknya disamakan dengan nota, kiriman & waste supaya layar "Batalkan
  // tanda ekspor" tidak perlu tahu ia sedang menampilkan jenis dokumen mana.
  return baris.map((c) => ({
    ...c,
    code: kodeKas(c.id),
    receipt_date: c.entry_date,
    supplier: c.supplier || c.notes || '',
    outlet_name: c.outlets?.name ?? ''
  }));
}

/** Waste yang SUDAH bertanda ekspor, untuk layar "Batalkan tanda ekspor". */
export async function wasteBertandaEsb({ businessUnitId, from, to, outletId = null }) {
  const baris = await ambilSemua((dari, sampai) => {
    let q = supabase
      .from('waste_runs')
      .select(
        'id, code, jenis, outlet_id, created_at, esb_exported_at, esb_dibatalkan_at, esb_alasan_batal, ' +
          'outlets!outlet_id(name), pembatal:user_profiles!esb_dibatalkan_by(full_name)',
        { count: 'exact' }
      )
      .eq('business_unit_id', businessUnitId)
      .not('esb_exported_at', 'is', null)
      .gte('created_at', isoFrom(from))
      .lte('created_at', isoTo(to))
      .order('esb_exported_at', { ascending: false });
    if (outletId) q = q.eq('outlet_id', outletId);
    return q.range(dari, sampai);
  });
  // Bentuknya disamakan dengan nota & kiriman supaya layar "Batalkan tanda
  // ekspor" tidak perlu tahu ia sedang menampilkan jenis dokumen yang mana.
  return baris.map((w) => ({
    ...w,
    receipt_date: w.created_at,
    supplier: w.jenis === 'menu' ? 'Waste menu' : 'Spoil bahan',
    outlet_name: w.outlets?.name ?? ''
  }));
}
