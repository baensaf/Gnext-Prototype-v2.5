import { generateUuid } from 'src/utils/uuid';
import { agentMode } from 'src/utils/agent-mode';

// ----------------------------------------------------------------------

/**
 * This device's own id, made up once and kept in the browser.
 *
 * A register is paired with one device (Terminals page); the id is how the server tells that
 * device from another one set up as the same register. Clearing the browser's site data makes
 * a new device, which a manager sets up again.
 */

const STORAGE_KEY = 'gnext_device_id';

let inMemory: string | null = null;

export function readDeviceId(): string {
  if (inMemory) return inMemory;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      inMemory = stored;
      return stored;
    }
    inMemory = generateUuid();
    localStorage.setItem(STORAGE_KEY, inMemory);
  } catch {
    // Storage blocked: an id for this page load, so pairing still works until a reload.
    inMemory = inMemory || generateUuid();
  }
  return inMemory;
}

function browserName(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

function systemName(ua: string): string {
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'device';
}

/**
 * What the Terminals page calls this device, so nobody types it: the branch PC's Windows name
 * when the agent serves the app on that PC, else the browser and system, e.g. "Chrome on Android".
 */
export function deviceDisplayName(): string {
  if (agentMode?.pc_name && !agentMode.lan) return agentMode.pc_name;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return `${browserName(ua)} on ${systemName(ua)}`;
}
