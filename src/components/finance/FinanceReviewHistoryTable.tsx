import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Clock, History, XCircle } from "lucide-react";

import { getFinanceReviewHistory } from "../../api/financeReviews";
import type { FinanceReviewItem, FinanceReviewStatus } from "../../types/erpnext";
import { Skeleton } from "../Skeleton";
import { formatCurrency, formatDate } from "../../utils/format";

const STATUS_TONE: Record<FinanceReviewStatus, string> = {
  "Pending Finance Review": "bg-warning-100 text-warning-700",
  "Budget Approved": "bg-success-100 text-success-700",
  Rejected: "bg-danger-100 text-danger-700",
};

export default function FinanceReviewHistoryTable() {
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["finance-review-history"],
    queryFn: () => getFinanceReviewHistory(10),
    staleTime: 60_000,
    retry: false,
  });

  return (
    <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-neutral-500" />
          <h2 className="text-sm font-bold text-neutral-900">Recent RFQ Financial Reviews</h2>
        </div>
        <Link
          to="/budget/pending-reviews"
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary no-underline hover:underline"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <p className="px-4 py-6 text-center text-sm text-neutral-500">
          Could not load review history from ERPNext.
        </p>
      ) : data.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-neutral-500">
          No approved or rejected RFQ financial reviews yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                <th className="px-4 py-2.5">RFQ</th>
                <th className="px-4 py-2.5">Supplier</th>
                <th className="px-4 py-2.5 text-right">Value</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Reviewed</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <HistoryRow key={row.rfq_name} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function HistoryRow({ row }: { row: FinanceReviewItem }) {
  const tone = STATUS_TONE[row.finance_status];
  const Icon =
    row.finance_status === "Budget Approved"
      ? CheckCircle2
      : row.finance_status === "Rejected"
      ? XCircle
      : Clock;
  const label =
    row.finance_status === "Budget Approved"
      ? "Approved"
      : row.finance_status === "Pending Finance Review"
      ? "Pending"
      : row.finance_status;

  return (
    <tr className="border-b border-neutral-50 hover:bg-neutral-50/80">
      <td className="px-4 py-2.5 font-semibold text-neutral-900">{row.rfq_name}</td>
      <td className="px-4 py-2.5 text-neutral-600">{row.supplier ?? "—"}</td>
      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-neutral-900">
        {formatCurrency(row.rfq_value ?? 0)}
      </td>
      <td className="px-4 py-2.5">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
          <Icon className="h-3 w-3" /> {label}
        </span>
      </td>
      <td className="px-4 py-2.5 text-neutral-500">
        {row.finance_review_date
          ? formatDate(row.finance_review_date)
          : row.finance_reviewer ?? "—"}
      </td>
      <td className="px-4 py-2.5 text-right">
        <Link
          to={`/finance/reviews/${encodeURIComponent(row.rfq_name)}`}
          className="text-xs font-semibold text-primary no-underline hover:underline"
        >
          Open
        </Link>
      </td>
    </tr>
  );
}
