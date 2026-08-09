import type { ProblemDetails } from 'src/api/httpClient';

import { create } from 'zustand';

import { httpClient, setCsrfToken } from 'src/api/httpClient';
import i18n, { updateDocumentDirection } from 'src/locales/i18n';

export interface UserState {
  id: string;
  username: string;
  displayName: string;
  preferredLocale: string;
  tenantId: string;
}

export interface TenantState {
  id: string;
  code: string;
  name: string;
  baseCurrency: string;
  defaultLocale: string;
  timeZone: string;
}

interface AuthStore {
  user: UserState | null;
  tenant: TenantState | null;
  csrfToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: ProblemDetails | null;
  locale: string;
  direction: 'rtl' | 'ltr';

  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
  setLocale: (locale: string) => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  tenant: null,
  csrfToken: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  locale: localStorage.getItem('gnext_locale') || 'fa',
  direction: (localStorage.getItem('gnext_locale') || 'fa') === 'fa' ? 'rtl' : 'ltr',

  login: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const response = await httpClient.post('/api/v1/auth/login', { username, password });
      const { csrfToken, user, tenant } = response.data;

      setCsrfToken(csrfToken);
      set({
        user,
        tenant,
        csrfToken,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });

      if (user.preferredLocale) {
        await get().setLocale(user.preferredLocale);
      }

      return true;
    } catch (err: any) {
      set({
        error: err as ProblemDetails,
        isLoading: false,
        isAuthenticated: false,
      });
      return false;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await httpClient.post('/api/v1/auth/logout');
    } catch (_) {
      // Ignore logout API error
    } finally {
      setCsrfToken(null);
      set({
        user: null,
        tenant: null,
        csrfToken: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  fetchMe: async () => {
    set({ isLoading: true });
    try {
      const response = await httpClient.get('/api/v1/auth/me');
      const { user, tenant, csrfToken } = response.data;

      if (csrfToken) {
        setCsrfToken(csrfToken);
      }

      set({
        user,
        tenant,
        csrfToken,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });

      if (user?.preferredLocale) {
        await get().setLocale(user.preferredLocale);
      }
    } catch (_) {
      set({
        user: null,
        tenant: null,
        csrfToken: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  setLocale: async (locale: string) => {
    if (!['en', 'fa'].includes(locale)) return;
    i18n.changeLanguage(locale);
    updateDocumentDirection(locale);

    const dir = locale === 'fa' ? 'rtl' : 'ltr';
    set({ locale, direction: dir });

    if (get().isAuthenticated) {
      try {
        await httpClient.post('/api/v1/auth/change-language', { locale });
      } catch (_) {
        // Suppress failure
      }
    }
  },

  clearError: () => set({ error: null }),
}));
