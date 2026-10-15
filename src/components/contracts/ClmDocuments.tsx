import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { clmError, getClmDocumentBlob, type ClmField, type ClmRecord, type ClmSupportingDocument } from "../../api/clm";
import { CLM_BUTTON, fieldLabel } from "./ClmFields";
import ContractPdfPreviewModal, { type ContractPreviewDocument } from "./ContractPdfPreviewModal";
import type { ClmSignature, RfqClmSourceDocument } from "../../types/clm";

const signerName = (signature: ClmSignature) => signature.full_legal_name?.trim() || signature.typed_name || signature.by;

interface HistoricalContractDocument extends ClmSupportingDocument { signature?: ClmSignature; original: boolean }
/** Internal detail retains immutable review history; supplier projections omit it. */
export function historicalContractDocuments(record: ClmRecord): HistoricalContractDocument[] {
  try {
    const data = typeof record.custom_clm_data === "string" ? JSON.parse(record.custom_clm_data) : record.custom_clm_data;
    if (!data || !Array.isArray(data.review_history)) return [];
    const signatures = Array.isArray(data.signatures) ? data.signatures : [];
    const ids = new Set([data.locked_file?.file_id, ...signatures.map((row: ClmSignature) => row.file_id)].filter(Boolean));
    const documents: HistoricalContractDocument[] = [];
    for (const history of data.review_history) {
      if (!history || typeof history !== "object") continue;
      const revision = Array.isArray(data.versions) ? data.versions.find((row: { id?: string }) => row?.id === history.version) : undefined;
      const receipts = Array.isArray(history.signatures) ? history.signatures : [];
      const version = revision?.number || history.locked_file?.version || receipts[0]?.version || history.version;
      if (typeof version !== "string" || !version.trim()) continue;
      for (const [row, original] of [[history.locked_file, true], ...receipts.map((signature: ClmSignature) => [signature, false])] as Array<[ClmSignature | undefined, boolean]>) {
        if (!row || typeof row.file_id !== "string" || typeof row.file_url !== "string" || !row.file_id || !row.file_url || ids.has(row.file_id)) continue;
        ids.add(row.file_id);
        documents.push({ file_id: row.file_id, file_url: row.file_url, file_name: `${record.name}-v${version}-${original ? "original" : `${row.party}-signed`}.pdf`, version, original,
          by: original ? revision?.author || "" : signerName(row), at: original ? revision?.at || "" : row.at,
          ...(!original ? { signature: row } : {}),
        });
      }
    }
    return documents;
  } catch { return []; }
}

export function contractSourceDocuments(record: ClmRecord): RfqClmSourceDocument[] {
  if (!record.custom_rfq) return [];
  try {
    const data = typeof record.custom_clm_data === "string" ? JSON.parse(record.custom_clm_data) : record.custom_clm_data;
    return (Array.isArray(data?.source_documents) ? data.source_documents : []).filter((row: unknown): row is RfqClmSourceDocument => !!row && typeof row === "object" && ["file_id", "file_name", "source_doctype", "source_name"].every(key => typeof (row as Record<string, unknown>)[key] === "string"));
  } catch { return []; }
}

export default function ClmDocuments({ doctype, record, fields, supportingDocuments = [], signatures = [], signedOnly = false }: { doctype: string; record: ClmRecord; fields: ClmField[]; supportingDocuments?: ClmSupportingDocument[]; signatures?: ClmSignature[]; signedOnly?: boolean }) {
  const [preview, setPreview] = useState<ContractPreviewDocument | null>(null); const [busy, setBusy] = useState("");
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  type Attachment = ClmField & { supporting?: ClmSupportingDocument; source?: RfqClmSourceDocument; signature?: ClmSignature; historical?: boolean };
  const currentVersion = String(record.custom_current_version || "1.0");
  const allAttachments: Attachment[] = [
    ...(doctype === "Contract" && (Number(record.custom_final_version_locked) === 1 || signatures.some(signature => signature.version === currentVersion))
      ? [{ fieldname: "current_pdf", label: "Current Contract PDF", fieldtype: "Attach" }] : []),
    ...(doctype === "Contract" && Number(record.custom_final_version_locked) === 1 ? [{ fieldname: "locked_file", label: "Original Contract", fieldtype: "Attach" }] : []),
    ...fields.filter(field => ["Attach", "Attach Image"].includes(field.fieldtype) && record[field.fieldname]),
    ...signatures.map(signature => ({ fieldname: `signature-${signature.file_id}`, label: `Signed Contract — ${signature.party === "supplier" ? "Supplier" : signature.role === "legal" || record.custom_rfq ? "Legal Manager" : "Company"}`, fieldtype: "Attach", signature, supporting: { file_id: signature.file_id, file_url: signature.file_url, file_name: `${record.name}-${signature.party}-signed.pdf`, by: signerName(signature), at: signature.at, version: signature.version } })),
    ...(doctype === "Contract" ? historicalContractDocuments(record).map(supporting => ({ fieldname: `historical-${supporting.file_id}`, label: `Historical ${supporting.original ? "Original" : "Signed"} Contract — Version ${supporting.version}`, fieldtype: "Attach", historical: true, supporting, signature: supporting.signature })) : []),
    ...supportingDocuments.map(supporting => ({ fieldname: `supplier-${supporting.file_id}`, label: "Supplier negotiation supporting document", fieldtype: "Attach", supporting })),
    ...(doctype === "Contract" ? contractSourceDocuments(record).map(source => ({ fieldname: `source-${source.file_id}`, label: "RFQ award supporting document", fieldtype: "Attach", source })) : []),
  ];
  const attachments = signedOnly ? allAttachments.filter(field => field.signature && !field.historical) : allAttachments;
  async function load(field: Attachment, download: boolean) {
    setBusy(field.fieldname); try {
      const blob = await getClmDocumentBlob(doctype, record.name, field.fieldname, field.supporting?.file_id || field.source?.file_id, field.fieldname === "current_pdf" ? currentVersion : undefined); const url = URL.createObjectURL(blob); const name = field.supporting?.file_name || field.source?.file_name || (field.fieldname === "current_pdf" ? `${record.name}-v${currentVersion}.pdf` : field.fieldname === "locked_file" ? `${record.name}-v${currentVersion}-original.pdf` : String(record[field.fieldname]).split("/").pop() || "contract-document");
      if (download) { const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
      else setPreview({ url, type: blob.type, name, ...(blob.type.includes("pdf") ? { bytes: new Uint8Array(await blob.arrayBuffer()) } : {}) });
    } catch (error) { toast.error(clmError(error)); } finally { setBusy(""); }
  }
  return <section className="space-y-3"><h2 className="font-semibold text-slate-900">{signedOnly ? attachments.length ? "Signed Document: Available" : "Signed Document" : "Documents"}</h2>{!attachments.length && <p className="text-sm text-slate-500">No documents are attached.</p>}{attachments.map(field => <div key={field.fieldname} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"><div className="min-w-0"><p className="text-sm font-semibold">{fieldLabel(field)}</p><p className="break-all text-xs text-slate-500">{field.supporting?.file_name || field.source?.file_name || (field.fieldname === "current_pdf" ? `Authoritative version ${currentVersion}${signatures.some(signature => signature.version === currentVersion) ? " · includes persisted signatures" : " · approved for signing"}` : field.fieldname === "locked_file" ? "Approved contract version prepared for signing" : String(record[field.fieldname]).split("/").pop())}</p>{field.fieldname === "locked_file" && <p className="mt-2 text-xs text-slate-600">Status: <span className="font-semibold">Original</span></p>}{field.signature && <dl className="mt-2 space-y-1 text-xs text-slate-600"><div><dt className="inline">Status: </dt><dd className="inline font-semibold">Signed</dd></div><div><dt className="inline">Signed By: </dt><dd className="inline break-words">{field.signature.party === "supplier" ? "Supplier" : field.signature.role === "legal" || record.custom_rfq ? "Legal Manager" : "Company"} · {signerName(field.signature)}{field.signature.by && (field.signature.full_legal_name?.trim() || field.signature.typed_name) ? ` (${field.signature.by})` : ""}</dd></div><div><dt className="inline">Signed At: </dt><dd className="inline">{field.signature.at}</dd></div><div><dt className="inline">Version: </dt><dd className="inline">{field.signature.version}</dd></div></dl>}{field.supporting && !field.signature && <p className="mt-1 text-xs text-slate-500">{field.supporting.by || field.supporting.uploaded_by}{field.supporting.at || field.supporting.uploaded_at ? ` · ${field.supporting.at || field.supporting.uploaded_at}` : ""}{field.supporting.version ? ` · Version ${field.supporting.version}` : ""}</p>}</div><div className="flex gap-2"><button className={CLM_BUTTON} disabled={Boolean(busy)} onClick={() => void load(field, false)}>{busy === field.fieldname ? "Loading…" : signedOnly ? "View Signed Contract" : field.fieldname === "current_pdf" ? "View Contract PDF" : field.signature ? "View" : "Preview"}</button><button className={CLM_BUTTON} disabled={Boolean(busy)} onClick={() => void load(field, true)}>Download</button></div></div>)}
    {preview && <ContractPdfPreviewModal contractId={record.name} preview={preview} onClose={() => setPreview(null)} />}
  </section>;
}
