import { supabase } from '../../config/supabase-client.js';
import { compressImage } from '../../core/image-compress.js';
import { perluDikecilkan } from '../../core/photo-input.js';

import { listMyOutlets } from '../../core/my-outlets.js';

/**
 * Kecilkan HANYA kalau belum dikecilkan di pemilih fotonya.
 *
 * Sejak pemilih foto mengecilkan gambar saat dipilih (supaya file mentah
 * 12 megapiksel tidak menganggur di memori sampai tombol Kirim), mengecilkan
 * lagi di sini berarti kompresi kedua di atas hasil kompresi pertama. Tidak
 * ada error, ukurannya memang mengecil sedikit lagi — yang turun mutunya, dan
 * foto ini dipakai sebagai BUKTI pekerjaan.
 */
const kecilkanSekali = (file) => (perluDikecilkan(file) ? compressImage(file, { preset: 'aktivitas' }) : Promise.resolve(file));


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
/**
 * Outlet yang boleh DILIHAT — dipakai Staff App maupun tampilan Admin Portal.
 *
 * ⚠️ JANGAN diganti jadi daftar "yang boleh diatur". Fungsi ini dipakai
 * `cleaning.page.js` di **Staff App**, dan staff tidak mengelola outlet mana
 * pun — daftarnya akan kosong dan seluruh modul Daily Activities mati dengan
 * pesan "Belum ada outlet untukmu di BU ini". Itu persis yang pernah terjadi:
 * satu penggantian di sini, dan staff kehilangan modulnya tanpa ada satu pun
 * error di layar.
 *
 * Untuk memilih CAKUPAN item/sesi (yang memang menulis), halaman admin
 * memanggil `listOutletsSayaKelola()` sendiri. Daftar "boleh diatur" sengaja
 * TIDAK dipakai di file service mana pun: service dipakai bersama oleh Staff
 * App dan Admin Portal, jadi satu penggantian di sini selalu berisiko mematikan
 * sisi staff-nya. Aturan itu dijaga `tools/audit-daftar-kelola.cjs`.
 */
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
/**
 * Kapan tiap item TERAKHIR dikerjakan di sebuah outlet (0083).
 *
 * Per OUTLET, bukan per item: satu item bisa berlaku untuk beberapa outlet, dan
 * Gading Serpong mengganti minyak hari ini tidak boleh membuat item itu hilang
 * dari layar Sentul — di sana pekerjaannya belum dikerjakan.
 *
 * Gagal baca -> peta kosong, bukan error. Peta kosong berarti "belum pernah
 * dikerjakan", dan itu membuat SEMUA item muncul. Memihak ke arah menampilkan
 * pekerjaan yang mungkin tidak perlu, bukan menyembunyikan yang perlu.
 */
export async function petaTerakhirDikerjakan(outletId) {
  if (!outletId) return new Map();
  const { data, error } = await supabase.rpc('item_terakhir_dikerjakan', { p_outlet: outletId });
  if (error) {
    console.warn('[daily] riwayat pengerjaan tidak terbaca:', error.message);
    return new Map();
  }
  return new Map((data ?? []).map((r) => [r.item_id, r.terakhir]));
}

export async function listActiveItems(businessUnitId, outletId = null, sessionId = null) {
  const { data, error } = await cakupan(
    supabase
      .from('checklist_items')
      .select('id, label, sort_order, outlet_id, interval_days')
      .eq('business_unit_id', businessUnitId)
      .eq('is_active', true),
    outletId
  )
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  let items = data ?? [];

  // Penyaringan MULTI-OUTLET (0076). Item milik BU (`outlet_id` NULL) yang
  // punya daftar outlet hanya berlaku di outlet yang terdaftar. Yang tidak
  // punya daftar tetap berlaku di semua — persis perilaku sebelum 0076, jadi
  // data lama tidak berubah sedikit pun.
  if (outletId && items.length) {
    const milikBu = items.filter((i) => !i.outlet_id).map((i) => i.id);
    if (milikBu.length) {
      const { data: daftar, error: errDaftar } = await supabase
        .from('checklist_item_outlets')
        .select('item_id, outlet_id')
        .in('item_id', milikBu);
      if (errDaftar) {
        // Gagal baca daftar -> tampilkan semua, jangan kosongkan. Ceklis yang
        // tiba-tiba kosong membuat staff mengira pekerjaannya tidak perlu;
        // ceklis kepanjangan hanya merepotkan.
        console.warn('[daily] daftar outlet item tidak terbaca:', errDaftar.message);
      } else {
        const punyaDaftar = new Set((daftar ?? []).map((d) => d.item_id));
        const untukOutlet = new Set((daftar ?? []).filter((d) => d.outlet_id === outletId).map((d) => d.item_id));
        items = items.filter((i) => i.outlet_id || !punyaDaftar.has(i.id) || untukOutlet.has(i.id));
      }
    }
  }

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
 * Peta item_id -> daftar outlet_id tempat item itu berlaku (0076).
 * Item yang tidak muncul di peta ini mengikuti `outlet_id`-nya sendiri.
 */
export async function getItemOutletMap(itemIds) {
  const ids = [...new Set((itemIds ?? []).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from('checklist_item_outlets').select('item_id, outlet_id').in('item_id', ids);
  if (error) {
    console.warn('[daily] daftar outlet item tidak terbaca:', error.message);
    return new Map();
  }
  const peta = new Map();
  for (const r of data ?? []) {
    if (!peta.has(r.item_id)) peta.set(r.item_id, []);
    peta.get(r.item_id).push(r.outlet_id);
  }
  return peta;
}

/**
 * Tetapkan cakupan item dalam SATU panggilan, tiga kemungkinan:
 *   'semua'          -> outlet_id NULL, daftar dikosongkan
 *   satu outlet      -> outlet_id = X,  daftar dikosongkan (dikelola admin X)
 *   beberapa outlet  -> outlet_id NULL + daftar berisi outlet-outlet itu
 *
 * Kenapa yang >1 outlet dijadikan milik BU: item yang menyentuh beberapa outlet
 * bukan lagi urusan satu outlet saja. Membiarkannya dimiliki salah satu berarti
 * admin outlet itu bisa mengubah pekerjaan outlet lain dari layar yang tidak
 * pernah menyebut outlet lain itu.
 */
export async function setItemCakupan(itemId, outletIds) {
  const daftar = [...new Set((outletIds ?? []).filter(Boolean))];
  const outletTunggal = daftar.length === 1 ? daftar[0] : null;

  const { data, error } = await supabase
    .from('checklist_items')
    .update({ outlet_id: outletTunggal })
    .eq('id', itemId)
    .select('id');
  if (error) throw error;
  pastikanKena(data, 'item');

  // Daftar lama selalu dibersihkan lebih dulu — kalau tidak, mengurangi outlet
  // tidak akan berpengaruh apa pun, dan itu jenis kegagalan yang paling sulit
  // dipercaya saat dilihat ("sudah saya hapus kok masih muncul").
  // DELETE yang ditolak RLS juga membalas sukses dengan 0 baris. Di sini
  // akibatnya khas: outlet yang dicabut tetap menempel, dan orangnya melihat
  // "sudah saya hapus kok masih muncul" — persis keluhan yang paling sulit
  // dipercaya. Baris 0 tidak selalu penolakan (bisa memang belum ada isinya),
  // jadi yang diperiksa cuma errornya, dan hasil akhirnya dipastikan di bawah
  // lewat jumlah baris yang berhasil ditulis ulang.
  const { error: errHapus } = await supabase.from('checklist_item_outlets').delete().eq('item_id', itemId).select('item_id');
  if (errHapus) throw errHapus;

  if (daftar.length > 1) {
    const { data: baris, error: errIsi } = await supabase
      .from('checklist_item_outlets')
      .insert(daftar.map((outlet_id) => ({ item_id: itemId, outlet_id })))
      .select('outlet_id');
    if (errIsi) throw errIsi;
    if ((baris ?? []).length !== daftar.length) {
      throw new Error('Sebagian outlet tidak tersimpan — hanya admin BU yang bisa mengatur item lintas outlet.');
    }
  }
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
  const { error: errHapus } = await supabase.from('checklist_session_items').delete().eq('item_id', itemId).select('item_id');
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
    .select('id, label, sort_order, is_active, outlet_id, interval_days')
    .eq('business_unit_id', businessUnitId)
    .order('outlet_id', { nullsFirst: true })
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function listItems(businessUnitId, outletId = null) {
  const { data, error } = await cakupan(
    supabase.from('checklist_items').select('id, label, sort_order, is_active, outlet_id, interval_days').eq('business_unit_id', businessUnitId),
    outletId
  )
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}
/** Mengembalikan baris barunya — id-nya dibutuhkan untuk menetapkan cakupan multi-outlet (0076). */
export async function createItem({ businessUnitId, outletId, label, sort_order, interval_days }) {
  const { data, error } = await supabase
    .from('checklist_items')
    .insert({
      business_unit_id: businessUnitId,
      outlet_id: outletId || null,
      label,
      sort_order: sort_order ?? 0,
      // NULL = harian. Sengaja bukan 1: keduanya berperilaku sama, tapi NULL
      // berarti "tidak pernah diatur" sementara 1 berarti "diatur harian".
      interval_days: Number(interval_days) > 1 ? Number(interval_days) : null
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}
/**
 * `outlet_id` boleh diubah — cakupan item BUKAN keputusan sekali seumur hidup.
 *
 * Dulu sengaja dikunci karena memindahkannya mengubah ceklis outlet lain. Itu
 * benar, tapi jalan keluarnya salah: yang dibutuhkan adalah PERINGATAN, bukan
 * larangan. Melarangnya memaksa admin membuat item kembar lalu menonaktifkan
 * yang lama — dan dua item bernama sama dengan riwayat terpisah jauh lebih
 * membingungkan daripada satu item yang cakupannya pernah berubah.
 *
 * Siapa yang boleh: dijaga policy `checklist_items_modify` (0054), yang menguji
 * baris LAMA lewat `using` dan baris BARU lewat `with check`. Jadi admin outlet
 * tidak bisa mengambil item BU jadi miliknya, maupun melepas itemnya jadi milik
 * seluruh BU. Yang bisa memindahkan hanya admin BU.
 *
 * `undefined` berarti "jangan diubah" — beda dari `null` yang berarti
 * "berlaku di semua outlet".
 */
export async function updateItem(id, { label, sort_order, is_active, outlet_id, interval_days }) {
  const isi = { label, sort_order, is_active };
  if (outlet_id !== undefined) isi.outlet_id = outlet_id;
  if (interval_days !== undefined) isi.interval_days = Number(interval_days) > 1 ? Number(interval_days) : null;
  const { data, error } = await supabase
    .from('checklist_items')
    .update(isi)
    .eq('id', id)
    .select('id, outlet_id');
  if (error) throw error;
  pastikanKena(data, 'item');

  // Penugasan sesi (0069) yang menunjuk sesi milik OUTLET LAIN jadi tidak
  // berarti apa-apa setelah cakupannya menyempit — itemnya tidak akan muncul di
  // sana lagi. Dibersihkan supaya kolom "Sesi" di layar admin tetap jujur;
  // badge yang menyebut sesi yang tidak mungkin terjadi hanya menyesatkan.
  if (outlet_id) {
    const { data: sesiLain } = await supabase
      .from('checklist_sessions')
      .select('id')
      .not('outlet_id', 'is', null)
      .neq('outlet_id', outlet_id);
    const buang = (sesiLain ?? []).map((x) => x.id);
    if (buang.length) {
      // Pembersihan penugasan sesi milik outlet LAIN. Hasilnya diperiksa bukan
      // untuk dilempar — item yang tidak pernah ditugaskan ke sana memang
      // menghasilkan 0 baris — tapi supaya penolakan RLS meninggalkan jejak di
      // console alih-alih hilang tanpa bekas.
      const { error: errBersih } = await supabase
        .from('checklist_session_items')
        .delete()
        .eq('item_id', id)
        .in('session_id', buang)
        .select('item_id');
      if (errBersih) console.warn('[daily] penugasan sesi outlet lain tidak terbersihkan:', errBersih.message);
    }
  }
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
/** Cakupan sesi juga bisa dipindah. Lihat alasannya di `updateItem`. */
export async function updateSession(id, { name, sort_order, is_active, outlet_id }) {
  const isi = { name, sort_order, is_active };
  if (outlet_id !== undefined) isi.outlet_id = outlet_id;
  const { data, error } = await supabase
    .from('checklist_sessions')
    .update(isi)
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
    // baris-terbatas: sesi SATU outlet pada SATU tanggal — paling banyak belasan.
    .from('checklist_runs')
    .select('id, session_id, run_date, notes, created_at, user_id, user_profiles(full_name), checklist_sessions(name), checklist_run_items(item_id, checked)')
    .eq('outlet_id', outletId)
    .eq('run_date', tanggal)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/*
 * `submitChecklistRun()` dan `lanjutkanChecklistRun()` DIHAPUS di 0089.
 *
 * Keduanya mengirim seluruh sesi sekali di akhir. Jalur itu yang membuat
 * pekerjaan bisa hilang: rekaman layar dari lapangan menunjukkan Android
 * membuang halaman ini sesudah aplikasi kamera dipakai, dan semua centang &
 * foto yang menunggu di memori ikut lenyap tanpa satu pun tanda.
 *
 * Penggantinya `simpanItemAktivitas()` di bawah — satu item, disimpan begitu
 * fotonya ada.
 *
 * Dihapus, bukan dibiarkan "untuk jaga-jaga": dua jalur penyimpanan untuk hal
 * yang sama akan menyimpang, dan yang menyimpang justru yang jarang dipakai —
 * lalu suatu saat dipanggil lagi oleh orang yang mengira ia masih benar.
 */



/**
 * SIMPAN SATU ITEM SEKARANG JUGA — inti perbaikan 0089.
 *
 * ============ KENAPA TIDAK MENUNGGU TOMBOL KIRIM ============
 *
 * Rekaman layar dari lapangan menunjukkan halaman ini DIBUANG Android sesudah
 * aplikasi kamera dipakai. Semua yang baru ada di memori — centang dan foto —
 * ikut hilang, dan tidak ada apa pun yang memberi tahu bahwa pekerjaannya
 * batal.
 *
 * Mengecilkan foto lebih awal mengurangi pemicunya, tapi tidak menghapusnya.
 * Selama pekerjaan menumpuk di memori sampai tombol Kirim, jendela kehilangan
 * itu selalu ada. Yang menutupnya bukan hemat memori, melainkan TIDAK MENUNGGU.
 *
 * ============ URUTANNYA, DAN KENAPA BEGITU ============
 *
 * 1. `pastikan_run_aktivitas()` — ambil/buat run hari ini. Aman dari dua orang
 *    yang menyimpan bersamaan (0089); pola "cek lalu insert" di sini pasti
 *    kalah balapan saat dua staff memotret bersamaan di outlet yang sama.
 * 2. Unggah fotonya.
 * 3. Baru tulis barisnya.
 *
 * Foto lebih dulu supaya barisnya tidak pernah lahir tanpa bukti. Kalau
 * langkah 3 gagal, fotonya dibuang lagi — file yatim memakan kuota tanpa
 * membuktikan apa pun.
 *
 * @returns {Promise<{runId: string, photoPath: string}>}
 */
export async function simpanItemAktivitas({ businessUnitId, outletId, sessionId, itemId, file, note, notes }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Sesi tidak ditemukan, silakan login ulang.');
  if (!file) throw new Error('Foto bukti wajib ada sebelum item ini bisa disimpan.');

  const { data: runId, error: runErr } = await supabase.rpc('pastikan_run_aktivitas', {
    p_outlet: outletId,
    p_session: sessionId,
    p_notes: notes || null
  });
  if (runErr) throw new Error(runErr.message ?? String(runErr));
  if (!runId) throw new Error('Sesi hari ini tidak bisa dibuka. Coba muat ulang halamannya.');

  const kecil = await kecilkanSekali(file);
  const ext = kecil.type === 'image/webp' ? 'webp' : 'jpg';
  const photoPath = `${outletId}/${runId}/${itemId}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('checklist-photos')
    .upload(photoPath, kecil, { upsert: true, contentType: kecil.type || 'image/jpeg' });
  if (upErr) throw new Error(`Foto gagal diunggah: ${upErr.message}`);

  const isi = { checked: true, note: note || null, photo_path: photoPath, done_by: uid, done_at: new Date().toISOString() };

  try {
    // Data LAMA bisa punya baris `checked = false` untuk item ini (sebelum
    // 0072). Insert kedua akan ditolak `uq_checklist_run_item`, jadi barisnya
    // dicoba DIPERBARUI dulu — dan hanya yang belum dikerjakan, supaya bukti
    // orang lain tidak pernah tertimpa.
    const { data: diperbarui, error: updErr } = await supabase
      // baris-terbatas: satu baris (run, item).
      .from('checklist_run_items')
      .update(isi)
      .eq('run_id', runId)
      .eq('item_id', itemId)
      .eq('checked', false)
      .select('id');
    if (updErr) throw updErr;
    if (diperbarui?.length) return { runId, photoPath };

    const { data, error } = await supabase
      .from('checklist_run_items')
      .insert({ run_id: runId, item_id: itemId, ...isi })
      .select('id');
    if (error) {
      // Bentrok = item ini sudah dikerjakan orang lain beberapa detik lalu.
      // Itu bukan kegagalan sistem, dan pesannya harus berbunyi begitu.
      if (String(error.code) === '23505' || /duplicate key/i.test(error.message ?? '')) {
        throw new Error('Item ini baru saja dikerjakan orang lain. Muat ulang halamannya untuk melihat fotonya.');
      }
      throw error;
    }
    // Penolakan RLS tidak berupa error — hanya nol baris.
    if (!data?.length) throw new Error('Item tidak tersimpan — kemungkinan akunmu tidak berhak mengisi di outlet ini.');

    return { runId, photoPath };
  } catch (err) {
    await supabase.storage.from('checklist-photos').remove([photoPath]).catch(() => {});
    throw err;
  }
}

/** Simpan catatan sesi (run-level). Aman dipanggil berkali-kali. */
export async function simpanCatatanRun(runId, notes) {
  if (!runId) return;
  const { error } = await supabase.rpc('catat_catatan_run', { p_run: runId, p_notes: notes ?? '' });
  if (error) throw new Error(error.message ?? String(error));
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
    const kecil = await kecilkanSekali(file);
    const ext = kecil.type === 'image/webp' ? 'webp' : 'jpg';
    const photoPath = `${outletId}/${runId}/${itemId}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('checklist-photos')
      .upload(photoPath, kecil, { upsert: true, contentType: kecil.type || 'image/jpeg' });
    if (upErr) throw upErr;
    isi.photo_path = photoPath;
  }

  const { data, error } = await supabase
    // baris-terbatas: item SATU run sesi.
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
    // baris-terbatas: item SATU run sesi.
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
    // baris-terbatas: item SATU run sesi.
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
    // baris-terbatas: item SATU run sesi.
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
