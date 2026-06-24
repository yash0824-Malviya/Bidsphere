import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Truck } from "lucide-react";

import { getIncomingPurchaseOrders } from "../../api/purchasing";
import { canCreateGRN } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import { Skeleton } from "../Skeleton";
import { formatCurrency, formatDate } from "../../utils/format";
import {
  buildUpcomingDeliveries,
  DELIVERY_URGENCY_META,
  formatDaysRemaining,
} from "../../utils/upcomingDeliveries";

/**
 * "Upcoming Deliveries" — approved POs still awaiting receipt, ordered by
 * nearest delivery date first. Enterprise WMS-style inbound visibility shown
 * above the GRN table.
 */
export default function UpcomingDeliveriesPanel() {
  // Only Warehouse (and Admin) may start a goods receipt. For Procurement /
  // Finance the PO number links to the read-only PO detail instead of the GRN
  // creation screen — they monitor receipts, they never create them.
  const role = useAuthStore((s) => s.user?.role);
  const canCreate = canCreateGRN(role);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["incoming-purchase-orders"],
    queryFn: getIncomingPurchaseOrders,
    staleTime: 60_000,
  });

  const deliveries = useMemo(() => buildUpcomingDeliveries(rows), [rows]);

  return (
    <section className="mb-6 card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-50 text-primary-600">
            <Truck className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Upcoming Deliveries
            </h2>
            <p className="text-xs text-neutral-500">
              Approved purchase orders awaiting goods receipt
            </p>
          </div>
        </div>
        {!isLoading && deliveries.length > 0 && (
          <span className="text-xs text-neutral-500">
            {deliveries.length} pending
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2 p-5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : deliveries.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-neutral-500">
          No open deliveries. All approved purchase orders have been received.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-2.5">PO Number</th>
                <th className="px-4 py-2.5">Supplier</th>
                <th className="px-4 py-2.5">Expected Delivery</th>
                <th className="px-4 py-2.5 text-right">Order Value</th>
                <th className="px-4 py-2.5">Days Remaining</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {deliveries.map((d) => {
                const meta = DELIVERY_URGENCY_META[d.urgency];
                return (
                  <tr key={d.name} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      <Link
                        to={
                          canCreate
                            ? `/p2p/grn/new?po=${encodeURIComponent(d.name)}`
                            : `/p2p/purchase-orders/${encodeURIComponent(
                                d.name
                              )}`
                        }
                        className="text-primary-600 hover:underline"
                      >
                        {d.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {d.supplier_name ?? d.supplier ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                      {d.schedule_date ? formatDate(d.schedule_date) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-neutral-900">
                      {formatCurrency(d.grand_total)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 tabular-nums ${
                        d.urgency === "overdue"
                          ? "font-semibold text-danger-600"
                          : "text-neutral-600"
                      }`}
                    >
                      {formatDaysRemaining(d.daysRemaining)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
