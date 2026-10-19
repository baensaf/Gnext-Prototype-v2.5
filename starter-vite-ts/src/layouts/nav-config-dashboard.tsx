import type { NavSectionProps, NavItemDataProps } from 'src/components/nav-section';

import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';

import { agentMode } from 'src/utils/agent-mode';

import { CONFIG } from 'src/global-config';
import { pageLabel } from 'src/config/version-labels';
import { useWorkspaceScope } from 'src/contexts/branch-context';
import { canReachPath, fitsWorkspace } from 'src/config/role-access';
import { useAuthStore, useIsHeadOffice } from 'src/store/useAuthStore';

import { Label } from 'src/components/label';
import { SvgColor } from 'src/components/svg-color';
import { VersionTag, useVersionLabels } from 'src/components/version-tag';

const icon = (name: string) => (
  <SvgColor src={`${CONFIG.assetsDir}/assets/icons/navbar/${name}.svg`} />
);

const ICONS = {
  dashboard: icon('ic-dashboard'),
  pos: icon('ic-cart'),
  terminal: icon('ic-booking'),
  drawer: icon('ic-invoice'),
  inventory: icon('ic-analytics'),
  catalog: icon('ic-product'),
  category: icon('ic-folder'),
  options: icon('ic-params'),
  pricing: icon('ic-invoice'),
  discounts: icon('ic-label'),
  // The MUI MoveToInbox shape, as the header's Incoming Orders button draws it.
  inbox: icon('ic-inbox'),
  customers: icon('ic-user'),
  credit: icon('ic-banking'),
  settings: icon('ic-params'),
  reasons: icon('ic-lock'),
  media: icon('ic-file'),
  external: icon('ic-external'),
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
  const showVersions = useVersionLabels((s) => s.show);

  // A page that ships after V1 carries its Phase 1 version beside its menu entry, after any
  // badge it already has. Groups are left alone: their entries carry their own.
  const withVersion = (item: NavItemDataProps): NavItemDataProps => {
    const value = showVersions && !item.children ? pageLabel(item.path) : undefined;
    if (!value || value === 'V1' || Array.isArray(item.info)) return item;
    const tag = <VersionTag label={value} />;
    const info = item.info ? (
      <Box component="span" sx={{ display: 'inline-flex', gap: 0.5 }}>
        {item.info}
        {tag}
      </Box>
    ) : (
      tag
    );
    return { ...item, info };
  };

  const sections: NavSectionProps['data'] = [
    {
      subheader: t('nav.liveOperations', 'Live Operations'),
      items: [
        // Managers and admins land here and there was no way back to it once you left.
        // A cashier cannot open it, so the role filter below drops it for them.
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
          title: t('nav.incomingOrders', 'Incoming Orders'),
          path: '/app/orders/incoming',
          // No count here: the header's Incoming Orders icon carries it, on every screen size.
          // Same inbox tray as that header button, so the shortcut and the page match.
          icon: ICONS.inbox,
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
          title: t('nav.orders', 'Orders'),
          path: '/app/orders',
          icon: ICONS.inventory,
        },
        // Pages that existed with no way in but the address bar.
        {
          title: t('nav.payments', 'Payments'),
          path: '/app/payments',
          icon: ICONS.credit,
        },
        // The shop's own printers jamming mid-service — live work, not a report.
        {
          title: t('nav.printQueue', 'Print Queue'),
          path: '/app/operations/print-queue',
          icon: ICONS.media,
        },
        // The branch agent: status, printers, card terminals, this PC and its logs. In the selling
        // window too, where the agent's own page used to be (2026-10-19).
        {
          title: t('nav.branchAgent', 'Branch agent'),
          path: '/app/operations/agents',
          icon: ICONS.terminal,
        },
      ],
    },
    {
      subheader: t('nav.businessManagement', 'Business Management'),
      items: [
        {
          title: t('nav.catalogSubmenu', 'Catalog'),
          path: '/app/catalog/products',
          icon: ICONS.catalog,
          children: [
            {
              title: t('nav.products', 'Products Catalog'),
              path: '/app/catalog/products',
            },
            {
              title: t('nav.categories', 'Categories'),
              path: '/app/catalog/categories',
            },
            {
              title: t('nav.availability', 'Availability & Suspensions'),
              path: '/app/catalog/availability',
            },
            // Import & Export is a button on Products Catalog, not a sidebar entry.
          ],
        },
        // One drawer entry for everything that sets what an item costs.
        {
          title: t('nav.pricesGroup', 'Prices'),
          path: '/app/pricing/price-lists',
          icon: ICONS.pricing,
          children: [
            {
              title: t('nav.pricing', 'Price Lists'),
              path: '/app/pricing/price-lists',
            },
            {
              title: t('nav.priceChanges', 'Price Changes'),
              path: '/app/pricing/changes',
            },
            {
              title: t('nav.snappfoodPrices', 'Snappfood Prices'),
              path: '/app/pricing/snappfood',
            },
            {
              title: t('nav.itemDiscounts', 'Item Discounts'),
              path: '/app/pricing/item-discounts',
            },
          ],
        },
        // One place for the customer: the list (with their groups, wallet and credit
        // on each row, and the credit actions in the row's dialog), and the wallets with the
        // cashback rule.
        {
          title: t('nav.customersGroup', 'Customers'),
          path: '/app/customers',
          icon: ICONS.customers,
          children: [
            {
              title: t('nav.customers', 'Customer Directory'),
              path: '/app/customers',
            },
            {
              title: t('nav.customerGroups', 'Customer groups'),
              path: '/app/customers/groups',
            },
            {
              title: t('nav.customerWallet', 'Wallet & Cashback'),
              path: '/app/wallet',
            },
            {
              title: t('nav.coupons', 'Coupons'),
              path: '/app/coupons',
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
          // The reports live behind the picker inside the viewer, so the index is the entry
          // that makes them findable. Sales summary is the one people open by name, daily.
          children: [
            {
              title: t('nav.reportsAll', 'All Reports'),
              path: '/app/reports',
            },
            {
              title: t('nav.reportsSalesSummary', 'Sales Summary'),
              path: '/app/reports/sales-summary',
            },
          ],
        },
      ],
    },
    // One door. Users, roles and branch agents are links on the Settings page, which a
    // second set of sidebar entries only duplicated.
    {
      subheader: t('nav.settingsGroup', 'Settings'),
      items: [
        {
          title: t('nav.settingsHub', 'Settings'),
          path: '/app/settings',
          icon: ICONS.settings,
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
              title: t('nav.logsSim', 'Integration Audit Logs'),
              path: '/app/simulation/logs',
            },
            // A demo of uploading media and editing translations, not a setting anyone keeps.
            {
              title: t('nav.mediaLocalizationSim', 'Media & translations demo'),
              path: '/app/simulation/media-localization',
            },
          ],
        },
      ],
    },
  ];

  const nav = sections
    .map((section) => ({
      ...section,
      items: section.items
        .map((item) => {
          // An open parent can still have a child the role may not open — chain reports
          // sit under the same menu as the branch's own.
          if (!item.children) return visible(item.path) ? withVersion(item) : null;

          const children = item.children.filter((child) => visible(child.path));
          if (!children.length) {
            return visible(item.path) ? withVersion({ ...item, children: undefined }) : null;
          }
          // One survivor is not a menu. A cashier's shifts group is left holding a single
          // entry once Business Days goes, and a disclosure triangle that reveals one link
          // costs a click and buys nothing — so it becomes that link, under its own name.
          if (children.length === 1) {
            return withVersion({ ...item, children: undefined, title: children[0].title, path: children[0].path });
          }
          // A group survives on its children. When its heading is head office's, a branch
          // manager still needs the entries they can open underneath it (Availability under
          // Catalog) — judging the group by its heading alone would take the whole menu away.
          return {
            ...item,
            children: children.map(withVersion),
            path: visible(item.path) ? item.path : children[0].path,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    }))
    .filter((section) => section.items.length > 0);

  if (!agentMode) return nav;

  // On a branch agent the menu above is already cut down to the cashier's pages (canReachPath).
  // Everything else lives on the cloud, so one link there closes it.
  return [
    ...nav,
    {
      items: [
        {
          title: t('agent.nav.openGnext', 'Open Gnext'),
          // An absolute address: the nav opens it in a new tab.
          path: agentMode.cloud_url,
          icon: ICONS.external,
        },
      ],
    },
  ];
}

