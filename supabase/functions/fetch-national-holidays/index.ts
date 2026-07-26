// supabase/functions/fetch-national-holidays/index.ts
// Deploy: supabase functions deploy fetch-national-holidays
//
// KENAPA PERLU EDGE FUNCTION:
// Layanan hari libur publik Indonesia tidak mengirim header CORS, jadi browser
// memblokir request langsung dari Staff App/Admin Portal ("Failed to fetch").
// Function ini menariknya di SISI SERVER (tidak kena CORS), menormalkan
// bentuknya, lalu mengembalikannya dengan header CORS yang benar.
//
// Function ini TIDAK menulis apa pun ke database. Hasilnya masih harus
// disetujui admin di Admin Portal sebelum masuk tabel `holidays`.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

const SOURCES = [
  // Utama: punya flag `is_cuti` untuk membedakan cuti bersama.
  { name: 'dayoffapi', url: (y: number) => `https://dayoffapi.vercel.app/api?year=${y}` },
  { name: 'api-harilibur', url: (y: number) => `https://api-harilibur.vercel.app/api?year=${y}` }
];

const pad2 = (n: unknown) => String(n).padStart(2, '0');

function toISO(v: unknown): string | null {
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
    return `${parsed.getUTCFullYear()}-${pad2(parsed.getUTCMonth() + 1)}-${pad2(parsed.getUTCDate())}`;
  }
  return null;
}

const truthy = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';

/**
 * Parser sengaja toleran: bentuk respons tiap layanan berbeda dan bisa berubah,
 * jadi kita terima beberapa nama field sekaligus.
 *   dayoffapi     -> { tanggal, keterangan, is_cuti }
 *   api-harilibur -> { holiday_date, holiday_name, is_national_holiday }
 */
// deno-lint-ignore no-explicit-any
function parseRows(raw: any) {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  const out: { date: string; name: string; isJoint: boolean }[] = [];
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    const date = toISO(r.tanggal ?? r.holiday_date ?? r.date ?? r.tgl);
    const name = String(r.keterangan ?? r.holiday_name ?? r.name ?? r.description ?? '').trim();
    if (!date || !name) continue;
    out.push({ date, name, isJoint: truthy(r.is_cuti ?? r.is_joint_leave ?? r.cuti_bersama) });
  }
  const seen = new Set<string>();
  return out.filter((h) => (seen.has(h.date) ? false : (seen.add(h.date), true))).sort((a, b) => a.date.localeCompare(b.date));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let year: number;
  try {
    const body = await req.json();
    year = Number(body?.year);
  } catch {
    return json({ error: 'Body harus JSON: {"year": 2026}' }, 400);
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return json({ error: 'Tahun tidak valid.' }, 400);
  }

  const errors: string[] = [];
  for (const src of SOURCES) {
    try {
      const res = await fetch(src.url(year), { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        errors.push(`${src.name}: HTTP ${res.status}`);
        continue;
      }
      const holidays = parseRows(await res.json());
      if (holidays.length) return json({ source: src.name, year, holidays });
      errors.push(`${src.name}: tidak ada data untuk ${year}`);
    } catch (e) {
      errors.push(`${src.name}: ${(e as Error).message}`);
    }
  }

  return json({ error: `Semua sumber gagal. ${errors.join(' · ')}`, holidays: [] }, 502);
});
