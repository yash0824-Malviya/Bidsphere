import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronDown, ChevronRight, History } from "lucide-react";

import {
  fetchForwardedHistory,
  type ForwardedHistoryRow,
  type ProcurementStage,
} from "../../api/forwardedMaterialRequests";
import ErrorState from "../../components/ErrorState";
import { TableSkeleton } from "../../components/Skeleton";
import MaterialRequestStatusModal from "../../components/warehouse/MaterialRequestStatusModal";
import ForwardedFilterBar, {
  EMPTY_FORWARDED_FILTERS,
  type ForwardedFilters,
} from "../../components/material-requests/ForwardedFilterBar";
import { formatDate } from "../../utils/format";

const STAGE_STYLES: Record<ProcurementStage, string> = {
  "Department Created": "bg-slate-100 text-slate-700",
  "Warehouse Review": "bg-slate-100 text-slate-700",
  "Sent to Procurement": "bg-amber-50 text-amber-700",
  "RFQ Created": "bg-blue-50 text-blue-700",
  "Supplier Quotations": "bg-blue-50 text-blue-700",
  "Reverse Bidding": "bg-indigo-50 text-indigo-700",
  "AI Recommendation": "bg-indigo-50 text-indigo-700",
  "Legal Review": "bg-purple-50 text-purple-700",
  "Finance Review": "bg-purple-50 text-purple-700",
  "Purchase Order": "bg-cyan-50 text-cyan-700",
  GRN: "bg-emerald-50 text-emerald-700",
  Completed: "bg-emerald-100 text-emerald-800",
};

/**
 * Warehouse → Material Requests → Forwarded History. Every MR the warehouse
 * has ever forwarded to Procurement, never deleted — shares the same live
 * ERPNext-derived dataset (`fetchForwardedHistory`) as the Procurement side,
 * so both surfaces always agree, just presented with warehouse-relevant
 * columns (Current Status, RFQ Number, PO Number, Current Stage).
 */
export default function WarehouseForwardedHistoryPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<ForwardedFilters>(
    EMPTY_FORWARDED_FILTERS
  );
  const [statusMr, setStatusMr] = useState<string | null>(null);

  const {
    data = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["mr-forwarded-history"],
    queryFn: fetchForwardedHistory,
    refetchOnWindowFocus: true,
  });

  const departments = useMemo(
    () => [...new Set(data.map((r) => r.department))].filter((d) => d !== "—").sort(),
    [data]
  );
  const warehouses = useMemo(
    () => [...new Set(data.map((r) => r.warehouse))].filter((w) => w !== "—").sort(),
    [data]
  );
  const priorities = useMemo(
    () => [...new Set(data.map((r) => r.priority))].sort(),
    [data]
  );
  const stages = useMemo(
    () => [...new Set(data.map((r) => r.currentStage))].sort(),
    [data]
  );

  const rows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const dateFloor = filters.forwardDate ? new Date(filters.forwardDate) : null;
    return data.filter((r) => {
      if (q && !`${r.mrNumber} ${r.department}`.toLowerCase().includes(q))
        return false;
      if (filters.department && r.department !== filters.department) return false;
      if (filters.warehouse && r.warehouse !== filters.warehouse) return false;
      if (filters.priority && r.priority !== filters.priority) return false;
      if (filters.procurementType && r.procurementType !== filters.procurementType)
        return false;
      if (filters.status && r.currentStage !== filters.status) return false;
      if (dateFloor && r.forwardedOn) {
        const d = new Date(r.forwardedOn);
        if (!Number.isNaN(d.getTime()) && d < dateFloor) return false;
      }
      return true;
    });
  }, [data, filters]);

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const COLS = 8;

  if (isError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <ErrorState
          title="Could not load Forwarded History"
          description="Failed to load the forwarded Material Request history."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <History className="h-5 w-5 text-primary-600" />
            Forwarded History
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Every Material Request this warehouse has sent to Procurement.
            History is never deleted — track each request through to
            completion.
          </p>
        </div>
        <Link
          to="/warehouse/material-requests/forwarded"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-primary-600 no-underline hover:bg-slate-50"
        >
          Procurement Required
        </Link>
      </div>

      <ForwardedFilterBar
        value={filters}
        onChange={setFilters}
        departments={departments}
        warehouses={warehouses}
        priorities={priorities}
        statuses={stages}
      />

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-left">MR Number</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">Forwarded Date</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">Forwarded By</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">Current Status</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">RFQ Number</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">PO Number</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">Current Stage</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">View</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {isLoading ? (
                <tr>
                  <td colSpan={COLS} className="p-0">
                    <TableSkeleton rows={6} columns={COLS} />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COLS} className="px-4 py-12 text-center text-slate-500">
                    No forwarded Material Requests yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <Fragment key={row.mrNumber}>
                    <HistoryRow
                      row={row}
                      expanded={expanded.has(row.mrNumber)}
                      onToggle={() => toggle(row.mrNumber)}
                      onView={() => setStatusMr(row.mrNumber)}
                    />
                    {expanded.has(row.mrNumber) && (
                      <tr className="bg-slate-50/70">
                        <td colSpan={COLS} className="px-6 py-4">
                          <ItemsDrawer row={row} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!isLoading && rows.length > 0 && (
        <p className="text-xs text-slate-500">
          {rows.length} of {data.length} forwarded Material Request(s).
        </p>
      )}

      {statusMr && (
        <MaterialRequestStatusModal
          mrName={statusMr}
          onClose={() => setStatusMr(null)}
        />
      )}
    </div>
  );
}

function HistoryRow({
  row,
  expanded,
  onToggle,
  onView,
}: {
  row: ForwardedHistoryRow;
  expanded: boolean;
  onToggle: () => void;
  onView: () => void;
}) {
  return (
    <tr className={expanded ? "bg-blue-50/40" : "hover:bg-slate-50"}>
      <td className="whitespace-nowrap px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-100"
            title={expanded ? "Collapse items" : "Expand items"}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onView}
            className="font-semibold text-primary-600 hover:underline"
          >
            {row.mrNumber}
          </button>
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
        {row.forwardedOn ? formatDate(row.forwardedOn) : "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{row.forwardedBy || "—"}</td>
      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{row.status}</td>
      <td className="whitespace-nowrap px-4 py-3">
        {row.rfqNumber ? (
          <Link
            to={`/sourcing/rfq/${encodeURIComponent(row.rfqNumber)}`}
            className="font-medium text-primary-600 no-underline hover:underline"
          >
            {row.rfqNumber}
          </Link>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        {row.poNumber ? (
          <Link
            to={`/p2p/purchase-orders/${encodeURIComponent(row.poNumber)}`}
            className="font-medium text-primary-600 no-underline hover:underline"
          >
            {row.poNumber}
          </Link>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STAGE_STYLES[row.currentStage]}`}
        >
          {row.currentStage}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        <button
          type="button"
          onClick={onView}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-primary-600 hover:bg-slate-50"
        >
          <Activity className="h-3.5 w-3.5" />
          View
        </button>
      </td>
    </tr>
  );
}

function ItemsDrawer({ row }: { row: ForwardedHistoryRow }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            <th className="px-4 py-2 text-left font-semibold">Item Code</th>
            <th className="px-4 py-2 text-left font-semibold">Item Name</th>
            <th className="px-4 py-2 text-right font-semibold">Requested Qty</th>
            <th className="px-4 py-2 text-right font-semibold">Available Qty</th>
            <th className="px-4 py-2 text-right font-semibold">Remaining Qty</th>
            <th className="px-4 py-2 text-left font-semibold">Warehouse</th>
            <th className="px-4 py-2 text-left font-semibold">Remarks</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {row.items.map((item, idx) => (
            <tr key={`${row.mrNumber}__${item.item_code}__${idx}`} className="hover:bg-slate-50/80">
              <td className="whitespace-nowrap px-4 py-2 font-mono font-medium text-slate-800">
                {item.item_code}
              </td>
              <td className="px-4 py-2 text-slate-700">{item.item_name}</td>
              <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-700">
                {item.requested_qty}
              </td>
              <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-600">
                {item.available_qty}
              </td>
              <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums text-amber-700">
                {item.remaining_qty}
              </td>
              <td className="whitespace-nowrap px-4 py-2 text-slate-500">{item.warehouse}</td>
              <td className="px-4 py-2 text-slate-400">—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
