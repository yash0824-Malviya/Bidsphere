import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Wallet,
  X,
  XCircle,
} from "lucide-react";

import { apiGet, buildListConfig, buildResourceUrl } from "../../api/erpnext";
import {
  getRfqBudgetSummary,
  type RfqBudgetSummary,
} from "../../api/erpBudget";
import { resolveApiErrorMessage } from "../../utils/rfqDetailApiErrors";

export interface CheckBudgetRfqItem {
  item_code?: string;
  qty?: number;
  rate?: number;
  amount?: number;
  stock_qty?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Fired by "Continue to Submit RFQ". */
  onContinue: () => void;
  rfqName: string;
  company?: string | null;
  costCenter?: string | null;
  fiscalYear?: string | null;
  items: CheckBudgetRfqItem[];
}

const usd = (n: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);

/**
 * Estimate the RFQ's monetary value. Draft RFQs carry no supplier prices, so we
 * use any rate/amount already on the line, then fall back to live ERPNext Item
 * rates (last purchase → valuation → standard) — never a hardcoded value.
 */
async function estimateRfqAmount(items: CheckBudgetRfqItem[]): Promise<number> {
  let total = 0;
  const missing: Array<{ code: string; qty: number }> = [];

  for (const it of items) {
    const qty = Number(it.qty ?? it.stock_qty) || 0;
    const direct = Number(it.amount) || (Number(it.rate) || 0) * qty;
    if (direct > 0) {
      total += direct;
    } else if (qty > 0 && it.item_code) {
      missing.push({ code: it.item_code, qty });
    }
  }

  if (missing.length > 0) {
    const codes = [...new Set(missing.map((m) => m.code))];
    try {
      const rows = await apiGet<
        Array<{
          name: string;
          valuation_rate?: number;
          last_purchase_rate?: number;
          standard_rate?: number;
        }>
      >(
        buildResourceUrl("Item"),
        buildListConfig({
          fields: ["name", "valuation_rate", "last_purchase_rate", "standard_rate"],
          filters: [["name", "in", codes]],
          limit_page_length: codes.length,
        }),
      );
      const rateByCode = new Map(
        (rows ?? []).map((r) => [
          r.name,
          Number(r.last_purchase_rate) ||
            Number(r.valuation_rate) ||
            Number(r.standard_rate) ||
            0,
        ]),
      );
      for (const m of missing) {
        total += (rateByCode.get(m.code) ?? 0) * m.qty;
      }
    } catch {
      /* rate lookup is best-effort; missing rates contribute 0 */
    }
  }

  return total;
}

interface BudgetCheckResult {
  rfqAmount: number;
  budget: RfqBudgetSummary;
}

export default function CheckBudgetModal({
  open,
  onClose,
  onContinue,
  rfqName,
  company,
  costCenter,
  fiscalYear,
  items,
}: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const query = useQuery<BudgetCheckResult>({
    queryKey: ["rfq-budget-check", rfqName],
    enabled: open,
    staleTime: 0,
    queryFn: async () => {
      const [rfqAmount, budget] = await Promise.all([
        estimateRfqAmount(items),
        getRfqBudgetSummary({ company, costCenter, fiscalYear }),
      ]);
      return { rfqAmount, budget };
    },
  });

  if (!open) return null;

  const data = query.data;
  const rfqAmount = data?.rfqAmount ?? 0;
  const allocated = data?.budget.allocated ?? 0;
  const consumed = data?.budget.consumed ?? 0;
  const available = data?.budget.available ?? 0;
  const utilization = data?.budget.utilizationPct ?? 0;
  const remainingAfter = available - rfqAmount;
  // No approved/active budget in scope — informational only, never an error and
  // never flagged as "exceeded".
  const noActiveBudget = !!data && data.budget.budgetAvailable === false;
  const exceeded = !noActiveBudget && rfqAmount > available;

  const scopeCaption = (() => {
    if (!data) return "";
    const n = data.budget.matchedBudgetNames.length;
    const scope = data.budget.scope;
    const base = `Based on ${n} active budget${n === 1 ? "" : "s"}`;
    if (scope === "cost-center" && costCenter) return `${base} · ${costCenter}`;
    if (scope === "company" && company) return `${base} · ${company}`;
    return `${base} across all cost centers`;
  })();

  return (
    <div role="dialog" aria-modal="true" className="modal-overlay">
      <div
        className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="modal-panel relative w-full max-w-lg p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
              <Wallet className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-neutral-900">
                Budget Summary
              </h2>
              <p className="text-xs text-neutral-500">{rfqName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {query.isLoading ? (
            <div className="flex items-center justify-center gap-3 py-14 text-neutral-500">
              <Loader2 className="h-5 w-5 animate-spin text-primary-500" />
              <span className="text-sm font-medium">
                Fetching latest budget information…
              </span>
            </div>
          ) : query.isError ? (
            <div className="flex items-start gap-3 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
              <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <p className="font-semibold">Unable to load budget</p>
                <p className="mt-0.5 text-danger-600">
                  {query.error
                    ? resolveApiErrorMessage(
                        query.error,
                        "Please try again.",
                      )
                    : "Please try again."}
                </p>
              </div>
            </div>
          ) : noActiveBudget ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div>
                  <p className="font-semibold">No active budget found</p>
                  <p className="mt-0.5 text-amber-700">
                    {data?.budget.message ??
                      "There is no approved or active budget in scope for this RFQ."}{" "}
                    This check is informational only and does not block
                    submission.
                  </p>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-neutral-200">
                <SummaryRow
                  label="Current RFQ Amount"
                  value={usd(rfqAmount)}
                  valueClass="text-primary-700 font-semibold"
                  highlight
                />
              </div>
            </div>
          ) : (
            <>
              {/* Status badge */}
              <div className="mb-4 flex items-center justify-between gap-3">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
                    exceeded
                      ? "bg-danger-100 text-danger-700"
                      : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {exceeded ? (
                    <XCircle className="h-4 w-4" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {exceeded ? "Budget Exceeded" : "Budget Available"}
                </span>
                {scopeCaption ? (
                  <span className="text-xs text-neutral-400">{scopeCaption}</span>
                ) : null}
              </div>

              {/* Summary rows */}
              <div className="overflow-hidden rounded-xl border border-neutral-200">
                <SummaryRow label="Allocated Budget" value={usd(allocated)} />
                <SummaryRow
                  label="Consumed Budget"
                  value={usd(consumed)}
                  valueClass="text-neutral-700"
                />
                <SummaryRow
                  label="Available Budget"
                  value={usd(available)}
                  valueClass="text-emerald-700 font-semibold"
                />
                <SummaryRow
                  label="Current RFQ Amount"
                  value={usd(rfqAmount)}
                  valueClass="text-primary-700 font-semibold"
                  highlight
                />
                <SummaryRow
                  label="Remaining Budget After RFQ"
                  value={usd(remainingAfter)}
                  valueClass={
                    remainingAfter < 0
                      ? "text-danger-600 font-semibold"
                      : "text-neutral-900 font-semibold"
                  }
                />
              </div>

              {/* Utilization bar */}
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-xs font-medium text-neutral-500">
                  <span>Budget Utilization</span>
                  <span className="tabular-nums">{utilization}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className={`h-full rounded-full transition-all ${
                      utilization >= 90
                        ? "bg-danger-500"
                        : utilization >= 70
                          ? "bg-orange-400"
                          : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.min(100, utilization)}%` }}
                  />
                </div>
              </div>

              {/* Exceeded warning */}
              {exceeded ? (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span className="font-medium">
                    Warning: This RFQ exceeds the available budget.
                  </span>
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 border-t border-neutral-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 sm:w-auto"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onContinue}
            disabled={query.isLoading || query.isError}
            className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${
              exceeded
                ? "bg-orange-500 hover:bg-orange-600"
                : "bg-accent-600 hover:bg-accent-700"
            }`}
          >
            Continue to Submit RFQ
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  valueClass = "text-neutral-900",
  highlight = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between border-b border-neutral-100 px-4 py-2.5 last:border-b-0 ${
        highlight ? "bg-primary-50/40" : ""
      }`}
    >
      <span className="text-sm text-neutral-600">{label}</span>
      <span className={`text-sm tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
