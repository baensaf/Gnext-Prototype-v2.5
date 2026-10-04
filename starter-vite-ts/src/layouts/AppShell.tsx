import React from 'react';
import { Outlet } from 'react-router';

import { paths } from 'src/routes/paths';
import { usePathname } from 'src/routes/hooks';
import { RoleGuard } from 'src/routes/components/role-guard';

import { DashboardLayout } from './dashboard';
import { useNavData } from './nav-config-dashboard';

export function AppShell() {
  const navData = useNavData();
  // The register fills the window to its bottom edge: the room other pages leave under
  // their content would only push its pay buttons up, or off a small screen.
  const isRegister = usePathname() === paths.app.pos;

  return (
    <DashboardLayout
      slotProps={{
        nav: {
          data: navData,
        },
        main: isRegister ? { sx: { pb: 1 } } : undefined,
      }}
    >
      <RoleGuard>
        <Outlet />
      </RoleGuard>
    </DashboardLayout>
  );
}
