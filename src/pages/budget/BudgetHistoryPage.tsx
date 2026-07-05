import { useLayoutEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  CreditCard,
  FileText,
  Loader2,
  ReceiptText,
  ShoppingCart,
} from "lucide-react";

import { fetchBudgets } from "../../api/budget";
import {
  getBudgetTransactionFeed,
  type BudgetHistoryCategory,
  type BudgetHistoryEntry,
} from "../../api/budgetDashboard";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { formatCurrencyIn, formatDateTime } from "../../utils/format";

const CATEGORY_FILTERS: Array<{ key: "all" | BudgetHistoryCategory; label: string }> = [
  { key: "all", label: "All" },
  { key: "Workflow", label: "Workflow" },
  { key: "Purchase Order", label: "Purchase Orders" },
  { key: "Purchase Invoice", label: "Purchase Invoices" },
  { key: "Payment Entry", label: "Payments" },
];

export default function BudgetHistoryPage() {
  const layout = useOptionalLayout();

  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { data: budgets = [], isLoading } = useQuery({
    queryKey: ["budget-history-all"],
    queryFn: () => fetchBudgets(),
  });

  const [selectedBudget, setSelectedBudget] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | BudgetHistoryCategory>(
    "all",
  );

  // Show every non-draft budget (approved/active/rejected/cancelled/submitted)
  // so the manager can audit the full lifecycle. Drafts have no history yet.
  const historyBudgets = useMemo(
    () => budgets.filter((b) => b.status !== "Draft"),
    [budgets],
  );

  const activeBudget = selectedBudget || historyBudgets[0]?.name || "";

  const { data: feed, isLoading: feedLoading } = useQuery({
    queryKey: ["budget-transaction-feed", activeBudget],
    queryFn: () => getBudgetTransactionFeed(activeBudget),
    enabled: !!activeBudget,
  });

  const entries = useMemo(() => {
    const all = feed?.entries ?? [];
    if (categoryFilter === "all") return all;
    return all.filter((e) => e.category === categoryFilter);
  }, [feed, categoryFilter]);

  const currency = feed?.currency ?? "USD";

  return (
    <div>
      <PageHeader
        title="Budget History"
        description="Complete audit trail — workflow milestones, purchase orders, invoices, payments, and budget consumption."
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        </div>
      ) : historyBudgets.length === 0 ? (
        <EmptyState
          title="No budget history"
          description="Submitted, approved, active, rejected, and cancelled budgets will appear here."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Budget selector */}
          <div className="rounded-xl border border-neutral-200 bg-white shadow-sm lg:col-span-1">
            <div className="border-b border-neutral-100 px-4 py-3">
              <h3 className="text-sm font-bold text-neutral-900">Budgets</h3>
            </div>
            <div className="max-h-[560px] divide-y divide-neutral-100 overflow-y-auto">
              {historyBudgets.map((b) => (
                <button
                  key={b.name}
                  type="button"
                  onClick={() => setSelectedBudget(b.name)}
                  className={`w-full px-4 py-3 text-left transition hover:bg-neutral-50 ${
                    activeBudget === b.name ? "bg-primary-50/60" : ""
                  }`}
                >
                  <p className="text-xs font-bold text-neutral-900">{b.name}</p>
                  <p className="text-[10px] text-neutral-500">
                    {b.status} · {b.cost_center ?? b.project ?? "—"}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Transaction feed */}
          <div className="rounded-xl border border-neutral-200 bg-white shadow-sm lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
              <h3 className="text-sm font-bold text-neutral-900">Transaction History</h3>
              {activeBudget && (
                <Link
                  to={`/budget/detail/${encodeURIComponent(activeBudget)}`}
                  className="text-xs font-semibold text-primary-600 no-underline hover:underline"
                >
                  View budget →
                </Link>
              )}
            </div>

            {/* Category filter chips */}
            <div className="flex flex-wrap gap-1.5 border-b border-neutral-100 px-4 py-2.5">
              {CATEGORY_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setCategoryFilter(f.key)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                    categoryFilter === f.key
                      ? "bg-primary-600 text-white"
                      : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {feedLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
              </div>
            ) : entries.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-neutral-500">
                No transactions recorded for this budget
              </p>
            ) : (
              <ol className="space-y-0 px-4 py-4">
                {entries.map((entry, idx) => (
                  <FeedItem
                    key={entry.id}
                    entry={entry}
                    currency={currency}
                    isLast={idx === entries.length - 1}
                  />
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function categoryVisual(category: BudgetHistoryCategory) {
  switch (category) {
    case "Purchase Order":
      return { Icon: ShoppingCart, cls: "bg-indigo-50 text-indigo-600" };
    case "Purchase Invoice":
      return { Icon: ReceiptText, cls: "bg-rose-50 text-rose-600" };
    case "Payment Entry":
      return { Icon: CreditCard, cls: "bg-emerald-50 text-emerald-600" };
    default:
      return { Icon: CheckCircle2, cls: "bg-neutral-100 text-neutral-500" };
  }
}

function referencePath(entry: BudgetHistoryEntry): string | null {
  if (!entry.reference) return null;
  switch (entry.referenceType) {
    case "Purchase Order":
      return `/p2p/purchase-orders/${encodeURIComponent(entry.reference)}`;
    case "Purchase Invoice":
      return `/p2p/invoices/${encodeURIComponent(entry.reference)}`;
    default:
      return null;
  }
}

function FeedItem({
  entry,
  currency,
  isLast,
}: {
  entry: BudgetHistoryEntry;
  currency: string;
  isLast: boolean;
}) {
  const { Icon, cls } = categoryVisual(entry.category);
  const refPath = referencePath(entry);

  return (
    <li className="relative flex gap-3 pb-6">
      {!isLast && (
        <span className="absolute left-[15px] top-8 h-full w-px bg-neutral-200" aria-hidden />
      )}
      <div
        className={`relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${cls}`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <p className="text-sm font-semibold text-neutral-900">{entry.title}</p>
          {typeof entry.amount === "number" && (
            <span className="text-sm font-bold tabular-nums text-neutral-900">
              {formatCurrencyIn(entry.amount, currency)}
            </span>
          )}
        </div>
        <p className="text-xs text-neutral-500">
          {entry.actor}
          {entry.date ? ` · ${formatDateTime(entry.date)}` : ""}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {entry.reference &&
            (refPath ? (
              <Link
                to={refPath}
                className="inline-flex items-center gap-1 rounded-md bg-neutral-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700 no-underline hover:underline"
              >
                <FileText className="h-3 w-3" /> {entry.reference}
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                <FileText className="h-3 w-3" /> {entry.reference}
              </span>
            ))}
          {typeof entry.runningBalance === "number" && (
            <span className="text-[11px] text-neutral-400">
              Available after: {formatCurrencyIn(entry.runningBalance, currency)}
            </span>
          )}
        </div>
        {entry.comment && (
          <p className="mt-1 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
            {entry.comment}
          </p>
        )}
      </div>
    </li>
  );
}
