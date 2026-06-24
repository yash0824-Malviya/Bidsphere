import { memo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Package, Ship, Truck } from "lucide-react";

import { Skeleton } from "../Skeleton";
import type { ShipmentMetrics } from "../../utils/dashboardUtils";
import { formatCurrencyCompact } from "../../utils/paymentUtils";

interface Props {
  metrics: ShipmentMetrics;
  loading?: boolean;
}

function ShipmentLogisticsWidget({ metrics, loading }: Props) {
  if (loading) {
    return <Skeleton className="h-[148px] w-full rounded-lg" />;
  }

  const cells = [
    {
      label: "In Transit",
      value: metrics.inTransit.toLocaleString(),
      icon: Truck,
      tone: "text-primary-600",
    },
    {
      label: "Delayed",
      value: metrics.delayed.toLocaleString(),
      icon: AlertTriangle,
      tone: metrics.delayed > 0 ? "text-red-600" : "text-neutral-600",
    },
    {
      label: "Expected Today",
      value: metrics.expectedToday.toLocaleString(),
      icon: Package,
      tone: "text-primary",
    },
    {
      label: "Freight Cost Est.",
      value: formatCurrencyCompact(metrics.freightCostEstimate),
      icon: Ship,
      tone: "text-primary",
    },
  ];

  return (
    <div className="rounded-lg border border-neutral-200/80 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-neutral-900">
          Shipment &amp; Logistics
        </h3>
        <Link
          to="/p2p/purchase-orders"
          className="text-[10px] font-medium text-primary-600 hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cells.map(({ label, value, icon: Icon, tone }) => (
          <div
            key={label}
            className="rounded-md border border-neutral-100 bg-neutral-50/50 px-2 py-2"
          >
            <div className="flex items-center gap-1">
              <Icon className={`h-3 w-3 ${tone}`} />
              <span className="text-[10px] text-neutral-500">{label}</span>
            </div>
            <p className={`mt-0.5 text-sm font-bold tabular-nums ${tone}`}>
              {value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(ShipmentLogisticsWidget);
