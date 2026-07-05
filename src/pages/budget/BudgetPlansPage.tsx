import { useLayoutEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  ClipboardList,
  Download,
  Eye,
  Plus,
  Search,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  canApproveBudget,
  canCreateBudget,
  cancelBudget,
  fetchFiscalYears,
  getBudgetPlans,
} from "../../api/budget";
import type { BudgetPlan } from "../../api/budget";
import type { BudgetWorkflowStatus } from "../../api/erpBudget";
import PageHeader from "../../components/PageHeader";
import { ConfirmDialog } from "../../components/ui";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency } from "../../utils/format";

const fmt = (n: number) => formatCurrency(n);

const STATUSES: BudgetWorkflowStatus[] = [
  "Draft",
  "Submitted",
  "Approved",
  "Active",
  "Rejected",
  "Cancelled",
];

export default function BudgetPlansPage() {
  const layout = useOptionalLayout();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canCreate = canCreateBudget(role);
  const canCancel = canApproveBudget(role);

  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["budget-plans"],
    queryFn: getBudgetPlans,
  });

  const { data: fiscalYears = [] } = useQuery({
    queryKey: ["fiscal-years"],
    queryFn: fetchFiscalYears,
  });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fiscalFilter, setFiscalFilter] = useState("");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const filtered = useMemo(() => {
    let list = plans;
    if (statusFilter) list = list.filter((p) => p.status === statusFilter);
    if (fiscalFilter) list = list.filter((p) => p.fiscalYear === fiscalFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.department.toLowerCase().includes(q)
      );
    }
    return list;
  }, [plans, search, statusFilter, fiscalFilter]);

  function exportCSV() {
    const header =
      "Budget ID,Department,Cost Center,Amount,Fiscal Year,Status,Utilization,Remaining";
    const rows = filtered.map((p) =>
      [
        p.name,
        p.department,
        p.department,
        p.amount,
        p.fiscalYear,
        p.status,
        p.amount > 0 ? Math.round((p.consumed / p.amount) * 100) : 0,
        Math.max(p.amount - p.consumed, 0),
      ].join(",")
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-plans-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCancel() {
    if (!cancelId) return;
    setCancelling(true);
    try {
      await cancelBudget(cancelId);
      toast.success("Budget cancelled in ERPNext");
      await queryClient.invalidateQueries({ queryKey: ["budget-plans"] });
      setCancelId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Budget Plans"
        description={`All ERPNext budgets · ${plans.length} records`}
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={exportCSV}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50"
            >
              <Download className="h-3.5 w-3.5" /> Export
            </button>
            {canCreate && (
              <Link
                to="/budget/create"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-700 no-underline"
              >
                <Plus className="h-3.5 w-3.5" /> Create Budget
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search budget ID or department…"
            className="w-full rounded-lg border border-neutral-200 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
        >
          <option value="">All Status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={fiscalFilter}
          onChange={(e) => setFiscalFilter(e.target.value)}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
        >
          <option value="">All Fiscal Years</option>
          {fiscalYears.map((fy) => (
            <option key={fy} value={fy}>{fy}</option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3">Budget ID</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Cost Center</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Fiscal Year</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Utilization</th>
                <th className="px-4 py-3 text-right">Remaining</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-neutral-400">
                    Loading ERPNext budgets…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center">
                    <ClipboardList className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
                    <p className="text-sm text-neutral-600">No budget plans found</p>
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const utilPct =
                    p.amount > 0 ? Math.round((p.consumed / p.amount) * 100) : 0;
                  const remaining = Math.max(p.amount - p.consumed, 0);
                  return (
                    <tr key={p.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 font-medium text-primary-700">{p.name}</td>
                      <td className="px-4 py-3">{p.department}</td>
                      <td className="px-4 py-3">{p.department}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmt(p.amount)}</td>
                      <td className="px-4 py-3">{p.fiscalYear}</td>
                      <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                      <td className="px-4 py-3 text-right tabular-nums">{utilPct}%</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(remaining)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => navigate(`/budget/detail/${encodeURIComponent(p.id)}`)}
                            className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                          >
                            <Eye className="h-3 w-3" /> View
                          </button>
                          {canCancel && p.status === "Active" && (
                            <button
                              type="button"
                              onClick={() => setCancelId(p.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-danger-200 px-2 py-1 text-xs font-semibold text-danger-700 hover:bg-danger-50"
                            >
                              <Ban className="h-3 w-3" /> Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={!!cancelId}
        onClose={() => !cancelling && setCancelId(null)}
        onConfirm={handleCancel}
        isLoading={cancelling}
        tone="danger"
        title="Cancel active budget?"
        description="This budget will no longer be available for procurement RFQ validation."
        confirmLabel="Cancel Budget"
      />
    </div>
  );
}

function StatusBadge({ status }: { status: BudgetPlan["status"] }) {
  const cfg: Record<string, string> = {
    Active: "bg-emerald-50 text-emerald-700",
    Draft: "bg-neutral-100 text-neutral-600",
    Submitted: "bg-amber-50 text-amber-700",
    Approved: "bg-success-50 text-success-700",
    Rejected: "bg-red-50 text-red-700",
    Cancelled: "bg-neutral-100 text-neutral-500",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cfg[status] ?? cfg.Draft}`}>
      {status}
    </span>
  );
}
