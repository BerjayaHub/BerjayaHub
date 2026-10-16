// supabase/functions/purge-konten/index.ts
// Deploy: supabase functions deploy purge-konten
//
// Membersihkan berkas konten dari Cloudflare R2. Dua pekerjaan, satu jalan:
//
//   1. Berkas tugas yang sudah DITANDAI SELESAI lebih dari masa tenggang
//      (bawaan 7 hari). Itu yang dipilih pemiliknya: tandai selesai, lalu
//      berkasnya hilang sendiri.
//
//   2. SAMPAH — kunci yang barisnya sudah hilang dari `konten_berkas` lewat
//      jalan apa pun: staff membatalkan unggahan, admin menghapus, atau
//      tugasnya dihapus dan cascade membawanya.
//
// ============ KENAPA NOMOR 2 ADA ============
//
// Objek R2 yang barisnya hilang tidak ditunjuk apa pun, jadi tidak muncul di
// layar mana pun, jadi tidak ada yang tahu ia ada — sementara ia tetap
// menghitung kuota 10 GB. Kebocoran yang baru ketahuan bertahun-tahun kemudian
// sebagai "kenapa R2 saya penuh padahal isinya sedikit".
//
// Trigger `catat_sampah_berkas_konten` (0163) yang mencatatnya, apa pun jalan
// hilangnya barisnya. Function ini yang menghabisinya.
//
// ============ BERKASNYA DIHAPUS, BARISNYA TIDAK ============
//
// `konten_tugas` tetap ada selamanya: catatan "minggu ke-42 outlet Dago setor,
// selesai 18 Okt" itu beberapa ratus byte dan menjawab pertanyaan rekap
// berbulan-bulan kemudian. Yang 141 MB cuma titipan sementara.
//
// `berkas_dihapus_at` diisi supaya layar bisa menulis "berkas sudah dihapus
// otomatis" alih-alih menampilkan pemutar video kosong — perbedaan antara
// keterangan dan laporan bug palsu yang berulang.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID') ?? '';
const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID') ?? '';
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '';
const R2_BUCKET = Deno.env.get('R2_BUCKET') ?? 'berjaya-konten';

const HARI_DEFAULT = 7;
// Sekali jalan yang gagal seluruhnya lebih buruk daripada beberapa kali jalan
// yang sebagian. Alasan yang sama dengan `purge-old-selfies`.
const UKURAN_BATCH = 50;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const r2 = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service: 's3',
  region: 'auto'
});
const urlObjek = (kunci: string) => `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${kunci}`;

/**
 * Hapus satu objek. Memulangkan `true` kalau objeknya SUDAH TIDAK ADA di R2 —
 * baik karena baru dihapus, maupun karena memang tidak pernah ada.
 *
 * Keduanya disamakan dengan sengaja: 404 berarti tujuan kita sudah tercapai.
 * Memperlakukannya sebagai kegagalan akan membuat kunci itu dicoba lagi setiap
 * malam, selamanya, tanpa pernah berhasil — antrean yang tidak pernah habis.
 */
async function hapusObjek(kunci: string) {
  const res = await r2.fetch(urlObjek(kunci), { method: 'DELETE' });
  return res.ok || res.status === 404;
}

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }
  for (const [nama, nilai] of [
    ['R2_ACCOUNT_ID', R2_ACCOUNT_ID],
    ['R2_ACCESS_KEY_ID', R2_ACCESS_KEY_ID],
    ['R2_SECRET_ACCESS_KEY', R2_SECRET_ACCESS_KEY]
  ]) {
    if (!nilai) return json({ error: `Setelan R2 belum lengkap: ${nama}.` }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* tanpa body -> pakai default */
  }
  const hari = Number(body.days) > 0 ? Number(body.days) : HARI_DEFAULT;
  // `dry_run` melaporkan APA yang akan dihapus tanpa menghapusnya. Dipakai
  // memastikan cron-nya benar-benar mengenai sesuatu — pelajaran dari rekap
  // Telegram yang melaporkan `succeeded` berbulan-bulan tanpa pernah terkirim.
  const dryRun = body.dry_run === true;

  const batas = new Date(Date.now() - hari * 24 * 60 * 60 * 1000).toISOString();
  const hasil = { tugas_dibersihkan: 0, berkas_dihapus: 0, sampah_dihapus: 0, gagal: 0, dry_run: dryRun };

  // ---------------------------------------------------------------
  // 1. Tugas yang sudah selesai lewat masa tenggang.
  // ---------------------------------------------------------------
  const { data: tugasSiap, error: galatTugas } = await admin
    .from('konten_tugas')
    .select('id, konten_berkas(id, r2_key)')
    .eq('status', 'selesai')
    .is('berkas_dihapus_at', null)
    .lt('selesai_at', batas)
    .limit(UKURAN_BATCH);
  if (galatTugas) return json({ error: galatTugas.message }, 500);

  for (const t of tugasSiap ?? []) {
    const berkas = (t as { konten_berkas?: { id: string; r2_key: string }[] }).konten_berkas ?? [];
    let semuaBeres = true;
    for (const b of berkas) {
      if (dryRun) continue;
      if (await hapusObjek(b.r2_key)) hasil.berkas_dihapus += 1;
      else {
        semuaBeres = false;
        hasil.gagal += 1;
      }
    }
    if (dryRun) {
      hasil.tugas_dibersihkan += 1;
      hasil.berkas_dihapus += berkas.length;
      continue;
    }
    // ============ PENANDA HANYA KALAU SEMUANYA BERES ============
    //
    // Kalau satu berkas gagal dihapus dan tugasnya tetap ditandai bersih,
    // berkas itu keluar dari antrean selamanya — bocor tanpa jejak. Dibiarkan
    // tanpa penanda, ia dicoba lagi besok malam.
    if (semuaBeres) {
      await admin.from('konten_tugas').update({ berkas_dihapus_at: new Date().toISOString() }).eq('id', t.id);
      // Barisnya dihapus SESUDAH objeknya hilang. Urutan ini penting: kalau
      // barisnya lebih dulu, triggernya mencatat kuncinya ke sampah dan
      // pekerjaan ini mengejar sesuatu yang sudah tidak ada.
      await admin.from('konten_berkas').delete().eq('tugas_id', t.id);
      hasil.tugas_dibersihkan += 1;
    }
  }

  // ---------------------------------------------------------------
  // 2. Sampah — kunci yang barisnya sudah hilang lewat jalan apa pun.
  // ---------------------------------------------------------------
  const { data: sampah, error: galatSampah } = await admin
    .from('konten_berkas_sampah')
    .select('r2_key')
    .is('dihapus_at', null)
    .limit(UKURAN_BATCH);
  if (galatSampah) return json({ error: galatSampah.message }, 500);

  for (const s of sampah ?? []) {
    if (dryRun) {
      hasil.sampah_dihapus += 1;
      continue;
    }
    if (await hapusObjek(s.r2_key)) {
      await admin
        .from('konten_berkas_sampah')
        .update({ dihapus_at: new Date().toISOString() })
        .eq('r2_key', s.r2_key);
      hasil.sampah_dihapus += 1;
    } else {
      hasil.gagal += 1;
    }
  }

  return json(hasil);
});
