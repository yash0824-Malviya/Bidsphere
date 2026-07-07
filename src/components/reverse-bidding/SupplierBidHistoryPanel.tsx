import type { ReactNode } from "react";

import type { SupplierBidTrail } from "../../api/reverseBidding";
import { formatCurrencyIn, formatDateTime } from "../../utils/format";

interface Props {
  trail: SupplierBidTrail;
  currency?: string;
}

/**
 * Full negotiation trail for one supplier: opening quote, every recorded bid
 * (amount, timestamp, reduction), the final standing bid and total savings.
 * Rendered inside the expandable supplier row on the procurement view.
 */
export default function SupplierBidHistoryPanel({ trail, currency }: Props) {
  const {
    initialQuote,
    finalBid,
    bidCount,
    totalReductionAmount,
    totalReductionPct,
    rows,
    itemWise,
  } = trail;

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Initial Quotation">
          {initialQuote > 0 ? formatCurrencyIn(initialQuote, currency) : "—"}
        </Stat>
        <Stat label="Final Bid" tone="neutral-strong">
          {finalBid > 0 ? formatCurrencyIn(finalBid, currency) : "—"}
        </Stat>
        <Stat label="Total Reduction" tone="emerald">
          {totalReductionAmount > 0
            ? `${formatCurrencyIn(totalReductionAmount, currency)}${
                totalReductionPct > 0 ? ` (${totalReductionPct.toFixed(1)}%)` : ""
              }`
            : "—"}
        </Stat>
        <Stat label="Bids Placed">{bidCount}</Stat>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-neutral-500">
          This supplier has not placed any bids yet — only the opening
          quotation is on record.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-100 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                <th className="px-2 py-1.5 text-center">Round</th>
                <th className="px-2 py-1.5 text-left">Timestamp</th>
                {itemWise && <th className="px-2 py-1.5 text-left">Item</th>}
                <th className="px-2 py-1.5 text-right">Previous</th>
                <th className="px-2 py-1.5 text-right">Bid Amount</th>
                <th className="px-2 py-1.5 text-right">Reduction</th>
                <th className="px-2 py-1.5 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b, i) => {
                const pct =
                  b.reduction_pct ??
                  (b.previous > 0 ? (b.reduction / b.previous) * 100 : 0);
                return (
                  <tr
                    key={`${b.item_code ?? "all"}-${b.bid_time ?? ""}-${i}`}
                    className="border-t border-neutral-100"
                  >
                    <td className="px-2 py-1.5 text-center tabular-nums text-neutral-500">
                      {b.round_number ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-neutral-600">
                      {b.bid_time ? formatDateTime(b.bid_time) : "—"}
                    </td>
                    {itemWise && (
                      <td className="px-2 py-1.5 text-neutral-700">
                        {b.item_name ?? b.item_code ?? "—"}
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-right tabular-nums text-neutral-500">
                      {b.previous > 0
                        ? formatCurrencyIn(b.previous, currency)
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-neutral-900">
                      {formatCurrencyIn(b.bid_amount, currency)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-emerald-600">
                      {b.reduction > 0
                        ? formatCurrencyIn(b.reduction, currency)
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-emerald-500">
                      {pct > 0 ? `${pct.toFixed(1)}%` : "—"}
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

function Stat({
  label,
  children,
  tone = "neutral",
}: {
  label: string;
  children: ReactNode;
  tone?: "neutral" | "neutral-strong" | "emerald";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "neutral-strong"
        ? "text-neutral-900"
        : "text-neutral-700";
  return (
    <div className="rounded-lg border border-neutral-100 bg-white px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
        {label}
      </p>
      <p className={`mt-0.5 text-sm font-bold tabular-nums ${toneClass}`}>
        {children}
      </p>
    </div>
  );
}
