/**
 * The self-order kiosk lives only on its own address, so a device can sit on it with nothing
 * else to wander into. One bundle serves both: the router picks its routes by hostname.
 */

/** True on kiosk.gnext.top, and on kiosk.localhost for testing. */
export function isKioskHost(): boolean {
  return window.location.hostname.startsWith('kiosk.');
}
