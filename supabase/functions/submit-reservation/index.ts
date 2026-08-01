// supabase/functions/submit-reservation/index.ts
// Deploy: supabase functions deploy submit-reservation --no-verify-jwt
//
// Satu-satunya jalur masuk reservasi dari WEBSITE (customer belum login).
//
// Sengaja lewat Edge Function, BUKAN insert langsung dengan anon key:
// membuka policy insert untuk role `anon` berarti membuka jalur tulis publik
// ke database, dan mengamankannya lewat RLS jauh lebih rapuh daripada satu
// pintu server yang memvalidasi kapasitas, lead time, dan anti-spam.

import { createClient } from 'npm:@supabase/supabase-js@2'; // npm:, bukan esm.sh — lihat catatan di create-staff-user

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

/** 08xx / +62xx / 62xx -> 62xxxxxxxx. Return null kalau tidak masuk akal. */
function normalPhone(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '');
  const n = d.startsWith('62') ? d : d.startsWith('0') ? '62' + d.slice(1) : d.startsWith('8') ? '62' + d : d;
  return n.length >= 10 && n.length <= 15 ? n : null;
}

const MAX_PER_PHONE_PER_DAY = 3;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // deno-lint-ignore no-explicit-any
  let b: any;
  try {
    b = await req.json();
  } catch {
    return json({ error: 'Format permintaan tidak valid.' }, 400);
  }

  // Honeypot: field tersembunyi yang hanya diisi bot. Dibalas "sukses" palsu
  // supaya bot tidak belajar bahwa jebakannya terdeteksi.
  if (b?.website) return json({ ok: true, code: 'OK' });

  const name = String(b?.customer_name ?? '').trim();
  const phone = normalPhone(b?.phone);
  const outletId = String(b?.outlet_id ?? '');
  const date = String(b?.reserve_date ?? '');
  const time = String(b?.reserve_time ?? '');
  const pax = Number(b?.pax);

  if (!name || name.length < 2) return json({ error: 'Nama belum diisi dengan benar.' }, 400);
  if (!phone) return json({ error: 'Nomor WhatsApp tidak valid.' }, 400);
  if (!outletId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}/.test(time)) {
    return json({ error: 'Outlet, tanggal, atau jam belum lengkap.' }, 400);
  }
  if (!Number.isInteger(pax) || pax < 1 || pax > 200) return json({ error: 'Jumlah tamu tidak valid.' }, 400);

  // Outlet bermode HOTEL tidak menerima booking lewat website sama sekali —
  // sesuai keputusan, booking kamar hanya diisi admin di Admin Portal.
  // Diperiksa DI SINI supaya penolakannya jelas ("tidak menerima booking
  // online") alih-alih gagal jauh di dalam dengan pesan constraint database.
  // Lapisan kedua tetap ada: constraint `reservations_hotel_bukan_dari_web`
  // di migration 0055 — kalau pemeriksaan ini terlewat, database yang menolak.
  const { data: outletMode } = await admin.from('outlets').select('reservation_mode').eq('id', outletId).maybeSingle();
  if (outletMode?.reservation_mode === 'hotel') {
    return json({ error: 'Outlet ini tidak menerima booking online. Silakan hubungi kami langsung.' }, 400);
  }

  // Outlet harus benar-benar membuka reservasi publik.
  const { data: setting } = await admin
    .from('reservation_settings')
    .select('*')
    .eq('outlet_id', outletId)
    .eq('is_public_enabled', true)
    .maybeSingle();
  if (!setting) return json({ error: 'Outlet ini sedang tidak menerima reservasi online.' }, 400);

  if (pax > setting.max_pax_per_slot) {
    return json(
      { error: `Untuk ${pax} orang mohon hubungi kami langsung — reservasi online maksimal ${setting.max_pax_per_slot} orang per jam.` },
      400
    );
  }

  // Rate limit sederhana per nomor per hari: menahan spam tanpa captcha.
  const { count } = await admin
    .from('reservations')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .gte('created_at', new Date(Date.now() - 86400000).toISOString());
  if ((count ?? 0) >= MAX_PER_PHONE_PER_DAY) {
    return json({ error: 'Nomor ini sudah mengirim beberapa reservasi hari ini. Silakan hubungi kami langsung.' }, 429);
  }

  // Ketersediaan dihitung DATABASE, sumber aturan yang sama dengan Staff App.
  const { data: slots, error: avErr } = await admin.rpc('reservation_availability', { p_outlet: outletId, p_date: date });
  if (avErr) return json({ error: avErr.message }, 500);
  // deno-lint-ignore no-explicit-any
  const slot = (slots ?? []).find((s: any) => String(s.slot_time).slice(0, 5) === time.slice(0, 5));
  if (!slot) return json({ error: 'Jam itu di luar jam operasional outlet.' }, 400);
  if (!slot.is_open) return json({ error: 'Jam itu sudah penuh atau terlalu mepet. Silakan pilih jam lain.' }, 409);
  if (slot.used_pax + pax > slot.max_pax) {
    return json({ error: `Sisa kursi di jam itu tinggal ${Math.max(slot.max_pax - slot.used_pax, 0)}.` }, 409);
  }

  const { data: outlet } = await admin.from('outlets').select('business_unit_id').eq('id', outletId).maybeSingle();
  if (!outlet) return json({ error: 'Outlet tidak ditemukan.' }, 400);

  // Area divalidasi supaya tidak bisa dikirimi id sembarangan.
  let areaId: string | null = null;
  if (b?.area_id) {
    const { data: area } = await admin.from('reservation_areas').select('id').eq('id', b.area_id).eq('outlet_id', outletId).maybeSingle();
    areaId = area?.id ?? null;
  }

  const { data: row, error } = await admin
    .from('reservations')
    .insert({
      business_unit_id: outlet.business_unit_id,
      outlet_id: outletId,
      customer_name: name,
      phone,
      email: String(b?.email ?? '').trim() || null,
      reserve_date: date,
      reserve_time: time.slice(0, 5),
      pax,
      area_id: areaId,
      notes: String(b?.notes ?? '').trim().slice(0, 500) || null,
      referral_source: String(b?.referral_source ?? '').trim().slice(0, 100) || null,
      source: 'web',
      status: 'pending',
      created_by: null
    })
    .select('code')
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, code: row?.code ?? null });
});
