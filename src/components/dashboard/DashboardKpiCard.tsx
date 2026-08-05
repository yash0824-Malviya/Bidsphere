/**
 * Canonical enterprise KPI card — used across every role dashboard / list.
 * Fixed height, top-right icon, dark KPI value, shared shadow/radius.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

import { Skeleton } from "../Skeleton";

export interface DashboardKpiTrend {
  /** Signed percent change, e.g. 4.2 or -1.5 */
  pct: number;
  /** Optional short label, e.g. "vs last month" */
  label?: string;
}

export interface DashboardKpiCardProps {
  label: string;
  value: string | number;
  /** Optional support line under the value (space always reserved for alignment). */
  subtitle?: string;
  icon: LucideIcon;
  /**
   * Icon wrapper classes (background + icon color only).
   * KPI number color stays dark for consistency.
   */
  iconClassName?: string;
  /** @deprecated Ignored — s always use dark text. */
  valueClassName?: string;
  /** Optional trend chip shown in the caption row. */
  trend?: DashboardKpiTrend;
  to?: string;
  onClick?: () => void;
  loading?: boolean;
  /** Extra classes on the outer shell (border highlight, etc.). */
  className?: string;
  /**
   * `text` = two-line ellipsis for long names (supplier labels).
   * Default `metric` keeps single-line tabular numbers.
   */
  valueVariant?: "metric" | "text";
}

const SHELL_BASE =
  "kpi-card group relative flex w-full flex-col text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]";

export default function DashboardKpiCard({
  label,
  value,
  subtitle,
  icon: Icon,
  iconClassName = "bg-[var(--color-primary-light)] text-[var(--color-primary)]",
  trend,
  to,
  onClick,
  loading,
  className = "",
  valueVariant = "metric",
}: DashboardKpiCardProps) {
  const trendUp = trend != null && trend.pct > 0;
  const trendDown = trend != null && trend.pct < 0;
  const trendText =
    trend == null
      ? null
      : `${trendUp ? "▲" : trendDown ? "▼" : "•"} ${trend.pct > 0 ? "+" : ""}${trend.pct.toFixed(1)}%${
          trend.label ? ` ${trend.label}` : ""
        }`;

  const body = (
    <>
      <span
        className={`kpi-card-icon flex shrink-0 items-center justify-center ${iconClassName}`}
        aria-hidden
      >
        <Icon className="kpi-card-icon-svg" />
      </span>

      <div className="kpi-card-title-slot">
        <p className="kpi-card-label" title={label}>
          {label}
        </p>
      </div>

      <div
        className={`kpi-card-value-slot${
          valueVariant === "text" ? " kpi-card-value-slot--text" : ""
        }`}
      >
        {loading ? (
          <Skeleton className="h-9 w-24" />
        ) : (
          <p
            className={`kpi-value${valueVariant === "text" ? " kpi-value--text" : ""}`}
            title={String(value)}
          >
            {value}
          </p>
        )}
      </div>

      <div className="kpi-card-caption-slot">
        {trendText ? (
          <p
            className={`kpi-card-caption kpi-card-trend ${
              trendUp
                ? "kpi-card-trend-up"
                : trendDown
                  ? "kpi-card-trend-down"
                  : ""
            }`}
            title={trendText}
          >
            {trendText}
            {subtitle ? (
              <span className="kpi-card-trend-sep"> · {subtitle}</span>
            ) : null}
          </p>
        ) : (
          <p className="kpi-card-caption" title={subtitle || undefined}>
            {subtitle || "\u00a0"}
          </p>
        )}
      </div>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={`${SHELL_BASE} no-underline ${className}`.trim()}>
        {body}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${SHELL_BASE} cursor-pointer ${className}`.trim()}
      >
        {body}
      </button>
    );
  }

  return <div className={`${SHELL_BASE} ${className}`.trim()}>{body}</div>;
}

export interface DashboardKpiGridProps {
  children: ReactNode;
  className?: string;
  /**
   * Desktop column target. Layout is always:
   * 1 (default) → 2 (sm) → 3 (md) → N (xl), gap 20px.
   */
  columns?: 3 | 4 | 5 | 6;
}

const DESKTOP_COLS: Record<NonNullable<DashboardKpiGridProps["columns"]>, string> = {
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
  6: "xl:grid-cols-6",
};

/** Responsive equal-width KPI grid. */
export function DashboardKpiGrid({
  children,
  className = "",
  columns = 5,
}: DashboardKpiGridProps) {
  /* 6-col: tablet 2×3 · laptop 3×2 · desktop 1×6 (no orphan row). */
  const responsive =
    columns === 6
      ? `kpi-grid grid grid-cols-2 lg:grid-cols-3 ${DESKTOP_COLS[columns]}`
      : columns === 4 || columns === 5
        ? `kpi-grid grid grid-cols-1 sm:grid-cols-2 ${DESKTOP_COLS[columns]}`
        : `kpi-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 ${DESKTOP_COLS[columns]}`;

  return (
    <div className={`${responsive} ${className}`.trim()}>
      {children}
    </div>
  );
}

export function DashboardKpiSkeleton({
  count = 5,
  columns = 5,
}: {
  count?: number;
  columns?: 3 | 4 | 5 | 6;
}) {
  return (
    <DashboardKpiGrid columns={columns}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="kpi-card">
          <div className="kpi-card-title-slot">
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="kpi-card-value-slot">
            <Skeleton className="h-9 w-20" />
          </div>
          <div className="kpi-card-caption-slot">
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </DashboardKpiGrid>
  );
}
