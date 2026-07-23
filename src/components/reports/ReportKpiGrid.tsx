import type { LucideIcon } from "lucide-react";
import { Skeleton } from "../Skeleton";

export interface ReportKpi {
  key: string;
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: { bg: string; fg: string };
}

interface Props {
  items: ReportKpi[];
  loading?: boolean;
  columnsClassName?: string;
}

const DEFAULT_TONE = { bg: "bg-[#E8F4FF]", fg: "text-[#1993FF]" };

export default function ReportKpiGrid({
  items,
  loading,
  columnsClassName = "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
}: Props) {
  return (
    <div className={`grid gap-3 ${columnsClassName}`}>
      {items.map((item) => {
        const Icon = item.icon;
        const tone = item.tone ?? DEFAULT_TONE;
        return (
          <div
            key={item.key}
            className="flex min-h-[110px] flex-col rounded-2xl border border-[#E8EDF5] bg-white p-3.5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
          >
            <div className="flex items-start gap-2">
              {Icon ? (
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone.bg}`}
                >
                  <Icon className={`h-3.5 w-3.5 ${tone.fg}`} />
                </span>
              ) : null}
              <p className="text-[12px] font-semibold leading-snug text-[#111827]">
                {item.label}
              </p>
            </div>
            <div className="mt-auto pt-3">
              {loading ? (
                <Skeleton className="h-7 w-20" />
              ) : (
                <p className="text-[22px] font-bold leading-none tracking-tight tabular-nums text-[#0F172A]">
                  {item.value}
                </p>
              )}
              {item.hint ? (
                <p className="mt-1.5 text-[11px] font-medium text-[#64748B]">
                  {item.hint}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
