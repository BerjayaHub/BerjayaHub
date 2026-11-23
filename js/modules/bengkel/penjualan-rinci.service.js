/**
 * Penjualan Bengkel (Rinci) — jembatan ke database.
 *
 * Seluruh penulisan lewat RPC (0185). Tabelnya memang tidak punya policy
 * tulis sama sekali: impor yang bisa dilakukan lewat `insert` langsung akan
 * melewati penggantian per invoice, dan hasilnya baris kembar yang
 * menggandakan omzet tanpa satu pun galat.
 */

import { supabase } from '../../config/supabase-client.js';
import { ambilSemua } from '../../core/ambil-semua.js';
import { argumenRpc } from '../../core/rpc-args.js';

/** Pemetaan nama Store Turboly -> outlet. */
export async function daftarStoreMap(businessUnitId) {
  if (!businessUnitId) return [];
  const { data, error } = await supabase
    .from('bengkel_store_map')
    .select('id, store_name, outlet_id, outlets!outlet_id(name)')
    .eq('business_unit_id', businessUnitId)
    .order('store_name');
  if (error) throw new Error(error.message ?? String(error));
  return data ?? [];
}

export async function petakanStore({ businessUnitId, store, outletId }) {
  const { data, error } = await supabase.rpc(
    'petakan_store_bengkel',
    argumenRpc({ p_bu: businessUnitId, p_store: store, p_outlet: outletId })
  );
  if (error) throw new Error(error.message ?? String(error));
  return data ?? {};
}

/**
 * Kirim hasil pembacaan berkas.
 *
 * Jawabannya menyebut berapa invoice BARU dan berapa yang DIGANTI, beserta
 * store yang belum dipetakan. Layar wajib menampilkan ketiganya: "berhasil
 * impor" saja menyembunyikan invoice yang dilewati, dan yang melewatkannya
 * baru tahu saat angkanya kurang di akhir bulan.
 */
export async function imporPenjualanTurboly({ businessUnitId, invoices, berkas }) {
  const { data, error } = await supabase.rpc(
    'impor_penjualan_bengkel',
    argumenRpc({ p_bu: businessUnitId, p_invoices: invoices, p_berkas: berkas ?? null })
  );
  if (error) throw new Error(error.message ?? String(error));
  return data ?? {};
}

export async function simpanInvoiceKorporat({ businessUnitId, invoice }) {
  const { data, error } = await supabase.rpc(
    'simpan_invoice_korporat',
    argumenRpc({ p_bu: businessUnitId, p_invoice: invoice })
  );
  if (error) throw new Error(error.message ?? String(error));
  return data ?? {};
}

export async function hapusInvoiceKorporat(invoiceId) {
  const { data, error } = await supabase.rpc('hapus_invoice_korporat', argumenRpc({ p_id: invoiceId }));
  if (error) throw new Error(error.message ?? String(error));
  return data ?? {};
}

/**
 * Baris penjualan satu rentang.
 *
 * `ambilSemua` — BUKAN satu permintaan. Satu bulan bengkel bisa ratusan
 * invoice × beberapa baris; batas bawaan PostgREST 1000 baris akan memotong
 * diam-diam, dan laporan yang kurang 200 baris tetap tercetak rapi.
 */
export async function barisPenjualan(businessUnitId, { dari = null, sampai = null, outletId = null, sumber = null } = {}) {
  if (!businessUnitId) return [];
  return ambilSemua((awal, akhir) => {
    let q = supabase
      .from('bengkel_penjualan_rinci')
      .select(
        'line_id, invoice_id, outlet_id, outlet_nama, sumber, invoice_no, tanggal, customer, company, nopol, ' +
          'merek, model, pembayaran, urut, item_type, sku, nama, brand, product_type, qty, harga_satuan, ' +
          'diskon, total, modal, laba',
        { count: 'exact' }
      )
      .eq('business_unit_id', businessUnitId)
      .order('tanggal', { ascending: false })
      .order('invoice_no')
      .order('urut');
    if (dari) q = q.gte('tanggal', dari);
    if (sampai) q = q.lte('tanggal', sampai);
    if (outletId) q = q.eq('outlet_id', outletId);
    if (sumber) q = q.eq('sumber', sumber);
    return q.range(awal, akhir);
  });
}

/** Invoice korporat saja — untuk disunting/dihapus. */
export async function invoiceKorporat(businessUnitId, { dari = null, sampai = null } = {}) {
  if (!businessUnitId) return [];
  let q = supabase
    .from('bengkel_sale_invoices')
    .select('id, invoice_no, tanggal, outlet_id, customer, company, nopol, merek, model, pembayaran, catatan, outlets!outlet_id(name)')
    .eq('business_unit_id', businessUnitId)
    .eq('sumber', 'korporat')
    .order('tanggal', { ascending: false });
  if (dari) q = q.gte('tanggal', dari);
  if (sampai) q = q.lte('tanggal', sampai);
  const { data, error } = await q;
  if (error) throw new Error(error.message ?? String(error));
  return data ?? [];
}

/** Baris satu invoice — dipakai saat menyunting invoice korporat. */
export async function barisInvoice(invoiceId) {
  const { data, error } = await supabase
    .from('bengkel_sale_lines')
    .select('id, urut, item_type, sku, nama, brand, product_type, qty, harga_satuan, diskon, total, modal, catatan')
    .eq('invoice_id', invoiceId)
    .order('urut');
  if (error) throw new Error(error.message ?? String(error));
  return data ?? [];
}

// =====================================================================
// PEMBELIAN (0186)
// =====================================================================

/**
 * Pemetaan alamat `Deliver To` -> outlet.
 *
 * Tabelnya SAMA dengan pemetaan Store, dibedakan kolom `jenis` — supaya satu
 * layar mengatur keduanya dan tidak ada dua tempat yang bisa menyimpang.
 */
export async function daftarKirimMap(businessUnitId) {
  if (!businessUnitId) return [];
  const { data, error } = await supabase
    .from('bengkel_store_map')
    .select('id, store_name, outlet_id, jenis, outlets!outlet_id(name)')
    .eq('business_unit_id', businessUnitId)
    .eq('jenis', 'kirim')
    .order('store_name');
  if (error) throw new Error(error.message ?? String(error));
  return data ?? [];
}

export async function petakanTujuanKirim({ businessUnitId, alamat, outletId }) {
  const { data, error } = await supabase.rpc(
    'petakan_tujuan_kirim',
    argumenRpc({ p_bu: businessUnitId, p_alamat: alamat, p_outlet: outletId })
  );
  if (error) throw new Error(error.message ?? String(error));
  return data ?? {};
}

/**
 * Kirim baris pembelian hasil pembacaan berkas.
 *
 * Jawabannya menyebut berapa PO baru, berapa diganti, berapa baris yang masuk
 * sebagai PEMBELIAN PUSAT (alamat kirimnya belum dipetakan atau memang
 * kosong), dan alamat mana saja yang belum dikenali. Layar wajib menampilkan
 * keempatnya — "berhasil impor" saja menyembunyikan pembelian yang tidak
 * terhubung ke outlet mana pun, dan itu baru terasa saat laporannya kosong.
 */
export async function imporPembelianTurboly({ businessUnitId, baris, berkas }) {
  const { data, error } = await supabase.rpc(
    'impor_pembelian_bengkel',
    argumenRpc({ p_bu: businessUnitId, p_baris: baris, p_berkas: berkas ?? null })
  );
  if (error) throw new Error(error.message ?? String(error));
  return data ?? {};
}

/** Baris pembelian satu rentang — `ambilSemua`, alasannya sama dengan penjualan. */
export async function barisPembelian(businessUnitId, { dari = null, sampai = null, outletId = null } = {}) {
  if (!businessUnitId) return [];
  return ambilSemua((awal, akhir) => {
    let q = supabase
      .from('bengkel_pembelian_rinci')
      .select(
        'id, outlet_id, outlet_nama, po_no, urut, tanggal, supplier, supplier_kode, status, pengirim, ' +
          'kirim_ke, sku, nama, product_type, product_code, qty, harga, nilai',
        { count: 'exact' }
      )
      .eq('business_unit_id', businessUnitId)
      .order('tanggal', { ascending: false })
      .order('po_no')
      .order('urut');
    if (dari) q = q.gte('tanggal', dari);
    if (sampai) q = q.lte('tanggal', sampai);
    // `outletId` kosong berarti SEMUA, termasuk pembelian pusat. Menyaring
    // pusat keluar secara bawaan akan membuat nilai pembelian terlihat lebih
    // kecil daripada kenyataannya tanpa ada yang memintanya.
    if (outletId) q = q.eq('outlet_id', outletId);
    return q.range(awal, akhir);
  });
}
