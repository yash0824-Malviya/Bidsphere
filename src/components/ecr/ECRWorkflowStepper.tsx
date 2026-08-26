import { Check } from "lucide-react";
import {
  ECR_WORKFLOW_STAGES,
} from "../../config/ecrRoles";
import type { ECRStatus } from "../../types/erpnext";
import { getECRWorkflowActiveIndex } from "./ecrWorkflowPresentation";

export default function ECRWorkflowStepper({
  status,
  rfqReference,
}: {
  status?: ECRStatus | string | null;
  rfqReference?: string | null;
}) {
  const stages = ECR_WORKFLOW_STAGES;
  const activeIndex = getECRWorkflowActiveIndex(status, rfqReference);

  return (
    <div className="overflow-x-auto pb-1 pt-1">
      <ol className="flex min-w-[560px] items-start" aria-label="ECR workflow progress">
        {stages.map((stage, index) => {
          const active = index === activeIndex;
          const complete = activeIndex >= 0 && index < activeIndex;
          return (
            <li key={stage.id} className="relative flex flex-1 flex-col items-center px-1 text-center">
              {index > 0 ? (
                <span
                  className={`absolute left-0 right-1/2 top-2 h-0.5 transition-colors ${
                    complete || active ? "bg-primary-500" : "bg-neutral-200"
                  }`}
                />
              ) : null}
              {index < stages.length - 1 ? (
                <span
                  className={`absolute left-1/2 right-0 top-2 h-0.5 transition-colors ${
                    complete ? "bg-primary-500" : "bg-neutral-200"
                  }`}
                />
              ) : null}
              <span
                className={`relative z-10 flex h-4 w-4 items-center justify-center rounded-full border-2 text-[8px] font-bold transition-all ${
                  active
                    ? "border-primary-600 bg-white ring-4 ring-primary-100 ring-offset-1 text-primary-700 scale-110"
                    : complete
                      ? "border-primary-600 bg-primary-600 text-white shadow-xs"
                      : "border-neutral-300 bg-white text-neutral-400"
                }`}
              >
                {complete ? <Check className="h-2.5 w-2.5 stroke-[3]" /> : null}
              </span>
              <span
                className={`mt-1.5 text-[11px] leading-tight transition-colors ${
                  active
                    ? "font-bold text-primary-700"
                    : complete
                      ? "font-medium text-neutral-800"
                      : "font-normal text-neutral-400"
                }`}
              >
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
