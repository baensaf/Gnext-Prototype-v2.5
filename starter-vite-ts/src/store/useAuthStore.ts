import type { ProblemDetails } from 'src/api/httpClient';

import { create } from 'zustand';

import { isSessionUnknown } from 'src/utils/connection-problem';

import { httpClient, setCsrfToken } from 'src/api/httpClient';
import i18n, { updateDocumentDirection } from 'src/locales/i18n';

/**
 * Set only when an operator picks a language, never by the default.
 *
 * `gnext_locale` records what the app is currently showing, default included, so it cannot
 * answer "did anybody choose this?" — and treating it as if it could is what let a fresh
 * browser overwrite an account's saved preference with Persian.
 */
const LOCALE_CHOSEN_KEY = 'gnext_locale_chosen';

/**
 * Set while this tab holds a signed-in session. The session itself is an HttpOnly cookie the page
 * cannot see, so this is how a reload knows there was one to wait for when `/auth/me` cannot be
 * answered. Per tab, like the session: sessionStorage.
 */
const SESSION_HINT_KEY = 'gnext_session_hint';

function hasSessionHint(): boolean {
  try {
    return sessionStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function setSessionHint(on: boolean) {
  try {
    if (on) sessionStorage.setItem(SESSION_HINT_KEY, '1');
    else sessionStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Storage blocked: a reload while Gnext is away then shows the sign-in page, as it used to.
  }
}

export interface UserState {
  id: string;
  username: string;
  displayName: string;
  preferredLocale: string;
  tenantId: string;
  role?: string;
  /** null means the account is not confined to one location. */
  branchId?: string | null;
  /** True when the account may act for the organization rather than a single site. */
  isHeadOffice?: boolean;
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
  isInitialized: boolean;
  /**
   * True while it is not known whether the session is good, because `/auth/me` could not be
   * answered (Gnext is out of reach) and this tab had a session. Not signed out: the app waits
   * and asks again, and only a real answer, 200 or 401, ends it.
   */
  sessionUnknown: boolean;
  isLoading: boolean;
  error: ProblemDetails | null;
  locale: string;
  direction: 'rtl' | 'ltr';

  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
  /**
   * `persist: false` when we are adopting a locale the server already holds — hydrating a
   * session is not the user changing their language, and writing it back made every page
   * load post the same value four times.
   */
  setLocale: (locale: string, options?: { persist?: boolean }) => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  tenant: null,
  csrfToken: null,
  isAuthenticated: false,
  isInitialized: false,
  sessionUnknown: false,
  isLoading: false,
  error: null,
  // Persian is the default for a browser that has never chosen: this is an Iranian chain
  // and the register runs in Farsi. Nothing is written to the account on that basis — see
  // login below, where an unchosen default no longer overrides a saved preference.
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
        isInitialized: true,
        sessionUnknown: false,
        isLoading: false,
        error: null,
      });
      setSessionHint(true);

      // A language picked on the login screen is a real choice and follows the operator in;
      // the Persian default is not, and used to be handed to the account and saved, so
      // signing in on a clean machine quietly rewrote a saved preference.
      //
      // `gnext_locale` cannot tell the two apart — i18n writes the default into it on first
      // paint, before anybody has touched anything. Only a deliberate pick leaves the marker
      // below, which is why that is what gets read here.
      const chosen = localStorage.getItem(LOCALE_CHOSEN_KEY);
      const activeLocale = chosen || user.preferredLocale || 'fa';
      await get().setLocale(activeLocale, {
        persist: chosen !== null && chosen !== user.preferredLocale,
      });

      return true;
    } catch (err: any) {
      set({
        error: err as ProblemDetails,
        isLoading: false,
        isAuthenticated: false,
        isInitialized: true,
      });
      return false;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await httpClient.post('/api/v1/auth/logout');
    } catch {
      // Ignore logout API error
    } finally {
      setSessionHint(false);
      setCsrfToken(null);
      set({
        user: null,
        tenant: null,
        csrfToken: null,
        isAuthenticated: false,
        isInitialized: true,
        sessionUnknown: false,
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
        isInitialized: true,
        sessionUnknown: false,
        isLoading: false,
        error: null,
      });
      setSessionHint(true);

      // The account's own setting, read back from the server. Adopting it is not a change.
      if (user?.preferredLocale) {
        await get().setLocale(user.preferredLocale, { persist: false });
      }
    } catch (err) {
      // Gnext did not answer. That says nothing about the session:
      //  - someone already signed in stays so (a screen asking again must not drop them);
      //  - a tab that had a session waits to hear, and the app asks again (ProtectedRoute);
      //  - otherwise it is signed out, as when the answer is 401.
      if (isSessionUnknown(err)) {
        if (get().isAuthenticated) {
          set({ isLoading: false });
          return;
        }
        if (hasSessionHint()) {
          set({ sessionUnknown: true, isLoading: false });
          return;
        }
      }
      setSessionHint(false);
      set({
        user: null,
        tenant: null,
        csrfToken: null,
        isAuthenticated: false,
        isInitialized: true,
        sessionUnknown: false,
        isLoading: false,
      });
    }
  },

  setLocale: async (locale: string, options?: { persist?: boolean }) => {
    if (!['en', 'fa'].includes(locale)) return;

    // Callers that leave `persist` alone are UI controls: somebody picked this language.
    // Hydration passes false, because adopting what the server already holds is not a pick.
    const persist = options?.persist ?? true;
    if (persist) localStorage.setItem(LOCALE_CHOSEN_KEY, locale);

    i18n.changeLanguage(locale);
    updateDocumentDirection(locale);

    const dir = locale === 'fa' ? 'rtl' : 'ltr';
    set({ locale, direction: dir });

    // Only a change the operator actually made is worth a write. Session hydration runs on
    // every page load, and posting the locale it just read turned each one into four writes
    // of a value nobody touched. Comparing against the current locale instead of taking the
    // caller's word would suppress the login-screen choice, which matches by the time this
    // runs — the call site knows whether this is a change, and says so.
    if (get().isAuthenticated && persist) {
      try {
        await httpClient.post('/api/v1/auth/change-language', { locale });
      } catch {
        // Suppress failure
      }
    }
  },

  clearError: () => set({ error: null }),
}));

/**
 * Whether the signed-in account acts for the chain rather than for one site.
 *
 * The server decides this — a head-office role AND no branch confinement — and sends it
 * on `/auth/me`. Unknown reads as head office on purpose: the flag is briefly absent while
 * that call is in flight, and blanking the chain's screens for a moment on every page load
 * would be a worse lie than showing them.
 */
export function useIsHeadOffice(): boolean {
  return useAuthStore((state) => state.user?.isHeadOffice) !== false;
}
