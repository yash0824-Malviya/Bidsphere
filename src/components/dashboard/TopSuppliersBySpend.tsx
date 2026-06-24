import { Link } from "react-router-dom";
import { Users } from "lucide-react";

import { Skeleton } from "../Skeleton";
import type { TopSupplierRow } from "../../utils/dashboardUtils";
import { formatCurrencyCompact } from "../../utils/paymentUtils";

interface Props {
  rows: TopSupplierRow[];
  currency: string;
  loading?: boolean;
}

export default function TopSuppliersBySpend({
  rows,
  loading,
}: Props) {
  if (loading) {
    return <Skeleton className="h-80 w-full rounded-card" />;
  }

  const maxSpend = rows[0]?.spend ?? 1;

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">
              Top Suppliers by Spend
            </h3>
            <p className="text-xs text-neutral-500">
              Trailing 12 months — purchase invoice totals
            </p>
          </div>
        </div>
        <Link
          to="/suppliers"
          className="text-xs font-medium text-primary hover:underline"
        >
          View all →
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">
          No supplier spend recorded yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row, idx) => (
            <li key={row.supplier}>
              <Link
                to={`/suppliers/${encodeURIComponent(row.supplier)}`}
                className="block rounded-lg border border-transparent p-2 transition-colors hover:border-primary-100 hover:bg-primary-50/20"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[10px] font-bold text-neutral-400">
                      {idx + 1}
                    </span>
                    <span className="truncate text-sm font-medium text-neutral-900">
                      {row.supplier}
                    </span>
                  </div>
                  <span className="flex-shrink-0 text-sm font-semibold tabular-nums text-neutral-800">
                    {formatCurrencyCompact(row.spend)}
                  </span>
                </div>
                <div className="flex items-center gap-2 pl-7">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${Math.max(4, (row.spend / maxSpend) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="flex-shrink-0 text-[11px] tabular-nums text-neutral-500">
                    {row.pct.toFixed(0)}% · {row.invoiceCount} inv.
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
