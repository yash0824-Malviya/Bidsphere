import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { applyClmAction, clmError, clmViewerKey, clmRecordRoute, clmStatus, clmTitle, getClmDetail, getClmMetadata, prefillClm, type ClmAction, type ClmDetail, type ClmRecord } from "../../api/clm";
import ClmFields, { CLM_BUTTON, CLM_INPUT, CLM_PRIMARY, ClmLinkInput, clmFormPayload, fieldLabel, initialClmValues } from "./ClmFields";
import ClmActionPanel from "./ClmActionPanel";
import ClmPurchaseOrderSummary from "./ClmPurchaseOrderSummary";
import ClmDocuments from "./ClmDocuments";
import ClmMatrixFields from "./ClmMatrixFields";
import ClmAlerts from "./ClmAlerts";
import ClmSourceTraceability from "./ClmSourceTraceability";
import RfqContractWorkflow, { rfqContractPhase } from "./RfqContractWorkflow";
import { rfqClmLifecycleView, rfqClmWorkflowView } from "../../utils/rfqClmWorkflow";
import { ROLE_LABELS, type AppRole } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import RfqContractPanel from "../sourcing/RfqContractPanel";
import { rfqClmRequestWorkflowView } from "../../utils/rfqClmWorkflow";
import ProcurementRequestWorkspace from "./ProcurementRequestWorkspace";
import RfqContractSigning, { RfqSignatureApprovals } from "./RfqContractSigning";
import SupplierContractActions from "./SupplierContractActions";

const relatedTypes = ["Contract Risk", "Contract Obligation", "Contract Milestone", "Contract Renewal", "Contract Amendment"];
function text(value: unknown) { return value === undefined || value === null || value === "" ? "—" : typeof value === "object" ? "" : String(value).replace(/<[^>]*>/g, ""); }
function roleLabel(value: unknown) { return ROLE_LABELS[String(value) as AppRole] || text(value); }
export function normalizeClmActions(actions: ClmDetail["actions"]): ClmAction[] { return (actions || []).map(action => typeof action === "string" ? { action, label: action.replaceAll("_", " ") } : action); }

function AuthoringLibrary({ values, onChange }: { values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const [kind, setKind] = useState("Contract Template"); const [name, setName] = useState(""); const [busy, setBusy] = useState(false);
  return <div className="space-y-3 rounded-lg bg-blue-50/60 p-4"><h3 className="text-sm font-semibold text-slate-900">Template and clause library</h3><div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]"><select aria-label="Authoring library" className={CLM_INPUT} value={kind} onChange={e => { setKind(e.target.value); setName(""); }}><option>Contract Template</option><option>Contract Clause</option></select><ClmLinkInput doctype={kind} value={name} onChange={setName} /><button type="button" className={CLM_BUTTON} disabled={!name || busy} onClick={async () => {
    setBusy(true); try { const payload = await prefillClm("Contract", kind, name); onChange(kind === "Contract Clause" ? { ...values, ...payload, clause_ids: [...new Set([...(Array.isArray(values.clause_ids) ? values.clause_ids : []), ...(Array.isArray(payload.clause_ids) ? payload.clause_ids : [name])])], non_standard_clause: values.non_standard_clause === true || payload.non_standard_clause === true, contract_terms: `${String(values.contract_terms || "")}\n\n${String(payload.contract_terms || "")}`.trim() } : { ...values, ...payload }); toast.success(kind === "Contract Clause" ? "Clause added to this draft." : "Template loaded into this draft."); }
    catch (error) { toast.error(clmError(error)); } finally { setBusy(false); }
  }}>{busy ? "Loading…" : kind === "Contract Clause" ? "Add clause" : "Load template"}</button></div><p className="text-xs text-slate-500">Review all inserted terms before saving. Existing saved versions remain available in history.</p>
    {/\{\{|\{%/.test(String(values.contract_terms || "")) && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This template contains unresolved placeholders. Complete all contract terms before submitting for approval.</p>}
    {Array.isArray(values.clause_ids) && values.clause_ids.length > 0 && <div><p className="mb-2 text-xs font-semibold text-slate-700">Selected clause references</p><div className="flex flex-wrap gap-2">{values.clause_ids.map(clause => <span key={String(clause)} className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs">{String(clause)}<button type="button" aria-label={`Remove clause reference ${String(clause)}`} onClick={() => onChange({ ...values, clause_ids: (values.clause_ids as unknown[]).filter(value => value !== clause) })}>×</button></span>)}</div><p className="mt-1 text-xs text-slate-500">Removing a reference leaves the draft wording intact. Review the terms and non-standard clause declaration after editing.</p></div>}
    <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={values.non_standard_clause === true} onChange={e => onChange({ ...values, non_standard_clause: e.target.checked })} />This draft contains non-standard or revised clause wording.</label>
  </div>;
}
function SlaForm({ busy, onRecord }: { busy: boolean; onRecord: (payload: Record<string, unknown>) => Promise<void> }) {
  const [metric, setMetric] = useState(""); const [target, setTarget] = useState(""); const [actual, setActual] = useState(""); const [operator, setOperator] = useState("gte"); const [action, setAction] = useState("");
  return <form className="space-y-3 rounded-lg border border-slate-200 p-4" onSubmit={async e => { e.preventDefault(); await onRecord({ metric, target: Number(target), actual: Number(actual), operator, corrective_action: action }).then(() => { setMetric(""); setActual(""); setAction(""); }).catch(() => undefined); }}><h3 className="font-semibold text-slate-900">Record SLA / KPI performance</h3><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Metric *<input className={CLM_INPUT} required value={metric} onChange={e => setMetric(e.target.value)} /></label><label className="text-sm">Contractual target *<input className={CLM_INPUT} required type="number" step="any" value={target} onChange={e => setTarget(e.target.value)} /></label><label className="text-sm">Measured result *<input className={CLM_INPUT} required type="number" step="any" value={actual} onChange={e => setActual(e.target.value)} /></label><label className="text-sm">Target rule<select className={CLM_INPUT} value={operator} onChange={e => setOperator(e.target.value)}><option value="gte">At least (≥)</option><option value="lte">At most (≤)</option></select></label></div><label className="block text-sm">Corrective action<textarea className={CLM_INPUT} rows={2} value={action} onChange={e => setAction(e.target.value)} /></label><button className={CLM_PRIMARY} disabled={busy}>{busy ? "Saving…" : "Record result"}</button></form>;
}
export function ClmNewRelated({ doctype, parent, onSaved, onCancel }: { doctype: string; parent?: ClmRecord; onSaved: (detail: ClmDetail) => void; onCancel: () => void }) {
  const metadata = useQuery({ queryKey: ["clm", "metadata", clmViewerKey()], queryFn: getClmMetadata, staleTime: 60_000 }); const actor = useAuthStore(state => state.user);
  const fields = metadata.data?.fields[doctype] || [];
  const [values, setValues] = useState<Record<string, unknown>>({}); const [initialized, setInitialized] = useState(false);
  useEffect(() => { if (fields.length && !initialized) { setValues({ ...initialClmValues(fields, doctype, actor?.email || actor?.name), ...(parent ? { contract: parent.name, supplier: parent.custom_supplier || parent.party_name || parent.supplier, current_end_date: parent.end_date } : {}) }); setInitialized(true); } }, [fields, initialized, doctype, parent, actor]);
  const mutation = useMutation({ mutationFn: () => applyClmAction({ doctype, action: "save", payload: clmFormPayload(fields, doctype, values, metadata.data?.editableFields?.[doctype] || metadata.data?.editable_fields?.[doctype]) }), onSuccess: onSaved, onError: error => toast.error(clmError(error)) });
  return <form className="space-y-4" onSubmit={e => { e.preventDefault(); mutation.mutate(); }}><h2 className="text-xl font-semibold text-slate-900">New {doctype.toLowerCase()}</h2>{metadata.isLoading ? <p role="status">Loading fields…</p> : metadata.isError ? <p role="alert" className="text-rose-700">{clmError(metadata.error)}</p> : <><ClmFields fields={fields} doctype={doctype} values={values} onChange={setValues} editableFields={metadata.data?.editableFields?.[doctype] || metadata.data?.editable_fields?.[doctype]} />{doctype === "Contract Approval Matrix" && <ClmMatrixFields values={values} onChange={setValues} />}</>}<div className="flex justify-end gap-2"><button className={CLM_BUTTON} type="button" onClick={onCancel}>Cancel</button><button className={CLM_PRIMARY} disabled={mutation.isPending || !initialized}>{mutation.isPending ? "Saving…" : "Save draft"}</button></div></form>;
}
export default function ClmRecordWorkspace({ doctype, name, supplier = false, embedded = false, initialTab }: { doctype: string; name: string; supplier?: boolean; embedded?: boolean; initialTab?: string }) {
  const qc = useQueryClient(); const navigate = useNavigate();
  const [tab, setTab] = useState(() => initialTab || "Overview"); const [values, setValues] = useState<Record<string, unknown>>({}); const [versionComment, setVersionComment] = useState("");
  const authoringOpen = useRef(false); authoringOpen.current = tab === "Authoring";
  const authoringRevision = useRef<string | undefined>(undefined);
  const isRfqContractView = (record?: ClmRecord) => !supplier && doctype === "Contract" && typeof record?.custom_rfq === "string" && !!record.custom_rfq;
  const queryKey = ["clm", "detail", doctype, name, supplier, clmViewerKey()];
  const refreshLifecycle = (record?: ClmRecord) => {
    if (supplier || doctype !== "Contract" || tab === "Authoring" || !record) return false;
    const lifecycle = rfqClmLifecycleView(record);
    return !!lifecycle && !lifecycle.paused && ["legal_review", "signature", "finance_review", "procurement"].includes(lifecycle.current.phase);
  };
  const query = useQuery({ queryKey, queryFn: () => getClmDetail(doctype, name), staleTime: 15_000,
    refetchInterval: query => refreshLifecycle(query.state.data?.record) ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: query => tab === "Authoring" && isRfqContractView(query.state.data?.record) ? false : refreshLifecycle(query.state.data?.record) ? "always" : true,
    refetchOnReconnect: query => !(tab === "Authoring" && isRfqContractView(query.state.data?.record)),
  });
  const metadata = useQuery({ queryKey: ["clm", "metadata", clmViewerKey()], queryFn: getClmMetadata, staleTime: 60_000 });
  const [relatedEditor, setRelatedEditor] = useState<{ doctype: string; name?: string } | null>(null);
  const requestSection = useRef<HTMLDivElement>(null);
  const [requestOpenSequence, setRequestOpenSequence] = useState(0);
  useEffect(() => {
    if (!requestOpenSequence) return;
    requestSection.current?.scrollIntoView({ block: "start" });
    requestSection.current?.focus({ preventScroll: true });
  }, [requestOpenSequence]);
  const aggregate = query.data; const record = aggregate?.record; const fields = metadata.data?.fields[doctype] || [];
  const rfqRequest = !supplier && doctype === "Contract Request" && typeof record?.custom_rfq === "string" && !!record.custom_rfq;
  const rfqContract = isRfqContractView(record);
  const allowRelated = aggregate?.allowed_related || [];
  // Preserve both the entered terms and their original revision if an earlier
  // lifecycle read finishes during RFQ authoring. A concurrent save must conflict.
  useEffect(() => {
    if (record && !(rfqContract && authoringOpen.current)) {
      setValues({ ...record }); authoringRevision.current = record.modified;
    }
  }, [record, rfqContract]);
  // RFQ Requests are converted by the atomic award endpoint in the RFQ panel.
  // The generic Request action must not offer a second creation path.
  const actions = normalizeClmActions(aggregate?.actions || []).filter(action => !(doctype === "Contract Request" && record?.custom_rfq && action.action === "create_contract"));
  const canSave = actions.some(action => action.action === "save"); const canVersion = actions.some(action => action.action === "new_version");
  const mutation = useMutation({ mutationFn: ({ action, comment, payload, expectedModified }: { action: string; comment?: string; payload?: Record<string, unknown>; expectedModified?: string }) => applyClmAction({ doctype, name, action, comment, payload: payload && ["save", "new_version"].includes(action) ? clmFormPayload(fields, doctype, payload, aggregate?.editable_fields || metadata.data?.editableFields?.[doctype] || metadata.data?.editable_fields?.[doctype]) : payload, expected_modified: expectedModified ?? (rfqContract && ["save", "new_version"].includes(action) ? authoringRevision.current : record?.modified) }), onSuccess: (result, input) => {
    const linkedRfq = typeof result.record.custom_rfq === "string" ? result.record.custom_rfq.trim() : "";
    if (linkedRfq) {
      void qc.invalidateQueries({ queryKey: ["rfq", linkedRfq] });
      void qc.invalidateQueries({ queryKey: ["legal-doc-review", linkedRfq] });
    }
    if (result.supplier_workflow) {
      void qc.invalidateQueries({ queryKey: ["purchase-order-contract"] });
      void qc.invalidateQueries({ queryKey: ["supplier-portal-po", result.supplier_workflow.purchase_order] });
    }
    if (supplier && input.action === "supplier_accept" && clmStatus(result.record) === "Draft") {
      navigate("/supplier/contracts", { replace: true });
      qc.removeQueries({ queryKey, exact: true });
      void qc.invalidateQueries({ queryKey: ["clm", "list"] });
      toast.success("Contract accepted. The buyer will complete the required approvals before signing.");
      return;
    }
    if (result.doctype !== doctype || result.record.name !== name) navigate(clmRecordRoute(result.doctype, result.record.name, supplier));
    else {
      if (rfqContract && ["save", "new_version"].includes(input.action)) {
        authoringRevision.current = result.record.modified; setValues({ ...result.record });
      }
      qc.setQueryData(queryKey, result);
    }
    void qc.invalidateQueries({ queryKey: ["clm"] }); toast.success("Contract record updated.");
  }, onError: error => toast.error(clmError(error)) });
  async function runAction(action: string, comment: string, payload?: Record<string, unknown>, expectedModified?: string) { await mutation.mutateAsync({ action, comment, payload, ...(expectedModified ? { expectedModified } : {}) }); }
  if (query.isLoading) return <p role="status" className="p-8 text-center text-slate-500">Loading contract record…</p>;
  if (query.isError || !aggregate || !record) return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">{clmError(query.error)}<button className={`${CLM_BUTTON} ml-3`} onClick={() => void query.refetch()}>Retry</button></div>;
  const isContractRequest = doctype === "Contract Request";
  const isContract = doctype === "Contract";
  const tabs = isContractRequest
    ? [
        "Overview",
        ...(rfqRequest ? ["Request details"] : []),
        ...(!supplier ? ["Approvals"] : []),
        "Documents",
        ...(!supplier ? ["Audit history"] : []),
      ]
    : [
        "Overview",
        ...(!supplier && (canSave || canVersion) ? ["Authoring"] : []),
        ...(!supplier ? ["Approvals", "Versions"] : []),
        ...(isContract && !supplier ? ["Commitments", "Performance"] : []),
        "Documents",
        ...(!supplier ? ["Audit history"] : []),
      ];
  const activeTab = tabs.includes(tab) ? tab : "Overview";
  const displayFields = fields.filter(field => !field.hidden && !["Section Break", "Column Break", "Tab Break", "HTML", "Button", "Table", "Table MultiSelect", "JSON", "Code", "Signature", "Attach", "Attach Image"].includes(field.fieldtype) && !field.fieldname.includes("clm_data") && record[field.fieldname] !== undefined && record[field.fieldname] !== "" && record[field.fieldname] !== null);
  const workflow = !supplier ? doctype === "Contract" ? rfqClmWorkflowView(record) : doctype === "Contract Request" ? rfqClmRequestWorkflowView(record) : undefined : undefined;
  const lifecycle = !supplier && doctype === "Contract" ? rfqClmLifecycleView(record) : undefined;
  const supplierName = String(record.custom_supplier || record.supplier || (workflow && "supplier" in workflow ? workflow.supplier : "") || record.party_name || "");
  const rfqId = String(record.custom_rfq || (workflow && "rfq" in workflow ? workflow.rfq : "") || "");
  const awardId = String((workflow && "award" in workflow ? workflow.award : "") || record.custom_award || "");
  const contractVal = record.contract_value ?? record.custom_contract_value;
  const currencyVal = String(record.currency || record.custom_currency || "");
  const requester = String(record.requester || (workflow && "requester" in workflow ? workflow.requester : "") || "—");
  const department = String(record.department || (workflow && "department" in workflow ? workflow.department : "") || "—");
  const company = String(record.company || "Netlink");
  const winningQuotation = String(record.custom_supplier_quotation || record.supplier_quotation || (record.custom_clm_data ? (() => { try { const d = JSON.parse(String(record.custom_clm_data)); return d.rfq_source?.quotation || d.procurement_completion?.quotation || ""; } catch { return ""; } })() : "") || "—");

  const hasSpecificSupplier = Boolean(supplierName && supplierName !== "Not yet awarded" && supplierName !== doctype);
  const initialRequest = workflow?.phase === "procurement_team" && workflow.initialRequest ? workflow : undefined;
  const initialRequestFields = initialRequest ? [["RFQ", initialRequest.rfq], ["Department", initialRequest.department || "—"], ["Requester", initialRequest.requester || "—"], ["Contract Required", initialRequest.contractRequired || "—"], ["Status", initialRequest.status], ["Current Stage", initialRequest.stage], ["Supplier", initialRequest.supplier || "Not yet awarded"], ["Award", initialRequest.award || "Pending"], ["Owner", initialRequest.owner], ["Contract Type", text(record.contract_type)], ["Contract Purpose", text(record.contract_purpose)], ["Contract Description", text(record.description)], ["Start Date", text(record.contract_start_date)], ["End Date", text(record.contract_end_date)], ["Contract Value", text(record.currency ? record.contract_value : undefined)], ["Currency", text(record.currency)], ["Estimated Contract Value", text(record.currency ? record.estimated_contract_value : undefined)]] : [];

  const supplierHeadlineStatus = supplier && aggregate.supplier_workflow
    ? aggregate.supplier_workflow.acceptance_status === "Accepted" && aggregate.supplier_workflow.signature_status === "Signed" ? "Fully Signed" : aggregate.supplier_workflow.acceptance_status === "Accepted" ? "Pending Supplier Signature" : "Pending Contract Acceptance"
    : undefined;

  function openRequest(requestName: string) {
    if (requestName !== record!.name) { toast.error("The RFQ does not reference this Contract Request. Refresh its saved source before continuing."); return; }
    setTab(rfqRequest ? "Request details" : canSave || canVersion ? "Authoring" : "Overview");
    setRequestOpenSequence(sequence => sequence + 1);
  }

  const currentStatusDisplay = supplierHeadlineStatus || lifecycle?.current.status || workflow?.status || clmStatus(record);

  return <div className="min-w-0 space-y-5">
    {/* Header */}
    {isContractRequest && activeTab !== "Request details" ? (
      <header className="border-b border-slate-200 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-slate-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-slate-700">
              CONTRACT REQUEST
            </span>
            <span className="font-mono text-xs font-semibold text-slate-600">{record.name}</span>
          </div>
          <span className="inline-flex items-center rounded-full bg-amber-50 px-3.5 py-1 text-xs font-semibold text-amber-800 border border-amber-200 uppercase tracking-wide">
            {currentStatusDisplay}
          </span>
        </div>
        <h1 className="mt-2.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {hasSpecificSupplier ? `Procurement of goods/services from ${supplierName}` : clmTitle(record)}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          {rfqId && (
            <span className="font-medium">
              Source RFQ: <span className="font-mono font-semibold text-blue-700">{rfqId}</span>
            </span>
          )}
          {awardId && (
            <span className="font-medium">
              &bull; Award: <span className="font-mono font-semibold text-slate-800">{awardId}</span>
            </span>
          )}
          {contractVal ? (
            <span className="font-medium">
              &bull; Award Value: <span className="font-bold text-slate-900">{currencyVal ? `${currencyVal} ` : ""}{Number(contractVal).toLocaleString()}</span>
            </span>
          ) : null}
          {supplierName && (
            <span className="font-medium">
              &bull; Supplier: <span className="font-semibold text-slate-900">{supplierName}</span>
            </span>
          )}
        </div>
      </header>
    ) : !isContractRequest ? (
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-slate-100 px-2.5 py-0.5 text-xs font-bold tracking-wider text-slate-700 uppercase">
              {isContract ? "Contract" : doctype}
            </span>
            <span className="font-mono text-xs font-semibold text-slate-600">{record.name}</span>
          </div>
          <h1 className={`${embedded ? "text-xl" : "text-2xl"} mt-1.5 break-words font-bold tracking-tight text-slate-900`}>
            {isContract
              ? (hasSpecificSupplier ? `Contract with ${supplierName}` : clmTitle(record))
              : clmTitle(record)}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            {rfqId && <span className="font-medium">RFQ: <span className="font-mono text-slate-800">{rfqId}</span></span>}
            {awardId && <span className="font-medium">· Award: <span className="font-mono text-slate-800">{awardId}</span></span>}
            {isContract && contractVal ? (
              <span className="font-medium">· Contract Value: <span className="font-semibold text-slate-900">{currencyVal ? `${currencyVal} ` : ""}{Number(contractVal).toLocaleString()}</span></span>
            ) : null}
            {workflow && (workflow.createdBy || workflow.createdAt) ? (
              <span className="text-slate-400">· Created by {workflow.createdBy || "—"} {workflow.createdAt ? `(${workflow.createdAt})` : ""}</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
            currentStatusDisplay.toLowerCase().includes("completed")
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : currentStatusDisplay.toLowerCase().includes("pending")
              ? "bg-amber-50 text-amber-800 border border-amber-200"
              : "bg-blue-50 text-blue-800 border border-blue-200"
          }`}>
            {currentStatusDisplay}
          </span>
          {isContract && workflow?.phase === "completed" && (
            <p className="mt-0.5 text-[11px] font-medium text-slate-500">Contract lifecycle: {clmStatus(record)}</p>
          )}
        </div>
      </header>
    ) : null}

    {aggregate.warnings?.map((warning, index) => <p key={index} role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{warning}</p>)}
    {!supplier && <ClmAlerts alerts={aggregate.alerts || []} />}
    {!supplier && doctype === "Contract" && <RfqContractWorkflow record={record} />}
    {rfqContract && <RfqContractSigning detail={aggregate} fields={fields} busy={mutation.isPending} onAction={runAction} />}
    {supplier && doctype === "Contract" && aggregate.supplier_workflow && <SupplierContractActions detail={aggregate} fields={fields} busy={mutation.isPending} onAction={runAction} />}
    {isContract && workflow && actions.some(action => ["finalize_procurement", "create_purchase_order"].includes(action.action)) && (
      <section aria-label="Procurement finalization" className="min-w-0 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <h2 className="text-sm font-semibold text-emerald-900">Purchase Order</h2>
        <p className="mt-1 text-sm text-emerald-900">Legal and Finance approvals are complete. Create the Purchase Order from this Contract and its saved award. The Contract is completed after the PO is successfully submitted.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link className={CLM_PRIMARY} to={`/p2p/purchase-orders/new?${new URLSearchParams({ contract: record.name })}`}>Create Purchase Order</Link>
          <Link className="text-sm font-semibold text-blue-700 hover:underline" to={`/sourcing/rfq/${encodeURIComponent(workflow.rfq)}`}>Open linked RFQ</Link>
        </div>
      </section>
    )}
    {!supplier && doctype === "Contract" && <ClmPurchaseOrderSummary record={record} />}
    <ClmActionPanel actions={supplier && aggregate.supplier_workflow ? actions.filter(action => !["sign", "supplier_accept"].includes(action.action)) : rfqContract && aggregate.signature_workflow ? actions.filter(action => action.action !== "sign") : actions} busy={mutation.isPending} onAction={runAction} terms={String(record.contract_terms || "")} contractName={doctype === "Contract" ? record.name : undefined} expectedModified={record.modified} onDocumentsUploaded={async () => { const refreshed = await query.refetch(); if (refreshed.error) throw refreshed.error; }} riskOptions={(metadata.data?.fields.Contract || []).find(field => field.fieldname === "custom_risk_level")?.options?.split("\n").filter(Boolean) || []} contractRecord={doctype === "Contract" ? record : undefined} />
    {!supplier && doctype === "Contract Request" && typeof record.custom_rfq === "string" && record.custom_rfq && (
      <RfqContractPanel
        rfqName={record.custom_rfq}
        expectedRequestName={record.name}
        refreshToken={record.modified}
        onOpenRequest={openRequest}
        hidden={activeTab === "Request details"}
      />
    )}
    <div className="flex max-w-full gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Contract sections">{tabs.map(label => <button key={label} role="tab" aria-selected={activeTab === label} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold ${activeTab === label ? "border-blue-700 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-900"}`} onClick={() => setTab(label)}>{label}</button>)}</div>
    <div ref={requestSection} tabIndex={-1} role="tabpanel" aria-label={activeTab} className="scroll-mt-24 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      {activeTab === "Request details" && <ProcurementRequestWorkspace detail={aggregate} onSaved={saved => {
        if (saved.doctype !== doctype || saved.record.name !== name) { toast.error("The service returned a different Contract Request. Refresh before continuing."); return; }
        qc.setQueryData(queryKey, saved);
        void qc.invalidateQueries({ queryKey: ["clm"] });
      }} />}
      {activeTab === "Overview" && (
        isContractRequest ? (
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="border-b border-slate-100 pb-3 mb-4">
                <h2 className="text-base font-semibold text-slate-900">Additional Request Details</h2>
                <p className="text-xs text-slate-500">Departmental context and quotation information</p>
              </div>
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                {initialRequestFields.length ? (
                  initialRequestFields.map(([label, value]) => (
                    <div key={`request-${label}`} className={/Purpose|Description/.test(label) ? "min-w-0 sm:col-span-2 lg:col-span-3" : "min-w-0"}>
                      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
                      <dd className="whitespace-pre-wrap break-words text-sm text-slate-900">{value}</dd>
                    </div>
                  ))
                ) : (
                  <>
                    <div>
                      <dt className="text-xs font-medium text-slate-500">Requester</dt>
                      <dd className="mt-1 text-sm font-medium text-slate-900">{requester}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-slate-500">Department</dt>
                      <dd className="mt-1 text-sm font-medium text-slate-900">{department}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-slate-500">Company</dt>
                      <dd className="mt-1 text-sm font-medium text-slate-900">{company}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-slate-500">Winning Quotation</dt>
                      <dd className="mt-1 font-mono text-sm font-semibold text-slate-800">{winningQuotation || "—"}</dd>
                    </div>
                    {record.contract_type ? (
                      <div>
                        <dt className="text-xs font-medium text-slate-500">Contract Type</dt>
                        <dd className="mt-1 text-sm text-slate-800">{String(record.contract_type)}</dd>
                      </div>
                    ) : null}
                    {record.contract_start_date ? (
                      <div>
                        <dt className="text-xs font-medium text-slate-500">Target Start Date</dt>
                        <dd className="mt-1 text-sm text-slate-800">{String(record.contract_start_date)}</dd>
                      </div>
                    ) : null}
                    {record.contract_purpose ? (
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-medium text-slate-500">Contract Purpose</dt>
                        <dd className="mt-1 text-sm text-slate-800">{String(record.contract_purpose)}</dd>
                      </div>
                    ) : null}
                    {record.description ? (
                      <div className="sm:col-span-2 lg:col-span-3">
                        <dt className="text-xs font-medium text-slate-500">Description</dt>
                        <dd className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{String(record.description)}</dd>
                      </div>
                    ) : null}
                  </>
                )}
              </dl>
            </div>
            {record.custom_contract ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-blue-700">Linked Contract Record</span>
                    <p className="mt-1 font-mono text-sm font-bold text-slate-900">{String(record.custom_contract)}</p>
                  </div>
                  <Link className={CLM_PRIMARY} to={clmRecordRoute("Contract", String(record.custom_contract))}>Open Linked Contract</Link>
                </div>
              </div>
            ) : null}
            {!supplier && <ClmSourceTraceability record={record} contractDocuments={false} />}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="border-b border-slate-100 pb-3 mb-4">
                <h2 className="text-base font-semibold text-slate-900">Contract Overview</h2>
                <p className="text-xs text-slate-500">Core contract identity and assignment</p>
              </div>
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium text-slate-500">Contract Number</dt>
                  <dd className="mt-1 font-mono text-sm font-semibold text-slate-900">{record.name}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Contract Status</dt>
                  <dd className="mt-1 text-sm font-semibold text-blue-800">{supplierHeadlineStatus || clmStatus(record)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Supplier</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">{supplierName || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Company</dt>
                  <dd className="mt-1 text-sm font-medium text-slate-900">{company}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Department</dt>
                  <dd className="mt-1 text-sm font-medium text-slate-900">{department}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Contract Value</dt>
                  <dd className="mt-1 text-sm font-bold text-slate-900">{contractVal ? `${currencyVal ? `${currencyVal} ` : ""}${Number(contractVal).toLocaleString()}` : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">RFQ</dt>
                  <dd className="mt-1 font-mono text-sm font-semibold text-blue-700">{rfqId || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Award</dt>
                  <dd className="mt-1 font-mono text-sm font-semibold text-slate-800">{awardId || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Winning Quotation</dt>
                  <dd className="mt-1 font-mono text-sm font-semibold text-slate-800">{winningQuotation || "—"}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="border-b border-slate-100 pb-3 mb-4">
                <h2 className="text-base font-semibold text-slate-900">Commercial Details</h2>
                <p className="text-xs text-slate-500">Financial, delivery and payment specifications</p>
              </div>
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium text-slate-500">Contract Value</dt>
                  <dd className="mt-1 text-sm font-bold text-slate-900">{contractVal ? `${currencyVal ? `${currencyVal} ` : ""}${Number(contractVal).toLocaleString()}` : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Currency</dt>
                  <dd className="mt-1 text-sm font-medium text-slate-900">{currencyVal || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Payment Terms</dt>
                  <dd className="mt-1 text-sm font-medium text-slate-900">{String(record.payment_terms || record.custom_payment_terms || "—")}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Delivery Terms</dt>
                  <dd className="mt-1 text-sm font-medium text-slate-900">{String(record.delivery_terms || record.custom_delivery_terms || "—")}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Validity / Term</dt>
                  <dd className="mt-1 text-sm font-medium text-slate-900">
                    {record.contract_start_date ? `${record.contract_start_date} to ${record.contract_end_date || "Open"}` : "—"}
                  </dd>
                </div>
                {record.estimated_contract_value ? (
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Estimated Value</dt>
                    <dd className="mt-1 text-sm text-slate-800">{currencyVal ? `${currencyVal} ` : ""}{Number(record.estimated_contract_value).toLocaleString()}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

            {Boolean(record.contract_purpose || record.description) && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                <div className="border-b border-slate-100 pb-3 mb-4">
                  <h2 className="text-base font-semibold text-slate-900">Contract Scope & Terms</h2>
                </div>
                <div className="space-y-4">
                  {Boolean(record.contract_purpose) && (
                    <div>
                      <dt className="text-xs font-medium text-slate-500">Contract Purpose</dt>
                      <dd className="mt-1 text-sm text-slate-800">{String(record.contract_purpose)}</dd>
                    </div>
                  )}
                  {Boolean(record.description) && (
                    <div>
                      <dt className="text-xs font-medium text-slate-500">Description</dt>
                      <dd className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{String(record.description)}</dd>
                    </div>
                  )}
                </div>
              </div>
            )}

            {displayFields.filter(f => !["name", "custom_supplier", "supplier", "party_name", "custom_rfq", "custom_award", "custom_contract_value", "contract_value", "currency", "custom_currency", "payment_terms", "delivery_terms", "contract_start_date", "contract_end_date", "contract_purpose", "description", "custom_contract_status"].includes(f.fieldname)).length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                <h2 className="text-base font-semibold text-slate-900 mb-4">Additional Details</h2>
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                  {displayFields.filter(f => !["name", "custom_supplier", "supplier", "party_name", "custom_rfq", "custom_award", "custom_contract_value", "contract_value", "currency", "custom_currency", "payment_terms", "delivery_terms", "contract_start_date", "contract_end_date", "contract_purpose", "description", "custom_contract_status"].includes(f.fieldname)).map(field => {
                    const isEsign = field.fieldname === "custom_esign_status";
                    const label = supplierHeadlineStatus && isEsign ? "Contract Signature Status" : fieldLabel(field);
                    const val = supplierHeadlineStatus && isEsign
                      ? supplierHeadlineStatus
                      : field.fieldtype === "Check"
                        ? (Number(record[field.fieldname]) ? "Yes" : "No")
                        : text(record[field.fieldname]);
                    return (
                      <div key={field.fieldname}>
                        <dt className="text-xs font-medium text-slate-500">{label}</dt>
                        <dd className="mt-1 text-sm text-slate-900">{val}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            )}

            {aggregate.signatures?.length ? (
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                <h2 className="text-base font-semibold text-slate-900 mb-3">Signatures</h2>
                {aggregate.signatures.map((signature, index) => (
                  <p key={index} className="text-sm text-slate-700 mb-2">
                    {signature.party === "supplier" ? "Supplier" : rfqContract ? "Legal Manager" : "Inteva"}: {signature.typed_name} · {signature.at} · Version {signature.version}
                  </p>
                ))}
              </div>
            ) : null}

            {doctype === "Contract Request" && record.custom_contract ? (
              <Link className="mt-4 inline-block text-sm font-semibold text-blue-700" to={clmRecordRoute("Contract", String(record.custom_contract))}>Open linked contract</Link>
            ) : null}
            {!supplier && ["Contract", "Contract Request"].includes(doctype) && (
              <ClmSourceTraceability record={record} contractDocuments={doctype === "Contract"} />
            )}
          </div>
        )
      )}
      {activeTab === "Authoring" && <form className="space-y-5" onSubmit={async event => { event.preventDefault(); await runAction(canSave ? "save" : "new_version", versionComment, values).then(() => setVersionComment("")).catch(() => undefined); }}>
        {doctype === "Contract" && <AuthoringLibrary values={values} onChange={setValues} />}
        <ClmFields fields={fields} doctype={doctype} values={values} onChange={setValues} name={name} editableFields={aggregate.editable_fields || metadata.data?.editableFields?.[doctype] || metadata.data?.editable_fields?.[doctype]} readOnlyFields={doctype === "Contract" && typeof record.custom_rfq === "string" && record.custom_rfq.trim() ? ["custom_contract_value", "custom_currency"] : undefined} />
        {doctype === "Contract Approval Matrix" && <ClmMatrixFields values={values} onChange={setValues} />}
        <label className="block text-sm font-medium text-slate-700">Change summary{!canSave && canVersion ? " *" : ""}<textarea className={`${CLM_INPUT} mt-1`} rows={2} value={versionComment} onChange={e => setVersionComment(e.target.value)} required={!canSave && canVersion} /></label>
        <div className="flex justify-end gap-2"><button className={CLM_PRIMARY} disabled={mutation.isPending || metadata.isLoading}>{mutation.isPending ? "Saving…" : canSave ? "Save changes" : "Save new version"}</button>{canSave && canVersion && <button type="button" className={CLM_BUTTON} disabled={mutation.isPending || !versionComment.trim()} onClick={() => void runAction("new_version", versionComment, values).catch(() => undefined)}>Save as new version</button>}</div>
      </form>}
      {activeTab === "Approvals" && <section><h2 className="font-semibold">Required approvers</h2><p className="mb-4 mt-1 text-xs text-slate-500">{rfqContractPhase(record) ? "RFQ contract reviews run in sequence. Finance Approval starts only after Legal Review and E-Signature are complete." : "Approvers at the same stage work in parallel. The contract is approved only when every required approval is complete."}</p>{!aggregate.approvals?.length ? <p className="text-sm text-slate-500">No approval route has been generated.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[550px] text-left text-sm"><thead className="border-b text-xs text-slate-500"><tr>{["Stage", "Approver", "Status", "Decision by / date", "Comments"].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y">{aggregate.approvals.map((approval, index) => <tr key={String(approval.id || index)}><td className="p-3">{text(approval.stage)}</td><td className="p-3">{roleLabel(approval.role)}{approval.user ? <span className="block text-xs text-slate-500">{text(approval.user)}</span> : null}</td><td className="p-3 font-semibold">{text(approval.status)}</td><td className="p-3 text-xs">{text(approval.by)}<br />{text(approval.at)}</td><td className="max-w-sm whitespace-pre-wrap p-3">{text(approval.comment)}</td></tr>)}</tbody></table></div>}{rfqContract && <RfqSignatureApprovals detail={aggregate} />}</section>}
      {activeTab === "Versions" && <section><h2 className="mb-3 font-semibold">Contract versions</h2>{!aggregate.versions?.length && <p className="text-sm text-slate-500">No version history has been created.</p>}<div className="space-y-3">{aggregate.versions?.map((version, index) => <details key={String(version.id || index)} className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Version {text(version.number)} · {text(version.author)} · {text(version.at)}</summary><p className="my-3 text-sm text-slate-600">{text(version.comment)}</p><p className="text-xs text-slate-500">Previous version: {text(version.previous)}</p><div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{text((version.content as Record<string, unknown> | undefined)?.contract_terms)}</div></details>)}</div></section>}
      {activeTab === "Commitments" && <div className="space-y-6">{relatedTypes.map(type => <section key={type}><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{type.replace("Contract ", "")}s</h2>{allowRelated.includes(type) && <button className={CLM_BUTTON} onClick={() => setRelatedEditor({ doctype: type })}>Add {type.replace("Contract ", "").toLowerCase()}</button>}</div><div className="space-y-2">{(aggregate.related?.[type] || []).map(row => <button key={row.name} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50" onClick={() => setRelatedEditor({ doctype: type, name: row.name })}><span className="min-w-0"><span className="block text-xs text-slate-500">{row.name}</span><span className="text-sm font-medium">{clmTitle(row)}</span></span><span className="text-xs font-semibold text-slate-600">{clmStatus(row)}</span></button>)}{!aggregate.related?.[type]?.length && <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">No {type.replace("Contract ", "").toLowerCase()}s have been added yet.</div>}</div></section>)}</div>}
      {activeTab === "Performance" && <div className="space-y-4"><h2 className="font-semibold">SLA / KPI measurements</h2>{actions.some(action => action.action === "record_sla") && <SlaForm busy={mutation.isPending} onRecord={payload => runAction("record_sla", "", payload)} />}{aggregate.sla?.map(result => <div key={result.id} className={`rounded-lg border p-4 ${result.status === "Breached" ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}><p className="text-sm font-semibold">{result.metric} · {result.status}</p><p className="mt-1 text-sm">Target {result.operator === "gte" ? "≥" : "≤"} {result.target} · Actual {result.actual}</p><p className="mt-1 text-xs text-slate-600">{result.at} · {result.by}</p>{result.corrective_action && <p className="mt-2 text-sm">Corrective action: {result.corrective_action}</p>}</div>)}{!aggregate.sla?.length && <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">No SLA or KPI measurements have been recorded yet.</div>}</div>}
      {activeTab === "Documents" && <ClmDocuments doctype={doctype} record={record} fields={fields} supportingDocuments={aggregate.supplier_documents} signatures={doctype === "Contract" ? aggregate.signatures : undefined} />}
      {activeTab === "Audit history" && <section><h2 className="mb-3 font-semibold">Audit history</h2><ol className="space-y-4">{aggregate.audit?.map((entry, index) => <li className="border-l-2 border-slate-200 pl-4" key={String(entry.id || index)}><p className="text-sm font-semibold">{rfqContract && entry.action === "e_signed" ? entry.role === "legal" ? "Legal Manager E-Signature Completed" : entry.signature_party === "supplier" || entry.role === "supplier" ? "Supplier E-Signature Completed" : "E-Signature Completed" : text(entry.action).replaceAll("_", " ")}</p><p className="mt-1 text-xs text-slate-500">{text(entry.by)} · {text(entry.at)}</p><p className="mt-1 text-sm">{text(entry.previous_status)} → {text(entry.new_status)}</p>{rfqContract && entry.action === "e_signed" && <p className="mt-1 break-words text-xs text-slate-500">Contract: {text(entry.reference_id || record.name)} · Role: {roleLabel(entry.role)}{entry.signature_status ? ` · Signature: ${text(entry.signature_status)}` : ""}{entry.signature_file_id ? ` · Document: ${text(entry.signature_file_id)}` : ""}{entry.signature_status === "Signed" ? " · Result: Success" : ""}</p>}{entry.comment ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{text(entry.comment)}</p> : null}</li>)}</ol>{!aggregate.audit?.length && <p className="text-sm text-slate-500">No CLM actions have been recorded. Historical ERPNext changes remain in native version history.</p>}</section>}
    </div>
    {relatedEditor && <div role="dialog" aria-modal="true" aria-label={relatedEditor.doctype} className="fixed inset-0 z-40 overflow-y-auto bg-slate-950/50 p-3 sm:p-6"><div className="mx-auto my-3 w-full max-w-5xl rounded-xl bg-white p-4 shadow-xl sm:p-6"><div className="mb-4 flex justify-end"><button className={CLM_BUTTON} onClick={() => setRelatedEditor(null)}>Close</button></div>{relatedEditor.name ? <ClmRecordWorkspace doctype={relatedEditor.doctype} name={relatedEditor.name} embedded /> : <ClmNewRelated doctype={relatedEditor.doctype} parent={record} onCancel={() => setRelatedEditor(null)} onSaved={result => { setRelatedEditor({ doctype: result.doctype, name: result.record.name }); void qc.invalidateQueries({ queryKey: ["clm"] }); toast.success("Record saved."); }} />}</div></div>}
  </div>;
}
