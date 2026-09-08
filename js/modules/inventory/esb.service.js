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
      .select('receipt_id, qty, unit_cost, line_total, products(name, base_unit)', { count: 'exact' })
      .in('receipt_id', ids)
      .range(dari, sampai)
  );

  const peta = new Map();
  for (const it of items) {
    if (!peta.has(it.receipt_id)) peta.set(it.receipt_id, []);
    peta.get(it.receipt_id).push({
      product_name: it.products?.name ?? '',
      base_unit: it.products?.base_unit ?? '',
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

/** Batalkan penandaan — untuk berkas yang ditolak ESB. */
export async function batalkanTandaEsb(notaIds) {
  const { data, error } = await supabase.rpc('batalkan_tanda_esb', argumenRpc({ p_notas: notaIds }));
  if (error) throw new Error(error.message ?? String(error));
  return Number(data) || 0;
}
