/**
 * Supplier RFQ line item — attachments scoped to a single RFQ item row.
 */

import { useState } from "react";
import {
  CheckCircle2,
  Download,
  Eye,
  FileArchive,
  FileImage,
  FileText,
  Loader2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import {
  getSupplierRfqDocuments,
  isSupplierRfqDownloadOnly,
  isSupplierRfqPreviewable,
  supplierRfqDocumentHref,
  supplierRfqPreviewActionLabel,
  type SupplierRfqDocument,
} from "../../api/supplierRfqDocuments";
import { formatFileSize } from "../../utils/materialRequestItemFiles";
import { DocumentPreviewModal } from "./SupplierRfqDocumentsSection";
import { Skeleton } from "../Skeleton";

function FileGlyph({ name, type }: { name: string; type?: string }) {
  const lower = `${name} ${type ?? ""}`.toLowerCase();
  if (/\.(png|jpe?g|gif|webp)$/.test(lower) || lower.includes("image/")) {
    return <FileImage className="h-5 w-5 text-[#1F3A6D]" />;
  }
  if (/\.zip$/.test(lower) || lower.includes("zip")) {
    return <FileArchive className="h-5 w-5 text-amber-600" />;
  }
  return <FileText className="h-5 w-5 text-[#1F3A6D]" />;
}

function formatUploadedAt(iso?: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

function AttachmentCard({
  doc,
  rfqName,
  erpSupplierId,
  onPreview,
}: {
  doc: SupplierRfqDocument;
  rfqName: string;
  erpSupplierId: string;
  onPreview: (doc: SupplierRfqDocument) => void;
}) {
  const href = supplierRfqDocumentHref(doc.fileUrl, rfqName, erpSupplierId);
  const downloadOnly = isSupplierRfqDownloadOnly(doc.fileName, doc.fileType);
  const canPreview =
    !downloadOnly &&
    (doc.previewable || isSupplierRfqPreviewable(doc.fileName, doc.fileType));
  const previewLabel = supplierRfqPreviewActionLabel(doc.fileName, doc.fileType);

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]/70 px-3 py-2.5 transition-colors hover:border-[#D6E2F5] hover:bg-white">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EEF3FA]">
        <FileGlyph name={doc.fileName} type={doc.fileType} />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[15px] font-medium text-[#0F172A]"
          title={doc.fileName}
        >
          {doc.fileName}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-[#64748B]">
          <span>{doc.fileSize > 0 ? formatFileSize(doc.fileSize) : "—"}</span>
          <span className="text-[#CBD5E1]">·</span>
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <CheckCircle2 className="h-3 w-3" />
            Shared by buyer
          </span>
          {doc.uploadedAt ? (
            <>
              <span className="text-[#CBD5E1]">·</span>
              <span>{formatUploadedAt(doc.uploadedAt)}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        {canPreview ? (
          <button
            type="button"
            onClick={() => onPreview(doc)}
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#E2E8F0] bg-white px-3 text-[13px] font-semibold text-[#334155] transition hover:border-[#1F3A6D]/30 hover:bg-[#EEF3FA] hover:text-[#1F3A6D]"
          >
            <Eye className="h-3.5 w-3.5" />
            {previewLabel}
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
}

export default function SupplierItemAttachmentsPanel({
  rfqName,
  itemCode,
  erpSupplierId,
  compact = false,
}: {
  rfqName: string;
  itemCode: string;
  erpSupplierId: string;
  compact?: boolean;
}) {
  const [preview, setPreview] = useState<SupplierRfqDocument | null>(null);

  const query = useQuery({
    queryKey: ["supplier-rfq-item-documents", rfqName, itemCode, erpSupplierId],
    queryFn: () =>
      getSupplierRfqDocuments({ rfqName, erpSupplierId, itemCode }),
    enabled: !!rfqName && !!itemCode && !!erpSupplierId,
    staleTime: 30_000,
    retry: 1,
  });

  const documents = query.data ?? [];

  if (compact) {
    if (query.isLoading) {
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-[#94A3B8]" />;
    }
    if (query.isError || documents.length === 0) {
      return <span className="text-[13px] text-[#64748B]">—</span>;
    }
    return (
      <>
        <ul className="space-y-1">
          {documents.map((doc) => (
            <li key={doc.id} className="text-[13px] text-[#334155]">
              {doc.fileName}
            </li>
          ))}
        </ul>
        {preview ? (
          <DocumentPreviewModal
            doc={preview}
            rfqName={rfqName}
            erpSupplierId={erpSupplierId}
            onClose={() => setPreview(null)}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className="mt-3 border-t border-[#E2E8F0] pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-[#64748B]">
          Attachments ({query.isLoading ? "…" : documents.length})
        </p>
        {query.isFetching && !query.isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#94A3B8]" />
        ) : null}
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      ) : query.isError ? (
        <p className="text-[13px] text-amber-700">
          Unable to load attachments for this item.
        </p>
      ) : documents.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2.5 text-[13px] text-[#64748B]">
          No attachments available for this item.
        </p>
      ) : (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <AttachmentCard
              key={doc.id}
              doc={doc}
              rfqName={rfqName}
              erpSupplierId={erpSupplierId}
              onPreview={setPreview}
            />
          ))}
        </ul>
      )}

      {preview ? (
        <DocumentPreviewModal
          doc={preview}
          rfqName={rfqName}
          erpSupplierId={erpSupplierId}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
