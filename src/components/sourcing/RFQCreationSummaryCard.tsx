import { X } from "lucide-react";

import type { RFQCreationMeta } from "../../api/rfqCreationMeta";
import { formatRequiredDocumentsList } from "../../api/rfqCreationMeta";
import type { RFQTemplateWorkflowRules } from "../../types/erpnext";
import { formatCurrency } from "../../utils/format";

interface Props {
  meta: RFQCreationMeta;
  onClear?: () => void;
  className?: string;
}

const WORKFLOW_BADGES: Array<{
  key: keyof RFQTemplateWorkflowRules;
  label: string;
  className: string;
}> = [
  {
    key: "budget_approval_required",
    label: "Budget Approval",
    className: "bg-amber-100 text-amber-800 ring-amber-200/60",
  },
  {
    key: "legal_review_required",
    label: "Legal Review",
    className: "bg-violet-100 text-violet-800 ring-violet-200/60",
  },
  {
    key: "finance_review_required",
    label: "Finance Review",
    className: "bg-blue-100 text-blue-800 ring-blue-200/60",
  },
  {
    key: "management_approval_required",
    label: "Management Approval",
    className: "bg-emerald-100 text-emerald-800 ring-emerald-200/60",
  },
];

export default function RFQCreationSummaryCard({
  meta,
  onClear,
  className = "",
}: Props) {
  const isTemplate = Boolean(meta.template_id);
  const requiredDocs = formatRequiredDocumentsList(meta.required_documents);
  const activeBadges = WORKFLOW_BADGES.filter(
    (b) => meta.workflow_rules?.[b.key]
  );

  return (
    <div
      className={`overflow-hidden rounded-xl border shadow-sm ${
        isTemplate
          ? "border-accent-200/80 bg-gradient-to-br from-accent-50/90 via-white to-accent-50/40"
          : "border-primary-200/80 bg-gradient-to-br from-primary-50/90 via-white to-neutral-50/40"
      } ${className}`}
    >
      <div className="flex items-start gap-3 px-4 py-3.5 sm:px-5 sm:py-4">
        <div
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-xl shadow-sm ring-1 ring-inset ${
            isTemplate
              ? "bg-white ring-accent-200/80"
              : "bg-white ring-primary-200/80"
          }`}
          aria-hidden
        >
          {isTemplate ? "📋" : "📝"}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="text-sm font-bold text-neutral-900">
              {isTemplate ? "RFQ Created from Template" : "RFQ Created Manually"}
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                isTemplate
                  ? "bg-accent-100 text-accent-800"
                  : "bg-primary-100 text-primary-800"
              }`}
            >
              {isTemplate ? "Template RFQ" : "Custom RFQ"}
            </span>
          </div>

          {isTemplate ? (
            <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
              {meta.template_name && (
                <MetaRow label="Template Name" value={meta.template_name} />
              )}
              {meta.category && (
                <MetaRow label="Category" value={meta.category} />
              )}
              {meta.rfq_type && (
                <MetaRow label="RFQ Type" value={meta.rfq_type} />
              )}
              {meta.estimated_value != null && meta.estimated_value > 0 && (
                <MetaRow
                  label="Estimated Value"
                  value={formatCurrency(meta.estimated_value)}
                  tabular
                />
              )}
            </dl>
          ) : (
            <p className="mt-1.5 text-xs text-neutral-600">
              Created by{" "}
              <span className="font-semibold text-neutral-800">
                {meta.created_by || "Procurement Manager"}
              </span>
            </p>
          )}

          {requiredDocs && (
            <p className="mt-2 text-xs leading-relaxed text-neutral-600">
              <span className="font-semibold text-neutral-700">
                Required Documents:
              </span>{" "}
              {requiredDocs}
            </p>
          )}

          {activeBadges.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {activeBadges.map((badge) => (
                <span
                  key={badge.key}
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${badge.className}`}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {onClear && isTemplate && (
          <button
            type="button"
            onClick={onClear}
            className="flex-shrink-0 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-white/80 hover:text-neutral-600"
            aria-label="Clear template"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  tabular,
}: {
  label: string;
  value: string;
  tabular?: boolean;
}) {
  return (
    <div className="flex gap-1.5 sm:block">
      <dt className="font-medium text-neutral-500">{label}:</dt>
      <dd
        className={`font-semibold text-neutral-800 ${tabular ? "tabular-nums" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
