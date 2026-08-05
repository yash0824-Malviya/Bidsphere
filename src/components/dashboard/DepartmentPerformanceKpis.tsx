import type { LucideIcon } from "lucide-react";
import { ClipboardList, Clock, FileSpreadsheet, Percent } from "lucide-react";

import { Skeleton } from "../Skeleton";

export interface DepartmentPerformanceMetrics {
  pendingRequests: number;
  pendingToday: number;
  bomUploadedMonth: number;
  approvalRate: number;
  materialRequestsTotal: number;
}

interface KpiDef {
  icon: LucideIcon;
  label: string;
  value: string;
  footer: string;
  iconBg: string;
  iconColor: string;
  footerTone?: string;
}

const CARD_SHELL =
  "group relative flex h-[172px] min-h-[172px] w-full flex-col justify-between overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-0.5 hover:border-[#CBD5E1] hover:shadow-[0_12px_32px_rgba(15,23,42,0.1)]";

function CompactKpiCard({
  icon: Icon,
  label,
  value,
  footer,
  iconBg,
  iconColor,
  footerTone = "text-[#64748B]",
}: KpiDef) {
  return (
    <div className={CARD_SHELL}>
      <div className="flex min-h-[44px] items-start justify-between gap-3">
        <p className="min-w-0 flex-1 pr-2 text-lg font-semibold leading-snug text-[#475569]">
          {label}
        </p>
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconBg} ${iconColor}`}
          aria-hidden
        >
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
      </div>

      <div className="flex min-h-[56px] flex-1 items-center py-2">
        <p
          className="w-full min-w-0 text-[clamp(2.5rem,2.5vw,3rem)] font-bold leading-none tracking-tight text-[#1E293B] tabular-nums"
          title={value}
        >
          {value}
        </p>
      </div>

      <p className={`min-h-[20px] shrink-0 text-sm font-medium leading-snug ${footerTone}`}>
        {footer}
      </p>
    </div>
  );
}

function KpiCardSkeleton() {
  return (
    <div className={CARD_SHELL}>
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
      </div>
      <div className="flex flex-1 items-center py-2">
        <Skeleton className="h-10 w-24" />
      </div>
      <Skeleton className="h-4 w-36" />
    </div>
  );
}

function approvalFooter(rate: number): { text: string; tone: string } {
  if (rate >= 95) return { text: "Excellent", tone: "text-emerald-600" };
  if (rate >= 80) return { text: "Good", tone: "text-[#1F3A6D]" };
  if (rate >= 60) return { text: "On track", tone: "text-amber-600" };
  return { text: "Needs attention", tone: "text-rose-600" };
}

interface Props {
  metrics: DepartmentPerformanceMetrics;
  loading?: boolean;
}

export default function DepartmentPerformanceKpis({ metrics, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const approval = approvalFooter(metrics.approvalRate);
  const pendingFooter =
    metrics.pendingToday > 0
      ? `+${metrics.pendingToday.toLocaleString()} Today`
      : "Awaiting Department Review";

  const cards: KpiDef[] = [
    {
      icon: Clock,
      label: "Pending Requests",
      value: metrics.pendingRequests.toLocaleString(),
      footer: pendingFooter,
      iconBg: "bg-amber-50",
      iconColor: "text-amber-600",
      footerTone: metrics.pendingToday > 0 ? "text-amber-700" : "text-[#64748B]",
    },
    {
      icon: FileSpreadsheet,
      label: "BOM Uploaded",
      value: metrics.bomUploadedMonth.toLocaleString(),
      footer: "This Month",
      iconBg: "bg-[#EEF3FA]",
      iconColor: "text-[#1F3A6D]",
    },
    {
      icon: Percent,
      label: "Approval Rate",
      value: `${metrics.approvalRate.toFixed(1)}%`,
      footer: approval.text,
      iconBg: "bg-emerald-50",
      iconColor: "text-emerald-600",
      footerTone: approval.tone,
    },
    {
      icon: ClipboardList,
      label: "Material Requests",
      value: metrics.materialRequestsTotal.toLocaleString(),
      footer: "Total Created",
      iconBg: "bg-slate-100",
      iconColor: "text-slate-600",
    },
  ];

  return (
    <div className="grid grid-cols-1 items-stretch gap-6 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <CompactKpiCard key={card.label} {...card} />
      ))}
    </div>
  );
}
