import { Edit3, AlertCircle, FileText } from "lucide-react";
import type { Step1Data } from "./Step1Requirement";
import type { Step2Data } from "./Step2Organization";
import type { Step3Data } from "./Step3ProjectContext";
import type { Step4Data } from "./Step4Budget";
import type { IntakeAttachment } from "../../../types/businessIntake";

interface Props {
  step1: Step1Data;
  step2: Step2Data;
  step3: Step3Data;
  step4: Step4Data;
  attachments: IntakeAttachment[];
  onGoToStep: (stepId: number) => void;
  acknowledged: boolean;
  onToggleAcknowledge: (val: boolean) => void;
  isValid: boolean;
  validationErrors: string[];
}

export function Step6ReviewSubmit({
  step1,
  step2,
  step3,
  step4,
  attachments,
  onGoToStep,
  acknowledged,
  onToggleAcknowledge,
  isValid,
  validationErrors,
}: Props) {
  return (
    <div className="space-y-0">
      {/* ── Section Header ── */}
      <div className="px-6 sm:px-8 py-5 border-b border-neutral-100">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[15px] font-bold text-neutral-900 tracking-tight">
            Review &amp; Submission
          </h2>
          <span className="text-[11px] font-medium text-neutral-400">
            Step 6 of 6 &middot; Final Verification
          </span>
        </div>
        <p className="mt-1 text-[12.5px] text-neutral-500">
          Review all entered information before submitting. You can edit any step before final submission.
        </p>
      </div>

      {/* ── Review Body ── */}
      <div className="px-6 sm:px-8 py-6 space-y-6">
        {/* Validation Alert */}
        {!isValid && validationErrors.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50/70 p-4">
          <div className="flex gap-3">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-red-900">
                Please complete required fields before final submission:
              </p>
              <ul className="mt-1.5 list-disc list-inside text-xs text-red-700 space-y-0.5">
                {validationErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Section 1: Requirement */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4.5 space-y-3">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-800 flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-primary-100 text-primary-700 text-[11px] flex items-center justify-center font-bold">1</span>
              Requirement
            </h3>
            <button
              type="button"
              onClick={() => onGoToStep(1)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-800"
            >
              <Edit3 className="h-3 w-3" /> Edit
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="sm:col-span-3">
              <span className="text-neutral-400 font-medium">Title:</span>
              <p className="font-semibold text-neutral-900 mt-0.5">{step1.title || "—"}</p>
            </div>
            <div>
              <span className="text-neutral-400 font-medium">Priority:</span>
              <p className="font-semibold text-neutral-900 mt-0.5">{step1.priority}</p>
            </div>
            <div>
              <span className="text-neutral-400 font-medium">Need Type:</span>
              <p className="font-semibold text-neutral-900 mt-0.5">{step1.need_type}</p>
            </div>
            <div>
              <span className="text-neutral-400 font-medium">Category:</span>
              <p className="font-semibold text-neutral-900 mt-0.5">{step1.requirement_category || "—"}</p>
            </div>
            <div className="sm:col-span-3">
              <span className="text-neutral-400 font-medium">Problem Statement:</span>
              <p className="text-neutral-800 mt-1 whitespace-pre-wrap rounded-lg bg-neutral-50 p-2.5 border border-neutral-100">
                {step1.problem_statement || "—"}
              </p>
            </div>
            <div className="sm:col-span-3">
              <span className="text-neutral-400 font-medium">Business Justification:</span>
              <p className="text-neutral-800 mt-1 whitespace-pre-wrap rounded-lg bg-neutral-50 p-2.5 border border-neutral-100">
                {step1.business_justification || "—"}
              </p>
            </div>

            {step1.technical_requirements_list && step1.technical_requirements_list.length > 0 && (
              <div className="sm:col-span-3 pt-2 border-t border-neutral-100">
                <span className="text-neutral-500 font-bold block mb-1.5">Technical Requirements ({step1.technical_requirements_list.length}):</span>
                <div className="space-y-1.5">
                  {step1.technical_requirements_list.map((tr, idx) => (
                    <div key={idx} className="rounded-lg bg-neutral-50 p-2.5 border border-neutral-200 text-xs">
                      <div className="flex items-center justify-between font-semibold text-neutral-900">
                        <span>{idx + 1}. [{tr.requirement_type}] {tr.specification}</span>
                        <span className="font-mono text-neutral-600">{tr.quantity} {tr.uom}</span>
                      </div>
                      {tr.performance_requirements && (
                        <p className="text-[11px] text-neutral-500 mt-0.5">Perf: {tr.performance_requirements}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Organization */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4.5 space-y-3">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-800 flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-primary-100 text-primary-700 text-[11px] flex items-center justify-center font-bold">2</span>
              Organization & Ownership
            </h3>
            <button
              type="button"
              onClick={() => onGoToStep(2)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-800"
            >
              <Edit3 className="h-3 w-3" /> Edit
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-neutral-400 font-medium">Company:</span>
              <p className="font-semibold text-neutral-900 mt-0.5">{step2.company || "—"}</p>
            </div>
            <div>
              <span className="text-neutral-400 font-medium">Department:</span>
              <p className="font-semibold text-neutral-900 mt-0.5">{step2.department || "—"}</p>
            </div>
            <div>
              <span className="text-neutral-400 font-medium">Plant:</span>
              <p className="font-semibold text-neutral-900 mt-0.5">{step2.plant || "—"}</p>
            </div>
            <div>
              <span className="text-neutral-400 font-medium">Business Owner:</span>
              <p className="font-semibold text-neutral-900 mt-0.5">{step2.business_owner || "—"}</p>
            </div>
          </div>
        </div>

        {/* Section 3: Project Context & Dates */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4.5 space-y-3">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-800 flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-primary-100 text-primary-700 text-[11px] flex items-center justify-center font-bold">3</span>
              Project & Dates
            </h3>
            <button
              type="button"
              onClick={() => onGoToStep(3)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-800"
            >
              <Edit3 className="h-3 w-3" /> Edit
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-neutral-400 font-medium">Project Name:</span>
              <p className="font-semibold text-neutral-900 mt-0.5">{step3.project_name || "—"}</p>
            </div>
            <div>
              <span className="text-neutral-400 font-medium">Project Code:</span>
              <p className="font-semibold text-neutral-900 mt-0.5">{step3.project_code || "—"}</p>
            </div>
            <div>
              <span className="text-neutral-400 font-medium">Required By:</span>
              <p className="font-semibold text-neutral-900 mt-0.5">{step3.required_by_date || "—"}</p>
            </div>
            <div>
              <span className="text-neutral-400 font-medium">Target Completion:</span>
              <p className="font-semibold text-neutral-900 mt-0.5">{step3.expected_completion_date || "—"}</p>
            </div>
          </div>
        </div>

        {/* Section 4: Budget */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4.5 space-y-3">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-800 flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-primary-100 text-primary-700 text-[11px] flex items-center justify-center font-bold">4</span>
              Initial Budget
            </h3>
            <button
              type="button"
              onClick={() => onGoToStep(4)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-800"
            >
              <Edit3 className="h-3 w-3" /> Edit
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-neutral-400 font-medium">Estimated Budget:</span>
              <p className="font-bold text-neutral-900 mt-0.5">
                {step4.estimated_budget ? `${step4.currency} ${Number(step4.estimated_budget).toLocaleString()}` : "—"}
              </p>
            </div>
            <div>
              <span className="text-neutral-400 font-medium">Classification:</span>
              <p className="font-semibold text-neutral-900 mt-0.5">{step4.budget_type || "CAPEX"}</p>
            </div>
            <div>
              <span className="text-neutral-400 font-medium">Quantity:</span>
              <p className="font-semibold text-neutral-900 mt-0.5">{step4.estimated_quantity || "1"}</p>
            </div>
            <div>
              <span className="text-neutral-400 font-medium">Nature:</span>
              <p className="font-semibold text-neutral-900 mt-0.5">{step4.requirement_type || "—"}</p>
            </div>
          </div>
        </div>

        {/* Section 5: Documents */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4.5 space-y-3">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-800 flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-primary-100 text-primary-700 text-[11px] flex items-center justify-center font-bold">5</span>
              Supporting Documents ({attachments.length})
            </h3>
            <button
              type="button"
              onClick={() => onGoToStep(5)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-800"
            >
              <Edit3 className="h-3 w-3" /> Edit
            </button>
          </div>

          {attachments.length === 0 ? (
            <p className="text-xs text-neutral-400 italic">No attachments attached.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {attachments.map((att, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-neutral-50 border border-neutral-200 text-xs">
                  <FileText className="h-3.5 w-3.5 text-neutral-500 shrink-0" />
                  <span className="truncate font-medium text-neutral-800">{att.name}</span>
                  <span className="text-[10px] text-neutral-400 shrink-0">({att.size})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation & Acknowledgment */}
      <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => onToggleAcknowledge(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="text-xs text-neutral-700 leading-relaxed">
            By submitting this Business Need, the requester confirms that the requirement and information provided are accurate to the best of their knowledge. Once submitted, a <strong>Business Case</strong> will be generated automatically and routed for <strong>Finance Review</strong>.
          </span>
        </label>
      </div>
      </div>
    </div>
  );
}
