import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { FileText } from "lucide-react";
import { clmError, getClmDocumentBlob, type ClmRecord } from "../../api/clm";
import type { RfqClmSourceDocument } from "../../types/clm";
import { getFullFileUrl } from "../../api/legalDocsStorage";
import { canAccessPath } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import { CLM_BUTTON } from "./ClmFields";
import ContractPdfPreviewModal, { type ContractPreviewDocument } from "./ContractPdfPreviewModal";

export function RfqSourceDocuments({
  rfq,
  documents,
  recordName,
  doctype = "Contract Request",
  emptyMessage,
}: {
  rfq: string;
  documents: RfqClmSourceDocument[];
  canOpenSource?: boolean;
  recordName?: string;
  doctype?: string;
  emptyMessage?: string;
}) {
  const [preview, setPreview] = useState<ContractPreviewDocument | null>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  if (!documents.length) {
    if (!emptyMessage) return null;
    return <p className="text-xs text-slate-500">{emptyMessage}</p>;
  }

  async function handleAction(doc: RfqClmSourceDocument, mode: "preview" | "download") {
    if (doc.status === "Unavailable" || (!doc.file_url && !doc.file_id)) {
      toast.error("File unavailable for this document record.");
      return;
    }
    const key = `${doc.file_id || doc.file_name}-${mode}`;
    setBusy(key);
    try {
      let blob: Blob | undefined;
      let url = "";

      if (recordName && doc.file_id) {
        try {
          blob = await getClmDocumentBlob(doctype, recordName, "", doc.file_id);
          url = URL.createObjectURL(blob);
        } catch {
          // Fall back to direct file fetch if getClmDocumentBlob fails
        }
      }

      if (!url && doc.file_url) {
        const fullUrl = doc.file_url.includes("/api/file-proxy") || /^https?:\/\//i.test(doc.file_url)
          ? doc.file_url
          : getFullFileUrl(doc.file_url, doc.file_id);
        const token = localStorage.getItem("bidsphere_access_token") || localStorage.getItem("access_token");
        const res = await fetch(fullUrl, {
          credentials: "omit",
          cache: "no-store",
          headers: { ...(token ? { "X-Bidsphere-Access-Token": token } : {}), "ngrok-skip-browser-warning": "1" },
        });
        if (!res.ok) throw new Error("Document is unavailable or could not be loaded.");
        blob = await res.blob();
        url = URL.createObjectURL(blob);
      }

      if (!url || !blob) throw new Error("Document file is unavailable.");

      if (mode === "download") {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = doc.file_name || "document";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        const isPdf = blob.type.includes("pdf") || (doc.file_name || "").toLowerCase().endsWith(".pdf");
        const bytes = isPdf ? new Uint8Array(await blob.arrayBuffer()) : undefined;
        setPreview({
          url,
          type: blob.type || (isPdf ? "application/pdf" : "application/octet-stream"),
          name: doc.file_name,
          bytes,
        });
      }
    } catch (error) {
      toast.error(clmError(error));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="min-w-0" aria-label="Source supporting documents">
      <div className="space-y-2">
        {documents.map((document, index) => {
          const isUnavailable = document.status === "Unavailable" || (!document.file_url && !document.file_id);
          const docKey = document.file_id || `${document.source_doctype}-${document.source_name}-${document.file_name}-${index}`;
          const docType = document.document_type || document.source_doctype;
          const previewKey = `${document.file_id || document.file_name}-preview`;
          const downloadKey = `${document.file_id || document.file_name}-download`;

          return (
            <div
              key={docKey}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <FileText className="h-4 w-4 text-slate-500 shrink-0" />
                  {isUnavailable ? (
                    <span className="font-medium text-slate-500 text-sm break-words">{document.file_name}</span>
                  ) : (
                    <button
                      type="button"
                      className="font-medium text-blue-700 hover:text-blue-900 hover:underline text-sm text-left break-words"
                      disabled={Boolean(busy)}
                      onClick={() => void handleAction(document, "preview")}
                    >
                      {document.file_name}
                    </button>
                  )}
                  <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                    {docType}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      isUnavailable
                        ? "bg-amber-50 text-amber-800 ring-amber-600/20"
                        : "bg-emerald-50 text-emerald-800 ring-emerald-600/20"
                    }`}
                  >
                    {isUnavailable ? "File unavailable" : "Available"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                  <span>
                    Source: <strong className="font-semibold text-slate-700">{document.source_doctype}</strong> &bull; {document.source_name}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  className={CLM_BUTTON}
                  disabled={isUnavailable || Boolean(busy)}
                  onClick={() => void handleAction(document, "preview")}
                >
                  {busy === previewKey ? "Loading…" : "Preview"}
                </button>
                <button
                  type="button"
                  className={CLM_BUTTON}
                  disabled={isUnavailable || Boolean(busy)}
                  onClick={() => void handleAction(document, "download")}
                >
                  {busy === downloadKey ? "Downloading…" : "Download"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {preview && (
        <ContractPdfPreviewModal
          contractId={recordName || rfq || "Supporting Document"}
          preview={preview}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
}

export default function ClmSourceTraceability({ record, contractDocuments = false }: { record: ClmRecord; contractDocuments?: boolean }) {
  const role = useAuthStore(state => state.user?.role || "");
  if (typeof record.custom_rfq !== "string" || !record.custom_rfq.trim()) return null;
  let source: unknown;
  try { source = typeof record.custom_clm_data === "string" ? JSON.parse(record.custom_clm_data) : record.custom_clm_data; }
  catch { source = undefined; }
  const rows = source && typeof source === "object" && "source_documents" in source ? source.source_documents : [];
  const documents = (Array.isArray(rows) ? rows : [])
    .filter((row): row is RfqClmSourceDocument => !!row && typeof row === "object" && ["file_id", "file_name", "source_doctype", "source_name"].every(key => typeof row[key] === "string"))
    .filter(doc => !(doc.source_doctype === "Supplier Quotation" && (/\bpo[_-]/i.test(doc.file_name) || /\bpur[_-]ord\b/i.test(doc.file_name) || /\bpurchase[_-]?order\b/i.test(doc.file_name))));
  const evidence = source && typeof source === "object" && "rfq_source" in source && source.rfq_source && typeof source.rfq_source === "object" ? source.rfq_source as Record<string, unknown> : {};
  const available = evidence.available_award && typeof evidence.available_award === "object" && !Array.isArray(evidence.available_award) ? evidence.available_award as Record<string, unknown> : {};
  const currency = evidence.currency || available.currency, amount = evidence.amount ?? available.amount;
  const sourcePath = `/sourcing/rfq/${encodeURIComponent(record.custom_rfq)}`;
  const canOpenSource = canAccessPath(role, sourcePath);
  return (
    <section aria-label="Source traceability" className="mt-6 min-w-0 space-y-4 border-t border-slate-200 pt-4">
      <h2 className="font-semibold text-slate-900">Source traceability</h2>
      <p className="break-words text-sm">
        <span className="text-slate-500">RFQ: </span>
        {canOpenSource ? <Link className="font-semibold text-blue-700 hover:underline" to={sourcePath}>{record.custom_rfq}</Link> : <span>{record.custom_rfq}</span>}
      </p>
      <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
        {[
          ["Business Case", evidence.business_case],
          ["ECR", evidence.ecr],
          ["Award", evidence.award || evidence.legal_review || available.award || evidence.quotation],
          ["Winning Quotation", evidence.quotation || available.quotation],
          ["Selected Supplier", evidence.supplier || available.supplier],
          ["Company", evidence.company || available.company],
          ["Department", evidence.department || available.department],
          ["Award Value", currency && amount != null ? `${currency} ${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 6 })}` : ""],
        ].filter(([, value]) => typeof value === "string" && value).map(([label, value]) => (
          <div key={String(label)} className="min-w-0">
            <dt className="text-slate-500">{String(label)}</dt>
            <dd className="break-words">{String(value)}</dd>
          </div>
        ))}
      </dl>
      <RfqSourceDocuments
        rfq={record.custom_rfq}
        documents={documents}
        canOpenSource={canOpenSource}
        recordName={record.name}
        doctype={record.name?.startsWith("CTRQ") ? "Contract Request" : "Contract"}
      />
      {documents.length > 0 && (
        <p className="text-xs text-slate-500">
          {contractDocuments
            ? "Verified supporting documents are available in this contract's Documents tab."
            : canOpenSource
            ? "Open the source RFQ to view these documents with their existing access permissions."
            : "Source documents retain the RFQ's existing access permissions."}
        </p>
      )}
    </section>
  );
}
