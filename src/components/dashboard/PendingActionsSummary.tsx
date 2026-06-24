import { Link } from "react-router-dom";
import {
  AlertCircle,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileSearch,
  FileText,
  ShoppingCart,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Skeleton } from "../Skeleton";
import type { PendingAction } from "../../utils/dashboardUtils";

const PRIORITY_STYLES: Record<
  PendingAction["priority"],
  { border: string; badge: string }
> = {
  high: {
    border: "border-danger-100 bg-danger-50/40",
    badge: "bg-danger-50 text-danger-600",
  },
  medium: {
    border: "border-warning-100 bg-warning-50/30",
    badge: "bg-warning-50 text-warning-600",
  },
  normal: {
    border: "border-neutral-100 bg-neutral-50/40",
    badge: "bg-neutral-100 text-neutral-600",
  },
};

const ACTION_ICONS: Record<string, LucideIcon> = {
  "overdue-invoices": AlertCircle,
  "unpaid-invoices": FileText,
  "pending-payments": CreditCard,
  "open-pos": ShoppingCart,
  "pending-grns": Truck,
  "open-requisitions": ClipboardList,
  "open-rfqs": FileSearch,
};

interface Props {
  actions: PendingAction[];
  loading?: boolean;
}

export default function PendingActionsSummary({ actions, loading }: Props) {
  if (loading) {
    return <Skeleton className="h-80 w-full rounded-card" />;
  }

  return (
    <div className="card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-neutral-900">
          Pending Actions
        </h3>
        <p className="text-xs text-neutral-500">
          Items requiring buyer, procurement, or finance attention
        </p>
      </div>

      {actions.length === 0 ? (
        <div className="rounded-lg border border-success-100 bg-success-50/50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-success-700">
            No pending actions
          </p>
          <p className="mt-1 text-xs text-success-600">
            All queues are clear for now.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {actions.map((action) => {
            const Icon = ACTION_ICONS[action.id] ?? ClipboardList;
            const style = PRIORITY_STYLES[action.priority];
            return (
              <li key={action.id}>
                <Link
                  to={action.to}
                  className={`flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-primary-200 hover:bg-primary-50/20 ${style.border}`}
                >
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white text-primary shadow-sm">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-neutral-900">
                        {action.label}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${style.badge}`}
                      >
                        {action.priority}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-neutral-500">
                      {action.description}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <span className="text-lg font-bold tabular-nums text-neutral-900">
                      {action.count.toLocaleString()}
                    </span>
                    <ChevronRight className="h-4 w-4 text-neutral-400" />
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
