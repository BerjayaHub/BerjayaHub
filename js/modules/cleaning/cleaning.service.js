import { supabase } from '../../config/supabase-client.js';
import { compressImage } from '../../core/image-compress.js';
import { listMyOutlets } from '../../core/my-outlets.js';

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

/** Outlet yang boleh diakses akun ini di sebuah BU (lihat core/my-outlets.js). */
export async function listBuOutlets(businessUnitId) {
  const mine = await listMyOutlets(businessUnitId);
  return mine.map((o) => ({ id: o.id, name: o.name }));
}

// ---- Item & sesi ----
//
// Sejak migration 0054, item & sesi punya cakupan:
//   outlet_id NULL   = milik BU, berlaku semua outlet (dikelola admin BU)
//   outlet_id terisi = khusus outlet itu (dikelola admin outletnya)
//
// Keduanya DIGABUNG, bukan saling menimpa: ceklis sebuah outlet = standar BU +
// tambahan khusus outlet itu. Kalau menimpa, outlet yang menambah satu item
// akan kehilangan seluruh standar BU-nya — hampir pasti bukan yang dimaksud.

/** Filter "milik BU ATAU milik outlet ini". */
const cakupan = (q, outletId) =>
  outletId ? q.or(`outlet_id.is.null,outlet_id.eq.${outletId}`) : q.is('outlet_id', null);

/**
 * Item aktif untuk satu outlet, dan (sejak 0069) untuk satu SESI.
 *
 * `sessionId` null = jangan saring per sesi (dipakai layar admin yang memang
 * ingin melihat semuanya).
 *
 * ATURANNYA: item yang TIDAK punya satu pun penugasan sesi berlaku di SEMUA
 * sesi. Itu perilaku sebelum 0069, jadi data lama tetap bekerja tanpa satu
 * baris pun dipindahkan.
 *
 * Penyaringannya dikerjakan di sisi klien setelah mengambil daftar penugasan,
 * bukan lewat satu query bersyarat: jumlah itemnya puluhan, sementara
 * "tanpa baris berarti semua" sulit ditulis sebagai filter PostgREST tanpa
 * menjadi query yang tidak bisa dibaca siapa pun enam bulan lagi.
 */
export async function listActiveItems(businessUnitId, outletId = null, sessionId = null) {
  const { data, error } = await cakupan(
    supabase
      .from('checklist_items')
      .select('id, label, sort_order, outlet_id')
      .eq('business_unit_id', businessUnitId)
      .eq('is_active', true),
    outletId
  )
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  const items = data ?? [];
  if (!sessionId || !items.length) return items;

  const { data: tugas, error: errTugas } = await supabase
    .from('checklist_session_items')
    .select('session_id, item_id')
    .in('item_id', items.map((i) => i.id));
  // Gagal baca penugasan -> tampilkan SEMUA item, bukan kosong. Ceklis yang
  // tiba-tiba kosong membuat staff mengira pekerjaannya tidak perlu dilakukan;
  // ceklis yang kepanjangan hanya merepotkan.
  if (errTugas) {
    console.warn('[daily] penugasan sesi tidak terbaca:', errTugas.message);
    return items;
  }

  const punyaTugas = new Set((tugas ?? []).map((t) => t.item_id));
  const untukSesi = new Set((tugas ?? []).filter((t) => t.session_id === sessionId).map((t) => t.item_id));
  return items.filter((i) => !punyaTugas.has(i.id) || untukSesi.has(i.id));
}

/**
 * Peta item_id -> daftar session_id yang ditugaskan padanya.
 * Item yang tidak muncul di peta ini berlaku di semua sesi.
 */
export async function getItemSessionMap(itemIds) {
  const ids = [...new Set((itemIds ?? []).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from('checklist_session_items').select('session_id, item_id').in('item_id', ids);
  if (error) {
    console.warn('[daily] penugasan sesi tidak terbaca:', error.message);
    return new Map();
  }
  const peta = new Map();
  for (const t of data ?? []) {
    if (!peta.has(t.item_id)) peta.set(t.item_id, []);
    peta.get(t.item_id).push(t.session_id);
  }
  return peta;
}

/**
 * Tetapkan sesi mana saja yang memakai item ini.
 * Daftar KOSONG berarti kembali ke "berlaku di semua sesi".
 */
export async function setItemSessions(itemId, sessionIds) {
  const { error: errHapus } = await supabase.from('checklist_session_items').delete().eq('item_id', itemId);
  if (errHapus) throw errHapus;
  const baru = [...new Set((sessionIds ?? []).filter(Boolean))];
  if (!baru.length) return;
  const { data, error } = await supabase
    .from('checklist_session_items')
    .insert(baru.map((session_id) => ({ session_id, item_id: itemId })))
    .select('item_id');
  if (error) throw error;
  // Penolakan RLS pada INSERT memang menghasilkan error, tapi baris yang
  // tersaring sebagian tidak. Diperiksa supaya "tersimpan" tidak berbohong.
  if ((data ?? []).length !== baru.length) {
    throw new Error('Sebagian sesi tidak tersimpan — kamu tidak punya izin mengubah sesi itu.');
  }
}

export async function listActiveSessions(businessUnitId, outletId = null) {
  const { data, error } = await cakupan(
    supabase
      .from('checklist_sessions')
      .select('id, name, sort_order, outlet_id')
      .eq('business_unit_id', businessUnitId)
      .eq('is_active', true),
    outletId
  )
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

/**
 * Pastikan operasi tulis benar-benar mengenai satu baris.
 *
 * RLS menolak dengan cara yang MENIPU: PostgREST tidak menganggap "tidak ada
 * baris yang boleh disentuh" sebagai error, ia membalas sukses dengan 0 baris.
 * Tanpa pemeriksaan ini, admin outlet menekan Hapus pada item milik BU, melihat
 * "Item dihapus", lalu itemnya masih ada. Hanya INSERT yang gagal dengan pesan
 * jelas — itulah kenapa perilakunya terasa tidak konsisten.
 */
function pastikanKena(data, jenis) {
  if (!data?.length) {
    throw new Error(
      `Tidak bisa mengubah ${jenis} ini — ${jenis} milik BU hanya boleh dikelola Admin BU. ` +
        `Kamu bisa membuat ${jenis} khusus outletmu sendiri.`
    );
  }
}

// ---- Admin CRUD item ----

/**
 * SEMUA item BU — milik BU maupun khusus outlet mana pun. Untuk tab Item di
 * Admin Portal, supaya tidak ada item yang "hilang" hanya karena filter.
 *
 * Satu query, bukan satu per outlet: policy baca `checklist_items_select`
 * memakai has_bu_scope, jadi seluruhnya memang sudah boleh dibaca.
 */
export async function listAllItems(businessUnitId) {
  const { data, error } = await supabase
    .from('checklist_items')
    .select('id, label, sort_order, is_active, outlet_id')
    .eq('business_unit_id', businessUnitId)
    .order('outlet_id', { nullsFirst: true })
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function listItems(businessUnitId, outletId = null) {
  const { data, error } = await cakupan(
    supabase.from('checklist_items').select('id, label, sort_order, is_active, outlet_id').eq('business_unit_id', businessUnitId),
    outletId
  )
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}
export async function createItem({ businessUnitId, outletId, label, sort_order }) {
  const { error } = await supabase
    .from('checklist_items')
    .insert({ business_unit_id: businessUnitId, outlet_id: outletId || null, label, sort_order: sort_order ?? 0 });
  if (error) throw error;
}
export async function updateItem(id, { label, sort_order, is_active }) {
  const { data, error } = await supabase
    .from('checklist_items')
    .update({ label, sort_order, is_active })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  pastikanKena(data, 'item');
}
export async function deleteItem(id) {
  const { data, error } = await supabase.from('checklist_items').delete().eq('id', id).select('id');
  if (error) throw error;
  pastikanKena(data, 'item');
}

// ---- Admin CRUD sesi ----

/** SEMUA sesi BU — milik BU maupun khusus outlet mana pun. Lihat listAllItems. */
export async function listAllSessions(businessUnitId) {
  const { data, error } = await supabase
    .from('checklist_sessions')
    .select('id, name, sort_order, is_active, outlet_id')
    .eq('business_unit_id', businessUnitId)
    .order('outlet_id', { nullsFirst: true })
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function listSessions(businessUnitId, outletId = null) {
  const { data, error } = await cakupan(
    supabase.from('checklist_sessions').select('id, name, sort_order, is_active, outlet_id').eq('business_unit_id', businessUnitId),
    outletId
  )
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}
export async function createSession({ businessUnitId, outletId, name, sort_order }) {
  const { error } = await supabase
    .from('checklist_sessions')
    .insert({ business_unit_id: businessUnitId, outlet_id: outletId || null, name, sort_order: sort_order ?? 0 });
  if (error) throw error;
}
export async function updateSession(id, { name, sort_order, is_active }) {
  const { data, error } = await supabase
    .from('checklist_sessions')
    .update({ name, sort_order, is_active })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  pastikanKena(data, 'sesi');
}
export async function deleteSession(id) {
  const { data, error } = await supabase.from('checklist_sessions').delete().eq('id', id).select('id');
  if (error) throw error;
  pastikanKena(data, 'sesi');
}

// ---- Staff: run ----

/** Sesi yang SUDAH dikerjakan hari ini untuk sebuah outlet (set of session_id). */
export async function getTodayDoneSessions(outletId) {
  const runs = await listSessionRuns(outletId, todayWIB());
  return new Set(runs.map((r) => r.session_id));
}

/**
 * Pengerjaan sesi di satu outlet pada satu tanggal — SIAPA dan JAM BERAPA.
 *
 * Sejak `0068` staff satu outlet boleh membaca run rekannya. Sebelum itu RLS
 * memotongnya jadi "punya saya saja", sehingga sesi yang sudah dikerjakan
 * rekannya tetap tampak "Belum" — dan dikerjakan dua kali.
 */
export async function listSessionRuns(outletId, tanggal) {
  const { data, error } = await supabase
    .from('checklist_runs')
    .select('id, session_id, run_date, notes, created_at, user_id, user_profiles(full_name), checklist_sessions(name)')
    .eq('outlet_id', outletId)
    .eq('run_date', tanggal)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
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

  // Aturan "dicentang wajib berfoto" ditegakkan di TIGA lapis: halaman staff
  // (supaya salahnya ketahuan sebelum apa pun terkirim), di sini, dan CHECK
  // constraint di database (0070). Sebelumnya hanya lapis pertama yang ada —
  // dan aturan yang cuma dijaga tampilan bukan aturan, melainkan kebiasaan.
  //
  // Diperiksa SEBELUM run dibuat: kalau ditolak belakangan, run-nya sudah
  // terlanjur lahir dan `unique (outlet_id, session_id, run_date)` akan
  // menolak percobaan ulang hari itu.
  const dicentang = (itemStates ?? []).filter((s) => s.checked);
  if (!dicentang.length) throw new Error('Centang minimal satu item dulu.');
  const tanpaFoto = dicentang.filter((s) => !s.file);
  if (tanpaFoto.length) {
    throw new Error(`${tanpaFoto.length} item yang dicentang belum ada fotonya. Setiap pekerjaan yang diceklis harus punya bukti.`);
  }

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
    // Foto per item ikut diambil di sini (hanya kolom path-nya) supaya kolom
    // Bukti bisa menampilkan thumbnail tanpa satu query tambahan per baris.
    // 500 baris x 1 query = 500 permintaan berbarengan; sebagian akan tertunda
    // lama dan tabelnya tampak "sebagian fotonya rusak".
    .select('id, run_date, notes, photo_path, created_at, user_profiles(full_name), checklist_sessions(name), outlets(name), checklist_run_items(photo_path)')
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
