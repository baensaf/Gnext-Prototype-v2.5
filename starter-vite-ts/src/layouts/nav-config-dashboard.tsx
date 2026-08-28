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

export function useNavData(): NavSectionProps['data'] {
  const { t } = useTranslation();

  return [
    {
      subheader: t('nav.liveOperations', 'Live Operations'),
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
          icon: ICONS.store,
        },
        {
          title: t('nav.kds', 'Kitchen KDS'),
          path: '/app/kds',
          icon: ICONS.kds,
        },
        {
          title: t('nav.deliveryHub', 'Delivery & Fleet Hub'),
          path: '/app/delivery/orders',
          icon: ICONS.terminal,
        },
        {
          title: t('nav.cashier', 'Cashier & Shifts'),
          path: '/app/cashier/shifts',
          icon: ICONS.drawer,
        },
        {
          title: t('nav.orders', 'Orders Directory'),
          path: '/app/orders',
          icon: ICONS.inventory,
        },
        {
          title: t('nav.kiosk', 'Self-Service Kiosk'),
          path: '/app/kiosk',
          icon: ICONS.terminal,
        },
      ],
    },
    {
      subheader: t('nav.businessManagement', 'Business Management'),
      items: [
        {
          title: t('nav.catalogSubmenu', 'Catalog & Menus'),
          path: '/app/catalog/menus',
          icon: ICONS.catalog,
          children: [
            {
              title: t('nav.menus', 'Menus Composer'),
              path: '/app/catalog/menus',
            },
            {
              title: t('nav.products', 'Products Catalog'),
              path: '/app/catalog/products',
            },
            {
              title: t('nav.categories', 'Categories'),
              path: '/app/catalog/categories',
            },
            {
              title: t('nav.modifiers', 'Modifiers & Options'),
              path: '/app/catalog/modifiers',
            },
            {
              title: t('nav.availability', 'Availability & Suspensions'),
              path: '/app/catalog/availability',
            },
          ],
        },
        {
          title: t('nav.pricing', 'Price Book & Groups'),
          path: '/app/pricing/price-book',
          icon: ICONS.pricing,
        },
        {
          title: t('nav.customersCredit', 'Customers & Credit'),
          path: '/app/customers',
          icon: ICONS.customers,
          children: [
            {
              title: t('nav.customers', 'Customer Directory'),
              path: '/app/customers',
            },
            {
              title: t('nav.credit', 'Credit Accounts & Aging'),
              path: '/app/credit/accounts',
            },
          ],
        },
        {
          title: t('nav.discountsLoyalty', 'Discounts & Promotions Hub'),
          path: '/app/discounts/customer-rates',
          icon: ICONS.discounts,
          children: [
            {
              title: t('nav.customerDiscounts', 'Customer-Specific Rates'),
              path: '/app/discounts/customer-rates',
            },
            {
              title: t('nav.coupons', 'One-Time Coupons Studio'),
              path: '/app/discounts/coupons',
            },
            {
              title: t('nav.discountAuthorizations', 'Cashier Role Caps & Policy'),
              path: '/app/discounts/authorizations',
            },
            {
              title: t('nav.customerWallet', 'Wallet & Cashback'),
              path: '/app/discounts/wallet',
            },
          ],
        },
      ],
    },
    {
      subheader: t('nav.reportsAudit', 'Reports & Compliance'),
      items: [
        {
          title: t('nav.reports', 'Reports & Analytics'),
          path: '/app/reports/sales-summary',
          icon: ICONS.dashboard,
        },
        {
          title: t('nav.audit', 'Audit Explorer'),
          path: '/app/audit',
          icon: ICONS.reasons,
        },
        {
          title: t('nav.monitoring', 'Operational Monitoring'),
          path: '/app/operations/monitoring',
          icon: ICONS.dashboard,
        },
      ],
    },
    {
      subheader: t('nav.settingsGroup', 'Settings & System'),
      items: [
        {
          title: t('nav.settingsHub', 'Settings Hub'),
          path: '/app/settings',
          icon: ICONS.settings,
        },
      ],
    },
    {
      subheader: t('nav.demoSandbox', 'Simulation Sandbox'),
      items: [
        {
          title: t('nav.simulation', 'Simulation Hub'),
          path: '/app/simulation',
          icon: ICONS.terminal,
          children: [
            {
              title: t('nav.simulation', 'Overview & Mocks'),
              path: '/app/simulation',
            },
            {
              title: t('nav.snappfoodSim', 'Snappfood Simulator'),
              path: '/app/simulation/snappfood',
            },
            {
              title: t('nav.hardwareSim', 'Payments & Printers Mock'),
              path: '/app/simulation/payments-printers',
            },
            {
              title: t('nav.syncSim', 'Offline Sync Engine'),
              path: '/app/simulation/offline-sync',
            },
            {
              title: t('nav.logsSim', 'Integration Logs'),
              path: '/app/simulation/logs',
            },
          ],
        },
      ],
    },
  ];
}

