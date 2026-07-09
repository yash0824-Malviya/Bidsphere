import { queryClient } from "../queryClient";
import { DASHBOARD_QUERY_OPTIONS } from "./queryPresets";
import {
  fetchDashboardCounts,
  fetchProcurementDashboardKpis,
} from "./dashboard";
import type { AppRole } from "../config/roles";

/**
 * Warm the React Query cache with a role's KPI-critical dashboard queries the
 * moment the user authenticates, so the dashboard's own `useQuery` calls
 * resolve straight from cache (instant first paint) instead of racing the
 * network on mount.
 *
 * Fire-and-forget: it never blocks the post-login navigation, uses the SAME
 * query keys + fns + staleTime as the dashboards (so the prefetched data is
 * reused, not re-requested), and only warms roles whose dashboards actually
 * use these keys — no wasted calls.
 */
export function prefetchDashboardForRole(
  role: AppRole | string | undefined,
): void {
  const warm = (queryKey: unknown[], queryFn: () => Promise<unknown>) => {
    void queryClient.prefetchQuery({
      queryKey,
      queryFn,
      staleTime: DASHBOARD_QUERY_OPTIONS.staleTime,
    });
  };

  switch (role) {
    case "procurement":
      // Single combined KPI snapshot — matches ProcurementDashboard.
      warm(["procurement-dashboard-kpis"], fetchProcurementDashboardKpis);
      break;
    case "admin":
      // AdminDashboard shares the counts query.
      warm(["dashboard-counts"], fetchDashboardCounts);
      break;
    default:
      // Other role dashboards use their own lightweight queries; nothing shared
      // to prefetch, so we skip to avoid wasted requests.
      break;
  }
}
