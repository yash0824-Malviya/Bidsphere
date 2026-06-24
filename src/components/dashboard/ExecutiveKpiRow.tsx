import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Building2,
  Clock,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Users,
} from "lucide-react";

import { Skeleton } from "../Skeleton";
import { StatCard } from "../ui";
import type { ExecutiveKpis } from "../../utils/dashboardUtils";
import { formatCurrencyCompact } from "../../utils/paymentUtils";

interface Props {
  kpis: ExecutiveKpis;
  counts: {
    totalPos: number;
    unpaidInvoices: number;
    openRfqs: number;
    overdueInvoices: number;
  };
  loading?: boolean;
  /** When set, only these KPI labels are shown. Empty = show all. */
  visibleLabels?: string[];
}

export default function ExecutiveKpiRow({
  kpis,
  counts,
  loading,
  visibleLabels,
}: Props) {
  const cards: Array<{
    icon: LucideIcon;
    label: string;
    value: string;
    sub?: string;
    tone: "primary" | "accent" | "warning" | "danger" | "neutral";
    trend?: { value: number; label: string; inverted?: boolean };
    to?: string;
  }> = [
    {
      icon: DollarSign,
      label: "YTD Spend",
      value: formatCurrencyCompact(kpis.ytdSpend),
      sub: "Purchase invoices · submitted",
      tone: "primary",
      trend: {
        value: kpis.ytdSpendTrend,
        label: "vs prior year",
        inverted: true,
      },
    },
    {
      icon: AlertTriangle,
      label: "Accounts Payable",
      value: formatCurrencyCompact(kpis.pendingPayables),
      sub:
        counts.unpaidInvoices > 0
          ? `${counts.unpaidInvoices.toLocaleString()} unpaid invoice${counts.unpaidInvoices === 1 ? "" : "s"}`
          : "No unpaid invoices",
      tone: kpis.pendingPayables > 0 ? "warning" : "neutral",
      to: "/p2p/invoices",
    },
    {
      icon: ShoppingCart,
      label: "Open PO Value",
      value: formatCurrencyCompact(kpis.openPoValue),
      sub: `${counts.totalPos.toLocaleString()} POs on record`,
      tone: "accent",
      to: "/p2p/purchase-orders",
    },
    {
      icon: Users,
      label: "Active Suppliers",
      value: kpis.activeSuppliers.toLocaleString(),
      sub: "Enabled supplier master",
      tone: "neutral",
      to: "/suppliers",
    },
    {
      icon: TrendingUp,
      label: "Overdue Exposure",
      value: formatCurrencyCompact(kpis.overdueExposure),
      sub: `${counts.overdueInvoices} overdue invoices`,
      tone: counts.overdueInvoices > 0 ? "danger" : "neutral",
      to: "/p2p/invoices?status=Overdue",
    },
    {
      icon: Clock,
      label: "Avg PO Cycle",
      value: kpis.avgCycleDays > 0 ? `${kpis.avgCycleDays}d` : "—",
      sub: `${counts.openRfqs} active RFQs`,
      tone: "primary",
      to: "/sourcing/rfq",
    },
  ];

  if (loading) {
    const skeletonCount =
      visibleLabels && visibleLabels.length > 0 ? visibleLabels.length : 6;
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <Skeleton key={i} className="h-[108px] rounded-card" />
        ))}
      </div>
    );
  }

  const visibleCards =
    visibleLabels && visibleLabels.length > 0
      ? cards.filter((c) => visibleLabels.includes(c.label))
      : cards;

  return (
    <div
      className={`grid gap-4 sm:grid-cols-2 ${
        visibleCards.length <= 3
          ? "xl:grid-cols-3"
          : "xl:grid-cols-3 2xl:grid-cols-6"
      }`}
    >
      {visibleCards.map((c) => (
        <StatCard
          key={c.label}
          icon={c.icon}
          label={c.label}
          value={c.value}
          sub={c.sub}
          tone={c.tone}
          trend={c.trend}
          to={c.to}
        />
      ))}
    </div>
  );
}

export function DashboardScopeBanner({
  supplierCount,
  poCount,
  invoiceCount,
}: {
  supplierCount: number;
  poCount: number;
  invoiceCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-primary-100 bg-primary-50/60 px-4 py-2.5 text-xs text-neutral-600">
      <span className="inline-flex items-center gap-1.5 font-medium text-primary-700">
        <Building2 className="h-3.5 w-3.5" />
        Enterprise procurement scope
      </span>
      <span>
        <strong className="text-neutral-800">{supplierCount.toLocaleString()}</strong>{" "}
        suppliers
      </span>
      <span className="text-neutral-300">|</span>
      <span>
        <strong className="text-neutral-800">{poCount.toLocaleString()}</strong>{" "}
        purchase orders
      </span>
      <span className="text-neutral-300">|</span>
      <span>
        <strong className="text-neutral-800">{invoiceCount.toLocaleString()}</strong>{" "}
        invoices
      </span>
    </div>
  );
}
