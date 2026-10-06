import type { AxiosError } from 'axios';

import axios from 'axios';

import { readDeviceTerminal } from 'src/utils/device-terminal';
import { connectionProblemMessage } from 'src/utils/connection-problem';
import { isGatewayFailure, reportCloudAnswered, reportCloudUnreachable } from 'src/utils/cloud-reachability';

import { CONFIG } from 'src/global-config';

import { showErrorToast } from 'src/components/snackbar';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  instance: string;
  correlationId: string;
  fieldErrors?: Array<{ field: string; code: string; messageKey?: string; message?: string }>;
  /** What the agent said, when `detail` was replaced by the words for the cashier (see below). */
  technicalDetail?: string;
}

let csrfTokenInMemory: string | null = null;

export const setCsrfToken = (token: string | null) => {
  csrfTokenInMemory = token;
};

export const getCsrfToken = () => csrfTokenInMemory;

const generateCorrelationId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r % 4) + 8;
    return v.toString(16);
  });
};

export const httpClient = axios.create({
  baseURL: CONFIG.serverUrl || '',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

httpClient.interceptors.request.use((config) => {
  // Attach CSRF token for mutations
  if (csrfTokenInMemory && config.method && ['post', 'put', 'patch', 'delete'].includes(config.method.toLowerCase())) {
    config.headers['X-CSRF-Token'] = csrfTokenInMemory;
  }

  // Attach Correlation ID
  config.headers['X-Correlation-Id'] = generateCorrelationId();

  // Attach Accept-Language
  const currentLang = localStorage.getItem('gnext_locale') || 'fa';
  config.headers['Accept-Language'] = currentLang;

  // The register this device is set up as, so cash lands in this counter's drawer.
  const register = readDeviceTerminal();
  if (register) {
    config.headers['X-Terminal-Id'] = register.id;
  }

  // Attach Session Token Authorization header
  const accessToken = sessionStorage.getItem('jwt_access_token');
  if (accessToken) {
    config.headers['Authorization'] = `Bearer ${accessToken}`;
  }

  return config;
});

httpClient.interceptors.response.use(
  (response) => {
    reportCloudAnswered();
    return response;
  },
  (error: AxiosError<ProblemDetails>) => {
    const isNetworkError = !error.response;
    const isServerError = !!(error.response && error.response.status >= 500);
    // Whether the cloud answers (src/utils/cloud-reachability.ts): no answer at all, or a
    // gateway with no server behind it, is the cloud out of reach; any other answer is the
    // cloud answering.
    if (isNetworkError || isGatewayFailure(error.response?.status)) reportCloudUnreachable();
    else reportCloudAnswered();
    const skipToast = error.config?.headers?.['X-Skip-Toast'] === 'true' || (error.config as any)?.skipToast;

    // On a branch agent the Reconnecting bar says the cloud is out of reach (cloud-status-bar.tsx),
    // and showErrorToast stays quiet about it; a screen that needs to say more shows the
    // problem's `detail`, where the button was pressed.
    if (error.response?.data) {
      const problem = error.response.data;
      // The agent's own answer for a cloud that did not answer (§19.10): put the words for the
      // cashier where every screen already looks, in `detail`. A write that was not sent says
      // so; one that may have been saved says that, and the cart is the screen's to keep.
      const friendly = connectionProblemMessage(problem.code, error.config?.method);
      if (friendly) {
        problem.technicalDetail = problem.detail;
        problem.detail = friendly;
      }
      if (isServerError && !skipToast) {
        showErrorToast(problem);
      }
      return Promise.reject(problem);
    }

    const networkProblem: ProblemDetails = {
      type: 'https://gnext.local/problems/network',
      title: 'Network Error',
      status: 0,
      code: 'NETWORK_ERROR',
      detail: error.message || 'Failed to connect to the server.',
      instance: error.config?.url || '',
      correlationId: '00000000-0000-0000-0000-000000000000',
    };

    if (isNetworkError && !skipToast) {
      showErrorToast(networkProblem);
    }

    return Promise.reject(networkProblem);
  }
);
