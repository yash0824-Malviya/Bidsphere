import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrency } from "../../utils/format";
import { REPORT_AXIS } from "./ReportChartCard";

export type SupplierDistRow = {
  name: string;
  value: number;
  count: number;
};

export type SupplierChartRow = {
  /** Truncated label for the axis. */
  label: string;
  /** Full supplier name (or Others description) for tooltips. */
  fullName: string;
  count: number;
  value: number;
  isOthers?: boolean;
};

const NAME_MAX = 22;
const BAR_COLOR = "#0F6CBD";
const OTHERS_COLOR = "#94A3B8";

function truncateName(name: string, max = NAME_MAX): string {
  const trimmed = name.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Top N suppliers by PO count (tie-break: total value), with remainder as Others.
 */
export function buildTopSupplierChartData(
  rows: SupplierDistRow[],
  topN = 5,
): SupplierChartRow[] {
  const sorted = [...rows].sort(
    (a, b) => b.count - a.count || b.value - a.value,
  );
  if (sorted.length === 0) return [];

  if (sorted.length <= topN) {
    return sorted.map((r) => ({
      label: truncateName(r.name),
      fullName: r.name,
      count: r.count,
      value: r.value,
    }));
  }

  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const othersCount = rest.reduce((s, r) => s + r.count, 0);
  const othersValue = rest.reduce((s, r) => s + r.value, 0);

  return [
    ...top.map((r) => ({
      label: truncateName(r.name),
      fullName: r.name,
      count: r.count,
      value: r.value,
    })),
    {
      label: "Others",
      fullName: `Others (${rest.length} suppliers)`,
      count: othersCount,
      value: othersValue,
      isOthers: true,
    },
  ];
}

function integerTicks(maxValue: number): number[] {
  const max = Math.max(1, Math.ceil(maxValue));
  if (max <= 5) {
    return Array.from({ length: max + 1 }, (_, i) => i);
  }
  const step = Math.max(1, Math.ceil(max / 4));
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return ticks;
}

type TooltipPayload = {
  payload?: SupplierChartRow;
};

function SupplierTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 shadow-[0_4px_14px_rgba(15,23,42,0.08)]">
      <p className="max-w-[240px] text-[12px] font-semibold text-[#0F172A]">
        {row.fullName}
      </p>
      <p className="mt-1 text-[11px] text-[#64748B]">
        PO Count:{" "}
        <span className="font-semibold tabular-nums text-[#0F172A]">
          {row.count}
        </span>
      </p>
      <p className="text-[11px] text-[#64748B]">
        Total Value:{" "}
        <span className="font-semibold tabular-nums text-[#0F172A]">
          {formatCurrency(row.value)}
        </span>
      </p>
    </div>
  );
}

interface Props {
  data: SupplierChartRow[];
}

export default function SupplierDistributionChart({ data }: Props) {
  const maxCount = data.reduce((m, r) => Math.max(m, r.count), 0);
  const ticks = integerTicks(maxCount);
  // Leave headroom so end-of-bar labels are not clipped.
  const domainMax = Math.max(ticks[ticks.length - 1] ?? 1, maxCount) + 0.35;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 36, left: 4, bottom: 4 }}
        barCategoryGap="28%"
        barSize={16}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#EEF2F7"
          horizontal={false}
        />
        <XAxis
          type="number"
          domain={[0, domainMax]}
          ticks={ticks}
          allowDecimals={false}
          tickFormatter={(v) => String(Math.round(Number(v)))}
          {...REPORT_AXIS}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={128}
          interval={0}
          tick={{
            fontSize: 11,
            fill: "#475569",
            fontWeight: 500,
          }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(15, 108, 189, 0.06)" }}
          content={<SupplierTooltip />}
        />
        <Bar dataKey="count" name="PO Count" radius={[0, 4, 4, 0]}>
          {data.map((row) => (
            <Cell
              key={row.fullName}
              fill={row.isOthers ? OTHERS_COLOR : BAR_COLOR}
            />
          ))}
          <LabelList
            dataKey="count"
            position="right"
            formatter={(v: number) => String(Math.round(Number(v) || 0))}
            style={{
              fill: "#334155",
              fontSize: 11,
              fontWeight: 600,
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
