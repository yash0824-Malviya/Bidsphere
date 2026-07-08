import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { AnalyticsKpi, KpiStatus } from "../../../api/procurementAnalytics";
import { Skeleton } from "../../Skeleton";
import Sparkline from "./Sparkline";

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  kpi: AnalyticsKpi | null;
  loading?: boolean;
}

const STATUS: Record<
  KpiStatus,
  { iconBg: string; icon: string; bar: string; spark: string }
> = {
  good: {
    iconBg: "bg-emerald-50",
    icon: "text-emerald-600",
    bar: "bg-emerald-500",
    spark: "#10b981",
  },
  warning: {
    iconBg: "bg-amber-50",
    icon: "text-amber-600",
    bar: "bg-amber-500",
    spark: "#f59e0b",
  },
  bad: {
    iconBg: "bg-rose-50",
    icon: "text-rose-600",
    bar: "bg-rose-500",
    spark: "#ef4444",
  },
  neutral: {
    iconBg: "bg-neutral-100",
    icon: "text-neutral-500",
    bar: "bg-neutral-400",
    spark: "#94a3b8",
  },
};

function TrendBadge({ kpi }: { kpi: AnalyticsKpi }) {
  const t = kpi.trend;
  if (!t) return null;
  // "Good" direction depends on whether the metric is inverted (lower = better).
  const isPositive = t.inverted ? t.direction === "down" : t.direction === "up";
  const isFlat = t.direction === "flat";
  const Icon = isFlat
    ? Minus
    : t.direction === "up"
      ? ArrowUpRight
      : ArrowDownRight;
  const tone = isFlat
    ? "bg-neutral-100 text-neutral-500"
    : isPositive
      ? "bg-emerald-50 text-emerald-700"
      : "bg-rose-50 text-rose-700";
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}
      title={t.label}
    >
      <Icon className="h-3 w-3" />
      {t.pct}%
    </span>
  );
}

function AnalyticsKpiCard({
  icon: Icon,
  title,
  description,
  kpi,
  loading,
}: Props) {
  if (loading || !kpi) {
    return (
      <div className="card flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-4 w-10 rounded-full" />
        </div>
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  const s = STATUS[kpi.status];

  return (
    <div className="card flex flex-col gap-2.5 p-4">
      <div className="flex items-start justify-between">
        <div className={`grid h-9 w-9 place-items-center rounded-lg ${s.iconBg}`}>
          <Icon className={`h-5 w-5 ${s.icon}`} />
        </div>
        {kpi.available ? <TrendBadge kpi={kpi} /> : null}
      </div>

      <div>
        <p className="text-xs font-medium text-neutral-500">{title}</p>
        {kpi.available ? (
          <p className="mt-0.5 text-2xl font-semibold tracking-tight text-neutral-900">
            {kpi.display}
          </p>
        ) : (
          <p className="mt-0.5 text-sm font-medium text-neutral-400">
            {kpi.emptyMessage ?? "No data available"}
          </p>
        )}
      </div>

      {kpi.available ? (
        <>
          {kpi.meta && kpi.meta.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
              {kpi.meta.map((m) => (
                <span key={m.label}>
                  {m.label}:{" "}
                  <span className="font-semibold text-neutral-700">
                    {m.value}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-neutral-400">{description}</p>
          )}

          {typeof kpi.progress === "number" ? (
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className={`h-full rounded-full transition-all ${s.bar}`}
                style={{ width: `${kpi.progress}%` }}
              />
            </div>
          ) : kpi.sparkline.length > 0 ? (
            <Sparkline data={kpi.sparkline} color={s.spark} />
          ) : (
            <div className="h-9" />
          )}
        </>
      ) : (
        <p className="text-[11px] text-neutral-400">{description}</p>
      )}
    </div>
  );
}

export default memo(AnalyticsKpiCard);
