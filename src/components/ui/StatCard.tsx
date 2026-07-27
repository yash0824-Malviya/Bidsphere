import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import DashboardKpiCard from "../dashboard/DashboardKpiCard";

export type StatTone = "primary" | "accent" | "warning" | "danger" | "neutral";

interface Trend {
  value: number;
  label?: string;
  inverted?: boolean;
}

interface Props {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
  tone?: StatTone;
  trend?: Trend;
  loading?: boolean;
  to?: string;
  onClick?: () => void;
}

const TONE_CLASSES: Record<StatTone, string> = {
  primary: "bg-primary-50 text-primary",
  accent: "bg-primary-50 text-primary",
  warning: "bg-warning-50 text-warning-500",
  danger: "bg-danger-50 text-danger-500",
  neutral: "bg-neutral-100 text-neutral-500",
};

export default function StatCard({
  icon,
  label,
  value,
  sub,
  tone = "primary",
  trend,
  loading,
  to,
  onClick,
}: Props) {
  const subtitle = trend
    ? formatTrendSubtitle(trend, sub)
    : sub;

  return (
    <DashboardKpiCard
      icon={icon}
      label={label}
      value={value}
      subtitle={subtitle}
      iconClassName={TONE_CLASSES[tone]}
      loading={loading}
      to={to}
      onClick={onClick}
    />
  );
}

function formatTrendSubtitle(trend: Trend, sub?: string): string {
  const isUp = trend.value > 0;
  const formatted = `${isUp ? "+" : ""}${trend.value.toFixed(1)}%`;
  const trendBit = trend.label ? `${formatted} ${trend.label}` : formatted;
  return sub ? `${sub} · ${trendBit}` : trendBit;
}

/** @deprecated — trend UI is folded into DashboardKpiCard subtitle. */
export function TrendChip({ trend }: { trend: Trend }) {
  const isUp = trend.value > 0;
  const isFlat = trend.value === 0;
  const isPositive = trend.inverted ? !isUp : isUp;
  const tone = isFlat
    ? "text-neutral-500"
    : isPositive
      ? "text-success-500"
      : "text-danger-500";
  const Icon = isFlat ? Minus : isUp ? ArrowUpRight : ArrowDownRight;
  const formatted = `${isUp ? "+" : ""}${trend.value.toFixed(1)}%`;

  return (
    <p className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${tone}`}>
      <Icon className="h-3 w-3" />
      <span>{formatted}</span>
      {trend.label && <span className="text-neutral-500">{trend.label}</span>}
    </p>
  );
}
