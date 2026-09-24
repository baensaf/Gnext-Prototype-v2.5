import type { Branch, BranchType } from 'src/api/tenantApi';
import type { WorkspaceScope } from 'src/config/role-access';

import { useState, useEffect, useContext, useCallback, createContext } from 'react';

import { tenantApi } from 'src/api/tenantApi';
import { useAuthStore } from 'src/store/useAuthStore';

// ----------------------------------------------------------------------

export type BranchContextValue = {
  branches: Branch[];
  /** True when the signed-in account may choose a scope at all. */
  canChangeScope: boolean;
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

/** The header's scope in the shape `fitsWorkspace` reads; null while there is none. */
export function useWorkspaceScope(): WorkspaceScope | null {
  const branchScope = useBranchContextOptional();
  if (!branchScope) return null;
  return { isHeadOffice: branchScope.isHeadOffice, branchType: branchScope.selectedBranchType };
}

/**
 * Keeps a page's branch field in step with the switcher in the header.
 *
 * Pages held their own branch state, seeded to an empty string or - in one case - a
 * hardcoded id matching no real branch, so the header could say one thing while the grid
 * below showed another and the switcher looked decorative.
 *
 * A page may still change the value locally to drill into another site; choosing a new
 * scope in the header resets it, because that is the broader intent of the two. At head
 * office the value is empty, which every caller already reads as "no branch filter".
 */
export function useScopedBranchId(): [string, (id: string) => void] {
  const branchScope = useBranchContextOptional();
  const scopedId = branchScope?.selectedBranchId ?? '';

  const [branchId, setBranchId] = useState(scopedId);

  useEffect(() => {
    setBranchId(scopedId);
  }, [scopedId]);

  return [branchId, setBranchId];
}

const STORAGE_KEY = 'active_branch_id';

/**
 * Stored in place of a branch id when the user is at chain level. A real uuid can never
 * collide with it, and storing it explicitly is what separates "head office" from "has
 * not chosen yet". An unconfined account that has not chosen starts at head office too.
 */
export const HEAD_OFFICE_SCOPE = 'HQ';

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  // An account pinned to a branch has exactly one scope. Confining it here rather than
  // in each screen means there is one place the rule can be got wrong.
  const userBranchId = user?.branchId ?? null;
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

      if (userBranchId) {
        // Not a preference: a branch account cannot be at head office, and a stale
        // localStorage entry from a previous sign-in must not survive into this one.
        setSelectedBranchIdState(userBranchId);
        try {
          localStorage.setItem(STORAGE_KEY, userBranchId);
        } catch {
          // ignore
        }
        return;
      }

      const savedId = localStorage.getItem(STORAGE_KEY);
      if (savedId === HEAD_OFFICE_SCOPE) {
        setSelectedBranchIdState(HEAD_OFFICE_SCOPE);
      } else if (savedId && list.some((b) => b.id === savedId)) {
        setSelectedBranchIdState(savedId);
      } else {
        // No choice made yet, or the saved branch is gone. An unconfined account starts at
        // head office: dropping it into whichever branch sorts first hid the chain's setup
        // from the menu until the switcher was found. Not saved, so it stays "not chosen".
        setSelectedBranchIdState((prev) =>
          prev && list.some((b) => b.id === prev) ? prev : HEAD_OFFICE_SCOPE
        );
      }
    } catch (err) {
      console.error('Failed to load branches:', err);
    } finally {
      setLoading(false);
    }
  }, [userBranchId]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchBranches();
      return;
    }

    setBranches([]);
    setLoading(false);
  }, [fetchBranches, isAuthenticated]);

  const setSelectedBranchId = useCallback((id: string) => {
    // A branch account has one scope; ignoring the request is better than appearing to
    // honour it and then showing another location's data.
    if (userBranchId && id !== userBranchId) return;

    setSelectedBranchIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }, [userBranchId]);

  const isHeadOffice = !userBranchId && selectedBranchId === HEAD_OFFICE_SCOPE;

  const selectedBranch = isHeadOffice
    ? null
    : branches.find((b) => b.id === selectedBranchId) || (branches.length > 0 ? branches[0] : null);

  const value: BranchContextValue = {
    // A branch account is only ever shown its own location, so a switcher it cannot use
    // does not list places it cannot reach.
    branches: userBranchId ? branches.filter((b) => b.id === userBranchId) : branches,
    canChangeScope: !userBranchId,
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
