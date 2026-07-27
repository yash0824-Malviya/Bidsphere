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
import StatusBadge from "../../components/StatusBadge";
import { TableSkeleton } from "../../components/Skeleton";
import Pagination from "../../components/ui/Pagination";
import {
  Drawing2dCell,
  PartNameCell,
} from "../../components/warehouse/EngineeringDocCells";
import MaterialRequestStatusModal from "../../components/warehouse/MaterialRequestStatusModal";
import ForwardedFilterBar, {
  EMPTY_FORWARDED_FILTERS,
  type ForwardedFilters,
} from "../../components/material-requests/ForwardedFilterBar";
import { useClientPagination } from "../../hooks/usePagination";
import { formatDate } from "../../utils/format";

const STAGE_TONES: Record<
  ProcurementStage,
  "neutral" | "info" | "warning" | "pending" | "success" | "closed"
> = {
  "Department Created": "neutral",
  "Warehouse Review": "neutral",
  "Sent to Procurement": "warning",
  "RFQ Created": "info",
  "Supplier Quotations": "info",
  "Reverse Bidding": "pending",
  "AI Recommendation": "pending",
  "Legal Review": "info",
  "Finance Review": "info",
  "Purchase Order": "info",
  GRN: "success",
  Completed: "success",
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
      if (filters.requestMode && r.requestMode !== filters.requestMode)
        return false;
      if (filters.status && r.currentStage !== filters.status) return false;
      if (dateFloor && r.forwardedOn) {
        const d = new Date(r.forwardedOn);
        if (!Number.isNaN(d.getTime()) && d < dateFloor) return false;
      }
      return true;
    });
  }, [data, filters]);

  const {
    pageRows,
    totalRecords,
    totalPages,
    currentPage,
    pageSize,
    setPage,
    setPageSize,
  } = useClientPagination(rows, {
    resetKey: `${filters.search}|${filters.department}|${filters.warehouse}|${filters.priority}|${filters.procurementType}|${filters.requestMode}|${filters.status}|${filters.forwardDate}`,
  });

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
      <div className="w-full">
        <ErrorState
          title="Could not load Forwarded History"
          description="Failed to load the forwarded Material Request history."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
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
          className="btn-secondary no-underline"
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
          <table className="data-table">
            <thead>
              <tr>
                <th>MR Number</th>
                <th>Forwarded Date</th>
                <th>Forwarded By</th>
                <th>Current Status</th>
                <th>RFQ Number</th>
                <th>PO Number</th>
                <th>Current Stage</th>
                <th className="text-right">View</th>
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
                pageRows.map((row) => (
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
        {!isLoading && rows.length > 0 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalRecords={totalRecords}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            recordLabel="requests"
          />
        )}
      </div>

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
      <td className="whitespace-nowrap px-4 py-3">
        <StatusBadge status={row.status} />
      </td>
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
        <StatusBadge
          status={row.currentStage}
          tone={STAGE_TONES[row.currentStage]}
        />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        <button type="button" onClick={onView} className="btn-secondary">
          <Activity className="h-3.5 w-3.5" />
          View
        </button>
      </td>
    </tr>
  );
}

function ItemsDrawer({ row }: { row: ForwardedHistoryRow }) {
  return (
    <div className="overflow-x-auto overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            <th className="px-4 py-2 text-left font-semibold">Item Code</th>
            <th className="px-4 py-2 text-left font-semibold">Item Name</th>
            <th className="px-4 py-2 text-right font-semibold">Requested Qty</th>
            <th className="px-4 py-2 text-left font-semibold">Part Name</th>
            <th className="px-4 py-2 text-left font-semibold">Attachments</th>
            <th className="px-4 py-2 text-right font-semibold">Available Qty</th>
            <th className="px-4 py-2 text-right font-semibold">Remaining Qty</th>
            <th className="px-4 py-2 text-left font-semibold">Warehouse</th>
            <th className="px-4 py-2 text-left font-semibold">Remarks</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {(row.items ?? []).map((item, idx) => (
            <tr key={`${row.mrNumber}__${item.item_code}__${idx}`} className="hover:bg-slate-50/80">
              <td className="whitespace-nowrap px-4 py-2 font-mono font-medium text-slate-800">
                {item.item_code}
              </td>
              <td className="px-4 py-2 text-slate-700">{item.item_name}</td>
              <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-700">
                {item.requested_qty}
              </td>
              <td className="px-4 py-2">
                <PartNameCell value={item.part_name} />
              </td>
              <td className="px-4 py-2">
                <Drawing2dCell
                  url={item.drawing_2d_url}
                  attachments={item.attachments}
                />
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
