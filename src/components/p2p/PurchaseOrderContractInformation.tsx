import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileText, Loader2 } from "lucide-react";
import { clmError, clmRecordRoute, clmViewerKey, getClmDocumentBlob, getPurchaseOrderContract } from "../../api/clm";
import { formatCurrencyIn, formatDate } from "../../utils/format";
import { CLM_BUTTON, CLM_PRIMARY } from "../contracts/ClmFields";
import ContractPdfPreviewModal, { type ContractPreviewDocument } from "../contracts/ContractPdfPreviewModal";
import SupplierContractLifecycle from "../contracts/SupplierContractLifecycle";

/** PO acceptance stays independent; Contract actions open the existing authorized CLM workspace. */
export default function PurchaseOrderContractInformation({ purchaseOrder, supplier = false }: { purchaseOrder: string; supplier?: boolean }) {
  const viewer = clmViewerKey();
  const query = useQuery({
    queryKey: ["purchase-order-contract", viewer, purchaseOrder],
    queryFn: () => getPurchaseOrderContract(purchaseOrder),
    enabled: Boolean(purchaseOrder),
    staleTime: 0,
  });
  const [preview, setPreview] = useState<ContractPreviewDocument | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const contract = query.data?.contract;
  const scope = `${viewer}:${purchaseOrder}:${contract?.name}:${contract?.current_version}:${contract?.pdf?.file_id}:${contract?.pdf?.hash}`;
  const activeScope = useRef(scope);
  activeScope.current = scope;
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => { setPreview(null); setPdfError(""); }, [scope]);
  useEffect(() => () => { activeScope.current = ""; }, []);

  async function viewPdf() {
    if (!contract || loadingPdf || !contract.pdf_available) return;
    setLoadingPdf(true); setPdfError("");
    try {
      const blob = await getClmDocumentBlob("Contract", contract.name, "current_pdf", contract.pdf?.file_id, contract.current_version);
      if (!blob.type.includes("pdf")) throw new Error("The contract service did not return the authoritative Contract PDF.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (activeScope.current !== scope) return;
      setPreview({ url: URL.createObjectURL(blob), type: blob.type, name: `${contract.name}-v${contract.current_version}.pdf`, bytes });
    } catch (error) { if (activeScope.current === scope) setPdfError(clmError(error)); }
    finally { setLoadingPdf(false); }
  }

  const route = contract ? clmRecordRoute("Contract", contract.name, supplier) : "";
  const canSign = supplier && contract?.supplier_workflow?.can_sign_contract && contract.signature_workflow.can_sign && contract.actions.some(action => action.action === "sign");
  const canAccept = supplier && contract?.supplier_workflow?.can_accept_contract && contract.actions.some(action => action.action === "supplier_accept");
  return <section aria-label="Contract Information" className="my-3 min-w-0 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
    <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900"><FileText className="h-4 w-4 text-blue-700" />Contract Information</h2>
    {query.isLoading ? <p role="status" className="mt-3 text-sm text-neutral-500">Loading linked Contract…</p>
      : query.isError ? <div role="alert" className="mt-3 text-sm text-rose-700">{clmError(query.error)}<button type="button" className={`${CLM_BUTTON} ml-3`} onClick={() => void query.refetch()}>Refresh Contract</button></div>
      : contract ? <>
        <p className="mt-2 flex flex-wrap items-center gap-1.5 break-all text-xs text-neutral-500"><span>{purchaseOrder}</span><ArrowRight aria-hidden className="h-3 w-3 shrink-0" /><span>{contract.name}</span><ArrowRight aria-hidden className="h-3 w-3 shrink-0" /><span>{contract.status}</span></p>
        <dl className="mt-3 grid grid-cols-1 gap-x-5 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
          <div className="min-w-0"><dt className="text-xs text-neutral-500">Contract Reference</dt><dd className="mt-1 break-all font-semibold text-neutral-900">{contract.name}</dd></div>
          <div><dt className="text-xs text-neutral-500">Contract Status</dt><dd className="mt-1 font-semibold text-neutral-900">{contract.status}</dd></div>
          <div><dt className="text-xs text-neutral-500">Contract Value</dt><dd className="mt-1 font-semibold text-neutral-900">{formatCurrencyIn(contract.value, contract.currency)} <span className="text-xs font-normal">{contract.currency}</span></dd></div>
          <div><dt className="text-xs text-neutral-500">Contract Start Date</dt><dd className="mt-1 font-medium text-neutral-900">{contract.start_date ? formatDate(contract.start_date) : "—"}</dd></div>
          <div><dt className="text-xs text-neutral-500">Contract End Date</dt><dd className="mt-1 font-medium text-neutral-900">{contract.end_date ? formatDate(contract.end_date) : "—"}</dd></div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-neutral-100 pt-3 text-xs text-neutral-600">
          <span>Supplier: <strong className="break-words font-medium">{contract.supplier_name}</strong></span>
          <span>RFQ: <strong className="break-all font-medium">{contract.rfq}</strong></span>
          <span>Award: <strong className="break-all font-medium">{contract.award}</strong></span>
          <span>Supplier Signature: <strong className="font-medium">{contract.signature_workflow.supplier_status}</strong></span>
          <span>Legal Manager Signature: <strong className="font-medium">{contract.signature_workflow.legal_status}</strong></span>
        </div>
        {supplier && contract.supplier_workflow && <SupplierContractLifecycle workflow={contract.supplier_workflow} />}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className={CLM_BUTTON} to={route}>View Contract</Link>
          <button type="button" className={CLM_BUTTON} disabled={loadingPdf || !contract.pdf_available} onClick={() => void viewPdf()}>{loadingPdf && <Loader2 className="h-4 w-4 animate-spin" />}{loadingPdf ? "Loading Contract PDF…" : "View Contract PDF"}</button>
          {supplier && (contract.signature_workflow.can_review || canSign || canAccept) && <Link className={CLM_BUTTON} to={route}>Review Contract</Link>}
          {canSign && <Link className={CLM_PRIMARY} to={route}>Sign Contract</Link>}
          {canAccept && <Link className={CLM_PRIMARY} to={route}>Accept Contract</Link>}
        </div>
        {!contract.pdf_available && <p className="mt-2 text-xs text-neutral-500">The approved Contract PDF is not available yet.</p>}
        {pdfError && <p role="alert" className="mt-2 text-sm text-rose-700">{pdfError}</p>}
        {preview && <ContractPdfPreviewModal contractId={contract.name} preview={preview} onClose={() => setPreview(null)} />}
      </> : <p className="mt-3 text-sm text-neutral-500">No Contract linked</p>}
  </section>;
}
