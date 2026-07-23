import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Inbox,
  RefreshCw,
  Search,
} from "lucide-react";

import {
  getSupplierQuotations,
  getSupplierRFQs,
  type RFQRow,
} from "../../api/supplierPortal";
import { getSupplierQuotation } from "../../api/sourcing";
import { getDeclinedSuppliersByRfq } from "../../api/supplierRfqResponse";
import type { SupplierQuotation } from "../../types/erpnext";
import EmptyState from "../../components/EmptyState";
import PaginationBar from "../../components/PaginationBar";
import { TableSkeleton } from "../../components/Skeleton";
import { usePagination } from "../../hooks/usePagination";
import { formatDate } from "../../utils/format";
import { useSupplierSession } from "../../hooks/useSupplierSession";

type WorklistStatus =
  | "Awaiting"
  | "Submitted"
  | "Awarded"
  | "Closed";

type StatusFilter = "all" | WorklistStatus;
type DateFilter = "all" | "7d" | "30d" | "90d";

type ActionKind = "continue" | "details";

type EnrichedRfq = {
  rfq: RFQRow;
  status: WorklistStatus;
  action: ActionKind;
  title: string;
  buyer: string;
  dueDate: string | undefined;
  lastUpdated: string | undefined;
};

const STATUS_LABEL: Record<WorklistStatus, string> = {
  Awaiting: "Awaiting Quotation",
  Submitted: "Quotation Submitted",
  Awarded: "Awarded",
  Closed: "Closed",
};

const STATUS_BADGE: Record<WorklistStatus, string> = {
  Awaiting: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  Submitted: "bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200",
  Awarded: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  Closed: "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-200",
};

const SUMMARY_CARDS: Array<{
  key: WorklistStatus;
  label: string;
  accent: string;
}> = [
  {
    key: "Awaiting",
    label: "Awaiting Quotation",
    accent: "border-l-amber-400",
  },
  {
    key: "Submitted",
    label: "Quotation Submitted",
    accent: "border-l-primary-500",
  },
  {
    key: "Awarded",
    label: "Awarded",
    accent: "border-l-emerald-400",
  },
  {
    key: "Closed",
    label: "Closed",
    accent: "border-l-neutral-400",
  },
];

/** Internal / unpublished RFQ statuses never shown to suppliers. */
function isInternalOrUnpublishedRfq(rfq: RFQRow): boolean {
  if (rfq.docstatus !== 1) return true;
  const status = (rfq.status ?? "").trim().toLowerCase();
  if (!status) return false;
  if (status === "draft") return true;
  if (status.includes("not yet published")) return true;
  if (status.includes("internal review")) return true;
  if (status.includes("procurement review")) return true;
  return false;
}

function deriveWorklistStatus(
  rfq: RFQRow,
  hasSubmittedQuote: boolean,
  declined: boolean,
): WorklistStatus {
  const status = (rfq.status ?? "").toLowerCase();
  if (status.includes("award")) return "Awarded";
  if (
    status === "cancelled" ||
    status === "closed" ||
    status === "expired" ||
    status.includes("expired")
  ) {
    return "Closed";
  }
  if (declined) return "Closed";
  if (hasSubmittedQuote) return "Submitted";
  // Supplier draft quotation still means the RFQ is open for quoting.
  return "Awaiting";
}

function deriveAction(status: WorklistStatus): ActionKind {
  if (status === "Awaiting") return "continue";
  return "details";
}

function withinDateFilter(iso: string | undefined, filter: DateFilter): boolean {
  if (filter === "all" || !iso) return filter === "all" ? true : false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const days = filter === "7d" ? 7 : filter === "30d" ? 30 : 90;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return d >= start;
}

function StatusPill({ status }: { status: WorklistStatus }) {
  return (
    <span
      className={`inline-flex h-6 items-center whitespace-nowrap rounded-md px-2 text-[12px] font-medium ${STATUS_BADGE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function ActionCell({
  rfqName,
  action,
}: {
  rfqName: string;
  action: ActionKind;
}) {
  const to = `/supplier/rfq/${encodeURIComponent(rfqName)}`;
  const className =
    "inline-flex h-8 items-center rounded-xl border border-[#E8EDF5] bg-white px-3 text-[13px] font-medium text-[#111827] transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700";

  if (action === "continue") {
    return (
      <Link to={to} className={`${className} no-underline`}>
        Continue Quotation
      </Link>
    );
  }
  return (
    <Link to={to} className={`${className} no-underline`}>
      View Details
    </Link>
  );
}

export default function SupplierRFQsPage() {
  const { supplierName, erpSupplierName, isReady } = useSupplierSession();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[SupplierRFQsPage] Session", {
      ready: isReady,
      display_name: supplierName || "(empty)",
      erp_supplier_id: erpSupplierName || "(empty)",
      query_uses: "erpSupplierName",
    });
  }, [supplierName, erpSupplierName, isReady]);

  const rfqsQuery = useQuery({
    queryKey: ["supplier-portal-rfqs", erpSupplierName],
    enabled: !!erpSupplierName,
    queryFn: () => getSupplierRFQs(erpSupplierName),
  });

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

  const declinesQuery = useQuery({
    queryKey: [
      "supplier-portal-declines",
      erpSupplierName,
      (rfqsQuery.data ?? []).map((r) => r.name).join("|"),
    ],
    enabled: !!erpSupplierName && (rfqsQuery.data ?? []).length > 0,
    queryFn: () =>
      getDeclinedSuppliersByRfq((rfqsQuery.data ?? []).map((r) => r.name)),
  });

  const declinedRfqNames = useMemo(() => {
    const set = new Set<string>();
    const supplierKey = erpSupplierName.toLowerCase();
    for (const [rfq, suppliers] of declinesQuery.data ?? new Map()) {
      if (suppliers.has(supplierKey)) set.add(rfq);
    }
    return set;
  }, [declinesQuery.data, erpSupplierName]);

  const quoteStateByRfq = useMemo(() => {
    const map = new Map<
      string,
      { submitted: boolean; draft: boolean }
    >();
    for (const sq of sqDetailsQuery.data ?? []) {
      const isDraft =
        sq.docstatus === 0 ||
        (sq.status ?? "").toLowerCase() === "draft";
      for (const item of sq.items ?? []) {
        const link = (item as { request_for_quotation?: string })
          .request_for_quotation;
        if (!link) continue;
        const prev = map.get(link) ?? { submitted: false, draft: false };
        if (isDraft) prev.draft = true;
        else prev.submitted = true;
        map.set(link, prev);
      }
    }
    return map;
  }, [sqDetailsQuery.data]);

  const enrichedRows = useMemo((): EnrichedRfq[] => {
    return (rfqsQuery.data ?? [])
      // Defense in depth: never surface Draft / unpublished / internal RFQs.
      .filter((rfq) => !isInternalOrUnpublishedRfq(rfq))
      .map((rfq) => {
        const quotes = quoteStateByRfq.get(rfq.name);
        const status = deriveWorklistStatus(
          rfq,
          Boolean(quotes?.submitted),
          declinedRfqNames.has(rfq.name),
        );
        const title =
          (rfq.message_for_supplier ?? "").trim() ||
          (rfq.company ? `RFQ for ${rfq.company}` : "Request for Quotation");
        return {
          rfq,
          status,
          action: deriveAction(status),
          title,
          buyer: rfq.company?.trim() || "—",
          dueDate: rfq.valid_till || undefined,
          lastUpdated: rfq.modified,
        };
      });
  }, [rfqsQuery.data, quoteStateByRfq, declinedRfqNames]);

  const summaryCounts = useMemo(() => {
    const counts: Record<WorklistStatus, number> = {
      Awaiting: 0,
      Submitted: 0,
      Awarded: 0,
      Closed: 0,
    };
    for (const row of enrichedRows) counts[row.status] += 1;
    return counts;
  }, [enrichedRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrichedRows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!withinDateFilter(row.lastUpdated ?? row.rfq.transaction_date, dateFilter)) {
        return false;
      }
      if (!q) return true;
      return (
        row.rfq.name.toLowerCase().includes(q) ||
        row.title.toLowerCase().includes(q) ||
        row.buyer.toLowerCase().includes(q)
      );
    });
  }, [enrichedRows, search, statusFilter, dateFilter]);

  const { page, pageSize, setPage, setPageSize } = usePagination({
    defaultPageSize: 10,
    resetKey: `${search}|${statusFilter}|${dateFilter}`,
  });

  const totalRecords = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  const isLoading =
    rfqsQuery.isLoading || sqsQuery.isLoading || sqDetailsQuery.isLoading;

  const refreshing =
    rfqsQuery.isFetching ||
    sqsQuery.isFetching ||
    sqDetailsQuery.isFetching ||
    declinesQuery.isFetching;

  function handleRefresh() {
    void rfqsQuery.refetch();
    void sqsQuery.refetch();
    void declinesQuery.refetch();
  }

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
            My RFQs
          </h1>
          <p className="mt-1 text-[13px] text-[#64748B]">
            Manage and respond to procurement requests.
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
                className={`rounded-2xl border border-[#E8EDF5] bg-white px-4 py-3 text-left shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.07)] border-l-4 ${card.accent} ${
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
                placeholder="Search RFQs"
                className="input-search"
                aria-label="Search RFQs"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="select-field h-10 w-full sm:w-[160px]"
              aria-label="Status filter"
            >
              <option value="all">All statuses</option>
              <option value="Awaiting">Awaiting Quotation</option>
              <option value="Submitted">Quotation Submitted</option>
              <option value="Awarded">Awarded</option>
              <option value="Closed">Closed / Expired</option>
            </select>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              className="select-field h-10 w-full sm:w-[160px]"
              aria-label="Date filter"
            >
              <option value="all">All dates</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#E8EDF5] bg-white px-3.5 text-[13px] font-medium text-[#111827] transition hover:bg-neutral-50 disabled:opacity-60"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>

          {isLoading ? (
            <div className="p-4">
              <TableSkeleton rows={6} columns={6} />
            </div>
          ) : rfqsQuery.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Couldn't load your RFQs"
              description="We hit an error reaching ERPNext. This is NOT the same as having no RFQs — please retry."
              action={
                <button
                  type="button"
                  onClick={() => void rfqsQuery.refetch()}
                  className="rounded-xl border border-[#E8EDF5] px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Retry
                </button>
              }
            />
          ) : enrichedRows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No RFQs yet"
              description="You haven't been invited to any RFQs. Netlink procurement will notify you when one is ready."
            />
          ) : filteredRows.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No matching RFQs"
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
                <table className="min-w-full text-left">
                  <thead className="sticky top-0 z-[1] bg-[#F8FAFC]">
                    <tr className="border-b border-[#E8EDF5]">
                      <th className="px-4 py-2.5 text-[14px] font-semibold text-[#64748B]">
                        RFQ Number
                      </th>
                      <th className="px-4 py-2.5 text-[14px] font-semibold text-[#64748B]">
                        Buyer
                      </th>
                      <th className="px-4 py-2.5 text-[14px] font-semibold text-[#64748B]">
                        Last Updated
                      </th>
                      <th className="px-4 py-2.5 text-[14px] font-semibold text-[#64748B]">
                        Due Date
                      </th>
                      <th className="px-4 py-2.5 text-[14px] font-semibold text-[#64748B]">
                        Status
                      </th>
                      <th className="px-4 py-2.5 text-[14px] font-semibold text-[#64748B]">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => (
                        <tr
                          key={row.rfq.name}
                          className="border-b border-[#E8EDF5] transition-colors last:border-b-0 hover:bg-[#F8FAFC]"
                        >
                          <td className="px-4 py-2.5 align-middle">
                            <p className="text-[15px] font-semibold text-[#111827]">
                              {row.rfq.name}
                            </p>
                            <p className="mt-0.5 max-w-[280px] truncate text-[12px] text-[#64748B]">
                              {row.title}
                            </p>
                          </td>
                          <td className="px-4 py-2.5 align-middle text-[15px] text-[#111827]">
                            {row.buyer}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 align-middle text-[15px] text-[#334155]">
                            {row.lastUpdated
                              ? formatDate(row.lastUpdated)
                              : "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 align-middle text-[15px] text-[#334155]">
                            {row.dueDate ? formatDate(row.dueDate) : "—"}
                          </td>
                          <td className="px-4 py-2.5 align-middle">
                            <StatusPill status={row.status} />
                          </td>
                          <td className="px-4 py-2.5 align-middle">
                            <ActionCell
                              rfqName={row.rfq.name}
                              action={row.action}
                            />
                          </td>
                        </tr>
                      ))}
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
