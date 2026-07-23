/**
 * Procurement — side-by-side Cost Breakdown comparison across suppliers.
 * Future hooks: AI Cost Analysis / trends can consume the same comparison DTO.
 */

import { useQuery } from "@tanstack/react-query";
import { Calculator, Loader2, X } from "lucide-react";

import { getCostBreakdownComparison } from "../../api/costBreakdown";
import { formatCurrency } from "../../utils/format";

export default function CostBreakdownComparisonModal({
  rfqName,
  onClose,
}: {
  rfqName: string;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["cost-breakdown-comparison", rfqName],
    queryFn: () => getCostBreakdownComparison(rfqName),
    enabled: !!rfqName,
  });

  const data = query.data;
  const suppliers = data?.suppliers ?? [];
  const costHeads = data?.cost_heads ?? [];
  const amounts = data?.amounts ?? {};

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <Calculator className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-bold text-neutral-900">
                Cost Breakdown Comparison
              </h2>
              <p className="text-xs text-neutral-500">
                RFQ {rfqName} · by cost head across suppliers
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {query.isLoading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading cost breakdowns…
            </div>
          )}

          {query.isError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {query.error instanceof Error
                ? query.error.message
                : "Failed to load comparison."}
            </div>
          )}

          {data && suppliers.length === 0 && (
            <div className="py-12 text-center text-sm text-neutral-500">
              No suppliers found for this RFQ.
            </div>
          )}

          {data && suppliers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Cost Head
                    </th>
                    {suppliers.map((s) => (
                      <th
                        key={s.supplier}
                        className="min-w-[140px] border-b border-neutral-200 px-4 py-3 text-left"
                      >
                        <p className="truncate text-sm font-semibold text-neutral-900">
                          {s.supplier_name}
                        </p>
                        <p className="text-[10px] text-neutral-400">
                          {s.supplier_quotation || "No quotation"}
                        </p>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {costHeads.map((head) => (
                    <tr key={head}>
                      <td className="sticky left-0 z-10 border-b border-neutral-100 bg-white px-4 py-2.5 font-medium text-neutral-800">
                        {head}
                      </td>
                      {suppliers.map((s) => {
                        const amt = amounts[head]?.[s.supplier] ?? 0;
                        return (
                          <td
                            key={s.supplier}
                            className="border-b border-neutral-100 px-4 py-2.5 tabular-nums text-neutral-700"
                          >
                            {amt > 0 ? formatCurrency(amt) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="bg-neutral-50">
                    <td className="sticky left-0 z-10 bg-neutral-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Grand Total
                    </td>
                    {suppliers.map((s) => (
                      <td
                        key={s.supplier}
                        className="px-4 py-3 font-bold tabular-nums text-neutral-900"
                      >
                        {s.grand_total > 0
                          ? formatCurrency(s.grand_total)
                          : "—"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
