import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Paperclip,
  ArrowUpRight,
  Briefcase,
  Edit,
} from "lucide-react";

import {
  fetchBusinessNeedById,
  fetchBusinessCaseById,
} from "../../api/businessIntake";
import { IntakeWorkflowTimeline } from "../../components/intake/IntakeWorkflowTimeline";
import { IntakeApprovalBadge } from "../../components/intake/IntakeApprovalBadge";
import { formatCurrency } from "../../utils/format";

export default function BusinessNeedDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: need, isLoading } = useQuery({
    queryKey: ["business-need", id],
    queryFn: () => fetchBusinessNeedById(id || ""),
    enabled: Boolean(id),
  });

  const { data: linkedCase } = useQuery({
    queryKey: ["business-case", need?.business_case],
    queryFn: () => fetchBusinessCaseById(need?.business_case || ""),
    enabled: Boolean(need?.business_case),
  });

  if (isLoading) {
    return (
      <div className="p-8 text-center text-neutral-500">
        Loading Business Need details...
      </div>
    );
  }

  if (!need) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-lg font-bold text-neutral-900">Business Need Not Found</h2>
        <Link to="/intake/business-needs" className="mt-2 text-sm text-primary-600 hover:underline inline-block">
          Return to Business Needs List
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Top Back Nav */}
      <div>
        <Link
          to="/intake/business-needs"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-600 hover:text-primary-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Business Needs
        </Link>
      </div>

      {/* Header Banner */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm font-bold text-primary-700">{need.business_need_id}</span>
              <IntakeApprovalBadge status={need.status} size="md" />
            </div>
            <h1 className="mt-1 text-xl font-bold text-neutral-900">{need.title}</h1>
            <p className="mt-1 text-xs text-neutral-500">
              Submitted by <span className="font-semibold text-neutral-700">{need.requester}</span> ({need.department}) on{" "}
              {new Date(need.created_date).toLocaleDateString()}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {need.status === "Draft" && (
              <Link
                to={`/intake/business-needs/${need.business_need_id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary-700 transition-colors"
              >
                <Edit className="h-4 w-4" />
                Edit & Complete Draft
              </Link>
            )}
            {need.business_case && (
              <Link
                to={`/intake/business-cases/${need.business_case}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"
              >
                <Briefcase className="h-4 w-4" />
                View Linked Case ({need.business_case})
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Workflow Lifecycle Timeline */}
      <IntakeWorkflowTimeline need={need} businessCase={linkedCase} />

      {/* Requirement Details Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Problem Statement & Justification */}
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-600 border-b border-neutral-200 pb-2">
              Problem Statement & Business Justification
            </h3>
            <div>
              <span className="text-xs font-semibold text-neutral-700 block">Problem Statement:</span>
              <p className="mt-1 text-xs text-neutral-800 leading-relaxed">{need.problem_statement}</p>
            </div>
            {need.description && (
              <div>
                <span className="text-xs font-semibold text-neutral-700 block">Requirement Description:</span>
                <p className="mt-1 text-xs text-neutral-800 leading-relaxed whitespace-pre-line">{need.description}</p>
              </div>
            )}
            {need.current_situation && (
              <div>
                <span className="text-xs font-semibold text-neutral-700 block">Current Situation:</span>
                <p className="mt-1 text-xs text-neutral-800 leading-relaxed">{need.current_situation}</p>
              </div>
            )}
            {need.business_impact && (
              <div>
                <span className="text-xs font-semibold text-neutral-700 block">Expected Business Impact:</span>
                <p className="mt-1 text-xs text-neutral-800 leading-relaxed">{need.business_impact}</p>
              </div>
            )}
          </div>

          {/* Attached Specifications */}
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-600 border-b border-neutral-200 pb-2">
              Attached Specifications & Documents
            </h3>
            {need.attachments.length === 0 && (!need.business_need_documents || need.business_need_documents.length === 0) ? (
              <p className="text-xs text-neutral-500">No specification files attached.</p>
            ) : (
              <div className="space-y-2">
                {need.attachments.map((att, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs">
                    <span className="font-medium text-neutral-700 flex items-center gap-2">
                      <Paperclip className="h-4 w-4 text-neutral-400" />
                      {att.url ? (
                        <a
                          href={att.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-primary-600 hover:underline"
                        >
                          {att.name}
                        </a>
                      ) : (
                        att.name
                      )}
                    </span>
                    <span className="text-neutral-500">{att.size || "1.2 MB"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Metadata */}
        <div className="space-y-6">
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-600 border-b border-neutral-200 pb-2">
              Key Need Attributes
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-neutral-500 block">Company</span>
                <span className="font-semibold text-neutral-800">{need.company}</span>
              </div>
              <div>
                <span className="text-neutral-500 block">Department</span>
                <span className="font-semibold text-neutral-800">{need.department}</span>
              </div>
              <div>
                <span className="text-neutral-500 block">Business Unit / Plant</span>
                <span className="font-semibold text-neutral-800">{need.business_unit || "Operations"} ({need.plant || "Main Facility"})</span>
              </div>
              <div>
                <span className="text-neutral-500 block">Project / Program</span>
                <span className="font-semibold text-neutral-800">{need.project || "—"} / {need.program || "—"}</span>
              </div>
              <div>
                <span className="text-neutral-500 block">Estimated Budget</span>
                <span className="font-bold text-lg text-emerald-700">{formatCurrency(need.estimated_budget)} ({need.budget_type || "CAPEX"})</span>
              </div>
              <div>
                <span className="text-neutral-500 block">Need Type / Priority</span>
                <span className="font-medium text-neutral-800">{need.need_type} / {need.priority} Priority</span>
              </div>
              <div>
                <span className="text-neutral-500 block">Target Completion Date</span>
                <span className="font-medium text-neutral-800">{need.expected_completion_date || "—"}</span>
              </div>
              <div>
                <span className="text-neutral-500 block">Business Owner</span>
                <span className="font-medium text-neutral-800">{need.business_owner}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
