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
import { getLegalReviews } from "../../api/legalReviews";
import type { LegalReviewItem } from "../../types/erpnext";
import { formatCurrency } from "../../utils/format";
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

  const { data: reviews = [], isLoading } = useQuery<LegalReviewItem[]>({
    queryKey: ["legal-reviews", "All"],
    queryFn: () => getLegalReviews({ status: "All", limit: 200 }),
  });

  const openReview = useCallback(
    (rfqId: string) => {
      navigate(`/legal/reviews/${encodeURIComponent(rfqId)}`);
    },
    [navigate]
  );

  const kpis = useMemo(() => {
    const pending = reviews.filter((r) => r.legal_status === "Pending Legal Review");
    const approved = reviews.filter((r) => r.legal_status === "Approved");
    const rejected = reviews.filter((r) => r.legal_status === "Rejected");
    const pendingValue = pending.reduce((s, r) => s + (r.rfq_value ?? 0), 0);

    return {
      pending: pending.length,
      approved: approved.length,
      rejected: rejected.length,
      pendingValue,
    };
  }, [reviews]);

  const pendingReviews = useMemo(
    () =>
      reviews
        .filter((r) => r.legal_status === "Pending Legal Review")
        .sort((a, b) => (b.rfq_value ?? 0) - (a.rfq_value ?? 0)),
    [reviews]
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
          to="/sourcing/legal-reviews"
          className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm transition hover:border-primary/40 hover:shadow-md"
        >
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-white">
            <Gavel className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-neutral-900">Review Queue</p>
            <p className="text-xs text-neutral-500">View all RFQs awaiting legal review</p>
          </div>
          <ArrowRight className="h-4 w-4 text-neutral-400 transition group-hover:text-primary" />
        </Link>

        <Link
          to="/sourcing/legal-reviews"
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
              All RFQs have been reviewed. New items will appear when a procurement manager
              submits an RFQ for legal clearance.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {pendingReviews.slice(0, 8).map((review) => (
              <PendingReviewRow key={review.rfq_name} review={review} onOpen={openReview} />
            ))}
          </ul>
        )}

        {pendingReviews.length > 8 && (
          <div className="border-t border-neutral-100 px-5 py-3">
            <Link
              to="/sourcing/legal-reviews"
              className="text-xs font-semibold text-primary hover:underline"
            >
              View all {pendingReviews.length} pending reviews →
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
  review: LegalReviewItem;
  onOpen: (rfqId: string) => void;
}) {
  const isHighValue = (review.rfq_value ?? 0) > 500_000;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(review.rfq_name)}
        className="flex w-full items-center gap-4 bg-transparent border-none px-5 py-3.5 transition hover:bg-neutral-50 cursor-pointer text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-neutral-900">
              {review.rfq_name}
            </p>
            {isHighValue && (
              <span className="flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-600">
                <AlertTriangle className="h-2.5 w-2.5" /> High Value
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-neutral-500">
            {review.company ? `${review.company} · ` : ""}{review.supplier ?? "—"} · {formatCurrency(review.rfq_value ?? 0)}
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
