import { memo } from "react";

import type { ProcurementHealthItem } from "../../utils/dashboardUtils";

const STATUS_DOT: Record<ProcurementHealthItem["status"], string> = {
  good: "bg-emerald-500",
  warning: "bg-amber-400",
  critical: "bg-red-500",
};

interface Props {
  items: ProcurementHealthItem[];
  loading?: boolean;
}

function ProcurementHealthBar({ items, loading }: Props) {
  if (loading) {
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-36 animate-pulse rounded-full bg-neutral-200/80"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200/80 bg-white px-3 py-2 shadow-sm">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
        Health
      </span>
      {items.map((item) => (
        <span
          key={item.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-neutral-100 bg-neutral-50/80 px-2.5 py-1 text-[11px] font-medium text-neutral-700"
        >
          <span
            className={`h-2 w-2 rounded-full ${STATUS_DOT[item.status]}`}
            aria-hidden
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export default memo(ProcurementHealthBar);
