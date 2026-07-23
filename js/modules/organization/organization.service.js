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
