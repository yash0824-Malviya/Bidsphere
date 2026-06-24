import { useLayoutEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  MessageSquare,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";

import { getBudgetApprovals, resolveBudgetApproval } from "../../api/budget";
import type { BudgetApproval } from "../../api/budget";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency, formatDateTime } from "../../utils/format";
import hotToast from "react-hot-toast";

const fmt = (n: number) => formatCurrency(n);

type StatusFilter = "" | "Pending" | "Approved" | "Rejected" | "Revision Requested";

export default function BudgetApprovalsPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const role = useAuthStore((s) => s.user?.role);
  const user = useAuthStore((s) => s.user);
  const canAct = role === "finance" || role === "admin";

  const [approvals, setApprovals] = useState<BudgetApproval[]>(getBudgetApprovals);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [selected, setSelected] = useState<BudgetApproval | null>(null);
  const [actionNotes, setActionNotes] = useState("");

  const reload = () => setApprovals(getBudgetApprovals());

  const filtered = useMemo(() => {
    if (!statusFilter) return approvals;
    return approvals.filter((a) => a.status === statusFilter);
  }, [approvals, statusFilter]);

  const pendingCount = approvals.filter((a) => a.status === "Pending").length;

  function handleAction(action: "Approved" | "Rejected" | "Revision Requested") {
    if (!selected) return;
    resolveBudgetApproval(selected.id, action, user?.full_name ?? user?.email ?? "Finance", actionNotes || undefined);
    reload();
    setSelected(null);
    setActionNotes("");
    const labels = { Approved: "Override approved", Rejected: "Request rejected", "Revision Requested": "Revision requested" };
    hotToast.success(labels[action]);
  }

  return (
    <div className="-mt-1 flex gap-3">
      {/* Main list */}
      <div className="flex-1 min-w-0">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50">
              <ShieldAlert className="h-4 w-4 text-rose-600" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-neutral-900">Budget Approvals</h1>
              <p className="text-[10px] text-neutral-500">Budget override requests &middot; {pendingCount} pending</p>
            </div>
          </div>
          <div className="relative">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="appearance-none rounded-md border border-neutral-200 bg-white py-1.5 pl-2.5 pr-7 text-xs text-neutral-700 focus:border-primary-400 focus:outline-none">
              <option value="">All Requests</option>
              <option value="Pending">Pending</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
              <option value="Revision Requested">Revision Requested</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-neutral-200 bg-white py-14 text-center shadow-sm">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
            <p className="text-sm font-medium text-neutral-700">
              {statusFilter === "Pending" ? "No pending approvals" : "No budget approval requests"}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              Override requests appear here when PO amounts exceed budget.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => { setSelected(a); setActionNotes(""); }}
                className={`w-full rounded-lg border bg-white px-3 py-2.5 text-left shadow-sm transition-all cursor-pointer ${
                  selected?.id === a.id ? "border-primary-300 ring-1 ring-primary-200" : "border-neutral-200 hover:border-neutral-300"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-bold text-neutral-900">{a.poName}</span>
                      <ApprovalBadge status={a.status} />
                    </div>
                    <p className="text-[11px] text-neutral-600">{a.supplier} &middot; {a.department}</p>
                    <p className="text-[10px] text-neutral-500">{a.reason}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-bold text-red-600 tabular-nums">{fmt(a.overageAmount)}</p>
                    <p className="text-[10px] text-neutral-500">over budget</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail / action panel */}
      {selected && (
        <div className="w-[340px] flex-shrink-0 rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
            <h3 className="text-xs font-bold text-neutral-900">Override Request</h3>
            <button type="button" onClick={() => setSelected(null)} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 cursor-pointer bg-transparent border-none">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-3 p-4">
            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
              <Row label="PO Number" value={selected.poName} bold />
              <Row label="PO Amount" value={fmt(selected.poAmount)} />
              <Row label="Supplier" value={selected.supplier} />
              <Row label="Department" value={selected.department} />
              <Row label="Requested By" value={selected.requestedBy} />
              <Row label="Submitted" value={formatDateTime(selected.createdAt)} />
            </div>
            <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
              <Row label="Budget" value={selected.budgetName} bold />
              <Row label="Remaining Budget" value={fmt(selected.budgetRemaining)} />
              <Row label="Overage" value={fmt(selected.overageAmount)} valueColor="text-red-600" />
            </div>
            {selected.reason && (
              <div>
                <p className="mb-1 text-[10px] font-semibold text-neutral-500">REASON</p>
                <p className="text-xs text-neutral-700">{selected.reason}</p>
              </div>
            )}

            {canAct && selected.status === "Pending" && (
              <>
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-neutral-500">Notes (optional)</label>
                  <textarea
                    value={actionNotes}
                    onChange={(e) => setActionNotes(e.target.value)}
                    rows={2}
                    className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200 resize-none"
                    placeholder="Add notes for this decision..."
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <button type="button" onClick={() => handleAction("Approved")} className="inline-flex items-center justify-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-700 cursor-pointer border-none">
                    <Check className="h-3 w-3" /> Approve Override
                  </button>
                  <button type="button" onClick={() => handleAction("Rejected")} className="inline-flex items-center justify-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-red-700 cursor-pointer border-none">
                    <XCircle className="h-3 w-3" /> Reject
                  </button>
                  <button type="button" onClick={() => handleAction("Revision Requested")} className="inline-flex items-center justify-center gap-1 rounded-md bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-300 hover:bg-amber-50 cursor-pointer border-none">
                    <MessageSquare className="h-3 w-3" /> Request Revision
                  </button>
                </div>
              </>
            )}

            {selected.status !== "Pending" && (
              <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                <Row label="Decision" value={selected.status} valueColor={selected.status === "Approved" ? "text-emerald-700" : selected.status === "Rejected" ? "text-red-700" : "text-amber-700"} bold />
                {selected.resolvedBy && <Row label="Resolved By" value={selected.resolvedBy} />}
                {selected.resolvedAt && <Row label="Resolved At" value={formatDateTime(selected.resolvedAt)} />}
                {selected.notes && <Row label="Notes" value={selected.notes} />}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ApprovalBadge({ status }: { status: BudgetApproval["status"] }) {
  const cfg = {
    Pending: { bg: "bg-amber-50 text-amber-700", icon: <Clock className="h-2.5 w-2.5" /> },
    Approved: { bg: "bg-emerald-50 text-emerald-700", icon: <CheckCircle2 className="h-2.5 w-2.5" /> },
    Rejected: { bg: "bg-red-50 text-red-700", icon: <XCircle className="h-2.5 w-2.5" /> },
    "Revision Requested": { bg: "bg-violet-50 text-violet-700", icon: <AlertTriangle className="h-2.5 w-2.5" /> },
  }[status];
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-px text-[9px] font-bold ${cfg.bg}`}>
      {cfg.icon} {status}
    </span>
  );
}

function Row({ label, value, bold, valueColor }: { label: string; value: string; bold?: boolean; valueColor?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5 text-xs">
      <span className="text-neutral-500">{label}</span>
      <span className={`text-right ${bold ? "font-semibold" : ""} ${valueColor ?? "text-neutral-900"}`}>{value}</span>
    </div>
  );
}
