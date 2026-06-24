import { memo } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  Package,
  Percent,
  Truck,
  Warehouse,
} from "lucide-react";

import { Skeleton } from "../Skeleton";
import type { WarehouseKpis } from "../../api/warehouseDashboard";
import { formatCurrencyCompact } from "../../utils/paymentUtils";

interface Metric {
  label: string;
  value: string;
  icon: LucideIcon;
  to?: string;
  accent?: string;
}

interface Props {
  kpis: WarehouseKpis | null;
  loading?: boolean;
}

function WarehouseKpiRow({ kpis, loading }: Props) {
  if (loading || !kpis) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="min-h-[80px] rounded-xl" />
        ))}
      </div>
    );
  }

  const metrics: Metric[] = [
    {
      label: "Inventory Value",
      value: formatCurrencyCompact(kpis.inventoryValue),
      icon: Boxes,
      to: "/inventory",
      accent: "text-primary bg-primary-50",
    },
    {
      label: "Total SKUs",
      value: kpis.totalSkus.toLocaleString(),
      icon: Package,
      to: "/inventory",
      accent: "text-primary bg-primary-50",
    },
    {
      label: "Low Stock Items",
      value: kpis.lowStockItems.toLocaleString(),
      icon: AlertTriangle,
      to: "/inventory",
      accent: "text-amber-600 bg-amber-50",
    },
    {
      label: "Incoming GRNs",
      value: kpis.incomingGrns.toLocaleString(),
      icon: Truck,
      to: "/p2p/grn",
      accent: "text-primary bg-primary-50",
    },
    {
      label: "Pending Receipts",
      value: kpis.pendingReceipts.toLocaleString(),
      icon: Warehouse,
      to: "/p2p/purchase-orders",
      accent: "text-primary bg-primary-50",
    },
    {
      label: "Stock Transfers",
      value: kpis.stockTransfers.toLocaleString(),
      icon: ArrowLeftRight,
      to: "/inventory",
      accent: "text-purple-600 bg-purple-50",
    },
    {
      label: "Inventory Accuracy",
      value: `${kpis.inventoryAccuracyPct}%`,
      icon: Percent,
      accent: "text-emerald-600 bg-emerald-50",
    },
    {
      label: "Warehouse Utilization",
      value: `${kpis.warehouseUtilizationPct}%`,
      icon: Warehouse,
      accent: "text-teal-600 bg-teal-50",
    },
  ];

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
  );
}

export default memo(WarehouseKpiRow);
