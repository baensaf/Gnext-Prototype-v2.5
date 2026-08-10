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
import { useAuthStore } from 'src/store/useAuthStore';
import { RefundsPage } from 'src/pages/orders/refunds';
import { OptionsPage } from 'src/pages/catalog/options';
import { PricingPage } from 'src/pages/catalog/pricing';
import { SettingsHubPage } from 'src/pages/settings/hub';
import { ProductsPage } from 'src/pages/catalog/products';
import { CouponsPage } from 'src/pages/discounts/coupons';
import { DineInPage } from 'src/pages/operations/dine-in';
import { DataResetPage } from 'src/pages/tools/data-reset';
import { BranchesPage } from 'src/pages/operations/branches';
import { DeliveryPage } from 'src/pages/operations/delivery';
import { PaymentsPage } from 'src/pages/operations/payments';
import { ReasonCodesPage } from 'src/pages/settings/reasons';
import { PrintersPage } from 'src/pages/operations/printers';
import { CategoriesPage } from 'src/pages/catalog/categories';
import { CustomersPage } from 'src/pages/customers/directory';
import { DiscountRulesPage } from 'src/pages/discounts/rules';
import { InventoryStockPage } from 'src/pages/inventory/stock';
import { TerminalsPage } from 'src/pages/operations/terminals';
import { OrdersWorkflowPage } from 'src/pages/orders/workflow';
import { CustomerCreditPage } from 'src/pages/customers/credit';
import { GeneralSettingsPage } from 'src/pages/settings/general';
import { ImportWizardPage } from 'src/pages/tools/import-wizard';
import { ShiftDetailPage } from 'src/pages/cashier/shift-detail';
import { AvailabilityPage } from 'src/pages/catalog/availability';
import { CashDrawerPage } from 'src/pages/operations/cash-drawer';
import { PrintQueuePage } from 'src/pages/operations/print-queue';
/* Detail & Simulation Sub-Pages */
import { OrdersDetailPage } from 'src/pages/orders/orders-detail';
import { ReportViewerPage } from 'src/pages/reports/report-viewer';
import { OfflineSyncPage } from 'src/pages/simulation/offline-sync';
import { ApprovalsSettingsPage } from 'src/pages/settings/approvals';
import { ProductDetailPage } from 'src/pages/catalog/product-detail';
import { BranchDetailPage } from 'src/pages/operations/branch-detail';
import { AuditExplorerPage } from 'src/pages/operations/audit-explorer';
import { CourierDetailPage } from 'src/pages/operations/courier-detail';
import { CampaignDetailPage } from 'src/pages/discounts/campaign-detail';
import { CourierSettlementsPage } from 'src/pages/operations/settlements';
import { SimulationLogsPage } from 'src/pages/simulation/simulation-logs';
import { SimulationCenterPage } from 'src/pages/simulation/simulation-center';
import { KdsConfigurationPage } from 'src/pages/operations/kds-configuration';
import { SettlementDetailPage } from 'src/pages/operations/settlement-detail';
import { MediaLocalizationDemoPage } from 'src/pages/simulation/media-localization';
import { SimulationSnappfoodPage } from 'src/pages/simulation/simulation-snappfood';
import { SimulationPaymentsPrintersPage } from 'src/pages/simulation/simulation-payments-printers';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, fetchMe, isLoading } = useAuthStore();

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export const routesSection: RouteObject[] = [
  {
    path: '/',
    element: <Navigate to="/app/dashboard" replace />,
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
      { path: 'delivery/settlements', element: <CourierSettlementsPage /> },
      { path: 'delivery/settlements/:settlementId', element: <SettlementDetailPage /> },
      { path: 'cashier/shifts', element: <CashDrawerPage /> },
      { path: 'cashier/shifts/:shiftId', element: <ShiftDetailPage /> },
      { path: 'cashier/business-days', element: <CashDrawerPage /> },
      { path: 'payments', element: <PaymentsPage /> },
      { path: 'refunds', element: <RefundsPage /> },
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
      { path: 'discounts/campaigns', element: <DiscountRulesPage /> },
      { path: 'discounts/campaigns/:id', element: <CampaignDetailPage /> },
      { path: 'discounts/coupons', element: <CouponsPage /> },
      { path: 'operations/branches', element: <BranchesPage /> },
      { path: 'operations/branches/:id', element: <BranchDetailPage /> },
      { path: 'operations/terminals', element: <TerminalsPage /> },
      { path: 'operations/kds-configuration', element: <KdsConfigurationPage /> },
      { path: 'operations/printers', element: <PrintersPage /> },
      { path: 'operations/print-queue', element: <PrintQueuePage /> },
      { path: 'operations/monitoring', element: <DashboardPage /> },
      { path: 'simulation', element: <SimulationCenterPage /> },
      { path: 'simulation/snappfood', element: <SimulationSnappfoodPage /> },
      { path: 'simulation/payments-printers', element: <SimulationPaymentsPrintersPage /> },
      { path: 'simulation/offline-sync', element: <OfflineSyncPage /> },
      { path: 'simulation/logs', element: <SimulationLogsPage /> },
      { path: 'reports/:reportCode', element: <ReportViewerPage /> },
      { path: 'audit', element: <AuditExplorerPage /> },
      { path: 'settings', element: <SettingsHubPage /> },
      { path: 'settings/general', element: <GeneralSettingsPage /> },
      { path: 'settings/order-workflow', element: <OrdersWorkflowPage /> },
      { path: 'settings/discounts-credit', element: <DiscountRulesPage /> },
      { path: 'settings/payments-refunds', element: <PaymentsPage /> },
      { path: 'settings/approvals', element: <ApprovalsSettingsPage /> },
      { path: 'settings/reasons', element: <ReasonCodesPage /> },
      { path: 'settings/localization', element: <MediaLocalizationDemoPage /> },
      { path: 'settings/data-reset', element: <DataResetPage /> },
      { path: 'inventory/stock', element: <InventoryStockPage /> },

      /* --- Legacy Alias Redirects (Section 9.1 Conformance) --- */
      { path: 'pos/order', element: <Navigate to="/app/pos" replace /> },
      { path: 'pos/receipt/:id', element: <ReceiptPage /> },
      { path: 'operations/orders', element: <Navigate to="/app/orders" replace /> },
      { path: 'operations/dine-in', element: <Navigate to="/app/dine-in/floor" replace /> },
      { path: 'operations/kds', element: <Navigate to="/app/kds" replace /> },
      { path: 'operations/delivery', element: <Navigate to="/app/delivery/orders" replace /> },
      { path: 'operations/settlements', element: <Navigate to="/app/delivery/settlements" replace /> },
      { path: 'operations/cash-drawer', element: <Navigate to="/app/cashier/shifts" replace /> },
      { path: 'orders/refunds', element: <Navigate to="/app/refunds" replace /> },
      { path: 'reports/catalog', element: <Navigate to="/app/reports/sales-summary" replace /> },
      { path: 'operations/audit', element: <Navigate to="/app/audit" replace /> },
      { path: 'discounts/rules', element: <Navigate to="/app/discounts/campaigns" replace /> },
      { path: 'customers/credit', element: <Navigate to="/app/credit/accounts" replace /> },
      { path: 'customers/groups', element: <CustomersPage /> },
      { path: 'simulation/center', element: <Navigate to="/app/simulation" replace /> },
      { path: 'simulation/media-localization', element: <Navigate to="/app/settings/localization" replace /> },
      { path: 'tools/import-wizard', element: <Navigate to="/app/catalog/import-export" replace /> },
      { path: 'tools/data-reset', element: <Navigate to="/app/settings/data-reset" replace /> },

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
