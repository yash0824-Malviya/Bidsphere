import { Fragment, useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileSearch,
  Layers,
  RefreshCw,
  Sparkles,
  Truck,
} from "lucide-react";

import {
  getLinkedRfqName,
  getMaterialRequestMode,
  getMaterialRequestProcurementType,
  getMaterialRequestWorkflowStatus,
  fetchProcurementQueue,
  parseForwardedItemsFromMr,
  type MaterialRequestWorkflowRecord,
} from "../../api/materialRequestWorkflow";
import type {
  MaterialRequestMode,
  MaterialRequestProcurementType,
  MaterialRequestWorkflowStatus,
} from "../../types/materialRequestWorkflow";
import StatusBadge from "../../components/StatusBadge";
import ProcurementTypeBadge from "../../components/ProcurementTypeBadge";
import RequestModeBadge from "../../components/RequestModeBadge";
import ErrorState from "../../components/ErrorState";
import PaginationBar from "../../components/PaginationBar";
import { TableSkeleton } from "../../components/Skeleton";
import MaterialRequestStatusModal from "../../components/warehouse/MaterialRequestStatusModal";
import ForwardedFilterBar, {
  EMPTY_FORWARDED_FILTERS,
  type ForwardedFilters,
} from "../../components/material-requests/ForwardedFilterBar";
import {
  Drawing2dCell,
  PartNameCell,
} from "../../components/warehouse/EngineeringDocCells";
import { usePagination } from "../../hooks/usePagination";
import { formatDate, formatDateTime } from "../../utils/format";
import { pickEngineeringDocs } from "../../utils/materialRequestItemFiles";
import {
  isMrOverdue,
  isReceivedToday,
  resolveProcurementMrDisplayStatus,
  type ProcurementDisplayStatus,
} from "../../utils/materialRequestProcurementStatus";

/* ─── types ─────────────────────────────────────────────────────────────── */

interface ShortageItem {
  item_code: string;
  item_name: string;
  requested_qty: number;
  available_qty: number;
  forward_qty: number;
  uom: string;
  warehouse: string;
  part_name?: string;
  drawing_2d_url?: string;
  attachments?: import("../../utils/materialRequestItemFiles").EngineeringAttachment[];
}

interface GroupedMrRow {
  mr: MaterialRequestWorkflowRecord;
  mrNumber: string;
  department: string;
  warehouse: string;
  procurementType: MaterialRequestProcurementType;
  requestMode: MaterialRequestMode;
  priority: string;
  requiredDate: string;
  rawScheduleDate?: string | null;
  forwardedOn: string;
  requestedBy: string;
  warehouseRemarks: string;
  totalItems: number;
  totalRemainingQty: number;
  status: MaterialRequestWorkflowStatus;
  displayStatus: ProcurementDisplayStatus;
  hasRFQ: boolean;
  linkedRfq?: string;
  isNewToday: boolean;
  isOverdue: boolean;
  shortageItems: ShortageItem[];
}

type QuickFilter = "all" | "today" | "pending" | "in_progress" | "overdue" | "completed";
type SortOption =
  | "default"
  | "forwarded_desc"
  | "forwarded_asc"
  | "required_asc"
  | "priority"
  | "remaining_qty";

const PRIORITY_HOT = new Set(["Urgent", "High"]);
const PRIORITY_WEIGHTS: Record<string, number> = {
  Urgent: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

/* ─── helpers ────────────────────────────────────────────────────────────── */

function forwardedOnOf(mr: MaterialRequestWorkflowRecord): string {
  if (mr.custom_forwarded_on) return mr.custom_forwarded_on;
  const raw = String(mr.custom_warehouse_remarks ?? mr.remarks ?? "");
  const m = raw.match(/\[BidSphere:Forwarded:[^|\]]*\|([^\]]+)\]/);
  return m?.[1]?.trim() || mr.modified || mr.creation || "";
}

function buildGroupedMrRows(
  mrs: MaterialRequestWorkflowRecord[],
): GroupedMrRow[] {
  return mrs.map((mr) => {
    const wfStatus = getMaterialRequestWorkflowStatus(mr);
    const forwardedItems = parseForwardedItemsFromMr(mr);
    const forwardedOn = forwardedOnOf(mr);
    const linkedRfq =
      String(mr.custom_linked_rfq || getLinkedRfqName(mr) || "").trim() ||
      undefined;
    const hasRFQ = Boolean(linkedRfq) || wfStatus === "RFQ Created";
    const isNewToday = isReceivedToday(forwardedOn);
    const isOverdue = isMrOverdue(mr.schedule_date, wfStatus, hasRFQ);
    const displayStatus = resolveProcurementMrDisplayStatus(
      wfStatus,
      hasRFQ,
    );

    const shortageItems: ShortageItem[] =
      forwardedItems.length > 0
        ? forwardedItems
            .filter((fi) => (fi.forward_qty ?? fi.shortage_qty ?? 0) > 0)
            .map((fi) => {
              const forward_qty = fi.forward_qty ?? fi.shortage_qty ?? 0;
              const requested_qty = fi.requested_qty ?? forward_qty;
              const mrItem = (mr.items ?? []).find(
                (i) => i.item_code === fi.item_code,
              );
              return {
                item_code: fi.item_code,
                item_name: fi.item_name ?? fi.item_code,
                requested_qty,
                available_qty:
                  fi.issued_qty ?? Math.max(0, requested_qty - forward_qty),
                forward_qty,
                uom: fi.uom ?? "Nos",
                warehouse: fi.warehouse ?? "—",
                ...pickEngineeringDocs(mrItem),
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
                ...pickEngineeringDocs(item),
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
      requestMode: getMaterialRequestMode(mr),
      priority: mr.custom_priority || "Medium",
      requiredDate: mr.schedule_date ? formatDate(mr.schedule_date) : "—",
      rawScheduleDate: mr.schedule_date,
      forwardedOn,
      requestedBy: mr.custom_requested_by || mr.owner || "—",
      warehouseRemarks: mr.custom_warehouse_remarks || mr.remarks || "—",
      totalItems: shortageItems.length,
      totalRemainingQty,
      status: wfStatus,
      displayStatus,
      hasRFQ,
      linkedRfq,
      isNewToday,
      isOverdue,
      shortageItems,
    };
  });
}

/* ─── page ───────────────────────────────────────────────────────────────── */

export default function MaterialRequestProcurementPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<ForwardedFilters>(
    EMPTY_FORWARDED_FILTERS,
  );
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("default");
  const [statusMr, setStatusMr] = useState<string | null>(null);

  const {
    data: mrs = [],
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["mr-procurement-queue", { includeWithRfq: true }],
    queryFn: () => fetchProcurementQueue({ includeWithRfq: true }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  // Debounce search string (300ms) to avoid filtering lag on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const allRows = useMemo(() => buildGroupedMrRows(mrs), [mrs]);

  // Derived real KPIs from active dataset
  const kpiCounts = useMemo(() => {
    let today = 0;
    let pending = 0;
    let inProgress = 0;
    let overdue = 0;
    let completed = 0;

    for (const r of allRows) {
      if (r.isNewToday) today += 1;
      if (r.isOverdue) overdue += 1;
      if (!r.hasRFQ && r.displayStatus.category === "pending") pending += 1;
      else if (r.hasRFQ || r.displayStatus.category === "in_progress") inProgress += 1;
      else if (r.displayStatus.category === "completed") completed += 1;
    }

    return {
      total: allRows.length,
      today,
      pending,
      inProgress,
      overdue,
      completed,
    };
  }, [allRows]);

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

  const statusOptions = useMemo(() => {
    return [
      "Awaiting RFQ Creation",
      "RFQ Created",
      "Partially Issued",
      "Overdue",
      "New Today",
      "Completed",
    ];
  }, []);

  const rows = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const dateFloor = filters.forwardDate ? new Date(filters.forwardDate) : null;

    let filtered = allRows.filter((r) => {
      // Free-text search
      if (q && !(`${r.mrNumber} ${r.department} ${r.warehouse}`.toLowerCase().includes(q))) {
        return false;
      }
      if (filters.department && r.department !== filters.department) return false;
      if (filters.warehouse && r.warehouse !== filters.warehouse) return false;
      if (filters.priority && r.priority !== filters.priority) return false;
      if (filters.procurementType && r.procurementType !== filters.procurementType) {
        return false;
      }
      if (filters.requestMode && r.requestMode !== filters.requestMode) {
        return false;
      }

      // Status select filter
      if (filters.status) {
        if (filters.status === "Overdue") {
          if (!r.isOverdue) return false;
        } else if (filters.status === "New Today") {
          if (!r.isNewToday) return false;
        } else if (
          filters.status === "Awaiting RFQ Creation" ||
          filters.status === "Pending RFQ"
        ) {
          if (r.hasRFQ || r.displayStatus.category !== "pending") {
            return false;
          }
        } else if (
          filters.status === "RFQ Created" ||
          filters.status === "In Progress"
        ) {
          if (!r.hasRFQ && r.displayStatus.category !== "in_progress") {
            return false;
          }
        } else if (filters.status === "Completed") {
          if (r.displayStatus.category !== "completed") return false;
        } else if (r.displayStatus.label !== filters.status && r.status !== filters.status) {
          return false;
        }
      }

      // Quick filter tabs
      if (quickFilter === "today" && !r.isNewToday) return false;
      if (quickFilter === "pending" && (r.hasRFQ || r.displayStatus.category !== "pending")) {
        return false;
      }
      if (
        quickFilter === "in_progress" &&
        !r.hasRFQ &&
        r.displayStatus.category !== "in_progress"
      ) {
        return false;
      }
      if (quickFilter === "overdue" && !r.isOverdue) return false;
      if (quickFilter === "completed" && r.displayStatus.category !== "completed") {
        return false;
      }

      // Date floor filter
      if (dateFloor && r.forwardedOn) {
        const d = new Date(r.forwardedOn);
        if (!Number.isNaN(d.getTime()) && d < dateFloor) return false;
      }
      return true;
    });

    // Sorting
    filtered = [...filtered].sort((a, b) => {
      if (sortBy === "forwarded_desc") {
        return new Date(b.forwardedOn).getTime() - new Date(a.forwardedOn).getTime();
      }
      if (sortBy === "forwarded_asc") {
        return new Date(a.forwardedOn).getTime() - new Date(b.forwardedOn).getTime();
      }
      if (sortBy === "required_asc") {
        const dateA = a.rawScheduleDate ? new Date(a.rawScheduleDate).getTime() : Infinity;
        const dateB = b.rawScheduleDate ? new Date(b.rawScheduleDate).getTime() : Infinity;
        return dateA - dateB;
      }
      if (sortBy === "priority") {
        const pA = PRIORITY_WEIGHTS[a.priority] ?? 0;
        const pB = PRIORITY_WEIGHTS[b.priority] ?? 0;
        return pB - pA;
      }
      if (sortBy === "remaining_qty") {
        return b.totalRemainingQty - a.totalRemainingQty;
      }

      // Default sort: Prioritize Actionable Items (Overdue & Pending first, then New Today, then In Progress, then Completed)
      const rank = (row: GroupedMrRow): number => {
        if (!row.hasRFQ && row.isOverdue && row.displayStatus.category === "pending") return 1;
        if (!row.hasRFQ && row.isNewToday && row.displayStatus.category === "pending") return 2;
        if (!row.hasRFQ && row.displayStatus.category === "pending") return 3;
        if (row.hasRFQ || row.displayStatus.category === "in_progress") return 4;
        if (row.displayStatus.category === "completed") return 5;
        return 6;
      };

      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) return rankDiff;

      // Within same category, newest forwarded date first
      return new Date(b.forwardedOn).getTime() - new Date(a.forwardedOn).getTime();
    });

    return filtered;
  }, [allRows, filters, quickFilter, sortBy]);

  useEffect(() => {
    console.log("[Procurement] UI render", {
      numberOfPurchaseMrsFound: mrs.length,
      appliedFilters: filters,
      quickFilter,
      sortBy,
      finalRenderedRows: rows.map((r) => ({
        mrNumber: r.mrNumber,
        status: r.displayStatus.label,
        hasRFQ: r.hasRFQ,
        linkedRfq: r.linkedRfq,
        isNewToday: r.isNewToday,
        isOverdue: r.isOverdue,
        department: r.department,
        warehouse: r.warehouse,
        priority: r.priority,
        requiredDate: r.requiredDate,
        forwardedOn: r.forwardedOn,
        totalItems: r.totalItems,
        remainingQty: r.totalRemainingQty,
      })),
    });
  }, [rows, mrs.length, filters, quickFilter, sortBy]);

  const { page, pageSize, setPage, setPageSize } = usePagination({
    resetKey: JSON.stringify({ filters, quickFilter, sortBy }),
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

  const COLS = 8;

  return (
    <div className="w-full max-w-full space-y-4">
      {/* Header */}
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh Material Requests"
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 shadow-sm disabled:opacity-50 transition-colors"
          >
            <RefreshCw
              className={`h-4 w-4 ${isFetching ? "animate-spin text-primary-600" : "text-neutral-500"}`}
            />
            <span>{isFetching ? "Refreshing..." : "Refresh"}</span>
          </button>
          <Link
            to="/material-requests/history"
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-primary-600 no-underline hover:bg-neutral-50 shadow-sm"
          >
            <Activity className="h-4 w-4" />
            Forwarded History
          </Link>
        </div>
      </div>

      {isError && mrs.length === 0 && (
        <div className="mb-4">
          <ErrorState
            title="Could not load Forwarded Material Requests"
            description={
              error instanceof Error
                ? error.message
                : "Failed to load forwarded Material Requests."
            }
            onRetry={() => refetch()}
          />
        </div>
      )}

      {/* KPI Cards — Derived from Live Workflow Data */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <button
          type="button"
          onClick={() => setQuickFilter("all")}
          className={`flex flex-col rounded-xl border p-3.5 text-left transition-all ${
            quickFilter === "all"
              ? "border-[#1554D1] bg-blue-50/50 ring-1 ring-[#1554D1] shadow-sm"
              : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50/50"
          }`}
        >
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-[11px] font-bold uppercase tracking-wider">All Active</span>
            <Layers className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-neutral-900 tabular-nums">
            {kpiCounts.total}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">Forwarded queue</div>
        </button>

        <button
          type="button"
          onClick={() => setQuickFilter("today")}
          className={`flex flex-col rounded-xl border p-3.5 text-left transition-all ${
            quickFilter === "today"
              ? "border-[#1554D1] bg-blue-50/50 ring-1 ring-[#1554D1] shadow-sm"
              : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50/50"
          }`}
        >
          <div className="flex items-center justify-between text-blue-600">
            <span className="text-[11px] font-bold uppercase tracking-wider">New Today</span>
            <Sparkles className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-blue-700 tabular-nums">
            {kpiCounts.today}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">Received today</div>
        </button>

        <button
          type="button"
          onClick={() => setQuickFilter("pending")}
          className={`flex flex-col rounded-xl border p-3.5 text-left transition-all ${
            quickFilter === "pending"
              ? "border-amber-500 bg-amber-50/50 ring-1 ring-amber-500 shadow-sm"
              : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50/50"
          }`}
        >
          <div className="flex items-center justify-between text-amber-700">
            <span className="text-[11px] font-bold uppercase tracking-wider">Pending Action</span>
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-800 tabular-nums">
            {kpiCounts.pending}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">Needs RFQ creation</div>
        </button>

        <button
          type="button"
          onClick={() => setQuickFilter("in_progress")}
          className={`flex flex-col rounded-xl border p-3.5 text-left transition-all ${
            quickFilter === "in_progress"
              ? "border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500 shadow-sm"
              : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50/50"
          }`}
        >
          <div className="flex items-center justify-between text-indigo-700">
            <span className="text-[11px] font-bold uppercase tracking-wider">In Progress</span>
            <FileSearch className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-indigo-900 tabular-nums">
            {kpiCounts.inProgress}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">RFQ / PO processing</div>
        </button>

        <button
          type="button"
          onClick={() => setQuickFilter("overdue")}
          className={`flex flex-col rounded-xl border p-3.5 text-left transition-all ${
            quickFilter === "overdue"
              ? "border-rose-500 bg-rose-50/50 ring-1 ring-rose-500 shadow-sm"
              : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50/50"
          }`}
        >
          <div className="flex items-center justify-between text-rose-700">
            <span className="text-[11px] font-bold uppercase tracking-wider">Overdue</span>
            <AlertTriangle className="h-4 w-4 text-rose-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-rose-800 tabular-nums">
            {kpiCounts.overdue}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">Past required date</div>
        </button>
      </div>

      {/* Quick Filter Bar & Sort Controls */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mr-1">
            Filter:
          </span>
          <button
            type="button"
            onClick={() => setQuickFilter("all")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
              quickFilter === "all"
                ? "bg-[#1554D1] text-white shadow-sm"
                : "bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-50"
            }`}
          >
            All ({kpiCounts.total})
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter("today")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
              quickFilter === "today"
                ? "bg-[#1554D1] text-white shadow-sm"
                : "bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-50"
            }`}
          >
            <Sparkles className="h-3 w-3 text-blue-500" />
            New Today ({kpiCounts.today})
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter("pending")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
              quickFilter === "pending"
                ? "bg-[#1554D1] text-white shadow-sm"
                : "bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-50"
            }`}
          >
            <Clock className="h-3 w-3 text-amber-500" />
            Awaiting RFQ ({kpiCounts.pending})
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter("in_progress")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
              quickFilter === "in_progress"
                ? "bg-[#1554D1] text-white shadow-sm"
                : "bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-50"
            }`}
          >
            <FileSearch className="h-3 w-3 text-indigo-500" />
            RFQ Created ({kpiCounts.inProgress})
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter("overdue")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
              quickFilter === "overdue"
                ? "bg-rose-600 text-white shadow-sm"
                : "bg-white text-rose-700 border border-rose-200 hover:bg-rose-50"
            }`}
          >
            <AlertTriangle className="h-3 w-3 text-rose-500" />
            Overdue ({kpiCounts.overdue})
          </button>
          {kpiCounts.completed > 0 && (
            <button
              type="button"
              onClick={() => setQuickFilter("completed")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                quickFilter === "completed"
                  ? "bg-[#1554D1] text-white shadow-sm"
                  : "bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-50"
              }`}
            >
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              Completed ({kpiCounts.completed})
            </button>
          )}
        </div>

        {/* Sort dropdown */}
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-neutral-500 font-medium">
            <ArrowUpDown className="h-3.5 w-3.5 text-neutral-400" />
            Sort:
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="select-field text-xs py-1 px-2.5 h-8 w-auto rounded-lg border-neutral-200 bg-white"
            aria-label="Sort Material Requests"
          >
            <option value="default">Prioritize Actionable & Overdue</option>
            <option value="forwarded_desc">Latest Forwarded</option>
            <option value="forwarded_asc">Oldest Forwarded</option>
            <option value="required_asc">Required Date (Earliest)</option>
            <option value="priority">Priority (Highest)</option>
            <option value="remaining_qty">Remaining Qty (Highest)</option>
          </select>
        </div>
      </div>

      {/* Advanced Filters */}
      <ForwardedFilterBar
        value={filters}
        onChange={setFilters}
        departments={departments}
        warehouses={warehouses}
        priorities={priorities}
        statuses={statusOptions}
      />

      {/* Data Table */}
      <div className="card relative max-w-full overflow-hidden p-0 border border-neutral-200 bg-white shadow-sm">
        {isFetching && mrs.length > 0 && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-100 overflow-hidden z-10">
            <div className="h-full bg-[#1554D1] animate-pulse w-full" />
          </div>
        )}
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[1080px] divide-y divide-neutral-200 text-left text-xs sm:text-sm">
            <colgroup>
              <col className="w-[17%] min-w-[175px]" /> {/* MR Number */}
              <col className="w-[8%] min-w-[85px]" />   {/* Type */}
              <col className="w-[8%] min-w-[85px]" />   {/* Source */}
              <col className="w-[7%] min-w-[75px]" />   {/* Priority */}
              <col className="w-[13%] min-w-[140px]" /> {/* Required Date */}
              <col className="w-[11%] min-w-[120px]" /> {/* Forwarded On */}
              <col className="w-[18%] min-w-[190px]" /> {/* Status */}
              <col className="w-[18%] min-w-[210px]" /> {/* Action */}
            </colgroup>
            <thead className="bg-neutral-50 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-3.5 py-3">MR Number</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Source</th>
                <th className="px-2.5 py-3">Priority</th>
                <th className="px-3 py-3">Required Date</th>
                <th className="px-3 py-3">Forwarded On</th>
                <th className="px-3.5 py-3">Status</th>
                <th className="px-3.5 py-3 text-right">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-200">
              {isLoading && mrs.length === 0 ? (
                <tr>
                  <td colSpan={COLS} className="p-0">
                    <TableSkeleton rows={6} columns={COLS} />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COLS} className="px-4 py-12 text-center text-neutral-500">
                    No Material Requests found matching the selected filters.
                  </td>
                </tr>
              ) : (
                pagedRows.map((row) => {
                  const isExpanded = expanded.has(row.mrNumber);
                  return (
                    <Fragment key={row.mrNumber}>
                      <tr
                        className={isExpanded ? "bg-blue-50/40" : "hover:bg-neutral-50/80"}
                      >
                        <td className="px-3.5 py-3 align-middle">
                          <div className="flex items-center gap-2 min-w-0">
                            <button
                              type="button"
                              onClick={() => toggle(row.mrNumber)}
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-100"
                              title={isExpanded ? "Collapse items" : "Expand items"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <Link
                              to={`/material-requests/${encodeURIComponent(row.mrNumber)}`}
                              className="whitespace-nowrap font-mono text-[13px] font-semibold text-primary-600 hover:underline"
                              title={row.mrNumber}
                            >
                              {row.mrNumber}
                            </Link>
                            {row.isNewToday && (
                              <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-800 tracking-wide">
                                NEW TODAY
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <div className="whitespace-nowrap">
                            <ProcurementTypeBadge type={row.procurementType} withIcon={false} />
                          </div>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <div className="whitespace-nowrap">
                            <RequestModeBadge mode={row.requestMode} />
                          </div>
                        </td>
                        <td className="px-2.5 py-3 align-middle">
                          <div className="whitespace-nowrap">
                            <span
                              className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium ${
                                PRIORITY_HOT.has(row.priority)
                                  ? "bg-red-50 text-red-700 font-semibold"
                                  : "bg-neutral-100 text-neutral-700"
                              }`}
                            >
                              {row.priority}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <span
                              className={`text-xs tabular-nums ${
                                row.isOverdue ? "font-semibold text-rose-700" : "text-neutral-600"
                              }`}
                            >
                              {row.requiredDate}
                            </span>
                            {row.isOverdue && (
                              <span
                                className="shrink-0 inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-800"
                                title="Overdue (7+ days past required date)"
                              >
                                <AlertTriangle className="h-2.5 w-2.5 text-rose-700" />
                                OVERDUE
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <span
                            className="text-xs text-neutral-600 whitespace-nowrap block"
                            title={row.forwardedOn ? formatDateTime(row.forwardedOn) : undefined}
                          >
                            {row.forwardedOn ? formatDate(row.forwardedOn, "d MMM yyyy") : "—"}
                          </span>
                        </td>
                        <td className="px-3.5 py-3 align-middle">
                          <div className="whitespace-nowrap">
                            <StatusBadge
                              status={row.displayStatus.label}
                              tone={row.displayStatus.tone}
                            />
                          </div>
                        </td>
                        <td className="px-3.5 py-3 align-middle">
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setStatusMr(row.mrNumber)}
                              className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 shadow-xs"
                              title="View workflow status"
                            >
                              <Activity className="h-3.5 w-3.5" />
                              View
                            </button>
                            {!row.hasRFQ &&
                              row.status !== "Completed" &&
                              row.status !== "Cancelled" && (
                                <Link
                                  to={`/sourcing/rfq/new?mr=${encodeURIComponent(row.mrNumber)}`}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 no-underline whitespace-nowrap"
                                  title="Create RFQ from this Material Request"
                                >
                                  <Truck className="h-3.5 w-3.5" />
                                  Create RFQ
                                </Link>
                              )}
                          </div>
                        </td>
                      </tr>

                      {/* Line items drawer */}
                      {isExpanded && (
                        <tr className="bg-neutral-50/70">
                          <td colSpan={COLS} className="px-4 py-3">
                            <div className="mb-2 flex items-center justify-between">
                              <h4 className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                                Shortage Line Items for {row.mrNumber}
                              </h4>
                              {row.warehouseRemarks !== "—" && (
                                <span className="text-xs text-neutral-500">
                                  <strong>Remarks:</strong> {row.warehouseRemarks}
                                </span>
                              )}
                            </div>
                            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
                              <table className="w-full table-fixed text-xs">
                                <colgroup>
                                  <col className="w-[14%]" />
                                  <col className="w-[18%]" />
                                  <col className="w-[8%]" />
                                  <col className="w-[12%]" />
                                  <col className="w-[12%]" />
                                  <col className="w-[8%]" />
                                  <col className="w-[8%]" />
                                  <col className="w-[8%]" />
                                  <col className="w-[12%]" />
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
                                    <th className="px-2 py-1.5 text-left">UOM</th>
                                    <th className="px-3 py-1.5 text-left">Warehouse</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                  {row.shortageItems.map((item, idx) => (
                                    <tr
                                      key={`${row.mrNumber}__item__${item.item_code}__${idx}`}
                                      className="hover:bg-neutral-50/80"
                                    >
                                      <td className="truncate px-3 py-1.5 font-mono font-medium text-neutral-800" title={item.item_code}>
                                        {item.item_code}
                                      </td>
                                      <td className="truncate px-3 py-1.5 text-neutral-700" title={item.item_name}>
                                        {item.item_name}
                                      </td>
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
                                        {item.forward_qty}
                                      </td>
                                      <td className="truncate px-2 py-1.5 text-neutral-600">
                                        {item.uom}
                                      </td>
                                      <td className="truncate px-3 py-1.5 text-neutral-500" title={item.warehouse}>
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
