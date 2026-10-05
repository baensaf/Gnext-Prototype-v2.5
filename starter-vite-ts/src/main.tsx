import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Outlet, RouterProvider, createBrowserRouter } from 'react-router';

import { LicenseInfo, muiXTelemetrySettings } from '@mui/x-license';

import App from './app';
import { isKioskHost } from './config/kiosk-host';
import { ErrorBoundary } from './routes/components';
import { routesSection, kioskRoutesSection } from './routes/sections';

// ----------------------------------------------------------------------

// The grids are MUI X Premium. Without a key they still work, under a "missing license" watermark.
// The key is baked into the bundle at build time (VITE_MUI_X_LICENSE_KEY); MUI X keys are
// meant to be public.
if (import.meta.env.VITE_MUI_X_LICENSE_KEY) LicenseInfo.setLicenseKey(import.meta.env.VITE_MUI_X_LICENSE_KEY);
// MUI X reports anonymous usage from development builds unless told not to.
muiXTelemetrySettings.disableTelemetry();

const router = createBrowserRouter([
  {
    Component: () => (
      <App>
        <Outlet />
      </App>
    ),
    errorElement: <ErrorBoundary />,
    children: isKioskHost() ? kioskRoutesSection : routesSection,
  },
]);

const root = createRoot(document.getElementById('root')!);

root.render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
