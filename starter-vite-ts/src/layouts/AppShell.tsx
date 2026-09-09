import React from 'react';
import { Outlet } from 'react-router';

import { RoleGuard } from 'src/routes/components/role-guard';

import { DashboardLayout } from './dashboard';
import { useNavData } from './nav-config-dashboard';

export function AppShell() {
  const navData = useNavData();

  return (
    <DashboardLayout
      slotProps={{
        nav: {
          data: navData,
        },
      }}
    >
      <RoleGuard>
        <Outlet />
      </RoleGuard>
    </DashboardLayout>
  );
}
