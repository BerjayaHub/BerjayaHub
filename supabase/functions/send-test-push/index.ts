// supabase/functions/send-test-push/index.ts
// Deploy: supabase functions deploy send-test-push
//
// Mengirim push percobaan ke DIRI SENDIRI. Dipakai staff/admin untuk memastikan
// notifikasi benar-benar sampai di perangkatnya, tanpa menunggu jadwal cron atau
// menunggu ada reservasi masuk.
//
// Keamanan: pemanggil diidentifikasi dari JWT-nya sendiri, dan push HANYA
// dikirim ke langganan milik user itu. Tidak ada cara mengirim ke orang lain.
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT

import { createClient } from 'npm:@supabase/supabase-js@2'; // npm:, bukan esm.sh — lihat catatan di create-staff-user
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json({ error: 'VAPID belum diset sebagai secret Edge Function. Hubungi admin sistem.' }, 500);
  }

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  if (!token) return json({ error: 'Tidak ada sesi login.' }, 401);

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const uid = userData?.user?.id;
  if (userErr || !uid) return json({ error: 'Sesi tidak valid, silakan login ulang.' }, 401);

  const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth_key').eq('user_id', uid);
  if (!subs?.length) {
    return json(
      { error: 'Belum ada perangkat yang berlangganan. Aktifkan notifikasi dulu di perangkat ini, lalu coba lagi.' },
      400
    );
  }

  const payload = JSON.stringify({
    title: '🔔 Tes Notifikasi Berjaya Hub',
    body: 'Kalau kamu melihat pesan ini, notifikasi di perangkat ini sudah aktif ✅',
    url: './index.html',
    tag: 'berjaya-test-' + Date.now()
  });

  const results: Array<Record<string, unknown>> = [];
  let terkirim = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, payload);
      terkirim++;
      results.push({ device: sub.endpoint.slice(-12), ok: true });
    } catch (err) {
      const e = err as { statusCode?: number; body?: string; message?: string };
      // 404/410 = langganan sudah mati (browser dibersihkan, izin dicabut,
      // atau PWA dihapus). Dibersihkan supaya tidak jadi sampah selamanya.
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      }
      results.push({ device: sub.endpoint.slice(-12), ok: false, statusCode: e?.statusCode, detail: e?.body ?? e?.message });
    }
  }

  const mati = results.filter((r) => !r.ok).length;
  return json({
    ok: terkirim > 0,
    sent: terkirim,
    total: subs.length,
    results,
    hint:
      terkirim === 0
        ? 'Semua langganan gagal. Langganan yang kedaluwarsa sudah dibersihkan — aktifkan ulang notifikasi di perangkat ini.'
        : mati
        ? `${mati} perangkat lama sudah tidak aktif dan dibersihkan.`
        : null
  });
});
