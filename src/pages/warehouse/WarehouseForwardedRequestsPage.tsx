import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Activity, FileSearch, Search, Truck } from "lucide-react";

import {
  forwardToProcurement,
  getPendingMaterialRequests,
  getWarehouseProcurementRequiredRequests,
  invalidateForwardCaches,
  selectProcurementRequiredRows,
} from "../../services/warehouseService";
import { useAuthStore } from "../../store/authStore";
import EmptyState from "../../components/EmptyState";
import ErrorState from "../../components/ErrorState";
import { TableSkeleton } from "../../components/Skeleton";
import { formatDate } from "../../utils/format";

const PRIORITY_STYLES: Record<string, string> = {
  Urgent: "bg-rose-50 text-rose-700 border-rose-200",
  High: "bg-amber-50 text-amber-700 border-amber-200",
  Medium: "bg-blue-50 text-blue-700 border-blue-200",
  Low: "bg-slate-100 text-slate-600 border-slate-200",
};

/**
 * Warehouse → Material Requests → Procurement Required. Live ERPNext data
 * only (no local storage / mock arrays): reviewed MRs with insufficient stock
 * that have NOT yet been forwarded (`custom_bidsphere_status =
 * "Procurement Required"` AND `custom_forwarded_to_procurement != 1`). Each
 * row has "Send to Procurement", which:
 *   1. Updates ERPNext BidSphere Status → "Forwarded to Procurement"
 *   2. Saves forwarded_to_procurement / forwarded_at / forwarded_by
 *   3. Removes the MR from this queue immediately (status changed)
 *   4. Makes it visible in Procurement's "Forwarded Material Requests"
 * The full audit trail lives in "Forwarded History" (a separate page).
 */
export default function WarehouseForwardedRequestsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [search, setSearch] = useState("");
  const [forwardingMr, setForwardingMr] = useState<string | null>(null);

  // Same query key as the dashboard — React Query dedupes/caches, guaranteeing
  // identical records on both surfaces.
  const pendingQuery = useQuery({
    queryKey: ["warehouse", "pending-requests"],
    queryFn: getPendingMaterialRequests,
    retry: false,
    refetchOnWindowFocus: true,
  });
  // Genuinely-persisted "Procurement Required" MRs recorded via the detailed
  // review page — concatenated with `pendingQuery` so both the quick-action
  // and detail-review paths land in the same queue.
  const persistedQuery = useQuery({
    queryKey: ["warehouse", "procurement-required-persisted"],
    queryFn: getWarehouseProcurementRequiredRequests,
    retry: false,
    refetchOnWindowFocus: true,
  });

  const loading = pendingQuery.isLoading || persistedQuery.isLoading;

  const rows = useMemo(() => {
    const all = selectProcurementRequiredRows([
      ...(pendingQuery.data ?? []),
      ...(persistedQuery.data ?? []),
    ]);
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q)
    );
  }, [pendingQuery.data, persistedQuery.data, search]);

  const forwardMutation = useMutation({
    mutationFn: (mrName: string) =>
      forwardToProcurement(mrName, user?.email || user?.name),
    onMutate: (mrName: string) => setForwardingMr(mrName),
    onSettled: () => setForwardingMr(null),
    onSuccess: async (_res, mrName) => {
      toast.success(`${mrName} sent to Procurement.`);
      // eslint-disable-next-line no-console
      console.log("[Warehouse] Refreshing list", { mr: mrName });
      invalidateForwardCaches(queryClient);
      // Await so the MR leaves this queue immediately (no reload needed).
      await Promise.all([pendingQuery.refetch(), persistedQuery.refetch()]);
    },
    onError: (err: unknown, mrName) =>
      toast.error(
        err instanceof Error
          ? err.message
          : `Could not send ${mrName} to Procurement.`
      ),
  });

  if (pendingQuery.isError && persistedQuery.isError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <ErrorState
            title="Unable to load Material Requests."
            description="We couldn't retrieve the material requests. Please try again."
            onRetry={() => {
              void pendingQuery.refetch();
              void persistedQuery.refetch();
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Procurement Required
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Reviewed requests with insufficient stock, awaiting "Send to
            Procurement".
          </p>
        </div>
        <Link
          to="/warehouse/material-requests/history"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-primary-600 no-underline hover:bg-slate-50"
        >
          <Activity className="h-4 w-4" />
          Forwarded History
        </Link>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by MR number or department…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-4 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
      </div>

      <ProcurementRequiredTable
        loading={loading}
        rows={rows}
        search={search}
        busyMr={forwardMutation.isPending ? forwardingMr : null}
        onForward={(name) => forwardMutation.mutate(name)}
        onOpen={(name) =>
          navigate(
            `/warehouse/material-requests/review/${encodeURIComponent(name)}`
          )
        }
      />
    </div>
  );
}

/* ─── Procurement Required table ─────────────────────────────────────────── */

interface PendingRow {
  name: string;
  department: string;
  requiredDate: string;
  priority: string;
  missingItems: number;
  requiredQty: number;
  uom: string;
}

function ProcurementRequiredTable({
  loading,
  rows,
  search,
  busyMr,
  onForward,
  onOpen,
}: {
  loading: boolean;
  rows: PendingRow[];
  search: string;
  busyMr: string | null;
  onForward: (name: string) => void;
  onOpen: (name: string) => void;
}) {
  return (
    <div className="flex min-h-[300px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {loading ? (
        <div className="p-6">
          <TableSkeleton rows={6} columns={7} />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-12">
          <EmptyState
            icon={FileSearch}
            title="No material requests awaiting procurement"
            description={
              search
                ? "Adjust your search terms."
                : "All reviewed requests are either in stock or already forwarded to Procurement."
            }
          />
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-4">MR Number</th>
                <th className="px-6 py-4">Department</th>
                <th className="px-6 py-4">Required Date</th>
                <th className="px-6 py-4">Priority</th>
                <th className="px-6 py-4 text-right">Missing Items</th>
                <th className="px-6 py-4 text-right">Required Qty</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {rows.map((r) => {
                const busy = busyMr === r.name;
                return (
                  <tr key={r.name} className="transition-colors hover:bg-slate-50/75">
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        onClick={() => onOpen(r.name)}
                        className="font-semibold text-primary-600 hover:underline"
                      >
                        {r.name}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{r.department}</td>
                    <td className="px-6 py-4 text-slate-500">
                      {r.requiredDate ? formatDate(r.requiredDate) : "—"}
                    </td>
                    <td className="px-6 py-4">
                      <PriorityPill priority={r.priority} />
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-slate-700">
                      {r.missingItems}
                    </td>
                    <td className="px-6 py-4 text-right font-semibold tabular-nums text-orange-700">
                      {r.requiredQty} {r.uom}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onForward(r.name)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Truck className="h-4 w-4" />
                        {busy ? "Sending…" : "Send to Procurement"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PriorityPill({ priority }: { priority: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.Low
      }`}
    >
      {priority}
    </span>
  );
}
