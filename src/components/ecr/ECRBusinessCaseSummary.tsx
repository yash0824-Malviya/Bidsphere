import type { ECRBusinessCase } from "../../types/ecrBusinessCase";
import { formatMediumDisplayDate } from "../../utils/erpNextDate";

export function formatBusinessCaseNumber(value: number | null | undefined, suffix = "") {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}${suffix}` : "Not applicable";
}

export default function ECRBusinessCaseSummary({ businessCase }: { businessCase: ECRBusinessCase }) {
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-bold text-neutral-900">{businessCase.business_case_id}</h3><p className="mt-1 text-xs text-neutral-500">Recommendation: {businessCase.recommendation} · Overall risk: {businessCase.overall_risk}</p></div>
      <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">{businessCase.status}</span>
    </div>
    <dl className="grid gap-3 sm:grid-cols-3">
      {[
        ["Annual savings", formatBusinessCaseNumber(businessCase.expected_annual_savings)],
        ["ROI", formatBusinessCaseNumber(businessCase.roi, "%")],
        ["Payback", formatBusinessCaseNumber(businessCase.payback_period, " months")],
      ].map(([label, value]) => <div key={label} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3"><dt className="text-xs text-neutral-500">{label}</dt><dd className="mt-1 text-lg font-semibold text-neutral-900">{value}</dd></div>)}
    </dl>
    <p className="whitespace-pre-wrap text-sm text-neutral-700">{businessCase.expected_benefits || "Expected benefits have not been recorded."}</p>
    {businessCase.rfq_required && <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3"><p className="text-xs font-semibold text-neutral-700">Procurement recommendation: RFQ {businessCase.rfq_required === "Yes" ? "recommended" : "not recommended"}</p><p className="mt-1 whitespace-pre-wrap text-xs text-neutral-600">{businessCase.rfq_decision_reason}</p><p className="mt-1 text-xs text-neutral-500">Final sourcing decision follows ECR approval.</p></div>}
    <ol className="grid gap-3 sm:grid-cols-3" aria-label="Business Case approvals">
      {(["finance", "procurement", "quality"] as const).map((role) => <li key={role} className="rounded-lg border border-neutral-200 p-3">
        <p className="text-xs font-bold capitalize text-neutral-900">{role} review</p>
        <p className={`mt-1 text-xs font-semibold ${businessCase[`${role}_status`] === "Approved" ? "text-emerald-700" : businessCase[`${role}_status`] === "Rejected" ? "text-rose-700" : "text-neutral-600"}`}>{businessCase[`${role}_status`]}</p>
        {businessCase[`${role}_approved_by`] && <p className="mt-1 break-words text-xs text-neutral-500">{businessCase[`${role}_approved_by`]} · {formatMediumDisplayDate(businessCase[`${role}_approved_date`])}</p>}
        {businessCase[`${role}_comment`] && <p className="mt-2 whitespace-pre-wrap text-xs text-neutral-700">{businessCase[`${role}_comment`]}</p>}
      </li>)}
    </ol>
  </div>;
}
