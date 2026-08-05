import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, Clock, FileSearch } from "lucide-react";

import {
  APPROVAL_WORKFLOW_QUERY_KEY,
  filterFinancePendingQueue,
  getApprovalWorkflowRecords,
} from "../../api/approvalWorkflow";
import { Skeleton } from "../Skeleton";
import { formatCurrency, formatDate } from "../../utils/format";

/**
 * Finance pending queue — Workflow Stage == "Finance Review" from the
 * shared approval workflow dataset (same records Legal Dashboard uses).
 */
export default function FinancePendingQueue() {
  const { data = [], isLoading, isError } = useQuery({
    queryKey: [APPROVAL_WORKFLOW_QUERY_KEY],
    queryFn: getApprovalWorkflowRecords,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: false,
  });

  // workflowStage == Finance Review AND financeStatus == Pending (or blank).
  const pending = filterFinancePendingQueue(data).sort(
    (a, b) => b.grandTotal - a.grandTotal,
  );

  return (
    <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <FileSearch className="h-4 w-4 text-amber-600" />
          <h2 className="text-sm font-bold text-neutral-900">Pending Finance Reviews</h2>
          {pending.length > 0 && (
            <span className="rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-bold text-warning-700">
              {pending.length}
            </span>
          )}
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
          Could not load finance queue.
        </p>
      ) : pending.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-neutral-500">
          No RFQs in Finance Review. Items appear here the moment Legal approves
          the same workflow record.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {pending.slice(0, 8).map((row) => (
            <li key={row.id}>
              <Link
                to={`/finance/reviews/${encodeURIComponent(row.rfqNumber)}`}
                className="flex w-full items-center gap-4 px-4 py-3 no-underline transition hover:bg-neutral-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-neutral-900">
                    {row.rfqNumber}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    {row.sqName && row.sqName !== row.rfqNumber
                      ? `${row.sqName} · `
                      : ""}
                    {row.supplier || "—"} · {formatCurrency(row.grandTotal)}
                    {row.updatedDate ? ` · ${formatDate(row.updatedDate)}` : ""}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-bold text-warning-700">
                  <Clock className="h-3 w-3" /> Finance Review
                </span>
                <ArrowRight className="h-4 w-4 flex-shrink-0 text-neutral-300" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
