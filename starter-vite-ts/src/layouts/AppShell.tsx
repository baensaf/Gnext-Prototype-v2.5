import React from 'react';
import { Outlet } from 'react-router';
import { DashboardLayout } from './dashboard';
import { navData } from './nav-config-dashboard';

export function AppShell() {
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
