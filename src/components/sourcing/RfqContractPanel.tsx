import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { clmError, clmRecordRoute, clmViewerKey, createRfqContractRequest, submitRfqClmRequest, recordRfqAwardDecision, getClmMetadata, getRfqClmSummary, type RfqClmCreateResult, type RfqClmDecisionResult, type RfqClmSummary } from "../../api/clm";
import ClmFields, { CLM_BUTTON, CLM_INPUT, CLM_PRIMARY, clmFormPayload, editableClmFields, fieldLabel, initialClmValues } from "../contracts/ClmFields";
import { RfqSourceDocuments } from "../contracts/ClmSourceTraceability";
import { RFQ_CONTRACT_TYPES, validateRfqContractDetails } from "../../utils/rfqContractContext";
import { useAuthStore } from "../../store/authStore";
import { canPrepareRfqContract } from "../../utils/rfqContractPermissions";

const requestType = "Contract Request";
function isDraftRfq(context: RfqClmSummary): boolean {
  return context.rfq.docstatus === 0 || (context.rfq.docstatus == null && context.rfq.status?.trim().toLowerCase() === "draft");
}
const hasValue = (value: unknown) => value !== undefined && value !== null && (typeof value !== "string" || !!value.trim());
const awardDetailLabels: Record<string, string> = { contract_type: "Contract Type", contract_purpose: "Contract Purpose", description: "Contract Description", contract_start_date: "Contract Start Date", contract_end_date: "Contract End Date" };
const contractReviewLabels: Record<string, string> = { custom_inteva_signatory: "Legal Manager Signatory" };

export function RfqContractRequestEditor({ context: initialContext, mode, onSaved, onCancel, onOpenRequest }: {
  context: RfqClmSummary; mode: "request" | "create_contract"; onSaved: (result: RfqClmCreateResult) => void; onCancel: () => void; onOpenRequest?: (requestName: string) => void;
}) {
  const requesting = mode === "request";
  const canInitiate = canPrepareRfqContract(useAuthStore(state => state.user?.role));
  const [context, setContext] = useState(initialContext);
  const metadata = useQuery({ queryKey: ["clm", "metadata", clmViewerKey()], queryFn: getClmMetadata, staleTime: 60_000 });
  const [values, setValues] = useState<Record<string, unknown>>({ ...context.prefill, contract_type: context.request ? context.prefill.contract_type || "" : "", custom_inteva_signatory: context.designated_legal_signatory?.signatory?.name || "" });
  const [initialized, setInitialized] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const editedFields = useRef(new Set<string>());
  const fields = metadata.data?.fields[requestType] || [];
  const allow = metadata.data?.editableFields?.[requestType] || metadata.data?.editable_fields?.[requestType];
  const editable = editableClmFields(fields, requestType, allow).filter(field => !context.locked_fields.includes(field.fieldname) && !["Attach", "Attach Image"].includes(field.fieldtype)).map(field => ({ ...field, label: awardDetailLabels[field.fieldname] || field.label }));
  const requiredNames = new Set([...Object.keys(awardDetailLabels), ...context.required_fields, ...editable.filter(field => field.reqd).map(field => field.fieldname)]);
  const requiredFields = editable.filter(field => requiredNames.has(field.fieldname) && field.fieldname !== "contract_type").map(field => ({ ...field, reqd: 1 }));
  const savedRequestFields = context.request ? fields.filter(field => context.locked_fields.includes(field.fieldname) && field.fieldname !== "contract_type" && field.fieldname in awardDetailLabels).map(field => ({ ...field, label: awardDetailLabels[field.fieldname] })) : [];
  const optionalFields = editable.filter(field => !requiredNames.has(field.fieldname));
  const reviewFields = requesting ? [] : (metadata.data?.fields.Contract || []).filter(field => field.fieldname in contractReviewLabels).map(field => ({ ...field, label: contractReviewLabels[field.fieldname], reqd: 1 }));
  const missingDefinitions = [...[...requiredNames].filter(name => !context.locked_fields.includes(name) && !editable.some(field => field.fieldname === name)), ...(!requesting ? Object.keys(contractReviewLabels).filter(name => !reviewFields.some(field => field.fieldname === name)) : [])];
  const canSubmit = !isDraftRfq(context) && (requesting ? context.can_request : context.can_create);
  const preparingRequest = requesting && context.request_needs_details;
  const resuming = !requesting && context.recovery_required;
  const createLabel = resuming ? "Resume Contract creation" : "Create Contract from RFQ Award";
  const awardValue = hasValue(context.prefill.contract_value) ? Number(context.prefill.contract_value).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—";
  useEffect(() => {
    if (fields.length && !initialized) {
      setValues(previous => ({ ...initialClmValues(fields, requestType), ...previous }));
      setInitialized(true);
    }
  }, [fields, initialized]);
  function changeValues(next: Record<string, unknown>) {
    for (const [field, value] of Object.entries(next)) if (!Object.is(value, values[field])) editedFields.current.add(field);
    setValues(next);
  }
  async function save() {
    if (saving.current || !canInitiate || !initialized || metadata.isError || !canSubmit || missingDefinitions.length) return;
    const nextErrors = { ...Object.fromEntries([...requiredFields, ...reviewFields].filter(field => !hasValue(values[field.fieldname])).map(field => [field.fieldname, `${fieldLabel(field)} is required.`])), ...validateRfqContractDetails(values) };
    setErrors(nextErrors); setError("");
    if (Object.keys(nextErrors).length) return;
    saving.current = true; setBusy(true);
    try {
      const payload = context.request && !requesting ? {} : clmFormPayload(fields, requestType, values, editable.map(field => field.fieldname));
      const source = { rfq: context.rfq.name, expected_modified: context.rfq.modified, payload };
      const result = requesting ? await submitRfqClmRequest(source) : await createRfqContractRequest({ ...source, contract_fields: Object.fromEntries(Object.keys(contractReviewLabels).map(name => [name, values[name]])) });
      onSaved(result);
    } catch (cause) { setError(clmError(cause)); }
    finally { saving.current = false; setBusy(false); }
  }
  async function refreshAward() {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try {
      const fresh = await getRfqClmSummary(context.rfq.name);
      setValues(previous => ({ ...fresh.prefill,
        ...Object.fromEntries(Object.entries(previous).filter(([field]) => !context.locked_fields.includes(field) && (field === "contract_type" || editedFields.current.has(field) || !(field in fresh.prefill)))),
        ...Object.fromEntries(Object.entries(fresh.prefill).filter(([field]) => fresh.locked_fields.includes(field))),
        custom_inteva_signatory: String(previous.custom_inteva_signatory || fresh.designated_legal_signatory?.signatory?.name || ""),
      }));
      setContext(fresh); setError(""); setErrors({});
      setNotice(fresh.recovery_required ? "Contract creation is incomplete. Resume the saved handoff before Legal Review can begin." : fresh.contract ? "Contract already exists." : fresh.request_needs_details ? "Award refreshed. Complete the existing Contract Request details before creating its Contract." : fresh.request?.assigned_role === "procurement_team" ? "CLM Request already exists in Procurement Team's queue." : fresh.request ? "Contract Request already exists. No Contract is linked yet." : fresh.can_create || fresh.can_request ? "Award refreshed. Review the source information before continuing." : fresh.reason || "This RFQ cannot currently initiate a Contract Request.");
    } catch (cause) { setError(clmError(cause)); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div role="dialog" aria-modal="true" aria-labelledby="rfq-contract-request-title" className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-3 sm:p-6">
    <form noValidate onSubmit={event => { event.preventDefault(); void save(); }} className="mx-auto my-3 w-full max-w-3xl space-y-5 rounded-xl bg-white p-4 shadow-xl sm:p-6">
      <header className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 id="rfq-contract-request-title" className="text-xl font-semibold text-slate-900">{preparingRequest ? "Complete Contract Request" : requesting ? "Request CLM from RFQ Award" : createLabel}</h2><p className="mt-1 text-sm text-slate-500">{preparingRequest ? "Complete the saved request using the awarded supplier and contract details. Procurement Team creates the Contract after these details are saved." : requesting ? "Complete the required request details to save the Yes decision and route this request to Procurement Team." : resuming ? "Review the saved request and resume its incomplete Contract handoff to Legal Review." : "Review the saved request and complete the required details to create the contract in Legal Review."}</p></div><button type="button" className={CLM_BUTTON} disabled={busy} onClick={onCancel}>Close</button></header>
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-3" aria-label="Contract Context"><h3 className="mb-3 text-sm font-semibold text-slate-900">Contract Context</h3><dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
        {[["RFQ", context.rfq.name], ["Award", context.source?.award], ["Supplier", context.prefill.supplier], ["Winning Quotation", context.prefill.custom_supplier_quotation], ["Award Value", `${context.prefill.currency || ""} ${awardValue}`.trim()], ["Company", context.prefill.company], ["Department", context.prefill.department], ["Business Case", context.source?.business_case], ["Purchase Order", context.prefill.custom_purchase_order]].filter(([, value]) => hasValue(value)).map(([label, value]) => <div key={String(label)} className="min-w-0"><dt className="text-xs font-medium text-slate-500">{String(label)}</dt><dd className="mt-1 break-words font-medium text-slate-800">{String(value)}</dd></div>)}
      </dl></section>
      {context.warnings.map((warning, index) => <p key={index} className="text-sm text-amber-800">{warning}</p>)}
      {metadata.isLoading ? <p role="status">Loading Contract Request fields…</p> : metadata.isError ? <div role="alert" className="text-sm text-rose-700">{clmError(metadata.error)}<button className={`${CLM_BUTTON} ml-2`} type="button" onClick={() => void metadata.refetch()}>Retry</button></div> : !fields.length || missingDefinitions.length ? <p role="alert" className="text-sm text-rose-700">The required Contract Request fields are unavailable. Refresh the RFQ before creating the request.</p> : <fieldset disabled={busy} className="min-w-0 space-y-4">
        <div className="min-w-0" data-contract-field="contract_type"><label htmlFor="rfq-award-contract-type" className="mb-1.5 block text-xs font-semibold text-slate-700">Contract Type *</label><select id="rfq-award-contract-type" className={`${CLM_INPUT}${errors.contract_type ? " border-rose-500" : ""}`} value={String(values.contract_type || "")} disabled={context.locked_fields.includes("contract_type")} required aria-invalid={!!errors.contract_type || undefined} aria-describedby={errors.contract_type ? "rfq-award-contract-type-error" : undefined} onChange={event => changeValues({ ...values, contract_type: event.target.value })}><option value="">Select Contract Type</option>{RFQ_CONTRACT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select>{errors.contract_type && <p id="rfq-award-contract-type-error" role="alert" className="mt-1 text-xs font-medium text-rose-700">{errors.contract_type}</p>}</div>
        <ClmFields fields={requiredFields} doctype={requestType} values={values} onChange={changeValues} editableFields={editable.map(field => field.fieldname)} errors={errors} compact />
        {savedRequestFields.length > 0 && <fieldset disabled className="min-w-0 space-y-3"><legend className="mb-3 text-xs text-slate-500">Saved Contract Request details</legend><ClmFields fields={savedRequestFields} doctype={requestType} values={values} onChange={() => undefined} editableFields={savedRequestFields.map(field => field.fieldname)} compact /></fieldset>}
        <ClmFields fields={reviewFields} doctype="Contract" values={values} onChange={changeValues} editableFields={Object.keys(contractReviewLabels)} errors={errors} compact />
        {(!context.request || preparingRequest) && optionalFields.length > 0 && <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Additional request details</summary><div className="mt-4"><ClmFields fields={optionalFields} doctype={requestType} values={values} onChange={changeValues} editableFields={editable.map(field => field.fieldname)} compact /></div></details>}
      </fieldset>}
      <RfqSourceDocuments rfq={context.rfq.name} documents={context.source_documents} canOpenSource />
      <p className="text-xs text-slate-500">Supporting documents remain linked to this award. {requesting ? "Procurement Team receives this request first. Legal Review begins after the team creates the contract." : "Legal Manager receives the contract after creation succeeds."}</p>
      {notice && <p role="status" className="text-sm text-slate-700">{notice}</p>}
      {context.contract && context.can_open_contract ? <Link className={CLM_BUTTON} to={clmRecordRoute("Contract", context.contract.name)}>View Contract</Link> : context.request && context.can_open_request && (onOpenRequest ? <button type="button" className={CLM_BUTTON} onClick={() => onOpenRequest(context.request!.name)}>Open Contract Request</button> : <Link className={CLM_BUTTON} to={clmRecordRoute(requestType, context.request.name)}>Open Contract Request</Link>)}
      {error && <div role="alert" className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><p>{error}</p><button type="button" disabled={busy} className={CLM_BUTTON} onClick={() => void refreshAward()}>Refresh award</button><p className="text-xs">Refresh the saved award while keeping your entered request details.</p></div>}
      <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" className={CLM_BUTTON} disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className={CLM_PRIMARY} disabled={busy || !canInitiate || !initialized || metadata.isError || !fields.length || !!missingDefinitions.length || !canSubmit}>{busy ? requesting ? "Submitting…" : resuming ? "Resuming…" : "Creating…" : preparingRequest ? "Save Contract Request Details" : requesting ? "Submit CLM Request" : createLabel}</button></footer>
    </form>
  </div>;
}

export default function RfqContractPanel({ rfqName, refreshToken, expectedRequestName, onOpenRequest, hidden = false }: { rfqName: string; refreshToken?: string; expectedRequestName?: string; onOpenRequest?: (requestName: string) => void; hidden?: boolean }) {
  const canInitiate = canPrepareRfqContract(useAuthStore(state => state.user?.role));
  const navigate = useNavigate();
  const qc = useQueryClient();
  const queryKey = ["clm", "rfq-contract", rfqName, clmViewerKey()];
  const query = useQuery({ queryKey, queryFn: () => getRfqClmSummary(rfqName), staleTime: 15_000, refetchInterval: 15_000, refetchOnWindowFocus: "always" });
  useEffect(() => { void query.refetch(); }, [refreshToken]);
  // Keep the exact award snapshot while editing; the server checks its revision.
  const [editing, setEditing] = useState<{ context: RfqClmSummary; mode: "request" | "create_contract" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const deciding = useRef(false);
  const summary = query.data;
  const awaitingSubmission = !!summary && isDraftRfq(summary);
  const historicalOrder = summary?.decision === "Pending" && summary.continuation_ready && !summary.blocks_procurement && !summary.can_decide;
  function saved(result: RfqClmDecisionResult) {
    qc.setQueryData(queryKey, result.summary);
    void qc.invalidateQueries({ queryKey: ["clm"] });
    void qc.invalidateQueries({ queryKey: ["clm", "list", "Contract"] });
    void qc.invalidateQueries({ queryKey: ["rfq", rfqName] });
    setEditing(null); setError("");
    if (result.summary.decision === "No") { toast.success("The RFQ's saved No Contract requirement is confirmed. The RFQ workflow can continue."); return; }
    if (!result.contract && result.request) {
      toast.success(summary?.request_needs_details ? "Contract Request details saved. Procurement Team can now create the Contract." : result.created ? "CLM Request submitted to Procurement Team." : "CLM Request already exists in Procurement Team's queue.");
      if (result.request.warnings?.length) toast(result.request.warnings.join(" "), { icon: "ℹ️" });
      if (result.summary.request && result.summary.can_open_request) navigate(clmRecordRoute(requestType, result.summary.request.name));
      return;
    }
    toast.success(result.created ? "Contract created and sent to Legal Review." : "Contract already exists. Opening the contract.");
    if (result.contract?.warnings?.length) toast(result.contract.warnings.join(" "), { icon: "ℹ️" });
    const { contract, request, can_open_contract, can_open_request } = result.summary;
    if (contract && can_open_contract) navigate(clmRecordRoute("Contract", contract.name));
    else if (request && can_open_request) navigate(clmRecordRoute(requestType, request.name));
  }
  async function confirmAwardDecision() {
    if (deciding.current || !canInitiate || awaitingSubmission || !summary?.can_decide || (summary.decision !== "Pending" && !summary.recovery_required) || !summary.source?.award || !summary.source.supplier || !summary.source.quotation) return;
    deciding.current = true; setBusy(true); setError("");
    try { saved(await recordRfqAwardDecision({ rfq: rfqName, award_id: summary.source!.award!, supplier_id: summary.source!.supplier!, quotation_id: summary.source!.quotation! })); }
    catch (cause) { setError(clmError(cause)); }
    finally { deciding.current = false; setBusy(false); }
  }
  if (expectedRequestName && summary && summary.request?.name !== expectedRequestName) return <p role="alert" className="text-sm text-rose-700">The RFQ does not reference this Contract Request. Refresh its saved source before continuing.</p>;
  if (hidden) return null;
  return <section aria-label="Contract Management" className="min-w-0 rounded-xl border border-neutral-200 bg-white p-4 sm:p-5">
    <h2 className="text-sm font-semibold text-neutral-800">Contract Management</h2>
    {query.isLoading ? <p role="status" className="mt-3 text-sm text-neutral-500">Loading contract status…</p> : query.isError || !summary ? <div role="alert" className="mt-3 text-sm text-rose-700">{clmError(query.error)}<button type="button" className={`${CLM_BUTTON} ml-3`} onClick={() => void query.refetch()}>Retry</button></div> : <>
      {canInitiate && !awaitingSubmission && summary.can_decide && summary.source?.award && (summary.decision === "Pending" || summary.recovery_required) && (!summary.request || summary.recovery_required) && !summary.contract && <div className="mt-3"><button type="button" className={CLM_PRIMARY} disabled={busy} onClick={() => void confirmAwardDecision()}>{busy ? "Confirming…" : "Retry Contract Handoff"}</button></div>}
      {canInitiate && !awaitingSubmission && summary.can_create && summary.decision === "Yes" && summary.request && (!summary.contract || summary.recovery_required) && <div className="mt-3"><button type="button" className={CLM_PRIMARY} disabled={busy} onClick={() => setEditing({ context: summary, mode: "create_contract" })}>{summary.recovery_required ? "Resume Contract creation" : "Review & Create Contract"}</button></div>}
      {canInitiate && !awaitingSubmission && summary.can_request && summary.decision === "Yes" && summary.request && !summary.contract && <div className="mt-3"><button type="button" className={CLM_PRIMARY} disabled={busy} onClick={() => setEditing({ context: summary, mode: "request" })}>{summary.request_needs_details ? "Complete Contract Request" : "Route CLM Request to Procurement Team"}</button></div>}
      <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-xs font-medium text-neutral-500">Contract Required (saved on RFQ)</dt><dd className="mt-1 text-sm font-semibold text-neutral-800">{historicalOrder ? "No (existing purchase order)" : summary.contract_required}</dd></div><div><dt className="text-xs font-medium text-neutral-500">CLM Status</dt><dd className="mt-1 break-words text-sm font-semibold text-neutral-800">{summary.status}</dd></div>{summary.request && <div className="min-w-0"><dt className="text-xs font-medium text-neutral-500">Contract Request</dt><dd className="mt-1 break-words text-sm font-semibold text-neutral-800">{summary.request.name}</dd></div>}{summary.contract ? <div className="min-w-0"><dt className="text-xs font-medium text-neutral-500">Contract ID</dt><dd className="mt-1 break-words text-sm font-semibold text-neutral-800">{summary.contract.name}</dd></div> : <div className="min-w-0"><dt className="text-xs font-medium text-neutral-500">Contract Status</dt><dd className="mt-1 text-xs font-medium text-neutral-500">Awaiting Creation</dd></div>}</dl>
      {summary.request?.assigned_role && <dl className="mt-3 grid gap-3 sm:grid-cols-2"><div><dt className="text-xs font-medium text-neutral-500">Assigned Role</dt><dd className="mt-1 text-sm font-semibold text-neutral-800">Procurement Team</dd></div><div><dt className="text-xs font-medium text-neutral-500">Current Stage</dt><dd className="mt-1 text-sm font-semibold text-neutral-800">{summary.request.current_stage || "Contract Creation"}</dd></div></dl>}
      {!awaitingSubmission && summary.blocks_procurement && (summary.recovery_required ? <p className="mt-3 text-xs text-amber-800">Contract creation is incomplete. Procurement Team must resume the saved handoff before Legal review, e-signature and Finance approval can begin.</p> : !summary.request ? <p className="mt-3 text-xs text-neutral-500">{summary.decision === "Pending" ? summary.source?.award ? "Retry the saved RFQ contract requirement handoff before continuing procurement." : "The saved RFQ contract requirement applies after supplier award." : "CLM Legal review, e-signature and Finance approval must be complete before purchase order creation can continue."}</p> : null)}
      {summary.reason && <p className="mt-2 text-xs text-neutral-500">{summary.reason}</p>}
      {summary.contract && !summary.recovery_required && <p className="mt-3 text-sm text-neutral-700">Contract already exists.</p>}
      {!awaitingSubmission && summary.request && !summary.contract && !summary.recovery_required && (
        summary.request.current_stage === "Procurement" && !summary.source?.award ? (
          <p className="mt-3 text-xs text-amber-800">Contract Request is pending with Procurement Team. Actual Contract creation follows supplier award and completed contract details.</p>
        ) : summary.request.assigned_role !== "procurement_team" ? (
          <p className="mt-3 text-xs text-amber-800">No Contract is linked yet. Route the existing Contract Request to Procurement Team before continuing.</p>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200/70 bg-amber-50/50 px-3 py-2 text-xs text-amber-900">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
            <span>Awaiting Procurement Team to create the contract from the approved award.</span>
          </div>
        )
      )}
      {summary.warnings.map((warning, index) => <p className="mt-2 text-xs text-amber-800" key={index}>{warning}</p>)}
      {(summary.can_open_request && summary.request || summary.can_open_contract && summary.contract) && <div className="mt-3 flex flex-wrap gap-2">{summary.can_open_request && summary.request && (onOpenRequest ? <button type="button" className={CLM_BUTTON} onClick={() => onOpenRequest(summary.request!.name)}>Open Contract Request</button> : <Link className={CLM_BUTTON} to={clmRecordRoute(requestType, summary.request.name)}>Open Contract Request</Link>)}{summary.can_open_contract && summary.contract && <Link className={CLM_BUTTON} to={clmRecordRoute("Contract", summary.contract.name )}>View Contract</Link>}</div>}
    </>}
    {error && <div role="alert" className="mt-3 text-sm text-rose-700">{error}<button className={`${CLM_BUTTON} ml-2`} type="button" disabled={busy} onClick={() => void query.refetch()}>Refresh award</button></div>}
    {canInitiate && !awaitingSubmission && editing && <RfqContractRequestEditor context={editing.context} mode={editing.mode} onCancel={() => { setEditing(null); void query.refetch(); }} onSaved={saved} onOpenRequest={onOpenRequest ? requestName => { setEditing(null); onOpenRequest(requestName); } : undefined} />}
  </section>;
}
