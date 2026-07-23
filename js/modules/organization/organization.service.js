import { supabase } from '../../config/supabase-client.js';

export async function getBusinessUnit(businessUnitId) {
  const { data, error } = await supabase
    .from('business_units')
    .select('id, name, type, theme_color, logo_url')
    .eq('id', businessUnitId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateBuTheme(businessUnitId, { theme_color }) {
  const { error } = await supabase.from('business_units').update({ theme_color }).eq('id', businessUnitId);
  if (error) throw error;
}

// ---- Master Organisasi / BU / Outlet (Admin Portal) ----

export async function listOrganizations() {
  const { data, error } = await supabase.from('organizations').select('id, name').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createOrganization({ name }) {
  const { data, error } = await supabase.from('organizations').insert({ name }).select().single();
  if (error) throw error;
  return data;
}

/** Semua BU yang bisa dilihat admin (RLS otomatis batasi), lengkap dengan nama organisasi. */
export async function listBusinessUnitsFull() {
  const { data, error } = await supabase
    .from('business_units')
    .select('id, name, type, is_active, organization_id, organizations(name)')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createBusinessUnit({ organization_id, name, type, is_active }) {
  const { error } = await supabase
    .from('business_units')
    .insert({ organization_id, name, type, is_active: is_active ?? true });
  if (error) throw error;
}

export async function updateBusinessUnit(id, { name, type, is_active }) {
  const { error } = await supabase.from('business_units').update({ name, type, is_active }).eq('id', id);
  if (error) throw error;
}

export async function deleteBusinessUnit(id) {
  const { error } = await supabase.from('business_units').delete().eq('id', id);
  if (error) throw error;
}

/** Semua outlet milik satu BU (termasuk kolom yang perlu untuk edit). */
export async function listOutletsForBu(businessUnitId) {
  const { data, error } = await supabase
    .from('outlets')
    .select('id, name, address, outlet_role, served_by_outlet_id, is_active')
    .eq('business_unit_id', businessUnitId)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createOutlet({ business_unit_id, name, address, outlet_role, served_by_outlet_id, is_active }) {
  const { error } = await supabase.from('outlets').insert({
    business_unit_id,
    name,
    address: address || null,
    outlet_role: outlet_role || 'standalone',
    served_by_outlet_id: outlet_role === 'served_by_ck' ? served_by_outlet_id || null : null,
    is_active: is_active ?? true
  });
  if (error) throw error;
}

export async function updateOutlet(id, { name, address, outlet_role, served_by_outlet_id, is_active }) {
  const { error } = await supabase
    .from('outlets')
    .update({
      name,
      address: address || null,
      outlet_role,
      served_by_outlet_id: outlet_role === 'served_by_ck' ? served_by_outlet_id || null : null,
      is_active
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteOutlet(id) {
  const { error } = await supabase.from('outlets').delete().eq('id', id);
  if (error) throw error;
}

/** Upload logo BU ke bucket publik 'bu-logos', simpan public URL-nya ke business_units.logo_url. */
export async function uploadBuLogo(businessUnitId, file) {
  const ext = file.type === 'image/png' ? 'png' : 'jpg';
  const path = `${businessUnitId}/logo.${ext}`;
  const { error: uploadError } = await supabase.storage.from('bu-logos').upload(path, file, {
    upsert: true,
    contentType: file.type || 'image/jpeg'
  });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from('bu-logos').getPublicUrl(path);
  const publicUrl = `${data.publicUrl}?t=${Date.now()}`; // cache-bust biar logo baru langsung kepakai

  const { error: updateError } = await supabase.from('business_units').update({ logo_url: publicUrl }).eq('id', businessUnitId);
  if (updateError) throw updateError;

  return publicUrl;
}
