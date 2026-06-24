import { memo } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  CreditCard,
  FileClock,
  FileSearch,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { Skeleton } from "../Skeleton";
import type { FinanceWorkflowKpis } from "../../api/financeWorkflow";
import { formatCurrency } from "../../utils/format";

interface KpiCard {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  to: string;
  accent: string;
  highlight?: boolean;
}

interface Props {
  kpis: FinanceWorkflowKpis | null;
  loading?: boolean;
}

function FinanceKpiRow({ kpis, loading }: Props) {
  if (loading || !kpis) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="min-h-[104px] rounded-xl" />
        ))}
      </div>
    );
  }

  const cards: KpiCard[] = [
    {
      label: "Pending RFQ Reviews",
      value: kpis.pendingRfqReviews.toLocaleString(),
      hint: "Legal-approved RFQs awaiting finance",
      icon: FileSearch,
      to: "/budget/pending-reviews",
      accent: "text-amber-600 bg-amber-50",
      highlight: kpis.pendingRfqReviews > 0,
    },
    {
      label: "Approved RFQs",
      value: kpis.approvedRfqs.toLocaleString(),
      hint: "Budget-cleared RFQs",
      icon: ShieldCheck,
      to: "/budget/pending-reviews",
      accent: "text-success-600 bg-success-50",
    },
    {
      label: "Pending Payments",
      value: kpis.pendingPayments.toLocaleString(),
      hint: "Invoices awaiting payment",
      icon: CreditCard,
      to: "/p2p/payments",
      accent: "text-primary bg-primary-50",
      highlight: kpis.pendingPayments > 0,
    },
    {
      label: "Outstanding Payables",
      value: formatCurrency(kpis.outstandingPayables),
      hint: "Unpaid invoice balance",
      icon: Wallet,
      to: "/p2p/payments",
      accent: "text-accent-600 bg-accent-50",
    },
    {
      label: "GRNs Awaiting Voucher",
      value: kpis.grnsAwaitingVoucher.toLocaleString(),
      hint: "Receipts pending voucher creation",
      icon: FileClock,
      to: "/p2p/vouchers",
      accent: "text-primary-600 bg-primary-50",
      highlight: kpis.grnsAwaitingVoucher > 0,
    },
    {
      label: "Total Financial Exposure",
      value: formatCurrency(kpis.totalFinancialExposure),
      hint: "Pending RFQs + payables + unbilled GRNs",
      icon: CheckCircle2,
      to: "/budget",
      accent: "text-violet-600 bg-violet-50",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Link
            key={c.label}
            to={c.to}
            className={`rounded-xl border bg-white px-4 py-3.5 shadow-sm transition-shadow hover:shadow-md ${
              c.highlight ? "border-amber-200" : "border-neutral-200/80"
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                {c.label}
              </p>
              <span
                className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${c.accent}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className="mt-1 truncate text-2xl font-bold tabular-nums leading-none text-neutral-900">
              {c.value}
            </p>
            <p className="mt-1.5 truncate text-xs text-neutral-500">{c.hint}</p>
          </Link>
        );
      })}
    </div>
  );
}

export default memo(FinanceKpiRow);
