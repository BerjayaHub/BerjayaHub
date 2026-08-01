// supabase/functions/purge-old-selfies/index.ts
// Deploy: supabase functions deploy purge-old-selfies
//
// Hapus foto bukti yang lebih tua dari masa simpan (default 90 hari):
// selfie presensi DAN foto item Daily Activities.
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

import { createClient } from 'npm:@supabase/supabase-js@2'; // npm:, bukan esm.sh — lihat catatan di create-staff-user

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

  const paths = (baris ?? []).flatMap(
    (r) => [r.clock_in_photo_path, r.clock_out_photo_path].filter(Boolean) as string[]
  );

  let terhapus = 0;
  const gagal: string[] = [];

  if (dryRun) {
    terhapus = 0;
  } else {
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
          (baris ?? []).map((r) => r.id)
        );
      if (updErr) gagal.push(updErr.message);
    }
  }

  // ---- Foto Daily Activities (per item, sejak migration 0052) ----
  //
  // Ikut dibersihkan di function yang sama, bukan function terpisah: jadwalnya
  // sama, aturannya sama, dan dua cron yang harus dijaga sinkron adalah dua kali
  // peluang salah satunya diam-diam mati tanpa ada yang sadar.
  //
  // PENTING: bagian ini WAJIB dijalankan tanpa syarat. Versi pertama saya
  // menaruhnya setelah dua `return` awal (tidak ada selfie lama / mode dry run),
  // sehingga begitu selfie sudah bersih, foto aktivitas TIDAK PERNAH tersentuh —
  // dan responsnya tetap `ok: true`, jadi tidak ada yang curiga.
  const aktivitas = await bersihkanFotoAktivitas(admin, batas, dryRun);

  return json({
    ok: true,
    dry_run: dryRun || undefined,
    batas,
    hari,
    selfie: { baris: (baris ?? []).length, akanDihapus: dryRun ? paths.length : undefined, dihapus: terhapus, gagal },
    aktivitas
  });
});

async function bersihkanFotoAktivitas(
  admin: ReturnType<typeof createClient>,
  batas: string,
  dryRun: boolean
) {
  // `run_date` bertipe date, jadi dibandingkan sebagai tanggal saja.
  const batasTanggal = batas.slice(0, 10);

  const { data: runs, error } = await admin
    .from('checklist_runs')
    .select('id')
    .lt('run_date', batasTanggal)
    .limit(200);
  if (error) return { error: error.message };
  if (!runs?.length) return { dihapus: 0 };

  const ids = runs.map((r) => r.id);
  const { data: items, error: itemErr } = await admin
    .from('checklist_run_items')
    .select('id, photo_path')
    .in('run_id', ids)
    .not('photo_path', 'is', null);
  if (itemErr) return { error: itemErr.message };

  const paths = (items ?? []).map((i) => i.photo_path).filter(Boolean) as string[];
  if (!paths.length) return { dihapus: 0 };
  if (dryRun) return { dry_run: true, akanDihapus: paths.length, contoh: paths.slice(0, 5) };

  let terhapus = 0;
  const gagal: string[] = [];
  for (let i = 0; i < paths.length; i += UKURAN_BATCH) {
    const potong = paths.slice(i, i + UKURAN_BATCH);
    const { error: delErr } = await admin.storage.from('checklist-photos').remove(potong);
    if (delErr) gagal.push(delErr.message);
    else terhapus += potong.length;
  }

  // Sama seperti selfie: kolom path dikosongkan HANYA setelah filenya benar-benar
  // hilang. Kalau dibalik, file yang gagal dihapus kehilangan satu-satunya
  // penunjuknya dan jadi sampah permanen yang tidak bisa ditemukan lagi.
  if (terhapus > 0) {
    const { error: updErr } = await admin
      .from('checklist_run_items')
      .update({ photo_path: null })
      .in(
        'id',
        (items ?? []).map((i) => i.id)
      );
    if (updErr) gagal.push(updErr.message);
  }

  return { dihapus: terhapus, gagal };
}
