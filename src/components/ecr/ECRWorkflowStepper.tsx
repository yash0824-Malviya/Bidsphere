import { Check } from "lucide-react";
import type { ECRStatus, EngineeringChangeRequest } from "../../types/erpnext";
import { getApplicableECRWorkflowStages, isExtendedECRWorkflow } from "../../config/ecrRoles";
import { getECRWorkflowActiveIndex } from "./ecrWorkflowPresentation";

export interface WorkflowTimelineStage {
  id: string;
  label: string;
  sublabel?: string;
}

const FULL_WORKFLOW_TIMELINE: WorkflowTimelineStage[] = [
  { id: "created", label: "ECR Created" },
  { id: "eng_review", label: "Engineering Review" },
  { id: "eng_approved", label: "Engineering Manager Approved" },
  { id: "proc_team_approved", label: "Procurement Team Approved" },
  { id: "pm_create_rfq", label: "Procurement Manager", sublabel: "Create RFQ" },
  { id: "rfq_published", label: "RFQ Published" },
  { id: "supplier_responses", label: "Supplier Responses" },
  { id: "quote_eval", label: "Quote Evaluation" },
  { id: "purchase_order", label: "Purchase Order" },
  { id: "closed", label: "Closed" },
];

export function resolveTimelineActiveIndex(
  status?: ECRStatus | string | null,
  rfqReference?: string | null,
  ecr?: Partial<EngineeringChangeRequest> | null,
): number {
  if (isExtendedECRWorkflow(ecr)) return getECRWorkflowActiveIndex(status, rfqReference, ecr);
  const norm = String(status ?? "").trim().toLowerCase();
  const hasRfq = Boolean(String(rfqReference ?? "").trim());

  if (norm === "draft" || norm === "new") return 0;
  if (norm === "engineering review") return 1;
  if (norm === "procurement review") return 3;
  if (norm === "rfq pending" || norm === "approved" || norm === "awaiting rfq") {
    return hasRfq ? 5 : 4;
  }
  if (norm === "rfq" || norm === "rfq created" || norm === "published") return 5;
  if (norm === "responses" || norm === "supplier responses") return 6;
  if (norm === "evaluation" || norm === "quote evaluation") return 7;
  if (norm === "purchase order" || norm === "ordered" || norm === "po created") return 8;
  if (norm === "closed" || norm === "completed") return 9;

  return 4; // Default to Procurement Manager Create RFQ for approved ECRs
}

export default function ECRWorkflowStepper({
  status,
  rfqReference,
  ecr,
}: {
  status?: ECRStatus | string | null;
  rfqReference?: string | null;
  ecr?: Partial<EngineeringChangeRequest> | null;
}) {
  const stages: WorkflowTimelineStage[] = isExtendedECRWorkflow(ecr)
    ? getApplicableECRWorkflowStages(ecr)
    : FULL_WORKFLOW_TIMELINE;
  const activeIndex = resolveTimelineActiveIndex(status, rfqReference, ecr);

  return (
    <div className="w-full overflow-x-auto py-2">
      <ol className="flex min-w-[760px] items-start justify-between" aria-label="ECR workflow timeline">
        {stages.map((stage, index) => {
          const active = index === activeIndex;
          const complete = index < activeIndex;
          return (
            <li key={stage.id} className="relative flex flex-1 flex-col items-center px-1 text-center">
              {/* Connecting line left */}
              {index > 0 ? (
                <span
                  className={`absolute left-0 right-1/2 top-2.5 h-[2px] transition-colors ${
                    complete || active ? "bg-[#1554D1]" : "bg-[#E2E8F0]"
                  }`}
                />
              ) : null}
              {/* Connecting line right */}
              {index < stages.length - 1 ? (
                <span
                  className={`absolute left-1/2 right-0 top-2.5 h-[2px] transition-colors ${
                    complete ? "bg-[#1554D1]" : "bg-[#E2E8F0]"
                  }`}
                />
              ) : null}

              {/* Node Indicator */}
              <span
                className={`relative z-10 flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold transition-all ${
                  active
                    ? "border-2 border-[#1554D1] bg-[#1554D1] text-white ring-4 ring-[#EEF4FF] scale-110 shadow-xs"
                    : complete
                      ? "border-2 border-[#059669] bg-[#059669] text-white shadow-2xs"
                      : "border-2 border-[#CBD5E1] bg-white text-[#94A3B8]"
                }`}
              >
                {complete ? (
                  <Check className="h-3 w-3 stroke-[3]" />
                ) : active ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#CBD5E1]" />
                )}
              </span>

              {/* Text Label */}
              <div className="mt-2 flex flex-col items-center">
                <span
                  className={`text-[11px] leading-tight transition-colors ${
                    active
                      ? "font-bold text-[#1554D1]"
                      : complete
                        ? "font-semibold text-[#12213F]"
                        : "font-normal text-[#94A3B8]"
                  }`}
                >
                  {stage.label}
                </span>
                {stage.sublabel ? (
                  <span
                    className={`mt-0.5 text-[10px] leading-tight ${
                      active ? "font-bold text-[#1554D1]" : "text-[#64748B]"
                    }`}
                  >
                    {stage.sublabel}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
