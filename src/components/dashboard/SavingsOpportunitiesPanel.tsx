import { memo } from "react";
import { ArrowDownRight, ArrowUpRight, PiggyBank } from "lucide-react";

import { Skeleton } from "../Skeleton";
import type { SavingsOpportunity } from "../../utils/dashboardUtils";
import { formatCurrencyCompact } from "../../utils/paymentUtils";

interface Props {
  items: SavingsOpportunity[];
  loading?: boolean;
}

function SavingsOpportunitiesPanel({ items, loading }: Props) {
  if (loading) {
    return <Skeleton className="min-h-[160px] w-full rounded-xl" />;
  }

  return (
    <div className="dashboard-panel">
      <div className="dashboard-panel-header">
        <PiggyBank className="h-4 w-4 text-emerald-600" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Savings Opportunities
        </h3>
      </div>

      <ul className="dashboard-panel-body divide-y divide-neutral-100">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutral-800">
                {item.label}
              </p>
              <p className="text-base font-bold tabular-nums text-emerald-700">
                {formatCurrencyCompact(item.value)}
              </p>
            </div>
            <span
              className={`inline-flex items-center gap-0.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${
                item.trend >= 0
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-red-50 text-red-600"
              }`}
            >
              {item.trend >= 0 ? (
                <ArrowUpRight className="h-3.5 w-3.5" />
              ) : (
                <ArrowDownRight className="h-3.5 w-3.5" />
              )}
              {item.trend > 0 ? "+" : ""}
              {item.trend}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default memo(SavingsOpportunitiesPanel);
