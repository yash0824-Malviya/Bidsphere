import { create } from "zustand";

/**
 * A tiny re-render signal for the voucher store.
 *
 * The voucher/invoice/payment data is mirrored to a shared ERPNext document
 * (see `src/api/voucherSync.ts`) and cached in localStorage so the existing
 * synchronous `getAllVouchers()` reads keep working. Whenever that cache
 * changes — either from a local mutation or after pulling the shared copy —
 * `version` is bumped so any subscribed list/detail view recomputes and the
 * UI reflects the latest workflow state (no stale "Awaiting Voucher Creation").
 */
interface VoucherSyncState {
  version: number;
  hydrated: boolean;
  bump: () => void;
  setHydrated: () => void;
}

export const useVoucherSyncStore = create<VoucherSyncState>((set) => ({
  version: 0,
  hydrated: false,
  bump: () => set((s) => ({ version: s.version + 1 })),
  setHydrated: () => set({ hydrated: true }),
}));
