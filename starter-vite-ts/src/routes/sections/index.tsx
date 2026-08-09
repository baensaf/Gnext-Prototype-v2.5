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
import { CustomerGroupsPage } from 'src/pages/customers/groups';
import { GeneralSettingsPage } from 'src/pages/settings/general';
import { ImportWizardPage } from 'src/pages/tools/import-wizard';
import { AvailabilityPage } from 'src/pages/catalog/availability';
import { CashDrawerPage } from 'src/pages/operations/cash-drawer';
import { PrintQueuePage } from 'src/pages/operations/print-queue';
import { ReportViewerPage } from 'src/pages/reports/report-viewer';
import { OfflineSyncPage } from 'src/pages/simulation/offline-sync';
import { ApprovalsSettingsPage } from 'src/pages/settings/approvals';
import { BranchDetailPage } from 'src/pages/operations/branch-detail';
import { AuditExplorerPage } from 'src/pages/operations/audit-explorer';
import { CourierSettlementsPage } from 'src/pages/operations/settlements';
import { SimulationCenterPage } from 'src/pages/simulation/simulation-center';
import { KdsConfigurationPage } from 'src/pages/operations/kds-configuration';
import { MediaLocalizationDemoPage } from 'src/pages/simulation/media-localization';





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
    path: '/operations/orders',
    element: <Navigate to="/app/operations/orders" replace />,
  },
  {
    path: '/orders',
    element: <Navigate to="/app/operations/orders" replace />,
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
      {
        path: 'dashboard',
        element: <DashboardPage />,
      },
      {
        path: 'pos/order',
        element: <PosOrderPage />,
      },
      {
        path: 'kiosk',
        element: <KioskPage />,
      },
      {
        path: 'pos/receipt/:id',
        element: <ReceiptPage />,
      },
      {
        path: 'operations/orders',
        element: <OrdersWorkflowPage />,
      },
      {
        path: 'orders/refunds',
        element: <RefundsPage />,
      },
      {
        path: 'operations/cash-drawer',
        element: <CashDrawerPage />,
      },
      {
        path: 'operations/dine-in',
        element: <DineInPage />,
      },
      {
        path: 'operations/kds',
        element: <KdsPage />,
      },
      {
        path: 'operations/kds-configuration',
        element: <KdsConfigurationPage />,
      },
      {
        path: 'operations/printers',
        element: <PrintersPage />,
      },
      {
        path: 'operations/print-queue',
        element: <PrintQueuePage />,
      },
      {
        path: 'operations/delivery',
        element: <DeliveryPage />,
      },
      {
        path: 'operations/settlements',
        element: <CourierSettlementsPage />,
      },
      {
        path: 'simulation/center',
        element: <SimulationCenterPage />,
      },
      {
        path: 'reports/catalog',
        element: <ReportViewerPage />,
      },
      {
        path: 'operations/audit',
        element: <AuditExplorerPage />,
      },
      {
        path: 'inventory/stock',
        element: <InventoryStockPage />,
      },
      {
        path: 'catalog/categories',
        element: <CategoriesPage />,
      },
      {
        path: 'catalog/products',
        element: <ProductsPage />,
      },
      {
        path: 'catalog/options',
        element: <OptionsPage />,
      },
      {
        path: 'catalog/pricing',
        element: <PricingPage />,
      },
      {
        path: 'catalog/menus',
        element: <MenusPage />,
      },
      {
        path: 'catalog/availability',
        element: <AvailabilityPage />,
      },
      {
        path: 'discounts/rules',
        element: <DiscountRulesPage />,
      },
      {
        path: 'discounts/coupons',
        element: <CouponsPage />,
      },
      {
        path: 'customers',
        element: <CustomersPage />,
      },
      {
        path: 'customers/credit',
        element: <CustomerCreditPage />,
      },
      {
        path: 'customers/groups',
        element: <CustomerGroupsPage />,
      },
      {
        path: 'simulation/media-localization',
        element: <MediaLocalizationDemoPage />,
      },
      /* Settings Hub & Sub-pages */
      {
        path: 'settings',
        element: <SettingsHubPage />,
      },
      {
        path: 'settings/general',
        element: <GeneralSettingsPage />,
      },
      {
        path: 'settings/branches',
        element: <BranchesPage />,
      },
      {
        path: 'settings/branches/:id',
        element: <BranchDetailPage />,
      },
      {
        path: 'settings/terminals',
        element: <TerminalsPage />,
      },
      {
        path: 'settings/payments',
        element: <PaymentsPage />,
      },
      {
        path: 'settings/approvals',
        element: <ApprovalsSettingsPage />,
      },
      {
        path: 'settings/reasons',
        element: <ReasonCodesPage />,
      },
      {
        path: 'settings/offline-sync',
        element: <OfflineSyncPage />,
      },
      {
        path: 'settings/import-wizard',
        element: <ImportWizardPage />,
      },
      {
        path: 'settings/data-reset',
        element: <DataResetPage />,
      },
      /* Legacy Route Redirects for Backwards Compatibility */
      {
        path: 'operations/branches',
        element: <Navigate to="/app/settings/branches" replace />,
      },
      {
        path: 'operations/branches/:id',
        element: <Navigate to="/app/settings/branches" replace />,
      },
      {
        path: 'operations/terminals',
        element: <Navigate to="/app/settings/terminals" replace />,
      },
      {
        path: 'operations/payments',
        element: <Navigate to="/app/settings/payments" replace />,
      },
      {
        path: 'simulation/offline-sync',
        element: <Navigate to="/app/settings/offline-sync" replace />,
      },
      {
        path: 'tools/import-wizard',
        element: <Navigate to="/app/settings/import-wizard" replace />,
      },
      {
        path: 'tools/data-reset',
        element: <Navigate to="/app/settings/data-reset" replace />,
      },
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
