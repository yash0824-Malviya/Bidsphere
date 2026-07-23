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
  compact?: boolean;
  variant?: "default" | "enterprise";
  accent?: "blue" | "green" | "orange" | "red" | "gray";
}

const ACCENT = {
  blue: { bg: "bg-[#E8F4FF]", fg: "text-[#1993FF]", bar: "bg-[#1993FF]", spark: "#1993FF" },
  green: { bg: "bg-[#DCFCE7]", fg: "text-[#22C55E]", bar: "bg-[#22C55E]", spark: "#22C55E" },
  orange: { bg: "bg-[#FEF3C7]", fg: "text-[#F59E0B]", bar: "bg-[#F59E0B]", spark: "#F59E0B" },
  red: { bg: "bg-[#FEE2E2]", fg: "text-[#EF4444]", bar: "bg-[#EF4444]", spark: "#EF4444" },
  gray: { bg: "bg-[#F3F4F6]", fg: "text-[#6B7280]", bar: "bg-[#6B7280]", spark: "#6B7280" },
} as const;

const STATUS: Record<
  KpiStatus,
  { iconBg: string; icon: string; bar: string; spark: string }
> = {
  good: {
    iconBg: "bg-emerald-50",
    icon: "text-emerald-600",
    bar: "bg-[#22C55E]",
    spark: "#22C55E",
  },
  warning: {
    iconBg: "bg-amber-50",
    icon: "text-amber-600",
    bar: "bg-[#F59E0B]",
    spark: "#F59E0B",
  },
  bad: {
    iconBg: "bg-rose-50",
    icon: "text-rose-600",
    bar: "bg-[#EF4444]",
    spark: "#EF4444",
  },
  neutral: {
    iconBg: "bg-neutral-100",
    icon: "text-neutral-500",
    bar: "bg-[#6B7280]",
    spark: "#6B7280",
  },
};

const CARD_SHELL =
  "rounded-2xl border border-[#E8EDF5] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.07)]";

function ProgressTrack({
  pct,
  barClass,
}: {
  pct: number;
  barClass: string;
}) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-[#EEF2F7]">
      <div
        className={`h-full rounded-full transition-all duration-200 ${barClass}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

function enterpriseSupport(
  title: string,
  kpi: AnalyticsKpi,
): { text: string; tone: string } | null {
  if (/savings/i.test(title)) {
    const savings = kpi.meta?.find((m) => /savings/i.test(m.label));
    if (savings?.value) {
      const raw = savings.value.replace(/%/g, "").trim();
      const n = Number(raw);
      if (Number.isFinite(n) && n !== 0) {
        return {
          text: `${n > 0 ? "+" : ""}${n.toFixed(1)}%`,
          tone: n >= 0 ? "text-[#22C55E]" : "text-[#EF4444]",
        };
      }
    }
    if (kpi.trend && kpi.trend.pct !== 0) {
      const sign = kpi.trend.direction === "down" ? "-" : "+";
      return {
        text: `${sign}${kpi.trend.pct}%`,
        tone:
          kpi.trend.direction === "up"
            ? "text-[#22C55E]"
            : kpi.trend.direction === "down"
              ? "text-[#EF4444]"
              : "text-[#64748B]",
      };
    }
  }

  if (/budget/i.test(title)) {
    const remaining = kpi.meta?.find((m) => /remaining/i.test(m.label));
    if (remaining) return { text: `${remaining.label} ${remaining.value}`, tone: "text-[#64748B]" };
  }

  if (/response/i.test(title)) {
    const responded = kpi.meta?.find((m) => /responded/i.test(m.label));
    const invited = kpi.meta?.find((m) => /invited/i.test(m.label));
    if (responded && invited) {
      return {
        text: `${responded.value} of ${invited.value} responded`,
        tone: "text-[#64748B]",
      };
    }
  }

  if (/delivery/i.test(title)) {
    const onTime = kpi.meta?.find((m) => /on time/i.test(m.label));
    const received = kpi.meta?.find((m) => /received/i.test(m.label));
    if (onTime && received) {
      return {
        text: `${onTime.value} of ${received.value} on time`,
        tone: "text-[#64748B]",
      };
    }
  }

  if (/turnaround/i.test(title)) {
    const completed = kpi.meta?.find((m) => /completed/i.test(m.label));
    if (completed) {
      return { text: `${completed.value} completed`, tone: "text-[#64748B]" };
    }
    return { text: "Average turnaround", tone: "text-[#64748B]" };
  }

  if (/cycle/i.test(title)) {
    const completed = kpi.meta?.find((m) => /completed/i.test(m.label));
    if (completed) {
      return { text: `${completed.value} completed`, tone: "text-[#64748B]" };
    }
    return { text: "Average cycle", tone: "text-[#64748B]" };
  }

  return null;
}

function TrendLine({ kpi }: { kpi: AnalyticsKpi }) {
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
    ? "text-[#6B7280]"
    : isPositive
      ? "text-[#22C55E]"
      : "text-[#EF4444]";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[12px] font-medium ${tone}`}>
      <Icon className="h-3 w-3" />
      {`${t.direction === "up" ? "+" : t.direction === "down" ? "-" : ""}${t.pct}%`}
    </span>
  );
}

function AnalyticsKpiCard({
  icon: Icon,
  title,
  description,
  kpi,
  loading,
  compact = false,
  variant = "default",
  accent = "blue",
}: Props) {
  const enterprise = variant === "enterprise";
  const showProgressBar = /budget|response|delivery/i.test(title);

  if (loading || !kpi) {
    return (
      <div
        className={`flex flex-col gap-2 ${CARD_SHELL} p-4 ${
          enterprise ? "h-[148px]" : "min-h-[120px]"
        }`}
      >
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-7 w-16" />
      </div>
    );
  }

  const s = STATUS[kpi.status] ?? STATUS.neutral;
  const a = ACCENT[accent];
  const sparkline = kpi.sparkline ?? [];
  const waiting = !kpi.available;
  const hasProgress = typeof kpi.progress === "number";
  const hasSpark = sparkline.some((n) => Number.isFinite(n) && n > 0);

  if (enterprise) {
    const support = waiting
      ? { text: "No data", tone: "text-[#94A3B8]" }
      : enterpriseSupport(title, kpi);

    return (
      <div className={`flex h-[148px] flex-col ${CARD_SHELL} p-4`}>
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              waiting ? ACCENT.gray.bg : a.bg
            }`}
          >
            {waiting ? (
              <Info className={`h-4 w-4 ${ACCENT.gray.fg}`} aria-hidden />
            ) : (
              <Icon className={`h-4 w-4 ${a.fg}`} />
            )}
          </span>
          <p className="text-[13px] font-semibold leading-snug text-[#111827]">
            {title}
          </p>
        </div>

        <div className="mt-auto">
          <p
            className={`text-[24px] font-bold leading-none tracking-tight tabular-nums ${
              waiting ? "text-[#CBD5E1]" : "text-[#0F172A]"
            }`}
          >
            {waiting ? "—" : kpi.display}
          </p>
          {support ? (
            <p className={`mt-1.5 text-[12px] font-medium ${support.tone}`}>
              {support.text}
            </p>
          ) : (
            <div className="mt-1.5 h-4" />
          )}
          {showProgressBar ? (
            <div className="mt-2.5">
              <ProgressTrack
                pct={
                  waiting
                    ? 0
                    : (kpi.progress ??
                      (kpi.value != null ? Number(kpi.value) : 0))
                }
                barClass={waiting ? "bg-neutral-200" : a.bar}
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div
        className={`flex h-[100px] flex-col justify-between ${CARD_SHELL} p-4 ${
          waiting ? "bg-[#F8FAFC]" : ""
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-semibold text-[#111827]">{title}</p>
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-full ${
              waiting ? "bg-[#E8F4FF] text-[#1993FF]" : `${s.iconBg} ${s.icon}`
            }`}
          >
            {waiting ? (
              <Info className="h-4 w-4" aria-hidden />
            ) : (
              <Icon className="h-4 w-4" />
            )}
          </span>
        </div>
        <div>
          <p
            className={`text-[22px] font-bold tracking-tight tabular-nums ${
              waiting ? "text-neutral-300" : "text-[#0F172A]"
            }`}
          >
            {waiting ? "—" : kpi.display}
          </p>
          <p className="mt-1 text-[12px] text-[#64748B]">
            {waiting ? "No data" : description}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex min-h-[120px] flex-col gap-2 ${CARD_SHELL} p-4`}>
      <div className="flex items-start justify-between gap-2">
        <div
          className={`grid h-9 w-9 place-items-center rounded-full ${
            waiting ? "bg-[#E8F4FF]" : s.iconBg
          }`}
        >
          {waiting ? (
            <Info className="h-4 w-4 text-[#1993FF]" aria-hidden />
          ) : (
            <Icon className={`h-4 w-4 ${s.icon}`} />
          )}
        </div>
        {kpi.available ? <TrendLine kpi={kpi} /> : null}
      </div>
      <div>
        <p className="text-[13px] font-semibold text-[#111827]">{title}</p>
        <p
          className={`mt-1 text-[24px] font-bold tracking-tight tabular-nums ${
            waiting ? "text-neutral-300" : "text-[#0F172A]"
          }`}
        >
          {waiting ? "—" : kpi.display}
        </p>
      </div>
      {kpi.available && hasProgress ? (
        <div className="mt-auto">
          <ProgressTrack pct={kpi.progress ?? 0} barClass={s.bar} />
        </div>
      ) : kpi.available && hasSpark ? (
        <div className="mt-auto">
          <Sparkline
            data={sparkline.filter((n) => Number.isFinite(n) && n > 0)}
            color={s.spark}
            height={20}
          />
        </div>
      ) : (
        <div className="mt-auto h-2" />
      )}
    </div>
  );
}

export default memo(AnalyticsKpiCard);
