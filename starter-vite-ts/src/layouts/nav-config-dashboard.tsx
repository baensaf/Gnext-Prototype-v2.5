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
          info: <Label color="info">V4</Label>,
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
          info: <Label color="info">V4</Label>,
        },
        {
          title: t('nav.delivery', 'Delivery Management'),
          path: '/app/delivery/orders',
          icon: ICONS.kds,
        },
        {
          title: t('nav.courierSettlements', 'Courier Settlements'),
          path: '/app/delivery/settlements',
          icon: ICONS.reasons,
        },
        {
          title: t('nav.cashier', 'Cashier & Shifts'),
          path: '/app/cashier/shifts',
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
          title: t('nav.monitoring', 'Operational Monitoring'),
          path: '/app/operations/monitoring',
          icon: ICONS.dashboard,
        },
        {
          title: t('nav.printQueue', 'Print Queue'),
          path: '/app/operations/print-queue',
          icon: ICONS.drawer,
        },
      ],
    },
    {
      subheader: t('nav.customerClubGroup', 'Customer Club & Loyalty'),
      items: [
        {
          title: t('nav.customerDiscounts', 'Customer Discounts'),
          path: '/app/customer-club/discounts',
          icon: ICONS.discounts,
        },
        {
          title: t('nav.discounts', 'Discount Campaigns'),
          path: '/app/discounts/campaigns',
          icon: ICONS.discounts,
        },
        {
          title: t('nav.coupons', 'One-Time Coupons Studio'),
          path: '/app/discounts/coupons',
          icon: ICONS.coupons,
        },
        {
          title: t('nav.customerWallet', 'Wallet & Cashback'),
          path: '/app/customer-club/wallet',
          icon: ICONS.credit,
        },
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
          title: t('nav.pricing', 'Price Book & Groups'),
          path: '/app/pricing/price-book',
          icon: ICONS.pricing,
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
          title: t('nav.settingsHub', 'Settings Hub'),
          path: '/app/settings',
          icon: ICONS.settings,
        },
        {
          title: t('nav.discountAuthorizations', 'Manual Discount Authorizations'),
          path: '/app/settings/discount-authorizations',
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
      ],
    },
    {
      subheader: t('nav.v5GroupHeader', 'Future — V5 Preview'),
      items: [
        {
          title: t('nav.v5Preview', 'Inventory Stock & Movement'),
          path: '/app/inventory/stock',
          icon: ICONS.inventory,
          info: <Label color="warning">V5 Preview</Label>,
        },
      ],
    },
  ];
}
