import type { AxiosError } from 'axios';

import axios from 'axios';

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
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
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

  // Attach Session Token Authorization header
  const accessToken = sessionStorage.getItem('jwt_access_token');
  if (accessToken) {
    config.headers['Authorization'] = `Bearer ${accessToken}`;
  }

  return config;
});

httpClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ProblemDetails>) => {
    const isNetworkError = !error.response;
    const isServerError = !!(error.response && error.response.status >= 500);
    const skipToast = error.config?.headers?.['X-Skip-Toast'] === 'true' || (error.config as any)?.skipToast;

    if (error.response?.data) {
      const problem = error.response.data;
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
