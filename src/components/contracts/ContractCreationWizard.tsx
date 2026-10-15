import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, FileText, Save } from "lucide-react";
import toast from "react-hot-toast";
import { applyClmAction, clmError, clmRecordRoute, clmViewerKey, getClmMetadata, prefillClm, type ClmDetail, type ClmField } from "../../api/clm";
import { useAuthStore } from "../../store/authStore";
import ClmFields, { CLM_BUTTON, CLM_PRIMARY, clmFormPayload, editableClmFields, fieldLabel, initialClmValues } from "./ClmFields";
import ClmSourcePicker, { isRfqRequestSource, type ContractSourceSelection } from "./ClmSourcePicker";
import { CONTRACT_CREATION_STEPS, contractFieldRequired, groupContractFields, validateContractStep } from "./contractCreationSteps";

const additionalReferences = new Set(["document_type", "document_name", "custom_contract_request", "custom_rfq", "custom_supplier_quotation", "custom_purchase_order", "custom_rfp", "custom_rfp_response"]);
const additionalDetails = new Set(["custom_project", "custom_business_unit", "custom_renewal_terms"]);

export function ContractCreationStepper({ current, reached, completed, busy, onSelect }: {
  current: number; reached: number; completed: boolean[]; busy: boolean; onSelect: (step: number) => void;
}) {
  return <nav aria-label="Contract creation stages" className="rounded-xl border border-slate-200 bg-white p-2 sm:p-3">
    <ol className="grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-5 sm:gap-2">{CONTRACT_CREATION_STEPS.map((step, index) => {
      const active = index === current; const done = !active && completed[index];
      return <li key={step.id} className="min-w-0"><button type="button" aria-current={active ? "step" : undefined} aria-label={`${index + 1}. ${step.title}${done ? ", completed" : active ? ", current" : ""}`} disabled={busy || index > reached} onClick={() => onSelect(index)}
        className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors sm:h-full sm:flex-col sm:items-start sm:p-3 ${active ? "bg-blue-700 text-white" : done ? "bg-blue-50 text-blue-800" : "text-slate-500 enabled:hover:bg-slate-50 disabled:text-slate-400"}`}>
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${active ? "border-white/40 bg-white/15" : done ? "border-blue-200 bg-blue-100" : "border-slate-200 bg-slate-50"}`}>{done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}</span>
        <span className="min-w-0 break-words text-xs font-semibold leading-5">{step.title}</span>
        {active && <span className="ml-auto text-[10px] text-blue-100 sm:hidden">Current</span>}
      </button></li>;
    })}</ol>
  </nav>;
}

function reviewText(field: ClmField, value: unknown): string {
  if (field.fieldtype === "Check") return value === true || value === 1 || value === "1" ? "Yes" : "No";
  if (value == null || value === "") return "Not provided";
  if (field.fieldtype.startsWith("Attach")) return String(value).split("/").pop() || String(value);
  if (Array.isArray(value)) return value.map(row => typeof row === "object" && row ? String(row.requirement || row.name || JSON.stringify(row)) : String(row)).join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).replace(/<br\s*\/?>|<\/(?:p|div|li)>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

export function ContractCreationReview({ groups, values, busy, onEdit }: {
  groups: ClmField[][]; values: Record<string, unknown>; busy: boolean; onEdit: (step: number) => void;
}) {
  const headings = ["Source & parties", "Contract dates & details", "Commercial terms", "Performance & quality", "Documents"];
  const highlights = [["party_name", "custom_contract_request", "custom_rfq", "custom_purchase_order", "custom_rfp"], ["custom_contract_type", "start_date", "end_date"], ["custom_contract_value", "custom_currency", "custom_payment_terms_description"], ["custom_risk_level", "custom_quality_requirements"], ["custom_contract_document"]];
  return <section aria-label="Review contract information" className="space-y-3">
    <div><h3 className="text-sm font-semibold text-slate-900">Review your contract</h3><p className="mt-1 text-xs text-slate-500">Expand a section to check every value, or choose Edit to make changes.</p></div>
    <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">{groups.map((fields, index) => {
      const entered = fields.filter(field => field.fieldtype === "Check" || (values[field.fieldname] != null && values[field.fieldname] !== "" && (!Array.isArray(values[field.fieldname]) || (values[field.fieldname] as unknown[]).length > 0)));
      const preview = entered.filter(field => highlights[index].includes(field.fieldname)).map(field => `${fieldLabel(field)}: ${reviewText(field, values[field.fieldname])}`).join(" · ");
      return <div key={headings[index]} className="flex min-w-0 items-start gap-2 px-3 py-3 sm:px-4"><details className="min-w-0 flex-1">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">{headings[index]}<span className="ml-2 text-xs font-normal text-slate-500">{entered.length} values</span>{preview && <span className="mt-1 line-clamp-2 break-words text-xs font-normal leading-5 text-slate-500 [overflow-wrap:anywhere]">{preview}</span>}</summary>
        <dl className="mt-3 grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2">{entered.map(field => <div key={field.fieldname} className={`min-w-0 ${field.fieldname === "contract_terms" ? "sm:col-span-2" : ""}`}><dt className="text-xs font-medium text-slate-500">{fieldLabel(field)}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800 [overflow-wrap:anywhere]">{reviewText(field, values[field.fieldname])}</dd></div>)}{!entered.length && <p className="text-xs text-slate-500">No information entered.</p>}</dl>
      </details><button type="button" className="shrink-0 text-xs font-semibold text-blue-700 hover:underline disabled:opacity-50" aria-label={`Edit ${headings[index]}`} disabled={busy} onClick={() => onEdit(index)}>Edit</button></div>;
    })}</div>
  </section>;
}

export default function ContractCreationWizard() {
  const navigate = useNavigate(); const qc = useQueryClient(); const [params] = useSearchParams();
  const user = useAuthStore(state => state.user);
  const metadata = useQuery({ queryKey: ["clm", "metadata", clmViewerKey()], queryFn: getClmMetadata, staleTime: 60_000 });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [initialized, setInitialized] = useState(false);
  const [step, setStep] = useState(0); const [reached, setReached] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({}); const [error, setError] = useState("");
  const [source, setSource] = useState<ContractSourceSelection>({ doctype: params.get("source_doctype") || "Contract Request", name: params.get("source_name") || "" });
  const rfqHandoff = isRfqRequestSource("Contract", source) && !!source.name.trim();
  const [loadingSource, setLoadingSource] = useState(false); const [uploading, setUploading] = useState(false);
  const [operation, setOperation] = useState<"save" | "submit" | null>(null);
  const [saved, setSaved] = useState<ClmDetail | null>(null);
  const [savedPayload, setSavedPayload] = useState("");
  const savedRef = useRef<ClmDetail | null>(null); const savingRef = useRef(false); const prefillRef = useRef("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  const fields = metadata.data?.fields.Contract || [];
  const allow = metadata.data?.editableFields?.Contract || metadata.data?.editable_fields?.Contract;
  const editable = editableClmFields(fields, "Contract", allow);
  const groups = groupContractFields(editable);
  const payload = clmFormPayload(fields, "Contract", values, allow);
  const dirty = JSON.stringify(payload) !== savedPayload;
  const busy = Boolean(operation || loadingSource || uploading);
  const allowed = metadata.data?.allowedCreate || metadata.data?.allowed_create || [];

  useEffect(() => {
    if (!initialized && fields.length) { setValues(initialClmValues(fields, "Contract", user?.email || user?.name)); setInitialized(true); }
  }, [fields, initialized, user]);
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ block: "nearest" });
  }, [step]);
  const sourceType = params.get("source_doctype"); const sourceName = params.get("source_name");
  useEffect(() => {
    if (!sourceType || !sourceName) return;
    const key = JSON.stringify([sourceType, sourceName]); if (prefillRef.current === key) return;
    setSource({ doctype: sourceType, name: sourceName });
    if (isRfqRequestSource("Contract", { doctype: sourceType, name: sourceName })) { prefillRef.current = key; setLoadingSource(false); setStep(0); return; }
    if (!initialized) return;
    prefillRef.current = key; setLoadingSource(true);
    prefillClm("Contract", sourceType, sourceName).then(result => { if (prefillRef.current === key) setValues(current => ({ ...current, ...result })); })
      .catch(cause => { if (prefillRef.current === key) toast.error(clmError(cause)); })
      .finally(() => { if (prefillRef.current === key) setLoadingSource(false); });
  }, [initialized, sourceType, sourceName]);

  function changeValues(next: Record<string, unknown>) {
    setValues(next);
    setErrors(current => Object.fromEntries(Object.entries(current).filter(([name]) => next[name] === values[name])));
    setError("");
  }
  function selectStep(next: number, validateForward = true) {
    if (busy || rfqHandoff || next < 0 || next > 4 || next === step) return;
    if (next > step && validateForward) {
      const invalid = validateContractStep(groups.slice(step, next).flat(), values, { forReview: true });
      if (Object.keys(invalid).length) {
        setErrors(current => ({ ...current, ...invalid }));
        const first = groups.findIndex(group => group.some(field => invalid[field.fieldname]));
        if (first >= 0) setStep(first);
        setError("Complete the highlighted fields before continuing."); return;
      }
    }
    setStep(next); setReached(current => Math.max(current, next)); setError("");
  }
  async function persist(submit: boolean) {
    if (savingRef.current || busy || !initialized || rfqHandoff) return;
    if (submit) {
      const invalid = validateContractStep(editable, values, { forReview: true });
      if (Object.keys(invalid).length) {
        setErrors(invalid); setError("Complete the highlighted fields before submitting for review.");
        const first = groups.findIndex(group => group.some(field => invalid[field.fieldname]));
        if (first >= 0) { setStep(first); setReached(current => Math.max(current, first)); }
        return;
      }
    }
    savingRef.current = true; setOperation(submit ? "submit" : "save"); setError("");
    try {
      let result = savedRef.current;
      if (!result || dirty || !submit) {
        result = await applyClmAction({ doctype: "Contract", action: "save", ...(result ? { name: result.record.name, expected_modified: result.record.modified } : {}), payload });
        // Store the server identity before submission; failed routing must never
        // cause a retry to create a second Contract.
        savedRef.current = result; setSaved(result); setSavedPayload(JSON.stringify(payload));
        void qc.invalidateQueries({ queryKey: ["clm", "list"] });
        if (result.warnings?.length) toast(result.warnings.join(" "), { icon: "ℹ️" });
      }
      if (!submit) { toast.success("Draft saved. You can continue editing."); return; }
      if (!result.actions.some(action => (typeof action === "string" ? action : action.action) === "submit_review")) throw new Error("This draft cannot be submitted from its current stage. Open the saved contract to review its available actions.");
      const reviewed = await applyClmAction({ doctype: "Contract", name: result.record.name, expected_modified: result.record.modified, action: "submit_review" });
      savedRef.current = reviewed; setSaved(reviewed);
      void qc.invalidateQueries({ queryKey: ["clm"] });
      toast.success("Contract submitted for review.");
      if (reviewed.warnings?.length) toast(reviewed.warnings.join(" "), { icon: "ℹ️" });
      navigate(clmRecordRoute(reviewed.doctype, reviewed.record.name));
    } catch (cause) {
      const message = clmError(cause); setError(message); toast.error(message);
      // Match existing draft requirements only after the API rejects the save.
      // Next never validates fields belonging to a future stage.
      if (!submit) setErrors(validateContractStep(editable, values));
    } finally { savingRef.current = false; setOperation(null); }
  }
  async function loadTemplate() {
    if (busy || rfqHandoff || !values.contract_template) return;
    setLoadingSource(true);
    try { const result = await prefillClm("Contract", "Contract Template", String(values.contract_template)); setValues(current => ({ ...current, ...result })); setErrors({}); setError(""); toast.success("Template loaded. Review its wording in Contract Details."); }
    catch (cause) { toast.error(clmError(cause)); } finally { setLoadingSource(false); }
  }
  const stage = CONTRACT_CREATION_STEPS[step];
  const completed = groups.map((group, index) => index < reached && !Object.keys(validateContractStep(group, values, { forReview: true })).length);
  const secondaryNames = step === 0 ? additionalReferences : step === 1 ? additionalDetails : new Set<string>();
  const primary = groups[step].filter(field => !secondaryNames.has(field.fieldname));
  const secondary = groups[step].filter(field => secondaryNames.has(field.fieldname));
  const invalidStep = groups.findIndex(group => group.some(field => errors[field.fieldname]));
  const renderFields = (sectionFields: ClmField[]) => <ClmFields fields={sectionFields.map(field => ({ ...field, reqd: contractFieldRequired(field, { forReview: true }) }))} doctype="Contract" values={values} onChange={changeValues} name={saved?.record.name} editableFields={allow} compact errors={errors} onUploadBusyChange={setUploading} />;
  const reviewFields = fields.filter(field => (allow?.includes(field.fieldname) || editable.some(row => row.fieldname === field.fieldname)) && !["Section Break", "Column Break", "Tab Break"].includes(field.fieldtype));
  const sourcePicker = <ClmSourcePicker doctype="Contract" compact selection={source} onSelectionChange={setSource} onBusyChange={setLoadingSource} onApply={result => { setValues(current => ({ ...current, ...result })); setErrors({}); setError(""); toast.success("Source information loaded."); }} />;

  return <div className="mx-auto w-full min-w-0 max-w-6xl space-y-4 p-4 sm:p-6">
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><Link to="/contracts" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-blue-700"><ArrowLeft className="h-3.5 w-3.5" />Contracts</Link><h1 className="text-2xl font-bold text-slate-900">{rfqHandoff ? "Create Contract from RFQ Award" : "New contract"}</h1><p className="mt-1 text-sm text-slate-500">{rfqHandoff ? "Continue from the awarded RFQ to preserve its supplier and commercial context." : "Build your contract in five focused stages."}</p></div>
      {saved ? <div className="min-w-0 text-right"><span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800"><FileText className="h-3.5 w-3.5" />Draft</span><p className="mt-1 break-all text-xs text-slate-500">{saved.record.name} · {dirty ? "Unsaved changes" : "All changes saved"}</p></div> : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">New draft</span>}
    </header>
    {metadata.isLoading ? <p role="status" className="py-8 text-center text-sm text-slate-500">Loading contract fields…</p> : metadata.isError ? <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{clmError(metadata.error)}</p> : !allowed.includes("Contract") ? <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">Your role cannot create this record.</p> : !fields.length ? <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">Contract fields are unavailable. Refresh to load the form schema.</p> : rfqHandoff ? <section className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">{sourcePicker}</section> : !initialized ? <p role="status" className="py-8 text-center text-sm text-slate-500">Loading contract fields…</p> : <>
      <ContractCreationStepper current={step} reached={reached} completed={completed} busy={busy} onSelect={selectStep} />
      <form noValidate onSubmit={event => { event.preventDefault(); if (step === 4) void persist(true); else selectStep(step + 1); }} className="min-w-0 rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 sm:px-6"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-sm font-bold text-blue-700">{step + 1}</span><div className="min-w-0"><h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-slate-900 outline-none">{stage.title}</h2><p className="mt-0.5 text-xs text-slate-500">{stage.description}</p></div><span className="ml-auto shrink-0 text-xs text-slate-400">{step + 1} / 5</span></div>
        <div className="min-w-0 space-y-5 p-4 sm:p-6">
          {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><p>{error}</p>{invalidStep >= 0 && invalidStep !== step && <button type="button" className="mt-2 font-semibold underline" onClick={() => selectStep(invalidStep, false)}>Review required fields in {CONTRACT_CREATION_STEPS[invalidStep].title}</button>}{saved && <p className="mt-2 text-xs">Draft {saved.record.name} is saved. Your current entries remain here.</p>}</div>}
          <fieldset disabled={busy} className="min-w-0 space-y-5">
            {step === 0 && <>{sourcePicker}<div className="border-t border-slate-100 pt-4"><h3 className="mb-3 text-sm font-semibold text-slate-900">Parties & template</h3>{renderFields(primary)}<div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" className={CLM_BUTTON} disabled={!values.contract_template || busy} onClick={() => void loadTemplate()}>Load template</button><span className="text-xs text-slate-500">Template wording appears in Contract Details.</span></div></div></>}
            {step !== 0 && renderFields(primary)}
            {step === 1 && /\{\{|\{%/.test(String(values.contract_terms || "")) && <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Review and complete the placeholders in the loaded contract terms.</p>}
            {!!secondary.length && <details key={step} open={secondary.some(field => Boolean(errors[field.fieldname])) || undefined} className="border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs font-semibold text-blue-700">{step === 0 ? "Additional procurement references" : "Project, business unit & renewal terms"}<span className="ml-2 font-normal text-slate-400">{secondary.length} fields</span></summary><div className="mt-4">{renderFields(secondary)}</div></details>}
            {step === 4 && !saved && <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">Save your draft to enable document uploads, then submit when your review is complete.</p>}
          </fieldset>
          {step === 4 && <ContractCreationReview groups={groupContractFields(reviewFields)} values={values} busy={busy} onEdit={index => selectStep(index, false)} />}
        </div>
        <footer className="sticky bottom-0 z-10 flex min-w-0 flex-wrap items-center gap-2 rounded-b-xl border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
          {step > 0 && <button type="button" className={CLM_BUTTON} disabled={busy} onClick={() => selectStep(step - 1)}><ArrowLeft className="h-4 w-4" />Back</button>}
          <div className="ml-auto flex min-w-0 flex-wrap justify-end gap-2"><button type="button" className={CLM_BUTTON} disabled={busy} onClick={() => void persist(false)}><Save className="h-4 w-4" />{operation === "save" ? "Saving…" : "Save Draft"}</button>
            <button type="submit" className={CLM_PRIMARY} disabled={busy}>{step === 4 ? operation === "submit" ? "Submitting…" : "Submit for Review" : <>Next<ArrowRight className="h-4 w-4" /></>}</button></div>
        </footer>
      </form>
    </>}
  </div>;
}
