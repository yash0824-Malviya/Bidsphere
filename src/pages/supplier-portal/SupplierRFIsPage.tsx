import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileQuestion,
  Search,
  Send,
  XCircle,
} from "lucide-react";

import {
  deriveSupplierRfiFacingStatus,
  getSupplierRFIs,
  resolvePortalSupplierId,
  type SupplierRfiListRow,
} from "../../api/rfi";
import EmptyState from "../../components/EmptyState";
import DashboardKpiCard, {
  DashboardKpiGrid,
} from "../../components/dashboard/DashboardKpiCard";
import PaginationBar from "../../components/PaginationBar";
import StatusBadge from "../../components/StatusBadge";
import { TableSkeleton } from "../../components/Skeleton";
import ConnectionError from "../../components/ConnectionError";
import SupplierBreadcrumb from "../../components/supplier-portal/SupplierBreadcrumb";
import { SearchInput } from "../../components/ui";
import { useClientPagination } from "../../hooks/usePagination";
import { formatDate, formatDateTime } from "../../utils/format";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import type { SupplierRfiFacingStatus } from "../../types/rfi";
import { RFI_CATEGORIES } from "../../types/rfi";

const LOG = "[SupplierPortal:RFI]";

type StatusFilter = "all" | SupplierRfiFacingStatus;
type DeadlineFilter = "all" | "overdue" | "7d" | "30d" | "later";

const STATUS_OPTIONS: SupplierRfiFacingStatus[] = [
  "Draft",
  "In Progress",
  "Submitted",
  "Under Review",
  "Approved",
  "Rejected",
  "Closed",
];

function daysUntil(deadline: string | undefined): number | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function deadlineLabel(deadline: string | undefined): {
  date: string;
  due: string;
  overdue: boolean;
} {
  const days = daysUntil(deadline);
  const date = formatDate(deadline, "d MMM yyyy");
  if (days == null) return { date, due: "", overdue: false };
  if (days < 0) {
    return {
      date,
      due: `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`,
      overdue: true,
    };
  }
  if (days === 0) return { date, due: "Due today", overdue: false };
  return {
    date,
    due: `Due in ${days} Day${days === 1 ? "" : "s"}`,
    overdue: false,
  };
}

function matchesDeadlineFilter(
  deadline: string | undefined,
  filter: DeadlineFilter,
): boolean {
  if (filter === "all") return true;
  const days = daysUntil(deadline);
  if (days == null) return filter === "later";
  if (filter === "overdue") return days < 0;
  if (filter === "7d") return days >= 0 && days <= 7;
  if (filter === "30d") return days >= 0 && days <= 30;
  return days > 30;
}

function progressLabel(row: SupplierRfiListRow): string {
  if (typeof row.completion_pct === "number") {
    return `${Math.max(0, Math.min(100, Math.round(row.completion_pct)))}%`;
  }
  const facing = deriveSupplierRfiFacingStatus(row);
  if (facing === "Submitted" || facing === "Under Review" || facing === "Approved") {
    return "100%";
  }
  if (facing === "In Progress") return "—";
  return "0%";
}

export default function SupplierRFIsPage() {
  const { erpSupplierName, isReady, session } = useSupplierSession();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>("all");

  const supplierQuery = useQuery({
    queryKey: [
      "supplier-portal-rfi-supplier-id",
      erpSupplierName,
      session?.linkedSupplier,
    ],
    enabled: isReady && !!erpSupplierName,
    queryFn: async () => {
      const linked = String(session?.linkedSupplier || "").trim();
      const candidate = linked || erpSupplierName;
      const resolved = await resolvePortalSupplierId(candidate);
      // eslint-disable-next-line no-console
      console.log(LOG, "Resolved portal supplier", {
        linked_supplier: linked || "(none)",
        session_supplier: erpSupplierName,
        resolved_supplier: resolved,
      });
      return resolved;
    },
    staleTime: 5 * 60_000,
  });

  const resolvedSupplier = supplierQuery.data ?? "";

  const listQuery = useQuery({
    queryKey: ["supplier-portal-rfis", resolvedSupplier],
    enabled: !!resolvedSupplier,
    queryFn: () => getSupplierRFIs(resolvedSupplier),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const rows = listQuery.data ?? [];

  const statusCounts = useMemo(() => {
    const counts: Record<SupplierRfiFacingStatus | "total", number> = {
      total: rows.length,
      Draft: 0,
      "In Progress": 0,
      Submitted: 0,
      "Under Review": 0,
      Approved: 0,
      Rejected: 0,
      Closed: 0,
    };
    for (const row of rows) {
      counts[deriveSupplierRfiFacingStatus(row)] += 1;
    }
    return counts;
  }, [rows]);

  const categories = useMemo(() => {
    const fromData = rows
      .map((r) => String(r.category || "").trim())
      .filter(Boolean);
    return Array.from(new Set([...fromData, ...RFI_CATEGORIES])).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((rfi) => {
      const facing = deriveSupplierRfiFacingStatus(rfi);
      if (statusFilter !== "all" && facing !== statusFilter) return false;
      if (
        categoryFilter !== "all" &&
        String(rfi.category || "") !== categoryFilter
      ) {
        return false;
      }
      if (!matchesDeadlineFilter(rfi.submission_deadline, deadlineFilter)) {
        return false;
      }
      if (!q) return true;
      return (
        rfi.name.toLowerCase().includes(q) ||
        rfi.title.toLowerCase().includes(q) ||
        String(rfi.category || "")
          .toLowerCase()
          .includes(q) ||
        String(rfi.owner || "")
          .toLowerCase()
          .includes(q) ||
        String(rfi.description || "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [
    rows,
    search,
    statusFilter,
    categoryFilter,
    deadlineFilter,
  ]);

  const {
    currentPage,
    pageSize,
    setPage,
    setPageSize,
    totalRecords,
    totalPages,
    pageRows,
  } = useClientPagination(filtered, {
    defaultPageSize: 10,
    resetKey: `${resolvedSupplier}|${search}|${statusFilter}|${categoryFilter}|${deadlineFilter}`,
  });

  useEffect(() => {
    if (!listQuery.isSuccess) return;
    // eslint-disable-next-line no-console
    console.log(LOG, "My RFIs page render", {
      resolved_supplier: resolvedSupplier,
      assigned_rfi_count: rows.length,
      names: rows.map((r) => r.name),
      facing: rows.map((r) => ({
        name: r.name,
        facing: deriveSupplierRfiFacingStatus(r),
        rfi_status: r.status,
      })),
    });
  }, [listQuery.isSuccess, resolvedSupplier, rows]);

  const loading =
    !isReady ||
    supplierQuery.isLoading ||
    (!!resolvedSupplier && listQuery.isLoading);

  const kpiCards: Array<{
    label: string;
    value: number;
    filter: StatusFilter;
    icon: typeof FileQuestion;
    iconClassName: string;
  }> = [
    {
      label: "Total RFIs",
      value: statusCounts.total,
      filter: "all",
      icon: ClipboardList,
      iconClassName: "bg-neutral-100 text-neutral-500",
    },
    {
      label: "Draft",
      value: statusCounts.Draft,
      filter: "Draft",
      icon: FileQuestion,
      iconClassName: "bg-neutral-100 text-neutral-500",
    },
    {
      label: "In Progress",
      value: statusCounts["In Progress"],
      filter: "In Progress",
      icon: Calendar,
      iconClassName: "bg-amber-50 text-amber-600",
    },
    {
      label: "Submitted",
      value: statusCounts.Submitted,
      filter: "Submitted",
      icon: Send,
      iconClassName: "bg-[var(--color-primary-light)] text-[var(--color-primary)]",
    },
    {
      label: "Approved",
      value: statusCounts.Approved,
      filter: "Approved",
      icon: CheckCircle2,
      iconClassName: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "Rejected",
      value: statusCounts.Rejected,
      filter: "Rejected",
      icon: XCircle,
      iconClassName: "bg-rose-50 text-rose-600",
    },
  ];

  return (
    <div className="flex w-full flex-col gap-6">
      <SupplierBreadcrumb
        items={[
          { label: "Dashboard", to: "/supplier/dashboard" },
          { label: "RFIs" },
        ]}
      />

      <header>
        <h1 className="text-[22px] font-semibold tracking-tight text-[#111827]">
          My RFIs
          {!loading ? (
            <span className="ml-2 inline-flex items-center rounded-full bg-primary-50 px-2.5 py-0.5 align-middle text-xs font-semibold text-primary-700 ring-1 ring-inset ring-primary-100">
              {rows.length} total
            </span>
          ) : null}
        </h1>
        <p className="mt-1 text-[13px] text-[#64748B]">
          All RFIs assigned to your company — including submitted history.
        </p>
      </header>

      <DashboardKpiGrid columns={6}>
        {kpiCards.map((kpi) => (
          <DashboardKpiCard
            key={kpi.label}
            icon={kpi.icon}
            label={kpi.label}
            value={loading ? "—" : kpi.value}
            iconClassName={kpi.iconClassName}
            onClick={() => setStatusFilter(kpi.filter)}
            className={
              statusFilter === kpi.filter
                ? "ring-1 ring-primary-200 border-primary-400"
                : ""
            }
          />
        ))}
      </DashboardKpiGrid>

      <div className="space-y-5">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-4">
            <label className="block lg:col-span-1">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Search
              </span>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="RFI number, title, buyer…"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Status
              </span>
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as StatusFilter)
                }
                className="select-field"
              >
                <option value="all">All</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Category
              </span>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="select-field"
              >
                <option value="all">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Deadline
              </span>
              <select
                value={deadlineFilter}
                onChange={(e) =>
                  setDeadlineFilter(e.target.value as DeadlineFilter)
                }
                className="select-field"
              >
                <option value="all">Any deadline</option>
                <option value="overdue">Overdue</option>
                <option value="7d">Due in 7 days</option>
                <option value="30d">Due in 30 days</option>
                <option value="later">Later than 30 days</option>
              </select>
            </label>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={6} columns={9} />
            </div>
          ) : supplierQuery.isError || listQuery.isError ? (
            <div className="p-4">
              <ConnectionError
                title="Could not load RFIs"
                error={supplierQuery.error || listQuery.error}
                onRetry={() => {
                  void supplierQuery.refetch();
                  void listQuery.refetch();
                }}
              />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={FileQuestion}
              title="No RFIs assigned"
              description="When procurement publishes a Request for Information and invites your company, it will appear here — and remain in history after you submit."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No matching RFIs"
              description="Try adjusting search or filters."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead className="border-b border-neutral-100 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="px-4 py-3">RFI Number</th>
                      <th className="px-4 py-3">Title</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Buyer</th>
                      <th className="px-4 py-3">Deadline</th>
                      <th className="px-4 py-3">Submission Date</th>
                      <th className="px-4 py-3">Progress</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {pageRows.map((rfi) => {
                      const facing = deriveSupplierRfiFacingStatus(rfi);
                      const dl = deadlineLabel(rfi.submission_deadline);
                      return (
                        <tr
                          key={rfi.name}
                          className="transition-colors hover:bg-primary-50/30"
                        >
                          <td className="px-4 py-3.5">
                            <Link
                              to={`/supplier/rfis/${encodeURIComponent(rfi.name)}`}
                              className="font-mono text-[13px] font-semibold text-primary-700 hover:underline"
                            >
                              {rfi.name}
                            </Link>
                          </td>
                          <td className="max-w-[220px] px-4 py-3.5">
                            <p className="truncate font-medium text-neutral-900">
                              {rfi.title}
                            </p>
                          </td>
                          <td className="px-4 py-3.5 text-neutral-700">
                            {rfi.category || "—"}
                          </td>
                          <td className="max-w-[140px] truncate px-4 py-3.5 text-neutral-700">
                            {rfi.owner || "Procurement"}
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-start gap-2">
                              <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" />
                              <div>
                                <p className="font-medium text-neutral-900">
                                  {dl.date}
                                </p>
                                {dl.due ? (
                                  <p
                                    className={`text-[11px] font-medium ${
                                      dl.overdue
                                        ? "text-rose-600"
                                        : "text-neutral-500"
                                    }`}
                                  >
                                    {dl.due}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-neutral-700">
                            {rfi.submitted_at
                              ? formatDateTime(rfi.submitted_at)
                              : "—"}
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex min-w-[72px] items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                                <div
                                  className="h-full rounded-full bg-primary-600"
                                  style={{
                                    width: progressLabel(rfi).endsWith("%")
                                      ? progressLabel(rfi)
                                      : "0%",
                                  }}
                                />
                              </div>
                              <span className="text-xs font-semibold tabular-nums text-neutral-700">
                                {progressLabel(rfi)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <StatusBadge status={facing} />
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <Link
                              to={`/supplier/rfis/${encodeURIComponent(rfi.name)}`}
                              className="btn-secondary no-underline"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              View
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                currentPage={currentPage}
                totalPages={totalPages}
                totalRecords={totalRecords}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                recordLabel="RFIs"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
