import { memo } from "react";
import type { LucideIcon } from "lucide-react";

import DashboardKpiCard from "../dashboard/DashboardKpiCard";
import { formatDate } from "../../utils/format";

interface Props {
  title: string;
  icon: LucideIcon;
  to: string;
  total: number;
  latestDate?: string;
  statusSummary: string;
  loading?: boolean;
}

export default memo(function QuickNavCard({
  title,
  icon,
  to,
  total,
  latestDate,
  statusSummary,
  loading,
}: Props) {
  const latest = latestDate ? formatDate(latestDate) : "—";
  return (
    <DashboardKpiCard
      to={to}
      icon={icon}
      label={title}
      value={total}
      subtitle={`${statusSummary} · Latest ${latest}`}
      loading={loading}
      iconClassName="bg-[var(--color-primary-light)] text-[var(--color-primary)]"
    />
  );
});
