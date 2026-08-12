// ----------------------------------------------------------------------

const ROOTS = {
  AUTH: '/auth',
  DASHBOARD: '/dashboard',
  APP: '/app',
};

// ----------------------------------------------------------------------

export const paths = {
  faqs: '/faqs',
  minimalStore: 'https://mui.com/store/items/minimal-dashboard/',
  login: '/login',
  // AUTH
  auth: {
    amplify: {
      signIn: `${ROOTS.AUTH}/amplify/sign-in`,
      verify: `${ROOTS.AUTH}/amplify/verify`,
      signUp: `${ROOTS.AUTH}/amplify/sign-up`,
      updatePassword: `${ROOTS.AUTH}/amplify/update-password`,
      resetPassword: `${ROOTS.AUTH}/amplify/reset-password`,
    },
    jwt: {
      signIn: `${ROOTS.AUTH}/jwt/sign-in`,
      signUp: `${ROOTS.AUTH}/jwt/sign-up`,
    },
    firebase: {
      signIn: `${ROOTS.AUTH}/firebase/sign-in`,
      verify: `${ROOTS.AUTH}/firebase/verify`,
      signUp: `${ROOTS.AUTH}/firebase/sign-up`,
      resetPassword: `${ROOTS.AUTH}/firebase/reset-password`,
    },
    auth0: {
      signIn: `${ROOTS.AUTH}/auth0/sign-in`,
    },
    supabase: {
      signIn: `${ROOTS.AUTH}/supabase/sign-in`,
      verify: `${ROOTS.AUTH}/supabase/verify`,
      signUp: `${ROOTS.AUTH}/supabase/sign-up`,
      updatePassword: `${ROOTS.AUTH}/supabase/update-password`,
      resetPassword: `${ROOTS.AUTH}/supabase/reset-password`,
    },
  },
  // DASHBOARD
  dashboard: {
    root: `${ROOTS.APP}/dashboard`,
    two: `${ROOTS.DASHBOARD}/two`,
    three: `${ROOTS.DASHBOARD}/three`,
    group: {
      root: `${ROOTS.DASHBOARD}/group`,
      five: `${ROOTS.DASHBOARD}/group/five`,
      six: `${ROOTS.DASHBOARD}/group/six`,
    },
  },
  // APP CANONICAL ROUTES (SECTION 9.1)
  app: {
    root: ROOTS.APP,
    dashboard: `${ROOTS.APP}/dashboard`,
    pos: `${ROOTS.APP}/pos`,
    kiosk: `${ROOTS.APP}/kiosk`,
    orders: {
      root: `${ROOTS.APP}/orders`,
      detail: (id: string) => `${ROOTS.APP}/orders/${id}`,
    },
    dineIn: {
      floor: `${ROOTS.APP}/dine-in/floor`,
    },
    kds: `${ROOTS.APP}/kds`,
    delivery: {
      orders: `${ROOTS.APP}/delivery/orders`,
      couriers: `${ROOTS.APP}/delivery/couriers`,
      courierDetail: (id: string) => `${ROOTS.APP}/delivery/couriers/${id}`,
      settlements: `${ROOTS.APP}/delivery/settlements`,
      settlementDetail: (id: string) => `${ROOTS.APP}/delivery/settlements/${id}`,
    },
    cashier: {
      shifts: `${ROOTS.APP}/cashier/shifts`,
      shiftDetail: (id: string) => `${ROOTS.APP}/cashier/shifts/${id}`,
      businessDays: `${ROOTS.APP}/cashier/business-days`,
    },
    payments: `${ROOTS.APP}/payments`,
    refunds: `${ROOTS.APP}/refunds`,
    customers: {
      root: `${ROOTS.APP}/customers`,
      detail: (id: string) => `${ROOTS.APP}/customers/${id}`,
    },
    credit: {
      accounts: `${ROOTS.APP}/credit/accounts`,
      accountDetail: (id: string) => `${ROOTS.APP}/credit/accounts/${id}`,
    },
    catalog: {
      categories: `${ROOTS.APP}/catalog/categories`,
      products: `${ROOTS.APP}/catalog/products`,
      productDetail: (id: string) => `${ROOTS.APP}/catalog/products/${id}`,
      modifiers: `${ROOTS.APP}/catalog/modifiers`,
      menus: `${ROOTS.APP}/catalog/menus`,
      menuDetail: (id: string) => `${ROOTS.APP}/catalog/menus/${id}`,
      availability: `${ROOTS.APP}/catalog/availability`,
      importExport: `${ROOTS.APP}/catalog/import-export`,
    },
    pricing: {
      priceBook: `${ROOTS.APP}/pricing/price-book`,
      priceGroups: `${ROOTS.APP}/pricing/price-groups`,
      bulkUpdate: `${ROOTS.APP}/pricing/bulk-update`,
    },
    discounts: {
      campaigns: `${ROOTS.APP}/discounts/campaigns`,
      campaignDetail: (id: string) => `${ROOTS.APP}/discounts/campaigns/${id}`,
      coupons: `${ROOTS.APP}/discounts/coupons`,
    },
    operations: {
      branches: `${ROOTS.APP}/operations/branches`,
      branchDetail: (id: string) => `${ROOTS.APP}/operations/branches/${id}`,
      terminals: `${ROOTS.APP}/operations/terminals`,
      kdsConfiguration: `${ROOTS.APP}/operations/kds-configuration`,
      printers: `${ROOTS.APP}/operations/printers`,
      printQueue: `${ROOTS.APP}/operations/print-queue`,
      monitoring: `${ROOTS.APP}/operations/monitoring`,
    },
    simulation: {
      root: `${ROOTS.APP}/simulation`,
      snappfood: `${ROOTS.APP}/simulation/snappfood`,
      paymentsPrinters: `${ROOTS.APP}/simulation/payments-printers`,
      offlineSync: `${ROOTS.APP}/simulation/offline-sync`,
      logs: `${ROOTS.APP}/simulation/logs`,
    },
    reports: {
      root: `${ROOTS.APP}/reports`,
      code: (code: string) => `${ROOTS.APP}/reports/${code}`,
    },
    audit: `${ROOTS.APP}/audit`,
    settings: {
      root: `${ROOTS.APP}/settings`,
      general: `${ROOTS.APP}/settings/general`,
      orderWorkflow: `${ROOTS.APP}/settings/order-workflow`,
      discountsCredit: `${ROOTS.APP}/settings/discounts-credit`,
      paymentsRefunds: `${ROOTS.APP}/settings/payments-refunds`,
      approvals: `${ROOTS.APP}/settings/approvals`,
      reasons: `${ROOTS.APP}/settings/reasons`,
      localization: `${ROOTS.APP}/settings/localization`,
      dataReset: `${ROOTS.APP}/settings/data-reset`,
    },
    v5: {
      inventory: `${ROOTS.APP}/inventory/stock`,
    },
  },
};
