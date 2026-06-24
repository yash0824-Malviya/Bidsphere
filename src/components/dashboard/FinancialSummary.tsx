import { Wallet } from "lucide-react";

import { Skeleton } from "../Skeleton";
import type { FinancialSummaryItem } from "../../utils/dashboardUtils";

const TONE_CLASSES: Record<
  NonNullable<FinancialSummaryItem["tone"]>,
  string
> = {
  default: "text-neutral-900",
  warning: "text-warning-600",
  danger: "text-danger-600",
  success: "text-success-600",
};

interface Props {
  items: FinancialSummaryItem[];
  loading?: boolean;
}

export default function FinancialSummary({ items, loading }: Props) {
  if (loading) {
    return <Skeleton className="h-80 w-full rounded-card" />;
  }

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Wallet className="h-4 w-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">
            Financial Summary
          </h3>
          <p className="text-xs text-neutral-500">
            Spend, accounts payable, and commitments at a glance
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-lg border border-neutral-100 bg-neutral-50/40 px-4 py-3"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              {item.label}
            </p>
            <p
              className={`mt-1 text-lg font-bold tabular-nums ${
                TONE_CLASSES[item.tone ?? "default"]
              }`}
            >
              {item.value}
            </p>
            {item.sub && (
              <p className="mt-0.5 text-xs text-neutral-500">{item.sub}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
