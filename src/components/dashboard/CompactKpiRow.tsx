import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CheckSquare,
  Clock,
  DollarSign,
  FileSearch,
  FileText,
  PiggyBank,
  Receipt,
  ShoppingCart,
  Target,
  Users,
} from "lucide-react";

import type { DashboardCounts } from "../../api/dashboard";
import type { ExecutiveKpis } from "../../utils/dashboardUtils";
import { formatCurrencyCompact } from "../../utils/paymentUtils";
import DashboardKpiCard, {
  DashboardKpiGrid,
  DashboardKpiSkeleton,
} from "./DashboardKpiCard";

interface Metric {
  label: string;
  value: string;
  icon: LucideIcon;
  to?: string;
  accent?: string;
}

interface Props {
  kpis: ExecutiveKpis | null;
  counts: DashboardCounts | null;
  loading?: boolean;
}

function CompactKpiRow({ kpis, counts, loading }: Props) {
  if (loading || !kpis || !counts) {
    return <DashboardKpiSkeleton count={10} />;
  }

  const metrics: Metric[] = [
    {
      label: "Total Spend",
      value: formatCurrencyCompact(kpis.ytdSpend),
      icon: DollarSign,
      to: "/p2p/total-spend",
      accent: "text-primary bg-primary-50",
    },
    {
      label: "Spend Under Management",
      value: formatCurrencyCompact(kpis.spendUnderManagement),
      icon: Target,
      to: "/p2p/purchase-orders",
      accent: "text-primary bg-primary-50",
    },
    {
      label: "Savings Achieved",
      value: formatCurrencyCompact(kpis.savingsAchieved),
      icon: PiggyBank,
      accent: "text-emerald-600 bg-emerald-50",
    },
    {
      label: "Active Suppliers",
      value: counts.activeSuppliers.toLocaleString(),
      icon: Users,
      to: "/suppliers?status=active",
      accent: "text-primary bg-primary-50",
    },
    {
      label: "Open RFQs",
      value: counts.openRfqs.toLocaleString(),
      icon: FileSearch,
      to: "/sourcing/rfq?preset=open",
      accent: "text-primary bg-primary-50",
    },
    {
      label: "Open POs",
      value: kpis.openPos.toLocaleString(),
      icon: ShoppingCart,
      to: "/p2p/purchase-orders",
      accent: "text-purple-600 bg-purple-50",
    },
    {
      label: "Pending Invoices",
      value: kpis.pendingInvoices.toLocaleString(),
      icon: Receipt,
      to: "/p2p/invoices",
      accent: "text-amber-600 bg-amber-50",
    },
    {
      label: "Pending Approvals",
      value: kpis.pendingApprovals.toLocaleString(),
      icon: CheckSquare,
      to: "/p2p/requisitions",
      accent: "text-orange-600 bg-orange-50",
    },
    {
      label: "Avg Procurement Cycle",
      value: kpis.avgCycleDays > 0 ? `${kpis.avgCycleDays}d` : "—",
      icon: Clock,
      to: "/p2p/purchase-orders",
      accent: "text-slate-600 bg-slate-50",
    },
    {
      label: "Contract Coverage",
      value: `${kpis.contractCoveragePct}%`,
      icon: FileText,
      to: "/sourcing/rfq",
      accent: "text-teal-600 bg-teal-50",
    },
  ];

  return (
    <DashboardKpiGrid>
      {metrics.map((m) => (
        <DashboardKpiCard
          key={m.label}
          label={m.label}
          value={m.value}
          icon={m.icon}
          iconClassName={m.accent}
          to={m.to}
        />
      ))}
    </DashboardKpiGrid>
  );
}

export default memo(CompactKpiRow);
