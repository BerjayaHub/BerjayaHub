import { supabase } from '../../config/supabase-client.js';
import { compressImage } from '../../core/image-compress.js';
import { listAttendanceOutlets } from '../attendance/attendance.service.js';

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

/** Outlet aktif di sebuah BU (lewat RPC security-definer, agar staff level-BU pun bisa lihat). */
export async function listBuOutlets(businessUnitId) {
  const all = await listAttendanceOutlets();
  return all.filter((o) => o.business_unit_id === businessUnitId).map((o) => ({ id: o.id, name: o.name }));
}

// ---- Item & sesi (template per BU) ----

export async function listActiveItems(businessUnitId) {
  const { data, error } = await supabase
    .from('checklist_items')
    .select('id, label, sort_order')
    .eq('business_unit_id', businessUnitId)
    .eq('is_active', true)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function listActiveSessions(businessUnitId) {
  const { data, error } = await supabase
    .from('checklist_sessions')
    .select('id, name, sort_order')
    .eq('business_unit_id', businessUnitId)
    .eq('is_active', true)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

// ---- Admin CRUD item ----

export async function listItems(businessUnitId) {
  const { data, error } = await supabase
    .from('checklist_items')
    .select('id, label, sort_order, is_active')
    .eq('business_unit_id', businessUnitId)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}
export async function createItem({ businessUnitId, label, sort_order }) {
  const { error } = await supabase.from('checklist_items').insert({ business_unit_id: businessUnitId, label, sort_order: sort_order ?? 0 });
  if (error) throw error;
}
export async function updateItem(id, { label, sort_order, is_active }) {
  const { error } = await supabase.from('checklist_items').update({ label, sort_order, is_active }).eq('id', id);
  if (error) throw error;
}
export async function deleteItem(id) {
  const { error } = await supabase.from('checklist_items').delete().eq('id', id);
  if (error) throw error;
}

// ---- Admin CRUD sesi ----

export async function listSessions(businessUnitId) {
  const { data, error } = await supabase
    .from('checklist_sessions')
    .select('id, name, sort_order, is_active')
    .eq('business_unit_id', businessUnitId)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}
export async function createSession({ businessUnitId, name, sort_order }) {
  const { error } = await supabase.from('checklist_sessions').insert({ business_unit_id: businessUnitId, name, sort_order: sort_order ?? 0 });
  if (error) throw error;
}
export async function updateSession(id, { name, sort_order, is_active }) {
  const { error } = await supabase.from('checklist_sessions').update({ name, sort_order, is_active }).eq('id', id);
  if (error) throw error;
}
export async function deleteSession(id) {
  const { error } = await supabase.from('checklist_sessions').delete().eq('id', id);
  if (error) throw error;
}

// ---- Staff: run ----

/** Sesi yang SUDAH dikerjakan hari ini untuk sebuah outlet (set of session_id). */
export async function getTodayDoneSessions(outletId) {
  const { data, error } = await supabase
    .from('checklist_runs')
    .select('session_id')
    .eq('outlet_id', outletId)
    .eq('run_date', todayWIB());
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.session_id));
}

/**
 * Kirim satu sesi Daily Activities.
 *
 * `itemStates`: [{ item_id, checked, note, file }] — foto ada PER ITEM sejak
 * migration 0052. Satu foto tidak pernah bisa membuktikan sepuluh pekerjaan
 * berbeda; foto sesi yang lama praktis hanya membuktikan "seseorang hadir".
 *
 * @param {(pesan: string) => void} [onProgress] dipanggil saat mengunggah tiap
 *   foto. Mengunggah 10 foto butuh waktu, dan layar yang diam tanpa kabar
 *   membuat staff menekan tombolnya berkali-kali atau menutup aplikasi.
 */
export async function submitChecklistRun({ businessUnitId, outletId, sessionId, itemStates, notes }, onProgress) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan, silakan login ulang.');

  const { data: run, error } = await supabase
    .from('checklist_runs')
    .insert({
      business_unit_id: businessUnitId,
      outlet_id: outletId,
      session_id: sessionId,
      run_date: todayWIB(),
      user_id: uid,
      notes: notes || null
    })
    .select()
    .single();
  if (error) throw error;

  // Foto diunggah SEBELUM baris item dibuat, supaya path-nya bisa langsung ikut
  // tersimpan dalam satu insert. Kalau ada unggahan yang gagal, seluruh
  // pengiriman dibatalkan dan run-nya dihapus — lebih baik staff mengulang
  // daripada tersimpan sesi yang itemnya kehilangan bukti tanpa ketahuan.
  const rows = [];
  try {
    const berfoto = (itemStates ?? []).filter((s) => s.file);
    let ke = 0;
    for (const s of itemStates ?? []) {
      let photoPath = null;
      if (s.file) {
        ke++;
        onProgress?.(`Mengunggah foto ${ke} dari ${berfoto.length}…`);
        const kecil = await compressImage(s.file, { preset: 'aktivitas' });
        const ext = kecil.type === 'image/webp' ? 'webp' : 'jpg';
        photoPath = `${outletId}/${run.id}/${s.item_id}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('checklist-photos')
          .upload(photoPath, kecil, { upsert: true, contentType: kecil.type || 'image/jpeg' });
        if (upErr) throw upErr;
      }
      rows.push({ run_id: run.id, item_id: s.item_id, checked: !!s.checked, note: s.note || null, photo_path: photoPath });
    }

    if (rows.length) {
      const { error: itemErr } = await supabase.from('checklist_run_items').insert(rows);
      if (itemErr) throw itemErr;
    }
  } catch (err) {
    // Bersihkan run yang terlanjur dibuat. Kalau dibiarkan, `unique (outlet_id,
    // session_id, run_date)` akan MENOLAK percobaan ulang hari itu — staff
    // terjebak: gagal kirim, dan tidak bisa mencoba lagi sampai besok.
    await supabase.from('checklist_runs').delete().eq('id', run.id);
    throw err;
  }

  return run;
}

// ---- Admin: rekap ----

export async function listRunsForAdmin({ businessUnitId, outletId, dateFrom, dateTo }) {
  let query = supabase
    .from('checklist_runs')
    .select('id, run_date, notes, photo_path, created_at, user_profiles(full_name), checklist_sessions(name), outlets(name)')
    .eq('business_unit_id', businessUnitId)
    .order('run_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);
  if (outletId) query = query.eq('outlet_id', outletId);
  if (dateFrom) query = query.gte('run_date', dateFrom);
  if (dateTo) query = query.lte('run_date', dateTo);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getRunItems(runId) {
  const { data, error } = await supabase
    .from('checklist_run_items')
    .select('checked, note, item_id, photo_path, checklist_items(label)')
    .eq('run_id', runId);
  if (error) throw error;
  return data ?? [];
}

export async function getChecklistPhotoUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('checklist-photos').createSignedUrl(path, 600);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

/**
 * Signed URL untuk banyak foto sekaligus — satu run bisa punya 10-15 foto item.
 * Satu permintaan per foto akan menembakkan belasan koneksi berbarengan dan
 * sebagian tertunda, membuat dialog detail tampak "sebagian fotonya rusak".
 *
 * Gagal = Map kosong; detail item tetap harus bisa dibaca tanpa fotonya.
 */
export async function getChecklistPhotoUrls(paths, expiresIn = 3600) {
  const bersih = [...new Set((paths ?? []).filter(Boolean))];
  if (!bersih.length) return new Map();
  const { data, error } = await supabase.storage.from('checklist-photos').createSignedUrls(bersih, expiresIn);
  if (error) {
    console.warn('[daily activities] gagal membuat signed URL foto:', error.message);
    return new Map();
  }
  return new Map((data ?? []).filter((d) => d.signedUrl && !d.error).map((d) => [d.path, d.signedUrl]));
}

// ---- Dashboard ----

export async function listRecentChecklistActivity({ limit = 25, before = null } = {}) {
  let query = supabase
    .from('checklist_runs')
    .select('created_at, user_profiles(full_name), checklist_sessions(name), outlets(name), business_units(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
