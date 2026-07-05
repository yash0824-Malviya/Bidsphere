import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Truck, Package } from "lucide-react";

import {
  getMaterialRequestWorkflowStatus,
  fetchProcurementQueue,
  parseForwardedItemsFromMr,
  type MaterialRequestWorkflowRecord,
} from "../../api/materialRequestWorkflow";
import type { MaterialRequestWorkflowStatus } from "../../types/materialRequestWorkflow";
import { canCreateRfqFromMaterialRequest } from "../../api/createRFQFromMaterialRequest";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import ErrorState from "../../components/ErrorState";
import { TableSkeleton } from "../../components/Skeleton";
import { formatDate } from "../../utils/format";

/* ─── types ─────────────────────────────────────────────────────────────── */

interface ShortageItem {
  item_code: string;
  item_name: string;
  forward_qty: number;
  uom: string;
  warehouse: string;
}

interface GroupedMrRow {
  mr: MaterialRequestWorkflowRecord;
  mrNumber: string;
  department: string;
  priority: string;
  requiredDate: string;
  warehouseRemarks: string;
  totalItems: number;
  totalRemainingQty: number;
  status: MaterialRequestWorkflowStatus;
  shortageItems: ShortageItem[];
}

/* ─── helpers ────────────────────────────────────────────────────────────── */

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
            .map((fi) => ({
              item_code: fi.item_code,
              item_name: fi.item_name ?? fi.item_code,
              forward_qty: fi.forward_qty ?? fi.shortage_qty ?? 0,
              uom: fi.uom ?? "Nos",
              warehouse: fi.warehouse ?? "—",
            }))
        : (mr.items ?? [])
            .filter((item) => (Number(item.qty) || 0) > 0)
            .map((item) => ({
              item_code: item.item_code,
              item_name: item.item_name ?? item.item_code,
              forward_qty: Number(item.qty) || 0,
              uom: item.uom ?? "Nos",
              warehouse: item.warehouse ?? "—",
            }));

    const totalRemainingQty = shortageItems.reduce(
      (sum, item) => sum + item.forward_qty,
      0,
    );

    return {
      mr,
      mrNumber: mr.name,
      department: mr.custom_department || mr.department || "—",
      priority: mr.custom_priority || "Medium",
      requiredDate: formatDate(mr.schedule_date),
      warehouseRemarks: mr.custom_warehouse_remarks || mr.remarks || "—",
      totalItems: shortageItems.length,
      totalRemainingQty,
      status: wfStatus,
      shortageItems,
    };
  });
}

function rowHasRfq(row: GroupedMrRow): boolean {
  return row.status === "RFQ Created" || Boolean(row.mr.custom_linked_rfq);
}

function rowStatusLabel(row: GroupedMrRow): string {
  return rowHasRfq(row) ? "RFQ Created" : "Procurement Required";
}

function rowStatusTone(row: GroupedMrRow): "warning" | "info" {
  return rowHasRfq(row) ? "info" : "warning";
}

/* ─── action cell ────────────────────────────────────────────────────────── */

function ActionCell({ mr }: { mr: MaterialRequestWorkflowRecord }) {
  // Once an RFQ is linked, always offer "View RFQ" — even if the workflow status
  // hasn't caught up — so the queue never shows a duplicate "Create RFQ".
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

  if (canCreateRfqFromMaterialRequest(mr)) {
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

  return <span className="text-neutral-400">—</span>;
}

/* ─── page ───────────────────────────────────────────────────────────────── */

export default function MaterialRequestProcurementPage() {
  const [expandedMrNames, setExpandedMrNames] = useState<Set<string>>(
    new Set(),
  );

  const { data: mrs = [], isLoading, isError, error } = useQuery({
    queryKey: ["mr-procurement-queue"],
    queryFn: fetchProcurementQueue,
  });

  const groupedRows = useMemo(() => buildGroupedMrRows(mrs), [mrs]);

  const toggleExpand = (mrName: string) => {
    setExpandedMrNames((prev) => {
      const next = new Set(prev);
      if (next.has(mrName)) next.delete(mrName);
      else next.add(mrName);
      return next;
    });
  };

  const COLS = 8;

  if (isError) {
    return (
      <div>
        <PageHeader
          title="Procurement Queue"
          description="Material Requests forwarded by Warehouse grouped with item-level shortage quantities."
        />
        <ErrorState
          title="Could not load Procurement Queue"
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
      <PageHeader
        title="Procurement Queue"
        description="Material Requests forwarded by Warehouse grouped with item-level shortage quantities."
      />

      <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-blue-900">
        All shortage items belonging to the same Material Request are grouped together.
        Click <strong>Create RFQ</strong> to start a single RFQ prefilled with all remaining shortage items.
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-left">
                  MR Number
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left">
                  Department
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left">
                  Priority
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left">
                  Required Date
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-center">
                  Total Items
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right">
                  Total Remaining Qty
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left">
                  Status
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right">
                  Action
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-200">
              {isLoading ? (
                <tr>
                  <td colSpan={COLS} className="p-0">
                    <TableSkeleton rows={6} columns={COLS} />
                  </td>
                </tr>
              ) : groupedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={COLS}
                    className="px-4 py-12 text-center text-neutral-500"
                  >
                    No Material Requests have been forwarded to Procurement yet.
                  </td>
                </tr>
              ) : (
                groupedRows.map((row) => {
                  const isExpanded = expandedMrNames.has(row.mrNumber);
                  return (
                    <tr key={row.mrNumber} className="group">
                      <td colSpan={COLS} className="p-0">
                        {/* Summary Row */}
                        <div
                          className={`flex items-center justify-between px-4 py-3.5 transition-colors ${
                            isExpanded ? "bg-blue-50/40" : "hover:bg-neutral-50"
                          }`}
                        >
                          <div className="grid flex-1 grid-cols-8 items-center gap-4">
                            {/* 1. MR Number + Expand Toggle */}
                            <div className="col-span-1 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => toggleExpand(row.mrNumber)}
                                className="inline-flex h-6 w-6 items-center justify-center rounded border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-100"
                                title={
                                  isExpanded ? "Collapse items" : "Expand items"
                                }
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
                            </div>

                            {/* 2. Department */}
                            <div className="col-span-1 text-neutral-700">
                              {row.department}
                            </div>

                            {/* 3. Priority */}
                            <div className="col-span-1">
                              <span
                                className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
                                  row.priority === "Urgent" ||
                                  row.priority === "High"
                                    ? "bg-red-50 text-red-700"
                                    : "bg-neutral-100 text-neutral-700"
                                }`}
                              >
                                {row.priority}
                              </span>
                            </div>

                            {/* 4. Required Date */}
                            <div className="col-span-1 text-neutral-600">
                              {row.requiredDate}
                            </div>

                            {/* 5. Total Items */}
                            <div className="col-span-1 text-center">
                              <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-700">
                                <Package className="h-3 w-3 text-neutral-500" />
                                {row.totalItems}{" "}
                                {row.totalItems === 1 ? "item" : "items"}
                              </span>
                            </div>

                            {/* 6. Total Remaining Qty */}
                            <div className="col-span-1 text-right font-semibold tabular-nums text-neutral-900">
                              {row.totalRemainingQty}
                            </div>

                            {/* 7. Status */}
                            <div className="col-span-1">
                              <StatusBadge
                                status={rowStatusLabel(row)}
                                tone={rowStatusTone(row)}
                              />
                            </div>

                            {/* 8. Action (Create RFQ) */}
                            <div className="col-span-1 text-right">
                              <ActionCell mr={row.mr} />
                            </div>
                          </div>
                        </div>

                        {/* Expandable Shortage Items Sub-Table Drawer */}
                        {isExpanded && (
                          <div className="border-t border-b border-blue-100 bg-neutral-50/70 px-6 py-4">
                            <div className="mb-2 flex items-center justify-between">
                              <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                                Shortage Line Items for {row.mrNumber}
                              </h4>
                              {row.warehouseRemarks !== "—" && (
                                <span className="text-xs text-neutral-500">
                                  <strong>Warehouse Remarks:</strong>{" "}
                                  {row.warehouseRemarks}
                                </span>
                              )}
                            </div>
                            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                              <table className="min-w-full text-xs">
                                <thead className="bg-neutral-100 text-neutral-600">
                                  <tr>
                                    <th className="px-4 py-2 text-left font-semibold">
                                      Item Code
                                    </th>
                                    <th className="px-4 py-2 text-left font-semibold">
                                      Item Name / Description
                                    </th>
                                    <th className="px-4 py-2 text-right font-semibold">
                                      Remaining (Shortage) Qty
                                    </th>
                                    <th className="px-4 py-2 text-left font-semibold">
                                      UOM
                                    </th>
                                    <th className="px-4 py-2 text-left font-semibold">
                                      Target Warehouse
                                    </th>
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
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!isLoading && groupedRows.length > 0 && (
        <p className="mt-4 text-xs text-neutral-500">
          Showing {groupedRows.length} Material Request(s) awaiting RFQ creation.
        </p>
      )}
    </div>
  );
}
