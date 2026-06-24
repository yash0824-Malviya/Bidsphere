import { useEffect, useState } from "react";
import {
  Download,
  Eye,
  FileImage,
  FileText,
  Paperclip,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";

import {
  downloadPaymentAttachment,
  formatAttachmentFileSize,
  formatAttachmentUploadTime,
} from "../../utils/paymentAttachmentUtils";
import type {
  PaymentAttachment,
  PaymentAttachmentKind,
} from "../../types/paymentAttachment";
import PaymentAttachmentPreviewModal from "./PaymentAttachmentPreviewModal";
import PaymentUploadModal from "./PaymentUploadModal";

export type { PaymentAttachment, PaymentAttachmentKind };

const KIND_CONFIG: Record<
  PaymentAttachmentKind,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  check_image: { label: "Cheque Image", icon: FileImage },
  remittance_advice: { label: "Remittance Advice", icon: FileText },
  payment_confirmation: {
    label: "Payment Confirmation",
    icon: Paperclip,
  },
};

interface Props {
  attachments: PaymentAttachment[];
  onAdd: (kind: PaymentAttachmentKind, file: File) => void;
  onReplace: (id: string, file: File) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}

export default function PaymentAttachments({
  attachments,
  onAdd,
  onReplace,
  onRemove,
  disabled = false,
}: Props) {
  const [uploadKind, setUploadKind] = useState<PaymentAttachmentKind | null>(
    null
  );
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PaymentAttachment | null>(null);

  const uploadOpen = uploadKind !== null;
  const replaceAttachment = replaceId
    ? attachments.find((a) => a.id === replaceId)
    : undefined;

  useEffect(() => {
    if (replaceId && !replaceAttachment) setReplaceId(null);
  }, [replaceId, replaceAttachment]);

  function openUpload(kind: PaymentAttachmentKind) {
    setReplaceId(null);
    setUploadKind(kind);
  }

  function openReplace(attachment: PaymentAttachment) {
    setUploadKind(attachment.kind);
    setReplaceId(attachment.id);
  }

  function closeUpload() {
    setUploadKind(null);
    setReplaceId(null);
  }

  function handleUploadComplete(file: File) {
    if (!uploadKind) return;
    if (replaceId) {
      onReplace(replaceId, file);
    } else {
      onAdd(uploadKind, file);
    }
  }

  const modalCategory =
    uploadKind != null ? KIND_CONFIG[uploadKind].label : "Document";

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-neutral-900">
          Document Attachments
        </h4>
        <p className="mt-0.5 text-xs text-neutral-500">
          Upload check images, remittance advice, and payment confirmations for
          audit and reconciliation.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(KIND_CONFIG) as PaymentAttachmentKind[]).map((kind) => {
          const { label, icon: Icon } = KIND_CONFIG[kind];
          const file = attachments.find((a) => a.kind === kind);

          return (
            <article
              key={kind}
              className="flex flex-col rounded-xl border border-neutral-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50/80 px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-neutral-200">
                  <Icon className="h-4 w-4 text-primary" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-neutral-900">
                    {label}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {file ? "1 document" : "No document"}
                  </p>
                </div>
              </div>

              <div className="flex flex-1 flex-col p-4">
                {file ? (
                  <UploadedFileCard
                    attachment={file}
                    disabled={disabled}
                    onPreview={() => setPreview(file)}
                    onDownload={() => downloadPaymentAttachment(file)}
                    onReplace={() => openReplace(file)}
                    onDelete={() => onRemove(file.id)}
                  />
                ) : (
                  <EmptyCategoryCard
                    disabled={disabled}
                    onUpload={() => openUpload(kind)}
                  />
                )}
              </div>
            </article>
          );
        })}
      </div>

      <PaymentUploadModal
        open={uploadOpen}
        categoryLabel={modalCategory}
        replaceMode={!!replaceId}
        onClose={closeUpload}
        onComplete={handleUploadComplete}
      />

      <PaymentAttachmentPreviewModal
        attachment={preview}
        categoryLabel={
          preview ? KIND_CONFIG[preview.kind].label : "Document"
        }
        onClose={() => setPreview(null)}
      />
    </div>
  );
}

function EmptyCategoryCard({
  disabled,
  onUpload,
}: {
  disabled: boolean;
  onUpload: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50/50 px-4 py-8 text-center">
      <Upload className="mb-2 h-8 w-8 text-neutral-300" />
      <p className="text-xs text-neutral-500">
        Drag & drop or upload PDF, PNG, JPG
      </p>
      {!disabled && (
        <button
          type="button"
          onClick={onUpload}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-100"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload
        </button>
      )}
    </div>
  );
}

function UploadedFileCard({
  attachment,
  disabled,
  onPreview,
  onDownload,
  onReplace,
  onDelete,
}: {
  attachment: PaymentAttachment;
  disabled: boolean;
  onPreview: () => void;
  onDownload: () => void;
  onReplace: () => void;
  onDelete: () => void;
}) {
  const isImage = attachment.mimeType.startsWith("image/");

  return (
    <div className="flex flex-1 flex-col gap-3">
      {attachment.objectUrl && isImage && (
        <button
          type="button"
          onClick={onPreview}
          className="group relative overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100"
        >
          <img
            src={attachment.objectUrl}
            alt=""
            className="h-28 w-full object-cover transition-transform group-hover:scale-[1.02]"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-neutral-900/0 opacity-0 transition-opacity group-hover:bg-neutral-900/20 group-hover:opacity-100">
            <Eye className="h-6 w-6 text-white drop-shadow" />
          </span>
        </button>
      )}

      {attachment.objectUrl && !isImage && (
        <button
          type="button"
          onClick={onPreview}
          className="flex h-28 flex-col items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 hover:bg-neutral-100"
        >
          <FileText className="h-8 w-8 text-primary" />
          <span className="mt-1 text-xs font-medium text-primary-700">
            Preview PDF
          </span>
        </button>
      )}

      <div className="rounded-lg bg-neutral-50 px-3 py-2.5 ring-1 ring-neutral-100">
        <p
          className="truncate text-sm font-medium text-neutral-900"
          title={attachment.fileName}
        >
          {attachment.fileName}
        </p>
        <dl className="mt-2 space-y-1 text-xs text-neutral-500">
          <div className="flex justify-between gap-2">
            <dt>Upload Time</dt>
            <dd className="text-right text-neutral-700">
              {formatAttachmentUploadTime(attachment.uploadedAt)}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>File Size</dt>
            <dd className="tabular-nums text-neutral-700">
              {formatAttachmentFileSize(attachment.size)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-auto flex flex-wrap gap-1.5">
        <ActionChip icon={Eye} label="Preview" onClick={onPreview} />
        <ActionChip icon={Download} label="Download" onClick={onDownload} />
        {!disabled && (
          <>
            <ActionChip icon={RefreshCw} label="Replace" onClick={onReplace} />
            <ActionChip
              icon={Trash2}
              label="Delete"
              onClick={onDelete}
              tone="danger"
            />
          </>
        )}
      </div>
    </div>
  );
}

function ActionChip({
  icon: Icon,
  label,
  onClick,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
        tone === "danger"
          ? "text-danger-600 hover:bg-danger-50"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-primary-700"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
