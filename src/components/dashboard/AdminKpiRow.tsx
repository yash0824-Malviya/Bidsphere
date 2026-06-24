import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
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

import { Skeleton } from "../Skeleton";
import type { DashboardCounts } from "../../api/dashboard";
import type { ExecutiveKpiKey } from "../../config/dashboardRoles";
import type { ExecutiveKpis } from "../../utils/dashboardUtils";
import { formatCurrencyCompact } from "../../utils/paymentUtils";

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
    to: "/p2p/invoices",
    accent: "text-primary bg-primary-50",
    getValue: (kpis) => formatCurrencyCompact(kpis.ytdSpend),
  },
  activeSuppliers: {
    label: "Active Suppliers",
    icon: Users,
    to: "/suppliers",
    accent: "text-primary bg-primary-50",
    getValue: (_kpis, counts) => counts.activeSuppliers.toLocaleString(),
  },
  openRfqs: {
    label: "Open RFQs",
    icon: FileSearch,
    to: "/sourcing/rfq",
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

function AdminKpiRow({ kpis, counts, kpiKeys, loading, readyForPOCount = 0 }: Props) {
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
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <Skeleton key={i} className="min-h-[80px] rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((m) => {
        const Icon = m.icon;
        const inner = (
          <>
            <div className="flex items-center justify-between gap-1">
              <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                {m.label}
              </p>
              <span
                className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${m.accent}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className="mt-1 text-lg font-bold tabular-nums leading-none text-neutral-900">
              {m.value}
            </p>
          </>
        );
        const className =
          "rounded-xl border border-neutral-200/80 bg-white px-4 py-3.5 shadow-sm transition-shadow hover:shadow-md";

        return m.to ? (
          <Link key={m.key} to={m.to} className={className}>
            {inner}
          </Link>
        ) : (
          <div key={m.key} className={className}>
            {inner}
          </div>
        );
      })}

      {readyForPOCount > 0 && (
        <Link
          to="/p2p/purchase-orders/create"
          className="rounded-xl border border-success-200 bg-success-50/40 px-4 py-3.5 shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="flex items-center justify-between gap-1">
            <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-success-600">
              Ready for PO
            </p>
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-success-100 text-success-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </span>
          </div>
          <p className="mt-1 text-lg font-bold tabular-nums leading-none text-success-700">
            {readyForPOCount}
          </p>
        </Link>
      )}
    </div>
  );
}

export default memo(AdminKpiRow);
