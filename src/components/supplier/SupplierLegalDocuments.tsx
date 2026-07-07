import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";

import type { SupplierQuotation } from "../../types/erpnext";
import type { LegalDocumentSet } from "../../api/legalDocs";
import { updateSupplierQuotationLegalDoc } from "../../api/sourcing";
import { getFullFileUrl, uploadFileToERPNext } from "../../api/legalDocsStorage";
import {
  resolveSupplierLegalDocs,
  resolveLegalReviewUiStatus,
  isSelectedAsWinner,
  type LegalReviewUiStatus,
} from "../../utils/supplierLegalDocs";
import { formatDate } from "../../utils/format";

const MAX_SIZE_MB = 15;

interface Props {
  sq: SupplierQuotation;
  review: LegalDocumentSet | null;
  /**
   * When true the supplier may upload / replace documents. Callers should pass
   * `false` once the quotation is locked (selected as winner) or read-only.
   */
  editable?: boolean;
  /** Refetch callback fired after a successful upload / note change. */
  onChanged?: () => void | Promise<void>;
}

const STATUS_STYLES: Record<
  LegalReviewUiStatus,
  { icon: typeof Clock; badge: string; text: string }
> = {
  "Pending Review": {
    icon: Clock,
    badge: "border-amber-200 bg-amber-50 text-amber-800",
    text: "Documents received. Legal review is pending.",
  },
  "Under Review": {
    icon: Eye,
    badge: "border-blue-200 bg-blue-50 text-blue-800",
    text: "Netlink's legal team is currently reviewing your documents.",
  },
  Approved: {
    icon: CheckCircle2,
    badge: "border-emerald-200 bg-emerald-50 text-emerald-800",
    text: "Your legal documents have been approved.",
  },
  Rejected: {
    icon: XCircle,
    badge: "border-red-200 bg-red-50 text-red-800",
    text: "One or more documents were rejected. Please review the comments.",
  },
};

export default function SupplierLegalDocuments({
  sq,
  review,
  editable = true,
  onChanged,
}: Props) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const docs = useMemo(
    () => resolveSupplierLegalDocs(sq, review),
    [sq, review]
  );

  const reviewStatus = resolveLegalReviewUiStatus(review);
  const winnerLocked = isSelectedAsWinner(review);
  // Replacement is only permitted until the supplier is selected as the
  // winning supplier (i.e. before a Legal Document Review record exists).
  const canEdit = editable && !winnerLocked;

  const anyUploaded = docs.some((d) => d.hasFile);
  const visibleDocs = docs.filter((d) => d.core || d.hasFile);

  async function handleUpload(
    sqUrlField: string,
    file: File,
    key: string
  ) {
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`File too large. Max size is ${MAX_SIZE_MB}MB`);
      return;
    }
    setBusyKey(key);
    try {
      const fileUrl = await uploadFileToERPNext(
        file,
        "Supplier Quotation",
        sq.name
      );
      await updateSupplierQuotationLegalDoc(sq.name, sqUrlField, fileUrl);
      toast.success(`${file.name} uploaded`);
      await onChanged?.();
    } catch (err) {
      toast.error(
        "Upload failed: " + (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleNoteBlur(
    noteField: string | undefined,
    value: string,
    original: string
  ) {
    if (!noteField || value.trim() === original.trim()) return;
    try {
      await updateSupplierQuotationLegalDoc(sq.name, noteField, value.trim());
      await onChanged?.();
    } catch {
      toast.error("Could not save note");
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
        <ShieldCheck className="h-4 w-4 text-neutral-500" />
        <h3 className="text-sm font-semibold text-neutral-900">
          Legal &amp; Compliance Documents
        </h3>
      </div>

      {/* Status banner */}
      <div className="border-b border-neutral-100 px-5 py-3">
        {reviewStatus ? (
          <StatusBanner status={reviewStatus} review={review} />
        ) : anyUploaded ? (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <p className="text-sm font-medium text-emerald-800">
              Legal documents uploaded successfully.
              <br />
              <span className="font-normal text-emerald-700">
                Waiting for Procurement to select the winning supplier.
              </span>
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-sm font-medium text-amber-800">
              No legal documents uploaded yet.
              {canEdit && " Upload your PDF documents below (max 15 MB each)."}
            </p>
          </div>
        )}
      </div>

      <div className="divide-y divide-neutral-100">
        {visibleDocs.map((doc) => {
          const busy = busyKey === doc.key;
          const previewUrl = doc.url ? getFullFileUrl(doc.url) : "";
          return (
            <div key={doc.key} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                    <span aria-hidden>{doc.icon}</span>
                    {doc.label}
                  </p>
                  {doc.hasFile ? (
                    <div className="mt-1 space-y-0.5">
                      <p className="truncate text-xs text-neutral-600">
                        📎 {doc.fileName}
                      </p>
                      {doc.uploadDate && (
                        <p className="text-[11px] text-neutral-400">
                          Uploaded {formatDate(doc.uploadDate)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-neutral-400">
                      Not uploaded yet
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {doc.hasFile && (
                    <>
                      <a
                        href={previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Preview
                      </a>
                      <a
                        href={previewUrl}
                        download={doc.fileName}
                        className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </a>
                    </>
                  )}

                  {canEdit && (
                    <label
                      className={`inline-flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-sm ${
                        doc.hasFile
                          ? "border border-accent-600 bg-white text-accent-700 hover:bg-accent-50"
                          : "bg-accent-600 text-white hover:bg-accent-700"
                      }`}
                    >
                      {busy ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Uploading…
                        </>
                      ) : doc.hasFile ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5" />
                          Replace
                        </>
                      ) : (
                        <>
                          <Upload className="h-3.5 w-3.5" />
                          Upload PDF
                        </>
                      )}
                      <input
                        type="file"
                        accept=".pdf"
                        hidden
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file)
                            void handleUpload(doc.sqUrlField, file, doc.key);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Note */}
              {doc.sqNoteField &&
                (canEdit || doc.note) &&
                (canEdit ? (
                  <textarea
                    defaultValue={doc.note}
                    placeholder={`Notes about ${doc.label.toLowerCase()}…`}
                    rows={2}
                    onBlur={(e) =>
                      void handleNoteBlur(
                        doc.sqNoteField,
                        e.target.value,
                        doc.note
                      )
                    }
                    className="mt-3 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
                  />
                ) : (
                  <p className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                    {doc.note}
                  </p>
                ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StatusBanner({
  status,
  review,
}: {
  status: LegalReviewUiStatus;
  review: LegalDocumentSet | null;
}) {
  const style = STATUS_STYLES[status];
  const Icon = style.icon;
  const rejectionReason =
    status === "Rejected"
      ? review?.rejection_reason || review?.legal_comments
      : "";

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${style.badge}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wide">
          Legal Review: {status}
        </span>
      </div>
      <p className="mt-1 text-sm">{style.text}</p>
      {rejectionReason && (
        <p className="mt-1.5 text-xs italic">Reason: {rejectionReason}</p>
      )}
    </div>
  );
}
