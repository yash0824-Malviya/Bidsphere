import { memo } from "react";
import { Link } from "react-router-dom";
import { ShoppingCart } from "lucide-react";

import type { DashboardPoLite } from "../../api/dashboard";
import { Skeleton } from "../Skeleton";
import { StatusBadge } from "../ui";
import { formatCurrency, formatDate } from "../../utils/format";

interface Props {
  orders: DashboardPoLite[];
  loading?: boolean;
}

function RecentPOTable({ orders, loading }: Props) {
  if (loading) {
    return <Skeleton className="h-[200px] w-full rounded-lg" />;
  }

  const rows = orders.slice(0, 8);

  return (
    <div className="flex h-[200px] flex-col rounded-lg border border-neutral-200/80 bg-white shadow-sm">
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <ShoppingCart className="h-3.5 w-3.5 text-primary-600" />
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            Recent Purchase Orders
          </h3>
        </div>
        <Link
          to="/p2p/purchase-orders"
          className="text-[10px] font-medium text-primary-600 hover:underline"
        >
          View all
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-neutral-50/95">
            <tr className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400">
              <th className="px-3 py-1.5 font-semibold">PO Number</th>
              <th className="px-2 py-1.5 font-semibold">Supplier</th>
              <th className="px-2 py-1.5 font-semibold">Amount</th>
              <th className="px-2 py-1.5 font-semibold">Status</th>
              <th className="px-3 py-1.5 font-semibold">Expected</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-xs text-neutral-500"
                >
                  No purchase orders yet
                </td>
              </tr>
            ) : (
              rows.map((po) => (
                <tr key={po.name} className="hover:bg-neutral-50/80">
                  <td className="px-3 py-1.5">
                    <Link
                      to={`/p2p/purchase-orders/${encodeURIComponent(po.name)}`}
                      className="text-[11px] font-medium text-primary-600 hover:underline"
                    >
                      {po.name}
                    </Link>
                  </td>
                  <td className="max-w-[120px] truncate px-2 py-1.5 text-[11px] text-neutral-700">
                    {po.supplier ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-[11px] font-semibold tabular-nums text-neutral-900">
                    {po.grand_total != null
                      ? formatCurrency(po.grand_total)
                      : "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    {po.status ? (
                      <StatusBadge status={po.status} />
                    ) : (
                      <span className="text-[10px] text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-[10px] text-neutral-500">
                    {po.schedule_date
                      ? formatDate(po.schedule_date, "MMM d, yyyy")
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default memo(RecentPOTable);
