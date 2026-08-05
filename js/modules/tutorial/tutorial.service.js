import { supabase } from '../../config/supabase-client.js';

/**
 * Video tutorial per modul.
 *
 * ATURAN PEWARISAN: video khusus BU MENIMPA video global untuk modul yang sama.
 * Bukan menggabung. Alasannya: kalau suatu BU sampai perlu membuat video
 * sendiri, biasanya justru karena cara kerjanya BERBEDA -- menampilkan video
 * global di sebelahnya malah membingungkan, karena staff tidak tahu yang mana
 * yang berlaku untuknya.
 */

/** Pola ID video YouTube: 11 karakter. Dipakai juga sebagai CHECK di migration 0048. */
const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * Ubah apa pun yang ditempel admin menjadi ID video YouTube.
 *
 * KENAPA TIDAK MENYIMPAN URL MENTAH: YouTube punya banyak bentuk link, dan
 * yang disalin orang dari HP hampir selalu berbeda dari yang disalin dari
 * browser desktop. Kalau URL disimpan apa adanya, bentuk embed-nya harus
 * ditebak ulang setiap kali dirender -- dan tebakan yang meleset baru
 * ketahuan saat staff melihat pemutar kosong. Diurai sekali saat menyimpan
 * membuat link yang salah ditolak di depan mata admin.
 *
 * Bentuk yang didukung:
 *   https://www.youtube.com/watch?v=ID&t=30s
 *   https://youtu.be/ID?si=xxxx
 *   https://www.youtube.com/embed/ID
 *   https://www.youtube.com/shorts/ID
 *   https://m.youtube.com/watch?v=ID
 *   ID  (kalau admin sudah menempel ID-nya langsung)
 *
 * @returns {string|null} ID video, atau null kalau tidak dikenali.
 */
export function parseYoutubeId(input) {
  const teks = String(input ?? '').trim();
  if (!teks) return null;

  // Sudah berupa ID.
  if (ID_PATTERN.test(teks)) return teks;

  let url;
  try {
    // Admin sering menempel tanpa skema ("youtu.be/abc"). URL() menolak itu,
    // jadi tambahkan https:// kalau belum ada.
    url = new URL(/^https?:\/\//i.test(teks) ? teks : `https://${teks}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\.|^m\./i, '').toLowerCase();
  const bagian = url.pathname.split('/').filter(Boolean);

  let kandidat = null;
  if (host === 'youtu.be') {
    kandidat = bagian[0] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (bagian[0] === 'embed' || bagian[0] === 'shorts' || bagian[0] === 'live' || bagian[0] === 'v') {
      kandidat = bagian[1] ?? null;
    } else {
      kandidat = url.searchParams.get('v');
    }
  }

  return kandidat && ID_PATTERN.test(kandidat) ? kandidat : null;
}

/** URL embed yang dipakai di dialog. `-nocookie` supaya tidak menanam cookie iklan. */
export function embedUrl(youtubeId) {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?rel=0&modestbranding=1`;
}

/** Gambar sampul video, untuk daftar tutorial tanpa harus memuat pemutar. */
export function thumbUrl(youtubeId) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(youtubeId)}/mqdefault.jpg`;
}

/** Link untuk membuka di aplikasi YouTube (tombol cadangan kalau embed diblokir). */
export function watchUrl(youtubeId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`;
}

/**
 * Video yang berlaku untuk satu modul di satu BU.
 * Khusus-BU menimpa global; kalau BU itu tidak punya, pakai yang global.
 */
export async function listTutorials(moduleCode, businessUnitId) {
  const { data, error } = await supabase
    .from('module_tutorials')
    .select('id, module_code, business_unit_id, title, youtube_id, description, sort_order')
    .eq('module_code', moduleCode)
    .eq('is_active', true)
    .or(`business_unit_id.is.null,business_unit_id.eq.${businessUnitId}`)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;

  const semua = data ?? [];
  const khususBu = semua.filter((t) => t.business_unit_id === businessUnitId);
  return khususBu.length ? khususBu : semua.filter((t) => t.business_unit_id === null);
}

/**
 * Modul mana saja yang PUNYA video, untuk BU ini. Dipakai supaya tombol ❓
 * hanya muncul di modul yang memang ada tutorialnya -- tombol bantuan yang
 * membuka daftar kosong lebih buruk daripada tidak ada tombol sama sekali.
 *
 * Gagal = Set kosong, bukan lempar error. Tutorial itu pelengkap; modul tidak
 * boleh ikut gagal dibuka gara-gara ini.
 */
export async function listModulesWithTutorial(businessUnitId) {
  const { data, error } = await supabase
    .from('module_tutorials')
    .select('module_code, business_unit_id')
    .eq('is_active', true)
    .or(`business_unit_id.is.null,business_unit_id.eq.${businessUnitId}`);
  if (error) {
    console.warn('[tutorial] daftar modul bervideo tidak bisa dibaca:', error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.module_code));
}

/**
 * Semua video yang berlaku di satu BU, sudah DIKELOMPOKKAN per modul.
 *
 * Dipakai Beranda Staff supaya seluruh daftar tutorial bisa ditampilkan dengan
 * SATU query. Versi memanggil listTutorials() per modul akan menembakkan 15-20
 * permintaan sekaligus saat halaman pertama dibuka — dan yang paling terasa
 * bukan servernya, melainkan Beranda yang tersendat di HP.
 *
 * Aturan pewarisannya sama persis dengan listTutorials(): video khusus BU
 * MENIMPA video global, per modul, bukan digabung.
 *
 * Gagal = Map kosong, bukan lempar error. Tutorial itu pelengkap; Beranda tidak
 * boleh ikut gagal tampil gara-gara ini.
 *
 * @returns {Promise<Map<string, object[]>>} module_code -> daftar video
 */
export async function listTutorialsByModule(businessUnitId) {
  const { data, error } = await supabase
    .from('module_tutorials')
    .select('id, module_code, business_unit_id, title, youtube_id, description, sort_order')
    .eq('is_active', true)
    .or(`business_unit_id.is.null,business_unit_id.eq.${businessUnitId}`)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[tutorial] daftar per modul tidak bisa dibaca:', error.message);
    return new Map();
  }

  const perModul = new Map();
  for (const t of data ?? []) {
    if (!perModul.has(t.module_code)) perModul.set(t.module_code, []);
    perModul.get(t.module_code).push(t);
  }
  for (const [code, list] of perModul) {
    const khususBu = list.filter((t) => t.business_unit_id === businessUnitId);
    perModul.set(code, khususBu.length ? khususBu : list.filter((t) => t.business_unit_id === null));
  }
  return perModul;
}

/** Super admin: semua video, termasuk yang nonaktif, untuk halaman kelola. */
export async function listAllTutorials() {
  const { data, error } = await supabase
    .from('module_tutorials')
    .select('id, module_code, business_unit_id, title, youtube_id, description, sort_order, is_active, modules(name), business_units(name)')
    .order('module_code', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function saveTutorial({ id, module_code, business_unit_id, title, youtube_id, description, sort_order, is_active }) {
  const videoId = parseYoutubeId(youtube_id);
  if (!videoId) {
    throw new Error('Link YouTube tidak dikenali. Tempel link video seperti https://youtu.be/XXXXXXXXXXX atau https://www.youtube.com/watch?v=XXXXXXXXXXX');
  }

  const baris = {
    module_code,
    business_unit_id: business_unit_id || null, // string kosong dari <select> = global
    title: String(title ?? '').trim(),
    youtube_id: videoId,
    description: String(description ?? '').trim() || null,
    sort_order: Number(sort_order) || 0,
    is_active: is_active !== false,
    updated_at: new Date().toISOString()
  };

  if (id) {
    const { error } = await supabase.from('module_tutorials').update(baris).eq('id', id);
    if (error) throw error;
    return;
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('module_tutorials').insert({ ...baris, created_by: user?.id ?? null });
  if (error) throw error;
}

export async function deleteTutorial(id) {
  const { error } = await supabase.from('module_tutorials').delete().eq('id', id);
  if (error) throw error;
}

/** Daftar modul (untuk dropdown di halaman kelola). */
export async function listAllModules() {
  const { data, error } = await supabase.from('modules').select('code, name').order('name');
  if (error) throw error;
  return data ?? [];
}
