import { memo } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  FileClock,
  FileSearch,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import type { FinanceWorkflowKpis } from "../../api/financeWorkflow";
import { formatCurrencyCompact } from "../../utils/format";

interface KpiDef {
  label: string;
  value: string;
  hint: string;
  actionText: string;
  icon: LucideIcon;
  to: string;
  accent: string;
  highlight?: boolean;
  extraBadge?: string;
}

interface Props {
  kpis: FinanceWorkflowKpis | null;
  overdueAmount?: number;
  loading?: boolean;
}

function FinanceKpiRow({ kpis, overdueAmount = 0, loading }: Props) {
  if (loading || !kpis) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex h-[148px] flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs"
            aria-hidden
          >
            <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
            <div className="h-8 w-20 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-32 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
    );
  }

  const cards: KpiDef[] = [
    {
      label: "Pending RFQ Reviews",
      value: kpis.pendingRfqReviews.toLocaleString(),
      hint: "Awaiting finance review",
      actionText: "Review RFQs",
      icon: FileSearch,
      to: "/budget/pending-reviews",
      accent: "text-amber-600 bg-amber-50 ring-amber-200/60",
      highlight: kpis.pendingRfqReviews > 0,
    },
    {
      label: "Approved RFQs",
      value: kpis.approvedRfqs.toLocaleString(),
      hint: "Budget-cleared RFQs",
      actionText: "View RFQs",
      icon: ShieldCheck,
      to: "/budget/pending-reviews",
      accent: "text-emerald-600 bg-emerald-50 ring-emerald-200/60",
    },
    {
      label: "Pending Payments",
      value: kpis.pendingPayments.toLocaleString(),
      hint: "Invoices awaiting payment",
      actionText: "View payments",
      icon: CreditCard,
      to: "/p2p/payments",
      accent: "text-blue-600 bg-blue-50 ring-blue-200/60",
      highlight: kpis.pendingPayments > 0,
    },
    {
      label: "Outstanding Payables",
      value: formatCurrencyCompact(kpis.outstandingPayables),
      hint: "Unpaid invoices",
      actionText: "View payables",
      icon: Wallet,
      to: "/p2p/payments",
      accent: "text-rose-600 bg-rose-50 ring-rose-200/60",
      extraBadge:
        overdueAmount > 0
          ? `Overdue: ${formatCurrencyCompact(overdueAmount)}`
          : undefined,
    },
    {
      label: "GRNs Awaiting Voucher",
      value: kpis.grnsAwaitingVoucher.toLocaleString(),
      hint: "Receipts awaiting voucher",
      actionText: "Review GRNs",
      icon: FileClock,
      to: "/p2p/vouchers",
      accent: "text-sky-600 bg-sky-50 ring-sky-200/60",
      highlight: kpis.grnsAwaitingVoucher > 0,
    },
    {
      label: "Financial Exposure",
      value: formatCurrencyCompact(kpis.totalFinancialExposure),
      hint: "Open financial commitments",
      actionText: "View exposure",
      icon: CheckCircle2,
      to: "/budget",
      accent: "text-violet-600 bg-violet-50 ring-violet-200/60",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Link
            key={c.label}
            to={c.to}
            className={`group relative flex flex-col justify-between rounded-xl border bg-white p-4 shadow-2xs transition hover:border-slate-300 hover:shadow-xs no-underline ${
              c.highlight
                ? "border-amber-200/80 bg-linear-to-b from-amber-50/20 to-white"
                : "border-slate-200/80"
            }`}
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <span className="text-[12px] font-semibold leading-tight text-slate-600">
                  {c.label}
                </span>
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ${c.accent}`}
                >
                  <Icon className="h-4 w-4" />
                </span>
              </div>

              <div className="mt-2.5 flex items-baseline gap-2">
                <span
                  className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums"
                  title={c.value}
                >
                  {c.value}
                </span>
                {c.extraBadge ? (
                  <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200">
                    {c.extraBadge}
                  </span>
                ) : null}
              </div>

              <p className="mt-1 text-[11px] text-slate-500">{c.hint}</p>
            </div>

            <div className="mt-3 flex items-center gap-1 border-t border-slate-100 pt-2.5 text-[11px] font-semibold text-primary-700 group-hover:text-primary-800">
              <span>{c.actionText}</span>
              <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export default memo(FinanceKpiRow);
