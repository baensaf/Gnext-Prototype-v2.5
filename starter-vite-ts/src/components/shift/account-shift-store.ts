import { create } from 'zustand';

// ----------------------------------------------------------------------

export type AccountShift = {
  shiftId: string;
  registerName: string;
  shiftNumber: string;
  openedAt: string;
  /** Left open from an earlier day. */
  openedEarlier: boolean;
  close: () => void;
};

/**
 * The shift open at the register on screen, for the account drawer to show and close. The
 * register publishes it while it is mounted, so the drawer and the register act on one shift.
 */
export const useAccountShift = create<{ shift: AccountShift | null; set: (shift: AccountShift | null) => void }>(
  (set) => ({ shift: null, set: (shift) => set({ shift }) })
);
