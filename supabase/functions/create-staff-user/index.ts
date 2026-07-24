// supabase/functions/create-staff-user/index.ts
// Deploy: supabase functions deploy create-staff-user
//
// Dipanggil dari Admin Portal (Master User) untuk bikin akun staff baru.
// Pakai service_role key di sisi server — TIDAK PERNAH dikirim ke frontend.
// Validasi otorisasi dilakukan manual di sini karena service_role melewati RLS.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

Deno.serve(async (req) => {
  // Browser selalu kirim preflight OPTIONS dulu sebelum POST sungguhan —
  // tanpa ini, request akan gagal di level CORS sebelum sampai ke logic di bawah.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const callerToken = authHeader.replace('Bearer ', '');
  if (!callerToken) return json({ error: 'Missing Authorization header' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Identifikasi siapa yang manggil, dari token JWT-nya sendiri (bukan service role)
  const { data: callerData, error: callerError } = await admin.auth.getUser(callerToken);
  if (callerError || !callerData?.user) return json({ error: 'Invalid session' }, 401);
  const callerId = callerData.user.id;

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { full_name, email, phone, business_unit_id, outlet_id, role, password } = payload;

  if (!full_name || !email || !business_unit_id || !role || !password) {
    return json({ error: 'full_name, email, password, business_unit_id, dan role wajib diisi' }, 400);
  }
  if (password.length < 6) {
    return json({ error: 'Password minimal 6 karakter' }, 400);
  }
  if (!['super_admin', 'bu_admin', 'outlet_admin', 'staff'].includes(role)) {
    return json({ error: 'role tidak valid' }, 400);
  }

  // Otorisasi manual: caller harus super_admin, atau bu_admin di BU yang dituju
  const { data: callerScopes, error: scopeError } = await admin
    .from('membership_scopes')
    .select('role, business_unit_id')
    .eq('user_id', callerId);

  if (scopeError) return json({ error: scopeError.message }, 500);

  const isSuperAdmin = callerScopes?.some((s) => s.role === 'super_admin');
  const isBuAdmin = callerScopes?.some(
    (s) => s.role === 'bu_admin' && s.business_unit_id === business_unit_id
  );

  if (!isSuperAdmin && !isBuAdmin) {
    return json({ error: 'Kamu tidak punya akses untuk menambah staff di BU ini' }, 403);
  }
  // bu_admin/outlet_admin hanya boleh membuat staff dengan role 'staff' atau 'outlet_admin',
  // tidak boleh membuat sesama bu_admin/super_admin
  if (!isSuperAdmin && (role === 'bu_admin' || role === 'super_admin')) {
    return json({ error: 'Hanya Super Admin yang bisa menambahkan bu_admin / super_admin' }, 403);
  }

  // Admin yang tentukan password awal secara langsung (bukan invite email) —
  // lebih praktis buat staff yang gak selalu cek email. Staff bisa ganti
  // sendiri nanti lewat "Ubah Password" di Staff App.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (createError) return json({ error: createError.message }, 400);

  const newUserId = created.user.id;

  const { error: profileError } = await admin.from('user_profiles').insert({
    id: newUserId,
    full_name,
    phone: phone ?? null
  });

  if (profileError) {
    // rollback: hapus auth user kalau insert profil gagal, biar gak jadi akun "yatim"
    await admin.auth.admin.deleteUser(newUserId);
    return json({ error: profileError.message }, 500);
  }

  const { error: membershipError } = await admin.from('membership_scopes').insert({
    user_id: newUserId,
    business_unit_id,
    outlet_id: outlet_id ?? null,
    role
  });

  if (membershipError) {
    await admin.auth.admin.deleteUser(newUserId);
    return json({ error: membershipError.message }, 500);
  }

  return json({ user_id: newUserId, email, full_name });
});
