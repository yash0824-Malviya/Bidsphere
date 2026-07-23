import { memo } from "react";
import { Link } from "react-router-dom";

import { Skeleton } from "../Skeleton";
import type { TopSupplierTrendRow } from "../../utils/dashboardUtils";
import { formatCurrencyCompact } from "../../utils/paymentUtils";

interface Props {
  rows: TopSupplierTrendRow[];
  loading?: boolean;
}

function statusLabel(risk: TopSupplierTrendRow["riskLevel"]): {
  label: string;
  className: string;
} {
  if (risk === "high") {
    return { label: "At Risk", className: "bg-rose-50 text-rose-700" };
  }
  if (risk === "medium") {
    return { label: "Watch", className: "bg-amber-50 text-amber-700" };
  }
  return { label: "Active", className: "bg-emerald-50 text-emerald-700" };
}

const PANEL_SHELL =
  "rounded-2xl border border-[#E8EDF5] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]";

function TopSuppliersPanel({ rows, loading }: Props) {
  if (loading) {
    return <Skeleton className={`min-h-[280px] w-full ${PANEL_SHELL}`} />;
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden ${PANEL_SHELL}`}>
      <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
        <h3 className="text-[14px] font-semibold leading-tight text-[#111827]">
          Top Suppliers
        </h3>
        <Link
          to="/suppliers"
          className="text-[12px] font-medium text-primary-600 no-underline hover:text-primary-700"
        >
          View all
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-[#64748B]">
          No supplier spend recorded yet.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto px-1 pb-2">
          <table className="data-table">
            <thead>
              <tr>
                <th className="!px-3 !py-2">Supplier</th>
                <th className="!px-3 !py-2">Spend</th>
                <th className="!px-3 !py-2">RFQs</th>
                <th className="!px-3 !py-2">Performance Score</th>
                <th className="!px-3 !py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = statusLabel(row.riskLevel);
                return (
                  <tr key={row.supplier} className="!h-10">
                    <td className="!px-3 !py-1.5">
                      <Link
                        to={`/suppliers/${encodeURIComponent(row.supplier)}`}
                        className="table-link text-[13px]"
                      >
                        {row.supplier}
                      </Link>
                    </td>
                    <td className="!px-3 !py-1.5 tabular-nums text-[13px]">
                      {formatCurrencyCompact(row.spend)}
                    </td>
                    <td className="!px-3 !py-1.5 tabular-nums text-[13px] text-neutral-600">
                      {row.orders}
                    </td>
                    <td className="!px-3 !py-1.5 tabular-nums text-[13px] font-semibold text-neutral-800">
                      {row.performanceScore}
                    </td>
                    <td className="!px-3 !py-1.5">
                      <span className={`status-badge ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default memo(TopSuppliersPanel);
