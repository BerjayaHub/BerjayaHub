// supabase/functions/purge-old-selfies/index.ts
// Deploy: supabase functions deploy purge-old-selfies
//
// Hapus selfie presensi yang lebih tua dari masa simpan (default 90 hari).
//
// KENAPA ADA: selfie presensi adalah penyumbang storage terbesar dan satu-satunya
// yang tumbuh SETIAP HARI selamanya — 2 foto per orang per hari. Tanpa
// pembersihan, kuota pasti habis; pertanyaannya cuma kapan. Dengan kompresi +
// retensi, ukurannya berhenti di angka tetap.
//
// KENAPA FOTONYA DIHAPUS TAPI BARIS PRESENSINYA TIDAK: jam masuk/pulang adalah
// dasar perhitungan gaji dan harus disimpan permanen. Yang nilainya habis
// seiring waktu hanya BUKTI VISUAL-nya — setelah periode gaji lewat dan tidak
// ada sengketa, foto itu tidak lagi menjawab pertanyaan siapa pun.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const HARI_DEFAULT = 90;
// Storage API menolak permintaan hapus yang terlalu panjang, dan sekali jalan
// yang gagal seluruhnya lebih buruk daripada beberapa kali jalan yang sebagian.
const UKURAN_BATCH = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* tanpa body -> pakai default */
  }
  const hari = Number(body.days) > 0 ? Number(body.days) : HARI_DEFAULT;
  const dryRun = body.dry_run === true;

  const batas = new Date(Date.now() - hari * 24 * 3600 * 1000).toISOString();

  // Ambil baris lama yang MASIH punya foto. `limit` menjaga sekali jalan tetap
  // terkendali; sisanya terhapus di jalan berikutnya (cron harian).
  const { data: baris, error } = await admin
    .from('attendance_records')
    .select('id, clock_in_photo_path, clock_out_photo_path')
    .lt('clock_in_at', batas)
    .or('clock_in_photo_path.not.is.null,clock_out_photo_path.not.is.null')
    .limit(500);

  if (error) return json({ error: error.message }, 500);
  if (!baris?.length) {
    return json({ ok: true, batas, hari, dihapus: 0, catatan: 'Tidak ada selfie yang melewati masa simpan.' });
  }

  const paths = baris.flatMap((r) => [r.clock_in_photo_path, r.clock_out_photo_path].filter(Boolean) as string[]);

  if (dryRun) {
    return json({ ok: true, dry_run: true, batas, hari, akanDihapus: paths.length, contoh: paths.slice(0, 5) });
  }

  let terhapus = 0;
  const gagal: string[] = [];
  for (let i = 0; i < paths.length; i += UKURAN_BATCH) {
    const potong = paths.slice(i, i + UKURAN_BATCH);
    const { error: delErr } = await admin.storage.from('attendance-selfies').remove(potong);
    if (delErr) gagal.push(delErr.message);
    else terhapus += potong.length;
  }

  // Kolom path dikosongkan HANYA setelah filenya benar-benar dihapus. Kalau
  // dibalik, file yang gagal dihapus akan kehilangan satu-satunya penunjuknya
  // dan menjadi sampah permanen yang tidak bisa ditemukan lagi.
  if (terhapus > 0) {
    const { error: updErr } = await admin
      .from('attendance_records')
      .update({ clock_in_photo_path: null, clock_out_photo_path: null })
      .in(
        'id',
        baris.map((r) => r.id)
      );
    if (updErr) gagal.push(updErr.message);
  }

  return json({ ok: true, batas, hari, baris: baris.length, dihapus: terhapus, gagal });
});
