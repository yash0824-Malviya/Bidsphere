import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { clmError, getClmDocumentBlob, type ClmDetail, type ClmField } from "../../api/clm";
import { rfqClmWorkflowView } from "../../utils/rfqClmWorkflow";
import ClmDocuments from "./ClmDocuments";
import ClmPdfPreview from "./ClmPdfPreview";
import ContractPdfPreviewModal from "./ContractPdfPreviewModal";
import { CLM_BUTTON, CLM_INPUT, CLM_PRIMARY } from "./ClmFields";

const text = (value: unknown) => value == null || value === "" ? "—" : String(value).replace(/<[^>]*>/g, "");
type Props = { detail: ClmDetail; fields: ClmField[]; busy: boolean; onAction: (action: string, comment: string, payload?: Record<string, unknown>, expectedModified?: string) => Promise<void> };

function signatureEvidence(detail: ClmDetail, party: "supplier" | "inteva") {
  return detail.signatures?.find(row => row.party === party && row.version === detail.record.custom_current_version && !!row.file_id);
}

/** Current-version receipts only; superseded signatures remain in history. */
export function RfqSignatureApprovals({ detail }: { detail: ClmDetail }) {
  return <section aria-label="Contract signature records" className="mt-5 border-t border-slate-200 pt-4"><h3 className="mb-3 font-semibold">Contract signatures</h3><div className="grid gap-3 sm:grid-cols-2">{(["inteva", "supplier"] as const).map(party => {
    const receipt = signatureEvidence(detail, party);
    const status = party === "inteva" ? detail.signature_workflow?.legal_status : detail.signature_workflow?.supplier_status;
    return <section key={party} className="min-w-0 rounded-lg border border-slate-200 p-3"><h4 className="text-sm font-semibold">{party === "inteva" ? "Legal Manager Signature" : "Supplier Signature"}</h4><dl className="mt-2 space-y-1 text-sm"><div><dt className="inline text-slate-500">Status: </dt><dd className="inline font-medium">{status || (receipt ? "Signed" : "Pending")}</dd></div><div><dt className="inline text-slate-500">Signer: </dt><dd className="inline break-words">{text(receipt?.full_legal_name || receipt?.typed_name)}</dd></div><div><dt className="inline text-slate-500">Signed By / Email: </dt><dd className="inline break-words">{text(receipt?.by)}</dd></div><div><dt className="inline text-slate-500">Signed At: </dt><dd className="inline">{text(receipt?.at)}</dd></div><div><dt className="inline text-slate-500">Version: </dt><dd className="inline">{text(receipt?.version)}</dd></div>{receipt?.signature_comment && <div><dt className="inline text-slate-500">Comments / Rationale: </dt><dd className="inline whitespace-pre-wrap break-words">{receipt.signature_comment}</dd></div>}</dl></section>;
  })}</div></section>;
}

/** Display server-authorized signing readiness; this component never grants an action. */
export default function RfqContractSigning({ detail, fields, busy, onAction }: Props) {
  const [review, setReview] = useState<ClmDetail | null>(null);
  const workflow = rfqClmWorkflowView(detail.record);
  if (!workflow || !["signature", "finance_review", "procurement", "completed"].includes(workflow.phase)) return null;
  const readiness = detail.signature_workflow;
  const supplierStatus = readiness?.supplier_status || (signatureEvidence(detail, "supplier") ? "Signed" : "Pending");
  const legalStatus = readiness?.legal_status || (signatureEvidence(detail, "inteva") ? "Signed" : "Pending");
  const signedContract = [...(detail.signatures || [])].reverse().find(row => row.version === detail.record.custom_current_version && !!row.file_id);
  const granted = detail.actions.some(action => (typeof action === "string" ? action : action.action) === "sign");
  const legalPending = workflow.phase === "signature" && readiness?.is_legal_signatory && legalStatus === "Pending";
  const canSign = !!legalPending && readiness?.can_sign === true && granted;
  return <section aria-label="Contract signatures" className="min-w-0 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-slate-900">{legalPending ? "E-SIGNATURE REQUIRED" : "Contract signatures"}</h2><div className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-live="polite"><p>Supplier Signature: <strong>{supplierStatus}</strong></p><p>Legal Manager Signature: <strong>{legalStatus}</strong></p></div></div>
    {workflow.phase === "finance_review" && legalStatus === "Signed" && <p role="status" className="mt-2 text-sm text-slate-600">Legal Manager signature completed. Contract is now pending Finance Approval.</p>}
    {workflow.phase === "signature" && readiness?.blocked_reason && <p role="status" className="mt-2 text-sm text-slate-600">{readiness.blocked_reason}</p>}
    {workflow.phase === "signature" && readiness?.can_review && <div className="mt-3 flex flex-wrap gap-2"><button className={CLM_BUTTON} type="button" disabled={busy} onClick={() => setReview(detail)}>Review Documents</button>{legalPending && <button className={CLM_PRIMARY} type="button" disabled={busy || !canSign} onClick={() => setReview(detail)}>E-Sign Contract</button>}</div>}
    {legalStatus === "Signed" && signedContract && <div className="mt-3"><ClmDocuments doctype="Contract" record={detail.record} fields={[]} signatures={[signedContract]} signedOnly /></div>}
    {review && <SigningWorkspace key={`${review.record.name}:${review.record.modified}`} detail={review} fields={fields} busy={busy} canSign={canSign} onAction={onAction} onClose={() => setReview(null)} />}
  </section>;
}

export function SigningWorkspace({ detail, fields, busy, canSign, onAction, onClose, supplierSigner = false, purpose = "sign" }: Props & { canSign: boolean; onClose: () => void; supplierSigner?: boolean; purpose?: "accept" | "sign" }) {
  const [document, setDocument] = useState<{ url: string; bytes: Uint8Array; ready: boolean } | null>(null);
  const [error, setError] = useState(""); const [attempt, setAttempt] = useState(0);
  const [actionError, setActionError] = useState("");
  const [fullLegalName, setFullLegalName] = useState(""); const [consent, setConsent] = useState(false); const [comment, setComment] = useState("");
  const [requestId] = useState(() => globalThis.crypto.randomUUID());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [signerEmail, setSignerEmail] = useState("");
  const [signatoryRole, setSignatoryRole] = useState("");
  const record = detail.record;
  const acceptance = supplierSigner && purpose === "accept";
  const supplierWorkflow = detail.supplier_workflow;
  const fileId = supplierSigner ? supplierWorkflow?.document_file_id : detail.signature_workflow?.document_file_id;
  const pdfVersion = supplierSigner ? supplierWorkflow?.version : undefined;
  useEffect(() => {
    let cancelled = false; let url = ""; setDocument(null); setError(""); setConsent(false); setPreviewOpen(false);
    const request = supplierSigner ? getClmDocumentBlob("Contract", record.name, "current_pdf", fileId, pdfVersion) : getClmDocumentBlob("Contract", record.name, "locked_file", fileId);
    void request.then(async blob => {
      if (cancelled) return;
      if (!blob.size) throw new Error("Contract document is not available for signing.");
      if (!blob.type.includes("pdf")) throw new Error("The approved contract PDF could not be loaded. Refresh the contract before signing.");
      // Verify the protected PDF bytes before the renderer may make this
      // document reviewable. Renderer completion is also required below.
      const { PDFDocument } = await import("pdf-lib");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let pdf;
      try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); }
      catch { throw new Error("The contract PDF could not be opened. Refresh the contract or contact Legal support before signing."); }
      if (pdf.getPageCount() < 1) throw new Error("The contract PDF has no pages available for review.");
      if (cancelled) return;
      url = URL.createObjectURL(blob); setDocument({ url, bytes, ready: false });
    }).catch(reason => { if (!cancelled) { const message = clmError(reason); setError(/document not found/i.test(message) ? "Contract document is not available for signing." : message); } });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [record.name, record.modified, fileId, pdfVersion, supplierSigner, attempt]);
  const workflow = rfqClmWorkflowView(record);
  const value = record.custom_contract_value == null ? "—" : `${text(record.custom_currency)} ${Number(record.custom_contract_value).toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
  const supplier = text(record.party_full_name || record.custom_supplier || record.party_name).replace(/^(["'])(.*)\1$/, "$2");
  const supplierStatus = supplierSigner && supplierWorkflow
    ? supplierWorkflow.acceptance_status === "Accepted" && supplierWorkflow.signature_status === "Signed" ? "Fully Signed" : supplierWorkflow.acceptance_status === "Accepted" ? "Pending Supplier Signature" : "Pending Contract Acceptance"
    : undefined;
  const reviewFields = [["Contract", record.name], ["Supplier", supplier], ["RFQ", record.custom_rfq], ["Award", workflow?.award], ["Winning Quotation", record.custom_supplier_quotation], ["Contract Value", value], ["Contract Type", record.custom_contract_type], ["Contract Start", record.start_date], ["Contract End", record.end_date], ["Version", record.custom_current_version], ["Status", supplierStatus || workflow?.status || record.custom_contract_status]];
  const readiness = detail.signature_workflow;
  const legalSigned = readiness?.legal_status === "Signed" || !!signatureEvidence(detail, "inteva");
  const showSigner = supplierSigner ? Boolean(supplierWorkflow && (acceptance ? supplierWorkflow.can_accept_contract : supplierWorkflow.can_sign_contract)) : readiness?.is_legal_signatory === true && workflow?.phase === "signature" && !legalSigned;
  const granted = detail.actions.some(action => (typeof action === "string" ? action : action.action) === (acceptance ? "supplier_accept" : "sign"));
  const authorized = canSign && showSigner && granted && (supplierSigner
    ? Boolean(supplierWorkflow?.version && supplierWorkflow.document_file_id && supplierWorkflow.document_hash)
    : readiness?.can_sign === true && !!String(record.custom_current_version || "").trim() && record.custom_contract_status === "Pending Signature");
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail.trim());
  const ready = authorized && !!document?.ready && !error && (acceptance || fullLegalName.trim().length > 0 && (!supplierSigner || validEmail)) && consent && !busy;
  const blockedReason = !authorized ? readiness?.blocked_reason || "Signing is not currently authorized for this contract version. Refresh the Contract to check its current stage and assigned signer." : "";
  const instruction = blockedReason || (error ? "Load the approved PDF before continuing." : !document?.ready ? "Waiting for the approved PDF to finish loading." : !acceptance && !fullLegalName.trim() ? "Enter your full legal name and confirm your consent." : !acceptance && supplierSigner && !validEmail ? "Enter your signatory email address." : !consent ? "Check the consent box to continue." : acceptance ? "Contract acceptance is ready to confirm. Signing is a separate next step." : "Your signature is ready to confirm.");
  const actionTitle = acceptance ? "Review & Accept Contract" : "E-Sign Contract";
  const signerTitle = acceptance ? "Supplier Contract Acceptance" : supplierSigner ? "Supplier E-Signature" : "Legal Manager E-Signature";
  const formId = `contract-signature-${requestId}`;
  const modal = <div role="dialog" aria-modal="true" aria-label={acceptance ? "Review and accept contract" : "Review and e-sign contract"} className="fixed inset-0 z-[1100] flex items-center justify-center overflow-hidden bg-slate-950/60 p-2.5 sm:p-4 xl:p-6"><div className="flex max-h-[calc(100dvh-20px)] w-full min-w-0 max-w-[1100px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:max-h-[calc(100dvh-32px)] xl:max-h-[calc(100dvh-48px)]">
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 p-3 sm:p-4"><div className="min-w-0"><h2 className="text-lg font-semibold text-slate-900">{actionTitle} <span className="ml-2 inline-block font-mono text-sm font-medium text-slate-600">{record.name}</span></h2><p className="mt-1 text-xs text-slate-600">{acceptance ? "Review the approved contract terms before accepting. Your electronic signature is a separate next step." : "Review the approved contract and complete your electronic signature."}</p></div><button className={`${CLM_BUTTON} shrink-0 !p-2`} aria-label={acceptance ? "Close contract acceptance" : "Close e-sign contract"} type="button" disabled={busy} onClick={onClose}><X className="h-5 w-5" aria-hidden="true" /></button></header>
    <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain p-3 sm:p-4">
    <details open={supplierSigner && !acceptance ? true : undefined} className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-800">Contract Summary <span className="ml-2 font-normal text-slate-600">{supplier} · {value}</span></summary><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">{reviewFields.map(([label, value]) => <div className="min-w-0" key={String(label)}><dt className="text-xs font-semibold text-slate-500">{text(label)}</dt><dd className="mt-1 break-words">{text(value)}</dd></div>)}</dl></details>
    <div className="grid min-w-0 items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(280px,0.85fr)]">
    <section className="order-2 min-w-0 sm:order-1" aria-label="Contract document to sign"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Approved Contract Document</h3>{document && !error && <button type="button" className="text-xs font-semibold text-blue-700 underline" onClick={() => setPreviewOpen(true)}>View Contract PDF</button>}</div>{error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}<button className={`${CLM_BUTTON} mt-2`} type="button" onClick={() => setAttempt(value => value + 1)}>Retry document</button></div> : !document ? <p role="status" className="p-4 text-sm text-slate-500">Loading approved contract document…</p> : <ClmPdfPreview key={document.url} bytes={document.bytes} title="Approved contract document to sign" maxHeight={420} onReady={() => setDocument(current => current ? { ...current, ready: true } : null)} onError={reason => { setDocument(current => current ? { ...current, ready: false } : null); setConsent(false); setError(`The contract document preview could not load. ${reason.message} Retry before signing.`); }} />}
    <details className="mt-3 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Contract details and terms</summary><p className="mt-3 break-words text-sm font-medium">{text(record.custom_contract_title)}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{text(record.contract_terms)}</p></details>
    <details className="mt-3 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Supporting documents and downloads</summary><div className="mt-3"><ClmDocuments doctype="Contract" record={record} fields={fields} supportingDocuments={detail.supplier_documents} signatures={detail.signatures} /></div></details></section>
    {showSigner ? <form id={formId} aria-label={signerTitle} className="order-1 min-w-0 space-y-3 rounded-lg border border-blue-200 bg-blue-50/30 p-3 sm:sticky sm:top-0 sm:order-2" onSubmit={async event => { event.preventDefault(); if (!ready) return; setActionError(""); try {
      // The explicit consent and final confirmation adopt this name as the
      // typed signature. Merely entering a name never submits or signs.
      if (acceptance) await onAction("supplier_accept", comment, { consent, expected_version: supplierWorkflow!.version, document_file_id: supplierWorkflow!.document_file_id, document_hash: supplierWorkflow!.document_hash, request_id: requestId }, record.modified);
      else await onAction("sign", comment, { full_legal_name: fullLegalName.trim(), ...(supplierSigner ? { signer_email: signerEmail.trim(), ...(signatoryRole.trim() ? { signatory_role: signatoryRole.trim() } : {}) } : {}), signature: { method: "typed", value: fullLegalName.trim(), adopted: true }, consent, request_id: requestId }, record.modified);
      onClose();
    } catch (reason) { setActionError(clmError(reason)); } }}>
      <h3 className="text-sm font-bold text-slate-900">{signerTitle}</h3>
      <dl className="space-y-1 text-xs text-slate-700"><div><dt className="inline font-semibold">Signer / Role: </dt><dd className="inline">{supplierSigner ? "Supplier" : "Legal Manager"}</dd></div>{!supplierSigner && <div className="break-words"><dt className="inline font-semibold">Email: </dt><dd className="inline">{text(record.custom_inteva_signatory)}</dd></div>}</dl>
      {!acceptance && <label className="block text-sm font-medium">Full Legal Name *<input aria-label="Full legal name" className={`${CLM_INPUT} mt-1`} autoComplete="name" maxLength={160} required value={fullLegalName} onChange={event => { setFullLegalName(event.target.value); setConsent(false); setActionError(""); }} disabled={busy || !authorized} /></label>}
      {supplierSigner && !acceptance && <label className="block text-sm font-medium">Signatory Email *<input type="email" aria-label="Signatory email" className={`${CLM_INPUT} mt-1`} autoComplete="email" maxLength={254} required value={signerEmail} onChange={event => { setSignerEmail(event.target.value); setConsent(false); setActionError(""); }} disabled={busy || !authorized} /></label>}
      {supplierSigner && !acceptance && <label className="block text-sm font-medium">Signatory Role <span className="font-normal text-slate-500">(optional)</span><input aria-label="Signatory role" className={`${CLM_INPUT} mt-1`} maxLength={120} value={signatoryRole} onChange={event => { setSignatoryRole(event.target.value); setConsent(false); setActionError(""); }} disabled={busy || !authorized} /></label>}
      <label className="flex items-start gap-2 text-xs leading-5 text-slate-700"><input className="mt-1 h-4 w-4 shrink-0" type="checkbox" required checked={consent} disabled={busy || !authorized || !document?.ready || !!error} onChange={event => setConsent(event.target.checked)} />{acceptance ? "I have reviewed the approved Contract PDF and accept its terms on behalf of the supplier." : supplierSigner ? "I have reviewed the accepted contract and consent to sign it electronically as an authorized signatory." : "I have reviewed the final contract and agree to sign it electronically as an authorized signatory."}</label>
      <label className="block text-sm font-medium">Comments / Rationale <span className="font-normal text-slate-500">(optional)</span><textarea className={`${CLM_INPUT} mt-1`} rows={2} value={comment} onChange={event => setComment(event.target.value)} disabled={busy || !authorized} /></label>
      <p className="text-xs leading-5 text-slate-600">{acceptance ? "This confirms your acceptance of the displayed terms. Complete the separate Sign Contract step before accepting the Purchase Order." : "By confirming, you are applying your electronic signature to the approved contract version shown above, using the full legal name you entered."}</p>
      {!supplierSigner && readiness?.supplier_status !== "Signed" && <p className="text-xs leading-5 text-slate-600">The supplier signature is tracked separately. Your completed Legal Manager signature sends the contract to Finance Approval.</p>}
      <p role="status" aria-live="polite" className="text-xs font-medium text-slate-700">{instruction}</p>
      {actionError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{actionError}</p>}
    </form> : <p role="status" className="order-1 text-sm text-slate-600 sm:order-2">{legalSigned ? "The Legal Manager signature is already recorded for this version." : blockedReason}</p>}
    </div>
    </div>
    <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 p-3 sm:p-4"><button type="button" className={CLM_BUTTON} disabled={busy} onClick={onClose}>Cancel</button>{showSigner && <button type="submit" form={formId} className={CLM_PRIMARY} disabled={!ready}>{busy ? acceptance ? "Saving acceptance…" : "Persisting signature…" : acceptance ? "Confirm Contract Acceptance" : "Confirm & Sign Contract"}</button>}</footer>
  </div>
  </div>;
  const workspace = <>{modal}{previewOpen && document && <ContractPdfPreviewModal contractId={record.name} preview={{ url: document.url, type: "application/pdf", name: `${record.name}-approved.pdf`, bytes: document.bytes }} onClose={() => setPreviewOpen(false)} />}</>;
  // Escape the app shell so its fixed sidebar cannot cover the signing workspace.
  return typeof globalThis.document === "undefined" ? workspace : createPortal(workspace, globalThis.document.body);
}
