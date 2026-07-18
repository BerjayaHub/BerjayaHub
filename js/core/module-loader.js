import { supabase } from '../config/supabase-client.js';

/**
 * Ambil daftar modul yang aktif untuk sebuah business unit tertentu.
 * Dipakai untuk merender menu secara dinamis: BU Cafe bisa dapat menu
 * berbeda dari BU Armada, tergantung modul apa yang di-toggle aktif
 * oleh admin di tabel bu_modules.
 *
 * Return: array of { code, name, description }
 */
export async function getActiveModules(businessUnitId) {
  const { data, error } = await supabase
    .from('bu_modules')
    .select('is_active, modules(code, name, description)')
    .eq('business_unit_id', businessUnitId)
    .eq('is_active', true);

  if (error) throw error;

  return (data ?? [])
    .map((row) => row.modules)
    .filter(Boolean);
}

/**
 * Registry sederhana: pemetaan module code -> fungsi render halaman.
 * Setiap modul baru yang selesai dibangun tinggal didaftarkan di sini,
 * tanpa perlu ubah kode di module-loader ini sendiri.
 *
 * Contoh nanti:
 *   import { renderAttendancePage } from '../modules/attendance/attendance.page.js';
 *   registerModule('attendance', renderAttendancePage);
 */
const registry = new Map();

export function registerModule(code, renderFn) {
  registry.set(code, renderFn);
}

export function getModuleRenderer(code) {
  return registry.get(code) ?? null;
}
