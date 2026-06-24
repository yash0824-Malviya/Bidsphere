import { memo } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Banknote,
  FileSearch,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Skeleton } from "../Skeleton";
import type { ActivityFeedItem } from "../../utils/dashboardUtils";
import { formatActivityLabel } from "../../utils/dashboardUtils";
import { formatDate } from "../../utils/format";

const TYPE_META: Record<
  ActivityFeedItem["type"],
  { icon: LucideIcon; tone: string }
> = {
  rfq: { icon: FileSearch, tone: "bg-primary-50 text-primary" },
  po: { icon: ShoppingCart, tone: "bg-primary-50 text-primary" },
  invoice: { icon: Receipt, tone: "bg-primary-50 text-primary" },
  payment: { icon: Banknote, tone: "bg-emerald-50 text-emerald-600" },
};

interface Props {
  items: ActivityFeedItem[];
  loading?: boolean;
  title?: string;
}

function CompactActivityFeed({ items, loading, title = "Recent Activity" }: Props) {
  if (loading) {
    return <Skeleton className="min-h-[160px] w-full rounded-xl" />;
  }

  const visible = items.slice(0, 6);

  return (
    <div className="dashboard-panel">
      <div className="dashboard-panel-header">
        <Activity className="h-4 w-4 text-primary-600" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {title}
        </h3>
      </div>

      {visible.length === 0 ? (
        <p className="dashboard-panel-body py-8 text-center text-sm text-neutral-500">
          Procurement activity will appear here as RFQs, POs, and invoices are created.
        </p>
      ) : (
        <ul className="dashboard-panel-body divide-y divide-neutral-100">
          {visible.map((item) => {
            const meta = TYPE_META[item.type];
            const Icon = meta.icon;
            return (
              <li key={item.id}>
                <Link
                  to={item.to}
                  className="flex items-center gap-3 py-3 hover:bg-neutral-50/80"
                >
                  <div
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${meta.tone}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900">
                      {formatActivityLabel(item)}
                    </p>
                    <p className="truncate text-xs text-neutral-500">
                      {item.subtitle || item.title}
                    </p>
                  </div>
                  <span className="flex-shrink-0 text-xs text-neutral-400">
                    {formatDate(item.date, "MMM d")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default memo(CompactActivityFeed);
