import { useLayoutEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Eye, Loader2, Pencil } from "lucide-react";

import {
  getExecutiveBudgetList,
  type ExecutiveBudgetRow,
} from "../../api/budgetDashboard";
import type { BudgetWorkflowStatus } from "../../api/budget";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import { formatCurrency, formatDate } from "../../utils/format";

const STATUS_TONE: Record<string, string> = {
  Draft: "bg-neutral-100 text-neutral-700",
  Submitted: "bg-amber-50 text-amber-700",
  Approved: "bg-success-50 text-success-700",
  Active: "bg-emerald-50 text-emerald-700",
  Rejected: "bg-danger-50 text-danger-700",
  Cancelled: "bg-neutral-100 text-neutral-500",
};

/** Budget Requests tracks the request lifecycle, not activated budgets. */
const REQUEST_STATUSES: BudgetWorkflowStatus[] = [
  "Draft",
  "Submitted",
  "Approved",
  "Rejected",
];

export default function BudgetRequestsPage() {
  const layout = useOptionalLayout();
  const navigate = useNavigate();

  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  // Same live ERPNext query as the Budget Dashboard / My Budgets — a single
  // shared service so the three views can never diverge.
  const { data: all = [], isLoading } = useQuery<ExecutiveBudgetRow[]>({
    queryKey: ["budget-executive-list"],
    queryFn: getExecutiveBudgetList,
    staleTime: 20_000,
  });

  const budgets = useMemo(
    () => all.filter((b) => REQUEST_STATUSES.includes(b.status)),
    [all],
  );

  return (
    <div>
      <PageHeader
        title="Budget Requests"
        description="Track budget requests through the Finance Manager approval workflow."
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        </div>
      ) : budgets.length === 0 ? (
        <EmptyState
          title="No budgets found"
          description="Submitted, approved, and rejected budget requests will appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Budget ID</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Cost Center</th>
                  <th className="px-4 py-3 text-right">Budget Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Submitted By</th>
                  <th className="px-4 py-3">Submitted Date</th>
                  <th className="px-4 py-3">Current Approver</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {budgets.map((b) => {
                  const isDraft = b.status === "Draft";
                  return (
                    <tr key={b.name} className="hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-primary-700">
                        {b.name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-700">
                        {b.company}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                        {b.department}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                        {b.costCenter}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-neutral-900">
                        {formatCurrency(b.allocated)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[b.status] ?? STATUS_TONE.Draft}`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                        {b.submittedBy}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-500">
                        {isDraft ? "—" : formatDate(b.modified)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                        {b.currentApprover}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            navigate(`/budget/detail/${encodeURIComponent(b.name)}`)
                          }
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:underline"
                        >
                          {isDraft ? (
                            <>
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </>
                          ) : (
                            <>
                              <Eye className="h-3.5 w-3.5" /> View
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
