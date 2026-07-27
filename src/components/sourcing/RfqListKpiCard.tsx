import type { LucideIcon } from "lucide-react";

import DashboardKpiCard from "../dashboard/DashboardKpiCard";

export type RfqKpiTone = "blue" | "amber" | "teal" | "gray";

const TONE: Record<RfqKpiTone, string> = {
  blue: "bg-[var(--color-primary-light)] text-[var(--color-primary)]",
  amber: "bg-[var(--ds-warn-soft)] text-[var(--ds-warn)]",
  teal: "bg-[var(--ds-teal-soft)] text-[var(--ds-teal)]",
  gray: "bg-[var(--ds-gray-soft)] text-[var(--ds-gray)]",
};

interface Props {
  label: string;
  value: string | number;
  subtitle: string;
  icon: LucideIcon;
  tone: RfqKpiTone;
  to?: string;
}

/** RFQ list KPI — same canonical card as every other dashboard. */
export default function RfqListKpiCard({
  label,
  value,
  subtitle,
  icon,
  tone,
  to,
}: Props) {
  return (
    <DashboardKpiCard
      label={label}
      value={value}
      subtitle={subtitle}
      icon={icon}
      iconClassName={TONE[tone]}
      to={to}
    />
  );
}
