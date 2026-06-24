import { memo } from "react";
import { Link } from "react-router-dom";
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

import { Skeleton } from "../Skeleton";
import type { DashboardCounts } from "../../api/dashboard";
import type { ExecutiveKpis } from "../../utils/dashboardUtils";
import { formatCurrencyCompact } from "../../utils/paymentUtils";

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
    return (
      <div className="space-y-2">
        {Array.from({ length: 2 }).map((_, row) => (
          <div
            key={row}
            className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5"
          >
            {Array.from({ length: 5 }).map((__, i) => (
              <Skeleton key={i} className="h-[68px] rounded-lg" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  const metrics: Metric[] = [
    {
      label: "Total Spend",
      value: formatCurrencyCompact(kpis.ytdSpend),
      icon: DollarSign,
      to: "/p2p/invoices",
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
      to: "/suppliers",
      accent: "text-primary bg-primary-50",
    },
    {
      label: "Open RFQs",
      value: counts.openRfqs.toLocaleString(),
      icon: FileSearch,
      to: "/sourcing/rfq",
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

  const rows = [metrics.slice(0, 5), metrics.slice(5, 10)];

  return (
    <div className="space-y-2">
      {rows.map((row, rowIdx) => (
        <div
          key={rowIdx}
          className="grid grid-cols-1 gap-2 xs:grid-cols-2 md:grid-cols-3 xl:grid-cols-5"
        >
          {row.map((m) => {
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
              "rounded-lg border border-neutral-200/80 bg-white px-3 py-2.5 shadow-sm transition-shadow hover:shadow-md";

            return m.to ? (
              <Link key={m.label} to={m.to} className={className}>
                {inner}
              </Link>
            ) : (
              <div key={m.label} className={className}>
                {inner}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default memo(CompactKpiRow);
