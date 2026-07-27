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
