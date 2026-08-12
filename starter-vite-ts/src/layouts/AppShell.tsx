import React from 'react';
import { Outlet } from 'react-router';

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
      <Outlet />
    </DashboardLayout>
  );
}
