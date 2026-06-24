import { memo } from "react";
import { AlertTriangle } from "lucide-react";

import { Skeleton } from "../Skeleton";
import type { AlertRiskItem } from "../../utils/dashboardUtils";

interface Props {
  items: AlertRiskItem[];
  loading?: boolean;
}

const LEVEL_STYLES: Record<
  AlertRiskItem["level"],
  { dot: string; bg: string; text: string }
> = {
  good: {
    dot: "bg-emerald-500",
    bg: "bg-emerald-50/80 border-emerald-100",
    text: "text-emerald-800",
  },
  warning: {
    dot: "bg-amber-400",
    bg: "bg-amber-50/80 border-amber-100",
    text: "text-amber-900",
  },
  critical: {
    dot: "bg-red-500",
    bg: "bg-red-50/80 border-red-100",
    text: "text-red-800",
  },
};

function AlertsRisksPanel({ items, loading }: Props) {
  if (loading) {
    return <Skeleton className="min-h-[160px] w-full rounded-xl" />;
  }

  return (
    <div className="dashboard-panel">
      <div className="dashboard-panel-header">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Alerts &amp; Risks
        </h3>
      </div>

      <ul className="dashboard-panel-body flex flex-col gap-2 py-3">
        {items.map((item) => {
          const style = LEVEL_STYLES[item.level];
          return (
            <li
              key={item.id}
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${style.bg}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`}
                  aria-hidden
                />
                <span className={`truncate text-sm font-medium ${style.text}`}>
                  {item.label}
                </span>
              </span>
              <span
                className={`shrink-0 text-sm font-bold tabular-nums ${style.text}`}
              >
                {item.value}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default memo(AlertsRisksPanel);
