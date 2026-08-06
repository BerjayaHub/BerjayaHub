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
    .select('id, session_id, run_date, notes, created_at, user_id, user_profiles(full_name), checklist_sessions(name), checklist_run_items(item_id, checked)')
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
  // HANYA item yang dikerjakan yang dicatat.
  //
  // Versi sebelumnya juga menyimpan baris untuk item yang TIDAK dicentang.
  // Sekilas rapi, tapi itu berarti setelah pengiriman pertama semua item sudah
  // "punya baris" — dan sesi yang baru terisi 1 dari 15 akan terhitung tuntas,
  // persis membatalkan kemampuan melanjutkan yang baru saja dibuat.
  //
  // Sekarang artinya tegas: ada baris = dikerjakan & ada buktinya; tidak ada
  // baris = belum dikerjakan, dan masih bisa dilanjutkan hari itu.
  const rows = [];
  try {
    let ke = 0;
    for (const s of dicentang) {
      ke++;
      onProgress?.(`Mengunggah foto ${ke} dari ${dicentang.length}…`);
      const kecil = await compressImage(s.file, { preset: 'aktivitas' });
      const ext = kecil.type === 'image/webp' ? 'webp' : 'jpg';
      const photoPath = `${outletId}/${run.id}/${s.item_id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('checklist-photos')
        .upload(photoPath, kecil, { upsert: true, contentType: kecil.type || 'image/jpeg' });
      if (upErr) throw upErr;
      rows.push({
        run_id: run.id,
        item_id: s.item_id,
        checked: true,
        note: s.note || null,
        photo_path: photoPath,
        done_by: uid
      });
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

/**
 * Tambahkan item ke run yang SUDAH ADA — melanjutkan sesi yang belum tuntas.
 *
 * Kenapa perlu: `unique (outlet_id, session_id, run_date)` membuat satu sesi
 * hanya boleh punya satu run per hari. Sebelum 0071 itu berarti staff yang
 * mengerjakan 1 dari 15 item lalu menekan Kirim akan MENGUNCI sesi itu seharian
 * — 14 sisanya tidak bisa diisi siapa pun, dan rekapnya tetap menyatakan sesi
 * itu beres.
 *
 * Item yang sudah punya baris TIDAK bisa ditimpa: `uq_checklist_run_item`
 * menolaknya dengan error yang terlihat, bukan mengganti bukti tanpa jejak.
 *
 * @returns {Promise<number>} jumlah item yang berhasil ditambahkan
 */
export async function lanjutkanChecklistRun({ runId, outletId, itemStates }, onProgress) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan, silakan login ulang.');

  const dicentang = (itemStates ?? []).filter((s) => s.checked);
  if (!dicentang.length) throw new Error('Centang minimal satu item dulu.');
  const tanpaFoto = dicentang.filter((s) => !s.file);
  if (tanpaFoto.length) {
    throw new Error(`${tanpaFoto.length} item yang dicentang belum ada fotonya. Setiap pekerjaan yang diceklis harus punya bukti.`);
  }

  // Data LAMA menyimpan baris untuk item yang tidak dicentang juga. Untuk item
  // seperti itu, melanjutkan berarti MEMPERBARUI barisnya — `uq_checklist_run_item`
  // menolak insert kedua untuk pasangan (run, item) yang sama.
  const barisAda = await getRunItemIds(runId).catch(() => new Map());

  const rows = [];
  const perbarui = [];
  const terunggah = [];
  try {
    let ke = 0;
    for (const s of dicentang) {
      ke++;
      onProgress?.(`Mengunggah foto ${ke} dari ${dicentang.length}…`);
      const kecil = await compressImage(s.file, { preset: 'aktivitas' });
      const ext = kecil.type === 'image/webp' ? 'webp' : 'jpg';
      const photoPath = `${outletId}/${runId}/${s.item_id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('checklist-photos')
        .upload(photoPath, kecil, { upsert: true, contentType: kecil.type || 'image/jpeg' });
      if (upErr) throw upErr;
      terunggah.push(photoPath);
      const isi = { checked: true, note: s.note || null, photo_path: photoPath, done_by: uid, done_at: new Date().toISOString() };
      if (barisAda.has(s.item_id)) perbarui.push({ item_id: s.item_id, isi });
      else rows.push({ run_id: runId, item_id: s.item_id, ...isi });
    }

    if (rows.length) {
      const { data, error } = await supabase.from('checklist_run_items').insert(rows).select('id');
      if (error) throw error;
      // Penolakan RLS tidak selalu berupa error — baris yang tersaring diam-diam
      // menghasilkan "sukses" dengan jumlah yang lebih sedikit.
      if ((data ?? []).length !== rows.length) {
        throw new Error('Sebagian item tidak tersimpan. Coba muat ulang halamannya.');
      }
    }

    for (const u of perbarui) {
      const { data, error } = await supabase
        .from('checklist_run_items')
        .update(u.isi)
        .eq('run_id', runId)
        .eq('item_id', u.item_id)
        // Syarat ini juga ada di policy 0072. Ditulis lagi di sini supaya
        // penolakannya jelas: bukti yang sudah ada tidak boleh tertimpa.
        .eq('checked', false)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Item ini sudah dikerjakan orang lain barusan. Muat ulang halamannya.');
    }

    return rows.length + perbarui.length;
  } catch (err) {
    // Foto yang terlanjur naik tapi barisnya gagal dibuat akan jadi file yatim
    // yang memakan kuota tanpa membuktikan apa pun.
    for (const path of terunggah) {
      await supabase.storage.from('checklist-photos').remove([path]).catch(() => {});
    }
    throw err;
  }
}

/**
 * Perbaiki satu item yang DIA SENDIRI kerjakan (hari ini saja — policy 0073).
 *
 * Foto baru ditulis ke path yang SAMA (`upsert`), jadi tidak ada file lama yang
 * tertinggal. Kalau `file` kosong, hanya catatannya yang diperbarui.
 */
export async function ubahItemRun({ runId, itemId, outletId, note, file }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan, silakan login ulang.');

  const isi = { note: note || null, done_by: uid, done_at: new Date().toISOString() };
  if (file) {
    const kecil = await compressImage(file, { preset: 'aktivitas' });
    const ext = kecil.type === 'image/webp' ? 'webp' : 'jpg';
    const photoPath = `${outletId}/${runId}/${itemId}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('checklist-photos')
      .upload(photoPath, kecil, { upsert: true, contentType: kecil.type || 'image/jpeg' });
    if (upErr) throw upErr;
    isi.photo_path = photoPath;
  }

  const { data, error } = await supabase
    .from('checklist_run_items')
    .update(isi)
    .eq('run_id', runId)
    .eq('item_id', itemId)
    .select('id');
  if (error) throw error;
  // Penolakan RLS pada UPDATE tidak menghasilkan error — hanya 0 baris.
  if (!data?.length) {
    throw new Error('Tidak bisa diubah. Kamu hanya boleh memperbaiki pekerjaanmu sendiri, dan hanya di hari yang sama.');
  }
}

/**
 * Hapus catatan satu item — mengembalikannya ke keadaan "belum dikerjakan"
 * supaya bisa diulang dengan bukti yang benar.
 *
 * Barisnya dihapus DULU, baru fotonya. Kalau dibalik dan penghapusan baris
 * ditolak, yang tersisa adalah baris yang menunjuk foto yang sudah tidak ada —
 * "bukti" berupa gambar rusak, yang lebih buruk daripada tidak ada apa-apa.
 */
export async function hapusItemRun({ runId, itemId, photoPath }) {
  const { data, error } = await supabase
    .from('checklist_run_items')
    .delete()
    .eq('run_id', runId)
    .eq('item_id', itemId)
    .select('id');
  if (error) throw error;
  if (!data?.length) {
    throw new Error('Tidak bisa dihapus. Kamu hanya boleh menghapus pekerjaanmu sendiri, dan hanya di hari yang sama.');
  }
  if (photoPath) {
    // Gagal menghapus foto tidak dilaporkan sebagai kegagalan: catatannya sudah
    // hilang, dan file yatim bukan sesuatu yang bisa diperbuat staff.
    await supabase.storage.from('checklist-photos').remove([photoPath]).catch(() => {});
  }
}

/**
 * Item mana saja yang SUDAH tercatat di sebuah run.
 * Dipakai untuk mengunci item yang sudah punya bukti saat sesi dilanjutkan.
 */
export async function getRunItemIds(runId) {
  const { data, error } = await supabase
    .from('checklist_run_items')
        // `done_by` (skalar) WAJIB ikut, bukan cuma embed namanya: layar memakainya
    // untuk memutuskan siapa yang boleh menekan Perbaiki/Hapus. Tanpa kolom ini
    // tombolnya tidak pernah muncul untuk siapa pun — gagal senyap, karena
    // tampilannya tetap normal.
    .select('item_id, checked, photo_path, note, done_at, done_by, pengerja:user_profiles!done_by(full_name)')
    .eq('run_id', runId);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.item_id, r]));
}

/**
 * Item aktif per SESI untuk satu outlet, dalam DUA query saja.
 *
 * Dipakai layar daftar sesi untuk menghitung kemajuan tiap sesi. Memanggil
 * `listActiveItems()` sekali per sesi berarti 2 query per sesi — untuk outlet
 * dengan 4 sesi itu 8 permintaan hanya untuk menggambar empat kartu.
 */
export async function getItemsPerSession(businessUnitId, outletId, sessions) {
  const semua = await listActiveItems(businessUnitId, outletId);
  const peta = new Map();
  if (!semua.length || !sessions?.length) {
    for (const s of sessions ?? []) peta.set(s.id, []);
    return peta;
  }
  const tugas = await getItemSessionMap(semua.map((i) => i.id));
  const punyaTugas = new Set([...tugas.keys()]);
  for (const s of sessions) {
    peta.set(
      s.id,
      // Aturan 0069: item tanpa penugasan berlaku di semua sesi.
      semua.filter((i) => !punyaTugas.has(i.id) || (tugas.get(i.id) ?? []).includes(s.id))
    );
  }
  return peta;
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
    // `done_by`/`done_at` (0071): pengerjaan menempel pada ITEM, bukan pada
    // sesi. Satu sesi bisa dikerjakan beberapa orang lintas pergantian shift,
    // dan mencatat satu nama di tingkat sesi berarti menisbahkan pekerjaan
    // orang lain kepada siapa pun yang kebetulan menekan Kirim lebih dulu.
    //
    // Embed disebutkan FK-nya (`!done_by`) sesuai aturan repo ini, supaya tetap
    // aman kalau suatu saat ada kolom kedua yang menunjuk user_profiles.
    .select('checked, note, item_id, photo_path, done_at, done_by, checklist_items(label), pengerja:user_profiles!done_by(full_name)')
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
