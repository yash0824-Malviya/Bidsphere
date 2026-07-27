import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { Info } from "lucide-react";
import type { AnalyticsKpi } from "../../../api/procurementAnalytics";
import DashboardKpiCard from "../DashboardKpiCard";

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  kpi: AnalyticsKpi | null;
  loading?: boolean;
  /** Kept for API compatibility — layout is standardized. */
  compact?: boolean;
  /** Kept for API compatibility — layout is standardized. */
  variant?: "default" | "enterprise";
  accent?: "blue" | "green" | "orange" | "red" | "gray";
}

const ACCENT = {
  blue: "bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]",
  green: "bg-[var(--ds-success-soft)] text-[var(--ds-success)]",
  orange: "bg-[var(--ds-warn-soft)] text-[var(--ds-warn)]",
  red: "bg-[var(--ds-danger-soft)] text-[var(--ds-danger)]",
  gray: "bg-[var(--ds-paper)] text-[var(--ds-text-faint)]",
} as const;

function enterpriseSupport(title: string, kpi: AnalyticsKpi): string | null {
  if (/savings/i.test(title)) {
    const savings = kpi.meta?.find((m) => /savings/i.test(m.label));
    if (savings?.value) {
      const raw = savings.value.replace(/%/g, "").trim();
      const n = Number(raw);
      if (Number.isFinite(n) && n !== 0) {
        return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
      }
    }
    if (kpi.trend && kpi.trend.pct !== 0) {
      const sign = kpi.trend.direction === "down" ? "-" : "+";
      return `${sign}${kpi.trend.pct}%`;
    }
  }

  if (/budget/i.test(title)) {
    const remaining = kpi.meta?.find((m) => /remaining/i.test(m.label));
    if (remaining) return `${remaining.label} ${remaining.value}`;
  }

  if (/response/i.test(title)) {
    const responded = kpi.meta?.find((m) => /responded/i.test(m.label));
    const invited = kpi.meta?.find((m) => /invited/i.test(m.label));
    if (responded && invited) {
      return `${responded.value} of ${invited.value} responded`;
    }
  }

  if (/delivery/i.test(title)) {
    const onTime = kpi.meta?.find((m) => /on time/i.test(m.label));
    const received = kpi.meta?.find((m) => /received/i.test(m.label));
    if (onTime && received) {
      return `${onTime.value} of ${received.value} on time`;
    }
  }

  if (/turnaround/i.test(title)) {
    const completed = kpi.meta?.find((m) => /completed/i.test(m.label));
    if (completed) return `${completed.value} completed`;
    return "Average turnaround";
  }

  if (/cycle/i.test(title)) {
    const completed = kpi.meta?.find((m) => /completed/i.test(m.label));
    if (completed) return `${completed.value} completed`;
    return "Average cycle";
  }

  return null;
}

/**
 * Analytics KPI — same shell/typography as every other KPI card.
 * Progress/sparkline visuals are folded into the subtitle line so
 * height, type, and alignment stay identical across portals.
 */
function AnalyticsKpiCard({
  icon: Icon,
  title,
  description,
  kpi,
  loading,
  accent = "blue",
}: Props) {
  if (loading || !kpi) {
    return (
      <DashboardKpiCard
        icon={Icon}
        label={title}
        value="—"
        subtitle={description}
        loading
        iconClassName={ACCENT[accent]}
      />
    );
  }

  const waiting = !kpi.available;
  const support = waiting
    ? "No data"
    : enterpriseSupport(title, kpi) ?? description;

  return (
    <DashboardKpiCard
      icon={waiting ? Info : Icon}
      label={title}
      value={waiting ? "—" : kpi.display}
      subtitle={waiting ? "Awaiting data" : support}
      iconClassName={waiting ? ACCENT.gray : ACCENT[accent]}
    />
  );
}

export default memo(AnalyticsKpiCard);
