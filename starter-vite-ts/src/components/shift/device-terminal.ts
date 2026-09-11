import type { Terminal } from 'src/api/tenantApi';

import { useState, useEffect, useCallback } from 'react';

// ----------------------------------------------------------------------

/**
 * Which register this device is.
 *
 * A cash drawer is bolted to one counter in one shop, so the device in front of it answers
 * "which terminal" once, when a manager sets it up, and the cashier never picks a branch or
 * a terminal again. The branch follows from the terminal. Kept in the browser because it
 * describes the machine, not the person signed in to it.
 */
export type DeviceTerminal = Pick<Terminal, 'id' | 'code' | 'name' | 'branch_id'>;

const STORAGE_KEY = 'gnext_device_terminal';
/** Same-tab listeners; the `storage` event only fires in other tabs. */
const CHANGE_EVENT = 'gnext-device-terminal-changed';

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
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useDeviceTerminal(): [DeviceTerminal | null, (terminal: DeviceTerminal | null) => void] {
  const [terminal, setTerminal] = useState<DeviceTerminal | null>(() => readDeviceTerminal());

  useEffect(() => {
    const sync = () => setTerminal(readDeviceTerminal());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const update = useCallback((next: DeviceTerminal | null) => writeDeviceTerminal(next), []);

  return [terminal, update];
}
