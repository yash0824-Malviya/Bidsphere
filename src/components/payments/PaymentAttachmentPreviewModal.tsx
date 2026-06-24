import { Download, ExternalLink, X } from "lucide-react";

import {
  downloadPaymentAttachment,
  formatAttachmentFileSize,
  formatAttachmentUploadTime,
} from "../../utils/paymentAttachmentUtils";
import type { PaymentAttachment } from "../../types/paymentAttachment";

interface Props {
  attachment: PaymentAttachment | null;
  categoryLabel: string;
  onClose: () => void;
}

export default function PaymentAttachmentPreviewModal({
  attachment,
  categoryLabel,
  onClose,
}: Props) {
  if (!attachment) return null;

  const isPdf =
    attachment.mimeType === "application/pdf" ||
    attachment.fileName.toLowerCase().endsWith(".pdf");
  const isImage = attachment.mimeType.startsWith("image/");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="absolute inset-0 bg-neutral-900/60 backdrop-blur-[2px]"
        aria-label="Close preview"
        onClick={onClose}
      />

      <div className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              {categoryLabel}
            </p>
            <h2 className="truncate text-base font-semibold text-neutral-900">
              {attachment.fileName}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {formatAttachmentFileSize(attachment.size)} · Uploaded{" "}
              {formatAttachmentUploadTime(attachment.uploadedAt)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {attachment.objectUrl && (
              <>
                <a
                  href={attachment.objectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-primary-700"
                  title="Open in new tab"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  onClick={() => downloadPaymentAttachment(attachment)}
                  className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-primary-700"
                  title="Download"
                >
                  <Download className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-[240px] flex-1 overflow-auto bg-neutral-100 p-4">
          {!attachment.objectUrl ? (
            <p className="text-center text-sm text-neutral-500">
              Preview unavailable for this file.
            </p>
          ) : isImage ? (
            <img
              src={attachment.objectUrl}
              alt={attachment.fileName}
              className="mx-auto max-h-[60vh] max-w-full rounded-lg object-contain shadow-sm"
            />
          ) : isPdf ? (
            <iframe
              src={attachment.objectUrl}
              title={attachment.fileName}
              className="h-[60vh] w-full rounded-lg border border-neutral-200 bg-white"
            />
          ) : (
            <p className="text-center text-sm text-neutral-500">
              Preview not supported. Use Download to view this file.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
