import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  Flame,
  FolderOpen,
  Gavel,
  Loader2,
  RefreshCw,
  Shield,
  ShoppingCart,
  User,
  XCircle,
} from "lucide-react";

import { getLegalReviews, batchRFQToPOMap } from "../../api/legalReviews";
import type { LegalReviewListParams } from "../../api/legalReviews";
import type { LegalReviewItem, LegalReviewStatus } from "../../types/erpnext";

import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import RejectedReviewActions from "../../components/sourcing/RejectedReviewActions";
import { formatDate, formatCurrency } from "../../utils/format";

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

type FilterStatus = LegalReviewStatus | "All" | "Completed";

const STATUS_OPTIONS: { value: FilterStatus; label: string; icon: typeof Clock }[] = [
  { value: "All", label: "All Reviews", icon: Gavel },
  { value: "Pending Legal Review", label: "Pending", icon: Clock },
  { value: "Approved", label: "Approved", icon: CheckCircle2 },
  { value: "Rejected", label: "Rejected", icon: XCircle },
  { value: "Completed", label: "With PO", icon: ShoppingCart },
];

const STATUS_ICON: Record<LegalReviewStatus, typeof Clock> = {
  "Pending Legal Review": Clock,
  Approved: CheckCircle2,
  Rejected: XCircle,
};

const STATUS_TONE: Record<LegalReviewStatus, string> = {
  "Pending Legal Review":
    "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  Approved:
    "bg-success-50 text-success-700 ring-1 ring-inset ring-success-200",
  Rejected:
    "bg-danger-50 text-danger-700 ring-1 ring-inset ring-danger-200",
};

/* -------------------------------------------------------------------------- */
/*  Main page                                                                  */
/* -------------------------------------------------------------------------- */

export default function LegalReviewsPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("All");

  const listParams: LegalReviewListParams = useMemo(
    () => ({ status: statusFilter === "Completed" ? "All" : statusFilter }),
    [statusFilter]
  );

  const {
    data: reviews = [],
    isLoading,
    isFetching,
    refetch,
    error: reviewsError,
  } = useQuery<LegalReviewItem[]>({
    queryKey: ["legal-reviews", listParams.status],
    queryFn: () => getLegalReviews(listParams),
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  const { data: allWorkItems = [] } = useQuery<LegalReviewItem[]>({
    queryKey: ["legal-reviews", "All"],
    queryFn: () => getLegalReviews({ status: "All" }),
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  const allRfqNames = useMemo(
    () => allWorkItems.map((r) => r.rfq_name),
    [allWorkItems]
  );

  const { data: rfqPoMap = new Map<string, string>() } = useQuery({
    queryKey: ["rfq-po-map", allRfqNames],
    queryFn: () => batchRFQToPOMap(allRfqNames),
    enabled: allRfqNames.length > 0,
    staleTime: 30_000,
  });

  const enrichedReviews = useMemo(() => {
    let list = reviews.map((r) => {
      const poName = rfqPoMap.get(r.rfq_name);
      return poName ? { ...r, po_name: poName } : r;
    });
    if (statusFilter === "Completed") {
      list = list.filter((r) => rfqPoMap.has(r.rfq_name));
    }
    return list;
  }, [reviews, rfqPoMap, statusFilter]);

  /* ── Split into pending (FIFO) and history ── */
  const { pendingQueue, rejectedList, historyList } = useMemo(() => {
    const pending: LegalReviewItem[] = [];
    const rejected: LegalReviewItem[] = [];
    const history: LegalReviewItem[] = [];

    for (const r of enrichedReviews) {
      if (r.legal_status === "Pending Legal Review") {
        pending.push(r);
      } else if (r.legal_status === "Rejected") {
        rejected.push(r);
      } else {
        history.push(r);
      }
    }

    pending.sort((a, b) =>
      (a.submission_date ?? "").localeCompare(b.submission_date ?? "")
    );
    rejected.sort((a, b) =>
      (b.legal_review_date ?? b.submission_date ?? "").localeCompare(
        a.legal_review_date ?? a.submission_date ?? ""
      )
    );
    history.sort((a, b) =>
      (b.legal_review_date ?? b.submission_date ?? "").localeCompare(
        a.legal_review_date ?? a.submission_date ?? ""
      )
    );

    return { pendingQueue: pending, rejectedList: rejected, historyList: history };
  }, [enrichedReviews]);

  const kpis = useMemo(() => {
    return {
      pending: allWorkItems.filter((r) => r.legal_status === "Pending Legal Review").length,
      approved: allWorkItems.filter((r) => r.legal_status === "Approved").length,
      rejected: allWorkItems.filter((r) => r.legal_status === "Rejected").length,
    };
  }, [allWorkItems]);

  const openReview = useCallback(
    (rfqId: string | undefined) => {
      if (!rfqId) return;
      navigate(`/legal/reviews/${encodeURIComponent(rfqId)}`);
    },
    [navigate]
  );

  const showPending =
    statusFilter === "All" || statusFilter === "Pending Legal Review";
  const showRejected =
    statusFilter === "All" || statusFilter === "Rejected";
  const showHistory =
    statusFilter === "All" ||
    statusFilter === "Approved" ||
    statusFilter === "Completed";

  return (
    <div>
      <PageHeader
        title="Legal Reviews"
        description="Approval work queue — pending reviews first, historical records below."
        actions={
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      />

      {/* KPI strip */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard icon={Clock} label="Pending" value={kpis.pending} tone="warning" />
        <KpiCard icon={CheckCircle2} label="Approved" value={kpis.approved} tone="success" />
        <KpiCard icon={XCircle} label="Rejected" value={kpis.rejected} tone="danger" />
      </div>

      {/* Filter pills */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isActive = statusFilter === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStatusFilter(opt.value)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                isActive
                  ? "bg-primary text-white shadow-sm"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              <Icon className="h-3 w-3" />
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-neutral-200 bg-white py-20 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
          <span className="ml-2 text-sm text-neutral-500">Loading legal reviews…</span>
        </div>
      ) : reviewsError ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-20 text-center shadow-sm">
          <Shield className="mb-3 h-8 w-8 text-danger-400" />
          <p className="text-sm font-semibold text-danger-700">Failed to load reviews</p>
          <p className="mt-1 text-xs text-neutral-500">
            {reviewsError instanceof Error ? reviewsError.message : "Unknown error"}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : enrichedReviews.length === 0 ? (
        <EmptyState
          icon={Shield}
          title={
            statusFilter === "All"
              ? "No legal review records found"
              : `No reviews matching "${statusFilter === "Completed" ? "Completed (PO Created)" : statusFilter}"`
          }
          description="Try changing the filter or check back later."
        />
      ) : (
        <div className="space-y-8">
          {/* ═══ Pending Reviews (FIFO Queue) ═══ */}
          {showPending && pendingQueue.length > 0 && (
            <section>
              <SectionHeader
                icon={Flame}
                title="Pending Reviews"
                subtitle="Oldest first — FIFO queue"
                count={pendingQueue.length}
                tone="warning"
              />
              <div className="mt-3 space-y-3">
                {pendingQueue.map((r, i) => (
                  <ReviewCard
                    key={r.rfq_name}
                    review={r}
                    index={i + 1}
                    onOpen={openReview}
                    navigate={navigate}
                    urgent
                  />
                ))}
              </div>
            </section>
          )}

          {showRejected && rejectedList.length > 0 && (
            <section>
              <SectionHeader
                icon={XCircle}
                title="Rejected RFQs"
                subtitle="Legal Rejected — view, edit, or resubmit"
                count={rejectedList.length}
                tone="neutral"
              />
              <div className="mt-3 space-y-3">
                {rejectedList.map((r) => (
                  <ReviewCard
                    key={r.rfq_name}
                    review={r}
                    onOpen={openReview}
                    navigate={navigate}
                    rejected
                  />
                ))}
              </div>
            </section>
          )}

          {/* ═══ Review History ═══ */}
          {showHistory && historyList.length > 0 && (
            <section>
              <SectionHeader
                icon={FolderOpen}
                title="Review History"
                subtitle="Approved, rejected, and completed"
                count={historyList.length}
                tone="neutral"
              />
              <div className="mt-3 space-y-3">
                {historyList.map((r) => (
                  <ReviewCard
                    key={r.rfq_name}
                    review={r}
                    onOpen={openReview}
                    navigate={navigate}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Show pending empty state when history-only filter is active */}
          {showPending && pendingQueue.length === 0 && statusFilter === "Pending Legal Review" && (
            <EmptyState
              icon={CheckCircle2}
              title="No pending reviews"
              description="All RFQs have been reviewed. New items appear when a procurement manager submits for legal clearance."
            />
          )}

          {showRejected && rejectedList.length === 0 && statusFilter === "Rejected" && (
            <EmptyState
              icon={XCircle}
              title="No rejected RFQs"
              description="Rejected RFQs appear here with options to view, edit, and resubmit."
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Sub-components                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  count,
  tone,
}: {
  icon: typeof Clock;
  title: string;
  subtitle: string;
  count: number;
  tone: "warning" | "neutral";
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-lg ${
          tone === "warning"
            ? "bg-amber-100 text-amber-600"
            : "bg-neutral-100 text-neutral-500"
        }`}
      >
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-neutral-900">{title}</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
              tone === "warning"
                ? "bg-amber-100 text-amber-700"
                : "bg-neutral-100 text-neutral-600"
            }`}
          >
            {count}
          </span>
        </div>
        <p className="text-xs text-neutral-500">{subtitle}</p>
      </div>
    </div>
  );
}

function ReviewCard({
  review,
  index,
  onOpen,
  navigate,
  urgent,
  rejected,
}: {
  review: LegalReviewItem;
  index?: number;
  onOpen: (rfqId: string | undefined) => void;
  navigate: (path: string) => void;
  urgent?: boolean;
  rejected?: boolean;
}) {
  const isPending = review.legal_status === "Pending Legal Review";
  const isRejected = review.legal_status === "Rejected";

  return (
    <div
      onClick={() => !isRejected && onOpen(review.rfq_name)}
      className={`group relative rounded-xl border bg-white shadow-sm transition hover:shadow-md ${
        urgent
          ? "border-amber-200 hover:border-amber-300 cursor-pointer"
          : isRejected
            ? "border-danger-200"
            : "border-neutral-200 hover:border-primary-200 cursor-pointer"
      }`}
    >
      {/* Urgent indicator stripe */}
      {urgent && (
        <div className="absolute inset-y-0 left-0 w-1 rounded-l-xl bg-amber-400" />
      )}

      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-6 sm:py-5 sm:pl-5 sm:pr-4">
        {/* ── Left: Identity ── */}
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          {/* FIFO number */}
          {index != null && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-xs font-bold text-amber-700">
              {index}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(review.rfq_name);
                }}
                className="truncate text-sm font-bold text-primary-700 hover:underline bg-transparent border-none p-0 cursor-pointer text-left"
                title={review.rfq_name}
              >
                {review.rfq_name}
              </button>
              <ReviewStatusBadge status={review.legal_status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-neutral-500">
              {review.company && (
                <span className="truncate" title={review.company}>
                  {review.company}
                </span>
              )}
              {review.supplier && (
                <span
                  className="inline-flex max-w-[220px] items-center gap-1 truncate"
                  title={review.supplier}
                >
                  <User className="h-3 w-3 shrink-0 text-neutral-400" />
                  {review.supplier}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Center: Key metrics ── */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 pl-10 text-xs sm:gap-x-6 sm:pl-0">
          {review.rfq_value != null && (
            <MetricChip icon={DollarSign} label="Value" value={formatCurrency(review.rfq_value)} bold />
          )}
          <MetricChip
            icon={Calendar}
            label="Submitted"
            value={review.submission_date ? formatDate(review.submission_date) : "—"}
          />
          {!isPending && (
            <MetricChip
              icon={Calendar}
              label="Reviewed"
              value={review.legal_review_date ? formatDate(review.legal_review_date) : "—"}
            />
          )}
          {review.legal_reviewer && (
            <MetricChip icon={User} label="Reviewer" value={review.legal_reviewer} />
          )}
          {!isPending && (review.terms_approved || review.warranty_approved || review.insurance_approved) && (
            <MetricChip
              icon={FileText}
              label="Docs"
              value={`${[review.terms_approved, review.warranty_approved, review.insurance_approved].filter(Boolean).length}/3`}
            />
          )}
        </div>

        {/* ── Right: PO + Action ── */}
        <div className="flex shrink-0 flex-col items-end gap-2 pl-10 sm:pl-0">
          <div className="flex items-center gap-3">
            <POChip review={review} navigate={navigate} />
            {!isRejected && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(review.rfq_name);
                }}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                  isPending
                    ? "bg-amber-600 text-white shadow-sm hover:bg-amber-700"
                    : "bg-primary-50 text-primary-700 hover:bg-primary-100"
                }`}
              >
                {isPending ? "Review Now" : "Open Review"}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {isRejected && (
            <RejectedReviewActions
              rfqName={review.rfq_name}
              reviewType="legal"
              compact
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MetricChip({
  icon: Icon,
  label,
  value,
  bold,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5" title={`${label}: ${value}`}>
      <Icon className="h-3 w-3 shrink-0 text-neutral-400" />
      <span className="text-[10px] uppercase text-neutral-400">{label}</span>
      <span
        className={`max-w-[120px] truncate tabular-nums ${
          bold ? "font-bold text-neutral-900" : "text-neutral-700"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function ReviewStatusBadge({ status }: { status: LegalReviewStatus }) {
  const Icon = STATUS_ICON[status];
  const tone = STATUS_TONE[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}
    >
      <Icon className="h-3 w-3" />
      {status === "Pending Legal Review" ? "Pending" : status}
    </span>
  );
}

function POChip({
  review,
  navigate,
}: {
  review: LegalReviewItem;
  navigate: (path: string) => void;
}) {
  if (review.po_name) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          navigate(`/p2p/purchase-orders/${encodeURIComponent(review.po_name!)}`);
        }}
        className="inline-flex shrink-0 items-center gap-1 truncate rounded-lg bg-success-50 px-2.5 py-1.5 text-[11px] font-semibold text-success-700 ring-1 ring-inset ring-success-200 transition hover:bg-success-100 cursor-pointer border-none"
        title={review.po_name}
      >
        <FileText className="h-3 w-3 shrink-0" />
        <span className="max-w-[140px] truncate">{review.po_name}</span>
      </button>
    );
  }

  if (review.legal_status !== "Approved") return null;

  const financeApproved = review.finance_status === "Budget Approved";
  if (!financeApproved) {
    return (
      <span className="shrink-0 text-[11px] text-amber-600">Awaiting Finance</span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/p2p/rfq-to-po/${encodeURIComponent(review.rfq_name)}`);
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-success-50 px-2.5 py-1.5 text-[11px] font-semibold text-success-700 transition hover:bg-success-100 cursor-pointer border-none"
    >
      Create PO
      <ArrowRight className="h-3 w-3" />
    </button>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Clock;
  label: string;
  value: number;
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
      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${iconTones[tone]}`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-bold tabular-nums text-neutral-900">{value}</p>
        <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
          {label}
        </p>
      </div>
    </div>
  );
}
