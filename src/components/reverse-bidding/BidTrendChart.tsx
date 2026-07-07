import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingDown } from "lucide-react";

import type { BidTrendPoint } from "../../api/reverseBidding";
import { formatCurrencyIn } from "../../utils/format";

interface Props {
  data: BidTrendPoint[];
  /**
   * "percent" plots average reduction % per round (best for item-wise auctions
   * where absolute amounts mix items). "amount" plots the lowest bid per round.
   */
  mode: "percent" | "amount";
  currency?: string;
}

/** Price-reduction trend across auction rounds. */
export default function BidTrendChart({ data, mode, currency }: Props) {
  if (data.length < 2) return null;

  const isPercent = mode === "percent";
  const dataKey = isPercent ? "avgReductionPct" : "lowestBid";
  const label = isPercent
    ? "Avg Reduction per Round"
    : "Lowest Bid per Round";

  return (
    <div className="mb-4 rounded-xl border border-neutral-100 bg-neutral-50/40 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-neutral-600">
        <TrendingDown className="h-3.5 w-3.5 text-emerald-600" />
        Price Reduction Over Rounds
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 6, right: 14, bottom: 4, left: -6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis
            dataKey="round"
            tick={{ fontSize: 11 }}
            tickFormatter={(r) => `R${Number(r)}`}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            width={56}
            tickFormatter={(v) =>
              isPercent ? `${Number(v)}%` : formatCurrencyIn(Number(v), currency)
            }
          />
          <Tooltip
            formatter={(value) =>
              isPercent
                ? `${Number(value).toFixed(1)}%`
                : formatCurrencyIn(Number(value), currency)
            }
            labelFormatter={(l) => `Round ${l}`}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            name={label}
            stroke="#2563eb"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
