import React from "react";
import { Check, X, FileText, Briefcase, ShieldCheck, DollarSign, Sparkles, Layers } from "lucide-react";
import type { BusinessNeed, BusinessCase } from "../../types/businessIntake";

interface TimelineProps {
  need?: BusinessNeed | null;
  businessCase?: BusinessCase | null;
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

export function IntakeWorkflowTimeline({ need, businessCase }: TimelineProps) {
  const steps: Step[] = [];

  // Step 1: Business Need Creation (Department User)
  const needCreated = Boolean(need);
  steps.push({
    id: "need_created",
    title: "Business Need",
    role: "Department User",
    status: needCreated ? "completed" : "pending",
    date: need?.created_date ? new Date(need.created_date).toLocaleDateString() : undefined,
    notes: need ? `${need.requester} (${need.department})` : undefined,
    icon: FileText,
  });

  // Step 2: Linked Business Case Created
  const caseCreated = Boolean(businessCase);
  steps.push({
    id: "case_created",
    title: "Business Case",
    role: "Auto-Generated",
    status: caseCreated ? "completed" : needCreated ? "current" : "pending",
    date: businessCase?.created_date ? new Date(businessCase.created_date).toLocaleDateString() : undefined,
    notes: businessCase ? `Linked ${businessCase.business_case_id}` : undefined,
    icon: Layers,
  });

  // Step 3: Finance Approval Gate
  const financeApproved = businessCase?.finance_status === "Approved";
  const financeRejected = businessCase?.finance_status === "Rejected";
  const isFinanceCurrent =
    businessCase?.workflow_status === "Pending Finance Review" ||
    businessCase?.workflow_status === "Revision Required - Finance" ||
    (businessCase?.finance_status === "Pending" && !financeApproved && !financeRejected);
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
    notes: businessCase?.finance_comments || (financeApproved ? "Financial & ROI Approval Granted" : undefined),
    icon: DollarSign,
  });

  // Step 4: Legal / Compliance Approval Gate
  const legalApproved = businessCase?.legal_status === "Approved";
  const legalRejected = businessCase?.legal_status === "Rejected";
  const isLegalCurrent =
    financeApproved &&
    (businessCase?.workflow_status === "Pending Legal Review" ||
      businessCase?.workflow_status === "Revision Required - Legal" ||
      (businessCase?.legal_status === "Pending" && !legalApproved && !legalRejected));
  steps.push({
    id: "legal_review",
    title: "Legal Approval",
    role: "Legal Reviewer",
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
    notes: businessCase?.legal_comments || (legalApproved ? "Legal & Sourcing Compliance Verified" : undefined),
    icon: ShieldCheck,
  });

  // Step 5: Procurement Queue
  const isProcurementPending = businessCase?.workflow_status === "Pending Procurement";
  const isProcurementReady =
    businessCase?.workflow_status === "Procurement Ready" ||
    businessCase?.workflow_status === "Approved - Ready for RFQ";
  const rfqCreated = Boolean(businessCase?.rfq_id || businessCase?.workflow_status === "RFQ Created");
  const isProcurementDone = isProcurementReady || rfqCreated;

  steps.push({
    id: "procurement_queue",
    title: "Procurement Queue",
    role: "Procurement Manager",
    status: isProcurementDone
      ? "completed"
      : isProcurementPending
      ? "current"
      : "pending",
    notes: rfqCreated
      ? `Converted to RFQ ${businessCase?.rfq_id}`
      : isProcurementReady
      ? "Procurement Ready (RFQ creation unlocked)"
      : isProcurementPending
      ? "Pending Procurement Review"
      : undefined,
    icon: Briefcase,
  });

  // Step 6: Create RFQ (Existing Sourcing Flow)
  steps.push({
    id: "create_rfq",
    title: "Create RFQ",
    role: "Sourcing Workspace",
    status: rfqCreated ? "completed" : isProcurementReady ? "current" : "pending",
    notes: rfqCreated
      ? `RFQ ${businessCase?.rfq_id} Active`
      : isProcurementReady
      ? "Ready to create RFQ"
      : "Existing Procurement Flow",
    icon: Sparkles,
  });

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-600">
          Enterprise Business Intake Lifecycle
        </h3>
        <span className="text-xs text-neutral-500 font-medium">Business Need → Business Case → Finance → Legal → Procurement Queue → RFQ</span>
      </div>

      <div className="relative">
        {/* Horizontal connecting line */}
        <div className="absolute left-6 top-5 hidden h-0.5 w-[calc(100%-3rem)] bg-neutral-200 lg:block" />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {steps.map((step) => {
            let circleBg = "bg-neutral-100 text-neutral-500 border-neutral-300";
            let statusBadge = "bg-neutral-100 text-neutral-600 border-neutral-200";
            let badgeText = "Pending";

            if (step.status === "completed") {
              circleBg = "bg-emerald-600 text-white border-emerald-600 shadow-sm";
              statusBadge = "bg-emerald-50 text-emerald-700 border-emerald-200";
              badgeText = "Done";
            } else if (step.status === "current") {
              circleBg = "bg-primary-600 text-white border-primary-600 ring-4 ring-primary-100 animate-pulse";
              statusBadge = "bg-primary-50 text-primary-700 border-primary-200";
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
                  className={`z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all ${circleBg}`}
                >
                  {step.status === "completed" && <Check className="h-5 w-5 stroke-[2.5]" />}
                  {step.status === "rejected" && <X className="h-5 w-5 stroke-[2.5]" />}
                  {step.status !== "completed" && step.status !== "rejected" && <StepIcon className="h-5 w-5" />}
                </div>

                <div className="mt-3 flex flex-col items-center">
                  <span className="text-xs font-semibold text-neutral-900">{step.title}</span>
                  <span className="text-[11px] font-medium text-neutral-500">{step.role}</span>

                  <span
                    className={`mt-1.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadge}`}
                  >
                    {badgeText}
                  </span>

                  {step.date && (
                    <span className="mt-1 text-[10px] text-neutral-500">{step.date}</span>
                  )}

                  {step.notes && (
                    <span className="mt-1 max-w-[130px] text-[10px] leading-tight text-neutral-500 line-clamp-2">
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
  );
}
