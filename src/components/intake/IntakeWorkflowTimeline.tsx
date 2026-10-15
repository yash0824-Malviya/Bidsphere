import React from "react";
import { Check, X, Briefcase, ShieldCheck, DollarSign, Sparkles, Layers, Wrench, Scale, FileCheck } from "lucide-react";
import type { BusinessCase } from "../../types/businessIntake";

interface TimelineProps {
  businessCase?: BusinessCase | null;
  need?: any; // kept optional for backwards compatibility
}

interface Step {
  id: string;
  title: string;
  role: string;
  status: "completed" | "current" | "pending" | "rejected";
  date?: string;
  notes?: string;
  icon: React.ElementType;
}

export function IntakeWorkflowTimeline({ businessCase }: TimelineProps) {
  const steps: Step[] = [];

  const wf = businessCase?.workflow_status;
  const isCaseRejected = wf === "Rejected";

  // Step 1: Business Case Creation & Submission (Department User)
  const caseCreated = Boolean(businessCase);
  const caseSubmitted = caseCreated && wf !== "Draft";
  steps.push({
    id: "business_case",
    title: "Business Case",
    role: "Department User",
    status: caseSubmitted ? "completed" : caseCreated ? "current" : "pending",
    date: businessCase?.created_date ? new Date(businessCase.created_date).toLocaleDateString() : undefined,
    notes: businessCase ? (caseSubmitted ? `${businessCase.business_case_id} Submitted` : "Draft Saved") : undefined,
    icon: Layers,
  });

  // Step 2: Technical Review (Engineer)
  const isEngReviewPending = wf === "Pending Engineering" || wf === "Submitted";
  const engReviewDone =
    caseSubmitted &&
    wf !== "Pending Engineering" &&
    wf !== "Submitted" &&
    (businessCase?.engineering_status === "Under Review" ||
     businessCase?.engineering_status === "Approved" ||
     wf === "Pending Engineering Manager" ||
     wf === "Pending Finance" ||
     wf === "Pending Finance Review" ||
     wf === "Revision Required (Finance)" ||
     wf === "Revision Required - Finance" ||
     wf === "Pending Legal" ||
     wf === "Pending Legal Review" ||
     wf === "Pending Procurement" ||
     wf === "Ready for RFQ" ||
     wf === "Approved" ||
     wf === "RFQ Created");

  steps.push({
    id: "engineer_review",
    title: "Technical Review",
    role: "Engineer",
    status: isCaseRejected && !engReviewDone
      ? "rejected"
      : engReviewDone
      ? "completed"
      : isEngReviewPending
      ? "current"
      : "pending",
    notes: engReviewDone ? "Technical specs reviewed" : isEngReviewPending ? "Active Review" : undefined,
    icon: Wrench,
  });

  // Step 3: Engineering Approval (Engineering Manager)
  const isEngMgrCurrent = wf === "Pending Engineering Manager";
  const engineeringApproved =
    businessCase?.engineering_status === "Approved" ||
    (caseSubmitted &&
      !isEngReviewPending &&
      !isEngMgrCurrent &&
      (wf === "Pending Finance" ||
       wf === "Pending Finance Review" ||
       wf === "Revision Required (Finance)" ||
       wf === "Revision Required - Finance" ||
       wf === "Pending Legal" ||
       wf === "Pending Legal Review" ||
       wf === "Pending Procurement" ||
       wf === "Ready for RFQ" ||
       wf === "Approved" ||
       wf === "RFQ Created"));

  steps.push({
    id: "engineering_approval",
    title: "Engineering Approval",
    role: "Engineering Manager",
    status: isCaseRejected && !engineeringApproved
      ? "rejected"
      : engineeringApproved
      ? "completed"
      : isEngMgrCurrent
      ? "current"
      : "pending",
    notes: engineeringApproved ? "Engineering Feasibility Approved" : isEngMgrCurrent ? "Awaiting Decision" : undefined,
    icon: ShieldCheck,
  });

  // Step 4: Finance Approval Gate (Finance Manager)
  const financeApproved = businessCase?.finance_status === "Approved";
  const financeRejected = businessCase?.finance_status === "Rejected" || (isCaseRejected && engineeringApproved && !financeApproved);
  const isFinanceCurrent =
    engineeringApproved &&
    !financeApproved &&
    !financeRejected &&
    (wf === "Pending Finance" ||
     wf === "Pending Finance Review" ||
     wf === "Revision Required (Finance)" ||
     wf === "Revision Required - Finance" ||
     businessCase?.current_stage === "Finance Approval" ||
     businessCase?.current_stage === "Finance Review" ||
     businessCase?.finance_status === "Revision Required" ||
     businessCase?.finance_status === "Revision Requested" ||
     businessCase?.finance_status === "Pending" ||
     !businessCase?.finance_status);

  steps.push({
    id: "finance_review",
    title: "Finance Approval",
    role: "Finance Manager",
    status: financeRejected
      ? "rejected"
      : financeApproved
      ? "completed"
      : isFinanceCurrent
      ? "current"
      : "pending",
    date: businessCase?.finance_approved_date
      ? new Date(businessCase.finance_approved_date).toLocaleDateString()
      : undefined,
    notes: businessCase?.finance_comments || (financeApproved ? "Budget & Financials Approved" : isFinanceCurrent ? "Finance Decision Required" : undefined),
    icon: DollarSign,
  });

  // Step 5: Legal Review & Compliance Gate (Legal Manager)
  const legalApproved = businessCase?.legal_status === "Approved";
  const legalRejected = businessCase?.legal_status === "Rejected" || (isCaseRejected && financeApproved && !legalApproved);
  const isLegalCurrent =
    financeApproved &&
    !legalApproved &&
    !legalRejected &&
    (wf === "Pending Legal" ||
     wf === "Pending Legal Review" ||
     wf === "Revision Required (Legal)" ||
     wf === "Revision Required - Legal" ||
     businessCase?.current_stage === "Legal Approval" ||
     businessCase?.current_stage === "Legal Review" ||
     businessCase?.legal_status === "Pending" ||
     !businessCase?.legal_status);

  steps.push({
    id: "legal_review",
    title: "Legal Approval",
    role: "Legal Manager",
    status: legalRejected
      ? "rejected"
      : legalApproved
      ? "completed"
      : isLegalCurrent
      ? "current"
      : "pending",
    date: businessCase?.legal_approved_date
      ? new Date(businessCase.legal_approved_date).toLocaleDateString()
      : undefined,
    notes: businessCase?.legal_comments || (legalApproved ? "Legal & Compliance E-Signed" : isLegalCurrent ? "E-Signature & Review" : undefined),
    icon: Scale,
  });

  // Step 6: Procurement Review (Procurement Manager)
  const isProcurementPending = wf === "Pending Procurement" || (financeApproved && legalApproved && wf !== "Ready for RFQ" && wf !== "Approved" && wf !== "RFQ Created");
  const isProcurementReady =
    wf === "Ready for RFQ" ||
    wf === "Approved" ||
    wf === "Procurement Ready" ||
    wf === "Approved - Ready for RFQ" ||
    businessCase?.procurement_status === "Approved";
  const rfqCreated = Boolean(businessCase?.rfq_id || wf === "RFQ Created");
  const isProcurementDone = isProcurementReady || rfqCreated;

  steps.push({
    id: "procurement_queue",
    title: "Procurement Review",
    role: "Procurement Manager",
    status: isCaseRejected && !isProcurementDone
      ? "rejected"
      : isProcurementDone
      ? "completed"
      : isProcurementPending
      ? "current"
      : "pending",
    notes: rfqCreated
      ? `Converted to RFQ ${businessCase?.rfq_id}`
      : isProcurementReady
      ? "Procurement Approved"
      : isProcurementPending
      ? "Active Procurement Review"
      : undefined,
    icon: Briefcase,
  });

  // Step 7: Ready for RFQ
  steps.push({
    id: "ready_for_rfq",
    title: "Ready for RFQ",
    role: "Procurement Manager",
    status: rfqCreated || isProcurementReady ? "completed" : "pending",
    notes: isProcurementReady ? "Procurement Cleared" : undefined,
    icon: FileCheck,
  });

  // Step 8: Create RFQ (Procurement Manager)
  steps.push({
    id: "create_rfq",
    title: "Create RFQ",
    role: "Procurement Manager",
    status: rfqCreated ? "completed" : isProcurementReady ? "current" : "pending",
    notes: rfqCreated
      ? `RFQ ${businessCase?.rfq_id} Active`
      : isProcurementReady
      ? "Ready to create RFQ"
      : "Existing Sourcing Flow",
    icon: Sparkles,
  });

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5 shadow-xs">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 pb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-600">
          Sequential Business Case Lifecycle
        </h3>
        <span className="text-[11px] sm:text-xs text-neutral-500 font-medium">
          Case → Technical Review → Engineering Mgr → Finance → Legal → Procurement → Ready for RFQ → Create RFQ
        </span>
      </div>

      <div className="relative overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="min-w-[760px] lg:min-w-0 relative">
          {/* Horizontal connecting line centered between column 1 and column 8 */}
          <div className="absolute left-[6.25%] top-4 hidden h-0.5 w-[87.5%] bg-neutral-200 sm:block" />

          <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
            {steps.map((step) => {
              let circleBg = "bg-neutral-100 text-neutral-500 border-neutral-300";
              let statusBadge = "bg-neutral-100 text-neutral-600 border-neutral-200";
              let badgeText = "Pending";

              if (step.status === "completed") {
                circleBg = "bg-emerald-600 text-white border-emerald-600 shadow-xs";
                statusBadge = "bg-emerald-50 text-emerald-700 border-emerald-200";
                badgeText = "Done";
              } else if (step.status === "current") {
                circleBg = "bg-primary-600 text-white border-primary-600 ring-4 ring-primary-100 animate-pulse";
                statusBadge = "bg-primary-50 text-primary-700 border-primary-300 font-bold";
                badgeText = "Active Gate";
              } else if (step.status === "rejected") {
                circleBg = "bg-red-600 text-white border-red-600";
                statusBadge = "bg-red-50 text-red-700 border-red-200";
                badgeText = "Rejected";
              }

              const StepIcon = step.icon as React.ComponentType<{ className?: string }>;

              return (
                <div key={step.id} className="relative flex flex-col items-center text-center">
                  <div
                    className={`z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all ${circleBg}`}
                  >
                    {step.status === "completed" && <Check className="h-4 w-4 stroke-[2.5]" />}
                    {step.status === "rejected" && <X className="h-4 w-4 stroke-[2.5]" />}
                    {step.status !== "completed" && step.status !== "rejected" && <StepIcon className="h-4 w-4" />}
                  </div>

                  <div className="mt-1 flex flex-col items-center">
                    <span className="text-xs font-semibold text-neutral-900 leading-tight">{step.title}</span>
                    <span className="text-[10px] text-neutral-500 leading-tight mt-0.5">{step.role}</span>

                    <span
                      className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] sm:text-[10px] font-semibold ${statusBadge}`}
                    >
                      {badgeText}
                    </span>

                    {step.date && (
                      <span className="mt-0.5 text-[10px] text-neutral-400 font-medium">{step.date}</span>
                    )}

                    {step.notes && (
                      <span className="mt-0.5 max-w-[120px] text-[10px] leading-tight text-neutral-500 line-clamp-1 truncate">
                        {step.notes}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
