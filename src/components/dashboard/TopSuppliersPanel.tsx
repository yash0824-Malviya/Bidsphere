import { memo } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Minus, Users } from "lucide-react";

import { Skeleton } from "../Skeleton";
import type { TopSupplierTrendRow } from "../../utils/dashboardUtils";
import { formatCurrencyCompact } from "../../utils/paymentUtils";

interface Props {
  rows: TopSupplierTrendRow[];
  loading?: boolean;
}

const RISK_STYLES: Record<
  TopSupplierTrendRow["riskLevel"],
  string
> = {
  low: "bg-emerald-50 text-emerald-700",
  medium: "bg-amber-50 text-amber-800",
  high: "bg-red-50 text-red-700",
};

function TrendIcon({ trend }: { trend: TopSupplierTrendRow["trend"] }) {
  if (trend === "up")
    return <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" />;
  if (trend === "down")
    return <ArrowDownRight className="h-3.5 w-3.5 text-red-500" />;
  return <Minus className="h-3.5 w-3.5 text-neutral-400" />;
}

function TopSuppliersPanel({ rows, loading }: Props) {
  if (loading) {
    return <Skeleton className="min-h-[160px] w-full rounded-xl" />;
  }

  return (
    <div className="dashboard-panel">
      <div className="dashboard-panel-header justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary-600" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Top Suppliers
          </h3>
        </div>
        <Link
          to="/suppliers"
          className="text-xs font-medium text-primary-600 hover:underline"
        >
          View all
        </Link>
      </div>

      <ul className="dashboard-panel-body divide-y divide-neutral-100">
        {rows.map((row) => (
          <li key={row.supplier}>
            <Link
              to={`/suppliers/${encodeURIComponent(row.supplier)}`}
              className="flex items-center gap-3 py-3 hover:bg-neutral-50/80"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900">
                  {row.supplier}
                </p>
                <p className="text-xs tabular-nums text-neutral-500">
                  {formatCurrencyCompact(row.spend)} · {row.spendSharePct}%
                </p>
              </div>
              <span className="rounded-md bg-primary-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary-700">
                {row.performanceScore}
              </span>
              <span
                className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${
                  row.trend === "up"
                    ? "text-emerald-600"
                    : row.trend === "down"
                      ? "text-red-500"
                      : "text-neutral-400"
                }`}
              >
                <TrendIcon trend={row.trend} />
                {Math.abs(row.trendPct)}%
              </span>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${RISK_STYLES[row.riskLevel]}`}
              >
                {row.riskLevel}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default memo(TopSuppliersPanel);
