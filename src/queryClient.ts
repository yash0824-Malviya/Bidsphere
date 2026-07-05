import { QueryClient } from "@tanstack/react-query";

import { isDocNotFoundError } from "./api/erpnext";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (isDocNotFoundError(error)) return false;
        return failureCount < 1;
      },
      retryDelay: 2_000,
      // Every workflow transition (Supplier submits a quote, Legal approves,
      // Finance approves, a PO/GRN/Voucher gets created, ...) happens from a
      // DIFFERENT user's browser session — invalidateQueries() in one tab
      // can never reach another user's cache. The only way "no manual
      // refresh required" (audit Phase 6) holds cross-session is a short
      // staleTime plus refetching when the user actually looks at the tab
      // again. A previous 5-minute staleTime + refetchOnWindowFocus:false
      // meant a reviewer who'd viewed a dashboard within the last 5 minutes
      // could switch back to it and see data that was already stale by the
      // time they left. 30s keeps request volume sane (Phase 10) while
      // keeping dashboards effectively live.
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      gcTime: 10 * 60_000,
    },
  },
});
