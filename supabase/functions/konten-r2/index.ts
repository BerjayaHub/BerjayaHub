// supabase/functions/konten-r2/index.ts
// Deploy: supabase functions deploy konten-r2
//
// Menerbitkan URL bertanda tangan (presigned) untuk Cloudflare R2 — unggah,
// tonton, dan hapus — tanpa satu byte pun berkas melewati Supabase.
//
// ============ KENAPA BERKASNYA TIDAK DI SUPABASE ============
//
// Free plan Supabase membatasi 50 MB per berkas, dan video 1 menit dari HP
// staff berukuran 141 MB (diukur sendiri di Motorola G57 Power, FHD 30fps).
// Jaraknya hampir tiga kali lipat — bukan sesuatu yang bisa ditutup dengan
// membatasi durasi.
//
// Dan yang lebih menentukan: kuota 1 GB Supabase dipakai BERSAMA selfie
// presensi harian. Kalau konten mengisinya sampai penuh, yang berhenti bukan
// modul konten — yang berhenti adalah clock-in staff.
//
// ============ KENAPA BROWSER YANG MENGIRIM, BUKAN FUNCTION INI ============
//
// Function ini hanya menerbitkan URL. Berkasnya dikirim browser LANGSUNG ke
// R2.
//
// Kalau berkasnya diteruskan lewat sini, 141 MB harus melewati Edge Function:
// kena batas ukuran request, kena batas waktu eksekusi, dan memakan bandwidth
// Supabase — tiga masalah yang tidak perlu ada. Dengan presigned URL, Supabase
// tidak pernah menyentuh isinya.
//
// Kunci R2 TIDAK PERNAH sampai ke browser. Yang dikirim cuma URL yang berlaku
// sebentar untuk satu objek.

import { createClient } from 'npm:@supabase/supabase-js@2'; // npm:, bukan esm.sh — lihat catatan di create-staff-user
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID') ?? '';
const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID') ?? '';
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '';
const R2_BUCKET = Deno.env.get('R2_BUCKET') ?? 'berjaya-konten';

/** Umur URL unggah. Longgar: 141 MB di wifi outlet bisa makan belasan menit. */
const DETIK_UNGGAH = 30 * 60;
/** Umur URL tonton/unduh. Pendek: ia bisa tersalin ke mana-mana. */
const DETIK_TONTON = 60 * 60;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const r2 = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service: 's3',
  region: 'auto'
});

const endpoint = () => `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

/** Kunci objek -> URL bertanda tangan untuk satu metode. */
async function presign(kunci: string, metode: 'PUT' | 'GET' | 'DELETE', detik: number) {
  const url = new URL(`${endpoint()}/${R2_BUCKET}/${kunci}`);
  url.searchParams.set('X-Amz-Expires', String(detik));
  const req = await r2.sign(url.toString(), { method: metode, signQuery: true });
  return req.url;
}

/**
 * Kunci objek yang AMAN, disusun di sini — bukan diterima dari browser.
 *
 * Kalau browser yang menentukan kuncinya, satu pemanggil nakal bisa menulis
 * ke mana saja di dalam bucket — termasuk menimpa berkas outlet lain, karena
 * token R2-nya sama untuk semua orang. Nama asli dari HP ikut sebagai metadata
 * di database, bukan sebagai kunci.
 */
function susunKunci(outletId: string, tugasId: string, jenis: string, ext: string) {
  const bersih = String(ext || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  const acak = crypto.randomUUID();
  return `${outletId}/${tugasId}/${jenis}-${acak}${bersih ? '.' + bersih : ''}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  // ============ SETELAN YANG BELUM LENGKAP HARUS BERBUNYI ============
  //
  // Tanpa pemeriksaan ini, kunci yang kosong menghasilkan URL bertanda tangan
  // yang terlihat sah lalu ditolak R2 dengan galat XML yang tidak menyebut
  // sebabnya. Staff melihat "unggah gagal" dan tidak ada yang tahu bahwa yang
  // kurang cuma satu secret.
  for (const [nama, nilai] of [
    ['R2_ACCOUNT_ID', R2_ACCOUNT_ID],
    ['R2_ACCESS_KEY_ID', R2_ACCESS_KEY_ID],
    ['R2_SECRET_ACCESS_KEY', R2_SECRET_ACCESS_KEY]
  ]) {
    if (!nilai) return json({ error: `Setelan R2 belum lengkap: ${nama} belum diisi di secret Edge Function.` }, 500);
  }

  // ============ PEMANGGILNYA DIVERIFIKASI LEWAT JWT-NYA SENDIRI ============
  //
  // Bukan sekadar "ada header Authorization". Function ini `service_role`, jadi
  // apa pun yang dikerjakannya melewati RLS — dan menerbitkan URL unggah tanpa
  // tahu siapa yang meminta sama saja dengan membuka bucket untuk siapa pun
  // yang punya anon key.
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Perlu login.' }, 401);

  const { data: pemanggil, error: galatAuth } = await admin.auth.getUser(token);
  if (galatAuth || !pemanggil?.user) return json({ error: 'Sesi tidak dikenali. Masuk ulang lalu coba lagi.' }, 401);
  const uid = pemanggil.user.id;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Permintaan tidak terbaca.' }, 400);
  }

  const aksi = String(body.aksi ?? '');
  const tugasId = String(body.tugas_id ?? '');
  if (!tugasId) return json({ error: 'tugas_id wajib.' }, 400);

  // Tugasnya dibaca dengan service role, lalu wewenangnya diperiksa SENDIRI di
  // bawah. RLS tidak berlaku di sini, jadi tidak ada yang menolak otomatis.
  const { data: tugas } = await admin
    .from('konten_tugas')
    .select('id, outlet_id, business_unit_id, status')
    .eq('id', tugasId)
    .maybeSingle();
  if (!tugas) return json({ error: 'Tugas tidak ditemukan.' }, 404);

  const { data: scopes } = await admin
    .from('membership_scopes')
    .select('role, business_unit_id, outlet_id')
    .eq('user_id', uid);
  const daftar = scopes ?? [];

  const superAdmin = daftar.some((s) => s.role === 'super_admin');
  const adminBu = superAdmin || daftar.some((s) => s.role === 'bu_admin' && s.business_unit_id === tugas.business_unit_id);
  const diOutlet =
    adminBu ||
    daftar.some(
      (s) =>
        s.outlet_id === tugas.outlet_id ||
        (s.outlet_id === null && s.business_unit_id === tugas.business_unit_id)
    );

  if (!diOutlet) return json({ error: 'Kamu tidak bertugas di outlet ini.' }, 403);

  if (aksi === 'upload-url') {
    // ============ TUGAS YANG SUDAH SELESAI TIDAK MENERIMA UNGGAHAN ============
    //
    // Berkasnya sudah atau akan dihapus tujuh hari sesudah ditandai selesai.
    // Membiarkan unggahan masuk ke sana berarti berkas baru yang langsung
    // masuk antrean penghapusan — hilang beberapa hari kemudian tanpa pernah
    // dilihat siapa pun, dan staff yakin ia sudah menyetornya.
    if (tugas.status === 'selesai') {
      return json({ error: 'Tugas ini sudah ditandai selesai. Minta admin membukanya lagi kalau masih perlu diubah.' }, 409);
    }
    const jenis = String(body.jenis ?? '');
    if (jenis !== 'video' && jenis !== 'foto') return json({ error: 'jenis harus video atau foto.' }, 400);

    const kunci = susunKunci(tugas.outlet_id, tugas.id, jenis, String(body.ext ?? ''));
    return json({ url: await presign(kunci, 'PUT', DETIK_UNGGAH), r2_key: kunci, berlaku_detik: DETIK_UNGGAH });
  }

  if (aksi === 'view-url') {
    const kunci = String(body.r2_key ?? '');
    if (!kunci) return json({ error: 'r2_key wajib.' }, 400);

    // Kuncinya harus BENAR-BENAR milik tugas ini. Tanpa ini, siapa pun yang
    // punya satu tugas sah bisa meminta URL untuk kunci mana pun di bucket —
    // termasuk milik outlet lain — cukup dengan menebak atau menyalinnya.
    const { data: berkas } = await admin
      .from('konten_berkas')
      .select('id')
      .eq('tugas_id', tugas.id)
      .eq('r2_key', kunci)
      .maybeSingle();
    if (!berkas) return json({ error: 'Berkas itu bukan milik tugas ini.' }, 403);

    return json({ url: await presign(kunci, 'GET', DETIK_TONTON), berlaku_detik: DETIK_TONTON });
  }

  if (aksi === 'delete') {
    // Menghapus berkas dari R2 hanya untuk admin BU. Staff membatalkan
    // unggahannya lewat baris databasenya (RLS 0163) — dan triggernya mencatat
    // kuncinya ke `konten_berkas_sampah`, yang dibersihkan pekerjaan terjadwal.
    if (!adminBu) return json({ error: 'Hanya Admin BU yang bisa menghapus berkas.' }, 403);
    const kunci = String(body.r2_key ?? '');
    if (!kunci) return json({ error: 'r2_key wajib.' }, 400);

    const res = await r2.fetch(`${endpoint()}/${R2_BUCKET}/${kunci}`, { method: 'DELETE' });
    // R2 memulangkan 204 untuk yang terhapus DAN untuk yang memang sudah tidak
    // ada. Keduanya hasil yang kita inginkan, jadi tidak dibedakan.
    if (!res.ok && res.status !== 404) {
      return json({ error: `R2 menolak penghapusan (${res.status}).` }, 502);
    }
    await admin.from('konten_berkas').delete().eq('tugas_id', tugas.id).eq('r2_key', kunci);
    return json({ ok: true });
  }

  return json({ error: `Aksi tidak dikenal: ${aksi}` }, 400);
});
