import { supabase } from '../../config/supabase-client.js';
import { ambilSemua } from '../../core/ambil-semua.js';

/**
 * Layanan modul Sparepart & Penjualan Bengkel (BU bertipe workshop).
 *
 * Dua tabel yang dilayani di sini TIDAK menyimpan stok sama sekali:
 * `spareparts` ada supaya nama & kode SKU sama di semua outlet, dan
 * `bengkel_sales` menyimpan nominal omzet harian, bukan baris barang.
 */

const teks = (v) => (v === null || v === undefined ? '' : String(v));

/** Tanggal hari ini menurut WIB — sama dengan yang dipakai modul Penjualan. */
export function todayWIB() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Seluruh master sparepart satu BU.
 *
 * `ambilSemua` dipakai, BUKAN `select()` biasa: PostgREST memotong hasil di
 * 1.000 baris secara diam-diam, dan master ini sudah 1.926 baris pada impor
 * PERTAMA. Daftar yang terpotong tidak melempar galat — ia cuma kehilangan
 * 926 sparepart, dan yang mencarinya akan mengira barangnya belum terdaftar.
 */
export async function listSpareparts(businessUnitId, { hanyaAktif = false } = {}) {
  return ambilSemua((dari, sampai) => {
    let q = supabase
      .from('spareparts')
      .select('id, sku, name, jenis, kategori, merek, harga_dasar, is_active, dari_impor, diimpor_at, diperbarui_at')
      .eq('business_unit_id', businessUnitId);
    if (hanyaAktif) q = q.eq('is_active', true);
    return q.order('name').range(dari, sampai);
  });
}

/** Harga khusus per outlet, dikelompokkan per sparepart. */
export async function listHargaOutlet(businessUnitId) {
  const { data, error } = await supabase
    .from('sparepart_outlet_prices')
    .select('id, sparepart_id, outlet_id, harga, spareparts!inner(business_unit_id)')
    .eq('spareparts.business_unit_id', businessUnitId);
  if (error) throw error;
  const peta = new Map();
  for (const r of data ?? []) {
    if (!peta.has(r.sparepart_id)) peta.set(r.sparepart_id, new Map());
    peta.get(r.sparepart_id).set(r.outlet_id, Number(r.harga));
  }
  return peta;
}

export async function simpanSparepart({ id, business_unit_id, sku, name, jenis, kategori, merek, harga_dasar, is_active }) {
  const baris = {
    business_unit_id,
    // Dibakukan DI SINI juga, bukan hanya di jalur impor. Sparepart yang
    // diketik tangan lewat dialog melewati jalur yang berbeda; tanpa
    // pembakuan yang sama, "555.ltr.bz120" yang diketik orang akan lolos
    // sebagai SKU baru di sebelah "555.LTR.BZ120" hasil impor.
    sku: teks(sku).trim().toUpperCase(),
    name: teks(name).trim(),
    jenis: jenis === 'jasa' ? 'jasa' : 'sparepart',
    kategori: teks(kategori).trim() || null,
    merek: teks(merek).trim() || null,
    harga_dasar: harga_dasar === '' || harga_dasar === null || harga_dasar === undefined ? null : Number(harga_dasar),
    is_active: is_active !== false
  };
  if (!baris.sku) throw new Error('Kode SKU wajib diisi — SKU yang menyamakan barang antar outlet.');
  if (!baris.name) throw new Error('Nama wajib diisi.');

  const q = id
    ? supabase.from('spareparts').update({ ...baris, diperbarui_at: new Date().toISOString() }).eq('id', id).select('id')
    : supabase.from('spareparts').insert(baris).select('id');
  const { data, error } = await q;
  if (error) {
    if (error.code === '23505') throw new Error(`Kode SKU "${baris.sku}" sudah dipakai sparepart lain di BU ini.`);
    throw error;
  }
  if (!data?.length) throw new Error('Tidak tersimpan — master sparepart hanya bisa diubah Admin BU.');
  return data[0].id;
}

export async function hapusSparepart(id) {
  const { data, error } = await supabase.from('spareparts').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Tidak terhapus — hanya Admin BU yang bisa menghapus.');
}

/** Tetapkan (atau hapus) harga khusus satu outlet. */
export async function aturHargaOutlet({ sparepartId, outletId, harga }) {
  // Harga kosong berarti "pakai harga dasar BU" — barisnya DIHAPUS, bukan
  // disimpan sebagai nol. Nol adalah harga; ketiadaan baris adalah pewarisan.
  if (harga === '' || harga === null || harga === undefined) {
    const { error } = await supabase
      .from('sparepart_outlet_prices')
      .delete()
      .eq('sparepart_id', sparepartId)
      .eq('outlet_id', outletId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('sparepart_outlet_prices').upsert(
    { sparepart_id: sparepartId, outlet_id: outletId, harga: Number(harga), diperbarui_at: new Date().toISOString() },
    { onConflict: 'sparepart_id,outlet_id' }
  );
  if (error) throw error;
}

/**
 * Kirim seluruh berkas impor dalam SATU panggilan.
 *
 * Bukan 1.926 upsert dari browser: impor yang gagal di tengah meninggalkan
 * master separuh terisi, dan tidak ada yang tahu separuh yang mana.
 */
export async function imporSparepart(businessUnitId, baris) {
  const { data, error } = await supabase.rpc('impor_sparepart', {
    p_bu: businessUnitId,
    p_rows: baris.map((b) => ({
      sku: b.sku,
      name: b.name,
      jenis: b.jenis,
      kategori: b.kategori,
      merek: b.merek,
      harga: b.harga
    }))
  });
  if (error) throw error;
  return data ?? { baru: 0, diperbarui: 0, dilewati: 0 };
}

// ---------------------------------------------------------------
// PENJUALAN BENGKEL — nominal harian, tanpa barang
// ---------------------------------------------------------------

export async function omzetHari(outletId, tanggal) {
  const { data, error } = await supabase
    .from('bengkel_sales')
    .select('id, omzet_sparepart, omzet_jasa, catatan, dilapor_by, created_at, diperbarui_at')
    .eq('outlet_id', outletId)
    .eq('sale_date', tanggal)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Simpan omzet hari itu — satu baris per outlet per tanggal.
 *
 * `upsert` dengan `onConflict` indeks BIASA (bukan parsial), jadi PostgREST
 * bisa menyimpulkannya. Tanpa ini, staff yang menekan Simpan dua kali —
 * atau dua staff di satu outlet — membuat omzet hari itu terhitung dua kali;
 * laporannya tetap tercetak rapi dan selisihnya baru ketahuan saat dicocokkan
 * dengan setoran kas.
 */
export async function simpanOmzetHari({ businessUnitId, outletId, tanggal, sparepart, jasa, catatan, userId }) {
  const n = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));
  const s = n(sparepart);
  const j = n(jasa);
  if (!Number.isFinite(s) || !Number.isFinite(j)) throw new Error('Nominal harus berupa angka.');
  if (s < 0 || j < 0) throw new Error('Nominal tidak boleh negatif.');

  const { data, error } = await supabase
    .from('bengkel_sales')
    .upsert(
      {
        business_unit_id: businessUnitId,
        outlet_id: outletId,
        sale_date: tanggal,
        omzet_sparepart: s,
        omzet_jasa: j,
        catatan: teks(catatan).trim() || null,
        dilapor_by: userId ?? null,
        diperbarui_at: new Date().toISOString(),
        diperbarui_by: userId ?? null
      },
      { onConflict: 'outlet_id,sale_date' }
    )
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Tidak tersimpan — outlet ini bukan outletmu, atau izinnya belum diberikan.');
  return data[0].id;
}

/** Omzet se-BU dalam satu rentang tanggal. */
export async function omzetRentang(businessUnitId, dari, sampai) {
  return ambilSemua((a, b) => {
    let q = supabase
      .from('bengkel_sales')
      .select('id, outlet_id, sale_date, omzet_sparepart, omzet_jasa, catatan, outlets(name)')
      .eq('business_unit_id', businessUnitId);
    if (dari) q = q.gte('sale_date', dari);
    if (sampai) q = q.lte('sale_date', sampai);
    return q.order('sale_date', { ascending: false }).range(a, b);
  });
}
