import { useState } from "react";
import { Link } from "react-router-dom";
import type { ClmDetail, ClmField } from "../../api/clm";
import { CLM_BUTTON, CLM_PRIMARY } from "./ClmFields";
import { SigningWorkspace } from "./RfqContractSigning";
import SupplierContractLifecycle from "./SupplierContractLifecycle";
import ClmDocuments from "./ClmDocuments";

/** Reuse the existing reviewed-PDF workspace; accepting and signing remain separate server actions. */
export default function SupplierContractActions({ detail, fields, busy, onAction }: {
  detail: ClmDetail; fields: ClmField[]; busy: boolean;
  onAction: (action: string, comment: string, payload?: Record<string, unknown>, expectedModified?: string) => Promise<void>;
}) {
  const [review, setReview] = useState<{ detail: ClmDetail; purpose: "accept" | "sign" } | null>(null);
  const workflow = detail.supplier_workflow;
  if (!workflow) return null;
  const granted = (action: string) => detail.actions.some(row => (typeof row === "string" ? row : row.action) === action);
  const canAccept = workflow.can_accept_contract && granted("supplier_accept");
  // Supplier readiness is projected independently from the internal Legal
  // signatory policy. Both the supplier projection and server action are required.
  const canSign = workflow.can_sign_contract && granted("sign");
  const accepted = workflow.acceptance_status === "Accepted";
  const signed = accepted && workflow.signature_status === "Signed";
  const legalSigned = detail.signature_workflow?.legal_status === "Signed" || detail.signatures?.some(row => row.party === "inteva" && row.version === workflow.version && !!row.file_id);
  const signedDocument = signed ? detail.signatures?.find(row => row.party === "supplier" && row.version === workflow.version && row.file_id === workflow.document_file_id && row.hash === workflow.document_hash) : undefined;
  return <section aria-label="Supplier Contract actions">
    {accepted && !signed && <div aria-label="Supplier signature action required" className="rounded-xl border border-blue-300 bg-blue-50 p-4">
      <h2 className="text-sm font-bold text-blue-950">Action Required</h2>
      <p className="mt-1 text-sm text-blue-950">Please electronically sign the accepted contract.</p>
      {canSign ? <button type="button" className={`${CLM_PRIMARY} mt-3`} disabled={busy} onClick={() => setReview({ detail, purpose: "sign" })}>Sign Contract</button>
        : <p role="status" className="mt-2 text-xs text-slate-600">{workflow.blocked_reason || "Signing is not available for the saved Contract state. Refresh the Contract to check the current assignment."}</p>}
    </div>}
    <SupplierContractLifecycle workflow={workflow} />
    <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-700">
      <div><dt className="inline">Contract Acceptance: </dt><dd className="inline font-semibold">{workflow.acceptance_status}</dd></div>
      <div><dt className="inline">Supplier Signature: </dt><dd className="inline font-semibold">{workflow.signature_status}</dd></div>
      <div><dt className="inline">Legal Manager Signature: </dt><dd className="inline font-semibold">{legalSigned ? "Signed" : "Pending"}</dd></div>
    </dl>
    {signedDocument && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/30 p-3"><ClmDocuments doctype="Contract" record={detail.record} fields={[]} signatures={[signedDocument]} signedOnly /></div>}
    {signed && workflow.can_accept_po && <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3"><h2 className="text-sm font-semibold text-blue-950">Purchase Order Acceptance Required</h2><p className="mt-1 text-xs text-slate-700">The Contract is fully signed. Review and accept the linked Purchase Order in the existing PO workflow.</p><Link className={`${CLM_PRIMARY} mt-3`} to={`/supplier/po/${encodeURIComponent(workflow.purchase_order)}`}>Accept Purchase Order</Link></div>}
    <div className="mt-3 flex flex-wrap gap-2">
      {canAccept && <button type="button" className={CLM_PRIMARY} disabled={busy} onClick={() => setReview({ detail, purpose: "accept" })}>Accept Contract</button>}
      <Link className={CLM_BUTTON} to={`/supplier/po/${encodeURIComponent(workflow.purchase_order)}`}>View Purchase Order</Link>
    </div>
    {review && <SigningWorkspace key={`${review.detail.record.name}:${review.detail.record.modified}:${review.purpose}`} detail={review.detail} fields={fields} busy={busy} canSign={review.purpose === "accept" ? canAccept : Boolean(canSign)} supplierSigner purpose={review.purpose} onAction={onAction} onClose={() => setReview(null)} />}
  </section>;
}
