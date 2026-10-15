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
import { formatDate, formatDateTime } from "../../utils/format";

/** Colour tokens per lifecycle stage — keeps the neutral module palette. */
const STAGE_STYLES: Record<ProcurementStage, string> = {
  "Department Created": "bg-neutral-100 text-neutral-700",
  "Warehouse Review": "bg-neutral-100 text-neutral-700",
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

export default function MaterialRequestHistoryPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<ForwardedFilters>(
    EMPTY_FORWARDED_FILTERS,
  );
  const [statusMr, setStatusMr] = useState<string | null>(null);

  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["mr-forwarded-history"],
    queryFn: fetchForwardedHistory,
    refetchOnWindowFocus: true,
  });

  const departments = useMemo(
    () => [...new Set(data.map((r) => r.department))].filter((d) => d !== "—").sort(),
    [data],
  );
  const warehouses = useMemo(
    () => [...new Set(data.map((r) => r.warehouse))].filter((w) => w !== "—").sort(),
    [data],
  );
  const priorities = useMemo(
    () => [...new Set(data.map((r) => r.priority))].sort(),
    [data],
  );
  const stages = useMemo(
    () => [...new Set(data.map((r) => r.currentStage))].sort(),
    [data],
  );

  const rows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const dateFloor = filters.forwardDate ? new Date(filters.forwardDate) : null;
    return data.filter((r) => {
      if (q && !(`${r.mrNumber} ${r.department}`.toLowerCase().includes(q)))
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

  const COLS = 11;

  if (isError) {
    return (
      <div>
        <ErrorState
          title="Could not load Forwarded History"
          description="Failed to load the forwarded Material Request history."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-neutral-900">
            <History className="h-5 w-5 text-primary-600" />
            Forwarded History
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Every Material Request forwarded to Procurement. History is never
            deleted — track each request from forwarding through to completion.
          </p>
        </div>
        <Link
          to="/material-requests/procurement"
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-primary-600 no-underline hover:bg-neutral-50"
        >
          Active Queue
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

      <div className="card max-w-full overflow-hidden p-0 border border-neutral-200 bg-white shadow-sm">
        <div className="w-full overflow-x-auto">
          <table className="w-full table-fixed divide-y divide-neutral-200 text-left text-xs sm:text-sm">
            <colgroup>
              <col className="w-[16%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[10%]" />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
              <col className="w-[9%]" />
              <col className="w-[6%]" />
              <col className="w-[5%]" />
            </colgroup>
            <thead className="bg-neutral-50 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-3 py-2.5">MR Number</th>
                <th className="px-2 py-2.5">Department</th>
                <th className="px-2 py-2.5">Warehouse</th>
                <th className="px-2 py-2.5">Forwarded Date</th>
                <th className="px-2 py-2.5">Forwarded By</th>
                <th className="px-2 py-2.5">RFQ Number</th>
                <th className="px-2 py-2.5">RFQ Status</th>
                <th className="px-2 py-2.5">PO Number</th>
                <th className="px-2 py-2.5">Stage</th>
                <th className="px-2 py-2.5">Updated</th>
                <th className="px-2 py-2.5 text-right">View</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-200">
              {isLoading ? (
                <tr>
                  <td colSpan={COLS} className="p-0">
                    <TableSkeleton rows={6} columns={COLS} />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COLS} className="px-4 py-12 text-center text-neutral-500">
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
                      <tr className="bg-neutral-50/70">
                        <td colSpan={COLS} className="px-4 py-3">
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
    <tr className={expanded ? "bg-blue-50/40" : "hover:bg-neutral-50/80"}>
      <td className="px-3 py-2.5 align-middle">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-100"
            title={expanded ? "Collapse items" : "Expand items"}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
          <Link
            to={`/material-requests/${encodeURIComponent(row.mrNumber)}`}
            className="truncate font-mono text-[12px] font-semibold text-primary-600 hover:underline"
            title={row.mrNumber}
          >
            {row.mrNumber}
          </Link>
        </div>
      </td>
      <td className="px-2 py-2.5 align-middle">
        <div className="truncate text-xs font-medium text-neutral-700" title={row.department}>
          {row.department || "—"}
        </div>
      </td>
      <td className="px-2 py-2.5 align-middle">
        <div className="truncate text-xs text-neutral-600" title={row.warehouse}>
          {row.warehouse || "—"}
        </div>
      </td>
      <td className="px-2 py-2.5 align-middle">
        <span className="truncate block text-xs text-neutral-600">
          {row.forwardedOn ? formatDate(row.forwardedOn) : "—"}
        </span>
      </td>
      <td className="px-2 py-2.5 align-middle">
        <div className="truncate text-xs text-neutral-600" title={row.forwardedBy}>
          {row.forwardedBy || "—"}
        </div>
      </td>
      <td className="px-2 py-2.5 align-middle">
        {row.rfqNumber ? (
          <Link
            to={`/sourcing/rfq/${encodeURIComponent(row.rfqNumber)}`}
            className="truncate block font-mono text-xs font-medium text-primary-600 hover:underline"
            title={row.rfqNumber}
          >
            {row.rfqNumber}
          </Link>
        ) : (
          <span className="text-neutral-400 text-xs">—</span>
        )}
      </td>
      <td className="px-2 py-2.5 align-middle">
        <div className="truncate text-xs text-neutral-600" title={row.rfqStatus}>
          {row.rfqStatus || "—"}
        </div>
      </td>
      <td className="px-2 py-2.5 align-middle">
        {row.poNumber ? (
          <Link
            to={`/p2p/purchase-orders/${encodeURIComponent(row.poNumber)}`}
            className="truncate block font-mono text-xs font-medium text-primary-600 hover:underline"
            title={row.poNumber}
          >
            {row.poNumber}
          </Link>
        ) : (
          <span className="text-neutral-400 text-xs">—</span>
        )}
      </td>
      <td className="px-2 py-2.5 align-middle">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold truncate max-w-full ${STAGE_STYLES[row.currentStage]}`}
          title={row.currentStage}
        >
          {row.currentStage}
        </span>
      </td>
      <td className="px-2 py-2.5 align-middle">
        <span className="truncate block text-[11px] text-neutral-500" title={row.lastUpdated ? formatDateTime(row.lastUpdated) : undefined}>
          {row.lastUpdated ? formatDate(row.lastUpdated) : "—"}
        </span>
      </td>
      <td className="px-2 py-2.5 text-right align-middle">
        <button
          type="button"
          onClick={onView}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-semibold text-primary-600 hover:bg-neutral-50 shadow-sm"
          title="View workflow status"
        >
          <Activity className="h-3 w-3" />
          View
        </button>
      </td>
    </tr>
  );
}

function ItemsDrawer({ row }: { row: ForwardedHistoryRow }) {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      <table className="w-full table-fixed text-xs">
        <colgroup>
          <col className="w-[14%]" />
          <col className="w-[20%]" />
          <col className="w-[10%]" />
          <col className="w-[14%]" />
          <col className="w-[14%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[8%]" />
        </colgroup>
        <thead className="bg-neutral-100 text-neutral-600 text-[11px] font-semibold">
          <tr>
            <th className="px-3 py-1.5 text-left">Item Code</th>
            <th className="px-3 py-1.5 text-left">Item Name</th>
            <th className="px-2 py-1.5 text-right">Req Qty</th>
            <th className="px-3 py-1.5 text-left">Part Name</th>
            <th className="px-3 py-1.5 text-left">Attachments</th>
            <th className="px-2 py-1.5 text-right">Avail Qty</th>
            <th className="px-2 py-1.5 text-right">Rem Qty</th>
            <th className="px-3 py-1.5 text-left">Warehouse</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {(row.items ?? []).map((item, idx) => (
            <tr key={`${row.mrNumber}__${item.item_code}__${idx}`} className="hover:bg-neutral-50/80">
              <td className="truncate px-3 py-1.5 font-mono font-medium text-neutral-800" title={item.item_code}>
                {item.item_code}
              </td>
              <td className="truncate px-3 py-1.5 text-neutral-700" title={item.item_name}>{item.item_name}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-neutral-700">
                {item.requested_qty}
              </td>
              <td className="truncate px-3 py-1.5">
                <PartNameCell value={item.part_name} />
              </td>
              <td className="px-3 py-1.5">
                <Drawing2dCell
                  url={item.drawing_2d_url}
                  attachments={item.attachments}
                />
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-neutral-600">
                {item.available_qty}
              </td>
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-amber-700">
                {item.remaining_qty}
              </td>
              <td className="truncate px-3 py-1.5 text-neutral-500" title={item.warehouse}>{item.warehouse}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
