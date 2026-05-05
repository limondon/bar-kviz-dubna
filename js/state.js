// Единый объект глобального состояния приложения
export const S = {
  orders: [],
  tablesMeta: {},
  menuItems: [],
  BUILTIN_MENU_LIVE: [],
  waiterCallsData: {},
  role: null,
  activeTab: '',
  lastHash: '',
  qf: 'all',
  viewDate: null,        // инициализируется в main после импорта todayStr
  closedViewDate: null,
  pendingRole: null,
  editOrderId: null,
  editBillMode: false,
  appPassword: null,
};
