import type { NavSectionProps } from 'src/components/nav-section';

import { useTranslation } from 'react-i18next';

import { CONFIG } from 'src/global-config';

import { Label } from 'src/components/label';
import { SvgColor } from 'src/components/svg-color';

const icon = (name: string) => (
  <SvgColor src={`${CONFIG.assetsDir}/assets/icons/navbar/${name}.svg`} />
);

const ICONS = {
  dashboard: icon('ic-dashboard'),
  pos: icon('ic-cart'),
  kds: icon('ic-kanban'),
  store: icon('ic-banking'),
  terminal: icon('ic-booking'),
  drawer: icon('ic-invoice'),
  inventory: icon('ic-analytics'),
  catalog: icon('ic-product'),
  category: icon('ic-folder'),
  options: icon('ic-params'),
  pricing: icon('ic-invoice'),
  discounts: icon('ic-label'),
  coupons: icon('ic-order'),
  customers: icon('ic-user'),
  credit: icon('ic-banking'),
  customerGroups: icon('ic-job'),
  settings: icon('ic-params'),
  reasons: icon('ic-lock'),
  media: icon('ic-file'),
};

export const navData: NavSectionProps['data'] = [
  {
    subheader: 'Home',
    items: [
      {
        title: 'Dashboard',
        path: '/app/dashboard',
        icon: ICONS.dashboard,
        info: <Label color="warning">v1.5</Label>,
      },
    ],
  },
  {
    subheader: 'Sell',
    items: [
      {
        title: 'POS Register',
        path: '/app/pos',
        icon: ICONS.pos,
        info: <Label color="success">POS</Label>,
      },
      {
        title: 'Dine-In Floor',
        path: '/app/dine-in/floor',
        icon: ICONS.pos,
      },
      {
        title: 'Orders Directory',
        path: '/app/orders',
        icon: ICONS.kds,
      },
      {
        title: 'Self-Service Kiosk',
        path: '/app/kiosk',
        icon: ICONS.pos,
      },
    ],
  },
  {
    subheader: 'Operations',
    items: [
      {
        title: 'Kitchen KDS',
        path: '/app/kds',
        icon: ICONS.kds,
      },
      {
        title: 'Delivery Orders',
        path: '/app/delivery/orders',
        icon: ICONS.kds,
      },
      {
        title: 'Couriers Roster',
        path: '/app/delivery/couriers',
        icon: ICONS.customers,
      },
      {
        title: 'Courier Settlements',
        path: '/app/delivery/settlements',
        icon: ICONS.reasons,
      },
      {
        title: 'Cashier Shifts',
        path: '/app/cashier/shifts',
        icon: ICONS.drawer,
      },
      {
        title: 'Business Days',
        path: '/app/cashier/business-days',
        icon: ICONS.drawer,
      },
      {
        title: 'Payment Transactions',
        path: '/app/payments',
        icon: ICONS.credit,
      },
      {
        title: 'Refunds & Returns',
        path: '/app/refunds',
        icon: ICONS.reasons,
      },
      {
        title: 'KDS Configuration',
        path: '/app/operations/kds-configuration',
        icon: ICONS.kds,
      },
      {
        title: 'Printers & Routes',
        path: '/app/operations/printers',
        icon: ICONS.terminal,
      },
      {
        title: 'Print Queue',
        path: '/app/operations/print-queue',
        icon: ICONS.drawer,
      },
      {
        title: 'System Monitoring',
        path: '/app/operations/monitoring',
        icon: ICONS.dashboard,
      },
    ],
  },
  {
    subheader: 'Customers',
    items: [
      {
        title: 'Customer Directory',
        path: '/app/customers',
        icon: ICONS.customers,
      },
      {
        title: 'Credit Accounts & Aging',
        path: '/app/credit/accounts',
        icon: ICONS.credit,
      },
    ],
  },
  {
    subheader: 'Catalog & Pricing',
    items: [
      {
        title: 'Categories',
        path: '/app/catalog/categories',
        icon: ICONS.category,
      },
      {
        title: 'Products Catalog',
        path: '/app/catalog/products',
        icon: ICONS.catalog,
      },
      {
        title: 'Modifiers',
        path: '/app/catalog/modifiers',
        icon: ICONS.options,
      },
      {
        title: 'Menus Composer',
        path: '/app/catalog/menus',
        icon: ICONS.catalog,
      },
      {
        title: 'Availability & Suspensions',
        path: '/app/catalog/availability',
        icon: ICONS.options,
      },
      {
        title: 'Import & Export',
        path: '/app/catalog/import-export',
        icon: ICONS.media,
      },
      {
        title: 'Price Book',
        path: '/app/pricing/price-book',
        icon: ICONS.pricing,
      },
      {
        title: 'Price Groups',
        path: '/app/pricing/price-groups',
        icon: ICONS.pricing,
      },
      {
        title: 'Bulk Price Update',
        path: '/app/pricing/bulk-update',
        icon: ICONS.pricing,
      },
    ],
  },
  {
    subheader: 'Discounts & Credit',
    items: [
      {
        title: 'Discount Campaigns',
        path: '/app/discounts/campaigns',
        icon: ICONS.discounts,
      },
      {
        title: 'Coupons Studio',
        path: '/app/discounts/coupons',
        icon: ICONS.coupons,
      },
    ],
  },
  {
    subheader: 'Reports',
    items: [
      {
        title: 'Reports & Analytics',
        path: '/app/reports/sales-summary',
        icon: ICONS.dashboard,
      },
    ],
  },
  {
    subheader: 'Simulation Center',
    items: [
      {
        title: 'Simulation Hub',
        path: '/app/simulation',
        icon: ICONS.terminal,
      },
      {
        title: 'Snappfood Simulator',
        path: '/app/simulation/snappfood',
        icon: ICONS.terminal,
      },
      {
        title: 'Payments & Printers',
        path: '/app/simulation/payments-printers',
        icon: ICONS.terminal,
      },
      {
        title: 'Offline Sync Simulation',
        path: '/app/simulation/offline-sync',
        icon: ICONS.terminal,
      },
      {
        title: 'Integration Logs',
        path: '/app/simulation/logs',
        icon: ICONS.drawer,
      },
    ],
  },
  {
    subheader: 'Audit',
    items: [
      {
        title: 'Audit Explorer',
        path: '/app/audit',
        icon: ICONS.reasons,
      },
    ],
  },
  {
    subheader: 'Settings',
    items: [
      {
        title: 'General Settings',
        path: '/app/settings/general',
        icon: ICONS.settings,
      },
      {
        title: 'Order Workflow',
        path: '/app/settings/order-workflow',
        icon: ICONS.settings,
      },
      {
        title: 'Discounts & Credit',
        path: '/app/settings/discounts-credit',
        icon: ICONS.settings,
      },
      {
        title: 'Payments & Refunds',
        path: '/app/settings/payments-refunds',
        icon: ICONS.settings,
      },
      {
        title: 'Approvals & Profiles',
        path: '/app/settings/approvals',
        icon: ICONS.settings,
      },
      {
        title: 'Reason Codes',
        path: '/app/settings/reasons',
        icon: ICONS.settings,
      },
      {
        title: 'Localization & Formats',
        path: '/app/settings/localization',
        icon: ICONS.settings,
      },
      {
        title: 'Data Reset',
        path: '/app/settings/data-reset',
        icon: ICONS.settings,
      },
    ],
  },
  {
    subheader: 'Future — V5 Preview',
    items: [
      {
        title: 'Inventory Stock & Movement',
        path: '/app/inventory/stock',
        icon: ICONS.inventory,
        info: <Label color="info">V5 Preview</Label>,
      },
    ],
  },
];

export function useNavData(): NavSectionProps['data'] {
  const { t } = useTranslation();

  return [
    {
      subheader: t('nav.home', 'Home'),
      items: [
        {
          title: t('nav.dashboard', 'Dashboard'),
          path: '/app/dashboard',
          icon: ICONS.dashboard,
          info: <Label color="warning">v1.5</Label>,
        },
      ],
    },
    {
      subheader: t('nav.sell', 'Sell'),
      items: [
        {
          title: t('nav.pos', 'POS Register'),
          path: '/app/pos',
          icon: ICONS.pos,
          info: <Label color="success">POS</Label>,
        },
        {
          title: t('nav.dineIn', 'Dine-In Floor'),
          path: '/app/dine-in/floor',
          icon: ICONS.pos,
        },
        {
          title: t('nav.orders', 'Orders Directory'),
          path: '/app/orders',
          icon: ICONS.kds,
        },
        {
          title: t('nav.kiosk', 'Self-Service Kiosk'),
          path: '/app/kiosk',
          icon: ICONS.pos,
        },
      ],
    },
    {
      subheader: t('nav.operations', 'Operations'),
      items: [
        {
          title: t('nav.kds', 'Kitchen KDS'),
          path: '/app/kds',
          icon: ICONS.kds,
        },
        {
          title: t('nav.delivery', 'Delivery Orders'),
          path: '/app/delivery/orders',
          icon: ICONS.kds,
        },
        {
          title: t('nav.couriers', 'Couriers Roster'),
          path: '/app/delivery/couriers',
          icon: ICONS.customers,
        },
        {
          title: t('nav.courierSettlements', 'Courier Settlements'),
          path: '/app/delivery/settlements',
          icon: ICONS.reasons,
        },
        {
          title: t('nav.cashier', 'Cashier Shifts'),
          path: '/app/cashier/shifts',
          icon: ICONS.drawer,
        },
        {
          title: t('nav.businessDays', 'Business Days'),
          path: '/app/cashier/business-days',
          icon: ICONS.drawer,
        },
        {
          title: t('nav.payments', 'Payment Transactions'),
          path: '/app/payments',
          icon: ICONS.credit,
        },
        {
          title: t('nav.refunds', 'Refunds & Returns'),
          path: '/app/refunds',
          icon: ICONS.reasons,
        },
        {
          title: t('nav.kdsConfig', 'KDS Configuration'),
          path: '/app/operations/kds-configuration',
          icon: ICONS.kds,
        },
        {
          title: t('nav.printers', 'Printers & Routes'),
          path: '/app/operations/printers',
          icon: ICONS.terminal,
        },
        {
          title: t('nav.printQueue', 'Print Queue'),
          path: '/app/operations/print-queue',
          icon: ICONS.drawer,
        },
        {
          title: t('nav.monitoring', 'System Monitoring'),
          path: '/app/operations/monitoring',
          icon: ICONS.dashboard,
        },
      ],
    },
    {
      subheader: t('nav.customersGroup', 'Customers'),
      items: [
        {
          title: t('nav.customers', 'Customer Directory'),
          path: '/app/customers',
          icon: ICONS.customers,
        },
        {
          title: t('nav.credit', 'Credit Accounts & Aging'),
          path: '/app/credit/accounts',
          icon: ICONS.credit,
        },
      ],
    },
    {
      subheader: t('nav.catalogGroup', 'Catalog & Pricing'),
      items: [
        {
          title: t('nav.categories', 'Categories'),
          path: '/app/catalog/categories',
          icon: ICONS.category,
        },
        {
          title: t('nav.products', 'Products Catalog'),
          path: '/app/catalog/products',
          icon: ICONS.catalog,
        },
        {
          title: t('nav.modifiers', 'Modifiers'),
          path: '/app/catalog/modifiers',
          icon: ICONS.options,
        },
        {
          title: t('nav.menus', 'Menus Composer'),
          path: '/app/catalog/menus',
          icon: ICONS.catalog,
        },
        {
          title: t('nav.availability', 'Availability & Suspensions'),
          path: '/app/catalog/availability',
          icon: ICONS.options,
        },
        {
          title: t('nav.importExport', 'Import & Export'),
          path: '/app/catalog/import-export',
          icon: ICONS.media,
        },
        {
          title: t('nav.pricing', 'Price Book'),
          path: '/app/pricing/price-book',
          icon: ICONS.pricing,
        },
        {
          title: t('nav.priceGroups', 'Price Groups'),
          path: '/app/pricing/price-groups',
          icon: ICONS.pricing,
        },
        {
          title: t('nav.bulkUpdate', 'Bulk Price Update'),
          path: '/app/pricing/bulk-update',
          icon: ICONS.pricing,
        },
      ],
    },
    {
      subheader: t('nav.discountsGroup', 'Discounts & Credit'),
      items: [
        {
          title: t('nav.discounts', 'Discount Campaigns'),
          path: '/app/discounts/campaigns',
          icon: ICONS.discounts,
        },
        {
          title: t('nav.coupons', 'Coupons Studio'),
          path: '/app/discounts/coupons',
          icon: ICONS.coupons,
        },
      ],
    },
    {
      subheader: t('nav.reportsGroup', 'Reports'),
      items: [
        {
          title: t('nav.reports', 'Reports & Analytics'),
          path: '/app/reports/sales-summary',
          icon: ICONS.dashboard,
        },
      ],
    },
    {
      subheader: t('nav.simulationGroup', 'Simulation Center'),
      items: [
        {
          title: t('nav.simulation', 'Simulation Hub'),
          path: '/app/simulation',
          icon: ICONS.terminal,
        },
        {
          title: t('nav.snappfoodSim', 'Snappfood Simulator'),
          path: '/app/simulation/snappfood',
          icon: ICONS.terminal,
        },
        {
          title: t('nav.hardwareSim', 'Payments & Printers'),
          path: '/app/simulation/payments-printers',
          icon: ICONS.terminal,
        },
        {
          title: t('nav.syncSim', 'Offline Sync Simulation'),
          path: '/app/simulation/offline-sync',
          icon: ICONS.terminal,
        },
        {
          title: t('nav.logsSim', 'Integration Logs'),
          path: '/app/simulation/logs',
          icon: ICONS.drawer,
        },
      ],
    },
    {
      subheader: t('nav.auditGroup', 'Audit'),
      items: [
        {
          title: t('nav.audit', 'Audit Explorer'),
          path: '/app/audit',
          icon: ICONS.reasons,
        },
      ],
    },
    {
      subheader: t('nav.settingsGroup', 'Settings'),
      items: [
        {
          title: t('nav.settings', 'General Settings'),
          path: '/app/settings/general',
          icon: ICONS.settings,
        },
        {
          title: t('nav.orderWorkflow', 'Order Workflow'),
          path: '/app/settings/order-workflow',
          icon: ICONS.settings,
        },
        {
          title: t('nav.discountsCreditSettings', 'Discounts & Credit'),
          path: '/app/settings/discounts-credit',
          icon: ICONS.settings,
        },
        {
          title: t('nav.paymentsRefundsSettings', 'Payments & Refunds'),
          path: '/app/settings/payments-refunds',
          icon: ICONS.settings,
        },
        {
          title: t('nav.approvals', 'Approvals & Profiles'),
          path: '/app/settings/approvals',
          icon: ICONS.settings,
        },
        {
          title: t('nav.reasons', 'Reason Codes'),
          path: '/app/settings/reasons',
          icon: ICONS.settings,
        },
        {
          title: t('nav.localization', 'Localization & Formats'),
          path: '/app/settings/localization',
          icon: ICONS.settings,
        },
        {
          title: t('nav.dataReset', 'Data Reset'),
          path: '/app/settings/data-reset',
          icon: ICONS.settings,
        },
      ],
    },
    {
      subheader: t('nav.v5GroupHeader', 'Future — V5 Preview'),
      items: [
        {
          title: t('nav.v5Preview', 'Inventory Stock & Movement'),
          path: '/app/inventory/stock',
          icon: ICONS.inventory,
          info: <Label color="info">V5 Preview</Label>,
        },
      ],
    },
  ];
}
