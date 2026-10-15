import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, FileText, Loader2, Save, Send, UploadCloud } from "lucide-react";
import toast from "react-hot-toast";
import { applyECRBusinessCaseAction, fetchECRBusinessCase } from "../../api/ecrBusinessCase";
import { fetchECRAttachments, uploadECRAttachment } from "../../api/ecrAttachments";
import { getFullFileUrl } from "../../api/legalDocsStorage";
import { canAccessECRRecord, canonicalECRStage, formatECRNumber, isECRRole, isEcrOwnedBy } from "../../config/ecrRoles";
import { useAuthStore } from "../../store/authStore";
import AccessDenied from "../../components/AccessDenied";
import ECRBusinessCaseSummary, { formatBusinessCaseNumber } from "../../components/ecr/ECRBusinessCaseSummary";
import ECRBusinessCaseReviewPanel from "../../components/ecr/ECRBusinessCaseReviewPanel";
import { calculateECRBusinessCaseFinancials, emptyECRBusinessCasePayload, type ECRBusinessCaseAggregate, type ECRBusinessCasePayload } from "../../types/ecrBusinessCase";
import { refreshECRQueries } from "../../utils/ecrQueryCache";

const inputClass = "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-neutral-50 disabled:text-neutral-700";
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const secondaryButton = "inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";
const justificationFields = [["why_required", "Why is this change required?"], ["problem_statement", "Problem statement"], ["expected_benefits", "Expected benefits"]] as const;
const financialFields = [["current_cost", "Current unit cost"], ["proposed_cost", "Proposed unit cost"], ["implementation_cost", "Implementation cost"], ["one_time_cost", "Other one-time cost"], ["recurring_cost", "Recurring cost"], ["annual_volume", "Annual volume"]] as const;
const impactFields = [["customer_impact", "Customer impact"], ["program_impact", "Program impact"], ["plant_impact", "Plant impact"], ["production_impact", "Production impact"], ["supplier_impact", "Supplier impact"], ["quality_impact", "Quality impact"], ["timeline_impact", "Timeline impact"]] as const;
const riskFields = [["business_risk", "Business risk"], ["financial_risk", "Financial risk"], ["supplier_risk", "Supplier risk"], ["quality_risk", "Quality risk"]] as const;

function draftFromCase(businessCase: ECRBusinessCaseAggregate["businessCase"]): ECRBusinessCasePayload {
  const defaults = emptyECRBusinessCasePayload();
  if (!businessCase) return defaults;
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, businessCase[key as keyof ECRBusinessCasePayload] ?? value])) as unknown as ECRBusinessCasePayload;
}

export default function ECRBusinessCasePage() {
  const { name } = useParams<{ name: string }>();
  const user = useAuthStore((state) => state.user);
  const query = useQuery({ queryKey: ["ecr-business-case", name], queryFn: () => fetchECRBusinessCase(name!), enabled: !!name && isECRRole(user?.role) });
  if (!isECRRole(user?.role)) return <AccessDenied />;
  if (query.isLoading) return <div className="flex min-h-80 items-center justify-center gap-2 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" />Loading Business Case…</div>;
  if (query.isError || !query.data) return <div className="m-6 rounded-xl border border-rose-200 bg-rose-50 p-6"><h1 className="text-base font-semibold text-rose-900">Unable to load Business Case</h1><p className="mt-2 text-sm text-rose-700">{query.error instanceof Error ? query.error.message : "Business Case not found."}</p><button className={`${secondaryButton} mt-4`} onClick={() => void query.refetch()}>Retry</button><Link className="ml-4 text-sm text-primary-700" to={`/ecr/${encodeURIComponent(name || "")}`}>Back to ECR</Link></div>;
  if (!canAccessECRRecord(user?.role, query.data.ecr, user)) return <AccessDenied />;
  if (query.data.ecr.ecr_workflow_version !== "extended_v1") return <div className="p-6 text-sm text-neutral-600">This ECR follows the existing review workflow.<Link className="ml-2 text-primary-700" to={`/ecr/${encodeURIComponent(name || "")}`}>View ECR</Link></div>;
  return <BusinessCaseForm key={query.data.ecr.name} aggregate={query.data} queryName={name!} />;
}

function BusinessCaseForm({ aggregate, queryName }: { aggregate: ECRBusinessCaseAggregate; queryName: string }) {
  const { ecr, businessCase } = aggregate;
  const user = useAuthStore((state) => state.user);
  const qc = useQueryClient();
  const [draft, setDraft] = useState(() => draftFromCase(businessCase));
  // Keep the revision the user actually opened; a background refresh must not
  // silently grant permission to overwrite a newer draft or review submission.
  const [loadedRevision, setLoadedRevision] = useState(ecr.modified);
  const [loadedCaseVersion, setLoadedCaseVersion] = useState(businessCase?.modified);
  const [error, setError] = useState<string | null>(null);
  const stage = canonicalECRStage(ecr.select_pxfp, ecr);
  const canEdit = user?.role === "engineer" && isEcrOwnedBy(ecr, user) && stage === "Technical Approved";
  const ecrNumber = formatECRNumber(ecr);
  const financials = calculateECRBusinessCaseFinancials(draft);
  useEffect(() => { if (!canEdit) setDraft(draftFromCase(businessCase)); }, [businessCase?.modified, canEdit]);
  const update = <K extends keyof ECRBusinessCasePayload>(key: K, value: ECRBusinessCasePayload[K]) => setDraft((previous) => ({ ...previous, [key]: value }));

  function cacheResult(result: ECRBusinessCaseAggregate) {
    const identifiers = [...new Set([queryName, result.ecr.name, result.ecr.ecr_number].filter((value): value is string => Boolean(value)))];
    for (const identifier of identifiers) {
      qc.setQueryData(["ecr-business-case", identifier], result);
      qc.setQueryData(["ecr", identifier], result.ecr);
    }
    void refreshECRQueries(qc, identifiers);
  }
  const mutation = useMutation({
    mutationFn: (action: "save" | "submit") => applyECRBusinessCaseAction({ ...ecr, modified: loadedRevision }, action, { payload: draft }),
    onSuccess: (result, action) => { cacheResult(result); setLoadedRevision(result.ecr.modified); setLoadedCaseVersion(result.businessCase?.modified); setDraft(draftFromCase(result.businessCase)); setError(null); toast.success(action === "save" ? "Business Case draft saved." : "Business Case updated."); },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "Unable to update Business Case."),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (draft.supporting_documents.length >= 25) throw new Error("A Business Case can include up to 25 supporting documents.");
      const beforeUpload = await fetchECRBusinessCase(ecr.name);
      if (beforeUpload.ecr.modified !== loadedRevision) throw new Error("This ECR changed while you were editing. Reload the saved case before uploading or saving.");
      await fetchECRAttachments(ecr.name, ecr);
      const attachment = await uploadECRAttachment(file, ecr.name, "Supporting Documents", undefined, user?.email || user?.name);
      // Upload updates the parent ECR. Read its current revision before another save.
      const refreshed = await fetchECRBusinessCase(ecr.name);
      if (refreshed.businessCase?.modified !== loadedCaseVersion) throw new Error("The Business Case changed during the upload. Reload the saved case before saving your changes.");
      const persistedReferences = String(refreshed.ecr.supporting_documents || "").split(/[,\n]+/).map((value) => value.trim());
      if (!persistedReferences.includes(attachment.file_url)) throw new Error("The file uploaded, but its ECR attachment reference could not be saved. Reload the saved case and upload it again before submitting.");
      return { attachment, refreshed };
    },
    onSuccess: ({ attachment, refreshed }) => { cacheResult(refreshed); setLoadedRevision(refreshed.ecr.modified); setDraft((previous) => ({ ...previous, supporting_documents: [...previous.supporting_documents.filter((doc) => doc.file_url !== attachment.file_url), { file_name: attachment.file_name, file_url: attachment.file_url }] })); setError(null); toast.success("Document uploaded. Save the Business Case to include it."); },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "Unable to upload document."),
  });
  const reload = useMutation({
    mutationFn: () => fetchECRBusinessCase(ecr.name),
    onSuccess: (result) => { cacheResult(result); setLoadedRevision(result.ecr.modified); setLoadedCaseVersion(result.businessCase?.modified); setDraft(draftFromCase(result.businessCase)); setError(null); },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "Unable to reload Business Case."),
  });
  const pending = mutation.isPending || upload.isPending || reload.isPending;
  const contentChanged = ecr.modified !== loadedRevision;
  const blocked = pending || contentChanged;
  const disabled = !canEdit || blocked;
  function textField(key: keyof ECRBusinessCasePayload, label: string, required = false) {
    return <label key={key} className="block text-xs font-semibold text-neutral-600">{label}{required && canEdit ? " *" : ""}<textarea rows={3} maxLength={4000} required={required && canEdit} disabled={disabled} className={inputClass} value={String(draft[key] || "")} onChange={(event) => update(key, event.target.value)} /></label>;
  }
  return <main className="mx-auto max-w-6xl space-y-5 p-6">
    <Link to={`/ecr/${encodeURIComponent(ecrNumber)}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700"><ArrowLeft className="h-3.5 w-3.5" />{ecrNumber}</Link>
    <header className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-primary-700">ECR Business Case</p><h1 className="mt-1 text-xl font-bold text-neutral-900">{businessCase?.business_case_id || `Business Case for ${ecrNumber}`}</h1><p className="mt-2 text-sm text-neutral-600">{ecr.ecr_title}</p><p className="mt-1 text-xs text-neutral-500">Owner: {businessCase?.created_by || ecr.ecr_owner || ecr.owner} · ECR stage: {stage}</p></div><span className="h-fit rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">{businessCase?.status || "Draft"}</span></div></header>
    {error && <div role="alert" className="flex flex-wrap items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle className="h-4 w-4 shrink-0" /><span className="flex-1">{error}</span><button className="text-xs font-semibold underline disabled:opacity-50" disabled={pending} onClick={() => reload.mutate()}>Reload saved case (discard local edits)</button></div>}
    {contentChanged && !pending && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This ECR changed while you were viewing it. Reload its saved Business Case before saving or reviewing. <button className="font-semibold underline" onClick={() => reload.mutate()}>Reload saved case (discard local edits)</button></div>}
    {businessCase && <section className="rounded-xl border border-neutral-200 bg-white p-5"><ECRBusinessCaseSummary businessCase={businessCase} /></section>}
    {stage === "Technical Approved" && canEdit && <p className="rounded-lg border border-primary-200 bg-primary-50 p-3 text-sm text-primary-800">Complete the Business Case and submit it for review. Finance reviews cost impact, Procurement reviews every Business Case, and Quality reviews quality impact.</p>}
    {user?.role === "program_manager" && <p className="rounded-lg border border-primary-200 bg-primary-50 p-3 text-sm text-primary-800">Review the Business Case below, then <Link className="font-semibold underline" to={`/ecr/${encodeURIComponent(ecrNumber)}`}>open the ECR for final approval</Link>.</p>}
    <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); if (canEdit && !blocked) mutation.mutate("submit"); }}>
      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5"><h2 className="text-sm font-bold text-neutral-900">Business justification</h2>{justificationFields.map(([key, label]) => textField(key, label, true))}</section>
      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5"><h2 className="text-sm font-bold text-neutral-900">Financial impact</h2><p className="text-xs text-neutral-500">Use the same currency for all costs. Unit costs and annual volume determine annual savings.</p><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{financialFields.map(([key, label]) => <label key={key} className="text-xs font-semibold text-neutral-600">{label}<input type="number" min="0" max="1000000000000" step={key === "annual_volume" ? "1" : "0.01"} required disabled={disabled} className={inputClass} value={draft[key]} onChange={(event) => update(key, Number(event.target.value))} /></label>)}</div><dl className="grid gap-3 rounded-lg bg-primary-50 p-4 sm:grid-cols-3">{[["Annual savings", formatBusinessCaseNumber(financials.expected_annual_savings)], ["ROI", formatBusinessCaseNumber(financials.roi, "%")], ["Payback period", formatBusinessCaseNumber(financials.payback_period, " months")]].map(([label, value]) => <div key={label}><dt className="text-xs text-neutral-600">{label}</dt><dd className="mt-1 text-lg font-semibold text-primary-800">{value}</dd></div>)}</dl><p className="text-xs leading-relaxed text-neutral-500">Annual savings = (current unit cost − proposed unit cost) × annual volume. ROI = (annual savings − implementation cost) ÷ implementation cost × 100. Payback = implementation cost ÷ annual savings × 12 months. ROI needs positive implementation cost; payback needs positive savings. Other one-time and recurring costs are recorded separately.</p><div className="grid gap-4 sm:grid-cols-2">{textField("revenue_impact", "Revenue impact")}{textField("budget_impact", "Budget impact", true)}</div></section>
      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5"><h2 className="text-sm font-bold text-neutral-900">Business impact</h2><div className="grid gap-4 sm:grid-cols-2">{impactFields.map(([key, label]) => textField(key, label))}</div></section>
      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5"><h2 className="text-sm font-bold text-neutral-900">Risk assessment</h2><div className="grid gap-4 sm:grid-cols-2">{riskFields.map(([key, label]) => textField(key, label, true))}</div><label className="block text-xs font-semibold text-neutral-600">Overall risk<select className={inputClass} disabled={disabled} value={draft.overall_risk} onChange={(event) => update("overall_risk", event.target.value as ECRBusinessCasePayload["overall_risk"])}><option>Low</option><option>Medium</option><option>High</option></select></label></section>
      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5"><h2 className="text-sm font-bold text-neutral-900">Recommendation</h2><label className="block text-xs font-semibold text-neutral-600">Recommended decision<select className={inputClass} disabled={disabled} value={draft.recommendation} onChange={(event) => update("recommendation", event.target.value as ECRBusinessCasePayload["recommendation"])}><option>Approve</option><option>Reject</option><option>Need More Information</option></select></label></section>
      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5"><h2 className="text-sm font-bold text-neutral-900">Supporting documents</h2><p className="text-xs text-neutral-500">Files are attached privately to the parent ECR. Existing engineering drawings and specifications remain available in its Documents tab.</p>{draft.supporting_documents.length ? <ul className="space-y-2">{draft.supporting_documents.map((document) => <li key={document.file_url} className="flex items-center gap-2 rounded-lg border border-neutral-200 p-3 text-xs"><FileText className="h-4 w-4 text-neutral-400" /><a className="min-w-0 flex-1 break-words font-semibold text-primary-700 hover:underline" href={getFullFileUrl(document.file_url)} target="_blank" rel="noreferrer">{document.file_name}</a>{canEdit && <button type="button" className="text-neutral-500 hover:text-rose-700 disabled:opacity-50" disabled={blocked} onClick={() => update("supporting_documents", draft.supporting_documents.filter((item) => item.file_url !== document.file_url))}>Remove reference</button>}</li>)}</ul> : <p className="text-xs text-neutral-500">No Business Case supporting documents attached.</p>}{canEdit && <label className={`${secondaryButton} cursor-pointer`}><UploadCloud className="h-4 w-4" />{upload.isPending ? "Uploading…" : "Upload supporting document"}<input className="sr-only" type="file" disabled={blocked} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} /></label>}</section>
      {canEdit && <div className="flex flex-wrap justify-end gap-3 rounded-xl border border-neutral-200 bg-white p-4"><button type="button" className={secondaryButton} disabled={blocked} onClick={() => mutation.mutate("save")}><Save className="h-4 w-4" />Save draft</button><button type="submit" className={primaryButton} disabled={blocked}>{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Submit Business Case</button></div>}
    </form>
    <ECRBusinessCaseReviewPanel
      key={`${ecr.name}:${loadedRevision}`}
      ecr={ecr}
      businessCase={businessCase}
      role={user?.role}
      queryName={queryName}
      disabled={blocked}
      showFinancials={false}
      onSuccess={(result) => {
        setLoadedRevision(result.ecr.modified);
        setLoadedCaseVersion(result.businessCase?.modified);
        setDraft(draftFromCase(result.businessCase));
        setError(null);
      }}
    />
  </main>;
}
