import { Fragment, useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronDown, ChevronRight, Package, Truck } from "lucide-react";

import {
  getMaterialRequestProcurementType,
  getMaterialRequestWorkflowStatus,
  fetchProcurementQueue,
  parseForwardedItemsFromMr,
  type MaterialRequestWorkflowRecord,
} from "../../api/materialRequestWorkflow";
import type {
  MaterialRequestProcurementType,
  MaterialRequestWorkflowStatus,
} from "../../types/materialRequestWorkflow";
import StatusBadge from "../../components/StatusBadge";
import ProcurementTypeBadge from "../../components/ProcurementTypeBadge";
import ErrorState from "../../components/ErrorState";
import PaginationBar from "../../components/PaginationBar";
import { TableSkeleton } from "../../components/Skeleton";
import MaterialRequestStatusModal from "../../components/warehouse/MaterialRequestStatusModal";
import ForwardedFilterBar, {
  EMPTY_FORWARDED_FILTERS,
  type ForwardedFilters,
} from "../../components/material-requests/ForwardedFilterBar";
import { usePagination } from "../../hooks/usePagination";
import { formatDate, formatDateTime } from "../../utils/format";

/* ─── types ─────────────────────────────────────────────────────────────── */

interface ShortageItem {
  item_code: string;
  item_name: string;
  requested_qty: number;
  available_qty: number;
  forward_qty: number;
  uom: string;
  warehouse: string;
}

interface GroupedMrRow {
  mr: MaterialRequestWorkflowRecord;
  mrNumber: string;
  department: string;
  warehouse: string;
  procurementType: MaterialRequestProcurementType;
  priority: string;
  requiredDate: string;
  forwardedOn: string;
  requestedBy: string;
  warehouseRemarks: string;
  totalItems: number;
  totalRemainingQty: number;
  status: MaterialRequestWorkflowStatus;
  shortageItems: ShortageItem[];
}

const PRIORITY_HOT = new Set(["Urgent", "High"]);

/* ─── helpers ────────────────────────────────────────────────────────────── */

function forwardedOnOf(mr: MaterialRequestWorkflowRecord): string {
  if (mr.custom_forwarded_on) return mr.custom_forwarded_on;
  const raw = String(mr.custom_warehouse_remarks ?? mr.remarks ?? "");
  const m = raw.match(/\[BidSphere:Forwarded:[^|\]]*\|([^\]]+)\]/);
  return m?.[1]?.trim() || mr.modified || "";
}

function buildGroupedMrRows(
  mrs: MaterialRequestWorkflowRecord[],
): GroupedMrRow[] {
  return mrs.map((mr) => {
    const wfStatus = getMaterialRequestWorkflowStatus(mr);
    const forwardedItems = parseForwardedItemsFromMr(mr);

    const shortageItems: ShortageItem[] =
      forwardedItems.length > 0
        ? forwardedItems
            .filter((fi) => (fi.forward_qty ?? fi.shortage_qty ?? 0) > 0)
            .map((fi) => {
              const forward_qty = fi.forward_qty ?? fi.shortage_qty ?? 0;
              const requested_qty = fi.requested_qty ?? forward_qty;
              return {
                item_code: fi.item_code,
                item_name: fi.item_name ?? fi.item_code,
                requested_qty,
                available_qty:
                  fi.issued_qty ?? Math.max(0, requested_qty - forward_qty),
                forward_qty,
                uom: fi.uom ?? "Nos",
                warehouse: fi.warehouse ?? "—",
              };
            })
        : (mr.items ?? [])
            .filter((item) => (Number(item.qty) || 0) > 0)
            .map((item) => {
              const requested_qty = Number(item.qty) || 0;
              return {
                item_code: item.item_code,
                item_name: item.item_name ?? item.item_code,
                requested_qty,
                available_qty: 0,
                forward_qty: requested_qty,
                uom: item.uom ?? "Nos",
                warehouse: item.warehouse ?? "—",
              };
            });

    const totalRemainingQty = shortageItems.reduce(
      (sum, item) => sum + item.forward_qty,
      0,
    );

    return {
      mr,
      mrNumber: mr.name,
      department: mr.custom_department || mr.department || "—",
      warehouse:
        shortageItems.find((i) => i.warehouse && i.warehouse !== "—")
          ?.warehouse ?? "—",
      procurementType: getMaterialRequestProcurementType(mr),
      priority: mr.custom_priority || "Medium",
      requiredDate: mr.schedule_date ? formatDate(mr.schedule_date) : "—",
      forwardedOn: forwardedOnOf(mr),
      requestedBy: mr.custom_requested_by || mr.owner || "—",
      warehouseRemarks: mr.custom_warehouse_remarks || mr.remarks || "—",
      totalItems: shortageItems.length,
      totalRemainingQty,
      status: wfStatus,
      shortageItems,
    };
  });
}

/* ─── action cell ────────────────────────────────────────────────────────── */

function ActionCell({ mr }: { mr: MaterialRequestWorkflowRecord }) {
  // Once an RFQ is linked, offer "View RFQ" (defensive — the active queue
  // filters these into History, but a lingering row must never show Create RFQ
  // twice).
  if (mr.custom_linked_rfq) {
    return (
      <Link
        to={`/sourcing/rfq/${encodeURIComponent(mr.custom_linked_rfq)}`}
        className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-primary-600 no-underline hover:bg-neutral-50"
      >
        View RFQ
      </Link>
    );
  }

  return (
    <Link
      to={`/sourcing/rfq/new?mr=${encodeURIComponent(mr.name)}`}
      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white no-underline shadow-sm hover:bg-emerald-700"
    >
      <Truck className="h-4 w-4" />
      Create RFQ
    </Link>
  );
}

/* ─── page ───────────────────────────────────────────────────────────────── */

export default function MaterialRequestProcurementPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<ForwardedFilters>(
    EMPTY_FORWARDED_FILTERS,
  );
  const [statusMr, setStatusMr] = useState<string | null>(null);

  const { data: mrs = [], isLoading, isError, error } = useQuery({
    queryKey: ["mr-procurement-queue"],
    queryFn: fetchProcurementQueue,
    refetchOnWindowFocus: true,
  });

  // Active queue = any request Warehouse has forwarded (shortage recorded,
  // i.e. "Procurement Required" or the explicit "Forwarded to Procurement")
  // that doesn't have an RFQ yet — matches `PROCUREMENT_QUEUE_STATUSES`.
  // RFQ-created MRs move to Forwarded History.
  const allRows = useMemo(
    () =>
      buildGroupedMrRows(mrs).filter(
        (r) =>
          !r.mr.custom_linked_rfq &&
          (r.status === "Procurement Required" ||
            r.status === "Forwarded to Procurement"),
      ),
    [mrs],
  );

  const departments = useMemo(
    () => [...new Set(allRows.map((r) => r.department))].filter((d) => d !== "—").sort(),
    [allRows],
  );
  const warehouses = useMemo(
    () => [...new Set(allRows.map((r) => r.warehouse))].filter((w) => w !== "—").sort(),
    [allRows],
  );
  const priorities = useMemo(
    () => [...new Set(allRows.map((r) => r.priority))].sort(),
    [allRows],
  );

  const rows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const dateFloor = filters.forwardDate ? new Date(filters.forwardDate) : null;
    return allRows.filter((r) => {
      if (q && !(`${r.mrNumber} ${r.department}`.toLowerCase().includes(q)))
        return false;
      if (filters.department && r.department !== filters.department) return false;
      if (filters.warehouse && r.warehouse !== filters.warehouse) return false;
      if (filters.priority && r.priority !== filters.priority) return false;
      if (filters.procurementType && r.procurementType !== filters.procurementType)
        return false;
      if (dateFloor && r.forwardedOn) {
        const d = new Date(r.forwardedOn);
        if (!Number.isNaN(d.getTime()) && d < dateFloor) return false;
      }
      return true;
    });
  }, [allRows, filters]);

  useEffect(() => {
    console.log(`[Procurement] Rendering ${rows.length} records`, {
      apiReturned: mrs.length,
      afterActiveFilter: allRows.length,
      rendered: rows.map((r) => r.mrNumber),
    });
  }, [rows, allRows.length, mrs.length]);

  // Derived from a computed workflow-status roll-up (not a raw ERPNext
  // column) plus multiple free-text filters, so the fetch stays a single
  // bulk query — pagination is applied client-side over the filtered rows.
  const { page, pageSize, setPage, setPageSize } = usePagination({
    resetKey: JSON.stringify(filters),
  });
  const totalRecords = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = useMemo(
    () => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [rows, currentPage, pageSize]
  );

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
          title="Could not load Forwarded Material Requests"
          description={
            error instanceof Error
              ? error.message
              : "Failed to load forwarded Material Requests."
          }
        />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">
            Forwarded Material Requests
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Requests forwarded by Warehouse awaiting RFQ creation. Create an RFQ
            to move a request into the sourcing workflow.
          </p>
        </div>
        <Link
          to="/material-requests/history"
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-primary-600 no-underline hover:bg-neutral-50"
        >
          <Activity className="h-4 w-4" />
          Forwarded History
        </Link>
      </div>

      <ForwardedFilterBar
        value={filters}
        onChange={setFilters}
        departments={departments}
        warehouses={warehouses}
        priorities={priorities}
      />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-left">MR Number</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">Department</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">Warehouse</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">Priority</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">Required Date</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">Forwarded On</th>
                <th className="whitespace-nowrap px-4 py-3 text-center">Total Items</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Remaining Qty</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">Requested By</th>
                <th className="whitespace-nowrap px-4 py-3 text-left">Status</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Action</th>
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
                    No Material Requests are awaiting RFQ creation.
                  </td>
                </tr>
              ) : (
                pagedRows.map((row) => {
                  const isExpanded = expanded.has(row.mrNumber);
                  return (
                    <Fragment key={row.mrNumber}>
                      <tr
                        className={isExpanded ? "bg-blue-50/40" : "hover:bg-neutral-50"}
                      >
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => toggle(row.mrNumber)}
                              className="inline-flex h-6 w-6 items-center justify-center rounded border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-100"
                              title={isExpanded ? "Collapse items" : "Expand items"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                            <Link
                              to={`/material-requests/${encodeURIComponent(row.mrNumber)}`}
                              className="font-semibold text-primary-600 no-underline hover:underline"
                            >
                              {row.mrNumber}
                            </Link>
                            <ProcurementTypeBadge type={row.procurementType} withIcon={false} />
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-neutral-700">
                          {row.department}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                          {row.warehouse}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
                              PRIORITY_HOT.has(row.priority)
                                ? "bg-red-50 text-red-700"
                                : "bg-neutral-100 text-neutral-700"
                            }`}
                          >
                            {row.priority}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                          {row.requiredDate}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                          {row.forwardedOn ? formatDateTime(row.forwardedOn) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-center">
                          <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-700">
                            <Package className="h-3 w-3 text-neutral-500" />
                            {row.totalItems}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">
                          {row.totalRemainingQty}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                          {row.requestedBy}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <StatusBadge status="Forwarded to Procurement" tone="info" />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setStatusMr(row.mrNumber)}
                              className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                            >
                              <Activity className="h-3.5 w-3.5" />
                              View
                            </button>
                            <ActionCell mr={row.mr} />
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-neutral-50/70">
                          <td colSpan={COLS} className="px-6 py-4">
                            <div className="mb-2 flex items-center justify-between">
                              <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                                Shortage Line Items for {row.mrNumber}
                              </h4>
                              {row.warehouseRemarks !== "—" && (
                                <span className="text-xs text-neutral-500">
                                  <strong>Remarks:</strong> {row.warehouseRemarks}
                                </span>
                              )}
                            </div>
                            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                              <table className="min-w-full text-xs">
                                <thead className="bg-neutral-100 text-neutral-600">
                                  <tr>
                                    <th className="px-4 py-2 text-left font-semibold">Item Code</th>
                                    <th className="px-4 py-2 text-left font-semibold">Item Name</th>
                                    <th className="px-4 py-2 text-right font-semibold">Requested Qty</th>
                                    <th className="px-4 py-2 text-right font-semibold">Available Qty</th>
                                    <th className="px-4 py-2 text-right font-semibold">Remaining Qty</th>
                                    <th className="px-4 py-2 text-left font-semibold">UOM</th>
                                    <th className="px-4 py-2 text-left font-semibold">Warehouse</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                  {row.shortageItems.map((item, idx) => (
                                    <tr
                                      key={`${row.mrNumber}__item__${item.item_code}__${idx}`}
                                      className="hover:bg-neutral-50/80"
                                    >
                                      <td className="whitespace-nowrap px-4 py-2 font-mono font-medium text-neutral-800">
                                        {item.item_code}
                                      </td>
                                      <td className="px-4 py-2 text-neutral-700">
                                        {item.item_name}
                                      </td>
                                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-neutral-700">
                                        {item.requested_qty}
                                      </td>
                                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-neutral-600">
                                        {item.available_qty}
                                      </td>
                                      <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums text-amber-700">
                                        {item.forward_qty}
                                      </td>
                                      <td className="whitespace-nowrap px-4 py-2 text-neutral-600">
                                        {item.uom}
                                      </td>
                                      <td className="whitespace-nowrap px-4 py-2 text-neutral-500">
                                        {item.warehouse}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!isLoading && rows.length > 0 && (
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            totalRecords={totalRecords}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
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
