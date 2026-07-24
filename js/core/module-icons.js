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
  bu_appearance: '🎨',
  organization: '🏢',
  master_product: '📒'
};

export function getModuleIcon(code) {
  return ICONS[code] ?? '📁';
}
