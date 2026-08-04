import type { RouteObject } from 'react-router';
import { Navigate } from 'react-router';
import { LoginPage } from 'src/pages/login';
import { AppShell } from 'src/layouts/AppShell';
import { DashboardPage } from 'src/pages/dashboard';
import { BranchesPage } from 'src/pages/operations/branches';
import { BranchDetailPage } from 'src/pages/operations/branch-detail';
import { TerminalsPage } from 'src/pages/operations/terminals';
import { CashDrawerPage } from 'src/pages/operations/cash-drawer';
import { PaymentsPage } from 'src/pages/operations/payments';
import { DineInPage } from 'src/pages/operations/dine-in';
import { KdsPage } from 'src/pages/operations/kds';
import { DeliveryPage } from 'src/pages/operations/delivery';
import { CourierSettlementsPage } from 'src/pages/operations/settlements';
import { InventoryStockPage } from 'src/pages/inventory/stock';
import { GeneralSettingsPage } from 'src/pages/settings/general';
import { ReasonCodesPage } from 'src/pages/settings/reasons';
import { ApprovalsSettingsPage } from 'src/pages/settings/approvals';
import { MediaLocalizationDemoPage } from 'src/pages/simulation/media-localization';

import { CategoriesPage } from 'src/pages/catalog/categories';
import { ProductsPage } from 'src/pages/catalog/products';
import { OptionsPage } from 'src/pages/catalog/options';
import { PricingPage } from 'src/pages/catalog/pricing';
import { MenusPage } from 'src/pages/catalog/menus';
import { AvailabilityPage } from 'src/pages/catalog/availability';

import { DiscountRulesPage } from 'src/pages/discounts/rules';
import { CouponsPage } from 'src/pages/discounts/coupons';

import { CustomersPage } from 'src/pages/customers/directory';
import { CustomerGroupsPage } from 'src/pages/customers/groups';
import { CustomerCreditPage } from 'src/pages/customers/credit';

import { PosOrderPage } from 'src/pages/pos/order';
import { OrdersWorkflowPage } from 'src/pages/orders/workflow';
import { RefundsPage } from 'src/pages/orders/refunds';
import { ReceiptPage } from 'src/pages/pos/receipt';
import { KioskPage } from 'src/pages/pos/kiosk';
import { SimulationCenterPage } from 'src/pages/simulation/simulation-center';
import { OfflineSyncPage } from 'src/pages/simulation/offline-sync';
import { ReportViewerPage } from 'src/pages/reports/report-viewer';
import { AuditExplorerPage } from 'src/pages/operations/audit-explorer';

import { useAuthStore } from 'src/store/useAuthStore';
import { useEffect } from 'react';

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
        path: 'operations/payments',
        element: <PaymentsPage />,
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
        path: 'simulation/offline-sync',
        element: <OfflineSyncPage />,
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
        path: 'operations/branches',
        element: <BranchesPage />,
      },
      {
        path: 'operations/branches/:id',
        element: <BranchDetailPage />,
      },
      {
        path: 'operations/terminals',
        element: <TerminalsPage />,
      },
      {
        path: 'settings/general',
        element: <GeneralSettingsPage />,
      },
      {
        path: 'settings/reasons',
        element: <ReasonCodesPage />,
      },
      {
        path: 'settings/approvals',
        element: <ApprovalsSettingsPage />,
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
      {
        path: '*',
        element: <DashboardPage />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/app/dashboard" replace />,
  },
];
