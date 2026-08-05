import { useCallback, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import { useQuery } from "@tanstack/react-query";

import {

  ArrowRight,

  CheckCircle2,

  Clock,

  Shield,

  ShieldCheck,

  XCircle,

} from "lucide-react";



import { getFinanceReviews } from "../../api/financeReviews";

import type { FinanceReviewItem, FinanceReviewStatus } from "../../types/erpnext";



import EmptyState from "../../components/EmptyState";

import DashboardKpiCard, {
  DashboardKpiGrid,
} from "../../components/dashboard/DashboardKpiCard";

import PageHeader from "../../components/PageHeader";

import RejectedReviewActions from "../../components/sourcing/RejectedReviewActions";

import { Skeleton } from "../../components/Skeleton";

import { formatCurrency, formatDate } from "../../utils/format";

import { SortableTableHeader } from "../../components/ui";

import Pagination from "../../components/ui/Pagination";

import { useListSort } from "../../hooks/useListSort";

import { useClientPagination } from "../../hooks/usePagination";

import type { SortState } from "../../components/ui";



/* -------------------------------------------------------------------------- */

/*  Constants                                                                  */

/* -------------------------------------------------------------------------- */



type FilterStatus = FinanceReviewStatus | "All";



const STATUS_OPTIONS: { value: FilterStatus; label: string }[] = [

  { value: "All", label: "All Reviews" },

  { value: "Pending Finance Review", label: "Pending Review" },

  { value: "Budget Approved", label: "Approved" },

  { value: "Rejected", label: "Rejected" },

];



const STATUS_ICON: Record<FinanceReviewStatus, typeof Clock> = {
  "Pending Finance Review": Clock,
  "Budget Approved": CheckCircle2,
  Rejected: XCircle,
};

const STATUS_TONE: Record<FinanceReviewStatus, string> = {
  "Pending Finance Review": "bg-warning-100 text-warning-600",
  "Budget Approved": "bg-success-100 text-success-600",
  Rejected: "bg-danger-100 text-danger-600",
};



const DEFAULT_SORT: SortState = { key: "finance_review_date", direction: "desc" };



const COMPARATORS = {

  rfq: (a: FinanceReviewItem, b: FinanceReviewItem, dir: "asc" | "desc") => {

    const cmp = (a.rfq_name ?? "").localeCompare(b.rfq_name ?? "");

    return dir === "asc" ? cmp : -cmp;

  },

  supplier: (a: FinanceReviewItem, b: FinanceReviewItem, dir: "asc" | "desc") => {

    const cmp = (a.supplier ?? "").localeCompare(b.supplier ?? "");

    return dir === "asc" ? cmp : -cmp;

  },

  rfq_value: (a: FinanceReviewItem, b: FinanceReviewItem, dir: "asc" | "desc") => {

    const diff = (a.rfq_value ?? 0) - (b.rfq_value ?? 0);

    return dir === "asc" ? diff : -diff;

  },

  finance_review_date: (a: FinanceReviewItem, b: FinanceReviewItem, dir: "asc" | "desc") => {

    const da = a.finance_review_date ?? a.submission_date ?? "";

    const db = b.finance_review_date ?? b.submission_date ?? "";

    const cmp = da.localeCompare(db);

    return dir === "asc" ? cmp : -cmp;

  },

  finance_reviewer: (a: FinanceReviewItem, b: FinanceReviewItem, dir: "asc" | "desc") => {

    const cmp = (a.finance_reviewer ?? "").localeCompare(b.finance_reviewer ?? "");

    return dir === "asc" ? cmp : -cmp;

  },

  status: (a: FinanceReviewItem, b: FinanceReviewItem, dir: "asc" | "desc") => {

    const cmp = a.finance_status.localeCompare(b.finance_status);

    return dir === "asc" ? cmp : -cmp;

  },

};



function isPending(status: FinanceReviewStatus): boolean {

  return status === "Pending Finance Review";

}



function isApproved(status: FinanceReviewStatus): boolean {

  return status === "Budget Approved";

}



function isRejected(status: FinanceReviewStatus): boolean {

  return status === "Rejected";

}



/* -------------------------------------------------------------------------- */

/*  Main page component                                                       */

/* -------------------------------------------------------------------------- */



export default function FinanceReviewsPage() {

  const navigate = useNavigate();



  const [statusFilter, setStatusFilter] = useState<FilterStatus>("All");



  const allQuery = useQuery({

    queryKey: ["approval-workflow", "finance-reviews-all"],

    queryFn: () => getFinanceReviews({ status: "All" }),

    staleTime: 0,

    refetchOnMount: "always" as const,

    refetchOnWindowFocus: true,

    retry: false,

  });



  const allRecords = allQuery.data?.items ?? [];

  const diagnostics = allQuery.data?.diagnostics;

  const isLoading = allQuery.isLoading;

  const loadError = allQuery.error instanceof Error ? allQuery.error.message : undefined;



  const filteredRecords = useMemo(() => {

    if (statusFilter === "All") return allRecords;

    return allRecords.filter((r) => r.finance_status === statusFilter);

  }, [allRecords, statusFilter]);



  const { sort, setSort, sortedRows } = useListSort(

    filteredRecords,

    DEFAULT_SORT,

    COMPARATORS

  );

  const {
    pageRows,
    totalRecords,
    totalPages,
    currentPage,
    pageSize,
    setPage,
    setPageSize,
  } = useClientPagination(sortedRows, {
    resetKey: `${statusFilter}|${sort.key}|${sort.direction}`,
  });



  const kpis = useMemo(() => {
    return {
      pending: allRecords.filter((r) => isPending(r.finance_status)).length,
      approved: allRecords.filter((r) => isApproved(r.finance_status)).length,
      rejected: allRecords.filter((r) => isRejected(r.finance_status)).length,
    };
  }, [allRecords]);



  const openReview = useCallback(

    (rfqId: string | undefined) => {

      if (!rfqId) return;

      navigate(`/finance/reviews/${encodeURIComponent(rfqId)}`);

    },

    [navigate]

  );



  return (

    <div>

      <PageHeader

        title="RFQ Financial Review"

        description="Finance Review stage of the shared Legal → Finance → Completed workflow. Same Legal Document Review records Legal uses — filtered by stage only."

      />



      {isLoading ? (
        <DashboardKpiGrid columns={3} className="mb-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="kpi-card">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-12 w-16" />
            </div>
          ))}
        </DashboardKpiGrid>
      ) : (
        <DashboardKpiGrid columns={3} className="mb-5">
          <DashboardKpiCard
            icon={Clock}
            label="Pending"
            value={kpis.pending}
            iconClassName="bg-warning-50 text-warning-600"
          />
          <DashboardKpiCard
            icon={CheckCircle2}
            label="Approved"
            value={kpis.approved}
            iconClassName="bg-success-50 text-success-600"
          />
          <DashboardKpiCard
            icon={XCircle}
            label="Rejected"
            value={kpis.rejected}
            iconClassName="bg-danger-50 text-danger-600"
          />
        </DashboardKpiGrid>
      )}



      <div className="mb-4 flex flex-wrap items-center gap-2">

        {STATUS_OPTIONS.map((opt) => (

          <button

            key={opt.value}

            type="button"

            onClick={() => setStatusFilter(opt.value)}

            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${

              statusFilter === opt.value

                ? "bg-primary text-white shadow-sm"

                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"

            }`}

          >

            {opt.label}

          </button>

        ))}

      </div>



      <div className="table-shell">

        {isLoading ? (

          <div className="space-y-2 p-4">

            {Array.from({ length: 5 }).map((_, i) => (

              <Skeleton key={i} className="h-12 rounded-lg" />

            ))}

          </div>

        ) : sortedRows.length === 0 ? (

          <EmptyState

            icon={Shield}

            title={

              loadError

                ? "Failed to load finance reviews"

                : statusFilter === "All"

                ? "No finance review history found"

                : `No ${STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? ""} records`

            }

            description={

              loadError

                ? loadError

                : statusFilter !== "All"

                ? statusFilter === "Pending Finance Review"

                  ? "No RFQs are currently awaiting finance review."

                  : `No RFQs with finance status "${statusFilter}".`

                : diagnostics?.emptyReason ??

                  "RFQs appear here after legal approval. Data is loaded from procurement workflow fields."

            }

          />

        ) : (

          <>

            <div className="data-card-list">

              {pageRows.map((review) => (

                <ReviewMobileCard key={review.rfq_name} review={review} onOpen={openReview} />

              ))}

            </div>



            <div className="hidden overflow-x-auto md:block">

              <table className="data-table">

                <thead>

                  <tr>

                    <SortableTableHeader label="RFQ Number" sortKey="rfq" sort={sort} onSort={setSort} />

                    <SortableTableHeader label="Supplier" sortKey="supplier" sort={sort} onSort={setSort} />

                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">

                      Legal Status

                    </th>

                    <SortableTableHeader label="Finance Status" sortKey="status" sort={sort} onSort={setSort} />

                    <SortableTableHeader label="Reviewed By" sortKey="finance_reviewer" sort={sort} onSort={setSort} />

                    <SortableTableHeader label="Review Date" sortKey="finance_review_date" sort={sort} onSort={setSort} />

                    <SortableTableHeader label="Value" sortKey="rfq_value" sort={sort} onSort={setSort} className="text-right" />

                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500">

                      Action

                    </th>

                  </tr>

                </thead>

                <tbody>

                  {pageRows.map((review) => (

                    <tr key={review.rfq_name} className="group">

                      <td>

                        <button

                          type="button"

                          onClick={() => openReview(review.rfq_name)}

                          className="table-link cursor-pointer border-none bg-transparent p-0 text-left"

                        >

                          {review.rfq_name}

                        </button>

                      </td>

                      <td className="text-neutral-700">{review.supplier ?? "—"}</td>

                      <td>

                        <LegalStatusPill status={review.legal_status} />

                      </td>

                      <td>

                        <FinanceStatusBadge status={review.finance_status} />

                      </td>

                      <td className="text-neutral-600">{review.finance_reviewer ?? "—"}</td>

                      <td className="text-neutral-600">

                        {review.finance_review_date

                          ? formatDate(review.finance_review_date)

                          : "—"}

                      </td>

                      <td className="text-right tabular-nums font-semibold text-neutral-900">

                        {review.rfq_value != null ? formatCurrency(review.rfq_value) : "—"}

                      </td>

                      <td className="text-right">
                        {review.finance_status === "Rejected" ? (
                          <RejectedReviewActions
                            rfqName={review.rfq_name}
                            reviewType="finance"
                            compact
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => openReview(review.rfq_name)}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border-none bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 transition hover:bg-primary-100"
                          >
                            Open Review
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>

            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalRecords={totalRecords}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              recordLabel="reviews"
            />

          </>

        )}

      </div>

    </div>

  );

}



/* -------------------------------------------------------------------------- */

/*  Sub-components                                                            */

/* -------------------------------------------------------------------------- */



function FinanceStatusBadge({ status }: { status: FinanceReviewStatus }) {

  const Icon = STATUS_ICON[status] ?? Clock;

  const tone = STATUS_TONE[status] ?? "bg-neutral-100 text-neutral-700";

  const label =
    status === "Pending Finance Review" ? "Pending"
    : status === "Budget Approved" ? "Approved"
    : status || "—";

  return (

    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>

      <Icon className="h-3 w-3" /> {label}

    </span>

  );

}



function LegalStatusPill({ status }: { status: string }) {

  const isApproved = status === "Approved";

  return (

    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${

      isApproved ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"

    }`}>

      {isApproved ? <ShieldCheck className="h-3 w-3" /> : <Clock className="h-3 w-3" />}

      {status}

    </span>

  );

}



function ReviewMobileCard({

  review,

  onOpen,

}: {

  review: FinanceReviewItem;

  onOpen: (rfqId: string | undefined) => void;

}) {

  return (

    <div className="data-card-row" onClick={() => onOpen(review.rfq_name)}>

      <div className="data-card-field">

        <span className="data-card-label">RFQ Number</span>

        <button

          type="button"

          onClick={(e) => { e.stopPropagation(); onOpen(review.rfq_name); }}

          className="table-link cursor-pointer border-none bg-transparent p-0 text-left text-sm"

        >

          {review.rfq_name}

        </button>

      </div>

      <div className="data-card-field">

        <span className="data-card-label">Supplier</span>

        <span className="data-card-value">{review.supplier ?? "—"}</span>

      </div>

      <div className="data-card-field">

        <span className="data-card-label">Legal Status</span>

        <LegalStatusPill status={review.legal_status} />

      </div>

      <div className="data-card-field">

        <span className="data-card-label">Finance Status</span>

        <FinanceStatusBadge status={review.finance_status} />

      </div>

      <div className="data-card-field">

        <span className="data-card-label">Reviewed By</span>

        <span className="data-card-value">{review.finance_reviewer ?? "—"}</span>

      </div>

      <div className="data-card-field">

        <span className="data-card-label">Review Date</span>

        <span className="data-card-value">

          {review.finance_review_date ? formatDate(review.finance_review_date) : "—"}

        </span>

      </div>

      <div className="data-card-field">

        <span className="data-card-label">Value</span>

        <span className="data-card-value font-semibold">

          {review.rfq_value != null ? formatCurrency(review.rfq_value) : "—"}

        </span>

      </div>

      <div className="pt-2" onClick={(e) => e.stopPropagation()}>
        {review.finance_status === "Rejected" ? (
          <RejectedReviewActions
            rfqName={review.rfq_name}
            reviewType="finance"
            compact
          />
        ) : (
          <button
            type="button"
            onClick={() => onOpen(review.rfq_name)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border-none bg-primary-50 px-4 py-2 text-xs font-semibold text-primary-700 transition hover:bg-primary-100"
          >
            Open Review
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

    </div>

  );

}


