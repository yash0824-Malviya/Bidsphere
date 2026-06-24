import { Check } from "lucide-react";

export interface TimelineStep {
  label: string;
  done: boolean;
  sublabel?: string;
}

interface Props {
  steps: TimelineStep[];
}

export default function ProcurementTimeline({ steps }: Props) {
  return (
    <div className="card overflow-hidden p-5">
      <h3 className="mb-5 text-sm font-semibold text-neutral-900">
        Procurement Lifecycle
      </h3>
      <div className="overflow-x-auto pb-2">
        <ol className="flex min-w-[640px] items-start justify-between gap-2">
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            return (
              <li
                key={step.label}
                className="relative flex flex-1 flex-col items-center text-center"
              >
                {!isLast && (
                  <div
                    className={`absolute left-[calc(50%+16px)] top-4 h-0.5 w-[calc(100%-32px)] ${
                      step.done && steps[index + 1]?.done
                        ? "bg-accent-500"
                        : step.done
                        ? "bg-gradient-to-r from-accent-500 to-neutral-200"
                        : "bg-neutral-200"
                    }`}
                    aria-hidden
                  />
                )}
                <div
                  className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full ring-4 ring-white ${
                    step.done
                      ? "bg-accent-600 text-white shadow-sm"
                      : "bg-neutral-100 text-neutral-400"
                  }`}
                >
                  {step.done ? (
                    <Check className="h-4 w-4" strokeWidth={3} />
                  ) : (
                    <span className="text-xs font-bold">{index + 1}</span>
                  )}
                </div>
                <p
                  className={`mt-2 max-w-[88px] text-[11px] font-semibold leading-tight ${
                    step.done ? "text-neutral-900" : "text-neutral-400"
                  }`}
                >
                  {step.label}
                </p>
                {step.sublabel && (
                  <p className="mt-0.5 max-w-[96px] text-[10px] text-neutral-500">
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
