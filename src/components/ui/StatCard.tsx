import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Skeleton } from "../Skeleton";

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
  icon: Icon,
  label,
  value,
  sub,
  tone = "primary",
  trend,
  loading,
  to,
  onClick,
}: Props) {
  const Wrapper: React.ElementType = to ? Link : onClick ? "button" : "div";
  const wrapperProps: Record<string, unknown> = to
    ? { to }
    : onClick
    ? { type: "button", onClick }
    : {};

  const isInteractive = !!to || !!onClick;
  const hoverClasses = isInteractive
    ? "transition-shadow hover:shadow-card-hover cursor-pointer text-left"
    : "";

  return (
    <Wrapper
      {...wrapperProps}
      className={`card block p-5 ${hoverClasses}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-neutral-400">
            {label}
          </p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <p className="mt-1 text-xl font-semibold tabular-nums leading-tight text-neutral-900 sm:text-2xl">
              {value}
            </p>
          )}
          {sub && !loading && (
            <p className="mt-0.5 truncate text-xs text-neutral-500">{sub}</p>
          )}
          {trend && !loading && <TrendChip trend={trend} />}
        </div>
        <div
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${TONE_CLASSES[tone]}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Wrapper>
  );
}

function TrendChip({ trend }: { trend: Trend }) {
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
