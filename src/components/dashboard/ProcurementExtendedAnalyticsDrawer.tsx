import { useQuery } from "@tanstack/react-query";
import { Clock, RefreshCw, X } from "lucide-react";
import {
  fetchProcurementAnalyticsPrimary,
  fetchProcurementAnalyticsTurnaround,
  type AnalyticsKpi,
} from "../../api/procurementAnalytics";
import { timedDashApi } from "../../api/dashboardPerf";
import { DASHBOARD_QUERY_OPTIONS } from "../../api/queryPresets";
import AnalyticsKpiCard from "./analytics/AnalyticsKpiCard";
import DashboardWidgetError from "./DashboardWidgetError";
import { Skeleton } from "../Skeleton";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Drawer for RFQ Turnaround + Procurement Cycle Time.
 * Reuses the same primary + turnaround React Query keys as the dashboard
 * section — no extra ERP call when those caches are warm.
 */
export default function ProcurementExtendedAnalyticsDrawer({
  open,
  onClose,
}: Props) {
  const primaryQuery = useQuery({
    queryKey: ["procurement-analytics", "primary"],
    queryFn: () =>
      timedDashApi("Analytics API (primary KPIs)", () =>
        fetchProcurementAnalyticsPrimary(),
      ),
    enabled: open,
    ...DASHBOARD_QUERY_OPTIONS,
  });

  const turnaroundQuery = useQuery({
    queryKey: ["procurement-analytics", "turnaround"],
    queryFn: () =>
      timedDashApi("Analytics API (turnaround joins)", () =>
        fetchProcurementAnalyticsTurnaround(),
      ),
    enabled: open && primaryQuery.isSuccess,
    ...DASHBOARD_QUERY_OPTIONS,
  });

  if (!open) return null;

  const loading =
    (primaryQuery.isPending || turnaroundQuery.isPending) &&
    !primaryQuery.isError &&
    !turnaroundQuery.isError;
  const turnaround: AnalyticsKpi | null =
    turnaroundQuery.data?.rfqTurnaround ?? null;
  const cycle: AnalyticsKpi | null = turnaroundQuery.data?.cycleTime ?? null;
  const queryError = primaryQuery.error ?? turnaroundQuery.error;
  const isError = primaryQuery.isError || turnaroundQuery.isError;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] transition-opacity"
        aria-label="Close analytics drawer"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="extended-analytics-title"
        className="relative z-10 flex h-full w-full max-w-lg flex-col bg-white shadow-2xl animate-[onbFadeIn_0.2s_ease-out]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-neutral-100 px-5 py-4">
          <div>
            <h2
              id="extended-analytics-title"
              className="text-base font-bold text-neutral-900"
            >
              Procurement Analytics
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              RFQ turnaround and procurement cycle time from live ERPNext data
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {isError ? (
            <DashboardWidgetError
              title="Unable to load dashboard data"
              error={queryError}
              onRetry={() => {
                void primaryQuery.refetch();
                void turnaroundQuery.refetch();
              }}
            />
          ) : loading ? (
            <div className="grid gap-3">
              <Skeleton className="h-40 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
            </div>
          ) : (
            <div className="grid gap-3">
              <AnalyticsKpiCard
                icon={Clock}
                title="RFQ Turnaround"
                description="Average RFQ closed − created (completed only)"
                kpi={turnaround}
              />
              <AnalyticsKpiCard
                icon={RefreshCw}
                title="Procurement Cycle Time"
                description="PO submitted − Material Request submitted"
                kpi={cycle}
              />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
