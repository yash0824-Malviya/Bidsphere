import { memo } from "react";
import {
  AlertTriangle,
  Lightbulb,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Skeleton } from "../Skeleton";
import type { ExecutiveInsight } from "../../utils/dashboardUtils";

interface Props {
  insights: ExecutiveInsight[];
  loading?: boolean;
}

const TONE: Record<
  ExecutiveInsight["tone"],
  { icon: LucideIcon; bg: string; text: string; border: string }
> = {
  info: {
    icon: Lightbulb,
    bg: "bg-slate-50",
    text: "text-slate-800",
    border: "border-slate-100",
  },
  warning: {
    icon: AlertTriangle,
    bg: "bg-amber-50/80",
    text: "text-amber-900",
    border: "border-amber-100",
  },
  success: {
    icon: TrendingUp,
    bg: "bg-emerald-50/80",
    text: "text-emerald-900",
    border: "border-emerald-100",
  },
  opportunity: {
    icon: Sparkles,
    bg: "bg-primary-50/80",
    text: "text-primary-900",
    border: "border-primary-100",
  },
};

function ExecutiveInsightsPanel({ insights, loading }: Props) {
  if (loading) {
    return <Skeleton className="h-[72px] w-full rounded-lg" />;
  }

  return (
    <div className="rounded-lg border border-neutral-200/80 bg-white px-3 py-2 shadow-sm">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Lightbulb className="h-3.5 w-3.5 text-primary-600" />
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Executive Insights
        </h3>
      </div>
      <ul className="flex flex-wrap gap-2">
        {insights.map((insight) => {
          const style = TONE[insight.tone];
          const Icon = style.icon;
          return (
            <li
              key={insight.id}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 ${style.bg} ${style.border}`}
            >
              <Icon className={`h-3 w-3 shrink-0 ${style.text}`} />
              <span className={`truncate text-[11px] font-medium ${style.text}`}>
                {insight.message}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default memo(ExecutiveInsightsPanel);
