import { memo, useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  CheckSquare,
  CreditCard,
  DollarSign,
  FileSearch,
  FileText,
  Gauge,
  PiggyBank,
  Receipt,
  ShoppingCart,
  Users,
} from "lucide-react";

import type { DashboardCounts } from "../../api/dashboard";
import type { ExecutiveKpiKey } from "../../config/dashboardRoles";
import type { ExecutiveKpis } from "../../utils/dashboardUtils";
import { formatCurrencyCompact } from "../../utils/paymentUtils";
import DashboardKpiCard, {
  DashboardKpiGrid,
  DashboardKpiSkeleton,
} from "./DashboardKpiCard";

interface Metric {
  key: ExecutiveKpiKey;
  label: string;
  value: string;
  icon: LucideIcon;
  to?: string;
  accent?: string;
}

interface Props {
  kpis: ExecutiveKpis | null;
  counts: DashboardCounts | null;
  kpiKeys: ExecutiveKpiKey[];
  loading?: boolean;
  readyForPOCount?: number;
}

const METRIC_DEFS: Record<
  ExecutiveKpiKey,
  Omit<Metric, "key" | "value"> & {
    getValue: (kpis: ExecutiveKpis, counts: DashboardCounts) => string;
  }
> = {
  totalSpend: {
    label: "Total Spend",
    icon: DollarSign,
    to: "/p2p/total-spend",
    accent: "text-primary bg-primary-50",
    getValue: (kpis) => formatCurrencyCompact(kpis.ytdSpend),
  },
  activeSuppliers: {
    label: "Active Suppliers",
    icon: Users,
    to: "/suppliers?status=active",
    accent: "text-primary bg-primary-50",
    getValue: (_kpis, counts) => counts.activeSuppliers.toLocaleString(),
  },
  openRfqs: {
    label: "Open RFQs",
    icon: FileSearch,
    to: "/sourcing/rfq?preset=open",
    accent: "text-primary bg-primary-50",
    getValue: (_kpis, counts) => counts.openRfqs.toLocaleString(),
  },
  openPos: {
    label: "Open Purchase Orders",
    icon: ShoppingCart,
    to: "/p2p/purchase-orders",
    accent: "text-primary bg-primary-50",
    getValue: (kpis) => kpis.openPos.toLocaleString(),
  },
  pendingInvoices: {
    label: "Pending Invoices",
    icon: Receipt,
    to: "/p2p/invoices",
    accent: "text-amber-600 bg-amber-50",
    getValue: (kpis) => kpis.pendingInvoices.toLocaleString(),
  },
  pendingApprovals: {
    label: "Pending Approvals",
    icon: CheckSquare,
    to: "/p2p/requisitions",
    accent: "text-orange-600 bg-orange-50",
    getValue: (kpis) => kpis.pendingApprovals.toLocaleString(),
  },
  totalPayments: {
    label: "Total Payments",
    icon: CreditCard,
    to: "/p2p/payments",
    accent: "text-emerald-600 bg-emerald-50",
    getValue: (_kpis, counts) => counts.totalPayments.toLocaleString(),
  },
  contractCoverage: {
    label: "Contract Coverage",
    icon: FileText,
    to: "/sourcing/rfq",
    accent: "text-teal-600 bg-teal-50",
    getValue: (kpis) => `${kpis.contractCoveragePct}%`,
  },
  savingsAchieved: {
    label: "Savings Achieved",
    icon: PiggyBank,
    to: "/budget",
    accent: "text-emerald-600 bg-emerald-50",
    getValue: (kpis) => formatCurrencyCompact(kpis.savingsAchieved),
  },
  supplierPerformance: {
    label: "Supplier Performance",
    icon: Gauge,
    to: "/suppliers",
    accent: "text-primary bg-primary-50",
    getValue: (kpis) => `${kpis.supplierPerformancePct}%`,
  },
};

function AdminKpiRow({
  kpis,
  counts,
  kpiKeys,
  loading,
  readyForPOCount = 0,
}: Props) {
  const skeletonCount = Math.max(kpiKeys.length, 4);

  const metrics = useMemo(() => {
    if (!kpis || !counts) return [];
    return kpiKeys.map((key) => {
      const def = METRIC_DEFS[key];
      return {
        key,
        label: def.label,
        value: def.getValue(kpis, counts),
        icon: def.icon,
        to: def.to,
        accent: def.accent,
      } satisfies Metric;
    });
  }, [kpis, counts, kpiKeys]);

  if (loading || !kpis || !counts) {
    return <DashboardKpiSkeleton count={skeletonCount} />;
  }

  return (
    <DashboardKpiGrid>
      {metrics.map((m) => (
        <DashboardKpiCard
          key={m.key}
          label={m.label}
          value={m.value}
          icon={m.icon}
          iconClassName={m.accent}
          to={m.to}
        />
      ))}

      {readyForPOCount > 0 && (
        <DashboardKpiCard
          label="Ready for PO"
          value={readyForPOCount}
          icon={CheckCircle2}
          iconClassName="bg-success-100 text-success-600"
          valueClassName="text-success-700"
          to="/p2p/purchase-orders/create"
          className="border-success-200 bg-success-50/40"
        />
      )}
    </DashboardKpiGrid>
  );
}

export default memo(AdminKpiRow);
