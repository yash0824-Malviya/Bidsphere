import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RotateCcw, XCircle } from "lucide-react";
import toast from "react-hot-toast";
import { applyECRBusinessCaseAction, fetchECRBusinessCase } from "../../api/ecrBusinessCase";
import { getECRBusinessCaseReviewRole } from "../../config/ecrBusinessCasePermissions";
import { formatECRNumber } from "../../config/ecrRoles";
import type { EngineeringChangeRequest } from "../../types/erpnext";
import type { ECRBusinessCase, ECRBusinessCaseAggregate } from "../../types/ecrBusinessCase";
import { refreshECRQueries } from "../../utils/ecrQueryCache";
import { formatBusinessCaseNumber } from "./ECRBusinessCaseSummary";

type ReviewAction = "approve" | "send_back" | "reject";

/** Business Case decisions always use their dedicated, revision-checked endpoint. */
export default function ECRBusinessCaseReviewPanel({
  ecr, businessCase, role, queryName, disabled = false, onSuccess, showFinancials = true,
}: {
  ecr: EngineeringChangeRequest;
  businessCase: ECRBusinessCase | null;
  role?: string | null;
  queryName?: string;
  disabled?: boolean;
  onSuccess?: (result: ECRBusinessCaseAggregate) => void;
  showFinancials?: boolean;
}) {
  const qc = useQueryClient();
  const [loadedRevision, setLoadedRevision] = useState(ecr.modified);
  const [comment, setComment] = useState("");
  const [recommendation, setRecommendation] = useState<"" | "Yes" | "No">(businessCase?.rfq_required || "");
  const [reason, setReason] = useState(businessCase?.rfq_decision_reason || "");
  const [error, setError] = useState<string | null>(null);
  const reviewRole = getECRBusinessCaseReviewRole(role, ecr, businessCase);
  const stale = loadedRevision !== ecr.modified;

  function cacheResult(result: ECRBusinessCaseAggregate) {
    const identifiers = [...new Set([queryName, result.ecr.name, result.ecr.ecr_number].filter((value): value is string => Boolean(value)))];
    for (const identifier of identifiers) {
      qc.setQueryData(["ecr", identifier], result.ecr);
      qc.setQueryData(["ecr-business-case", identifier], result);
    }
    void refreshECRQueries(qc, identifiers);
    setLoadedRevision(result.ecr.modified);
    onSuccess?.(result);
  }

  const mutation = useMutation({
    mutationFn: (action: ReviewAction) => {
      if (!reviewRole || stale || disabled) throw new Error("Reload the current Business Case before reviewing.");
      if (action !== "approve" && !comment.trim()) throw new Error("A review comment is required for Send Back or Reject.");
      if (action === "approve" && reviewRole === "procurement" && recommendation && !reason.trim()) throw new Error("A reason is required for the RFQ recommendation.");
      return applyECRBusinessCaseAction({ ...ecr, modified: loadedRevision }, action, {
        role: reviewRole, comment: comment.trim(),
        ...(action === "approve" && reviewRole === "procurement" && recommendation
          ? { rfq_required: recommendation, rfq_decision_reason: reason.trim() } : {}),
      });
    },
    onSuccess: (result, action) => {
      cacheResult(result);
      setComment("");
      setError(null);
      toast.success(action === "approve" ? "Business Case review approved." : action === "send_back" ? "Business Case returned to the Engineer." : "Business Case rejected.");
    },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "Unable to save the Business Case decision."),
  });
  const reload = useMutation({
    mutationFn: () => fetchECRBusinessCase(ecr.name),
    onSuccess: (result) => {
      cacheResult(result);
      setRecommendation(result.businessCase?.rfq_required || "");
      setReason(result.businessCase?.rfq_decision_reason || "");
      setError(null);
    },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "Unable to reload the Business Case."),
  });
  if (!reviewRole || !businessCase) return null;
  const busy = mutation.isPending || reload.isPending;
  const blocked = disabled || stale || busy;
  const label = reviewRole === "finance" ? "Finance" : reviewRole === "procurement" ? "Procurement" : "Quality";
  const inputClass = "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 disabled:bg-neutral-50";

  return <section aria-label={`${label} Business Case review`} aria-busy={busy} className="space-y-4 rounded-xl border border-primary-200 bg-white p-5 shadow-sm">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-sm font-bold text-primary-900">{label} Business Case review</h2><p className="mt-1 text-xs text-neutral-600">Review the saved Business Case and record your decision.</p></div>
      <Link className="text-xs font-semibold text-primary-700 underline" to={`/ecr/${encodeURIComponent(formatECRNumber(ecr))}/business-case`}>Open full Business Case</Link>
    </header>
    {showFinancials && <>
      <dl className="grid gap-3 sm:grid-cols-3">
        {([
          ["Current unit cost", businessCase.current_cost], ["Proposed unit cost", businessCase.proposed_cost],
          ["Implementation cost", businessCase.implementation_cost], ["Other one-time cost", businessCase.one_time_cost],
          ["Recurring cost", businessCase.recurring_cost], ["Annual volume", businessCase.annual_volume],
          ["Annual savings", businessCase.expected_annual_savings], ["ROI", businessCase.roi, "%"],
          ["Payback period", businessCase.payback_period, " months"],
        ] as Array<[string, number | null, string?]>).map(([title, value, suffix]) => <div key={title} className="rounded-lg bg-neutral-50 p-3"><dt className="text-xs text-neutral-500">{title}</dt><dd className="mt-1 text-sm font-semibold text-neutral-900">{formatBusinessCaseNumber(value, suffix)}</dd></div>)}
      </dl>
      <dl className="grid gap-3 sm:grid-cols-2">
        {([
          ["Why this change is required", businessCase.why_required], ["Problem statement", businessCase.problem_statement],
          ["Expected benefits", businessCase.expected_benefits], ["Budget impact", businessCase.budget_impact],
          ["Revenue impact", businessCase.revenue_impact], ["Financial risk", businessCase.financial_risk],
          ["Business risk", businessCase.business_risk], ["Supplier impact", businessCase.supplier_impact],
          ["Quality impact", businessCase.quality_impact], ["Quality risk", businessCase.quality_risk],
        ]).map(([title, value]) => <div key={title}><dt className="text-xs font-semibold text-neutral-600">{title}</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-neutral-800">{value || "Not recorded"}</dd></div>)}
      </dl>
    </>}
    {reviewRole === "procurement" && <div className="grid gap-3 rounded-lg bg-neutral-50 p-3 sm:grid-cols-2">
      <label className="text-xs font-semibold text-neutral-600">Preliminary RFQ recommendation (optional)<select className={inputClass} value={recommendation} disabled={blocked} onChange={(event) => setRecommendation(event.target.value as "" | "Yes" | "No")}><option value="">No preliminary recommendation</option><option value="Yes">RFQ recommended</option><option value="No">RFQ not recommended</option></select></label>
      <label className="text-xs font-semibold text-neutral-600">Recommendation reason<textarea className={inputClass} rows={2} maxLength={2000} value={reason} disabled={blocked} onChange={(event) => setReason(event.target.value)} /></label>
      <p className="text-xs text-neutral-500 sm:col-span-2">The final sourcing decision is recorded after ECR approval.</p>
    </div>}
    <label className="block text-xs font-semibold text-neutral-600">Review comment (required for Send Back or Reject)<textarea className={inputClass} rows={3} maxLength={4000} value={comment} disabled={blocked} onChange={(event) => setComment(event.target.value)} /></label>
    {(error || stale) && <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error || "This ECR changed while you were reviewing. Reload the saved Business Case before taking action."} <button type="button" className="font-semibold underline" disabled={busy} onClick={() => reload.mutate()}>Reload saved Business Case</button></div>}
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-amber-300 px-4 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50" disabled={blocked || !comment.trim()} onClick={() => mutation.mutate("send_back")}><RotateCcw className="h-4 w-4" />Send Back</button>
      <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-4 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50" disabled={blocked || !comment.trim()} onClick={() => mutation.mutate("reject")}><XCircle className="h-4 w-4" />Reject</button>
      <button type="button" className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50" disabled={blocked || (reviewRole === "procurement" && !!recommendation && !reason.trim())} onClick={() => mutation.mutate("approve")}>{mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Approve Business Case</button>
    </div>
  </section>;
}
