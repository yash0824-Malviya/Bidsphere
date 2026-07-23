/**
 * Enterprise read-only engineering attachments list.
 * Used across MR → RFQ → PO → GRN → Voucher → Invoice.
 * Never re-uploads files — displays URL references only.
 */

import { useMemo, useState } from "react";
import {
  Download,
  Eye,
  FileArchive,
  FileImage,
  FileText,
  Paperclip,
  X,
} from "lucide-react";

import {
  formatFileSize,
  isPreviewableAttachment,
  resolveMrItemFileHref,
  type EngineeringAttachment,
} from "../../utils/materialRequestItemFiles";

function FileGlyph({ name, type }: { name: string; type?: string }) {
  const lower = `${name} ${type ?? ""}`.toLowerCase();
  if (/\.(png|jpe?g)$/.test(lower) || lower.includes("image/")) {
    return <FileImage className="h-4 w-4 text-primary-600" />;
  }
  if (/\.zip$/.test(lower) || lower.includes("zip")) {
    return <FileArchive className="h-4 w-4 text-amber-600" />;
  }
  return <FileText className="h-4 w-4 text-primary-600" />;
}

export interface EngineeringAttachmentsViewProps {
  attachments: EngineeringAttachment[];
  /** Compact table-cell layout vs card list. */
  compact?: boolean;
  className?: string;
  emptyLabel?: string;
}

export default function EngineeringAttachmentsView({
  attachments,
  compact = false,
  className = "",
  emptyLabel = "No attachments available",
}: EngineeringAttachmentsViewProps) {
  const list = attachments ?? [];
  const [preview, setPreview] = useState<EngineeringAttachment | null>(null);

  const previewHref = useMemo(() => {
    if (!preview) return "";
    const imageUrl = resolveMrItemFileHref(preview.fileUrl);
    // Temporary diagnostics for broken <img> previews.
    // eslint-disable-next-line no-console
    console.log(preview);
    // eslint-disable-next-line no-console
    console.log(preview.fileUrl);
    // eslint-disable-next-line no-console
    console.log(imageUrl);
    return imageUrl;
  }, [preview]);

  if (list.length === 0) {
    return <span className="text-neutral-400">{emptyLabel}</span>;
  }

  return (
    <div className={`min-w-[12rem] ${className}`.trim()}>
      <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-700 ring-1 ring-inset ring-primary-100">
        <Paperclip className="h-3 w-3" />
        {list.length} Attachment{list.length === 1 ? "" : "s"}
      </span>

      <ul className={`space-y-1.5 ${compact ? "max-h-40 overflow-y-auto" : ""}`}>
        {list.map((att) => {
          const href = resolveMrItemFileHref(att.fileUrl);
          const canPreview = isPreviewableAttachment(att.fileName, att.fileType);
          return (
            <li
              key={att.id}
              className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 shadow-sm"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">
                  <FileGlyph name={att.fileName} type={att.fileType} />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[11px] font-semibold text-neutral-900"
                    title={att.fileName}
                  >
                    {att.fileName}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-neutral-500">
                    <span className="uppercase">{att.fileType || "file"}</span>
                    {" · "}
                    {att.fileSize > 0 ? formatFileSize(att.fileSize) : "—"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {canPreview ? (
                      <button
                        type="button"
                        onClick={() => setPreview(att)}
                        className="inline-flex items-center gap-0.5 rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700 hover:bg-neutral-50"
                      >
                        <Eye className="h-3 w-3" /> View
                      </button>
                    ) : (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700 hover:bg-neutral-50"
                      >
                        <Eye className="h-3 w-3" /> View
                      </a>
                    )}
                    <a
                      href={href}
                      download={att.fileName}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700 hover:bg-neutral-50"
                    >
                      <Download className="h-3 w-3" /> Download
                    </a>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Close preview"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setPreview(null)}
          />
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
              <p className="min-w-0 truncate text-sm font-semibold text-neutral-800">
                {preview.fileName}
              </p>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-auto p-4">
              {/\.(png|jpe?g)$/i.test(preview.fileName) ? (
                <img
                  src={previewHref}
                  alt={preview.fileName}
                  className="mx-auto max-h-[70vh] max-w-full object-contain"
                />
              ) : (
                <iframe
                  title={preview.fileName}
                  src={previewHref}
                  className="h-[70vh] w-full rounded-lg border border-neutral-200 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
