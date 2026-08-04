import type { NavSectionProps } from 'src/components/nav-section';
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
    subheader: 'Overview',
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
    subheader: 'POS & Orders',
    items: [
      {
        title: 'POS Register',
        path: '/app/pos/order',
        icon: ICONS.pos,
        info: <Label color="success">NEW</Label>,
      },
      {
        title: 'Active KDS Orders',
        path: '/app/operations/orders',
        icon: ICONS.kds,
      },
    ],
  },
  {
    subheader: 'Operations & Stock',
    items: [
      {
        title: 'Inventory Stock & Alerts',
        path: '/app/inventory/stock',
        icon: ICONS.inventory,
      },
      {
        title: 'Cash Drawer & EOD',
        path: '/app/operations/cash-drawer',
        icon: ICONS.drawer,
      },
      {
        title: 'Branches & Hours',
        path: '/app/operations/branches',
        icon: ICONS.store,
      },
      {
        title: 'Terminals Registry',
        path: '/app/operations/terminals',
        icon: ICONS.terminal,
      },
    ],
  },
  {
    subheader: 'Master Catalog',
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
        title: 'Modifier Options',
        path: '/app/catalog/options',
        icon: ICONS.options,
      },
      {
        title: 'Pricing & Overrides',
        path: '/app/catalog/pricing',
        icon: ICONS.pricing,
      },
    ],
  },
  {
    subheader: 'Discounts & Marketing',
    items: [
      {
        title: 'Discount Rules',
        path: '/app/discounts/rules',
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
    subheader: 'CRM & Credit Accounts',
    items: [
      {
        title: 'Customer Directory',
        path: '/app/customers',
        icon: ICONS.customers,
      },
      {
        title: 'Credit Accounts & Aging',
        path: '/app/customers/credit',
        icon: ICONS.credit,
        info: <Label color="success">LEDGER</Label>,
      },
      {
        title: 'Customer Groups',
        path: '/app/customers/groups',
        icon: ICONS.customerGroups,
      },
    ],
  },
  {
    subheader: 'Settings & Tools',
    items: [
      {
        title: 'General Settings',
        path: '/app/settings/general',
        icon: ICONS.settings,
      },
      {
        title: 'Reason Codes',
        path: '/app/settings/reasons',
        icon: ICONS.reasons,
      },
      {
        title: 'Media & Localization',
        path: '/app/simulation/media-localization',
        icon: ICONS.media,
      },
    ],
  },
];
