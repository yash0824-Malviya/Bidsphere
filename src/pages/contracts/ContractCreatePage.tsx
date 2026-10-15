import ClmSourcePicker, { isRfqRequestSource, type ContractSourceSelection } from "../../components/contracts/ClmSourcePicker";
import ContractCreationWizard from "../../components/contracts/ContractCreationWizard";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import PageHeader from "../../components/PageHeader";
import ClmFields, { CLM_BUTTON, CLM_PRIMARY, clmFormPayload, initialClmValues } from "../../components/contracts/ClmFields";
import { applyClmAction, clmError, clmViewerKey, clmRecordRoute, getClmMetadata, prefillClm } from "../../api/clm";
import { useAuthStore } from "../../store/authStore";

export default function ContractCreatePage({ doctype = "Contract" }: { doctype?: string }) {
  return doctype === "Contract" ? <ContractCreationWizard /> : <OtherContractCreatePage doctype={doctype} />;
}
function OtherContractCreatePage({ doctype }: { doctype: string }) {
  const navigate = useNavigate(); const qc = useQueryClient(); const user = useAuthStore(state => state.user); const [params] = useSearchParams();
  const metadata = useQuery({ queryKey: ["clm", "metadata", clmViewerKey()], queryFn: getClmMetadata, staleTime: 60_000 });
  const [values, setValues] = useState<Record<string, unknown>>({}); const [initialized, setInitialized] = useState(false);
  const [source, setSource] = useState<ContractSourceSelection>(() => ({ doctype: params.get("source_doctype") || (doctype === "Contract Request" ? "Request for Quotation" : "Contract Request"), name: params.get("source_name") || "" }));
  const rfqHandoff = isRfqRequestSource(doctype, source) && !!source.name.trim();
  const fields = metadata.data?.fields[doctype] || [];
  useEffect(() => { if (!initialized && fields.length) { setValues(initialClmValues(fields, doctype, user?.email || user?.name)); setInitialized(true); } }, [fields, doctype, user, initialized]);
  useEffect(() => { const sourceType = params.get("source_doctype"); const name = params.get("source_name"); if (sourceType && name) setSource({ doctype: sourceType, name }); if (initialized && sourceType && name && !isRfqRequestSource(doctype, { doctype: sourceType, name })) prefillClm(doctype, sourceType, name).then(payload => setValues(current => ({ ...current, ...payload }))).catch(error => toast.error(clmError(error))); }, [params, initialized, doctype]);
  const mutation = useMutation({ mutationFn: () => applyClmAction({ doctype, action: "save", payload: clmFormPayload(fields, doctype, values, metadata.data?.editableFields?.[doctype] || metadata.data?.editable_fields?.[doctype]) }), onSuccess: result => { void qc.invalidateQueries({ queryKey: ["clm"] }); navigate(clmRecordRoute(result.doctype, result.record.name)); toast.success("Draft saved."); }, onError: error => toast.error(clmError(error)) });
  const allowed = metadata.data?.allowedCreate || metadata.data?.allowed_create || [];
  return <div className="mx-auto w-full min-w-0 max-w-5xl space-y-5 p-4 sm:p-6"><PageHeader actions={<Link className={CLM_BUTTON} to={doctype === "Contract Request" ? "/contract-requests" : "/contracts"}>Back to list</Link>} /><div><h1 className="text-2xl font-bold text-slate-900">New {doctype.toLowerCase()}</h1><p className="mt-1 text-sm text-slate-500">Save a draft, attach supporting documents, then submit for review.</p></div>
    {metadata.isLoading ? <p role="status">Loading contract fields…</p> : metadata.isError ? <p role="alert" className="text-rose-700">{clmError(metadata.error)}</p> : !allowed.includes(doctype) ? <p role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-800">Your role cannot create this record.</p> : <>
      <ClmSourcePicker doctype={doctype} selection={source} onSelectionChange={setSource} onApply={payload => setValues(current => ({ ...current, ...payload }))} />
      {!rfqHandoff && <form className="space-y-5 rounded-xl border border-slate-200 bg-white p-5" onSubmit={e => { e.preventDefault(); mutation.mutate(); }}><ClmFields fields={fields} doctype={doctype} values={values} onChange={setValues} editableFields={metadata.data?.editableFields?.[doctype] || metadata.data?.editable_fields?.[doctype]} /><div className="flex justify-end"><button className={CLM_PRIMARY} disabled={mutation.isPending} type="submit">{mutation.isPending ? "Saving…" : "Save draft"}</button></div></form>}
    </>}
  </div>;
}
