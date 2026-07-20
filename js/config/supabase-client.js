// Supabase client — diimpor langsung dari CDN, tanpa build step.
// Ganti SUPABASE_URL & SUPABASE_ANON_KEY sesuai project Supabase kamu.
// JANGAN taruh service_role key di sini — hanya anon key yang aman untuk frontend.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
