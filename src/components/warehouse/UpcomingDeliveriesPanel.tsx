import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PackagePlus, Truck } from "lucide-react";

import { getIncomingPurchaseOrders } from "../../api/purchasing";
import { canCreateGRN } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import { Skeleton } from "../Skeleton";
import { formatCurrency, formatDate } from "../../utils/format";
import {
  buildUpcomingDeliveries,
  DELIVERY_URGENCY_META,
  formatDaysRemaining,
  type UpcomingDelivery,
} from "../../utils/upcomingDeliveries";

interface Props {
  /** When provided, skips the internal fetch (parent owns the query). */
  deliveries?: UpcomingDelivery[];
  isLoading?: boolean;
  className?: string;
}

/**
 * Left sidebar — inbound PO queue for warehouse receiving.
 */
export default function UpcomingDeliveriesPanel({
  deliveries: deliveriesProp,
  isLoading: isLoadingProp,
  className = "",
}: Props) {
  const role = useAuthStore((s) => s.user?.role);
  const canCreate = canCreateGRN(role);

  const internalQuery = useQuery({
    queryKey: ["incoming-purchase-orders"],
    queryFn: getIncomingPurchaseOrders,
    staleTime: 60_000,
    enabled: deliveriesProp === undefined,
  });

  const isLoading = isLoadingProp ?? internalQuery.isLoading;
  const deliveries = useMemo(
    () => deliveriesProp ?? buildUpcomingDeliveries(internalQuery.data ?? []),
    [deliveriesProp, internalQuery.data]
  );

  return (
    <aside
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm ${className}`}
    >
      <div className="shrink-0 border-b border-neutral-100 px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <Truck className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-neutral-900">Upcoming Deliveries</h2>
              <p className="text-[11px] text-neutral-500">POs awaiting goods receipt</p>
            </div>
          </div>
          {!isLoading && (
            <span className="shrink-0 rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-bold tabular-nums text-primary-700 ring-1 ring-inset ring-primary-200">
              {deliveries.length} pending
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2.5 scrollbar-hidden">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[132px] rounded-lg" />
            ))}
          </div>
        ) : deliveries.length === 0 ? (
          <p className="py-8 text-center text-xs leading-relaxed text-neutral-500">
            No open deliveries.
            <br />
            All approved purchase orders have been received.
          </p>
        ) : (
          <div className="space-y-2">
            {deliveries.map((d) => (
              <DeliveryCard key={d.name} delivery={d} canCreate={canCreate} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function DeliveryCard({
  delivery: d,
  canCreate,
}: {
  delivery: UpcomingDelivery;
  canCreate: boolean;
}) {
  const meta = DELIVERY_URGENCY_META[d.urgency];
  const poHref = canCreate
    ? `/p2p/grn/new?po=${encodeURIComponent(d.name)}`
    : `/p2p/purchase-orders/${encodeURIComponent(d.name)}`;

  return (
    <article className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-2.5 transition hover:border-primary-200 hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <Link
          to={poHref}
          className="truncate text-xs font-bold text-primary-600 hover:underline"
        >
          {d.name}
        </Link>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${meta.badgeClass}`}
        >
          {meta.label}
        </span>
      </div>

      <p className="mt-1 truncate text-[11px] font-medium text-neutral-700">
        {d.supplier_name ?? d.supplier ?? "—"}
      </p>

      <dl className="mt-2 space-y-1 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-neutral-400">Expected</dt>
          <dd className="font-medium tabular-nums text-neutral-800">
            {d.schedule_date ? formatDate(d.schedule_date) : "—"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-neutral-400">Due</dt>
          <dd
            className={`font-medium tabular-nums ${
              d.urgency === "overdue" ? "text-danger-600" : "text-neutral-700"
            }`}
          >
            {formatDaysRemaining(d.daysRemaining)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-neutral-400">Value</dt>
          <dd className="font-semibold tabular-nums text-neutral-900">
            {formatCurrency(d.grand_total)}
          </dd>
        </div>
      </dl>

      {canCreate && (
        <Link
          to={`/p2p/grn/new?po=${encodeURIComponent(d.name)}`}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-primary-700"
        >
          <PackagePlus className="h-3.5 w-3.5" />
          Receive Goods
        </Link>
      )}
    </article>
  );
}
