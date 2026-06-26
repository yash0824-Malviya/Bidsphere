import { Check } from "lucide-react";

export interface TimelineStep {
  label: string;
  done: boolean;
  sublabel?: string;
}

interface Props {
  steps: TimelineStep[];
  title?: string;
}

export default function ProcurementTimeline({ steps, title = "Procurement Workflow" }: Props) {
  const activeIndex = steps.findIndex((s) => !s.done);
  const currentIndex = activeIndex === -1 ? steps.length - 1 : activeIndex;

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-neutral-500">
        {title}
      </h3>
      <div className="overflow-x-auto pb-1">
        <ol className="flex min-w-[840px] items-start justify-between gap-1">
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            const isActive = index === currentIndex && !step.done;
            const isComplete = step.done;

            return (
              <li
                key={step.label}
                className="relative flex flex-1 flex-col items-center text-center"
              >
                {!isLast && (
                  <div
                    className={`absolute left-[calc(50%+14px)] top-3.5 h-0.5 w-[calc(100%-28px)] transition-colors ${
                      isComplete && steps[index + 1]?.done
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
                    isComplete
                      ? "bg-primary-600 text-white shadow-sm"
                      : isActive
                        ? "bg-primary-50 text-primary-700 ring-2 ring-primary-400 shadow-sm"
                        : "bg-neutral-100 text-neutral-400"
                  }`}
                >
                  {isComplete ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  ) : (
                    <span className="text-[10px] font-bold">{index + 1}</span>
                  )}
                </div>
                <p
                  className={`mt-1.5 max-w-[92px] text-[10px] font-semibold leading-tight ${
                    isComplete
                      ? "text-neutral-900"
                      : isActive
                        ? "text-primary-700"
                        : "text-neutral-400"
                  }`}
                >
                  {step.label}
                </p>
                {step.sublabel && (
                  <p className="mt-0.5 max-w-[96px] truncate text-[9px] text-neutral-500">
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
