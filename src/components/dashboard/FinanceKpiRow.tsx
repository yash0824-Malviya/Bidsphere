import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  CreditCard,
  FileClock,
  FileSearch,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import type { FinanceWorkflowKpis } from "../../api/financeWorkflow";
import { formatCurrencyCompact } from "../../utils/format";
import DashboardKpiCard from "./DashboardKpiCard";

interface KpiDef {
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
      <div className="kpi-grid finance-kpi-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="kpi-card" aria-hidden>
            <div className="kpi-card-title-slot" />
            <div className="kpi-card-value-slot" />
            <div className="kpi-card-caption-slot" />
          </div>
        ))}
      </div>
    );
  }

  const cards: KpiDef[] = [
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
      value: formatCurrencyCompact(kpis.outstandingPayables),
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
      label: "Financial Exposure",
      value: formatCurrencyCompact(kpis.totalFinancialExposure),
      hint: "Open POs, payables and commitments",
      icon: CheckCircle2,
      to: "/budget",
      accent: "text-violet-600 bg-violet-50",
    },
  ];

  return (
    /* Column template owned by `.finance-kpi-grid` (auto-fit minmax 240px). */
    <div className="kpi-grid finance-kpi-grid">
      {cards.map((c) => (
        <DashboardKpiCard
          key={c.label}
          label={c.label}
          value={c.value}
          subtitle={c.hint}
          icon={c.icon}
          iconClassName={c.accent}
          to={c.to}
          className={c.highlight ? "border-amber-200" : undefined}
        />
      ))}
    </div>
  );
}

export default memo(FinanceKpiRow);
