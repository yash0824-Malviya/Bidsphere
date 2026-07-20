import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Info,
  Minus,
} from "lucide-react";
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

function MetaGrid({ meta }: { meta: NonNullable<AnalyticsKpi["meta"]> }) {
  const dense = meta.length >= 4;
  return (
    <div
      className={
        dense
          ? "grid grid-cols-2 gap-x-3 gap-y-1.5"
          : "flex flex-col gap-1"
      }
    >
      {meta.map((m) => (
        <div key={m.label} className="min-w-0">
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-neutral-400">
            {m.label}
          </p>
          <p className="truncate text-xs font-semibold tabular-nums text-neutral-800">
            {m.value}
          </p>
        </div>
      ))}
    </div>
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
      <div className="card flex min-h-[132px] flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-4 w-10 rounded-full" />
        </div>
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
    );
  }

  const s = STATUS[kpi.status] ?? STATUS.neutral;
  const sparkline = kpi.sparkline ?? [];
  const waiting = !kpi.available;
  const subtitle =
    kpi.subtitle ||
    (waiting ? kpi.emptyMessage : null) ||
    (!kpi.meta?.length ? description : null);

  return (
    <div
      className={`card flex min-h-[132px] flex-col gap-2.5 p-4 transition-all duration-300 ease-out ${
        waiting ? "bg-slate-50/60" : "bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={`grid h-9 w-9 place-items-center rounded-lg transition-colors ${
            waiting ? "bg-sky-50" : s.iconBg
          }`}
        >
          {waiting ? (
            <Info className="h-5 w-5 text-sky-600" aria-hidden />
          ) : (
            <Icon className={`h-5 w-5 ${s.icon}`} />
          )}
        </div>
        {kpi.available ? <TrendBadge kpi={kpi} /> : null}
      </div>

      <div>
        <p className="text-xs font-medium text-neutral-500">{title}</p>
        {waiting ? (
          <p
            className="mt-1 text-2xl font-semibold tracking-tight text-neutral-300"
            aria-label="Value unavailable"
          >
            --
          </p>
        ) : (
          <p className="mt-0.5 text-2xl font-semibold tracking-tight text-neutral-900 transition-opacity duration-300">
            {kpi.display}
          </p>
        )}
        {subtitle ? (
          <p
            className={`mt-1 text-[11px] leading-snug ${
              waiting ? "font-medium text-sky-800/80" : "text-neutral-400"
            }`}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      {kpi.meta && kpi.meta.length > 0 ? (
        <MetaGrid meta={kpi.meta} />
      ) : (
        <p className="text-[11px] text-neutral-400">{description}</p>
      )}

      {waiting && kpi.footer ? (
        <div className="mt-auto flex items-start gap-1.5 rounded-lg border border-sky-100 bg-sky-50/80 px-2.5 py-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden />
          <p className="text-[11px] leading-snug text-sky-900/80">{kpi.footer}</p>
        </div>
      ) : kpi.available ? (
        typeof kpi.progress === "number" ? (
          <div className="mt-auto h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className={`h-full rounded-full transition-all ${s.bar}`}
              style={{ width: `${kpi.progress}%` }}
            />
          </div>
        ) : sparkline.some((n) => Number.isFinite(n) && n > 0) ? (
          <div className="mt-auto">
            <Sparkline
              data={sparkline.filter((n) => Number.isFinite(n) && n > 0)}
              color={s.spark}
            />
          </div>
        ) : kpi.footer ? (
          <p className="mt-auto text-[10px] leading-snug text-neutral-400">
            {kpi.footer}
          </p>
        ) : (
          <div className="mt-auto h-2" />
        )
      ) : (
        <div className="mt-auto h-2" />
      )}
    </div>
  );
}

export default memo(AnalyticsKpiCard);
