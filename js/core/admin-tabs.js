// =========================================================
// Katalog menu/tab Admin Portal yang izin aksesnya bisa diatur per user.
// Dipakai bersama oleh main-admin.js (penyaring menu) dan Master User
// (dialog pengaturan izin akses).
// =========================================================

export const ADMIN_TAB_CATALOG = [
  { code: 'dashboard', label: 'Dashboard', group: 'Umum', always: true },
  { code: 'report', label: 'Laporan', group: 'Umum' },
  // Berisi tombol uji koneksi bot -> data tingkat organisasi, super admin saja.
  { code: 'telegram', label: 'Notifikasi Telegram', group: 'Umum', superAdminOnly: true },

  // Struktur organisasi & tampilan BU = pengaturan tingkat organisasi -> super admin.
  { code: 'organization', label: 'Organisasi & Outlet', group: 'BU & Outlet', superAdminOnly: true },
  { code: 'bu_appearance', label: 'Tampilan BU', group: 'BU & Outlet', superAdminOnly: true },

  // Master User mengatur role & scope -> HANYA super admin, tidak bisa diberikan
  // ke role lain lewat pengaturan izin.
  { code: 'master_user', label: 'Master User (role & scope)', group: 'User', superAdminOnly: true },
  { code: 'staff_data', label: 'Data Staff', group: 'User', superAdminOnly: true },
  // Sengaja DI LUAR grup User: menu User kini khusus super admin, sedangkan
  // persetujuan cuti tetap harus bisa dikerjakan admin BU/outlet (PIC).
  { code: 'leave', label: 'Pengajuan Cuti', group: 'Modul lain' },
  // Kas melekat pada USER lintas BU (0040) -> data tingkat organisasi,
  // hanya super admin. Sama seperti Master User, tidak bisa diberikan ke role lain.
  { code: 'cash_ledger', label: 'Kas (semua pemegang)', group: 'User', superAdminOnly: true },

  { code: 'inventory', label: 'Stok & Riwayat', group: 'Inventory' },
  { code: 'master_product', label: 'Master Produk', group: 'Inventory' },
  { code: 'menu', label: 'Menu', group: 'Inventory' },
  { code: 'production', label: 'Produksi', group: 'Inventory' },
  { code: 'sales', label: 'Penjualan', group: 'Inventory' },

  // Menu berdiri sendiri (tidak digabung ke grup Inventory) supaya mudah dicari.
  { code: 'reservation', label: 'Reservasi', group: 'Modul lain' },
  { code: 'attendance', label: 'Presensi', group: 'Modul lain' },
  { code: 'cleaning_checklist', label: 'Daily Activities', group: 'Modul lain' },
  { code: 'dispatch', label: 'Pengiriman', group: 'Modul lain' },
  { code: 'shift', label: 'Shift (jadwal kerja)', group: 'Modul lain' },
  { code: 'fleet', label: 'Armada (kendaraan)', group: 'Modul lain' },
  { code: 'asset', label: 'Inventaris Aset', group: 'Modul lain' }
];

export const SUPER_ADMIN_ONLY_TABS = new Set(ADMIN_TAB_CATALOG.filter((t) => t.superAdminOnly).map((t) => t.code));
export const ALWAYS_TABS = new Set(ADMIN_TAB_CATALOG.filter((t) => t.always).map((t) => t.code));

/** Tab yang boleh diatur izinnya (selain yang khusus super admin & selalu tampil). */
export const GRANTABLE_TABS = ADMIN_TAB_CATALOG.filter((t) => !t.superAdminOnly && !t.always);

/**
 * Apakah sebuah tab boleh dibuka user ini?
 * @param code        kode tab
 * @param isSuperAdmin
 * @param allowed     Set kode tab yang di-whitelist (kosong = semua boleh)
 */
export function canAccessTab(code, isSuperAdmin, allowed) {
  if (SUPER_ADMIN_ONLY_TABS.has(code)) return isSuperAdmin;
  if (ALWAYS_TABS.has(code)) return true;
  if (isSuperAdmin) return true; // super admin tidak dibatasi
  if (!allowed || allowed.size === 0) return true; // belum diatur -> semua boleh
  return allowed.has(code);
}
