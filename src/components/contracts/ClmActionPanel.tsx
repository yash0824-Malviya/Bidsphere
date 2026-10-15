import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { CLM_BUTTON, CLM_INPUT, CLM_PRIMARY } from "./ClmFields";
import { clmError, uploadClmSupportingDocument, type ClmAction, type ClmSupportingDocument } from "../../api/clm";
import { evaluateContractEffectivePeriod } from "../../utils/contractEffectivePeriod";

export default function ClmActionPanel({ actions, busy, onAction, terms, contractName, expectedModified, onDocumentsUploaded, riskOptions = [], contractRecord }: {
  actions: ClmAction[]; busy: boolean; terms?: string; contractName?: string; expectedModified?: string;
  onDocumentsUploaded?: () => Promise<void>; riskOptions?: string[]; contractRecord?: Record<string, unknown>;
  onAction: (action: string, comment: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const [selected, setSelected] = useState<ClmAction | null>(null); const [comment, setComment] = useState("");
  const [content, setContent] = useState(""); const [typedName, setTypedName] = useState(""); const [consent, setConsent] = useState(false);
  const [closing, setClosing] = useState<Record<string, boolean>>({});
  const [requestId, setRequestId] = useState("");
  const [supportingDocuments, setSupportingDocuments] = useState<ClmSupportingDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadRefreshFailed, setUploadRefreshFailed] = useState(false);
  const [riskLevel, setRiskLevel] = useState("");
  const transitions = actions.filter(action => !["save", "record_sla", "new_version"].includes(action.action) && (contractName || !["finalize_procurement", "create_purchase_order"].includes(action.action)));
  if (!transitions.length) return null;
  const activationEval = selected?.action === "activate" && contractRecord
    ? evaluateContractEffectivePeriod(contractRecord)
    : null;

  return <section aria-label="Contract workflow actions" className="rounded-xl border border-blue-200 bg-blue-50/40 p-5"><h2 className="font-semibold text-slate-900">Actions available to you</h2>
    <div className="mt-3 flex flex-wrap gap-2">{transitions.map(action => ["finalize_procurement", "create_purchase_order"].includes(action.action) ? <Link key={action.action} className={CLM_PRIMARY} to={`/p2p/purchase-orders/new?${new URLSearchParams({ contract: contractName! })}`}>Create Purchase Order</Link> : <button key={action.action} type="button" disabled={busy || uploading} className={action.action === "approve" ? CLM_PRIMARY : CLM_BUTTON} onClick={() => { setSelected(action); setComment(""); setContent(terms || ""); setConsent(false); setSupportingDocuments([]); setRiskLevel(""); setUploadRefreshFailed(false); setRequestId(globalThis.crypto.randomUUID()); }}>{action.label}</button>)}</div>
    {selected && <form className="mt-4 space-y-4 rounded-lg border border-blue-100 bg-white p-4" onSubmit={async event => {
      event.preventDefault();
      if (selected.action === "activate" && activationEval && !activationEval.valid) {
        toast.error(activationEval.message || "The Contract cannot be activated outside its effective period.");
        return;
      }
      let payload: Record<string, unknown> | undefined;
      if (selected.action === "sign") payload = { typed_name: typedName, consent, request_id: requestId };
      if (selected.action === "supplier_redline") payload = { ...(content.trim() ? { contract_terms: content } : {}), supporting_documents: supportingDocuments.map(document => document.file_id) };
      if (selected.action === "close") payload = closing;
      if (selected.action === "create_contract") payload = { custom_risk_level: riskLevel };
      await onAction(selected.action, comment, payload).then(() => setSelected(null)).catch(() => undefined);
    }}><h3 className="font-semibold text-slate-900">{selected.label}</h3>
      {selected.action === "activate" && activationEval && (
        <div className="space-y-2">
          {!activationEval.valid ? (
            <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">Contract Effective Period Restriction</p>
              <p className="mt-1">{activationEval.message}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="font-semibold">Contract Ready for Activation</p>
              <p className="mt-1">
                The current business date ({activationEval.businessDate}) falls within the contract's effective period ({activationEval.startDate} to {activationEval.endDate}).
              </p>
            </div>
          )}
        </div>
      )}
      {selected.action === "supplier_redline" && <><label className="block text-sm font-medium">Proposed contract terms<textarea rows={10} className={`${CLM_INPUT} mt-1`} value={content} onChange={e => setContent(e.target.value)} /></label><p className="text-xs text-slate-500">Revise the terms or attach supporting documents, then explain your proposed changes below.</p>
        {contractName && <div className="space-y-2"><label className="block text-sm font-medium">Supporting documents<input className="mt-2 block w-full text-sm" aria-label="Upload negotiation supporting documents" type="file" multiple disabled={busy || uploading} onChange={async event => {
          const files = Array.from(event.target.files || []); if (!files.length) return;
          setUploading(true); setUploadRefreshFailed(false); let modified = expectedModified || "";
          try {
            for (const file of files) { const saved = await uploadClmSupportingDocument(file, contractName, modified); modified = saved.modified; setSupportingDocuments(current => [...current, saved]); }
          } catch (error) { toast.error(clmError(error)); } finally {
            try { await onDocumentsUploaded?.(); } catch (error) { setUploadRefreshFailed(true); toast.error(clmError(error)); }
            setUploading(false); event.target.value = "";
          }
        }} /></label>{uploading && <p role="status" className="text-xs text-blue-700">Uploading supporting documents…</p>}
        {supportingDocuments.length > 0 && <ul className="space-y-2">{supportingDocuments.map(document => <li key={document.file_id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-2 text-sm"><span className="min-w-0 break-words">{document.file_name}</span><button type="button" className="shrink-0 text-xs font-semibold text-slate-600" disabled={busy || uploading} onClick={() => setSupportingDocuments(current => current.filter(item => item.file_id !== document.file_id))}>Remove from response</button></li>)}</ul>}
        <p className="text-xs text-slate-500">Uploaded files stay private and are added to the negotiation history when you submit this response.</p></div>}
        {uploadRefreshFailed && <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Refresh the contract before submitting this response.<button className={`${CLM_BUTTON} ml-2`} type="button" disabled={uploading} onClick={async () => { setUploading(true); try { await onDocumentsUploaded?.(); setUploadRefreshFailed(false); } catch (error) { toast.error(clmError(error)); } finally { setUploading(false); } }}>Refresh contract</button></div>}
      </>}
      {selected.action === "create_contract" && <label className="block text-sm font-medium text-slate-700">Assessed contract risk level *<select className={`${CLM_INPUT} mt-1`} value={riskLevel} onChange={event => setRiskLevel(event.target.value)} required><option value="">Select the assessed risk level</option>{riskOptions.map(option => <option key={option}>{option}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">Assess the proposed terms and exposure before creating the contract. The approval matrix uses this assessment.</span></label>}
      {selected.action === "sign" && <><p className="text-sm text-slate-600">Review the locked contract in Documents before signing. Your signature applies to that approved version and is added to its dedicated signature page.</p><label className="block text-sm font-medium">Full legal name *<input className={`${CLM_INPUT} mt-1`} value={typedName} onChange={e => setTypedName(e.target.value)} required /></label><label className="flex items-start gap-2 text-sm text-slate-700"><input className="mt-1" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required />I have reviewed the final contract and consent to sign it electronically as an authorized signatory.</label></>}
      {selected.action === "close" && <><p className="text-sm text-slate-600">The service also checks outstanding obligations and financial documents before closing.</p>{[["claims_resolved", "All claims have been resolved"], ["disputes_resolved", "All disputes have been resolved"], ["warranty_resolved", "Warranty issues have been resolved"], ["settlement_complete", "Settlement is complete"], ["documents_archived", "Required documents have been archived"], ["outstanding_actions_resolved", "All outstanding actions are complete"]].map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" required checked={Boolean(closing[key])} onChange={e => setClosing(current => ({ ...current, [key]: e.target.checked }))} />{label}</label>)}</>}
      <label className="block text-sm font-medium text-slate-700">Comments / rationale{selected.requires_comment ? " *" : ""}<textarea className={`${CLM_INPUT} mt-1`} rows={3} value={comment} onChange={e => setComment(e.target.value)} required={selected.requires_comment} /></label>
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className={CLM_BUTTON} disabled={busy || uploading} onClick={() => setSelected(null)}>Cancel</button><button type="submit" className={CLM_PRIMARY} disabled={busy || uploading || uploadRefreshFailed || (selected.action === "sign" && !consent) || (selected.action === "create_contract" && !riskLevel) || (selected.action === "supplier_redline" && content.trim() === String(terms || "").trim() && !supportingDocuments.length) || (selected.action === "activate" && Boolean(activationEval && !activationEval.valid))}>{busy ? "Saving…" : `Confirm ${selected.label.toLowerCase()}`}</button></div>
    </form>}
  </section>;
}
