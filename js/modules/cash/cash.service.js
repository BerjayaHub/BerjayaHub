import { supabase } from '../../config/supabase-client.js';
import { compressImage } from '../../core/image-compress.js';

export const ENTRY_LABEL = {
  move_out: 'Pindah keluar',
  move_in: 'Pindah masuk',
  in: 'Kas Masuk',
  out: 'Kas Keluar',
  transfer_out: 'Transfer Keluar',
  transfer_in: 'Transfer Masuk'
};

export function todayWIB() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(wib.getUTCDate())}`;
}

async function currentUserId() {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ---- Kategori (global sejak 0040 — kas ikut user, bukan BU) ----

export async function listCashCategories(onlyActive = true) {
  let q = supabase.from('cash_categories').select('id, name, direction, is_active').order('name');
  if (onlyActive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createCashCategory({ name, direction }) {
  const { error } = await supabase.from('cash_categories').insert({ business_unit_id: null, name, direction: direction || 'both' });
  if (error) throw error;
}
export async function updateCashCategory(id, { name, direction, is_active }) {
  const { error } = await supabase.from('cash_categories').update({ name, direction, is_active }).eq('id', id);
  if (error) throw error;
}
export async function deleteCashCategory(id) {
  const { error } = await supabase.from('cash_categories').delete().eq('id', id);
  if (error) throw error;
}

// ---- Entri kas ----

/**
 * Catat kas masuk/keluar. TIDAK menyimpan BU/outlet — sejak 0040 kas melekat
 * pada USER, jadi saldonya sama di BU/outlet mana pun dia login.
 */
export async function recordCashEntry({ type, amount, categoryId, outletId, accountId, notes, date, qty, unit, file }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan, silakan login ulang.');

  // Aturan berbeda per arah, sesuai keputusan:
  //   KELUAR — nota WAJIB (ada bukti fisiknya) dan outlet peruntukan WAJIB
  //            ("uang ini dibelanjakan untuk outlet mana").
  //   MASUK  — nota opsional; uang masuk sering berupa setoran/owner yang tidak
  //            selalu ada notanya, dan belum tentu diperuntukkan satu outlet.
  if (type === 'out') {
    if (!file) throw new Error('Foto nota wajib dilampirkan untuk kas keluar.');
    if (!outletId) throw new Error('Pilih outlet peruntukan untuk kas keluar.');
  }

  const signed = type === 'out' ? -Math.abs(amount) : Math.abs(amount);
  const id = crypto.randomUUID();
  let path = null;

  // Kalau ada foto, diunggah LEBIH DULU lalu barisnya menyusul dengan
  // `proof_path` sudah terisi. Urutan ini yang membuat constraint "nota wajib"
  // bisa ditegakkan database — kalau barisnya dibuat dulu lalu path diisi lewat
  // UPDATE, baris tanpa nota sempat masuk dan UPDATE yang gagal tidak
  // menghasilkan error apa pun.
  if (file) {
    const kecil = await compressImage(file, { preset: 'bukti' });
    const ext = (kecil.name?.split('.').pop() || 'jpg').toLowerCase();
    path = `${uid}/${id}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('cash-proofs')
      .upload(path, kecil, { upsert: true, contentType: kecil.type || 'image/jpeg' });
    if (upErr) throw upErr;
  }

  const { data, error } = await supabase
    .from('cash_entries')
    .insert({
      id,
      holder_id: uid,
      account_id: accountId || null,
      entry_type: type,
      amount: signed,
      category_id: categoryId || null,
      outlet_id: type === 'out' ? outletId : null,
      notes: notes || null,
      qty: qty === '' || qty == null ? null : Number(qty),
      unit: unit?.trim() || null,
      proof_path: path,
      entry_date: date || todayWIB(),
      created_by: uid
    })
    .select()
    .single();

  if (error) {
    if (path) await supabase.storage.from('cash-proofs').remove([path]).catch(() => {});
    throw error;
  }
  return data;
}

// ---- Kantong kas (sub-kas) ----

/** Kantong kas milik user yang login. Kosong = dia memakai kas tunggal. */
export async function listMyCashAccounts(onlyActive = true) {
  const uid = await currentUserId();
  if (!uid) return [];
  let q = supabase
    .from('cash_accounts')
    .select('id, name, sort_order, is_active')
    .eq('holder_id', uid)
    .order('sort_order')
    .order('name');
  if (onlyActive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** Berapa kantong yang boleh dia punya (diatur admin). 1 = kas tunggal. */
export async function getMyCashAccountLimit() {
  const uid = await currentUserId();
  if (!uid) return 1;
  const { data, error } = await supabase.from('user_profiles').select('cash_account_limit').eq('id', uid).maybeSingle();
  if (error) return 1;
  return Number(data?.cash_account_limit ?? 1);
}

export async function saveCashAccount({ id, name, sort_order, is_active }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan.');
  const baris = { holder_id: uid, name: String(name ?? '').trim(), sort_order: Number(sort_order) || 0, is_active: is_active !== false };
  if (id) {
    const { data, error } = await supabase.from('cash_accounts').update(baris).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Kantong kas ini bukan milikmu.');
    return;
  }
  const { error } = await supabase.from('cash_accounts').insert(baris);
  if (error) throw error;
}

export async function deleteCashAccount(id) {
  // `on delete restrict` di cash_entries menahan penghapusan kantong yang sudah
  // dipakai — riwayatnya tidak boleh kehilangan penunjuk kantongnya. Pesannya
  // diterjemahkan supaya user tahu harus menonaktifkan, bukan menghapus.
  const { data, error } = await supabase.from('cash_accounts').delete().eq('id', id).select('id');
  if (error) {
    if (/foreign key|restrict/i.test(error.message ?? '')) {
      throw new Error('Kantong ini sudah dipakai transaksi. Nonaktifkan saja lewat Edit — riwayatnya tetap terbaca.');
    }
    throw error;
  }
  if (!data?.length) throw new Error('Kantong kas ini bukan milikmu.');
}

/** Saldo per kantong milik user yang login. */
export async function listMyCashAccountBalances() {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from('cash_account_balances')
    .select('account_id, account_name, sort_order, balance')
    .eq('holder_id', uid)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

/** Pindahkan saldo antar kantong SENDIRI. Total saldo tidak berubah. */
export async function pindahKas({ fromAccountId, toAccountId, amount, notes }) {
  const { error } = await supabase.rpc('pindah_kas', {
    p_from: fromAccountId || null,
    p_to: toAccountId || null,
    p_amount: amount,
    p_notes: notes || null
  });
  if (error) throw error;
}

/** Transfer kas ke user lain — boleh lintas BU (kas ikut user). */
export async function transferCash({ toUserId, amount, notes }) {
  const { error } = await supabase.rpc('transfer_cash', {
    p_to_user: toUserId,
    p_amount: amount,
    p_notes: notes || null
  });
  if (error) throw error;
}

/** Saldo kas milikku — satu angka, tidak tergantung BU/outlet yang aktif. */
export async function getMyCashBalance() {
  const uid = await currentUserId();
  if (!uid) return 0;
  const { data, error } = await supabase.from('cash_balances').select('balance').eq('holder_id', uid).maybeSingle();
  if (error) throw error;
  return Number(data?.balance ?? 0);
}

export async function listMyCashEntries(limit = 50) {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from('cash_entries')
    .select('id, entry_type, amount, notes, qty, unit, entry_date, proof_path, created_at, cash_categories(name), cash_accounts(name), outlets!outlet_id(name), counterpart:user_profiles!counterpart_id(full_name)')
    .eq('holder_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Daftar semua anggota (untuk pilihan tujuan transfer & tabel admin). */
export async function listCashMembers() {
  const { data, error } = await supabase.rpc('list_cash_members');
  if (error) throw error;
  return data ?? [];
}

export async function getCashProofUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('cash-proofs').createSignedUrl(path, 600);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

// ---- Admin ----

/** Saldo semua pemegang kas (RLS: hanya super admin yang dapat baris orang lain). */
export async function listCashBalances() {
  const { data, error } = await supabase.from('cash_balances').select('holder_id, balance');
  if (error) throw error;
  return data ?? [];
}

export async function listCashEntriesAdmin({ holderId, entryType, dateFrom, dateTo }) {
  let query = supabase
    .from('cash_entries')
    .select('id, entry_type, amount, notes, entry_date, proof_path, created_at, holder:user_profiles!holder_id(full_name), counterpart:user_profiles!counterpart_id(full_name), cash_categories(name)')
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);
  if (holderId) query = query.eq('holder_id', holderId);
  if (entryType) query = query.eq('entry_type', entryType);
  if (dateFrom) query = query.gte('entry_date', dateFrom);
  if (dateTo) query = query.lte('entry_date', dateTo);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function listRecentCashActivity({ limit = 25, before = null } = {}) {
  let query = supabase
    .from('cash_entries')
    .select('created_at, entry_type, amount, holder:user_profiles!holder_id(full_name), cash_categories(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Laporan kas per pemegang, untuk modul Laporan.
 *
 * Lewat RPC karena dua alasan yang tidak bisa diatasi dari sisi klien:
 *   1. Sejak 0040 baris kas TIDAK menyimpan outlet — outlet di laporan
 *      diturunkan dari tempat kerja utama (★) pemegangnya.
 *   2. RLS cash_entries hanya membuka baris milik sendiri; laporan perlu
 *      lintas orang, dan itu dibuka terkendali di dalam RPC.
 */
export async function laporanKasUser({ from, to, userId = null, outletId = null, categoryId = null }) {
  const { data, error } = await supabase.rpc('laporan_kas_user', {
    p_from: from,
    p_to: to,
    p_user: userId || null,
    p_outlet: outletId || null,
    p_category: categoryId || null
  });
  if (error) throw error;
  return data ?? [];
}
