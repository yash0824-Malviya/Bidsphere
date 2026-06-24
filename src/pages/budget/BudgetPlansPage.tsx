import { useLayoutEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ClipboardList,
  Edit2,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import {
  createBudgetPlan,
  deleteBudgetPlan,
  getBudgetPlans,
  updateBudgetPlan,
} from "../../api/budget";
import type { BudgetPlan } from "../../api/budget";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency } from "../../utils/format";
import hotToast from "react-hot-toast";

const fmt = (n: number) => formatCurrency(n);

const STATUSES: BudgetPlan["status"][] = ["Active", "Draft", "Closed", "Exceeded"];
const DEPARTMENTS = ["IT", "Administration", "Marketing", "Production", "R&D", "HR", "Finance", "Operations", "Sales", "Legal"];
const FISCAL_YEARS = ["2024-2025", "2025-2026", "2026-2027"];

type PanelMode = "create" | "edit" | null;

interface FormState {
  name: string;
  fiscalYear: string;
  department: string;
  amount: string;
  currency: string;
  status: BudgetPlan["status"];
}

const emptyForm: FormState = { name: "", fiscalYear: "2025-2026", department: "", amount: "", currency: "USD", status: "Active" };

export default function BudgetPlansPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === "finance" || role === "admin";

  const [plans, setPlans] = useState<BudgetPlan[]>(getBudgetPlans);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  function reload() {
    const fresh = getBudgetPlans();
    setPlans(fresh);
    // eslint-disable-next-line no-console
    console.log("[Budget] Plans page reload", { count: fresh.length });
  }

  const filtered = useMemo(() => {
    let list = plans;
    if (statusFilter) list = list.filter((p) => p.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.department.toLowerCase().includes(q));
    }
    return list;
  }, [plans, search, statusFilter]);

  function openCreate() {
    setForm(emptyForm);
    setEditId(null);
    setPanelMode("create");
  }

  function openEdit(plan: BudgetPlan) {
    setForm({ name: plan.name, fiscalYear: plan.fiscalYear, department: plan.department, amount: String(plan.amount), currency: plan.currency, status: plan.status });
    setEditId(plan.id);
    setPanelMode("edit");
  }

  function handleSave() {
    if (!form.name || !form.department || !form.amount) {
      hotToast.error("Fill all required fields");
      return;
    }
    if (panelMode === "create") {
      createBudgetPlan({ name: form.name, fiscalYear: form.fiscalYear, department: form.department, amount: Number(form.amount), currency: form.currency });
      hotToast.success("Budget plan created");
    } else if (panelMode === "edit" && editId) {
      updateBudgetPlan(editId, { name: form.name, fiscalYear: form.fiscalYear, department: form.department, amount: Number(form.amount), currency: form.currency, status: form.status });
      hotToast.success("Budget plan updated");
    }
    reload();
    setPanelMode(null);
  }

  function handleDelete(id: string) {
    deleteBudgetPlan(id);
    reload();
    setDeleteConfirm(null);
    hotToast.success("Budget plan deleted");
  }

  return (
    <div className="-mt-1 flex gap-3">
      {/* Main table */}
      <div className="flex-1 min-w-0">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
              <ClipboardList className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-neutral-900">Budget Plans</h1>
              <p className="text-[10px] text-neutral-500">Create &middot; Edit &middot; Manage budget allocations</p>
            </div>
          </div>
          {canEdit && (
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-primary-700 cursor-pointer border-none">
              <Plus className="h-3 w-3" /> New Plan
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="mb-2 flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search plans..." className="w-full rounded-md border border-neutral-200 bg-white py-1.5 pl-8 pr-3 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200" />
          </div>
          <div className="relative">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="appearance-none rounded-md border border-neutral-200 bg-white py-1.5 pl-2.5 pr-7 text-xs text-neutral-700 focus:border-primary-400 focus:outline-none">
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
          </div>
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-neutral-200 bg-white py-14 text-center shadow-sm">
            <ClipboardList className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
            <p className="text-sm font-medium text-neutral-700">No budget plans found</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50">
                  <tr className="border-b border-neutral-200">
                    <th className="px-2.5 py-2 text-left font-semibold text-neutral-500">Budget Name</th>
                    <th className="px-2.5 py-2 text-left font-semibold text-neutral-500">Fiscal Year</th>
                    <th className="px-2.5 py-2 text-left font-semibold text-neutral-500">Department</th>
                    <th className="px-2.5 py-2 text-right font-semibold text-neutral-500">Amount</th>
                    <th className="px-2.5 py-2 text-right font-semibold text-neutral-500">Consumed</th>
                    <th className="px-2.5 py-2 text-left font-semibold text-neutral-500">Status</th>
                    {canEdit && <th className="px-2.5 py-2 text-center font-semibold text-neutral-500 w-[80px]">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60 transition-colors">
                      <td className="px-2.5 py-1.5 font-medium text-neutral-900">{p.name}</td>
                      <td className="px-2.5 py-1.5 text-neutral-600">{p.fiscalYear}</td>
                      <td className="px-2.5 py-1.5 text-neutral-600">{p.department}</td>
                      <td className="px-2.5 py-1.5 text-right font-mono text-neutral-900 tabular-nums">{fmt(p.amount)}</td>
                      <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                        <span className={p.consumed > p.amount ? "text-red-600" : "text-neutral-600"}>{fmt(p.consumed)}</span>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <StatusBadge status={p.status} />
                      </td>
                      {canEdit && (
                        <td className="px-2.5 py-1.5">
                          <div className="flex items-center justify-center gap-1">
                            <button type="button" onClick={() => openEdit(p)} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 cursor-pointer bg-transparent border-none" title="Edit">
                              <Edit2 className="h-3 w-3" />
                            </button>
                            <button type="button" onClick={() => setDeleteConfirm(p.id)} className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600 cursor-pointer bg-transparent border-none" title="Delete">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Slide-over panel */}
      {panelMode && (
        <div className="w-[340px] flex-shrink-0 rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
            <h3 className="text-xs font-bold text-neutral-900">{panelMode === "create" ? "New Budget Plan" : "Edit Budget Plan"}</h3>
            <button type="button" onClick={() => setPanelMode(null)} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 cursor-pointer bg-transparent border-none">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-3 p-4">
            <Field label="Budget Name *">
              <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. IT Equipment Budget" className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200" />
            </Field>
            <Field label="Fiscal Year *">
              <select value={form.fiscalYear} onChange={(e) => setForm((f) => ({ ...f, fiscalYear: e.target.value }))} className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs focus:border-primary-400 focus:outline-none">
                {FISCAL_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
            <Field label="Department *">
              <select value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs focus:border-primary-400 focus:outline-none">
                <option value="">Select Department</option>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Budget Amount (USD) *">
              <input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="500000" className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs font-mono focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200" />
            </Field>
            <Field label="Currency">
              <select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs focus:border-primary-400 focus:outline-none">
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="INR">INR</option>
              </select>
            </Field>
            {panelMode === "edit" && (
              <Field label="Status">
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as BudgetPlan["status"] }))} className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs focus:border-primary-400 focus:outline-none">
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            )}
          </div>
          <div className="border-t border-neutral-100 px-4 py-3 flex items-center gap-2">
            <button type="button" onClick={handleSave} className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-primary-700 cursor-pointer border-none">
              <Check className="h-3 w-3" /> {panelMode === "create" ? "Create" : "Save"}
            </button>
            <button type="button" onClick={() => setPanelMode(null)} className="flex-1 rounded-md bg-white px-3 py-1.5 text-[11px] font-semibold text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50 cursor-pointer border-none">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-[340px] rounded-xl bg-white p-5 shadow-xl">
            <h3 className="mb-2 text-sm font-bold text-neutral-900">Delete Budget Plan</h3>
            <p className="mb-4 text-xs text-neutral-600">Are you sure you want to delete this budget plan? This action cannot be undone.</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => handleDelete(deleteConfirm)} className="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-700 cursor-pointer border-none">Delete</button>
              <button type="button" onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-md bg-white px-3 py-1.5 text-[11px] font-semibold text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50 cursor-pointer border-none">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: BudgetPlan["status"] }) {
  const cfg = {
    Active: "bg-emerald-50 text-emerald-700",
    Draft: "bg-neutral-100 text-neutral-600",
    Closed: "bg-blue-50 text-blue-700",
    Exceeded: "bg-red-50 text-red-700",
  }[status];
  return <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${cfg}`}>{status}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] font-semibold text-neutral-500">{label}</label>
      {children}
    </div>
  );
}
