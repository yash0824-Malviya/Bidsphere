import { Ban, Check } from "lucide-react";

export interface TimelineStep {
  label: string;
  done: boolean;
  sublabel?: string;
  /** When true, this step is the single focus and shows as Rejected. */
  rejected?: boolean;
}

interface Props {
  steps: TimelineStep[];
  title?: string;
}

/**
 * Horizontal procurement timeline. Exactly one step is Current (or Rejected);
 * completed steps show checks; everything after the focus stays Pending.
 */
export default function ProcurementTimeline({
  steps,
  title = "Procurement Status",
}: Props) {
  const rejectedIndex = steps.findIndex((s) => s.rejected);
  const firstPendingIndex = steps.findIndex((s) => !s.done && !s.rejected);
  const allDone = steps.length > 0 && steps.every((s) => s.done && !s.rejected);

  // Single focus: rejected wins, else first incomplete, else none (all complete).
  const focusIndex =
    rejectedIndex >= 0
      ? rejectedIndex
      : allDone
        ? -1
        : firstPendingIndex >= 0
          ? firstPendingIndex
          : -1;

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-neutral-500">
        {title}
      </h3>
      <div className="overflow-x-auto pb-1">
        <ol className="flex min-w-[920px] items-start justify-between gap-1">
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            const isRejected = index === focusIndex && Boolean(step.rejected);
            const isActive = index === focusIndex && !step.done && !isRejected;
            const isComplete = step.done && !step.rejected;
            const connectorComplete =
              isComplete && (steps[index + 1]?.done || steps[index + 1]?.rejected);

            return (
              <li
                key={`${step.label}-${index}`}
                className="relative flex flex-1 flex-col items-center text-center"
              >
                {!isLast && (
                  <div
                    className={`absolute left-[calc(50%+14px)] top-3.5 h-0.5 w-[calc(100%-28px)] transition-colors ${
                      connectorComplete
                        ? "bg-primary-500"
                        : isComplete
                          ? "bg-gradient-to-r from-primary-500 to-neutral-200"
                          : "bg-neutral-200"
                    }`}
                    aria-hidden
                  />
                )}
                <div
                  className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-white transition-all ${
                    isRejected
                      ? "bg-red-600 text-white shadow-sm ring-red-100"
                      : isComplete
                        ? "bg-primary-600 text-white shadow-sm"
                        : isActive
                          ? "bg-amber-500 text-white shadow-md ring-amber-100"
                          : "bg-neutral-100 text-neutral-400"
                  }`}
                  aria-current={isActive || isRejected ? "step" : undefined}
                >
                  {isRejected ? (
                    <Ban className="h-3.5 w-3.5" strokeWidth={2.5} />
                  ) : isComplete ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  ) : (
                    <span className="text-[10px] font-bold">{index + 1}</span>
                  )}
                </div>
                <p
                  className={`mt-1.5 max-w-[100px] text-[10px] font-semibold leading-tight ${
                    isRejected
                      ? "text-red-700"
                      : isComplete
                        ? "text-neutral-900"
                        : isActive
                          ? "text-amber-800"
                          : "text-neutral-400"
                  }`}
                >
                  {step.label}
                </p>
                {(isActive || isRejected) && (
                  <span
                    className={`mt-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide ${
                      isRejected
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {isRejected ? "Rejected" : "Current"}
                  </span>
                )}
                {step.sublabel && (
                  <p className="mt-0.5 max-w-[100px] truncate text-[9px] text-neutral-500">
                    {step.sublabel}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
