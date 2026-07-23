import type { ReactNode } from "react";
import { Skeleton } from "../Skeleton";

interface Props {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  loading?: boolean;
  hasData?: boolean;
  emptyLabel?: string;
  children: ReactNode;
  className?: string;
}

export default function ReportChartCard({
  title,
  subtitle,
  action,
  loading,
  hasData = true,
  emptyLabel = "No data for the selected filters",
  children,
  className = "",
}: Props) {
  return (
    <div
      className={`flex h-[300px] flex-col rounded-2xl border border-[#E8EDF5] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] ${className}`}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-1.5 pt-4">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold leading-tight tracking-tight text-[#111827]">
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-0.5 text-[11px] font-medium leading-snug text-[#64748B]">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? (
          <div className="shrink-0 pt-0.5">{action}</div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 px-2.5 pb-3 pt-0">
        {loading ? (
          <Skeleton className="h-full w-full rounded-xl" />
        ) : hasData ? (
          children
        ) : (
          <div className="grid h-full place-items-center px-4 text-center text-[13px] text-[#64748B]">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}

export const REPORT_AXIS = {
  tick: { fontSize: 10, fill: "#94a3b8" },
  axisLine: false as const,
  tickLine: false as const,
};

export const REPORT_TOOLTIP = {
  fontSize: 12,
  borderRadius: 10,
  border: "1px solid #E8EDF5",
  boxShadow: "0 4px 12px rgba(15,23,42,0.06)",
};
