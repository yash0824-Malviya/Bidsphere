import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  Clock,
  Download,
  MoreVertical,
  Search,
} from "lucide-react";

import { getSupplierQuotations, type SQRow } from "../../api/supplierPortal";
import { apiGet, apiPut } from "../../api/erpnext";
import { getSupplierQuotation } from "../../api/sourcing";
import type { SupplierQuotation } from "../../types/erpnext";
import EmptyState from "../../components/EmptyState";
import PaginationBar from "../../components/PaginationBar";
import StatusBadge from "../../components/StatusBadge";
import { TableSkeleton } from "../../components/Skeleton";
import { SortableTableHeader } from "../../components/ui";
import { useListSort } from "../../hooks/useListSort";
import { usePagination } from "../../hooks/usePagination";
import { formatCurrency, formatDate } from "../../utils/format";
import {
  SQ_DEFAULT_SORT,
  sortNewestFirst,
  supplierQuotationComparators,
} from "../../utils/listSort";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import { getLegalDocs } from "../../api/legalDocs";
import {
  isSelectedAsWinner,
  resolveLegalReviewUiStatus,
} from "../../utils/supplierLegalDocs";

type DisplayStatus =
  | "Submitted"
  | "Under Review"
  | "Awarded"
  | "Rejected"
  | "Closed"
  | "Draft";

type StatusFilter = "all" | Exclude<DisplayStatus, "Draft" | "Closed"> | "Closed";
type DateFilter = "all" | "7d" | "30d" | "90d";

const SQ_COMPARATORS = supplierQuotationComparators<{
  name: string;
  transaction_date?: string;
  modified?: string;
  grand_total?: number;
  status?: string;
}>();

const SUMMARY_CARDS: Array<{
  key: Exclude<DisplayStatus, "Draft" | "Closed">;
  label: string;
  accent: string;
}> = [
  { key: "Submitted", label: "Submitted", accent: "border-l-primary-500" },
  { key: "Under Review", label: "Under Review", accent: "border-l-amber-400" },
  { key: "Awarded", label: "Awarded", accent: "border-l-emerald-400" },
  { key: "Rejected", label: "Rejected", accent: "border-l-rose-400" },
];

function formatQuoteDate(value: string | undefined): string {
  return value ? formatDate(value, "d MMM yyyy") : "—";
}

function withinDateFilter(iso: string | undefined, filter: DateFilter): boolean {
  if (filter === "all") return true;
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const days = filter === "7d" ? 7 : filter === "30d" ? 30 : 90;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return d >= start;
}

function deriveDisplayStatus(
  sq: SQRow,
  legalDocs: Awaited<ReturnType<typeof getLegalDocs>> | undefined,
): DisplayStatus {
  const legalUi = resolveLegalReviewUiStatus(legalDocs);
  if (legalUi === "Rejected") return "Rejected";
  if (legalUi === "Approved") return "Awarded";
  if (legalUi === "Under Review" || legalUi === "Pending Review") {
    return "Under Review";
  }

  const status = (sq.status ?? "").trim().toLowerCase();
  if (status === "draft") return "Draft";
  if (status.includes("award") || status.includes("ordered")) return "Awarded";
  if (status.includes("reject") || status.includes("lost")) return "Rejected";
  if (
    status.includes("cancel") ||
    status.includes("closed") ||
    status.includes("expired")
  ) {
    return "Closed";
  }
  if (status.includes("review")) return "Under Review";
  return "Submitted";
}

function isLegalReviewPending(
  legalDocs: Awaited<ReturnType<typeof getLegalDocs>> | undefined,
): boolean {
  if (!isSelectedAsWinner(legalDocs)) return false;
  const ui = resolveLegalReviewUiStatus(legalDocs);
  return ui === "Pending Review" || ui === "Under Review";
}

function StatusPill({ status }: { status: DisplayStatus }) {
  return <StatusBadge status={status} />;
}

function MoreMenu({
  detailUrl,
  legalDocsUrl,
  showLegalUpload,
  isDraft,
  submitting,
  onSubmitDraft,
}: {
  detailUrl: string;
  legalDocsUrl: string;
  showLegalUpload: boolean;
  isDraft: boolean;
  submitting: boolean;
  onSubmitDraft: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[#E8EDF5] bg-white text-neutral-600 transition hover:bg-neutral-50"
        aria-label="More actions"
        aria-expanded={open}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-[#E8EDF5] bg-white py-1 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
          <Link
            to={detailUrl}
            className="block px-3 py-2 text-[13px] font-medium text-[#111827] no-underline hover:bg-[#F8FAFC]"
            onClick={() => setOpen(false)}
          >
            View Details
          </Link>
          {showLegalUpload ? (
            <Link
              to={legalDocsUrl}
              className="block px-3 py-2 text-[13px] font-medium text-[#111827] no-underline hover:bg-[#F8FAFC]"
              onClick={() => setOpen(false)}
            >
              Upload Legal Documents
            </Link>
          ) : null}
          {isDraft ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setOpen(false);
                onSubmitDraft();
              }}
              className="block w-full px-3 py-2 text-left text-[13px] font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Submit Now"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function exportQuotationsCsv(
  rows: Array<{
    name: string;
    rfqLink: string;
    date: string;
    total: number;
    status: DisplayStatus;
  }>,
) {
  const header = ["Quote No", "RFQ Ref", "Date", "Total Value", "Status"];
  const lines = rows.map((r) =>
    [
      r.name,
      r.rfqLink || "",
      r.date,
      r.total > 0 ? String(r.total) : "",
      r.status,
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `submitted-quotations-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SupplierQuotationsPage() {
  const { supplierName, erpSupplierName, isReady } = useSupplierSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submittingDraft, setSubmittingDraft] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");

  const sqsQuery = useQuery({
    queryKey: ["supplier-portal-quotations", erpSupplierName],
    enabled: !!erpSupplierName,
    queryFn: () => getSupplierQuotations(erpSupplierName),
  });

  const sqDetailsQuery = useQuery<SupplierQuotation[]>({
    queryKey: [
      "supplier-portal-quotations-details",
      (sqsQuery.data ?? []).map((s) => s.name).join("|"),
    ],
    enabled: (sqsQuery.data ?? []).length > 0,
    queryFn: async () => {
      const results = await Promise.allSettled(
        (sqsQuery.data ?? []).map((sq) => getSupplierQuotation(sq.name)),
      );
      return results
        .filter(
          (r): r is PromiseFulfilledResult<SupplierQuotation> =>
            r.status === "fulfilled",
        )
        .map((r) => r.value);
    },
  });

  async function submitDraftQuotation(docName: string) {
    setSubmittingDraft(docName);
    try {
      const fresh = await apiGet<{
        modified?: string;
        data?: { modified?: string };
      }>(
        `/api/resource/Supplier%20Quotation/${encodeURIComponent(docName)}`,
      );
      const modified =
        (fresh as { modified?: string }).modified ??
        (fresh as { data?: { modified?: string } }).data?.modified;

      const body: Record<string, unknown> = { docstatus: 1 };
      if (modified) body.modified = modified;

      await apiPut(
        `/api/resource/Supplier%20Quotation/${encodeURIComponent(docName)}`,
        body,
      );

      toast.success(`✅ ${docName} submitted!`);
      void queryClient.invalidateQueries({
        queryKey: ["supplier-portal-quotations", supplierName],
      });
      void queryClient.invalidateQueries({
        queryKey: ["supplier-portal-quotations-details"],
      });
    } catch (err) {
      toast.error(
        `Submit failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        { duration: 6_000 },
      );
    } finally {
      setSubmittingDraft(null);
    }
  }

  const rows = sqsQuery.data ?? [];
  const isLoading = sqsQuery.isLoading || sqDetailsQuery.isLoading;

  const sqDetailsMap = useMemo(() => {
    const map = new Map<string, SupplierQuotation>();
    for (const sq of sqDetailsQuery.data ?? []) {
      map.set(sq.name, sq);
    }
    return map;
  }, [sqDetailsQuery.data]);

  const normalizedRows = useMemo(
    () =>
      sortNewestFirst(rows, {
        date: (sq) => sq.transaction_date ?? sq.modified,
        name: (sq) => sq.name,
      }),
    [rows],
  );

  const { sort, setSort, sortedRows } = useListSort(
    normalizedRows,
    SQ_DEFAULT_SORT,
    SQ_COMPARATORS,
  );

  const {
    data: legalDocsBySq = new Map<
      string,
      Awaited<ReturnType<typeof getLegalDocs>>
    >(),
  } = useQuery({
    queryKey: ["supplier-legal-docs", sortedRows.map((sq) => sq.name).join("|")],
    enabled: sortedRows.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        sortedRows.map(
          async (sq) => [sq.name, await getLegalDocs(sq.name)] as const,
        ),
      );
      return new Map(entries);
    },
    staleTime: 60_000,
  });

  const enrichedRows = useMemo(() => {
    return sortedRows.map((sq) => {
      const hydrated = sqDetailsMap.get(sq.name);
      const legalDocs = legalDocsBySq.get(sq.name);
      const itemWithRfqLink = (hydrated?.items ?? []).find(
        (it) =>
          (it as { request_for_quotation?: string }).request_for_quotation,
      ) as { request_for_quotation?: string } | undefined;
      const rfqLink = itemWithRfqLink?.request_for_quotation ?? "";
      const displayStatus = deriveDisplayStatus(sq, legalDocs);
      return {
        sq,
        hydrated,
        legalDocs,
        rfqLink,
        displayStatus,
        total: sq.grand_total ?? 0,
        dateLabel: formatQuoteDate(sq.transaction_date),
        showLegalUpload: isLegalReviewPending(legalDocs),
      };
    });
  }, [sortedRows, sqDetailsMap, legalDocsBySq]);

  const summaryCounts = useMemo(() => {
    const counts = {
      Submitted: 0,
      "Under Review": 0,
      Awarded: 0,
      Rejected: 0,
    };
    for (const row of enrichedRows) {
      if (row.displayStatus in counts) {
        counts[row.displayStatus as keyof typeof counts] += 1;
      }
    }
    return counts;
  }, [enrichedRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrichedRows.filter((row) => {
      if (statusFilter !== "all" && row.displayStatus !== statusFilter) {
        return false;
      }
      if (
        !withinDateFilter(
          row.sq.transaction_date ?? row.sq.modified,
          dateFilter,
        )
      ) {
        return false;
      }
      if (!q) return true;
      return (
        row.sq.name.toLowerCase().includes(q) ||
        row.rfqLink.toLowerCase().includes(q) ||
        row.displayStatus.toLowerCase().includes(q)
      );
    });
  }, [enrichedRows, search, statusFilter, dateFilter]);

  const { page, pageSize, setPage, setPageSize } = usePagination({
    defaultPageSize: 10,
    resetKey: `${search}|${statusFilter}|${dateFilter}|${sort.key}|${sort.direction}`,
  });

  const totalRecords = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  const rangeStart = totalRecords === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, totalRecords);

  if (!isReady) {
    return (
      <>
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
          Loading…
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex w-full flex-col gap-6">
        <header>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#111827]">
            Submitted Quotations
          </h1>
          <p className="mt-1 text-[13px] text-[#64748B]">
            Quotations you have created against Netlink RFQs.
          </p>
        </header>

        <section className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          {SUMMARY_CARDS.map((card) => {
            const active = statusFilter === card.key;
            return (
              <button
                key={card.key}
                type="button"
                onClick={() =>
                  setStatusFilter((prev) =>
                    prev === card.key ? "all" : card.key,
                  )
                }
                className={`rounded-xl border border-[#E8EDF5] bg-white px-4 py-3 text-left shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.07)] border-l-4 ${card.accent} ${
                  active ? "ring-2 ring-primary-200" : ""
                }`}
              >
                <p className="text-[12px] font-medium text-[#64748B]">
                  {card.label}
                </p>
                <p className="mt-1 text-[24px] font-bold tabular-nums leading-none text-[#0F172A]">
                  {isLoading ? "—" : summaryCounts[card.key]}
                </p>
              </button>
            );
          })}
        </section>

        <section className="overflow-hidden rounded-[12px] border border-[#E8EDF5] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="flex flex-col gap-3 border-b border-[#E8EDF5] p-5 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Quotations"
                className="input-search"
                aria-label="Search Quotations"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="select-field w-full sm:w-[170px]"
              aria-label="Status filter"
            >
              <option value="all">All statuses</option>
              <option value="Submitted">Submitted</option>
              <option value="Under Review">Under Review</option>
              <option value="Awarded">Awarded</option>
              <option value="Rejected">Rejected</option>
              <option value="Closed">Closed</option>
            </select>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              className="select-field w-full sm:w-[160px]"
              aria-label="Date filter"
            >
              <option value="all">All dates</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
            <button
              type="button"
              onClick={() =>
                exportQuotationsCsv(
                  filteredRows.map((r) => ({
                    name: r.sq.name,
                    rfqLink: r.rfqLink,
                    date: r.dateLabel,
                    total: r.total,
                    status: r.displayStatus,
                  })),
                )
              }
              disabled={filteredRows.length === 0}
              className="btn-secondary"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>

          <div className="flex items-center justify-between border-b border-[#E8EDF5] px-4 py-2.5">
            <p className="text-[13px] text-[#64748B]">
              {isLoading
                ? "Loading quotations…"
                : totalRecords === 0
                  ? "Showing 0 quotations"
                  : `Showing ${rangeStart}–${rangeEnd} of ${totalRecords} quotations`}
            </p>
          </div>

          {isLoading ? (
            <div className="p-4">
              <TableSkeleton rows={6} columns={6} />
            </div>
          ) : sqsQuery.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Couldn't load your quotations"
              description="We hit an error loading quotations. This is NOT the same as having no quotations — please retry."
              action={
                <button
                  type="button"
                  onClick={() => void sqsQuery.refetch()}
                  className="rounded-xl border border-[#E8EDF5] px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Retry
                </button>
              }
            />
          ) : sortedRows.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No quotations yet"
              description="Once you submit a quotation against an RFQ it will appear here."
            />
          ) : filteredRows.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No matching quotations"
              description="Try a different search term or clear the status and date filters."
              action={
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("all");
                    setDateFilter("all");
                  }}
                  className="rounded-xl border border-[#E8EDF5] px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Clear filters
                </button>
              }
            />
          ) : (
            <>
              <div className="max-h-[min(70vh,720px)] overflow-auto p-5 pt-0">
                <table className="min-w-full text-left text-[14px]">
                  <thead className="sticky top-0 z-[1] bg-[#F8FAFC]">
                    <tr className="border-b border-[#E8EDF5]">
                      <SortableTableHeader
                        label="Quote No"
                        sortKey="name"
                        sort={sort}
                        onSort={setSort}
                        className="!px-3 !py-2 text-[13px] font-semibold text-[#64748B]"
                      />
                      <th className="px-3 py-2 text-[13px] font-semibold text-[#64748B]">
                        RFQ Ref
                      </th>
                      <SortableTableHeader
                        label="Date"
                        sortKey="date"
                        sort={sort}
                        onSort={setSort}
                        className="!px-3 !py-2 text-[13px] font-semibold text-[#64748B]"
                      />
                      <SortableTableHeader
                        label="Total Value"
                        sortKey="total"
                        sort={sort}
                        onSort={setSort}
                        className="!px-3 !py-2 text-right text-[13px] font-semibold text-[#64748B]"
                      />
                      <SortableTableHeader
                        label="Status"
                        sortKey="status"
                        sort={sort}
                        onSort={setSort}
                        className="!px-3 !py-2 text-[13px] font-semibold text-[#64748B]"
                      />
                      <th className="px-3 py-2 text-right text-[13px] font-semibold text-[#64748B]">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => {
                      const detailUrl = `/supplier/quotations/${encodeURIComponent(row.sq.name)}`;
                      const legalDocsUrl = `/supplier/quotation/${encodeURIComponent(row.sq.name)}/legal-docs`;
                      const isDraft = row.displayStatus === "Draft";

                      return (
                        <tr
                          key={row.sq.name}
                          onClick={() => navigate(detailUrl)}
                          className="cursor-pointer border-b border-[#E8EDF5] transition-colors last:border-b-0 hover:bg-[#F8FAFC]"
                        >
                          <td className="px-3 py-2 font-semibold text-primary-700">
                            {row.sq.name}
                          </td>
                          <td className="px-3 py-2 text-[#334155]">
                            {row.rfqLink ? (
                              <Link
                                to={`/supplier/rfq/${encodeURIComponent(row.rfqLink)}`}
                                className="text-primary-700 no-underline hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {row.rfqLink}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-[#334155]">
                            {row.dateLabel}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-[#111827]">
                            {row.total > 0 ? formatCurrency(row.total) : "—"}
                          </td>
                          <td
                            className="px-3 py-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <StatusPill status={row.displayStatus} />
                          </td>
                          <td
                            className="px-3 py-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-2">
                              <Link
                                to={detailUrl}
                                className="btn-secondary no-underline"
                              >
                                View Details
                              </Link>
                              <MoreMenu
                                detailUrl={detailUrl}
                                legalDocsUrl={legalDocsUrl}
                                showLegalUpload={row.showLegalUpload}
                                isDraft={isDraft}
                                submitting={submittingDraft === row.sq.name}
                                onSubmitDraft={() =>
                                  void submitDraftQuotation(row.sq.name)
                                }
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                currentPage={safePage}
                totalPages={totalPages}
                totalRecords={totalRecords}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </>
          )}
        </section>
      </div>
    </>
  );
}
