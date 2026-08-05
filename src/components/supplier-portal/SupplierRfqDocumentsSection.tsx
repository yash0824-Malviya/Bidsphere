/**
 * Supplier RFQ Details — RFQ Documents section (supplier-visible only).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Eye,
  FileArchive,
  FileImage,
  FileText,
  FileWarning,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import {
  fetchSupplierRfqDocumentBlob,
  getSupplierRfqDocuments,
  isSupplierRfqDownloadOnly,
  isSupplierRfqPreviewable,
  supplierRfqDocumentHref,
  supplierRfqPreviewActionLabel,
  type SupplierRfqDocument,
} from "../../api/supplierRfqDocuments";
import { formatFileSize } from "../../utils/materialRequestItemFiles";
import { Skeleton } from "../Skeleton";

const ENT_CARD =
  "rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06),0_4px_12px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(15,23,42,0.08)]";

function FileGlyph({ name, type }: { name: string; type?: string }) {
  const lower = `${name} ${type ?? ""}`.toLowerCase();
  if (/\.(png|jpe?g|gif|webp)$/.test(lower) || lower.includes("image/")) {
    return <FileImage className="h-5 w-5 text-primary-600" />;
  }
  if (/\.zip$/.test(lower) || lower.includes("zip")) {
    return <FileArchive className="h-5 w-5 text-amber-600" />;
  }
  return <FileText className="h-5 w-5 text-primary-600" />;
}

function formatUploadedAt(iso?: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function formatFileType(doc: SupplierRfqDocument): string {
  const ext = String(doc.fileType || "")
    .trim()
    .replace(/^\./, "")
    .toUpperCase();
  if (ext && ext !== "FILE") return ext;
  const fromName = doc.fileName.split(".").pop()?.toUpperCase();
  return fromName && fromName !== doc.fileName.toUpperCase() ? fromName : "FILE";
}

export function previewKindOf(doc: SupplierRfqDocument): "pdf" | "image" | "unsupported" {
  const name = doc.fileName.toLowerCase();
  const type = (doc.fileType || "").toLowerCase();
  if (/\.pdf$/i.test(name) || type.includes("pdf")) return "pdf";
  if (/\.(png|jpe?g)$/i.test(name) || type.includes("png") || type.includes("jpeg") || type.includes("jpg")) {
    return "image";
  }
  if (isSupplierRfqPreviewable(doc.fileName, doc.fileType)) {
    return /\.pdf$/i.test(name) ? "pdf" : "image";
  }
  return "unsupported";
}

const UNSUPPORTED_PREVIEW_MESSAGE =
  "Preview is not available for this file type. Please download the file to view it.";

export function DocumentPreviewModal({
  doc,
  rfqName,
  erpSupplierId,
  onClose,
}: {
  doc: SupplierRfqDocument;
  rfqName: string;
  erpSupplierId: string;
  onClose: () => void;
}) {
  const kind = previewKindOf(doc);
  const [loading, setLoading] = useState(kind !== "unsupported");
  const [error, setError] = useState<string | null>(
    kind === "unsupported" ? UNSUPPORTED_PREVIEW_MESSAGE : null,
  );
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const downloadHref = useMemo(
    () => supplierRfqDocumentHref(doc.fileUrl, rfqName, erpSupplierId),
    [doc.fileUrl, erpSupplierId, rfqName],
  );

  useEffect(() => {
    if (kind === "unsupported") {
      setLoading(false);
      setError(UNSUPPORTED_PREVIEW_MESSAGE);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
      setObjectUrl(null);
    }

    void (async () => {
      try {
        const blob = await fetchSupplierRfqDocumentBlob({
          fileUrl: doc.fileUrl,
          rfqName,
          erpSupplierId,
          fileName: doc.fileName,
        });
        if (cancelled) return;

        const mime = (blob.type || "").toLowerCase();
        if (
          kind === "pdf" &&
          mime &&
          !mime.includes("pdf") &&
          mime !== "application/octet-stream"
        ) {
          throw new Error("Unable to load PDF preview for this document.");
        }
        if (
          kind === "image" &&
          mime &&
          !mime.startsWith("image/") &&
          mime !== "application/octet-stream"
        ) {
          throw new Error("Unable to load image preview for this document.");
        }

        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setObjectUrl(url);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load this document for preview.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [doc.fileUrl, doc.fileName, doc.fileType, erpSupplierId, kind, rfqName]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        className="absolute inset-0 bg-neutral-900/50"
        aria-label="Close preview"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-2.5">
          <p className="min-w-0 truncate text-sm font-semibold text-neutral-900">
            {doc.fileName}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <a
              href={downloadHref}
              download={doc.fileName}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11px] font-semibold text-primary-800 no-underline hover:bg-primary-100"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-neutral-500 hover:bg-neutral-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="relative min-h-[240px] flex-1 overflow-auto bg-neutral-100 p-2">
          {loading ? (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-neutral-600">
              <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
              <p className="text-sm font-medium">Loading preview…</p>
            </div>
          ) : error ? (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
              <FileWarning className="h-10 w-10 text-amber-500" />
              <p className="max-w-md text-sm font-medium text-neutral-800">
                {error}
              </p>
              <a
                href={downloadHref}
                download={doc.fileName}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-800 no-underline hover:bg-primary-100"
              >
                <Download className="h-3.5 w-3.5" />
                Download file
              </a>
            </div>
          ) : objectUrl && kind === "pdf" ? (
            <iframe
              title={doc.fileName}
              src={objectUrl}
              className="h-[70vh] w-full rounded border border-neutral-200 bg-white"
            />
          ) : objectUrl && kind === "image" ? (
            <img
              src={objectUrl}
              alt={doc.fileName}
              className="mx-auto max-h-[70vh] max-w-full object-contain"
            />
          ) : (
            <div className="flex h-[60vh] items-center justify-center px-6 text-center text-sm text-neutral-600">
              {UNSUPPORTED_PREVIEW_MESSAGE}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SupplierRfqDocumentsSection({
  rfqName,
  erpSupplierId,
}: {
  rfqName: string;
  erpSupplierId: string;
}) {
  const [preview, setPreview] = useState<SupplierRfqDocument | null>(null);

  const query = useQuery({
    queryKey: ["supplier-rfq-documents", rfqName, erpSupplierId],
    queryFn: () =>
      getSupplierRfqDocuments({ rfqName, erpSupplierId }),
    enabled: !!rfqName && !!erpSupplierId,
    staleTime: 30_000,
    retry: 1,
  });

  const documents = query.data ?? [];

  return (
    <section
      id="section-rfq-documents"
      className={`scroll-mt-24 ${ENT_CARD}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#E2E8F0] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#EEF3FA] text-[#1F3A6D]">
            <Paperclip className="h-3.5 w-3.5" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold leading-tight text-[#0F172A]">
              RFQ Documents
            </h2>
            <p className="text-[12px] font-medium text-[#64748B]">
              Buyer-shared RFQ and line-item documents
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {query.isFetching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#94A3B8]" />
          )}
          {!query.isLoading && documents.length > 0 ? (
            <span className="rounded-full bg-[#EEF3FA] px-2.5 py-0.5 text-[11px] font-semibold text-[#1F3A6D] ring-1 ring-inset ring-[#D6E2F5]">
              {documents.length} file{documents.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="p-4">
        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : query.isError ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            {(query.error as Error)?.message ||
              "Unable to load RFQ documents. You can still continue with your quotation."}
          </p>
        ) : documents.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-4 py-3">
            <FileText className="h-5 w-5 shrink-0 text-[#94A3B8]" />
            <p className="text-[13px] font-medium text-[#64748B]">
              No RFQ documents shared by the buyer.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {documents.map((doc) => {
              const href = supplierRfqDocumentHref(
                doc.fileUrl,
                rfqName,
                erpSupplierId,
              );
              const downloadOnly = isSupplierRfqDownloadOnly(doc.fileName, doc.fileType);
              const canPreview =
                !downloadOnly &&
                (doc.previewable ||
                  isSupplierRfqPreviewable(doc.fileName, doc.fileType));
              return (
                <li
                  key={doc.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]/60 px-3 py-2.5 transition-colors hover:border-[#D6E2F5] hover:bg-white"
                >
                  <span className="shrink-0">
                    <FileGlyph name={doc.fileName} type={doc.fileType} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-[15px] font-medium text-[#0F172A]"
                      title={doc.fileName}
                    >
                      {doc.fileName}
                    </p>
                    <p className="mt-0.5 text-[13px] text-[#64748B]">
                      {doc.fileSize > 0 ? formatFileSize(doc.fileSize) : "—"}
                      {" · "}
                      {formatUploadedAt(doc.uploadedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {canPreview ? (
                      <button
                        type="button"
                        onClick={() => setPreview(doc)}
                        className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#E2E8F0] bg-white px-3 text-[13px] font-semibold text-[#334155] transition hover:border-[#1F3A6D]/30 hover:bg-[#EEF3FA] hover:text-[#1F3A6D]"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {supplierRfqPreviewActionLabel(doc.fileName, doc.fileType)}
                      </button>
                    ) : null}
                    <a
                      href={href}
                      download={doc.fileName}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#1F3A6D]/20 bg-[#EEF3FA] px-3 text-[13px] font-semibold text-[#1F3A6D] no-underline transition hover:bg-[#D6E2F5]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {preview ? (
        <DocumentPreviewModal
          doc={preview}
          rfqName={rfqName}
          erpSupplierId={erpSupplierId}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </section>
  );
}
