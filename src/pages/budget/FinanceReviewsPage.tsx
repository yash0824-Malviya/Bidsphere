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

import PageHeader from "../../components/PageHeader";

import RejectedReviewActions from "../../components/sourcing/RejectedReviewActions";

import { Skeleton } from "../../components/Skeleton";

import { formatCurrency, formatDate } from "../../utils/format";

import { SortableTableHeader } from "../../components/ui";

import { useListSort } from "../../hooks/useListSort";

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

    queryKey: ["finance-reviews-all"],

    queryFn: () => getFinanceReviews({ status: "All" }),

    staleTime: 30_000,

    retry: false,

  });



  const allRecords = allQuery.data ?? [];

  const isLoading = allQuery.isLoading;



  const filteredRecords = useMemo(() => {

    if (statusFilter === "All") return allRecords;

    return allRecords.filter((r) => r.finance_status === statusFilter);

  }, [allRecords, statusFilter]);



  const { sort, setSort, sortedRows } = useListSort(

    filteredRecords,

    DEFAULT_SORT,

    COMPARATORS

  );



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

        description="Complete audit history of RFQ financial reviews — pending, approved, and rejected. Data sourced from ERPNext."

      />



      {isLoading ? (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard icon={Clock} label="Pending" value={kpis.pending} tone="warning" />
          <KpiCard icon={CheckCircle2} label="Approved" value={kpis.approved} tone="success" />
          <KpiCard icon={XCircle} label="Rejected" value={kpis.rejected} tone="danger" />
        </div>
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

              statusFilter === "All"

                ? "No finance review history found"

                : `No ${STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? ""} records`

            }

            description={

              statusFilter === "All"

                ? "RFQs appear here after legal approval. Check the browser console for Finance Review API Response to verify ERPNext data."

                : statusFilter === "Pending Finance Review"

                ? "No RFQs are currently awaiting finance review."

                : `No RFQs with finance status "${statusFilter}".`

            }

          />

        ) : (

          <>

            <div className="data-card-list">

              {sortedRows.map((review) => (

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

                  {sortedRows.map((review) => (

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

  const Icon = STATUS_ICON[status];

  const tone = STATUS_TONE[status];

  const label =
    status === "Pending Finance Review" ? "Pending"
    : status === "Budget Approved" ? "Approved"
    : status;

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



function KpiCard({

  icon: Icon, label, value, tone,

}: {

  icon: typeof Clock; label: string; value: number | string;

  tone: "neutral" | "warning" | "success" | "danger" | "primary";

}) {

  const iconTones = {

    neutral: "bg-neutral-100 text-neutral-500",

    warning: "bg-warning-50 text-warning-600",

    success: "bg-success-50 text-success-600",

    danger: "bg-danger-50 text-danger-600",

    primary: "bg-primary-50 text-primary-600",

  };

  return (

    <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3.5 shadow-sm">

      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${iconTones[tone]}`}>

        <Icon className="h-5 w-5" />

      </div>

      <div>

        <p className="text-2xl font-bold tabular-nums text-neutral-900">{value}</p>

        <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{label}</p>

      </div>

    </div>

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


