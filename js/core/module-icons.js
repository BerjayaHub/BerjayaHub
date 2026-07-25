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
  master_product: '📒',
  dispatch: '🚚',
  menu: '🍽️',
  sales: '💰',
  grp_org: '🏢',
  grp_user: '👤',
  grp_inventory: '📦'
};

export function getModuleIcon(code) {
  return ICONS[code] ?? '📁';
}
