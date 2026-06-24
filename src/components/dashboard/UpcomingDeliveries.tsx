import { Link } from "react-router-dom";
import { CalendarClock, Package } from "lucide-react";
import { differenceInCalendarDays, parseISO } from "date-fns";

import { EmptyState, StatusBadge } from "../ui";
import { Skeleton } from "../Skeleton";
import type { DashboardPoLite } from "../../api/dashboard";
import { formatCurrency, formatDate } from "../../utils/format";

interface Props {
  deliveries: DashboardPoLite[];
  loading?: boolean;
}

function daysUntil(dateStr: string): number {
  return differenceInCalendarDays(parseISO(dateStr), new Date());
}

function urgencyLabel(days: number): { text: string; tone: string } {
  if (days < 0) return { text: "Overdue", tone: "text-danger-600 bg-danger-50" };
  if (days === 0) return { text: "Today", tone: "text-warning-600 bg-warning-50" };
  if (days <= 7) return { text: `${days}d`, tone: "text-warning-600 bg-warning-50" };
  return { text: `${days}d`, tone: "text-neutral-600 bg-neutral-100" };
}

export default function UpcomingDeliveries({
  deliveries,
  loading,
}: Props) {
  if (loading) {
    return <Skeleton className="h-80 w-full rounded-card" />;
  }

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">
              Upcoming Deliveries
            </h3>
            <p className="text-xs text-neutral-500">
              Open POs sorted by required-by date
            </p>
          </div>
        </div>
        <Link
          to="/p2p/purchase-orders"
          className="text-xs font-medium text-primary hover:underline"
        >
          All POs →
        </Link>
      </div>

      {deliveries.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No upcoming deliveries"
          description="Open POs with a schedule date will appear here."
        />
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100">
          {deliveries.map((po) => {
            const schedule = po.schedule_date ?? "";
            const days = schedule ? daysUntil(schedule) : null;
            const urgency =
              days != null ? urgencyLabel(days) : { text: "—", tone: "text-neutral-500 bg-neutral-100" };

            return (
              <li key={po.name}>
                <Link
                  to={`/p2p/purchase-orders/${encodeURIComponent(po.name)}`}
                  className="flex items-center gap-3 px-3 py-3 hover:bg-neutral-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900">
                      {po.name}
                    </p>
                    <p className="truncate text-xs text-neutral-500">
                      {po.supplier}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <StatusBadge status={po.status ?? "Draft"} />
                      {po.per_received != null && po.per_received < 100 && (
                        <span className="text-[11px] text-neutral-400">
                          {po.per_received}% received
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1">
                    <span className="text-xs font-semibold tabular-nums">
                      {formatCurrency(po.grand_total)}
                    </span>
                    <span className="text-[11px] text-neutral-500">
                      {schedule ? formatDate(schedule) : "—"}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${urgency.tone}`}
                    >
                      {urgency.text}
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
