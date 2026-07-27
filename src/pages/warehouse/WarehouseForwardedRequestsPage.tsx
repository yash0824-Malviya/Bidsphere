import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, Eye, FileSearch } from "lucide-react";

import {
  getPendingMaterialRequests,
  getWarehouseProcurementRequiredRequests,
  selectProcurementRequiredRows,
} from "../../services/warehouseService";
import EmptyState from "../../components/EmptyState";
import ErrorState from "../../components/ErrorState";
import StatusBadge from "../../components/StatusBadge";
import { TableSkeleton } from "../../components/Skeleton";
import { SearchInput } from "../../components/ui";
import { formatDate } from "../../utils/format";

/**
 * Warehouse → Material Requests → Procurement Required.
 *
 * Lists requests awaiting final warehouse processing (stock decision).
 * There is NO "Send to Procurement" on this page — forwarding happens only via
 * "Confirm & Process All Decisions" on the Stock Decision page.
 */
export default function WarehouseForwardedRequestsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const pendingQuery = useQuery({
    queryKey: ["warehouse", "pending-requests"],
    queryFn: getPendingMaterialRequests,
    retry: false,
    refetchOnWindowFocus: true,
  });
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
        r.department.toLowerCase().includes(q),
    );
  }, [pendingQuery.data, persistedQuery.data, search]);

  if (pendingQuery.isError && persistedQuery.isError) {
    return (
      <div className="w-full">
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
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Procurement Required
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Pending requests awaiting final warehouse processing. Open a request
            to review stock and confirm decisions.
          </p>
        </div>
        <Link
          to="/warehouse/material-requests/history"
          className="btn-secondary no-underline"
        >
          <Activity className="h-4 w-4" />
          Forwarded History
        </Link>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
        <div className="flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by MR number or department…"
          />
        </div>
      </div>

      <ProcurementRequiredTable
        loading={loading}
        rows={rows}
        search={search}
        onOpen={(name) =>
          navigate(
            `/warehouse/material-requests/review/${encodeURIComponent(name)}`,
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
  onOpen,
}: {
  loading: boolean;
  rows: PendingRow[];
  search: string;
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
            title="No material requests awaiting warehouse processing"
            description={
              search
                ? "Adjust your search terms."
                : "All reviewed requests are either in stock or already forwarded to Procurement."
            }
          />
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>MR Number</th>
                <th>Department</th>
                <th>Required Date</th>
                <th>Priority</th>
                <th className="text-right">Missing Items</th>
                <th className="text-right">Required Qty</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>
                    <button
                      type="button"
                      onClick={() => onOpen(r.name)}
                      className="table-link"
                    >
                      {r.name}
                    </button>
                  </td>
                  <td className="text-slate-600">{r.department}</td>
                  <td className="text-slate-500">
                    {r.requiredDate ? formatDate(r.requiredDate) : "—"}
                  </td>
                  <td>
                    <StatusBadge
                      status={r.priority}
                      tone={
                        r.priority === "Urgent"
                          ? "danger"
                          : r.priority === "High"
                            ? "warning"
                            : r.priority === "Medium"
                              ? "info"
                              : "neutral"
                      }
                    />
                  </td>
                  <td className="text-right tabular-nums text-slate-700">
                    {r.missingItems}
                  </td>
                  <td className="text-right font-semibold tabular-nums text-orange-700">
                    {r.requiredQty} {r.uom}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => onOpen(r.name)}
                      className="btn-secondary"
                    >
                      <Eye className="h-4 w-4" />
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
