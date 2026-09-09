import type { Branch, BranchType } from 'src/api/tenantApi';

import { useState, useEffect, useContext, useCallback, createContext } from 'react';

import { tenantApi } from 'src/api/tenantApi';
import { useAuthStore } from 'src/store/useAuthStore';

// ----------------------------------------------------------------------

export type BranchContextValue = {
  branches: Branch[];
  selectedBranchId: string;
  selectedBranch: Branch | null;
  /** True when the user is working at chain level rather than inside one location. */
  isHeadOffice: boolean;
  /** The kind of site currently in scope; head office is not a site, so null there. */
  selectedBranchType: BranchType | null;
  loading: boolean;
  setSelectedBranchId: (id: string) => void;
  refreshBranches: () => Promise<void>;
};

export const BranchContext = createContext<BranchContextValue | undefined>(undefined);

export function useBranchContext(): BranchContextValue {
  const context = useContext(BranchContext);
  if (!context) {
    throw new Error('useBranchContext must be used within a BranchProvider');
  }
  return context;
}

/**
 * The same scope, but tolerant of the provider being absent.
 *
 * The router mounts <ErrorBoundary/> as the errorElement of the *root* route, so any
 * render error replaces <App/> and with it every provider inside — including this one.
 * The layout chrome then re-renders with no BranchProvider above it, and a hook that
 * throws there turns a recoverable error into a blank screen and a second throw.
 *
 * Chrome that merely reads the scope should use this and fall back to the chain-wide
 * default. A page that cannot function without a branch should keep using
 * useBranchContext and fail loudly.
 */
export function useBranchContextOptional(): BranchContextValue | undefined {
  return useContext(BranchContext);
}

const STORAGE_KEY = 'active_branch_id';

/**
 * Stored in place of a branch id when the user is at chain level. A real uuid can never
 * collide with it, and storing it explicitly is what separates "head office" from "has
 * not chosen yet" — the latter still falls through to the first branch.
 */
export const HEAD_OFFICE_SCOPE = 'HQ';

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [loading, setLoading] = useState(true);

  const fetchBranches = useCallback(async () => {
    try {
      setLoading(true);
      const list = await tenantApi.getBranches();
      setBranches(list);

      const savedId = localStorage.getItem(STORAGE_KEY);
      if (savedId === HEAD_OFFICE_SCOPE) {
        setSelectedBranchIdState(HEAD_OFFICE_SCOPE);
      } else if (savedId && list.some((b) => b.id === savedId)) {
        setSelectedBranchIdState(savedId);
      } else if (list.length > 0) {
        setSelectedBranchIdState((prev) => {
          if (prev && list.some((b) => b.id === prev)) return prev;
          const defaultBranch = list[0].id;
          try {
            localStorage.setItem(STORAGE_KEY, defaultBranch);
          } catch {
            // ignore
          }
          return defaultBranch;
        });
      }
    } catch (err) {
      console.error('Failed to load branches:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchBranches();
      return;
    }

    setBranches([]);
    setLoading(false);
  }, [fetchBranches, isAuthenticated]);

  const setSelectedBranchId = useCallback((id: string) => {
    setSelectedBranchIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }, []);

  const isHeadOffice = selectedBranchId === HEAD_OFFICE_SCOPE;

  const selectedBranch = isHeadOffice
    ? null
    : branches.find((b) => b.id === selectedBranchId) || (branches.length > 0 ? branches[0] : null);

  const value: BranchContextValue = {
    branches,
    // Head office scopes to the whole chain, and every caller already treats an empty
    // branch id as "no branch filter", so the sentinel never leaks into a request.
    selectedBranchId: isHeadOffice ? '' : selectedBranch?.id || selectedBranchId,
    selectedBranch,
    isHeadOffice,
    // Rows written before branch_type existed are storefronts, which is what they were.
    selectedBranchType: isHeadOffice ? null : selectedBranch?.branch_type ?? 'RESTAURANT',
    loading,
    setSelectedBranchId,
    refreshBranches: fetchBranches,
  };

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}
