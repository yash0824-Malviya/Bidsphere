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
import { formatCurrency } from "../../utils/format";
import DashboardKpiCard, {
  DashboardKpiGrid,
  DashboardKpiSkeleton,
} from "./DashboardKpiCard";

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
    return <DashboardKpiSkeleton count={6} />;
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
      hint: "Open POs + payables + unbilled GRNs + approved commitments",
      icon: CheckCircle2,
      to: "/budget",
      accent: "text-violet-600 bg-violet-50",
    },
  ];

  return (
    <DashboardKpiGrid>
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
    </DashboardKpiGrid>
  );
}

export default memo(FinanceKpiRow);
