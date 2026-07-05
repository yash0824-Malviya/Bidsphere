import { useLayoutEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  approveBudget,
  canApproveBudget,
  canCancelBudget,
  cancelBudget,
  fetchBudgetByName,
  fetchBudgetComments,
  getBudgetTimeline,
  getBudgetUtilization,
  getBudgetAmount,
  getBudgetAccountName,
  isFinanceExecutive,
  mapBudgetStatus,
  rejectBudget,
  submitBudget,
  getBudgetFiscalYear,
} from "../../api/budget";
import { getBudgetDetailData } from "../../api/budgetDashboard";
import {
  triggerBudgetApproved,
  triggerBudgetRejected,
  triggerBudgetSubmitted,
} from "../../api/notifications";
import PageHeader from "../../components/PageHeader";
import BudgetDetailCharts from "../../components/budget/BudgetDetailCharts";
import { ConfirmDialog } from "../../components/ui";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { useAuthStore } from "../../store/authStore";
import {
  formatCurrency,
  formatCurrencyIn,
  formatDate,
  formatDateTime,
} from "../../utils/format";

export default function BudgetDetailPage() {
  const { budgetId } = useParams<{ budgetId: string }>();
  const decodedId = budgetId ? decodeURIComponent(budgetId) : "";
  const layout = useOptionalLayout();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const canApprove = canApproveBudget(role);
  const canCancel = canCancelBudget(role);
  const isExecutive = isFinanceExecutive(role);

  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [acting, setActing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    "approve" | "reject" | "cancel" | "revision" | null
  >(null);

  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { data: budget, isLoading } = useQuery({
    queryKey: ["budget-detail", decodedId],
    queryFn: () => fetchBudgetByName(decodedId),
    enabled: !!decodedId,
  });

  const { data: utilization } = useQuery({
    queryKey: ["budget-utilization", decodedId],
    queryFn: () => getBudgetUtilization(decodedId),
    enabled: !!decodedId && !!budget && mapBudgetStatus(budget) !== "Draft",
  });

  const { data: comments = [] } = useQuery({
    queryKey: ["budget-comments", decodedId],
    queryFn: () => fetchBudgetComments(decodedId),
    enabled: !!decodedId,
  });

  const { data: timeline = [] } = useQuery({
    queryKey: ["budget-timeline", decodedId],
    queryFn: () => getBudgetTimeline(decodedId),
    enabled: !!decodedId,
  });

  const { data: detailData } = useQuery({
    queryKey: ["budget-detail-data", decodedId],
    queryFn: () => getBudgetDetailData(decodedId),
    enabled: !!decodedId,
    staleTime: 30_000,
    retry: false,
  });

  const status = budget ? mapBudgetStatus(budget) : "Draft";
  const budgetAmount = budget ? getBudgetAmount(budget) : 0;
  const expenseAccount = budget ? (getBudgetAccountName(budget) ?? "—") : "—";

  const isOwner =
    budget?.owner === user?.email || budget?.owner === user?.name;

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ["budget-detail", decodedId] });
    await queryClient.invalidateQueries({ queryKey: ["budget-kpis"] });
    await queryClient.invalidateQueries({ queryKey: ["finance-manager-budget-dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["my-budgets"] });
    await queryClient.invalidateQueries({ queryKey: ["budget-approvals-pending"] });
    await queryClient.invalidateQueries({ queryKey: ["budget-plans"] });
    await queryClient.invalidateQueries({ queryKey: ["budget-history-all"] });
  }

  async function handleSubmit() {
    if (!decodedId) return;
    setActing(true);
    try {
      await submitBudget(decodedId);
      triggerBudgetSubmitted(decodedId, budgetAmount, user?.email ?? user?.full_name);
      toast.success("Budget submitted for approval");
      await invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setActing(false);
    }
  }

  async function runConfirmedAction() {
    if (!decodedId || !confirmAction) return;
    setActing(true);
    try {
      if (confirmAction === "approve") {
        await approveBudget(decodedId);
        triggerBudgetApproved(decodedId, budgetAmount, user?.email ?? user?.full_name);
        toast.success("Budget approved and activated");
      } else if (confirmAction === "reject" || confirmAction === "revision") {
        if (!rejectNote.trim()) {
          toast.error("Reason is required");
          setActing(false);
          return;
        }
        await rejectBudget(
          decodedId,
          confirmAction === "revision"
            ? `Revision requested: ${rejectNote.trim()}`
            : rejectNote.trim()
        );
        triggerBudgetRejected(decodedId, user?.email ?? user?.full_name, rejectNote.trim());
        toast.success(
          confirmAction === "revision" ? "Budget returned for revision" : "Budget rejected"
        );
        setShowReject(false);
      } else if (confirmAction === "cancel") {
        await cancelBudget(decodedId);
        toast.success("Budget cancelled in ERPNext");
      }
      setConfirmAction(null);
      setRejectNote("");
      await invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActing(false);
    }
  }

  if (isLoading || !budget) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  const finSummary =
    detailData?.financial ??
    (utilization
      ? {
          allocated: utilization.budgetAmount,
          reserved: utilization.reservedBudget,
          consumed: utilization.actualExpense,
          available: utilization.remainingBudget,
          utilizationPct: utilization.utilizationPct,
        }
      : null);
  const ledger = detailData?.ledger;
  const currency = detailData?.general.currency ?? "USD";
  const finPct = finSummary?.utilizationPct ?? 0;
  const finHealth =
    finPct >= 100 ? "Exceeded" : finPct > 80 ? "Near Limit" : "Available";

  return (
    <div>
      <PageHeader title={budget.name} description={`ERPNext Budget · ${status}`} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-bold text-neutral-900">Budget Information</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Budget ID" value={budget.name} />
              <Detail label="Company" value={budget.company} />
              <Detail
                label="Department"
                value={detailData?.general.department ?? "—"}
                muted={!detailData?.general.department}
                mutedText="Department not configured"
              />
              <Detail
                label="Cost Center"
                value={budget.cost_center ?? ""}
                muted={!budget.cost_center}
                mutedText="Cost Center not configured"
              />
              <Detail
                label="Fiscal Year"
                value={getBudgetFiscalYear(budget)}
                muted={!getBudgetFiscalYear(budget)}
                mutedText="Fiscal Year not configured"
              />
              <Detail label="Currency" value={detailData?.general.currency ?? "—"} />
              <Detail label="Budget Against" value={budget.budget_against ?? "Cost Center"} />
              <Detail label="Project" value={budget.project ?? "—"} />
              <Detail label="Expense Account" value={expenseAccount} />
              <Detail label="Budget Amount" value={formatCurrency(budgetAmount)} />
              <Detail label="Monthly Distribution" value={budget.monthly_distribution || "Annual"} />
              <Detail label="Workflow Status" value={status} />
              <Detail label="Created Date" value={formatDateTime(budget.creation)} />
            </dl>
          </section>

          {comments.length > 0 && (
            <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-bold text-neutral-900">Remarks & Comments</h2>
              <ul className="space-y-2">
                {comments.map((c, i) => (
                  <li key={i} className="rounded-lg bg-neutral-50 px-3 py-2 text-sm">
                    <p className="text-neutral-800">{c.comment}</p>
                    <p className="mt-1 text-[10px] text-neutral-500">
                      {c.by} · {formatDateTime(c.creation)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {timeline.length > 0 && (
            <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-bold text-neutral-900">Workflow Timeline</h2>
              <ol className="space-y-3">
                {timeline.map((ev, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-500" />
                    <div>
                      <p className="font-semibold text-neutral-900">{ev.event}</p>
                      <p className="text-xs text-neutral-500">
                        {ev.user} · {formatDateTime(ev.date)}
                      </p>
                      {ev.comment && (
                        <p className="mt-1 text-xs text-neutral-600">{ev.comment}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold text-neutral-900">Financial Summary</h2>
              {finSummary && (
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    finHealth === "Exceeded"
                      ? "bg-red-100 text-red-700"
                      : finHealth === "Near Limit"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {finHealth}
                </span>
              )}
            </div>
            {finSummary ? (
              <>
                <dl className="space-y-2 text-sm">
                  <Detail label="Allocated Budget" value={formatCurrency(finSummary.allocated)} />
                  <Detail
                    label="Reserved (Open POs)"
                    value={formatCurrency(("reserved" in finSummary ? finSummary.reserved : 0) ?? 0)}
                  />
                  <Detail label="Consumed Budget" value={formatCurrency(finSummary.consumed)} />
                  <Detail label="Available Budget" value={formatCurrency(finSummary.available)} />
                  <Detail label="Budget Utilization" value={`${finPct}%`} />
                </dl>
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-semibold text-neutral-600">Utilization</span>
                    <span className="font-bold">{finPct}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className={`h-full rounded-full ${
                        finPct >= 100 ? "bg-red-500" : finPct > 80 ? "bg-amber-500" : "bg-emerald-500"
                      }`}
                      style={{ width: `${Math.min(finPct, 100)}%` }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-neutral-500">
                Utilization available after budget is submitted and active.
              </p>
            )}
          </section>

          <div className="space-y-2">
            {isExecutive && isOwner && status === "Draft" && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={acting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Submit for Approval
              </button>
            )}

            {canApprove && status === "Submitted" && (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmAction("approve")}
                  disabled={acting}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-success-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-success-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </button>
                {!showReject ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowReject(true)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-danger-200 bg-white px-4 py-2.5 text-sm font-semibold text-danger-700 hover:bg-danger-50"
                    >
                      <XCircle className="h-4 w-4" /> Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowReject(true);
                        setConfirmAction("revision");
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-200 bg-white px-4 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-50"
                    >
                      <RotateCcw className="h-4 w-4" /> Return for Revision
                    </button>
                  </>
                ) : (
                  <div className="rounded-lg border border-danger-200 bg-danger-50 p-3">
                    <textarea
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="Reason for rejection or revision request…"
                      className="mb-2 w-full rounded border border-danger-200 px-2 py-1.5 text-sm"
                      rows={3}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmAction(confirmAction === "revision" ? "revision" : "reject")
                      }
                      disabled={acting || !rejectNote.trim()}
                      className="w-full rounded bg-danger-600 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Confirm
                    </button>
                  </div>
                )}
              </>
            )}

            {canCancel && (status === "Active" || status === "Approved") && (
              <button
                type="button"
                onClick={() => setConfirmAction("cancel")}
                disabled={acting}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                <Ban className="h-4 w-4" /> Cancel Budget
              </button>
            )}

            <button
              type="button"
              onClick={() => navigate(-1)}
              className="w-full rounded-lg border border-neutral-200 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              Back
            </button>
          </div>
        </div>
      </div>

      {detailData && (
        <div className="mt-4">
          <h2 className="mb-3 text-sm font-bold text-neutral-900">Spend Analytics</h2>
          <BudgetDetailCharts data={detailData} currency={detailData.general.currency} />
        </div>
      )}

      {ledger && (
        <div className="mt-4 space-y-4">
          {/* Spend breakdowns */}
          <div className="grid gap-4 lg:grid-cols-3">
            <SpendPanel title="Spend by Supplier" data={ledger.spendBySupplier} currency={currency} />
            <SpendPanel title="Spend by Department" data={ledger.spendByDepartment} currency={currency} />
            <SpendPanel title="Spend by Cost Center" data={ledger.spendByCostCenter} currency={currency} />
          </div>

          {/* Budget Transaction History */}
          <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-5 py-3">
              <h2 className="text-sm font-bold text-neutral-900">Budget Transaction History</h2>
              <p className="text-xs text-neutral-500">
                Every Purchase Invoice and Payment Entry consuming this budget, with running balance
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Type</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Supplier</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Purchase Order</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Purchase Invoice</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Payment Entry</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Running Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {ledger.transactions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-xs text-neutral-400">
                        No invoice or payment activity recorded against this budget yet.
                      </td>
                    </tr>
                  ) : (
                    ledger.transactions.map((t) => (
                      <tr key={t.id} className="hover:bg-neutral-50">
                        <td className="whitespace-nowrap px-4 py-2.5 text-neutral-600">
                          {t.date ? formatDate(t.date) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <TxnTypeBadge type={t.type} />
                        </td>
                        <td className="px-4 py-2.5 text-neutral-700">{t.supplier || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-neutral-600">
                          {t.purchaseOrder ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-neutral-600">
                          {t.purchaseInvoice ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-neutral-600">
                          {t.paymentEntry ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums font-medium text-neutral-900">
                          {formatCurrency(t.amount)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">
                          {formatCurrency(t.runningBalance)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Purchase Orders */}
          <LedgerTable
            title="Purchase Orders"
            subtitle="Submitted purchase orders committing this budget"
            columns={["Purchase Order", "Supplier", "Date", "Amount", "Billed %", "Status"]}
            rows={ledger.purchaseOrders.map((po) => [
              <span className="font-mono text-xs">{po.name}</span>,
              po.supplier,
              po.date ? formatDate(po.date) : "—",
              <span className="tabular-nums">{formatCurrency(po.amount)}</span>,
              <span className="tabular-nums">{Math.round(po.billedPct)}%</span>,
              po.status ?? "—",
            ])}
            emptyText="No purchase orders committing this budget."
          />

          {/* Purchase Invoices */}
          <LedgerTable
            title="Purchase Invoices"
            subtitle="Submitted invoices consuming this budget"
            columns={["Purchase Invoice", "Supplier", "Date", "Amount", "Outstanding", "Status"]}
            rows={ledger.purchaseInvoices.map((pi) => [
              <span className="font-mono text-xs">{pi.name}</span>,
              pi.supplier,
              pi.date ? formatDate(pi.date) : "—",
              <span className="tabular-nums">{formatCurrency(pi.amount)}</span>,
              <span className="tabular-nums">{formatCurrency(pi.outstanding)}</span>,
              pi.status ?? "—",
            ])}
            emptyText="No purchase invoices consuming this budget yet."
          />

          {/* Payment History */}
          <LedgerTable
            title="Payment History"
            subtitle="Payment entries settling invoices against this budget"
            columns={["Payment Entry", "Supplier", "Date", "Amount", "Reference", "Invoice"]}
            rows={ledger.payments.map((p) => [
              <span className="font-mono text-xs">{p.name}</span>,
              p.supplier,
              p.date ? formatDate(p.date) : "—",
              <span className="tabular-nums">{formatCurrency(p.amount)}</span>,
              p.reference ?? "—",
              <span className="font-mono text-xs">{p.purchaseInvoice ?? "—"}</span>,
            ])}
            emptyText="No payments recorded against this budget yet."
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmAction === "approve" || confirmAction === "cancel"}
        onClose={() => !acting && setConfirmAction(null)}
        onConfirm={runConfirmedAction}
        isLoading={acting}
        tone={confirmAction === "cancel" ? "danger" : "primary"}
        title={
          confirmAction === "approve"
            ? "Approve and activate this budget?"
            : "Cancel this budget?"
        }
        description={
          confirmAction === "approve"
            ? "The budget will become Active and available for procurement RFQ validation."
            : "Cancelled budgets are removed from active validation."
        }
        confirmLabel={confirmAction === "approve" ? "Approve & Activate" : "Cancel Budget"}
      />

      <ConfirmDialog
        open={confirmAction === "reject" || confirmAction === "revision"}
        onClose={() => {
          if (!acting) {
            setConfirmAction(null);
            setShowReject(false);
          }
        }}
        onConfirm={runConfirmedAction}
        isLoading={acting}
        tone="danger"
        title={
          confirmAction === "revision"
            ? "Return budget for revision?"
            : "Reject this budget?"
        }
        description={rejectNote.trim() || "Please provide a reason above before confirming."}
        confirmLabel={confirmAction === "revision" ? "Return for Revision" : "Reject Budget"}
      />
    </div>
  );
}

function TxnTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    "Purchase Invoice": "bg-blue-100 text-blue-700",
    "Payment Entry": "bg-emerald-100 text-emerald-700",
    "Purchase Order": "bg-indigo-100 text-indigo-700",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
        styles[type] ?? "bg-neutral-100 text-neutral-700"
      }`}
    >
      {type}
    </span>
  );
}

function SpendPanel({
  title,
  data,
  currency,
}: {
  title: string;
  data: Array<{ label: string; amount: number }>;
  currency: string;
}) {
  const total = data.reduce((s, d) => s + d.amount, 0);
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-neutral-900">{title}</h3>
      {data.length === 0 ? (
        <p className="text-xs text-neutral-400">No spend recorded.</p>
      ) : (
        <ul className="space-y-2.5">
          {data.map((d) => {
            const pct = total > 0 ? Math.round((d.amount / total) * 100) : 0;
            return (
              <li key={d.label}>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-neutral-700">{d.label}</span>
                  <span className="shrink-0 tabular-nums text-neutral-500">
                    {formatCurrencyIn(d.amount, currency)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full bg-primary-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function LedgerTable({
  title,
  subtitle,
  columns,
  rows,
  emptyText,
}: {
  title: string;
  subtitle: string;
  columns: string[];
  rows: ReactNode[][];
  emptyText: string;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-100 px-5 py-3">
        <h2 className="text-sm font-bold text-neutral-900">{title}</h2>
        <p className="text-xs text-neutral-500">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
            <tr>
              {columns.map((c, i) => (
                <th
                  key={c}
                  className={`px-4 py-2.5 font-semibold ${
                    i >= 3 && i <= 4 ? "text-right" : "text-left"
                  }`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-xs text-neutral-400"
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((cells, ri) => (
                <tr key={ri} className="hover:bg-neutral-50">
                  {cells.map((cell, ci) => (
                    <td
                      key={ci}
                      className={`px-4 py-2.5 text-neutral-700 ${
                        ci >= 3 && ci <= 4 ? "text-right" : "text-left"
                      }`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Detail({
  label,
  value,
  muted,
  mutedText,
}: {
  label: string;
  value: string;
  muted?: boolean;
  mutedText?: string;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase text-neutral-400">{label}</dt>
      <dd
        className={
          muted ? "text-sm font-medium italic text-amber-600" : "font-medium text-neutral-900"
        }
      >
        {muted ? (mutedText ?? "Not configured") : value || "—"}
      </dd>
    </div>
  );
}
