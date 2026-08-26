import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import {
  ECR_STAGE_WORKFLOW_MAP,
  canonicalECRStage,
  getECRWorkflowActions,
} from "../../config/ecrRoles";
import { getCurrentECRApprovalTask } from "./ecrDetailModel";
import type { AppRole } from "../../config/roles";
import type { ECRApprovalRequirement, ECRStatus } from "../../types/erpnext";

const FIELD_PLACEHOLDERS: Record<string, string> = {
  "Technical Feasibility": "Assess whether the proposed change is technically feasible...",
  "Engineering Impact": "Describe the impact on design, interfaces, performance, or configuration...",
  "Technical Requirements": "Record technical constraints or verification requirements...",
  "Procurement Assessment": "Record the procurement assessment for this change...",
};

const PROCUREMENT_REVIEW_OPTIONS: Partial<Record<string, readonly string[]>> = {
  "Supplier Requirement": ["Yes", "No"],
  "RFQ Requirement": ["Required", "Not Required"],
};

export default function ECRApprovalPanel({
  role,
  status,
  approvalRequirements = [],
  pending = false,
  error,
  onAction,
}: {
  role?: AppRole | null;
  status?: ECRStatus | string | null;
  approvalRequirements?: ECRApprovalRequirement[];
  pending?: boolean;
  error?: string | null;
  onAction: (
    action: string,
    comment: string,
    reviewFields?: Record<string, string>,
  ) => void;
}) {
  const actions = useMemo(
    () => getECRWorkflowActions(role, status).filter((action) =>
      ["Send Back", "Reject", "Approve"].includes(action.action),
    ),
    [role, status],
  );
  const canonicalStage = canonicalECRStage(status);
  const stageConfig = ECR_STAGE_WORKFLOW_MAP[canonicalStage];
  const isReviewStage =
    canonicalStage === "Engineering Review" || canonicalStage === "Procurement Review";
  const assessmentFields = stageConfig?.assessmentFields || [];
  const requiredFields = stageConfig?.requiredAssessmentFields ?? [];
  const currentTask = getCurrentECRApprovalTask(
    status,
    role,
    approvalRequirements,
  );

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [comments, setComments] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  if (actions.length === 0 || !isReviewStage || !stageConfig || !currentTask) return null;

  const commentLabel = stageConfig.commentsLabel ?? "Review Comments";
  const title = stageConfig.decisionTitle;
  const isAssessmentComplete = requiredFields.every((field) => Boolean(notes[field]?.trim()));

  function validate(action: string): string | null {
    if (!["Send Back", "Reject", "Approve"].includes(action)) {
      return "This action is not available in the simplified ECR workflow.";
    }
    if (action === "Approve") {
      for (const field of requiredFields) {
        if (!notes[field]?.trim()) return `${field} is required before approving this ECR.`;
      }
    }
    if ((action === "Send Back" || action === "Reject") && !comments.trim()) {
      return `${commentLabel} are required when you ${action.toLowerCase()} this ECR.`;
    }
    return null;
  }

  function submit(action: string) {
    const nextError = validate(action);
    if (nextError) {
      setValidationError(nextError);
      return;
    }

    const reviewFields = Object.fromEntries(
      assessmentFields.map((field) => [field, notes[field]?.trim() ?? ""]),
    );
    setValidationError(null);
    onAction(action, comments.trim(), reviewFields);
  }

  return (
    <section
      className="overflow-hidden rounded-xl border border-primary-200 bg-white shadow-sm ring-1 ring-primary-100"
      aria-labelledby="ecr-current-action-title"
      aria-busy={pending}
    >
      <div className="border-b border-primary-100 bg-primary-50/70 px-4 py-3 sm:px-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-700">
              {stageConfig.label.toUpperCase()} — ACTION REQUIRED
            </p>
            <h2 id="ecr-current-action-title" className="mt-0.5 text-sm font-bold text-neutral-900">
              {title}
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-neutral-600">
              {stageConfig.decisionSubtitle}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        {assessmentFields.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {assessmentFields.map((field) => {
              const isRequired = requiredFields.includes(field);
              const fieldId = `ecr-review-${field.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
              const options = canonicalStage === "Procurement Review"
                ? PROCUREMENT_REVIEW_OPTIONS[field]
                : undefined;
              return (
                <div key={field} className="flex flex-col gap-1.5">
                  <label htmlFor={fieldId} className="text-xs font-semibold text-neutral-700">
                    {field}{isRequired ? " *" : ""}
                  </label>
                  {options ? (
                    <select
                      id={fieldId}
                      required={isRequired}
                      value={notes[field] ?? ""}
                      onChange={(event) => {
                        setNotes((current) => ({ ...current, [field]: event.target.value }));
                        setValidationError(null);
                      }}
                      className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-xs text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    >
                      <option value="" disabled>Select {field.toLowerCase()}</option>
                      {options.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      id={fieldId}
                      rows={3}
                      required={isRequired}
                      value={notes[field] ?? ""}
                      onChange={(event) => {
                        setNotes((current) => ({ ...current, [field]: event.target.value }));
                        setValidationError(null);
                      }}
                      className="min-h-20 w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs leading-relaxed text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      placeholder={FIELD_PLACEHOLDERS[field] || `Enter ${field.toLowerCase()}...`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <label htmlFor="ecr-review-comments" className="text-xs font-semibold text-neutral-700">
              {commentLabel}
            </label>
            <span className="text-[11px] text-neutral-400">Required for Send Back or Reject</span>
          </div>
          <textarea
            id="ecr-review-comments"
            rows={3}
            value={comments}
            onChange={(event) => {
              setComments(event.target.value);
              setValidationError(null);
            }}
            className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs leading-relaxed text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            placeholder="Record the decision rationale, concerns, or revision instructions..."
          />
        </div>

        {validationError || error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <span>{validationError || error}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 pt-3">
          {actions.map((item) => {
            const disabled = pending || (item.action === "Approve" && !isAssessmentComplete);
            const buttonClass =
              item.tone === "danger"
                ? "border border-rose-300 bg-white text-rose-700 hover:bg-rose-50"
                : item.tone === "secondary"
                  ? "border border-amber-300 bg-white text-amber-800 hover:bg-amber-50"
                  : "bg-primary-600 text-white hover:bg-primary-700";
            const ActionIcon =
              item.action === "Send Back"
                ? RotateCcw
                : item.action === "Reject"
                  ? XCircle
                  : CheckCircle2;
            return (
              <button
                key={item.action}
                type="button"
                onClick={() => submit(item.action)}
                disabled={disabled}
                title={item.action === "Approve" && !isAssessmentComplete ? "Complete the required review fields first." : undefined}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${buttonClass}`}
              >
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ActionIcon className="h-3.5 w-3.5" />}
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
