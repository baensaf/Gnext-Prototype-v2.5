import type { Terminal } from 'src/api/tenantApi';

// ----------------------------------------------------------------------

/**
 * Which register this device is.
 *
 * A cash drawer is bolted to one counter in one shop, so the device in front of it answers
 * "which terminal" once, when a manager sets it up, and the cashier never picks a branch or
 * a terminal again. The branch follows from the terminal. Kept in the browser because it
 * describes the machine, not the person signed in to it.
 *
 * Every API request carries it (see httpClient), so cash is counted in the drawer of the
 * register it changes hands at rather than the one the order happened to be rung up on.
 */
export type DeviceTerminal = Pick<Terminal, 'id' | 'code' | 'name' | 'branch_id'>;

const STORAGE_KEY = 'gnext_device_terminal';
/** Same-tab listeners; the `storage` event only fires in other tabs. */
export const DEVICE_TERMINAL_CHANGED = 'gnext-device-terminal-changed';

export function readDeviceTerminal(): DeviceTerminal | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.id === 'string' && typeof parsed.branch_id === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeDeviceTerminal(terminal: DeviceTerminal | null): void {
  try {
    if (terminal) {
      const { id, code, name, branch_id } = terminal;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, code, name, branch_id }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage blocked: the device simply stays unassigned.
  }
  window.dispatchEvent(new Event(DEVICE_TERMINAL_CHANGED));
}
