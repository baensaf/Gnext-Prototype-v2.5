import type { RouteObject } from 'react-router';

import { useEffect } from 'react';
import { Navigate } from 'react-router';

import Page404 from 'src/pages/error/404';
import { LoginPage } from 'src/pages/login';
import { AppShell } from 'src/layouts/AppShell';
import { KioskPage } from 'src/pages/pos/kiosk';
import { KdsPage } from 'src/pages/operations/kds';
import { PosOrderPage } from 'src/pages/pos/order';
import { MenusPage } from 'src/pages/catalog/menus';
import { DashboardPage } from 'src/pages/dashboard';
import { ReceiptPage } from 'src/pages/pos/receipt';
import { UsersPage } from 'src/pages/settings/users';
import { useAuthStore } from 'src/store/useAuthStore';
import { RefundsPage } from 'src/pages/orders/refunds';
import { OptionsPage } from 'src/pages/catalog/options';
import { homePathForRole } from 'src/config/role-access';
import { SettingsHubPage } from 'src/pages/settings/hub';
import { AgentsPage } from 'src/pages/operations/agents';
import { DailyStockPage } from 'src/pages/catalog/stock';
import { ProductsPage } from 'src/pages/catalog/products';
import { DineInPage } from 'src/pages/operations/dine-in';
import { DataResetPage } from 'src/pages/tools/data-reset';
import { DiscountsHubPage } from 'src/pages/discounts/hub';
import { RolesMatrixPage } from 'src/pages/settings/roles';
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
import { GeneralSettingsPage } from 'src/pages/settings/general';
import { ImportWizardPage } from 'src/pages/tools/import-wizard';
import { ShiftDetailPage } from 'src/pages/cashier/shift-detail';
import { MonitoringPage } from 'src/pages/operations/monitoring';
import { ShiftRollupPage } from 'src/pages/cashier/shift-rollup';
import { AvailabilityPage } from 'src/pages/catalog/availability';
import { CashDrawerPage } from 'src/pages/operations/cash-drawer';
import { PrintQueuePage } from 'src/pages/operations/print-queue';
/* Detail & Simulation Sub-Pages */
import { OrdersDetailPage } from 'src/pages/orders/orders-detail';
import { PaymentSettingsPage } from 'src/pages/settings/payments';
import { UserProfilePage } from 'src/pages/settings/user-profile';
import { PriceChangesPage } from 'src/pages/catalog/price-changes';
import { BusinessDaysPage } from 'src/pages/cashier/business-days';
import { ReportViewerPage } from 'src/pages/reports/report-viewer';
import { CalendarSettingsPage } from 'src/pages/settings/calendar';
import { FleetRollupPage } from 'src/pages/operations/fleet-rollup';
import { ChannelPricesPage } from 'src/pages/catalog/channel-prices';
import { ApprovalsSettingsPage } from 'src/pages/settings/approvals';
import { ProductDetailPage } from 'src/pages/catalog/product-detail';
import { NoteTemplatesPage } from 'src/pages/settings/note-templates';
import { BranchDetailPage } from 'src/pages/operations/branch-detail';
import { AuditExplorerPage } from 'src/pages/operations/audit-explorer';
import { CourierDetailPage } from 'src/pages/operations/courier-detail';
import { CourierPaySettingsPage } from 'src/pages/settings/courier-pay';
import { MoadianInvoicesPage } from 'src/pages/moadian/moadian-invoices';
import { SimulationLogsPage } from 'src/pages/simulation/simulation-logs';
import { BranchOverridesPage } from 'src/pages/settings/branch-overrides';
import { ShiftPolicySettingsPage } from 'src/pages/settings/shift-policy';
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

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, fetchMe, isInitialized } = useAuthStore();

  useEffect(() => {
    if (!isInitialized) {
      fetchMe();
    }
  }, [fetchMe, isInitialized]);

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
      { path: 'pos', element: <PosOrderPage /> },
      { path: 'kiosk', element: <KioskPage /> },
      { path: 'orders', element: <OrdersWorkflowPage /> },
      { path: 'orders/incoming', element: <IncomingOrdersPage /> },
      { path: 'orders/:id', element: <OrdersDetailPage /> },
      { path: 'dine-in/floor', element: <DineInPage /> },
      { path: 'kds', element: <KdsPage /> },
      { path: 'delivery', element: <Navigate to="/app/delivery/orders" replace /> },
      { path: 'delivery/orders', element: <DeliveryPage /> },
      { path: 'delivery/couriers', element: <DeliveryPage /> },
      { path: 'delivery/couriers/:courierId', element: <CourierDetailPage /> },
      { path: 'delivery/settlements', element: <DeliveryPage /> },
      { path: 'delivery/settlements/:settlementId', element: <SettlementDetailPage /> },
      { path: 'delivery/zones', element: <DeliveryPage /> },
      { path: 'delivery/audit', element: <DeliveryPage /> },
      { path: 'delivery/rollup', element: <FleetRollupPage /> },
      { path: 'cashier/shifts', element: <CashDrawerPage /> },
      { path: 'cashier/shifts/:shiftId', element: <ShiftDetailPage /> },
      { path: 'cashier/business-days', element: <BusinessDaysPage /> },
      { path: 'cashier/rollup', element: <ShiftRollupPage /> },
      { path: 'payments', element: <PaymentsPage /> },
      { path: 'refunds', element: <RefundsPage /> },
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
      { path: 'catalog/menus', element: <MenusPage /> },
      { path: 'catalog/menus/:id', element: <MenusPage /> },
      { path: 'catalog/availability', element: <AvailabilityPage /> },
      { path: 'catalog/stock', element: <DailyStockPage /> },
      { path: 'catalog/availability/report', element: <StopReportPage /> },
      { path: 'catalog/import-export', element: <ImportWizardPage /> },
      { path: 'pricing/price-lists', element: <PriceListsPage /> },
      { path: 'pricing/changes', element: <PriceChangesPage /> },
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
      { path: 'operations/branches/:id', element: <BranchDetailPage /> },
      { path: 'operations/terminals', element: <TerminalsPage /> },
      { path: 'operations/kds-configuration', element: <KdsConfigurationPage /> },
      { path: 'operations/printers', element: <PrintersPage /> },
      { path: 'operations/print-queue', element: <PrintQueuePage /> },
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
      { path: 'settings/courier-pay', element: <CourierPaySettingsPage /> },
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
