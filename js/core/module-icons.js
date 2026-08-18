const ICONS = {
  attendance: '🕐',
  leave: '📝',
  cleaning_checklist: '🧹',
  inventory: '📦',
  production: '🏭',
  cash_ledger: '💵',
  fleet: '🚗',
  master_user: '👤',
  dashboard: '🏠',
  report: '📊',
  telegram: '📣',
  bu_appearance: '🎨',
  organization: '🏢',
  master_product: '📒',
  dispatch: '🚚',
  menu: '🍽️',
  sales: '💰',
  reservation: '📅',
  asset: '🪑',
  shift: '🗓️',
  grp_org: '🏢',
  grp_user: '👤',
  grp_inventory: '📦'
};

export function getModuleIcon(code) {
  return ICONS[code] ?? '📁';
}

/**
 * Nama modul versi STAFF APP, kalau berbeda dari nama di tabel `modules`.
 *
 * Diletakkan di sini, BUKAN diubah lewat `update modules set name = …`, karena
 * `modules.name` juga dipakai layar admin (toggle modul per BU, akses per
 * user). Mengubahnya di database berarti mengganti namanya di tempat-tempat
 * yang tidak diminta — dan yang paling mengganggu, di layar tempat admin
 * mencocokkan modul dengan dokumentasi.
 *
 * "Bahan" dipilih karena itu yang benar-benar dikerjakan staff di sana:
 * menerima, menghitung, dan memindahkan bahan. "Inventory" adalah istilah
 * yang dipakai orang yang membaca laporannya, bukan yang berdiri di gudang.
 */
const LABEL_STAFF = {
  inventory: 'Bahan'
};

/** Terapkan nama versi Staff App ke daftar modul (tidak mengubah aslinya). */
export function pakaiLabelStaff(modules) {
  return (modules ?? []).map((m) => (LABEL_STAFF[m.code] ? { ...m, name: LABEL_STAFF[m.code] } : m));
}
