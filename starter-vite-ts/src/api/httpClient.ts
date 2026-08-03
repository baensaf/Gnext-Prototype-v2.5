import axios, { AxiosError, AxiosRequestConfig } from 'axios';

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

export const httpClient = axios.create({
  baseURL: 'http://localhost:3000',
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
  config.headers['X-Correlation-Id'] = crypto.randomUUID();

  // Attach Accept-Language
  const currentLang = localStorage.getItem('gnext_locale') || 'fa';
  config.headers['Accept-Language'] = currentLang;

  return config;
});

httpClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ProblemDetails>) => {
    if (error.response?.data) {
      const problem = error.response.data;
      return Promise.reject(problem);
    }
    return Promise.reject({
      type: 'https://gnext.local/problems/network',
      title: 'Network Error',
      status: 0,
      code: 'NETWORK_ERROR',
      detail: error.message || 'Failed to connect to the server.',
      instance: error.config?.url || '',
      correlationId: '00000000-0000-0000-0000-000000000000',
    } as ProblemDetails);
  }
);
