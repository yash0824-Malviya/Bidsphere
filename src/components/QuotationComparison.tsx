import { useMemo } from "react";
import { Trophy } from "lucide-react";

import type { RFQItem } from "../types/erpnext";
import { formatCurrency } from "../utils/format";

/** A single quotation cell — one row × one column in the comparison table. */
export interface QuotationCell {
  unit_price: number;
  total: number;
  delivery_days?: number;
}

/**
 * One full quotation from a single supplier. `byItem` is keyed on
 * `item_code` so we can render rows in the order they appear on the RFQ
 * regardless of how the supplier ordered their reply.
 */
export interface ComparisonQuote {
  supplier: string;
  supplier_name: string;
  total: number;
  byItem: Map<string, QuotationCell>;
}

interface Props {
  rfqItems: RFQItem[];
  quotes: ComparisonQuote[];
  /** Optional title rendered as the table caption. Defaults to "Quotation Comparison". */
  title?: string;
}

/**
 * Side-by-side comparison of supplier quotations against the items on a
 * single RFQ. Lowest unit price per row is highlighted green with a
 * "✓ LOWEST" badge, the highest is muted red, and the lowest grand total
 * column gets a green header cell with a 🏆 trophy icon.
 *
 * Pure presentational component — fetch the data upstream and pass it in.
 */
export default function QuotationComparison({
  rfqItems,
  quotes,
  title = "Quotation Comparison",
}: Props) {
  const lowestTotal = useMemo(() => {
    if (quotes.length === 0) return null;
    const totals = quotes.map((q) => q.total).filter((t) => t > 0);
    return totals.length ? Math.min(...totals) : null;
  }, [quotes]);

  const highestTotal = useMemo(() => {
    if (quotes.length === 0) return null;
    const totals = quotes.map((q) => q.total).filter((t) => t > 0);
    return totals.length ? Math.max(...totals) : null;
  }, [quotes]);

  // Only dim the "loser" column when the spread is meaningful — if the
  // highest equals the lowest there's nothing to highlight either way.
  const totalSpread =
    lowestTotal !== null &&
    highestTotal !== null &&
    quotes.length > 1 &&
    lowestTotal !== highestTotal;

  if (quotes.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden card">
      <div className="border-b border-neutral-200 px-5 py-3">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <p className="text-xs text-neutral-500">
          Lowest price per item is highlighted green; highest is muted red.
          The lowest grand total wins the column header.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-4 py-3 align-bottom">Item</th>
              {quotes.map((q) => {
                const isWinner = totalSpread && q.total === lowestTotal;
                const isLoser = totalSpread && q.total === highestTotal;
                return (
                  <th
                    key={q.supplier_name}
                    className={`px-4 py-3 text-center align-bottom ${
                      isWinner
                        ? "bg-accent-600 text-white"
                        : isLoser
                        ? "bg-danger-50 text-neutral-500"
                        : "text-neutral-600"
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      {isWinner && (
                        <Trophy
                          className="h-3.5 w-3.5 text-white"
                          aria-label="Best price"
                        />
                      )}
                      <span className="text-sm font-semibold">
                        {q.supplier_name}
                      </span>
                    </div>
                    {isWinner && (
                      <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-white/90">
                        🏆 Best Price
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-neutral-200">
            {rfqItems.map((it) => {
              const cells = quotes.map((q) => q.byItem.get(it.item_code));
              const validPrices = cells
                .map((c) => c?.unit_price ?? 0)
                .filter((p) => p > 0);

              const lowest = validPrices.length
                ? Math.min(...validPrices)
                : null;
              const highest = validPrices.length
                ? Math.max(...validPrices)
                : null;
              const hasSpread =
                validPrices.length > 1 && lowest !== null && lowest !== highest;

              return (
                <tr key={it.item_code}>
                  <td className="px-4 py-3 align-top">
                    <p className="font-medium text-neutral-900">
                      {it.item_name ?? it.item_code}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {it.qty} {it.uom ?? "Nos"} requested
                    </p>
                  </td>

                  {quotes.map((q, idx) => {
                    const cell = cells[idx];
                    if (!cell || cell.unit_price <= 0) {
                      return (
                        <td
                          key={q.supplier_name}
                          className="px-4 py-3 text-center text-xs text-neutral-400"
                        >
                          —
                        </td>
                      );
                    }

                    const isLowest =
                      hasSpread && cell.unit_price === lowest;
                    const isHighest =
                      hasSpread && cell.unit_price === highest;

                    const cellClass = isLowest
                      ? "bg-accent-50 text-accent-800 font-semibold"
                      : isHighest
                      ? "bg-danger-50/60 text-neutral-400"
                      : "";

                    return (
                      <td
                        key={q.supplier_name}
                        className={`px-4 py-3 text-center align-top tabular-nums ${cellClass}`}
                      >
                        <div className="text-sm">
                          {formatCurrency(cell.unit_price)} × {it.qty} ={" "}
                          <span className="font-semibold">
                            {formatCurrency(cell.total)}
                          </span>
                        </div>
                        {cell.delivery_days !== undefined &&
                          cell.delivery_days > 0 && (
                            <div className="mt-0.5 text-[11px] text-neutral-500">
                              {cell.delivery_days} day
                              {cell.delivery_days === 1 ? "" : "s"} delivery
                            </div>
                          )}
                        {isLowest && (
                          <div className="mt-1 inline-flex items-center gap-0.5 rounded-full bg-accent-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            ✓ Lowest
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>

          <tfoot className="bg-neutral-50">
            <tr>
              <td className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-600">
                🏆 Grand Total
              </td>
              {quotes.map((q) => {
                const isWinner = totalSpread && q.total === lowestTotal;
                const isLoser = totalSpread && q.total === highestTotal;
                return (
                  <td
                    key={q.supplier_name}
                    className={`px-4 py-3 text-center text-sm tabular-nums ${
                      isWinner
                        ? "bg-accent-100 font-extrabold text-accent-800"
                        : isLoser
                        ? "bg-danger-50/80 font-medium text-neutral-500"
                        : "font-semibold text-neutral-900"
                    }`}
                  >
                    {formatCurrency(q.total)}
                    {isWinner && (
                      <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-accent-700">
                        <Trophy className="h-3 w-3" />
                        Lowest
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
