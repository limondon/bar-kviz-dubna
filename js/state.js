// Единый объект глобального состояния приложения
export const S = {
  orders: [],
  tablesMeta: {},
  tablesLoaded: false,
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
  orderNumResetAt: 0,
  deliveryLog: {},
  closedArchive: {date:null,orders:[],tables:{},loading:false,error:null,loadedAt:0},
  stats: {data:null,loading:false,error:null,loadedAt:0},
  maintenance: null,
};
