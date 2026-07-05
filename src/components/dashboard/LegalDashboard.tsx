import { useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  DollarSign,
  Gavel,
  Loader2,
  Scale,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { getDashboardConfig } from "../../config/dashboardRoles";
import { getLegalDocsByStatus } from "../../api/legalDocs";
import type { LegalDocumentSet } from "../../api/legalDocs";
import { formatCurrency, formatDate } from "../../utils/format";
import DashboardHeader from "./DashboardHeader";

interface Props {
  greetingName: string;
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function LegalDashboard({ greetingName }: Props) {
  const navigate = useNavigate();
  const dashboardConfig = getDashboardConfig("legal");

  // Three INDEPENDENT ERPNext queries — one per review_status — rather than
  // one "get everything" fetch filtered on the client. Every KPI count is
  // computed from the exact same array rendered in its matching section
  // below, so a count can never drift out of sync with the list it
  // describes. `staleTime: 0` + `refetchOnMount: "always"` guarantee a
  // decision made on another device/tab is reflected the instant this
  // dashboard loads — React Query is only a short-lived transport here,
  // never the record of truth.
  const commonOptions = {
    staleTime: 0 as const,
    refetchOnMount: "always" as const,
    refetchOnWindowFocus: true,
  };

  const pendingQuery = useQuery<LegalDocumentSet[]>({
    queryKey: ["legal-document-reviews", "Pending"],
    queryFn: () => getLegalDocsByStatus({ status: "Pending" }),
    ...commonOptions,
  });
  const approvedQuery = useQuery<LegalDocumentSet[]>({
    queryKey: ["legal-document-reviews", "Approved"],
    queryFn: () => getLegalDocsByStatus({ status: "Approved", orderBy: "approved_on desc" }),
    ...commonOptions,
  });
  const rejectedQuery = useQuery<LegalDocumentSet[]>({
    queryKey: ["legal-document-reviews", "Rejected"],
    queryFn: () => getLegalDocsByStatus({ status: "Rejected", orderBy: "approved_on desc" }),
    ...commonOptions,
  });

  const isLoading = pendingQuery.isLoading || approvedQuery.isLoading || rejectedQuery.isLoading;

  const openReview = useCallback(
    (sqName: string) => {
      navigate(`/legal/review/${encodeURIComponent(sqName)}`);
    },
    [navigate]
  );

  const allPending = pendingQuery.data ?? [];
  const allApproved = approvedQuery.data ?? [];
  const allRejected = rejectedQuery.data ?? [];

  // KPI counts are derived from the SAME arrays the sections below render —
  // by construction, "Approved Count" can never disagree with what's shown
  // in the "Recent Approved Reviews" panel (which just slices the first 5).
  const kpis = useMemo(() => {
    const pendingValue = allPending.reduce((s, r) => s + (r.grand_total ?? 0), 0);
    return {
      pending: allPending.length,
      approved: allApproved.length,
      rejected: allRejected.length,
      pendingValue,
    };
  }, [allPending, allApproved, allRejected]);

  const pendingReviews = useMemo(
    () => [...allPending].sort((a, b) => (b.grand_total ?? 0) - (a.grand_total ?? 0)),
    [allPending]
  );

  const recentApproved = useMemo(
    () =>
      [...allApproved]
        .sort((a, b) => (b.approved_on ?? "").localeCompare(a.approved_on ?? ""))
        .slice(0, 5),
    [allApproved]
  );

  const recentRejected = useMemo(
    () =>
      [...allRejected]
        .sort((a, b) => (b.approved_on ?? "").localeCompare(a.approved_on ?? ""))
        .slice(0, 5),
    [allRejected]
  );

  return (
    <div className="dashboard-stack">
      <DashboardHeader config={dashboardConfig} greetingName={greetingName} />

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={Clock}
          label="Pending Reviews"
          value={kpis.pending}
          tone="warning"
          highlight={kpis.pending > 0}
        />
        <KpiCard icon={CheckCircle2} label="Approved" value={kpis.approved} tone="success" />
        <KpiCard icon={XCircle} label="Rejected" value={kpis.rejected} tone="danger" />
        <KpiCard
          icon={DollarSign}
          label="Pending Value"
          value={formatCurrency(kpis.pendingValue)}
          tone="primary"
        />
      </div>

      {/* ── Quick Actions ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          to="/legal/reviews"
          className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm transition hover:border-primary/40 hover:shadow-md"
        >
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-white">
            <Gavel className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-neutral-900">Review Queue</p>
            <p className="text-xs text-neutral-500">View all supplier quotations awaiting legal review</p>
          </div>
          <ArrowRight className="h-4 w-4 text-neutral-400 transition group-hover:text-primary" />
        </Link>

        <Link
          to="/legal/reviews"
          className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm transition hover:border-primary/40 hover:shadow-md"
        >
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 transition group-hover:bg-emerald-500 group-hover:text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-neutral-900">All Reviews</p>
            <p className="text-xs text-neutral-500">Browse approved, rejected & pending reviews</p>
          </div>
          <ArrowRight className="h-4 w-4 text-neutral-400 transition group-hover:text-emerald-500" />
        </Link>
      </div>

      {/* ── Pending Reviews List ── */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3.5">
          <Scale className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold text-neutral-800">Pending Reviews</h2>
          {pendingReviews.length > 0 && (
            <span className="ml-auto rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-bold text-warning-700">
              {pendingReviews.length}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
            <span className="text-sm text-neutral-500">Loading reviews…</span>
          </div>
        ) : pendingReviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ShieldCheck className="mb-3 h-10 w-10 text-emerald-300" />
            <p className="text-sm font-semibold text-neutral-600">No pending reviews</p>
            <p className="mt-1 text-xs text-neutral-400">
              All supplier quotations have been reviewed. New items will appear here
              automatically as soon as a supplier submits a quotation.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {pendingReviews.slice(0, 8).map((review) => (
              <PendingReviewRow
                key={review.name ?? review.sq_name}
                review={review}
                onOpen={openReview}
              />
            ))}
          </ul>
        )}

        {pendingReviews.length > 8 && (
          <div className="border-t border-neutral-100 px-5 py-3">
            <Link
              to="/legal/reviews"
              className="text-xs font-semibold text-primary hover:underline"
            >
              View all {pendingReviews.length} pending reviews →
            </Link>
          </div>
        )}
      </div>

      {/* ── Recent Approved Reviews — review_status = "Approved", sorted by
          approved_on DESC, latest 5. Fetched from ERPNext independently of
          the Pending list above. ── */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3.5">
          <CheckCircle2 className="h-4 w-4 text-success-600" />
          <h2 className="text-sm font-bold text-neutral-800">Recent Approved Reviews</h2>
          {kpis.approved > 0 && (
            <span className="ml-auto rounded-full bg-success-100 px-2 py-0.5 text-[10px] font-bold text-success-700">
              {kpis.approved}
            </span>
          )}
        </div>

        {approvedQuery.isLoading ? (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
            <span className="text-sm text-neutral-500">Loading approved reviews…</span>
          </div>
        ) : recentApproved.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <CheckCircle2 className="mb-3 h-8 w-8 text-neutral-300" />
            <p className="text-sm font-semibold text-neutral-600">No approved reviews yet</p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {recentApproved.map((review) => (
              <ApprovedReviewRow
                key={review.name ?? review.sq_name}
                review={review}
                onOpen={openReview}
              />
            ))}
          </ul>
        )}

        {kpis.approved > 5 && (
          <div className="border-t border-neutral-100 px-5 py-3">
            <Link to="/legal/reviews" className="text-xs font-semibold text-primary hover:underline">
              View all {kpis.approved} approved reviews →
            </Link>
          </div>
        )}
      </div>

      {/* ── Recent Rejected Reviews — review_status = "Rejected", sorted by
          approved_on DESC, latest 5. ── */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3.5">
          <XCircle className="h-4 w-4 text-danger-600" />
          <h2 className="text-sm font-bold text-neutral-800">Recent Rejected Reviews</h2>
          {kpis.rejected > 0 && (
            <span className="ml-auto rounded-full bg-danger-100 px-2 py-0.5 text-[10px] font-bold text-danger-700">
              {kpis.rejected}
            </span>
          )}
        </div>

        {rejectedQuery.isLoading ? (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
            <span className="text-sm text-neutral-500">Loading rejected reviews…</span>
          </div>
        ) : recentRejected.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <XCircle className="mb-3 h-8 w-8 text-neutral-300" />
            <p className="text-sm font-semibold text-neutral-600">No rejected reviews yet</p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {recentRejected.map((review) => (
              <RejectedReviewRow
                key={review.name ?? review.sq_name}
                review={review}
                onOpen={openReview}
              />
            ))}
          </ul>
        )}

        {kpis.rejected > 5 && (
          <div className="border-t border-neutral-100 px-5 py-3">
            <Link to="/legal/reviews" className="text-xs font-semibold text-primary hover:underline">
              View all {kpis.rejected} rejected reviews →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
  highlight,
}: {
  icon: typeof Clock;
  label: string;
  value: number | string;
  tone: "warning" | "success" | "danger" | "primary";
  highlight?: boolean;
}) {
  const iconTones = {
    warning: "bg-warning-50 text-warning-600",
    success: "bg-success-50 text-success-600",
    danger: "bg-danger-50 text-danger-600",
    primary: "bg-primary-50 text-primary-600",
  };
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border bg-white px-4 py-3.5 shadow-sm ${
        highlight ? "border-warning-200 ring-1 ring-warning-100" : "border-neutral-200"
      }`}
    >
      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${iconTones[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-2xl font-bold tabular-nums text-neutral-900">{value}</p>
        <p className="truncate text-[11px] font-medium uppercase tracking-wider text-neutral-500">
          {label}
        </p>
      </div>
    </div>
  );
}

function PendingReviewRow({
  review,
  onOpen,
}: {
  review: LegalDocumentSet;
  onOpen: (sqName: string) => void;
}) {
  const isHighValue = (review.grand_total ?? 0) > 500_000;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(review.sq_name)}
        className="flex w-full items-center gap-4 bg-transparent border-none px-5 py-3.5 transition hover:bg-neutral-50 cursor-pointer text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-neutral-900">
              {review.sq_name}
            </p>
            {isHighValue && (
              <span className="flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-600">
                <AlertTriangle className="h-2.5 w-2.5" /> High Value
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-neutral-500">
            {review.company ? `${review.company} · ` : ""}{review.supplier ?? "—"} · {formatCurrency(review.grand_total ?? 0)}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-bold text-warning-700">
          <Clock className="h-3 w-3" /> Pending
        </span>
        <ArrowRight className="h-4 w-4 flex-shrink-0 text-neutral-300" />
      </button>
    </li>
  );
}

function ApprovedReviewRow({
  review,
  onOpen,
}: {
  review: LegalDocumentSet;
  onOpen: (sqName: string) => void;
}) {
  return (
    <li className="flex items-center gap-4 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-neutral-900">
            {review.rfq_name || review.sq_name}
          </p>
          <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-[10px] font-bold text-success-700">
            <CheckCircle2 className="h-3 w-3" /> Approved
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-neutral-500">
          {review.supplier ?? "—"}
          {review.company ? ` · ${review.company}` : ""} · {formatCurrency(review.grand_total ?? 0)}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-neutral-400">
          Approved by {review.approved_by ?? "—"}
          {review.approved_on ? ` on ${formatDate(review.approved_on)}` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onOpen(review.sq_name)}
        className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:border-primary/40 hover:text-primary cursor-pointer"
      >
        View Details <ArrowRight className="h-3 w-3" />
      </button>
    </li>
  );
}

function RejectedReviewRow({
  review,
  onOpen,
}: {
  review: LegalDocumentSet;
  onOpen: (sqName: string) => void;
}) {
  return (
    <li className="flex items-center gap-4 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-neutral-900">
            {review.rfq_name || review.sq_name}
          </p>
          <span className="inline-flex items-center gap-1 rounded-full bg-danger-100 px-2 py-0.5 text-[10px] font-bold text-danger-700">
            <XCircle className="h-3 w-3" /> Rejected
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-neutral-500">{review.supplier ?? "—"}</p>
        <p className="mt-0.5 truncate text-[11px] text-neutral-400">
          Rejected by {review.approved_by ?? "—"}
          {review.approved_on ? ` on ${formatDate(review.approved_on)}` : ""}
        </p>
        {review.rejection_reason && (
          <p className="mt-0.5 truncate text-[11px] text-danger-600" title={review.rejection_reason}>
            Reason: {review.rejection_reason}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onOpen(review.sq_name)}
        className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:border-primary/40 hover:text-primary cursor-pointer"
      >
        View Details <ArrowRight className="h-3 w-3" />
      </button>
    </li>
  );
}
