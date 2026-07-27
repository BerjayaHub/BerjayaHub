import { supabase } from '../../config/supabase-client.js';

export const ASSET_CONDITION = { normal: 'Normal', rusak: 'Rusak', lainnya: 'Lain-lain' };
export const ASSET_CONDITION_BADGE = { normal: 'badge-approved', rusak: 'badge-rejected', lainnya: 'badge-pending' };
export const ASSET_CONDITION_OPTIONS = Object.entries(ASSET_CONDITION).map(([value, label]) => ({ value, label }));

/** Label kondisi siap tampil: "Lain-lain" selalu disertai catatannya. */
export function conditionText(a) {
  const base = ASSET_CONDITION[a.condition] ?? a.condition;
  return a.condition === 'lainnya' && a.condition_note ? `${base} — ${a.condition_note}` : base;
}

export async function listAssets({ businessUnitId, outletId, condition, q, limit = 500 }) {
  let query = supabase
    .from('assets')
    .select('*, outlets(name), creator:user_profiles!created_by(full_name)')
    .eq('business_unit_id', businessUnitId)
    .order('name')
    .limit(limit);
  if (outletId) query = query.eq('outlet_id', outletId);
  if (condition) query = query.eq('condition', condition);
  if (q) query = query.ilike('name', `%${q}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function currentUserId() {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Simpan aset (tambah / ubah) beserta fotonya.
 * Foto diunggah SETELAH baris ada, karena path-nya memakai id aset — dengan
 * begitu satu aset selalu punya paling banyak satu foto dan tidak ada file
 * yatim saat penyimpanan gagal.
 */
export async function saveAsset({ id, businessUnitId, outletId, name, qty, size, condition, conditionNote, notes, file }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan, silakan login ulang.');

  const payload = {
    business_unit_id: businessUnitId,
    outlet_id: outletId,
    name: name.trim(),
    qty: Number(qty) || 0,
    size: size?.trim() || null,
    condition,
    // Catatan hanya relevan untuk "Lain-lain" — dibersihkan supaya tidak
    // menyisakan keterangan lama yang menyesatkan saat kondisi diubah.
    condition_note: condition === 'lainnya' ? conditionNote?.trim() || null : null,
    notes: notes?.trim() || null,
    updated_by: uid,
    updated_at: new Date().toISOString()
  };

  let assetId = id;
  if (id) {
    const { error } = await supabase.from('assets').update(payload).eq('id', id);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from('assets')
      .insert({ ...payload, created_by: uid })
      .select('id')
      .single();
    if (error) throw error;
    assetId = data.id;
  }

  if (file) {
    const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase();
    const path = `${outletId}/${assetId}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('asset-photos')
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (upErr) throw upErr;
    const { error: updErr } = await supabase.from('assets').update({ photo_path: path }).eq('id', assetId);
    if (updErr) throw updErr;
  }
  return assetId;
}

export async function deleteAsset(id) {
  const { error } = await supabase.from('assets').delete().eq('id', id);
  if (error) throw error;
}

export async function getAssetPhotoUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('asset-photos').createSignedUrl(path, 600);
  if (error) throw error;
  return data?.signedUrl ?? null;
}
