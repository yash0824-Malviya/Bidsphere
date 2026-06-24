import { Link } from "react-router-dom";
import {
  Activity,
  Banknote,
  FileSearch,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { EmptyState, StatusBadge } from "../ui";
import { Skeleton } from "../Skeleton";
import type { ActivityFeedItem } from "../../utils/dashboardUtils";
import { formatCurrency, formatDate } from "../../utils/format";

const TYPE_META: Record<
  ActivityFeedItem["type"],
  { icon: LucideIcon; label: string; tone: string }
> = {
  rfq: {
    icon: FileSearch,
    label: "RFQ",
    tone: "bg-primary-50 text-primary",
  },
  po: {
    icon: ShoppingCart,
    label: "PO",
    tone: "bg-primary-50 text-primary",
  },
  invoice: {
    icon: Receipt,
    label: "Invoice",
    tone: "bg-primary-50 text-primary",
  },
  payment: {
    icon: Banknote,
    label: "Payment",
    tone: "bg-emerald-50 text-emerald-600",
  },
};

interface Props {
  items: ActivityFeedItem[];
  loading?: boolean;
}

export default function RecentActivityFeed({ items, loading }: Props) {
  if (loading) {
    return <Skeleton className="h-96 w-full rounded-card" />;
  }

  return (
    <div className="table-shell">
      <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">
              Recent Activity
            </h3>
            <p className="text-xs text-neutral-500">
              Latest RFQs, purchase orders, and invoices across the workspace
            </p>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No recent activity"
          description="Recent documents and actions will appear here."
        />
      ) : (
        <ul className="divide-y divide-neutral-100">
          {items.map((item) => {
            const meta = TYPE_META[item.type];
            const Icon = meta.icon;
            return (
              <li key={item.id}>
                <Link
                  to={item.to}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50"
                >
                  <div
                    className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${meta.tone}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-neutral-900">
                        {item.title}
                      </p>
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-500">
                        {meta.label}
                      </span>
                      {item.status && (
                        <StatusBadge status={item.status} />
                      )}
                    </div>
                    <p className="truncate text-xs text-neutral-500">
                      {item.subtitle}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1">
                    {item.amount != null && (
                      <span className="text-xs font-semibold tabular-nums text-neutral-800">
                        {formatCurrency(item.amount)}
                      </span>
                    )}
                    <span className="text-[11px] text-neutral-400">
                      {formatDate(item.date, "MMM d · HH:mm")}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
