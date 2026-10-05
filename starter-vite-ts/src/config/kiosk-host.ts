/**
 * The self-order kiosk has its own address, so a device can sit on it with nothing else to
 * wander into. One bundle serves both: the router picks its routes by hostname.
 */

/** True on kiosk.gnext.top, and on kiosk.localhost for testing. */
export function isKioskHost(): boolean {
  return window.location.hostname.startsWith('kiosk.');
}

/**
 * Where /app/kiosk should send the browser, or null to keep it in the app. Only gnext.top
 * has a kiosk subdomain; localhost, LAN addresses, gnextdev.ir and the e2e runs have none,
 * and kiosk.gnext.top itself is not listed, so it cannot redirect to itself.
 */
export function kioskUrl(): string | null {
  const { hostname } = window.location;
  return hostname === 'gnext.top' || hostname === 'www.gnext.top' ? 'https://kiosk.gnext.top/' : null;
}
