import { memo } from "react";
import {
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import { Skeleton } from "../Skeleton";
import type { ProcurementHealthScoreData } from "../../utils/dashboardUtils";

interface Props {
  data: ProcurementHealthScoreData | null;
  loading?: boolean;
}

function ProcurementHealthScore({ data, loading }: Props) {
  if (loading || !data) {
    return <Skeleton className="h-[188px] w-full rounded-lg" />;
  }

  const radialData = [{ name: "Score", value: data.score, fill: "#0ea5e9" }];

  return (
    <div className="flex h-[188px] rounded-lg border border-neutral-200/80 bg-white shadow-sm">
      <div className="relative w-[38%] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius="58%"
            outerRadius="88%"
            barSize={10}
            data={radialData}
            startAngle={90}
            endAngle={-270}
          >
            <RadialBar
              background={{ fill: "#f1f5f9" }}
              dataKey="value"
              cornerRadius={6}
            />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 6 }}
              formatter={(v) => [`${v}/100`, "Health"]}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums text-primary">
            {data.score}
          </span>
          <span className="text-[9px] font-medium uppercase tracking-wider text-neutral-400">
            / 100
          </span>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 border-l border-neutral-100 px-2.5 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Procurement Health
        </p>
        {data.metrics.map((m) => (
          <div key={m.label} className="flex items-center gap-1.5">
            <span className="w-[72px] shrink-0 truncate text-[9px] text-neutral-600">
              {m.label}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${m.score}%` }}
              />
            </div>
            <span className="w-5 shrink-0 text-right text-[9px] font-semibold tabular-nums text-neutral-700">
              {m.score}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(ProcurementHealthScore);
