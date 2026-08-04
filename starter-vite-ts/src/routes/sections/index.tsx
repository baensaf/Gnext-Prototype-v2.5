import type { RouteObject } from 'react-router';
import { Navigate } from 'react-router';
import { LoginPage } from 'src/pages/login';
import { AppShell } from 'src/layouts/AppShell';
import { DashboardPage } from 'src/pages/dashboard';
import { BranchesPage } from 'src/pages/operations/branches';
import { BranchDetailPage } from 'src/pages/operations/branch-detail';
import { TerminalsPage } from 'src/pages/operations/terminals';
import { CashDrawerPage } from 'src/pages/operations/cash-drawer';
import { InventoryStockPage } from 'src/pages/inventory/stock';
import { GeneralSettingsPage } from 'src/pages/settings/general';
import { ReasonCodesPage } from 'src/pages/settings/reasons';
import { MediaLocalizationDemoPage } from 'src/pages/simulation/media-localization';

import { CategoriesPage } from 'src/pages/catalog/categories';
import { ProductsPage } from 'src/pages/catalog/products';
import { OptionsPage } from 'src/pages/catalog/options';
import { PricingPage } from 'src/pages/catalog/pricing';

import { DiscountRulesPage } from 'src/pages/discounts/rules';
import { CouponsPage } from 'src/pages/discounts/coupons';

import { CustomersPage } from 'src/pages/customers/directory';
import { CustomerGroupsPage } from 'src/pages/customers/groups';
import { CustomerCreditPage } from 'src/pages/customers/credit';

import { PosOrderPage } from 'src/pages/pos/order';
import { OrdersWorkflowPage } from 'src/pages/orders/workflow';
import { ReceiptPage } from 'src/pages/pos/receipt';

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
        path: 'pos/receipt/:id',
        element: <ReceiptPage />,
      },
      {
        path: 'operations/orders',
        element: <OrdersWorkflowPage />,
      },
      {
        path: 'operations/cash-drawer',
        element: <CashDrawerPage />,
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
