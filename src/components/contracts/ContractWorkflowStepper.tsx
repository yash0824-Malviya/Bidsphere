import { useId, useState } from "react";

export interface WorkflowStep {
  step: number;
  id: string;
  title: string;
  shortTitle: string;
  role: string;
  description: string;
  timing: string;
}

export const CONTRACT_WORKFLOW_STEPS: WorkflowStep[] = [
  {
    step: 1,
    id: "rfq_award",
    title: "1. RFQ Award",
    shortTitle: "RFQ Award",
    role: "Sourcing Team",
    description: "Winning supplier selected and commercial award approved on RFQ.",
    timing: "Completed during Sourcing",
  },
  {
    step: 2,
    id: "contract_request",
    title: "2. Contract Request",
    shortTitle: "Contract Request",
    role: "System Generated",
    description: "Contract Request automatically generated with read-only award commercial values.",
    timing: "Auto-created upon Award",
  },
  {
    step: 3,
    id: "procurement_details",
    title: "3. Procurement Details",
    shortTitle: "Procurement Details",
    role: "Procurement Team",
    description: "Procurement completes terms (purpose, dates, description) and attaches contract document.",
    timing: "Current Action Required",
  },
  {
    step: 4,
    id: "create_contract",
    title: "4. Create Contract",
    shortTitle: "Create Contract",
    role: "Procurement Team",
    description: "Click 'CREATE CONTRACT' to trigger CLM handoff and transfer ownership to Legal.",
    timing: "Triggered by Procurement",
  },
  {
    step: 5,
    id: "legal_review",
    title: "5. Legal Review",
    shortTitle: "Legal Review",
    role: "Legal Team",
    description: "Legal Team reviews contract wording, clauses, risk level, and terms.",
    timing: "Starts immediately after Contract Creation",
  },
  {
    step: 6,
    id: "legal_approval",
    title: "6. Legal Approval",
    shortTitle: "Legal Approval",
    role: "Legal Manager",
    description: "Legal Manager approves contract wording and authorizes e-signature release.",
    timing: "Follows Legal Review",
  },
  {
    step: 7,
    id: "e_signature",
    title: "7. E-Signature",
    shortTitle: "E-Signature",
    role: "Legal Manager",
    description: "Authorized Legal Manager signs the locked contract document with cryptographic audit trail.",
    timing: "Follows Legal Approval",
  },
  {
    step: 8,
    id: "finance_approval",
    title: "8. Finance Approval",
    shortTitle: "Finance Approval",
    role: "Finance Team",
    description: "Finance Team verifies committed spend, budget allocations, and signs off.",
    timing: "Executes after Legal E-Signature",
  },
  {
    step: 9,
    id: "purchase_order",
    title: "9. Purchase Order",
    shortTitle: "Purchase Order",
    role: "Procurement / ERP",
    description: "ERP Purchase Order is automatically or manually generated from executed contract.",
    timing: "Follows Finance Approval",
  },
  {
    step: 10,
    id: "supplier_acceptance",
    title: "10. Supplier Acceptance",
    shortTitle: "Supplier Acceptance",
    role: "Winning Supplier",
    description: "Supplier reviews finalized terms and accepts contract via the Supplier Portal.",
    timing: "Follows Purchase Order Creation",
  },
  {
    step: 11,
    id: "completed",
    title: "11. Contract Completed",
    shortTitle: "Completed",
    role: "Live in ERP",
    description: "Contract is fully executed, active in ERP, and monitored for milestones and SLA.",
    timing: "Active Contract Lifecycle",
  },
];

export type StepState = "completed" | "current" | "upcoming";

export interface ContractWorkflowStepperProps {
  /** If the contract has already been handed off/created */
  contractCreated?: boolean;
  /** Active phase in contract lifecycle (e.g. legal_review, signature, finance_review, procurement, completed) */
  phase?: string;
  /** Active status text */
  status?: string;
  /** Optional direct current step number override (1-11) */
  activeStep?: number;
  /** Compact presentation mode */
  compact?: boolean;
}

export function determineActiveStep(
  contractCreated: boolean,
  phase?: string,
  status?: string
): { activeStep: number; stepStates: Record<number, StepState> } {
  let active = 3; // Default for pending contract request: Step 3 (Procurement Details)

  if (contractCreated) {
    const normPhase = String(phase || "").toLowerCase();
    const normStatus = String(status || "").toLowerCase();

    if (normPhase === "completed" || normStatus.includes("completed") || normStatus.includes("active")) {
      active = 11;
    } else if (normStatus.includes("supplier") || normStatus.includes("acceptance")) {
      active = 10;
    } else if (normPhase === "procurement" || normStatus.includes("purchase order") || normStatus.includes("po")) {
      active = 9;
    } else if (normPhase === "finance_review" || normStatus.includes("finance")) {
      active = 8;
    } else if (normPhase === "signature" || normStatus.includes("signature") || normStatus.includes("signed")) {
      active = 7;
    } else if (normStatus.includes("legal approval")) {
      active = 6;
    } else {
      // Default when contract exists: Legal Review
      active = 5;
    }
  }

  const stepStates: Record<number, StepState> = {};
  for (let s = 1; s <= 11; s++) {
    if (s < active) {
      stepStates[s] = "completed";
    } else if (s === active) {
      stepStates[s] = "current";
    } else {
      stepStates[s] = "upcoming";
    }
  }

  // If completed, step 11 is also completed
  if (active === 11 && (String(phase).toLowerCase() === "completed" || String(status).toLowerCase().includes("completed"))) {
    stepStates[11] = "completed";
  }

  return { activeStep: active, stepStates };
}

export default function ContractWorkflowStepper({
  contractCreated = false,
  phase,
  status,
  activeStep: explicitActiveStep,
  compact = false,
}: ContractWorkflowStepperProps) {
  const containerId = useId();
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const { activeStep: calculatedStep, stepStates } = determineActiveStep(contractCreated, phase, status);
  const activeStep = explicitActiveStep || calculatedStep;

  // Re-adjust states if explicit step given
  const resolvedStates: Record<number, StepState> = { ...stepStates };
  if (explicitActiveStep) {
    for (let s = 1; s <= 11; s++) {
      if (s < explicitActiveStep) resolvedStates[s] = "completed";
      else if (s === explicitActiveStep) resolvedStates[s] = "current";
      else resolvedStates[s] = "upcoming";
    }
  }

  return (
    <div
      className="min-w-0 rounded-2xl border border-slate-200 bg-gradient-to-b from-white via-slate-50/40 to-slate-50 p-4 shadow-sm sm:p-5"
      aria-label="Contract Lifecycle Workflow Progress"
    >
      {/* Stepper Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              End-to-End Contract Lifecycle
            </h3>
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 border border-blue-200/60">
              11-Step Process
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {contractCreated ? (
              <span>
                Current Stage: <span className="text-blue-700">{CONTRACT_WORKFLOW_STEPS[activeStep - 1]?.title}</span>
              </span>
            ) : (
              <span>
                Current Stage: <span className="text-amber-800">Step 3 — Procurement Details & Document Upload</span>
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-slate-600 font-medium">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Done
          </span>
          <span className="inline-flex items-center gap-1.5 text-blue-700 font-semibold">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-600 ring-2 ring-blue-200" /> Active
          </span>
          <span className="inline-flex items-center gap-1.5 text-slate-400">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-200" /> Upcoming
          </span>
        </div>
      </div>

      {/* Stepper Horizontal Scrollable Track */}
      <div className="mt-4 overflow-x-auto pb-2 pt-1 no-scrollbar">
        <ol
          id={containerId}
          className="flex min-w-[980px] items-start justify-between gap-1 sm:gap-2"
          role="list"
        >
          {CONTRACT_WORKFLOW_STEPS.map((item, idx) => {
            const state = resolvedStates[item.step];
            const isCompleted = state === "completed";
            const isCurrent = state === "current";
            const isSelected = expandedStep === item.step;

            return (
              <li
                key={item.id}
                className="group relative flex flex-1 flex-col items-center text-center cursor-pointer min-w-[82px]"
                onClick={() => setExpandedStep(isSelected ? null : item.step)}
                title={`${item.title} (${item.role}): ${item.description}`}
              >
                {/* Connecting track line between steps */}
                {idx > 0 && (
                  <div
                    className={`absolute top-4 -left-1/2 w-full h-[2.5px] -z-0 transition-colors ${
                      isCompleted || (isCurrent && resolvedStates[item.step - 1] === "completed")
                        ? "bg-emerald-400"
                        : "bg-slate-200"
                    }`}
                    style={{ left: "-50%", width: "100%" }}
                    aria-hidden="true"
                  />
                )}

                {/* Step Circle / Badge */}
                <div
                  className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all shadow-xs ${
                    isCompleted
                      ? "bg-emerald-600 text-white ring-4 ring-emerald-100 hover:bg-emerald-700"
                      : isCurrent
                      ? "bg-blue-600 text-white ring-4 ring-blue-100 animate-pulse-slow shadow-md hover:bg-blue-700"
                      : "bg-white text-slate-500 border border-slate-300 hover:border-slate-400"
                  }`}
                >
                  {isCompleted ? (
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <span>{item.step}</span>
                  )}
                </div>

                {/* Step Labels */}
                <div className="mt-2 flex flex-col items-center">
                  <span
                    className={`text-[11px] font-bold leading-tight ${
                      isCurrent
                        ? "text-blue-900 underline decoration-blue-500 decoration-2 underline-offset-2"
                        : isCompleted
                        ? "text-slate-800"
                        : "text-slate-500"
                    }`}
                  >
                    {item.shortTitle}
                  </span>
                  <span
                    className={`mt-0.5 text-[10px] leading-tight font-medium ${
                      isCurrent
                        ? "text-blue-700 font-semibold"
                        : isCompleted
                        ? "text-emerald-700 font-semibold"
                        : "text-slate-400"
                    }`}
                  >
                    {item.role}
                  </span>

                  {/* Current Action Badge */}
                  {isCurrent && (
                    <span className="mt-1 inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider text-blue-800 border border-blue-200">
                      Current
                    </span>
                  )}
                  {isCompleted && item.step === 1 && (
                    <span className="mt-1 inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-700 border border-emerald-200">
                      Done
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Expanded detail box (if clicked or current step) */}
      {!compact && (
        <div className="mt-3.5 rounded-xl border border-slate-200/90 bg-white p-3.5 text-xs text-slate-700 shadow-xs">
          {(() => {
            const displayStep = expandedStep ? CONTRACT_WORKFLOW_STEPS[expandedStep - 1] : CONTRACT_WORKFLOW_STEPS[activeStep - 1];
            if (!displayStep) return null;
            const state = resolvedStates[displayStep.step];

            return (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      state === "completed"
                        ? "bg-emerald-100 text-emerald-800"
                        : state === "current"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {displayStep.step}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">
                      {displayStep.title} &mdash; <span className="font-medium text-slate-600">{displayStep.role}</span>
                    </p>
                    <p className="text-slate-600 mt-0.5">{displayStep.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      state === "completed"
                        ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                        : state === "current"
                        ? "bg-blue-50 text-blue-800 border border-blue-200"
                        : "bg-slate-50 text-slate-600 border border-slate-200"
                    }`}
                  >
                    {state === "completed" ? "✓ Completed" : state === "current" ? "● In Progress / Action Required" : "Upcoming"}
                  </span>
                  {expandedStep && (
                    <button
                      type="button"
                      className="text-slate-400 hover:text-slate-600 text-xs font-medium ml-1"
                      onClick={() => setExpandedStep(null)}
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
