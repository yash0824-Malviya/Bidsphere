import { memo } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

interface Props {
  data: number[];
  /** Stroke / fill colour. */
  color?: string;
  height?: number;
}

/**
 * Minimal, axis-less sparkline for KPI cards. Renders nothing when there is
 * no meaningful series (all zeros / empty) so cards stay clean.
 */
function Sparkline({ data, color = "#6366f1", height = 36 }: Props) {
  const hasSignal = data.some((v) => v !== 0);
  if (!hasSignal) return null;

  const points = data.map((value, index) => ({ index, value }));
  const gradientId = `spark-${color.replace("#", "")}`;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default memo(Sparkline);
