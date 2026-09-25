import type { PosSource } from 'src/contexts/pos-source';
import type { TillState, CloudSession } from './agent-client';
import type { RegisterShiftState } from 'src/components/shift/use-register-shift';

import { writeDeviceTerminal } from 'src/utils/device-terminal';

import { httpClient } from 'src/api/httpClient';
import { useAuthStore } from 'src/store/useAuthStore';
import { cloudPosSource } from 'src/contexts/pos-source';

import { useRegisterShift } from 'src/components/shift/use-register-shift';

import { getTillToken } from './agent-client';

// ----------------------------------------------------------------------

/**
 * The till online (agent-protocol.md §16): the web POS's own cloud calls, sent to the agent on
 * this PC, which passes them on with the cashier's cloud session (§16.4). The page holds no cloud
 * credential; the agent adds the session, the CSRF token and the bound till.
 */

/** Fired when a cloud call finds the cloud gone or the session ended, so the till looks again. */
export const TILL_CLOUD_CHANGED = 'gnext-till-cloud-changed';

let installed = false;

/** Points the web app's HTTP client at the agent, as the till page needs it. Once per page. */
export function installTillHttp() {
  if (installed) return;
  installed = true;
  httpClient.defaults.baseURL = '';
  httpClient.interceptors.request.use((config) => {
    // The agent's local-only rules (§13.13) and the till session.
    config.headers['X-Gnext-Local'] = '1';
    const token = getTillToken();
    if (token) config.headers['X-Gnext-Till-Session'] = token;
    return config;
  });
  httpClient.interceptors.response.use(undefined, (problem) => {
    if (problem?.code === 'CLOUD_UNREACHABLE' || problem?.code === 'CLOUD_SIGN_IN_REQUIRED') {
      window.dispatchEvent(new Event(TILL_CLOUD_CHANGED));
    }
    return Promise.reject(problem);
  });
}

/**
 * The register selling through the cloud: everything the web POS does, as the cashier's role
 * allows. The register is the till the agent is bound to, so it cannot be changed here.
 */
export const tillCloudPosSource: PosSource = {
  ...cloudPosSource,
  kind: 'till',
  useRegisterShift: useTillRegisterShift,
};

function useTillRegisterShift(): RegisterShiftState {
  const shift = useRegisterShift();
  return { ...shift, setTerminal: () => undefined };
}

/**
 * Makes the web app's screens see the cashier's cloud session: who they are and the chain's
 * settings (currency, language), and the bound till as this device's register.
 */
export function adoptCloudSession(session: CloudSession, state: TillState) {
  useAuthStore.setState({
    user: session.user,
    tenant: session.tenant,
    isAuthenticated: true,
    isInitialized: true,
  });
  if (state.till && state.branch) {
    writeDeviceTerminal({ id: state.till.id, code: state.till.code, name: state.till.name, branch_id: state.branch.id });
  }
}

/** Forgets the cloud session on this page, when the cashier signs out. */
export function forgetCloudSession() {
  useAuthStore.setState({ user: null, tenant: null, isAuthenticated: false });
}
