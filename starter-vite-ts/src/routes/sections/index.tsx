import type { RouteObject } from 'react-router';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';

import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import AlertTitle from '@mui/material/AlertTitle';

import { paths } from 'src/routes/paths';
import { RequiresBranch } from 'src/routes/components/requires-branch';

import { useSessionRetry } from 'src/utils/use-session-retry';

import Page404 from 'src/pages/error/404';
import { LoginPage } from 'src/pages/login';
import { AppShell } from 'src/layouts/AppShell';
import { KioskPage } from 'src/pages/pos/kiosk';
import { KdsPage } from 'src/pages/operations/kds';
import { PosOrderPage } from 'src/pages/pos/order';
import { DashboardPage } from 'src/pages/dashboard';
import { ReceiptPage } from 'src/pages/pos/receipt';
import { UsersPage } from 'src/pages/settings/users';
import { useAuthStore } from 'src/store/useAuthStore';
import { RefundsPage } from 'src/pages/orders/refunds';
import { OptionsPage } from 'src/pages/catalog/options';
import { SettingsHubPage } from 'src/pages/settings/hub';
import { AgentsPage } from 'src/pages/operations/agents';
import { DailyStockPage } from 'src/pages/catalog/stock';
import { homePathForRole } from 'src/config/role-access';
import { ProductsPage } from 'src/pages/catalog/products';
import { DineInPage } from 'src/pages/operations/dine-in';
import { DataResetPage } from 'src/pages/tools/data-reset';
import { DiscountsHubPage } from 'src/pages/discounts/hub';
import { RolesMatrixPage } from 'src/pages/settings/roles';
import { EndShiftPage } from 'src/pages/cashier/end-shift';
import { BranchesPage } from 'src/pages/operations/branches';
import { DeliveryPage } from 'src/pages/operations/delivery';
import { PaymentsPage } from 'src/pages/operations/payments';
import { ReasonCodesPage } from 'src/pages/settings/reasons';
import { PrintersPage } from 'src/pages/operations/printers';
import { CategoriesPage } from 'src/pages/catalog/categories';
import { CustomersPage } from 'src/pages/customers/directory';
import { StopReportPage } from 'src/pages/catalog/stop-report';
import { PriceListsPage } from 'src/pages/catalog/price-lists';
import { TerminalsPage } from 'src/pages/operations/terminals';
import { OrdersWorkflowPage } from 'src/pages/orders/workflow';
import { IncomingOrdersPage } from 'src/pages/orders/incoming';
import { CustomerCreditPage } from 'src/pages/customers/credit';
import { ReportsIndexPage } from 'src/pages/reports/index-page';
import { BranchNewPage } from 'src/pages/operations/branch-new';
import { GeneralSettingsPage } from 'src/pages/settings/general';
import { ImportWizardPage } from 'src/pages/tools/import-wizard';
import { ShiftDetailPage } from 'src/pages/cashier/shift-detail';
import { MonitoringPage } from 'src/pages/operations/monitoring';
import { ShiftRollupPage } from 'src/pages/cashier/shift-rollup';
import { AvailabilityPage } from 'src/pages/catalog/availability';
import { CashDrawerPage } from 'src/pages/operations/cash-drawer';
import { PrintQueuePage } from 'src/pages/operations/print-queue';
/* Detail & Simulation Sub-Pages */
import { PaymentSettingsPage } from 'src/pages/settings/payments';
import { UserProfilePage } from 'src/pages/settings/user-profile';
import { PriceChangesPage } from 'src/pages/catalog/price-changes';
import { BusinessDaysPage } from 'src/pages/cashier/business-days';
import { ReportViewerPage } from 'src/pages/reports/report-viewer';
import { CalendarSettingsPage } from 'src/pages/settings/calendar';
import { FleetRollupPage } from 'src/pages/operations/fleet-rollup';
import { ItemDiscountsPage } from 'src/pages/catalog/item-discounts';
import { ChannelPricesPage } from 'src/pages/catalog/channel-prices';
import { ApprovalsSettingsPage } from 'src/pages/settings/approvals';
import { ProductDetailPage } from 'src/pages/catalog/product-detail';
import { NoteTemplatesPage } from 'src/pages/settings/note-templates';
import { BranchDetailPage } from 'src/pages/operations/branch-detail';
import { CardTerminalsPage } from 'src/pages/operations/card-terminals';
import { AuditExplorerPage } from 'src/pages/operations/audit-explorer';
import { CourierDetailPage } from 'src/pages/operations/courier-detail';
import { MoadianInvoicesPage } from 'src/pages/moadian/moadian-invoices';
import { SimulationLogsPage } from 'src/pages/simulation/simulation-logs';
import { BranchOverridesPage } from 'src/pages/settings/branch-overrides';
import { ShiftPolicySettingsPage } from 'src/pages/settings/shift-policy';
import { BusinessDaySettingsPage } from 'src/pages/settings/business-day';
import { CustomerProfilePage } from 'src/pages/customers/customer-profile';
import { IncomingOrdersProvider } from 'src/contexts/incoming-orders-context';
import { SimulationCenterPage } from 'src/pages/simulation/simulation-center';
import { KdsConfigurationPage } from 'src/pages/operations/kds-configuration';
import { SettlementDetailPage } from 'src/pages/operations/settlement-detail';
import { OrderWorkflowSettingsPage } from 'src/pages/settings/order-workflow';
import DiscountAuthorizationsPage from 'src/pages/settings/discount-authorizations';
import { MediaLocalizationDemoPage } from 'src/pages/simulation/media-localization';
import { SimulationSnappfoodPage } from 'src/pages/simulation/simulation-snappfood';
import { SimulationPaymentsPrintersPage } from 'src/pages/simulation/simulation-payments-printers';

import { ConnectingPage } from 'src/components/connecting-page';

/** True once `active` has been true for `ms`; false again as soon as it is not. */
function useAfter(active: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return undefined;
    }
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && elapsed;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, fetchMe, isInitialized, sessionUnknown } = useAuthStore();
  // Gnext out of reach when the page opened or reloaded, with a session in this tab: not signed
  // out, not known. Ask again until it answers (useSessionRetry) and say so meanwhile.
  useSessionRetry();

  useEffect(() => {
    if (!isInitialized && !sessionUnknown) {
      fetchMe();
    }
  }, [fetchMe, isInitialized, sessionUnknown]);

  // The first answer takes a while when Gnext is far or away (a branch agent holds a read for up
  // to 20 s): after a second, say what is going on rather than show an empty page.
  const slow = useAfter(!isInitialized, 1000);

  if (sessionUnknown || (!isInitialized && slow)) {
    return <ConnectingPage />;
  }

  if (!isInitialized) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

/** A cashier's day starts at the register, not at a management dashboard. */
function RoleHomeRedirect() {
  const role = useAuthStore((state) => state.user?.role);
  return <Navigate to={homePathForRole(role)} replace />;
}

/** An order used to have a page of its own; old links open it in the Orders drawer. */
function OrderRedirect() {
  const { id = '' } = useParams();
  return <Navigate to={paths.app.orders.detail(id)} replace />;
}

/** Who may run a kiosk: a manager or above. A cashier is turned away with a way out. */
const KIOSK_ROLES = ['MANAGER', 'OWNER', 'ADMIN', 'SUPER_ADMIN'];

/** The kiosk host's only screen: the kiosk, or a note and a way out for an account that cannot run it. */
function KioskHostPage() {
  const { t } = useTranslation();
  const role = useAuthStore((state) => state.user?.role);
  const logout = useAuthStore((state) => state.logout);

  if (KIOSK_ROLES.includes((role || '').toUpperCase())) {
    return (
      <RequiresBranch>
        <KioskPage />
      </RequiresBranch>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 640, mx: 'auto' }}>
      <Alert
        severity="warning"
        action={
          <Button color="inherit" size="small" onClick={() => logout()}>
            {t('auth.logout', 'Sign Out')}
          </Button>
        }
      >
        <AlertTitle>{t('access.deniedTitle', 'Not available for your role')}</AlertTitle>
        {t('access.deniedBody', 'This page belongs to another part of the organization. Your account does not have access to it.')}
      </Alert>
    </Box>
  );
}

export const routesSection: RouteObject[] = [
  {
    path: '/',
    element: <RoleHomeRedirect />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/app',
    element: (
      <ProtectedRoute>
        {/* Above the shell, so the sidebar's count and the header badge read the same queue. */}
        <IncomingOrdersProvider>
          <AppShell />
        </IncomingOrdersProvider>
      </ProtectedRoute>
    ),
    children: [
      /* --- Section 9.1 Exact Canonical Routes --- */
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'pos', element: <RequiresBranch><PosOrderPage /></RequiresBranch> },
      { path: 'orders', element: <OrdersWorkflowPage /> },
      { path: 'orders/incoming', element: <RequiresBranch><IncomingOrdersPage /></RequiresBranch> },
      { path: 'orders/:id', element: <OrderRedirect /> },
      { path: 'dine-in/floor', element: <RequiresBranch><DineInPage /></RequiresBranch> },
      { path: 'kds', element: <RequiresBranch><KdsPage /></RequiresBranch> },
      { path: 'delivery', element: <Navigate to="/app/delivery/orders" replace /> },
      { path: 'delivery/orders', element: <RequiresBranch rollup="/app/delivery/rollup"><DeliveryPage /></RequiresBranch> },
      { path: 'delivery/couriers', element: <RequiresBranch rollup="/app/delivery/rollup"><DeliveryPage /></RequiresBranch> },
      { path: 'delivery/couriers/:courierId', element: <CourierDetailPage /> },
      { path: 'delivery/settlements', element: <RequiresBranch rollup="/app/delivery/rollup"><DeliveryPage /></RequiresBranch> },
      { path: 'delivery/settlements/:settlementId', element: <SettlementDetailPage /> },
      { path: 'delivery/zones', element: <RequiresBranch rollup="/app/delivery/rollup"><DeliveryPage /></RequiresBranch> },
      { path: 'delivery/audit', element: <RequiresBranch rollup="/app/delivery/rollup"><DeliveryPage /></RequiresBranch> },
      { path: 'delivery/rollup', element: <FleetRollupPage /> },
      { path: 'cashier/shifts', element: <RequiresBranch rollup="/app/cashier/rollup"><CashDrawerPage /></RequiresBranch> },
      { path: 'cashier/shifts/:shiftId', element: <ShiftDetailPage /> },
      { path: 'cashier/shifts/:shiftId/end', element: <EndShiftPage /> },
      { path: 'cashier/business-days', element: <RequiresBranch><BusinessDaysPage /></RequiresBranch> },
      { path: 'cashier/rollup', element: <ShiftRollupPage /> },
      { path: 'payments', element: <RequiresBranch><PaymentsPage /></RequiresBranch> },
      { path: 'refunds', element: <RequiresBranch><RefundsPage /></RequiresBranch> },
      { path: 'customer-club/discounts', element: <Navigate to="/app/discounts/customer-rates" replace /> },
      { path: 'customer-club/wallet', element: <Navigate to="/app/discounts/wallet" replace /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'customers/:id', element: <CustomerProfilePage /> },
      { path: 'credit/accounts', element: <CustomerCreditPage /> },
      { path: 'credit/accounts/:id', element: <CustomerCreditPage /> },
      { path: 'catalog/categories', element: <CategoriesPage /> },
      { path: 'catalog/products', element: <ProductsPage /> },
      { path: 'catalog/products/:id', element: <ProductDetailPage /> },
      { path: 'catalog/modifiers', element: <OptionsPage /> },
      { path: 'catalog/availability', element: <AvailabilityPage /> },
      { path: 'catalog/stock', element: <DailyStockPage /> },
      { path: 'catalog/availability/report', element: <StopReportPage /> },
      { path: 'catalog/import-export', element: <ImportWizardPage /> },
      { path: 'pricing/price-lists', element: <PriceListsPage /> },
      { path: 'pricing/changes', element: <PriceChangesPage /> },
      { path: 'pricing/item-discounts', element: <ItemDiscountsPage /> },
      { path: 'pricing/snappfood', element: <ChannelPricesPage /> },
      // The old Price Book addresses, kept so bookmarks land on the lists.
      { path: 'pricing/price-book', element: <Navigate to="/app/pricing/price-lists" replace /> },
      { path: 'pricing/price-groups', element: <Navigate to="/app/pricing/price-lists" replace /> },
      { path: 'pricing/bulk-update', element: <Navigate to="/app/pricing/changes" replace /> },
      { path: 'discounts', element: <Navigate to="/app/discounts/customer-rates" replace /> },
      { path: 'discounts/customer-rates', element: <DiscountsHubPage defaultTab={0} /> },
      { path: 'discounts/coupons', element: <DiscountsHubPage defaultTab={1} /> },
      // Cashier discount caps are a policy, so they live in Settings; this was a second door.
      { path: 'discounts/authorizations', element: <Navigate to="/app/settings/discount-authorizations" replace /> },
      { path: 'discounts/wallet', element: <DiscountsHubPage defaultTab={2} /> },
      { path: 'operations/branches', element: <BranchesPage /> },
      { path: 'operations/branches/new', element: <BranchNewPage /> },
      { path: 'operations/branches/:id', element: <BranchDetailPage /> },
      { path: 'operations/terminals', element: <RequiresBranch><TerminalsPage /></RequiresBranch> },
      { path: 'operations/card-terminals', element: <RequiresBranch><CardTerminalsPage /></RequiresBranch> },
      { path: 'operations/kds-configuration', element: <RequiresBranch><KdsConfigurationPage /></RequiresBranch> },
      { path: 'operations/printers', element: <RequiresBranch><PrintersPage /></RequiresBranch> },
      { path: 'operations/print-queue', element: <RequiresBranch><PrintQueuePage /></RequiresBranch> },
      { path: 'print-queue', element: <Navigate to="/app/operations/print-queue" replace /> },
      { path: 'operations/monitoring', element: <MonitoringPage /> },
      { path: 'operations/agents', element: <AgentsPage /> },
      { path: 'simulation', element: <SimulationCenterPage /> },
      { path: 'simulation/snappfood', element: <SimulationSnappfoodPage /> },
      { path: 'simulation/payments-printers', element: <SimulationPaymentsPrintersPage /> },
      { path: 'simulation/logs', element: <SimulationLogsPage /> },
      { path: 'reports', element: <ReportsIndexPage /> },
      { path: 'reports/:reportCode', element: <ReportViewerPage /> },
      { path: 'audit', element: <AuditExplorerPage /> },
      { path: 'moadian', element: <MoadianInvoicesPage /> },
      { path: 'settings', element: <SettingsHubPage /> },
      { path: 'settings/users', element: <UsersPage /> },
      { path: 'settings/users/:id', element: <UserProfilePage /> },
      { path: 'settings/general', element: <GeneralSettingsPage /> },
      { path: 'settings/order-workflow', element: <OrderWorkflowSettingsPage /> },
      { path: 'settings/shift-policy', element: <ShiftPolicySettingsPage /> },
      { path: 'settings/business-day', element: <BusinessDaySettingsPage /> },
      { path: 'settings/calendar', element: <CalendarSettingsPage /> },
      { path: 'settings/branch-overrides', element: <BranchOverridesPage /> },
      { path: 'settings/roles', element: <RolesMatrixPage /> },
      { path: 'settings/discount-authorizations', element: <DiscountAuthorizationsPage /> },
      { path: 'settings/payments-refunds', element: <PaymentSettingsPage /> },
      { path: 'settings/payments', element: <Navigate to="/app/settings/payments-refunds" replace /> },
      { path: 'settings/approvals', element: <ApprovalsSettingsPage /> },
      { path: 'settings/reasons', element: <ReasonCodesPage /> },
      { path: 'settings/note-templates', element: <NoteTemplatesPage /> },
      { path: 'settings/localization', element: <MediaLocalizationDemoPage /> },
      { path: 'settings/data-reset', element: <DataResetPage /> },
      { path: 'pos/receipt/:id', element: <ReceiptPage /> },

      {
        path: '*',
        element: <Page404 />,
      },
    ],
  },
  {
    path: '*',
    element: <Page404 />,
  },
];

/** What kiosk.gnext.top serves: the sign-in and the kiosk, no shell, and no way into /app. */
export const kioskRoutesSection: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/', element: <ProtectedRoute><KioskHostPage /></ProtectedRoute> },
  { path: '*', element: <Navigate to="/" replace /> },
];
