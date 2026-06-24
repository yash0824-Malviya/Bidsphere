import { memo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
  icon: Icon,
  to,
  total,
  latestDate,
  statusSummary,
  loading,
}: Props) {
  return (
    <Link
      to={to}
      className="card group block p-5 transition hover:border-primary-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary transition group-hover:bg-primary group-hover:text-white">
          <Icon className="h-5 w-5" />
        </div>
        <ArrowRight className="h-4 w-4 text-neutral-300 transition group-hover:text-primary" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-neutral-900">{title}</h3>
      {loading ? (
        <div className="mt-2 h-8 w-20 animate-pulse rounded bg-neutral-100" />
      ) : (
        <>
          <p className="mt-1 text-2xl font-bold tabular-nums text-neutral-900">
            {total}
            <span className="ml-1 text-sm font-medium text-neutral-500">
              Total
            </span>
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Latest: {latestDate ? formatDate(latestDate) : "—"}
          </p>
          <p className="mt-0.5 text-xs font-medium text-primary-700">
            {statusSummary}
          </p>
        </>
      )}
    </Link>
  );
});
