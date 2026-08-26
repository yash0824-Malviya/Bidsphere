import React from "react";
import { Check, AlertCircle } from "lucide-react";

export interface StepDefinition {
  id: number;
  label: string;
}

export const INTAKE_STEPS: StepDefinition[] = [
  { id: 1, label: "Requirement" },
  { id: 2, label: "Organization" },
  { id: 3, label: "Project" },
  { id: 4, label: "Budget" },
  { id: 5, label: "Documents" },
  { id: 6, label: "Review" },
];

interface Props {
  currentStep: number;
  completedSteps: number[];
  stepErrors: Record<number, boolean>;
  onStepClick: (stepId: number) => void;
}

export function BusinessNeedStepper({
  currentStep,
  completedSteps,
  stepErrors,
  onStepClick,
}: Props) {
  return (
    <div className="w-full rounded-[12px] border border-neutral-200/90 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-6 lg:px-8">
      <nav aria-label="Intake Progress" className="overflow-x-auto scrollbar-hidden">
        <ol className="flex items-center min-w-[700px] py-1">
            {INTAKE_STEPS.map((step, idx) => {
              const isActive = currentStep === step.id;
              const isCompleted = completedSteps.includes(step.id) && !isActive;
              const isAccessible =
                isCompleted ||
                isActive ||
                completedSteps.includes(step.id - 1) ||
                step.id === 1;
              const hasError = stepErrors[step.id];
              const isLast = idx === INTAKE_STEPS.length - 1;

              // Sub-label
              const subLabel = isActive
                ? "In Progress"
                : isCompleted
                ? "Completed"
                : "Upcoming";

              return (
                <React.Fragment key={step.id}>
                  {/* Step item */}
                  <li className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (isAccessible) onStepClick(step.id);
                      }}
                      disabled={!isAccessible}
                      aria-current={isActive ? "step" : undefined}
                      className={[
                        "group flex items-center gap-2.5 px-3 py-4 text-left transition-colors duration-150",
                        isAccessible && !isActive
                          ? "cursor-pointer hover:bg-neutral-50"
                          : isActive
                          ? "cursor-default"
                          : "cursor-not-allowed",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {/* Circle */}
                      <div
                        className={[
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-all duration-150",
                          isActive
                            ? "bg-primary-700 text-white shadow-sm ring-2 ring-primary-200"
                            : isCompleted && !hasError
                            ? "bg-emerald-600 text-white"
                            : hasError
                            ? "bg-red-500 text-white"
                            : isAccessible
                            ? "border border-neutral-300 bg-white text-neutral-500 group-hover:border-neutral-400 group-hover:text-neutral-700"
                            : "border border-neutral-200 bg-neutral-100 text-neutral-400",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {isCompleted && !hasError ? (
                          <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                        ) : hasError ? (
                          <AlertCircle className="h-3.5 w-3.5" />
                        ) : (
                          step.id
                        )}
                      </div>

                      {/* Text */}
                      <div className="flex flex-col leading-none">
                        <span
                          className={[
                            "text-[12.5px] whitespace-nowrap font-semibold leading-tight",
                            isActive
                              ? "text-primary-800"
                              : isCompleted
                              ? "text-neutral-800 group-hover:text-primary-700"
                              : isAccessible
                              ? "text-neutral-700 group-hover:text-neutral-900"
                              : "text-neutral-400",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {step.label}
                        </span>
                        <span
                          className={[
                            "mt-0.5 text-[10.5px] whitespace-nowrap leading-tight",
                            isActive
                              ? "text-primary-500 font-medium"
                              : isCompleted
                              ? "text-emerald-600 font-medium"
                              : "text-neutral-400 font-normal",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {subLabel}
                        </span>
                      </div>
                    </button>
                  </li>

                  {/* Connector line */}
                  {!isLast && (
                    <li
                      className="flex flex-1 items-center px-1"
                      aria-hidden="true"
                    >
                      <div
                        className={[
                          "h-[2px] w-full rounded-full transition-colors duration-300",
                          completedSteps.includes(step.id) &&
                          (completedSteps.includes(step.id + 1) ||
                            currentStep > step.id)
                            ? "bg-emerald-500"
                            : isActive
                            ? "bg-primary-200"
                            : "bg-neutral-200",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      />
                    </li>
                  )}
                </React.Fragment>
              );
            })}
          </ol>
        </nav>
    </div>
  );
}
