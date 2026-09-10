import type { NavSectionProps } from 'src/components/nav-section';

import { useTranslation } from 'react-i18next';

import { CONFIG } from 'src/global-config';
import { useWorkspaceScope } from 'src/contexts/branch-context';
import { canReachPath, fitsWorkspace } from 'src/config/role-access';
import { useAuthStore, useIsHeadOffice } from 'src/store/useAuthStore';

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
  const role = useAuthStore((state) => state.user?.role);
  // Two separate filters. The account's reach decides what it may open at all — an admin
  // pinned to a branch never gets the chain's screens, whatever the switcher says. The
  // header's scope then decides what belongs on the menu right now: at head office the
  // chain's work, inside a branch that branch's.
  const isHeadOffice = useIsHeadOffice();
  const workspace = useWorkspaceScope();
  const visible = (path: string) =>
    canReachPath(role, path, isHeadOffice) && fitsWorkspace(path, workspace);

  const sections: NavSectionProps['data'] = [
    {
      subheader: t('nav.liveOperations', 'Live Operations'),
      items: [
        // Two roles land here and there was no way back to it once you left.
        {
          title: t('nav.dashboard', 'Dashboard'),
          path: '/app/dashboard',
          icon: ICONS.dashboard,
        },
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
          children: [
            {
              title: t('nav.cashierShifts', 'Shifts & Drawer'),
              path: '/app/cashier/shifts',
            },
            {
              title: t('nav.businessDays', 'Business Days'),
              path: '/app/cashier/business-days',
            },
          ],
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
        // Pages that existed with no way in but the address bar.
        {
          title: t('nav.payments', 'Payments'),
          path: '/app/payments',
          icon: ICONS.credit,
        },
        {
          title: t('nav.refunds', 'Refunds'),
          path: '/app/refunds',
          icon: ICONS.coupons,
        },
      ],
    },
    {
      subheader: t('nav.businessManagement', 'Business Management'),
      items: [
        {
          title: t('nav.catalogSubmenu', 'Catalog'),
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
          path: '/app/reports',
          icon: ICONS.dashboard,
          // Twenty-five reports live behind the picker inside the viewer, so the index is
          // the entry that makes them findable. The two named below are the ones people
          // open by name — sales summary daily, the chain roll-up by an area manager.
          children: [
            {
              title: t('nav.reportsAll', 'All Reports'),
              path: '/app/reports',
            },
            {
              title: t('nav.reportsSalesSummary', 'Sales Summary'),
              path: '/app/reports/sales-summary',
            },
            {
              title: t('nav.reportsBranchComparison', 'Branch Comparison'),
              path: '/app/reports/branch-comparison',
            },
          ],
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
        // Head office reads the branches; the branches run themselves. These two are the
        // read-only halves of screens that stay operational at the shop — a fleet you can
        // see but not dispatch, tills you can see but not close.
        {
          title: t('nav.fleetRollup', 'Fleet Across Branches'),
          path: '/app/delivery/rollup',
          icon: ICONS.terminal,
        },
        {
          title: t('nav.shiftRollup', 'Shifts Across Branches'),
          path: '/app/cashier/rollup',
          icon: ICONS.drawer,
        },
        {
          title: t('nav.printQueue', 'Print Queue'),
          path: '/app/operations/print-queue',
          icon: ICONS.media,
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
        {
          title: t('nav.users', 'Users & Roles'),
          path: '/app/settings/users',
          icon: ICONS.customers,
        },
      ],
    },
    {
      subheader: t('nav.demoSandbox', 'Simulation Sandbox'),
      items: [
        {
          title: t('nav.simulationHub', 'Simulation Hub'),
          path: '/app/simulation',
          icon: ICONS.terminal,
          children: [
            {
              title: t('nav.simulationOverview', 'Overview & Sandbox Hub'),
              path: '/app/simulation',
            },
            {
              title: t('nav.snappfoodSim', 'Snappfood Simulator (v4.3.0)'),
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
              title: t('nav.logsSim', 'Integration Audit Logs'),
              path: '/app/simulation/logs',
            },
          ],
        },
      ],
    },
  ];

  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .map((item) => {
          // An open parent can still have a child the role may not open — chain reports
          // sit under the same menu as the branch's own.
          if (!item.children) return visible(item.path) ? item : null;

          const children = item.children.filter((child) => visible(child.path));
          if (!children.length) {
            return visible(item.path) ? { ...item, children: undefined } : null;
          }
          // One survivor is not a menu. A cashier's shifts group is left holding a single
          // entry once Business Days goes, and a disclosure triangle that reveals one link
          // costs a click and buys nothing — so it becomes that link, under its own name.
          if (children.length === 1) {
            return { ...item, children: undefined, title: children[0].title, path: children[0].path };
          }
          // A group survives on its children. Catalog is headed by Menus, which is head
          // office's, but a branch manager still needs the Availability entry underneath
          // it — judging the group by its heading alone would take the whole menu away.
          return {
            ...item,
            children,
            path: visible(item.path) ? item.path : children[0].path,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    }))
    .filter((section) => section.items.length > 0);
}

