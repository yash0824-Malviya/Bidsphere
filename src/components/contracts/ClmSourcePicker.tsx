import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { clmError, prefillClm } from "../../api/clm";
import { CLM_BUTTON, CLM_INPUT, ClmLinkInput } from "./ClmFields";
import { canAccessPath, normalizeAppRole } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";

export interface ContractSourceSelection { doctype: string; name: string }
export const isRfqRequestSource = (doctype: string, source: ContractSourceSelection) => ["Contract", "Contract Request"].includes(doctype) && source.doctype === "Request for Quotation";
export default function ClmSourcePicker({ doctype, onApply, selection, onSelectionChange, onBusyChange, compact = false }: {
  doctype: string; onApply: (payload: Record<string, unknown>) => void;
  selection?: ContractSourceSelection; onSelectionChange?: (source: ContractSourceSelection) => void;
  onBusyChange?: (busy: boolean) => void; compact?: boolean;
}) {
  const [local, setLocal] = useState({ doctype: doctype === "Contract Request" ? "Request for Quotation" : "Contract Request", name: "" });
  const source = selection || local;
  const change = onSelectionChange || setLocal;
  const role = useAuthStore(state => state.user?.role);
  const rfqRequest = isRfqRequestSource(doctype, source);
  const rfqPath = `/sourcing/rfq/${encodeURIComponent(source.name.trim())}`;
  const canOpenRfq = !!role && canAccessPath(role, rfqPath);
  const canCreateRfqContract = !!role && normalizeAppRole(role) === "procurement_team";
  const mutation = useMutation({
    mutationFn: (chosen: ContractSourceSelection) => prefillClm(doctype, chosen.doctype, chosen.name),
    onMutate: () => onBusyChange?.(true),
    onSuccess: onApply,
    onError: error => toast.error(clmError(error)),
    onSettled: () => onBusyChange?.(false),
  });
  return <section className={compact ? "space-y-3" : "rounded-xl border border-blue-100 bg-blue-50/50 p-4"} aria-label="Source / procurement references">
    <div><h3 className="text-sm font-semibold text-slate-900">Source / procurement reference</h3><p className="mt-1 text-xs text-slate-500">Load supplier and commercial information from an existing record, if applicable.</p></div>
    <div className="grid min-w-0 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
      <label className="min-w-0 text-xs font-medium text-slate-600">Source type<select aria-label="Source document type" className={`${CLM_INPUT} mt-1.5`} value={source.doctype} disabled={mutation.isPending} onChange={event => change({ doctype: event.target.value, name: "" })}>{["Contract Request", "Request for Quotation", "Supplier Quotation", "Purchase Order", "RFP", "RFP Response"].filter(value => !(doctype === "Contract Request" && value === "Contract Request")).map(value => <option key={value}>{value}</option>)}</select></label>
      <div className="min-w-0"><p className="mb-1.5 text-xs font-medium text-slate-600">Source / procurement reference</p><ClmLinkInput label="Source / procurement reference" doctype={source.doctype} value={source.name} onChange={name => change({ ...source, name })} disabled={mutation.isPending} /></div>
      {rfqRequest ? canOpenRfq && source.name.trim() ? <Link className={`${CLM_BUTTON} min-h-10`} to={rfqPath}>{canCreateRfqContract ? "Create Contract from RFQ Award" : "Open RFQ"}</Link> : <button type="button" className={`${CLM_BUTTON} min-h-10`} disabled>{canCreateRfqContract ? "Create Contract from RFQ Award" : "Open RFQ"}</button> : <button type="button" className={`${CLM_BUTTON} min-h-10`} disabled={!source.name.trim() || mutation.isPending} onClick={() => mutation.mutate({ ...source })}>{mutation.isPending ? "Loading…" : "Load source"}</button>}
    </div>
    {rfqRequest && <p className="text-xs text-slate-600">{canCreateRfqContract ? "Open the awarded RFQ to create its contract. The saved award, selected supplier, winning quotation and any existing CLM are checked there." : "RFQ-sourced contracts are initiated by Procurement Team from the awarded RFQ."}</p>}
  </section>;
}
