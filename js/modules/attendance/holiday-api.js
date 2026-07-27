// =========================================================
// Penarik hari libur nasional Indonesia.
//
// PRINSIP: API pihak ketiga ini HANYA pintasan input data, BUKAN dependensi.
// Hasil tarikan selalu ditampilkan dulu untuk disetujui admin sebelum masuk
// tabel `holidays`, dan input manual tetap tersedia. Kalau layanannya mati,
// aplikasi tidak terganggu sama sekali.
//
// Dua hal yang TIDAK bisa diandalkan dari API mana pun, jadi harus tetap bisa
// dikoreksi manual:
//   * Cuti bersama ditetapkan SKB 3 Menteri, biasanya baru terbit akhir tahun
//     sebelumnya — tahun depan hampir pasti belum ada.
//   * Idul Fitri / Idul Adha ditentukan sidang isbat dan bisa geser sehari dari
//     prediksi hisab yang dipakai API.
// =========================================================

import { supabase } from '../../config/supabase-client.js';

const SOURCES = [
  // Utama: membedakan cuti bersama lewat flag `is_cuti`.
  { name: 'dayoffapi', url: (year) => `https://dayoffapi.vercel.app/api?year=${year}` },
  // Cadangan otomatis kalau yang utama tidak bisa dihubungi.
  { name: 'api-harilibur', url: (year) => `https://api-harilibur.vercel.app/api?year=${year}` }
];

const pad2 = (n) => String(n).padStart(2, '0');

/** Normalkan berbagai bentuk tanggal jadi 'YYYY-MM-DD'. */
function toISO(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${pad2(dmy[2])}-${pad2(dmy[1])}`;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  }
  return null;
}

const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';

/**
 * Parser sengaja TOLERAN: bentuk respons tiap layanan berbeda dan bisa berubah
 * sewaktu-waktu, jadi kita terima beberapa nama field sekaligus daripada
 * mengunci ke satu bentuk.
 *   dayoffapi      -> { tanggal, keterangan, is_cuti }
 *   api-harilibur  -> { holiday_date, holiday_name, is_national_holiday }
 */
function parseRows(raw) {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  const out = [];
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    const date = toISO(r.tanggal ?? r.holiday_date ?? r.date ?? r.tgl);
    const name = String(r.keterangan ?? r.holiday_name ?? r.name ?? r.description ?? '').trim();
    if (!date || !name) continue;
    // api-harilibur menandai libur non-nasional (mis. hari raya lokal Bali)
    // lewat is_national_holiday = false; itu kita anggap bukan cuti bersama.
    const isJoint = truthy(r.is_cuti ?? r.is_joint_leave ?? r.cuti_bersama);
    out.push({ date, name, isJoint });
  }
  // Buang duplikat tanggal, urutkan menaik.
  const seen = new Set();
  return out
    .filter((h) => (seen.has(h.date) ? false : seen.add(h.date)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Tarik daftar hari libur nasional satu tahun.
 *
 * JALUR UTAMA: Edge Function `fetch-national-holidays`. Layanan hari libur
 * publik tidak mengirim header CORS, jadi fetch LANGSUNG dari browser pasti
 * gagal dengan "Failed to fetch" — penarikan harus lewat server.
 *
 * JALUR CADANGAN: fetch langsung, kalau-kalau Edge Function belum di-deploy
 * dan suatu saat layanannya membuka CORS.
 */
export async function fetchNationalHolidays(year) {
  const errors = [];

  try {
    const { data, error } = await supabase.functions.invoke('fetch-national-holidays', { body: { year } });
    if (error) throw error;
    if (data?.holidays?.length) return { source: `${data.source} (via server)`, holidays: parseRows(data.holidays) };
    if (data?.error) errors.push(data.error);
  } catch (e) {
    errors.push(`Edge Function: ${e.message ?? e}`);
  }

  for (const src of SOURCES) {
    try {
      const res = await fetch(src.url(year), { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        errors.push(`${src.name}: HTTP ${res.status}`);
        continue;
      }
      const rows = parseRows(await res.json());
      if (rows.length) return { source: src.name, holidays: rows };
      errors.push(`${src.name}: tidak mengembalikan data untuk ${year}`);
    } catch (e) {
      // "Failed to fetch" di sini = CORS diblokir (bukan layanannya mati).
      errors.push(`${src.name}: ${e.message ?? e}`);
    }
  }

  throw new Error(
    `Gagal menarik hari libur ${year}. ${errors.join(' · ')}. ` +
      'Kalau semuanya "Failed to fetch", Edge Function `fetch-national-holidays` kemungkinan belum di-deploy — ' +
      'jalankan: supabase functions deploy fetch-national-holidays. Sementara itu hari libur tetap bisa ditambah manual di bawah.'
  );
}

/** URL sumber, untuk dibuka manual di tab baru saat penarikan otomatis gagal. */
export function sourceUrl(year, name = 'dayoffapi') {
  return (SOURCES.find((s) => s.name === name) ?? SOURCES[0]).url(year);
}

/**
 * Jalur darurat: admin membuka URL sumber di tab baru (membuka URL langsung
 * TIDAK kena CORS — yang diblokir hanya fetch dari halaman lain), lalu menempel
 * isinya ke sini. Selalu berhasil, tanpa bergantung Edge Function maupun CORS.
 *
 * Menerima JSON array dari layanan mana pun, atau baris teks sederhana
 * "YYYY-MM-DD, Nama Libur" (satu per baris) — mis. hasil salin dari Excel.
 */
export function parsePastedHolidays(text) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('Belum ada data yang ditempel.');

  // Coba JSON dulu.
  if (raw.startsWith('[') || raw.startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Teksnya mirip JSON tapi tidak valid: ${e.message}`);
    }
    const rows = parseRows(parsed);
    if (!rows.length) throw new Error('JSON terbaca, tapi tidak ada tanggal + nama yang bisa dikenali di dalamnya.');
    return rows;
  }

  // Fallback: baris "tanggal, nama" (pemisah koma / titik koma / tab).
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/[;,\t]/);
    if (parts.length < 2) continue;
    const date = toISO(parts[0]);
    const name = parts.slice(1).join(',').trim();
    if (!date || !name) continue;
    out.push({ date, name, isJoint: /cuti bersama/i.test(name) });
  }
  if (!out.length) {
    throw new Error('Format tidak dikenali. Tempel JSON dari layanan hari libur, atau baris "2026-01-01, Tahun Baru" satu per baris.');
  }
  const seen = new Set();
  return out.filter((h) => (seen.has(h.date) ? false : seen.add(h.date))).sort((a, b) => a.date.localeCompare(b.date));
}

/** Label ramah untuk ditampilkan di dialog persetujuan. */
export function holidayLabel(h) {
  const d = new Date(h.date + 'T00:00:00');
  const hari = d.toLocaleDateString('id-ID', { weekday: 'long' });
  const tgl = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  return `${hari}, ${tgl} — ${h.name}${h.isJoint ? ' (cuti bersama)' : ''}`;
}
