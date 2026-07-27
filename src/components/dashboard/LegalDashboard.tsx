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
import {
  APPROVAL_WORKFLOW_QUERY_KEY,
  computeApprovalWorkflowCounters,
  filterByWorkflowStage,
  getApprovalWorkflowRecords,
  type ApprovalWorkflowRecord,
} from "../../api/approvalWorkflow";
import { formatCurrency, formatDate } from "../../utils/format";
import DashboardHeader from "./DashboardHeader";
import DashboardKpiCard, { DashboardKpiGrid } from "./DashboardKpiCard";
import SlaCountdownWidget from "../sla/SlaCountdownWidget";

interface Props {
  greetingName: string;
}

/**
 * Legal Dashboard — filters the shared approval workflow dataset to
 * Workflow Stage == "Legal Review". Approved / Rejected KPIs come from the
 * same dataset (Completed / Rejected stages). Never a separate review list.
 */
export default function LegalDashboard({ greetingName }: Props) {
  const navigate = useNavigate();
  const dashboardConfig = getDashboardConfig("legal");

  const workflowQuery = useQuery({
    queryKey: [APPROVAL_WORKFLOW_QUERY_KEY],
    queryFn: getApprovalWorkflowRecords,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const records = workflowQuery.data ?? [];
  const isLoading = workflowQuery.isLoading;

  const counters = useMemo(
    () => computeApprovalWorkflowCounters(records),
    [records],
  );

  const pendingReviews = useMemo(
    () =>
      filterByWorkflowStage(records, "Legal Review").sort(
        (a, b) => b.grandTotal - a.grandTotal,
      ),
    [records],
  );

  const recentApproved = useMemo(
    () =>
      filterByWorkflowStage(records, "Completed")
        .concat(filterByWorkflowStage(records, "Procurement"))
        .sort((a, b) => (b.updatedDate ?? "").localeCompare(a.updatedDate ?? ""))
        .slice(0, 5),
    [records],
  );

  const recentRejected = useMemo(
    () =>
      filterByWorkflowStage(records, "Rejected")
        .sort((a, b) => (b.updatedDate ?? "").localeCompare(a.updatedDate ?? ""))
        .slice(0, 5),
    [records],
  );

  const openReview = useCallback(
    (sqName: string) => {
      navigate(`/legal/review/${encodeURIComponent(sqName)}`);
    },
    [navigate],
  );

  return (
    <div className="dashboard-stack">
      <DashboardHeader config={dashboardConfig} greetingName={greetingName} />

      <DashboardKpiGrid columns={4}>
        <DashboardKpiCard
          icon={Clock}
          label="Pending Reviews"
          value={counters.pendingLegal}
          iconClassName="bg-warning-50 text-warning-600"
          className={
            counters.pendingLegal > 0
              ? "border-warning-200 ring-1 ring-warning-100"
              : undefined
          }
        />
        <DashboardKpiCard
          icon={CheckCircle2}
          label="Approved"
          value={counters.approved}
          iconClassName="bg-success-50 text-success-600"
        />
        <DashboardKpiCard
          icon={XCircle}
          label="Rejected"
          value={counters.rejected}
          iconClassName="bg-danger-50 text-danger-600"
        />
        <DashboardKpiCard
          icon={DollarSign}
          label="Pending Value"
          value={formatCurrency(counters.pendingLegalValue)}
          iconClassName="bg-primary-50 text-primary-600"
        />
      </DashboardKpiGrid>

      <SlaCountdownWidget role="legal" title="Legal SLA Countdown" />

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
            <p className="text-xs text-neutral-500">
              Workflow stage: Legal Review — same dataset as Finance
            </p>
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
              All items in Legal Review have been decided. New RFQs appear here when
              Procurement selects a supplier.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {pendingReviews.slice(0, 8).map((review) => (
              <PendingReviewRow
                key={review.id}
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

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3.5">
          <CheckCircle2 className="h-4 w-4 text-success-600" />
          <h2 className="text-sm font-bold text-neutral-800">Recent Approved Reviews</h2>
          {counters.approved > 0 && (
            <span className="ml-auto rounded-full bg-success-100 px-2 py-0.5 text-[10px] font-bold text-success-700">
              {counters.approved}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
            <span className="text-sm text-neutral-500">Loading approved reviews…</span>
          </div>
        ) : recentApproved.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <CheckCircle2 className="mb-3 h-8 w-8 text-neutral-300" />
            <p className="text-sm font-semibold text-neutral-600">No completed approvals yet</p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {recentApproved.map((review) => (
              <ApprovedReviewRow
                key={review.id}
                review={review}
                onOpen={openReview}
              />
            ))}
          </ul>
        )}

        {counters.approved > 5 && (
          <div className="border-t border-neutral-100 px-5 py-3">
            <Link to="/legal/reviews" className="text-xs font-semibold text-primary hover:underline">
              View all {counters.approved} approved reviews →
            </Link>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3.5">
          <XCircle className="h-4 w-4 text-danger-600" />
          <h2 className="text-sm font-bold text-neutral-800">Recent Rejected Reviews</h2>
          {counters.rejected > 0 && (
            <span className="ml-auto rounded-full bg-danger-100 px-2 py-0.5 text-[10px] font-bold text-danger-700">
              {counters.rejected}
            </span>
          )}
        </div>

        {isLoading ? (
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
                key={review.id}
                review={review}
                onOpen={openReview}
              />
            ))}
          </ul>
        )}

        {counters.rejected > 5 && (
          <div className="border-t border-neutral-100 px-5 py-3">
            <Link to="/legal/reviews" className="text-xs font-semibold text-primary hover:underline">
              View all {counters.rejected} rejected reviews →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function PendingReviewRow({
  review,
  onOpen,
}: {
  review: ApprovalWorkflowRecord;
  onOpen: (sqName: string) => void;
}) {
  const isHighValue = review.grandTotal > 500_000;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(review.sqName)}
        className="flex w-full items-center gap-4 bg-transparent border-none px-5 py-3.5 transition hover:bg-neutral-50 cursor-pointer text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-neutral-900">
              {review.rfqNumber}
            </p>
            {isHighValue && (
              <span className="flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-600">
                <AlertTriangle className="h-2.5 w-2.5" /> High Value
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-neutral-500">
            {review.sqName && review.sqName !== review.rfqNumber
              ? `${review.sqName} · `
              : ""}
            {review.company ? `${review.company} · ` : ""}
            {review.supplier || "—"} · {formatCurrency(review.grandTotal)}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-bold text-warning-700">
          <Clock className="h-3 w-3" /> Legal Review
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
  review: ApprovalWorkflowRecord;
  onOpen: (sqName: string) => void;
}) {
  return (
    <li className="flex items-center gap-4 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-neutral-900">
            {review.rfqNumber}
          </p>
          <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-[10px] font-bold text-success-700">
            <CheckCircle2 className="h-3 w-3" /> Completed
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-neutral-500">
          {review.supplier || "—"}
          {review.company ? ` · ${review.company}` : ""} · {formatCurrency(review.grandTotal)}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-neutral-400">
          Approved by {review.approver ?? "—"}
          {review.updatedDate ? ` on ${formatDate(review.updatedDate)}` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onOpen(review.sqName)}
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
  review: ApprovalWorkflowRecord;
  onOpen: (sqName: string) => void;
}) {
  const reason = review.financeRejectionReason || review.legalRejectionReason;
  return (
    <li className="flex items-center gap-4 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-neutral-900">
            {review.rfqNumber}
          </p>
          <span className="inline-flex items-center gap-1 rounded-full bg-danger-100 px-2 py-0.5 text-[10px] font-bold text-danger-700">
            <XCircle className="h-3 w-3" /> Rejected
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-neutral-500">{review.supplier || "—"}</p>
        <p className="mt-0.5 truncate text-[11px] text-neutral-400">
          Rejected by {review.approver ?? "—"}
          {review.updatedDate ? ` on ${formatDate(review.updatedDate)}` : ""}
        </p>
        {reason && (
          <p className="mt-0.5 truncate text-[11px] text-danger-600" title={reason}>
            Reason: {reason}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onOpen(review.sqName)}
        className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:border-primary/40 hover:text-primary cursor-pointer"
      >
        View Details <ArrowRight className="h-3 w-3" />
      </button>
    </li>
  );
}
