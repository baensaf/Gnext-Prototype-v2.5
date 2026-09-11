import type { DeviceTerminal } from 'src/utils/device-terminal';

import { useState, useEffect, useCallback } from 'react';

import { readDeviceTerminal, writeDeviceTerminal, DEVICE_TERMINAL_CHANGED } from 'src/utils/device-terminal';

// ----------------------------------------------------------------------

export type { DeviceTerminal };

/** The register this device is set up as, kept in step across the tab and other tabs. */
export function useDeviceTerminal(): [DeviceTerminal | null, (terminal: DeviceTerminal | null) => void] {
  const [terminal, setTerminal] = useState<DeviceTerminal | null>(() => readDeviceTerminal());

  useEffect(() => {
    const sync = () => setTerminal(readDeviceTerminal());
    window.addEventListener(DEVICE_TERMINAL_CHANGED, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(DEVICE_TERMINAL_CHANGED, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const update = useCallback((next: DeviceTerminal | null) => writeDeviceTerminal(next), []);

  return [terminal, update];
}
