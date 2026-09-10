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
import { PricingPage } from 'src/pages/catalog/pricing';
import { homePathForRole } from 'src/config/role-access';
import { SettingsHubPage } from 'src/pages/settings/hub';
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
import { TerminalsPage } from 'src/pages/operations/terminals';
import { OrdersWorkflowPage } from 'src/pages/orders/workflow';
import { CustomerCreditPage } from 'src/pages/customers/credit';
import { ReportsIndexPage } from 'src/pages/reports/index-page';
import { GeneralSettingsPage } from 'src/pages/settings/general';
import { ImportWizardPage } from 'src/pages/tools/import-wizard';
import { ShiftDetailPage } from 'src/pages/cashier/shift-detail';
import { MonitoringPage } from 'src/pages/operations/monitoring';
import { AvailabilityPage } from 'src/pages/catalog/availability';
import { CashDrawerPage } from 'src/pages/operations/cash-drawer';
import { PrintQueuePage } from 'src/pages/operations/print-queue';
/* Detail & Simulation Sub-Pages */
import { OrdersDetailPage } from 'src/pages/orders/orders-detail';
import { PaymentSettingsPage } from 'src/pages/settings/payments';
import { BusinessDaysPage } from 'src/pages/cashier/business-days';
import { ReportViewerPage } from 'src/pages/reports/report-viewer';
import { OfflineSyncPage } from 'src/pages/simulation/offline-sync';
import { ApprovalsSettingsPage } from 'src/pages/settings/approvals';
import { ProductDetailPage } from 'src/pages/catalog/product-detail';
import { BranchDetailPage } from 'src/pages/operations/branch-detail';
import { AuditExplorerPage } from 'src/pages/operations/audit-explorer';
import { CourierDetailPage } from 'src/pages/operations/courier-detail';
import { SimulationLogsPage } from 'src/pages/simulation/simulation-logs';
import { BranchOverridesPage } from 'src/pages/settings/branch-overrides';
import { SimulationCenterPage } from 'src/pages/simulation/simulation-center';
import { KdsConfigurationPage } from 'src/pages/operations/kds-configuration';
import { SettlementDetailPage } from 'src/pages/operations/settlement-detail';
import { OrderWorkflowSettingsPage } from 'src/pages/settings/order-workflow';
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
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      /* --- Section 9.1 Exact Canonical Routes --- */
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'pos', element: <PosOrderPage /> },
      { path: 'kiosk', element: <KioskPage /> },
      { path: 'orders', element: <OrdersWorkflowPage /> },
      { path: 'orders/:id', element: <OrdersDetailPage /> },
      { path: 'dine-in/floor', element: <DineInPage /> },
      { path: 'kds', element: <KdsPage /> },
      { path: 'delivery/orders', element: <DeliveryPage /> },
      { path: 'delivery/couriers', element: <DeliveryPage /> },
      { path: 'delivery/couriers/:courierId', element: <CourierDetailPage /> },
      { path: 'delivery/settlements', element: <DeliveryPage /> },
      { path: 'delivery/settlements/:settlementId', element: <SettlementDetailPage /> },
      { path: 'delivery/zones', element: <DeliveryPage /> },
      { path: 'delivery/audit', element: <DeliveryPage /> },
      { path: 'cashier/shifts', element: <CashDrawerPage /> },
      { path: 'cashier/shifts/:shiftId', element: <ShiftDetailPage /> },
      { path: 'cashier/business-days', element: <BusinessDaysPage /> },
      { path: 'payments', element: <PaymentsPage /> },
      { path: 'refunds', element: <RefundsPage /> },
      { path: 'customer-club/discounts', element: <Navigate to="/app/discounts/customer-rates" replace /> },
      { path: 'customer-club/wallet', element: <Navigate to="/app/discounts/wallet" replace /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'customers/:id', element: <CustomersPage /> },
      { path: 'credit/accounts', element: <CustomerCreditPage /> },
      { path: 'credit/accounts/:id', element: <CustomerCreditPage /> },
      { path: 'catalog/categories', element: <CategoriesPage /> },
      { path: 'catalog/products', element: <ProductsPage /> },
      { path: 'catalog/products/:id', element: <ProductDetailPage /> },
      { path: 'catalog/modifiers', element: <OptionsPage /> },
      { path: 'catalog/menus', element: <MenusPage /> },
      { path: 'catalog/menus/:id', element: <MenusPage /> },
      { path: 'catalog/availability', element: <AvailabilityPage /> },
      { path: 'catalog/import-export', element: <ImportWizardPage /> },
      { path: 'pricing/price-book', element: <PricingPage /> },
      { path: 'pricing/price-groups', element: <PricingPage /> },
      { path: 'pricing/bulk-update', element: <PricingPage /> },
      { path: 'discounts', element: <Navigate to="/app/discounts/customer-rates" replace /> },
      { path: 'discounts/campaigns', element: <Navigate to="/app/discounts/customer-rates" replace /> },
      { path: 'discounts/campaigns/:id', element: <Navigate to="/app/discounts/customer-rates" replace /> },
      { path: 'discounts/customer-rates', element: <DiscountsHubPage defaultTab={0} /> },
      { path: 'discounts/coupons', element: <DiscountsHubPage defaultTab={1} /> },
      { path: 'discounts/authorizations', element: <DiscountsHubPage defaultTab={2} /> },
      { path: 'discounts/wallet', element: <DiscountsHubPage defaultTab={3} /> },
      { path: 'operations/branches', element: <BranchesPage /> },
      { path: 'operations/branches/:id', element: <BranchDetailPage /> },
      { path: 'operations/terminals', element: <TerminalsPage /> },
      { path: 'operations/kds-configuration', element: <KdsConfigurationPage /> },
      { path: 'operations/printers', element: <PrintersPage /> },
      { path: 'operations/print-queue', element: <PrintQueuePage /> },
      { path: 'operations/monitoring', element: <MonitoringPage /> },
      { path: 'simulation', element: <SimulationCenterPage /> },
      { path: 'simulation/snappfood', element: <SimulationSnappfoodPage /> },
      { path: 'simulation/payments-printers', element: <SimulationPaymentsPrintersPage /> },
      { path: 'simulation/offline-sync', element: <OfflineSyncPage /> },
      { path: 'simulation/logs', element: <SimulationLogsPage /> },
      { path: 'reports', element: <ReportsIndexPage /> },
      { path: 'reports/:reportCode', element: <ReportViewerPage /> },
      { path: 'audit', element: <AuditExplorerPage /> },
      { path: 'settings', element: <SettingsHubPage /> },
      { path: 'settings/users', element: <UsersPage /> },
      { path: 'settings/general', element: <GeneralSettingsPage /> },
      { path: 'settings/order-workflow', element: <OrderWorkflowSettingsPage /> },
      { path: 'settings/branch-overrides', element: <BranchOverridesPage /> },
      { path: 'settings/roles', element: <RolesMatrixPage /> },
      { path: 'settings/discount-authorizations', element: <DiscountsHubPage defaultTab={2} /> },
      { path: 'settings/payments-refunds', element: <PaymentSettingsPage /> },
      { path: 'settings/payments', element: <Navigate to="/app/settings/payments-refunds" replace /> },
      { path: 'settings/approvals', element: <ApprovalsSettingsPage /> },
      { path: 'settings/reasons', element: <ReasonCodesPage /> },
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
