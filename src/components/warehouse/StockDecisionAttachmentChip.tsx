/**
 * Compact attachment trigger for the Stock Decision Grid.
 * Shows "📎 N Attachment(s)" and opens a preview/download modal.
 */

import { useMemo, useState } from "react";
import { Download, Eye, Paperclip, X } from "lucide-react";

import {
  formatFileSize,
  isPreviewableAttachment,
  resolveEngineeringAttachments,
  resolveMrItemFileHref,
  type EngineeringAttachment,
} from "../../utils/materialRequestItemFiles";

interface Props {
  attachments?: EngineeringAttachment[] | null;
  url?: string | null;
}

export default function StockDecisionAttachmentChip({
  attachments,
  url,
}: Props) {
  const list = useMemo(() => {
    if (attachments && attachments.length > 0) return attachments;
    return resolveEngineeringAttachments({
      custom_2d_drawing: url,
      drawing_2d_url: url,
    });
  }, [attachments, url]);

  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<EngineeringAttachment | null>(null);

  if (list.length === 0) {
    return <span className="text-[12px] text-slate-400">—</span>;
  }

  const previewHref = preview ? resolveMrItemFileHref(preview.fileUrl) : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[12px] font-medium text-slate-700 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
      >
        <Paperclip className="h-3 w-3 shrink-0" />
        {list.length} Attachment{list.length === 1 ? "" : "s"}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm"
            onClick={() => {
              setOpen(false);
              setPreview(null);
            }}
          />
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Attachments</p>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setPreview(null);
                }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <ul className="max-h-[40vh] space-y-2 overflow-y-auto p-4">
              {list.map((att) => {
                const href = resolveMrItemFileHref(att.fileUrl);
                const canPreview = isPreviewableAttachment(
                  att.fileName,
                  att.fileType,
                );
                return (
                  <li
                    key={att.id}
                    className="rounded-lg border border-slate-200 px-3 py-2.5"
                  >
                    <p
                      className="truncate text-[13px] font-semibold text-slate-800"
                      title={att.fileName}
                    >
                      {att.fileName}
                    </p>
                    <p className="mt-0.5 text-[12px] text-slate-500">
                      {att.fileSize > 0 ? formatFileSize(att.fileSize) : "—"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {canPreview ? (
                        <button
                          type="button"
                          onClick={() => setPreview(att)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Preview
                        </button>
                      ) : (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[12px] font-medium text-slate-700 no-underline hover:bg-slate-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Preview
                        </a>
                      )}
                      <a
                        href={href}
                        download={att.fileName}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[12px] font-medium text-slate-700 no-underline hover:bg-slate-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>

            {preview && (
              <div className="border-t border-slate-100 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-slate-800">
                      {preview.fileName}
                    </p>
                    <p className="text-[12px] text-slate-500">
                      {preview.fileSize > 0
                        ? formatFileSize(preview.fileSize)
                        : "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreview(null)}
                    className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-slate-500 hover:bg-slate-50"
                  >
                    Close preview
                  </button>
                </div>
                {/\.(png|jpe?g)$/i.test(preview.fileName) ? (
                  <img
                    src={previewHref}
                    alt={preview.fileName}
                    className="mx-auto max-h-[40vh] max-w-full rounded-lg object-contain"
                  />
                ) : (
                  <iframe
                    title={preview.fileName}
                    src={previewHref}
                    className="h-[40vh] w-full rounded-lg border border-slate-200 bg-white"
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
