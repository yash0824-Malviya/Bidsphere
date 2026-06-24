import { memo } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CalendarClock, PackageCheck, Truck } from "lucide-react";

import { Skeleton } from "../Skeleton";

interface ReceivingKpiCard {
  label: string;
  value: number;
  icon: LucideIcon;
  to: string;
  accent: string;
  highlight?: boolean;
}

interface Props {
  pendingReceipts: number;
  incomingThisWeek: number;
  overdueDeliveries: number;
  lowStockAlerts: number;
  loading?: boolean;
}

function WarehouseReceivingKpis({
  pendingReceipts,
  incomingThisWeek,
  overdueDeliveries,
  lowStockAlerts,
  loading,
}: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="min-h-[92px] rounded-xl" />
        ))}
      </div>
    );
  }

  const cards: ReceivingKpiCard[] = [
    {
      label: "Pending Receipts",
      value: pendingReceipts,
      icon: PackageCheck,
      to: "/p2p/grn",
      accent: "text-primary bg-primary-50",
    },
    {
      label: "Incoming Deliveries This Week",
      value: incomingThisWeek,
      icon: Truck,
      to: "/p2p/grn",
      accent: "text-primary bg-primary-50",
    },
    {
      label: "Overdue Deliveries",
      value: overdueDeliveries,
      icon: CalendarClock,
      to: "/p2p/grn",
      accent: "text-danger-600 bg-danger-50",
      highlight: overdueDeliveries > 0,
    },
    {
      label: "Low Stock Alerts",
      value: lowStockAlerts,
      icon: AlertTriangle,
      to: "/inventory",
      accent: "text-amber-600 bg-amber-50",
      highlight: lowStockAlerts > 0,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Link
            key={c.label}
            to={c.to}
            className={`rounded-xl border bg-white px-4 py-3.5 shadow-sm transition-shadow hover:shadow-md ${
              c.highlight ? "border-danger-200" : "border-neutral-200/80"
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
            <p className="mt-1 text-2xl font-bold tabular-nums leading-none text-neutral-900">
              {c.value.toLocaleString()}
            </p>
          </Link>
        );
      })}
    </div>
  );
}

export default memo(WarehouseReceivingKpis);
