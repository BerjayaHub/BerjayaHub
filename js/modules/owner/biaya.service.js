import { supabase } from '../../config/supabase-client.js';

/**
 * Daftar biaya yang direncanakan per outlet (0095).
 *
 * ============ INI SATU-SATUNYA TEMPAT HALAMAN OWNER MENULIS DATA ============
 *
 * Selain keputusan tanda tangan, halaman owner tidak menulis apa pun — dan
 * `tools/audit-owner-baca-saja.cjs` yang menjaganya. Berkas ini terdaftar
 * sebagai pengecualian di sana, beserta tabel yang boleh disentuhnya.
 *
 * Kenapa boleh: angka biaya tetap adalah SATU-SATUNYA masukan BEP yang tidak
 * bisa datang dari kejadian operasional. Penjualan, HPP, dan stok semuanya
 * hasil pencatatan di modul lain; sewa dan gaji harus diketik seseorang. Kalau
 * pengetikannya dipindah ke Admin Portal, orang yang sedang membaca BEP harus
 * pindah halaman, mengubah angka, lalu kembali — dan angka yang diubah di
 * tempat lain hampir selalu berakhir tidak diperbarui.
 *
 * Yang TIDAK ikut dibuka: tidak ada fungsi di sini yang menyentuh stok,
 * penjualan, produksi, atau opname.
 */

const KOLOM =
  'id, business_unit_id, outlet_id, name, jenis, satuan, amount, notes, is_active, updated_at, ' +
  'allocation_scope, cost_behavior';

/**
 * Seluruh biaya sebuah BU — termasuk yang TIDAK menempel pada outlet.
 *
 * ============ TIDAK MENYARING `outlet_id` DI QUERY ============
 *
 * Versi pertama memakai `.in('outlet_id', outletIds)`. Sejak `0100`, biaya
 * `shared_bu` dan `corporate` punya `outlet_id` NULL — dan `.in()` tidak pernah
 * meloloskan NULL.
 *
 * Akibatnya: seluruh biaya bersama BU HILANG dari halaman, ringkasan BU
 * menampilkan "Shared BU Cost: Rp 0", dan laba BU terlihat lebih besar daripada
 * kenyataan. Tidak ada error — barisnya memang tidak diminta.
 *
 * Jadi penyaringan outlet dipindah ke mesin hitung (`profit-outlet.js`), yang
 * memang tahu bedanya cakupan langsung dan cakupan luas.
 */
export async function listBiayaOutlet({ businessUnitId, outletIds = null, denganNonaktif = false }) {
  let q = supabase.from('outlet_costs').select(`${KOLOM}, outlets!outlet_id(name)`).eq('business_unit_id', businessUnitId);
  if (!denganNonaktif) q = q.eq('is_active', true);

  const { data, error } = await q.order('jenis').order('amount', { ascending: false });
  if (error) throw error;

  // Penyaringan outlet dikerjakan DI SINI, sesudah semuanya terbaca — dan
  // hanya untuk yang bercakupan langsung. Yang `shared_bu`/`corporate` selalu
  // ikut, apa pun outlet yang sedang dipilih.
  if (!outletIds?.length) return data ?? [];
  return (data ?? []).filter(
    (b) => (b.allocation_scope ?? 'direct_outlet') !== 'direct_outlet' || outletIds.includes(b.outlet_id)
  );
}

export async function tambahBiaya({ businessUnitId, outletId, name, jenis, satuan, amount, notes = null }) {
  const { data: sesi } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('outlet_costs')
    .insert({
      business_unit_id: businessUnitId,
      outlet_id: outletId,
      name: name.trim(),
      jenis,
      satuan,
      amount,
      notes: notes?.trim() || null,
      created_by: sesi?.user?.id ?? null
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function ubahBiaya(id, { name, jenis, satuan, amount, notes = null }) {
  // `.select()` WAJIB. PostgREST tidak menganggap penolakan RLS sebagai error:
  // UPDATE yang ditolak pulang sukses dengan nol baris, dan layar berikutnya
  // menampilkan angka lama seolah penyimpanannya berhasil.
  const { data, error } = await supabase
    .from('outlet_costs')
    .update({ name: name.trim(), jenis, satuan, amount, notes: notes?.trim() || null })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Biaya ini tidak jadi diubah — kemungkinan kamu tidak berhak mengubahnya.');
  return data[0].id;
}

/**
 * Menonaktifkan, BUKAN menghapus.
 *
 * Biaya yang dihapus membuat BEP bulan-bulan sebelumnya tidak bisa dijelaskan
 * lagi: angkanya pernah dipakai mengambil keputusan, lalu penyebabnya lenyap.
 * Yang nonaktif tidak ikut dijumlah tapi tetap bisa dilihat.
 */
export async function nonaktifkanBiaya(id) {
  const { data, error } = await supabase.from('outlet_costs').update({ is_active: false }).eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Biaya ini tidak jadi dinonaktifkan — kemungkinan kamu tidak berhak mengubahnya.');
}

export async function aktifkanBiaya(id) {
  const { data, error } = await supabase.from('outlet_costs').update({ is_active: true }).eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Biaya ini tidak jadi diaktifkan — kemungkinan kamu tidak berhak mengubahnya.');
}

export const LABEL_JENIS = { tetap: 'Tetap', variabel: 'Variabel' };
export const LABEL_SATUAN = {
  per_bulan: 'per bulan',
  per_porsi: 'per porsi',
  persen_omzet: '% dari harga jual'
};

/**
 * Satuan yang sah untuk sebuah jenis.
 *
 * Dijaga juga oleh `outlet_costs_satuan_cocok` di database. Dua lapis, karena
 * yang di layar mencegah orang memilih kombinasi yang salah, sedangkan yang di
 * database mencegahnya masuk lewat jalur mana pun — dan alasan kenapa
 * "variabel per bulan" itu salah ada di header 0095.
 */
export function satuanUntuk(jenis) {
  return jenis === 'tetap' ? ['per_bulan'] : ['per_porsi', 'persen_omzet'];
}
