import { useLayoutEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Eye,
  Search,
  XCircle,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  approveBudget,
  canApproveBudget,
  fetchBudgets,
  fetchCompanies,
  fetchFiscalYears,
  rejectBudget,
  type BudgetListItem,
} from "../../api/budget";
import {
  triggerBudgetApproved,
  triggerBudgetRejected,
} from "../../api/notifications";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import { ConfirmDialog } from "../../components/ui";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency, formatDateTime } from "../../utils/format";

const fmt = (n: number) => formatCurrency(n);

type SortKey = "newest" | "oldest" | "largest";

type PendingAction = {
  type: "approve" | "reject";
  item: BudgetListItem;
};

export default function BudgetApprovalsPage() {
  const layout = useOptionalLayout();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const canAct = canApproveBudget(role);

  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { data: submitted = [], isLoading } = useQuery({
    queryKey: ["budget-approvals-pending"],
    queryFn: async () => {
      const all = await fetchBudgets();
      return all.filter((b) => b.status === "Submitted");
    },
    enabled: canAct,
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["budget-companies"],
    queryFn: fetchCompanies,
    enabled: canAct,
  });

  const { data: fiscalYears = [] } = useQuery({
    queryKey: ["fiscal-years"],
    queryFn: fetchFiscalYears,
    enabled: canAct,
  });

  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [fiscalYearFilter, setFiscalYearFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionNotes, setActionNotes] = useState("");
  const [acting, setActing] = useState(false);

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const b of submitted) {
      const dept = b.cost_center ?? b.project ?? "";
      if (dept) set.add(dept);
    }
    return [...set].sort();
  }, [submitted]);

  const filtered = useMemo(() => {
    let list = submitted;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.owner.toLowerCase().includes(q) ||
          (b.cost_center ?? "").toLowerCase().includes(q) ||
          (b.account ?? "").toLowerCase().includes(q)
      );
    }
    if (companyFilter) list = list.filter((b) => b.company === companyFilter);
    if (fiscalYearFilter) list = list.filter((b) => b.fiscal_year === fiscalYearFilter);
    if (deptFilter) {
      list = list.filter(
        (b) => (b.cost_center ?? b.project) === deptFilter
      );
    }
    list = [...list];
    if (sortKey === "newest") list.sort((a, b) => b.modified.localeCompare(a.modified));
    if (sortKey === "oldest") list.sort((a, b) => a.modified.localeCompare(b.modified));
    if (sortKey === "largest") list.sort((a, b) => b.budget_amount - a.budget_amount);
    return list;
  }, [submitted, search, companyFilter, fiscalYearFilter, deptFilter, sortKey]);

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ["budget-approvals-pending"] });
    await queryClient.invalidateQueries({ queryKey: ["finance-manager-budget-dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["budget-kpis"] });
    await queryClient.invalidateQueries({ queryKey: ["budget-history"] });
    await queryClient.invalidateQueries({ queryKey: ["budget-plans"] });
  }

  async function confirmAction() {
    if (!pendingAction || !canAct) return;
    if (pendingAction.type === "reject" && !actionNotes.trim()) {
      toast.error("Rejection reason is required");
      return;
    }
    setActing(true);
    try {
      if (pendingAction.type === "approve") {
        await approveBudget(pendingAction.item.name, actionNotes || undefined);
        triggerBudgetApproved(
          pendingAction.item.name,
          pendingAction.item.budget_amount,
          user?.email ?? user?.full_name
        );
        toast.success("Budget approved and activated");
      } else {
        await rejectBudget(pendingAction.item.name, actionNotes.trim());
        triggerBudgetRejected(
          pendingAction.item.name,
          user?.email ?? user?.full_name,
          actionNotes.trim()
        );
        toast.error("Budget rejected");
      }
      await invalidate();
      setPendingAction(null);
      setActionNotes("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActing(false);
    }
  }

  if (!canAct) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center">
        <p className="text-sm text-neutral-600">
          Budget approval is restricted to Finance Manager role.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Budget Approval"
        description={`Review submitted budgets · ${submitted.length} pending`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search budget ID, department, requester…"
            className="w-full rounded-lg border border-neutral-200 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <select
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
        >
          <option value="">All Companies</option>
          {companies.map((c) => (
            <option key={c.name} value={c.name}>{c.company_name ?? c.name}</option>
          ))}
        </select>
        <select
          value={fiscalYearFilter}
          onChange={(e) => setFiscalYearFilter(e.target.value)}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
        >
          <option value="">All Fiscal Years</option>
          {fiscalYears.map((fy) => (
            <option key={fy} value={fy}>{fy}</option>
          ))}
        </select>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
        >
          <option value="">All Departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="largest">Largest Budget</option>
        </select>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No budgets pending approval"
          description="Submitted budgets from Finance Executives will appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Budget ID</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Fiscal Year</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Cost Center</th>
                  <th className="px-4 py-3">Expense Account</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Requested By</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filtered.map((item) => (
                  <tr key={item.name} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-primary-700">{item.name}</td>
                    <td className="px-4 py-3">{item.company}</td>
                    <td className="px-4 py-3">{item.fiscal_year}</td>
                    <td className="px-4 py-3">{item.cost_center ?? item.project ?? "—"}</td>
                    <td className="px-4 py-3">{item.cost_center ?? "—"}</td>
                    <td className="px-4 py-3 max-w-[140px] truncate">{item.account ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmt(item.budget_amount)}</td>
                    <td className="px-4 py-3 text-neutral-600">{item.owner}</td>
                    <td className="px-4 py-3 text-neutral-500">{formatDateTime(item.modified)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                        Submitted
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => navigate(`/budget/detail/${encodeURIComponent(item.name)}`)}
                          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActionNotes("");
                            setPendingAction({ type: "approve", item });
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-success-600 px-2 py-1 text-xs font-semibold text-white hover:bg-success-700"
                        >
                          <Check className="h-3 w-3" /> Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActionNotes("");
                            setPendingAction({ type: "reject", item });
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-danger-200 px-2 py-1 text-xs font-semibold text-danger-700 hover:bg-danger-50"
                        >
                          <XCircle className="h-3 w-3" /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingAction}
        onClose={() => {
          if (!acting) {
            setPendingAction(null);
            setActionNotes("");
          }
        }}
        onConfirm={confirmAction}
        isLoading={acting}
        tone={pendingAction?.type === "approve" ? "primary" : "danger"}
        title={
          pendingAction?.type === "approve"
            ? "Approve Budget?"
            : "Reject Budget?"
        }
        description={
          pendingAction
            ? `${pendingAction.item.name} · ${fmt(pendingAction.item.budget_amount)} · ${pendingAction.item.cost_center ?? pendingAction.item.project ?? "—"}`
            : undefined
        }
        confirmLabel={pendingAction?.type === "approve" ? "Approve & Activate" : "Reject Budget"}
      />

      {pendingAction && (
        <div className="fixed inset-x-0 bottom-0 z-50 mx-auto mb-4 max-w-lg rounded-xl border border-neutral-200 bg-white p-4 shadow-xl sm:relative sm:mt-4 sm:shadow-sm">
          <label className="mb-1 block text-xs font-semibold text-neutral-600">
            {pendingAction.type === "reject" ? "Rejection reason *" : "Approval notes (optional)"}
          </label>
          <textarea
            value={actionNotes}
            onChange={(e) => setActionNotes(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            placeholder={
              pendingAction.type === "reject"
                ? "Explain why this budget is rejected…"
                : "Optional notes for audit trail…"
            }
          />
        </div>
      )}
    </div>
  );
}
