import { Eye, Scale, X } from "lucide-react";

import { formatCurrency } from "../../utils/format";

export interface ComparisonItem {
  item_code: string;
  item_name?: string;
  qty: number;
  uom?: string;
}

export interface ComparisonQuote {
  sqName: string;
  supplier: string;
  supplierName: string;
  total: number;
  paymentTerms?: string;
  notes?: string;
  byItem: Map<string, { unit_price: number; total: number; delivery_days: number }>;
}

/**
 * Side-by-side comparison of every submitted quotation for this RFQ — purely
 * a read-only view built from the same in-memory quotation data already
 * fetched for the "Suppliers Invited" list (no new API calls, no duplicate
 * quotation records). The lowest unit price per item is highlighted so
 * Procurement can scan for the best value at a glance.
 */
export default function CompareQuotationsModal({
  rfqName,
  items,
  quotes,
  onViewQuotation,
  onClose,
  /**
   * Mirrors the same RFQ-stage gate used by the "View Quotation" button on
   * the Suppliers Invited list (Supplier Selected / Purchase Order Created)
   * — this modal must never offer a second way to reach quotation detail
   * before that stage.
   */
  canViewQuotation = true,
}: {
  rfqName: string;
  items: ComparisonItem[];
  quotes: ComparisonQuote[];
  onViewQuotation: (sqName: string) => void;
  onClose: () => void;
  canViewQuotation?: boolean;
}) {
  const lowestUnitPriceByItem = new Map<string, number>();
  for (const it of items) {
    const prices = quotes
      .map((q) => q.byItem.get(it.item_code)?.unit_price ?? 0)
      .filter((p) => p > 0);
    if (prices.length > 0) lowestUnitPriceByItem.set(it.item_code, Math.min(...prices));
  }
  const lowestTotal =
    quotes.length > 0 ? Math.min(...quotes.map((q) => q.total).filter((t) => t > 0)) : 0;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <Scale className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-bold text-neutral-900">
                Compare Quotations
              </h2>
              <p className="text-xs text-neutral-500">
                RFQ {rfqName} · {quotes.length} submitted
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

        {quotes.length === 0 ? (
          <div className="p-10 text-center text-sm text-neutral-500">
            No supplier has submitted a quotation yet.
          </div>
        ) : (
          <div className="overflow-x-auto p-5">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Item
                  </th>
                  {quotes.map((q) => (
                    <th
                      key={q.sqName || q.supplier}
                      className="min-w-[160px] border-b border-neutral-200 px-4 py-3 text-left"
                    >
                      <p className="truncate text-sm font-semibold text-neutral-900">
                        {q.supplierName}
                      </p>
                      {canViewQuotation && (
                        <button
                          type="button"
                          onClick={() => onViewQuotation(q.sqName)}
                          disabled={!q.sqName}
                          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline disabled:cursor-not-allowed disabled:text-neutral-400 disabled:no-underline"
                        >
                          <Eye className="h-3 w-3" />
                          View Quotation
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const lowest = lowestUnitPriceByItem.get(it.item_code) ?? 0;
                  return (
                    <tr key={it.item_code}>
                      <td className="sticky left-0 z-10 border-b border-neutral-100 bg-white px-4 py-3 align-top">
                        <p className="font-medium text-neutral-900">
                          {it.item_name ?? it.item_code}
                        </p>
                        <p className="text-xs text-neutral-500">
                          Qty {it.qty} {it.uom ?? "Nos"}
                        </p>
                      </td>
                      {quotes.map((q) => {
                        const cell = q.byItem.get(it.item_code);
                        const isLowest =
                          !!cell && cell.unit_price > 0 && cell.unit_price === lowest;
                        return (
                          <td
                            key={q.sqName || q.supplier}
                            className={`border-b border-neutral-100 px-4 py-3 align-top tabular-nums ${
                              isLowest
                                ? "bg-success-50 font-semibold text-success-700"
                                : "text-neutral-700"
                            }`}
                          >
                            {cell && cell.unit_price > 0 ? (
                              <>
                                {formatCurrency(cell.unit_price)}
                                <span className="ml-1 text-xs text-neutral-400">
                                  /unit
                                </span>
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}

                {/* Summary rows */}
                <tr className="bg-neutral-50">
                  <td className="sticky left-0 z-10 bg-neutral-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Grand Total
                  </td>
                  {quotes.map((q) => (
                    <td
                      key={q.sqName || q.supplier}
                      className={`px-4 py-3 font-bold tabular-nums ${
                        q.total > 0 && q.total === lowestTotal
                          ? "text-success-700"
                          : "text-neutral-900"
                      }`}
                    >
                      {formatCurrency(q.total)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="sticky left-0 z-10 bg-white px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Delivery Time
                  </td>
                  {quotes.map((q) => {
                    const days = [...q.byItem.values()].find((v) => v.delivery_days)
                      ?.delivery_days;
                    return (
                      <td key={q.sqName || q.supplier} className="px-4 py-3 text-neutral-700">
                        {days ? `${days} days` : "—"}
                      </td>
                    );
                  })}
                </tr>
                <tr className="bg-neutral-50">
                  <td className="sticky left-0 z-10 bg-neutral-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Payment Terms
                  </td>
                  {quotes.map((q) => (
                    <td key={q.sqName || q.supplier} className="px-4 py-3 text-neutral-700">
                      {q.paymentTerms || "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="sticky left-0 z-10 bg-white px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Notes
                  </td>
                  {quotes.map((q) => (
                    <td
                      key={q.sqName || q.supplier}
                      className="max-w-[220px] px-4 py-3 text-xs text-neutral-600"
                    >
                      {q.notes || "—"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
