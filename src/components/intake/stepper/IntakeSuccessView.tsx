import { Link } from "react-router-dom";
import { CheckCircle2, ArrowRight, Briefcase, FileText, List } from "lucide-react";

interface Props {
  businessNeedId: string;
  businessNeedTitle: string;
  businessCaseId?: string;
  workflowStage?: string;
}

export function IntakeSuccessView({
  businessNeedId,
  businessNeedTitle,
  businessCaseId,
  workflowStage = "Pending Finance Review",
}: Props) {
  return (
    <div className="mx-auto max-w-3xl py-8 px-4">
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm text-center space-y-6">
        {/* Success Icon */}
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 shadow-xs">
          <CheckCircle2 className="h-9 w-9" />
        </div>

        {/* Title & Subtitle */}
        <div>
          <h2 className="text-2xl font-bold text-neutral-900">
            Business Need Submitted Successfully
          </h2>
          <p className="mt-2 text-sm text-neutral-600 max-w-lg mx-auto">
            Your business requirement has been registered in the ERPNext procurement system and routed for evaluation.
          </p>
        </div>

        {/* Record Linkage Card */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-xl bg-neutral-50 p-5 border border-neutral-200/80 text-left">
          {/* Business Need ID */}
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
              Business Need ID
            </span>
            <div className="flex items-center gap-1.5 font-mono text-base font-bold text-primary-700">
              <FileText className="h-4 w-4 text-primary-500" />
              {businessNeedId}
            </div>
            <p className="text-[11px] text-neutral-500 truncate" title={businessNeedTitle}>
              {businessNeedTitle}
            </p>
          </div>

          {/* Linked Business Case ID */}
          <div className="space-y-1 sm:border-l sm:border-neutral-200 sm:pl-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
              Auto-Generated Case
            </span>
            <div className="flex items-center gap-1.5 font-mono text-base font-bold text-emerald-700">
              <Briefcase className="h-4 w-4 text-emerald-500" />
              {businessCaseId || "Creating..."}
            </div>
            <p className="text-[11px] text-neutral-500">
              Inherited context & specs
            </p>
          </div>

          {/* Current Lifecycle Stage */}
          <div className="space-y-1 sm:border-l sm:border-neutral-200 sm:pl-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
              Current Stage
            </span>
            <div className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 border border-amber-200">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
              {workflowStage}
            </div>
            <p className="text-[11px] text-neutral-500">
              Queued for Finance evaluation
            </p>
          </div>
        </div>

        {/* Lifecycle Explanation */}
        <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 text-xs text-blue-900 text-left">
          <p className="font-semibold text-blue-950 mb-1">Workflow Progression</p>
          <p className="text-blue-800 leading-relaxed">
            Finance will review budget assumptions and financial modeling. Once approved, the case progresses to <strong>Legal Review</strong>, followed by <strong>Procurement RFQ generation</strong>. You will receive notifications on status updates.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-neutral-100">
          <Link
            to={`/intake/business-needs/${businessNeedId}`}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-xs font-bold text-neutral-700 shadow-2xs hover:bg-neutral-50"
          >
            <FileText className="h-4 w-4 text-neutral-500" />
            View Business Need
          </Link>

          {businessCaseId && (
            <Link
              to={`/intake/business-cases/${businessCaseId}`}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"
            >
              <Briefcase className="h-4 w-4" />
              View Business Case
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}

          <Link
            to="/intake/business-needs"
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-primary-700"
          >
            <List className="h-4 w-4" />
            Return to Business Needs List
          </Link>
        </div>
      </div>
    </div>
  );
}
