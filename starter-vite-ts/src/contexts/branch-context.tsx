import type { Branch } from 'src/api/tenantApi';

import { useState, useEffect, useContext, useCallback, createContext } from 'react';

import { tenantApi } from 'src/api/tenantApi';
import { useAuthStore } from 'src/store/useAuthStore';

// ----------------------------------------------------------------------

export type BranchContextValue = {
  branches: Branch[];
  selectedBranchId: string;
  selectedBranch: Branch | null;
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

const STORAGE_KEY = 'active_branch_id';

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
      if (savedId && list.some((b) => b.id === savedId)) {
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

  const selectedBranch =
    branches.find((b) => b.id === selectedBranchId) || (branches.length > 0 ? branches[0] : null);

  const value: BranchContextValue = {
    branches,
    selectedBranchId: selectedBranch?.id || selectedBranchId,
    selectedBranch,
    loading,
    setSelectedBranchId,
    refreshBranches: fetchBranches,
  };

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}
