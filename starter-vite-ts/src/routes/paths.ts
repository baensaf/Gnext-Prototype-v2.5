// ----------------------------------------------------------------------

const ROOTS = {
  AUTH: '/auth',
  DASHBOARD: '/dashboard',
  APP: '/app',
};

// ----------------------------------------------------------------------

export const paths = {
  faqs: '/faqs',
  login: '/login',
  // DASHBOARD ROOT
  dashboard: {
    root: `${ROOTS.APP}/pos`,
  },
  // APP CANONICAL ROUTES (SECTION 9.1)
  app: {
    root: ROOTS.APP,
    dashboard: `${ROOTS.APP}/dashboard`,
    pos: `${ROOTS.APP}/pos`,
    kiosk: `${ROOTS.APP}/kiosk`,
    orders: {
      root: `${ROOTS.APP}/orders`,
      incoming: `${ROOTS.APP}/orders/incoming`,
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
      zones: `${ROOTS.APP}/delivery/zones`,
      audit: `${ROOTS.APP}/delivery/audit`,
      rollup: `${ROOTS.APP}/delivery/rollup`,
    },
    cashier: {
      shifts: `${ROOTS.APP}/cashier/shifts`,
      shiftDetail: (id: string) => `${ROOTS.APP}/cashier/shifts/${id}`,
      businessDays: `${ROOTS.APP}/cashier/business-days`,
      rollup: `${ROOTS.APP}/cashier/rollup`,
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
      stock: `${ROOTS.APP}/catalog/stock`,
      stopReport: `${ROOTS.APP}/catalog/availability/report`,
      importExport: `${ROOTS.APP}/catalog/import-export`,
    },
    pricing: {
      priceLists: `${ROOTS.APP}/pricing/price-lists`,
      changes: `${ROOTS.APP}/pricing/changes`,
      snappfood: `${ROOTS.APP}/pricing/snappfood`,
    },
    discounts: {
      customerRates: `${ROOTS.APP}/discounts/customer-rates`,
      coupons: `${ROOTS.APP}/discounts/coupons`,
      wallet: `${ROOTS.APP}/discounts/wallet`,
    },
    operations: {
      branches: `${ROOTS.APP}/operations/branches`,
      branchDetail: (id: string) => `${ROOTS.APP}/operations/branches/${id}`,
      terminals: `${ROOTS.APP}/operations/terminals`,
      kdsConfiguration: `${ROOTS.APP}/operations/kds-configuration`,
      printers: `${ROOTS.APP}/operations/printers`,
      printQueue: `${ROOTS.APP}/operations/print-queue`,
      monitoring: `${ROOTS.APP}/operations/monitoring`,
      agents: `${ROOTS.APP}/operations/agents`,
    },
    simulation: {
      root: `${ROOTS.APP}/simulation`,
      snappfood: `${ROOTS.APP}/simulation/snappfood`,
      paymentsPrinters: `${ROOTS.APP}/simulation/payments-printers`,
      logs: `${ROOTS.APP}/simulation/logs`,
    },
    reports: {
      root: `${ROOTS.APP}/reports`,
      code: (code: string) => `${ROOTS.APP}/reports/${code}`,
    },
    audit: `${ROOTS.APP}/audit`,
    moadian: `${ROOTS.APP}/moadian`,
    customerClub: {
      discounts: `${ROOTS.APP}/discounts/customer-rates`,
      wallet: `${ROOTS.APP}/discounts/wallet`,
    },
    settings: {
      root: `${ROOTS.APP}/settings`,
      users: `${ROOTS.APP}/settings/users`,
      userDetail: (id: string) => `${ROOTS.APP}/settings/users/${id}`,
      general: `${ROOTS.APP}/settings/general`,
      orderWorkflow: `${ROOTS.APP}/settings/order-workflow`,
      shiftPolicy: `${ROOTS.APP}/settings/shift-policy`,
      businessDay: `${ROOTS.APP}/settings/business-day`,
      courierPay: `${ROOTS.APP}/settings/courier-pay`,
      calendar: `${ROOTS.APP}/settings/calendar`,
      branchOverrides: `${ROOTS.APP}/settings/branch-overrides`,
      roles: `${ROOTS.APP}/settings/roles`,
      discountAuthorizations: `${ROOTS.APP}/settings/discount-authorizations`,
      paymentsRefunds: `${ROOTS.APP}/settings/payments-refunds`,
      approvals: `${ROOTS.APP}/settings/approvals`,
      reasons: `${ROOTS.APP}/settings/reasons`,
      noteTemplates: `${ROOTS.APP}/settings/note-templates`,
      localization: `${ROOTS.APP}/settings/localization`,
      dataReset: `${ROOTS.APP}/settings/data-reset`,
    },
  },
};

