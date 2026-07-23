import { memo, useId, useMemo } from "react";

interface Props {
  data: number[];
  /** Stroke / fill colour. */
  color?: string;
  height?: number;
}

/**
 * Minimal, axis-less sparkline for KPI cards — pure SVG (no Recharts) so the
 * analytics KPI chunk paints without waiting on the charting library.
 */
function Sparkline({ data, color = "#22C55E", height = 28 }: Props) {
  const reactId = useId();
  const gradientId = `spark-${reactId.replace(/:/g, "")}`;

  const path = useMemo(() => {
    if (!data.some((v) => v !== 0)) return null;
    const w = 120;
    const h = height;
    const pad = 2;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const coords = data.map((value, index) => {
      const x =
        data.length <= 1
          ? w / 2
          : pad + (index / (data.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (value - min) / span) * (h - pad * 2);
      return { x, y };
    });
    const line = coords
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ");
    const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${h} L${coords[0].x.toFixed(1)},${h} Z`;
    return { line, area, w, h };
  }, [data, height]);

  if (!path) return null;

  return (
    <div style={{ height }} className="w-full">
      <svg
        viewBox={`0 0 ${path.w} ${path.h}`}
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={path.area} fill={`url(#${gradientId})`} />
        <path
          d={path.line}
          fill="none"
          stroke={color}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

export default memo(Sparkline);
