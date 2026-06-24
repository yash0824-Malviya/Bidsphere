import { CheckCircle2, Circle } from "lucide-react";

import type { ProcurementWorkflowStep } from "../../utils/procurementStatusWorkflow";

interface Props {
  steps: ProcurementWorkflowStep[];
  /** Compact mode for sidebars / narrow panels. */
  compact?: boolean;
}

/**
 * ERP-style horizontal procurement status timeline.
 * Green = completed · Blue = current · Gray = pending
 */
export default function POStatusTimeline({ steps, compact = false }: Props) {
  const completedCount = steps.filter((s) => s.state === "completed").length;
  const progressPct =
    steps.length <= 1 ? 0 : (completedCount / (steps.length - 1)) * 100;

  return (
    <div className={compact ? "px-3 py-3" : "px-4 py-5 sm:px-6"}>
      <div className="relative overflow-x-auto pb-1">
        <div
          className="relative flex min-w-[720px] items-start justify-between gap-1 sm:min-w-0"
          role="list"
          aria-label="PO procurement status"
        >
          {/* Track */}
          <div
            className="pointer-events-none absolute top-[18px] h-0.5 bg-neutral-200 sm:top-[22px]"
            style={{ left: "5%", right: "5%" }}
          />
          <div
            className="pointer-events-none absolute top-[18px] h-0.5 bg-emerald-500 transition-all duration-500 sm:top-[22px]"
            style={{ left: "5%", width: `calc(${progressPct * 0.9}% )`, maxWidth: "90%" }}
          />

          {steps.map((step) => {
            const Icon = step.icon;
            const isCompleted = step.state === "completed";
            const isCurrent = step.state === "current";
            const isPending = step.state === "pending";

            return (
              <div
                key={step.id}
                role="listitem"
                className="relative z-10 flex min-w-0 flex-1 flex-col items-center px-0.5"
              >
                <div
                  className={`flex items-center justify-center rounded-full shadow-sm transition-all ${
                    compact ? "h-9 w-9" : "h-11 w-11 sm:h-12 sm:w-12"
                  } ${
                    isCompleted
                      ? "bg-emerald-500 text-white ring-4 ring-emerald-100"
                      : isCurrent
                      ? "bg-primary-600 text-white ring-4 ring-primary-100"
                      : "border-2 border-neutral-200 bg-white text-neutral-300"
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle2 className={compact ? "h-4 w-4" : "h-5 w-5"} />
                  ) : isCurrent ? (
                    <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
                  ) : (
                    <Circle className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
                  )}
                </div>

                <p
                  className={`mt-2 max-w-[88px] text-center leading-tight ${
                    compact ? "text-[9px]" : "text-[10px] sm:text-[11px]"
                  } font-semibold ${
                    isCompleted
                      ? "text-emerald-700"
                      : isCurrent
                      ? "text-primary-700"
                      : "text-neutral-400"
                  }`}
                >
                  {step.label}
                </p>

                {isCurrent && (
                  <span className="mt-1 rounded-full bg-primary-50 px-1.5 py-px text-[8px] font-bold uppercase tracking-wide text-primary-600">
                    Active
                  </span>
                )}
                {isPending && !compact && (
                  <span className="mt-1 text-[8px] font-medium text-neutral-300" aria-hidden>
                    Pending
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
