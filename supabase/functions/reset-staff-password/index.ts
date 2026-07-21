// supabase/functions/reset-staff-password/index.ts
// Deploy: supabase functions deploy reset-staff-password
//
// Dipanggil dari Admin Portal (Master User) untuk reset password staff
// yang lupa password. Pakai service_role — validasi otorisasi manual.

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const callerToken = authHeader.replace('Bearer ', '');
  if (!callerToken) return json({ error: 'Missing Authorization header' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: callerData, error: callerError } = await admin.auth.getUser(callerToken);
  if (callerError || !callerData?.user) return json({ error: 'Invalid session' }, 401);
  const callerId = callerData.user.id;

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { target_user_id, new_password } = payload;
  if (!target_user_id || !new_password) {
    return json({ error: 'target_user_id dan new_password wajib diisi' }, 400);
  }
  if (new_password.length < 6) {
    return json({ error: 'Password minimal 6 karakter' }, 400);
  }

  // Cari BU tempat target user terdaftar, buat validasi apakah caller adalah adminnya
  const { data: targetScopes, error: targetError } = await admin
    .from('membership_scopes')
    .select('business_unit_id')
    .eq('user_id', target_user_id);
  if (targetError) return json({ error: targetError.message }, 500);

  const targetBuIds = (targetScopes ?? []).map((s) => s.business_unit_id);

  const { data: callerScopes, error: scopeError } = await admin
    .from('membership_scopes')
    .select('role, business_unit_id')
    .eq('user_id', callerId);
  if (scopeError) return json({ error: scopeError.message }, 500);

  const isSuperAdmin = callerScopes?.some((s) => s.role === 'super_admin');
  const isBuAdmin = callerScopes?.some(
    (s) => s.role === 'bu_admin' && targetBuIds.includes(s.business_unit_id)
  );

  if (!isSuperAdmin && !isBuAdmin) {
    return json({ error: 'Kamu tidak punya akses untuk reset password staff ini' }, 403);
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(target_user_id, {
    password: new_password
  });
  if (updateError) return json({ error: updateError.message }, 400);

  return json({ success: true });
});
