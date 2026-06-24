import { memo } from "react";
import { Link } from "react-router-dom";
import { Shield, Star, Users } from "lucide-react";

import { Skeleton } from "../Skeleton";
import type { SupplierInsightRow } from "../../utils/dashboardUtils";
import { formatCurrencyCompact } from "../../utils/paymentUtils";

interface Props {
  rows: SupplierInsightRow[];
  loading?: boolean;
}

function SupplierInsightsPanel({ rows, loading }: Props) {
  if (loading) {
    return <Skeleton className="h-[148px] w-full rounded-lg" />;
  }

  return (
    <div className="rounded-lg border border-neutral-200/80 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-primary-600" />
          <h3 className="text-xs font-semibold text-neutral-900">
            Supplier Insights
          </h3>
        </div>
        <Link
          to="/suppliers"
          className="text-[10px] font-medium text-primary-600 hover:underline"
        >
          View all
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-neutral-500">
          No supplier data yet
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.supplier}>
              <Link
                to={`/suppliers/${encodeURIComponent(row.supplier)}`}
                className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-neutral-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-neutral-900">
                    {row.supplier}
                  </p>
                  <p className="text-[10px] text-neutral-500">
                    {formatCurrencyCompact(row.spend)} · {row.invoiceCount} inv.
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    {row.performanceRating}/5
                  </span>
                  <span
                    className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      row.riskScore >= 60
                        ? "bg-red-50 text-red-600"
                        : row.riskScore >= 35
                          ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    <Shield className="h-3 w-3" />
                    {row.riskScore}
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

export default memo(SupplierInsightsPanel);
