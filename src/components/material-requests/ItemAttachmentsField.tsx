import { useRef, useState } from "react";
import {
  Download,
  Eye,
  FileArchive,
  FileImage,
  FileText,
  Paperclip,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  MR_ITEM_FILE_MAX_BYTES,
  acceptAttrForMrItemDrawing,
  formatFileSize,
  isPreviewableAttachment,
  newAttachmentId,
  resolveMrItemFileHref,
  validateMrItemDrawing,
  RFQ_DOCUMENT_TYPES,
  inferDocumentTypeFromFileName,
  type AttachmentVisibility,
  type EngineeringAttachment,
  type PendingAttachment,
} from "../../utils/materialRequestItemFiles";

export interface ItemAttachmentsFieldProps {
  rowNumber: number;
  /** Persisted attachments already on the server. */
  attachments: EngineeringAttachment[];
  /** Local files waiting for MR save/sync. */
  pending: PendingAttachment[];
  /** Department can upload/remove; warehouse/procurement use readOnly. */
  readOnly?: boolean;
  /**
   * Per-file delete gate (e.g. procurement cannot delete department files).
   * Defaults to allowing delete whenever not readOnly.
   */
  canDeleteAttachment?: (att: EngineeringAttachment) => boolean;
  /**
   * Per-file metadata edit gate (visibility / document type).
   * Defaults to allowing edit whenever not readOnly.
   */
  canEditAttachment?: (att: EngineeringAttachment) => boolean;
  /** Override document type options (defaults to RFQ_DOCUMENT_TYPES). */
  documentTypes?: readonly string[];
  /** Enterprise procurement styling (RFQ wizard). */
  variant?: "default" | "enterprise";
  onChange: (next: {
    attachments: EngineeringAttachment[];
    pendingAttachments: PendingAttachment[];
    attachmentsDirty: boolean;
  }) => void;
}

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

function formatUploadedAt(iso?: string): string {
  if (!iso) return "Pending upload";
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

/**
 * Enterprise multi-file attachment control for a Material Request line item.
 * Supports drag/drop, multi-select, preview (PDF/images), download, and remove.
 */
export default function ItemAttachmentsField({
  rowNumber,
  attachments,
  pending,
  readOnly = false,
  canDeleteAttachment,
  canEditAttachment,
  documentTypes = RFQ_DOCUMENT_TYPES,
  variant = "default",
  onChange,
}: ItemAttachmentsFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<{
    kind: "pending" | "persisted";
    id: string;
  } | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    href: string;
    kind: "image" | "pdf";
  } | null>(null);

  const total = attachments.length + pending.length;

  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const nextPending = [...pending];
    let rejected = 0;
    for (const file of files) {
      const err = validateMrItemDrawing(file);
      if (err) {
        rejected += 1;
        toast.error(`${file.name}: ${err}`);
        continue;
      }
      const dup =
        nextPending.some((p) => p.file.name === file.name && p.file.size === file.size) ||
        attachments.some((a) => a.fileName === file.name && a.fileSize === file.size);
      if (dup) {
        toast.error(`${file.name} is already attached.`);
        continue;
      }
      nextPending.push({
        id: newAttachmentId(),
        file,
        localUrl: URL.createObjectURL(file),
        progress: 0,
        visibility: "supplier",
        documentType: inferDocumentTypeFromFileName(file.name),
      });
    }
    if (nextPending.length !== pending.length) {
      onChange({
        attachments,
        pendingAttachments: nextPending,
        attachmentsDirty: true,
      });
      if (rejected === 0 && nextPending.length > pending.length) {
        toast.success(
          `${nextPending.length - pending.length} file${nextPending.length - pending.length === 1 ? "" : "s"} ready to upload`,
        );
      }
    }
  }

  function removePersisted(id: string) {
    onChange({
      attachments: attachments.filter((a) => a.id !== id),
      pendingAttachments: pending,
      attachmentsDirty: true,
    });
  }

  function removePending(id: string) {
    const item = pending.find((p) => p.id === id);
    if (item?.localUrl) {
      try {
        URL.revokeObjectURL(item.localUrl);
      } catch {
        /* ignore */
      }
    }
    onChange({
      attachments,
      pendingAttachments: pending.filter((p) => p.id !== id),
      attachmentsDirty: true,
    });
  }

  function patchPersisted(
    id: string,
    patch: Partial<Pick<EngineeringAttachment, "visibility" | "documentType">>,
  ) {
    onChange({
      attachments: attachments.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
      pendingAttachments: pending,
      attachmentsDirty: true,
    });
  }

  function patchPending(
    id: string,
    patch: Partial<Pick<PendingAttachment, "visibility" | "documentType">>,
  ) {
    onChange({
      attachments,
      pendingAttachments: pending.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
      attachmentsDirty: true,
    });
  }

  function openPreview(opts: {
    fileName: string;
    href: string;
    fileType?: string;
  }) {
    if (!isPreviewableAttachment(opts.fileName, opts.fileType)) {
      toast.error("Preview is not available for this file type. Use Download.");
      return;
    }
    const kind = /\.pdf$/i.test(opts.fileName) || (opts.fileType ?? "").includes("pdf")
      ? "pdf"
      : "image";
    setPreview({ title: opts.fileName, href: opts.href, kind });
  }

  function startReplace(kind: "pending" | "persisted", id: string) {
    setReplaceTarget({ kind, id });
    replaceInputRef.current?.click();
  }

  function handleReplaceSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !replaceTarget) return;
    if (replaceTarget.kind === "pending") {
      removePending(replaceTarget.id);
    } else {
      removePersisted(replaceTarget.id);
    }
    addFiles([file]);
    setReplaceTarget(null);
  }

  const enterprise = variant === "enterprise";
  const maxMb = Math.round(MR_ITEM_FILE_MAX_BYTES / (1024 * 1024));

  if (enterprise) {
    return (
      <div className="w-full min-w-0 font-[Inter,ui-sans-serif,system-ui,sans-serif]">
        <input
          ref={replaceInputRef}
          type="file"
          accept={acceptAttrForMrItemDrawing()}
          className="sr-only"
          aria-hidden
          onChange={handleReplaceSelect}
        />

        {!readOnly && (
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
            }}
            className={`rounded-2xl border-2 border-dashed px-6 py-5 text-center transition ${
              dragging
                ? "border-[#1F3A6D] bg-[#EFF6FF]"
                : "border-[#CBD5E1] bg-[#F8FAFC]/80 hover:border-[#1F3A6D]/40 hover:bg-[#EFF6FF]/40"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={acceptAttrForMrItemDrawing()}
              className="sr-only"
              aria-label={`Attachments for row ${rowNumber}`}
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Upload className="mx-auto h-8 w-8 text-[#1F3A6D]/60" />
            <p className="mt-2 text-[15px] font-medium text-[#334155]">
              Drag &amp; Drop files here
            </p>
            <p className="mt-1 text-[13px] text-[#64748B]">
              or use the button below to browse from your device
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl border border-[#1F3A6D]/30 bg-white px-5 text-[13px] font-semibold text-[#1F3A6D] shadow-sm transition hover:border-[#1F3A6D]/50 hover:bg-[#EFF6FF]"
            >
              Browse Files
            </button>
            <p className="mt-3 text-[12px] text-[#94A3B8]">
              Supported: PDF, CAD, STEP, Images, ZIP · Maximum file size {maxMb}{" "}
              MB
            </p>
          </div>
        )}

        {total === 0 && readOnly && (
          <p className="text-[15px] text-[#94A3B8]">No attachments available</p>
        )}

        {total > 0 && (
          <ul className={`space-y-3 ${!readOnly ? "mt-4" : ""}`}>
            {attachments.map((att) => {
              const href = resolveMrItemFileHref(att.fileUrl);
              const canPreview = isPreviewableAttachment(att.fileName, att.fileType);
              const canDelete =
                !readOnly && (canDeleteAttachment ? canDeleteAttachment(att) : true);
              return (
                <li
                  key={att.id}
                  className="flex flex-col gap-3 rounded-2xl border border-[#E2E8F0] bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 shrink-0 rounded-lg bg-[#EFF6FF] p-2">
                      <FileGlyph name={att.fileName} type={att.fileType} />
                    </span>
                    <div className="min-w-0">
                      <p
                        className="truncate text-[15px] font-medium text-[#0F172A]"
                        title={att.fileName}
                      >
                        {att.fileName}
                      </p>
                      <p className="mt-0.5 text-[13px] text-[#64748B]">
                        {formatFileSize(att.fileSize)}
                        {att.source === "procurement" ? " · Procurement" : ""}
                        {att.uploadedAt
                          ? ` · ${formatUploadedAt(att.uploadedAt)}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canPreview && (
                      <button
                        type="button"
                        onClick={() =>
                          openPreview({
                            fileName: att.fileName,
                            href,
                            fileType: att.fileType,
                          })
                        }
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E2E8F0] px-3 text-[13px] font-medium text-[#475569] hover:bg-[#F8FAFC]"
                      >
                        <Eye className="h-3.5 w-3.5" /> View
                      </button>
                    )}
                    <a
                      href={href}
                      download={att.fileName}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E2E8F0] px-3 text-[13px] font-medium text-[#475569] hover:bg-[#F8FAFC]"
                    >
                      <Download className="h-3.5 w-3.5" /> Download
                    </a>
                    {!readOnly && canDelete && (
                      <>
                        <button
                          type="button"
                          onClick={() => startReplace("persisted", att.id)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E2E8F0] px-3 text-[13px] font-medium text-[#1F3A6D] hover:bg-[#EFF6FF]"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Replace
                        </button>
                        <button
                          type="button"
                          onClick={() => removePersisted(att.id)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-[13px] font-medium text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}

            {pending.map((item) => {
              const canPreview = isPreviewableAttachment(
                item.file.name,
                item.file.type,
              );
              return (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 shrink-0 rounded-lg bg-white p-2">
                      <FileGlyph name={item.file.name} type={item.file.type} />
                    </span>
                    <div className="min-w-0">
                      <p
                        className="truncate text-[15px] font-medium text-[#0F172A]"
                        title={item.file.name}
                      >
                        {item.file.name}
                      </p>
                      <p className="mt-0.5 text-[13px] text-amber-800">
                        {formatFileSize(item.file.size)} · Pending upload
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canPreview && (
                      <button
                        type="button"
                        onClick={() =>
                          openPreview({
                            fileName: item.file.name,
                            href: item.localUrl,
                            fileType: item.file.type,
                          })
                        }
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 text-[13px] font-medium text-[#475569] hover:bg-[#F8FAFC]"
                      >
                        <Eye className="h-3.5 w-3.5" /> View
                      </button>
                    )}
                    {!readOnly && (
                      <>
                        <button
                          type="button"
                          onClick={() => startReplace("pending", item.id)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 text-[13px] font-medium text-[#1F3A6D] hover:bg-[#EFF6FF]"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Replace
                        </button>
                        <button
                          type="button"
                          onClick={() => removePending(item.id)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-[13px] font-medium text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

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
                  {preview.title}
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
                {preview.kind === "image" ? (
                  <img
                    src={preview.href}
                    alt={preview.title}
                    className="mx-auto max-h-[70vh] max-w-full object-contain"
                  />
                ) : (
                  <iframe
                    title={preview.title}
                    src={preview.href}
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

  return (
    <div className="min-w-[220px] max-w-[280px]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-700 ring-1 ring-inset ring-primary-100">
          <Paperclip className="h-3 w-3" />
          {total} Attachment{total === 1 ? "" : "s"}
        </span>
      </div>

      {!readOnly && (
        <div
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
          }}
          className={`rounded-lg border border-dashed px-2 py-2.5 text-center transition ${
            dragging
              ? "border-primary-400 bg-primary-50"
              : "border-neutral-300 bg-neutral-50/80 hover:border-primary-300 hover:bg-primary-50/40"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={acceptAttrForMrItemDrawing()}
            className="sr-only"
            aria-label={`Attachments for row ${rowNumber}`}
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Upload className="mx-auto h-4 w-4 text-neutral-400" />
          <p className="mt-1 text-[10px] font-medium text-neutral-600">
            Drag & drop or{" "}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="font-semibold text-primary-700 underline-offset-2 hover:underline"
            >
              Browse
            </button>
          </p>
          <p className="mt-0.5 text-[9px] text-neutral-400">
            PDF, CAD, images, ZIP · max 50 MB
          </p>
        </div>
      )}

      {total === 0 && readOnly && (
        <p className="text-[11px] text-neutral-400">No attachments available</p>
      )}

      {total > 0 && (
        <ul className="mt-2 max-h-44 space-y-1.5 overflow-y-auto">
          {attachments.map((att) => {
            const href = resolveMrItemFileHref(att.fileUrl);
            const canPreview = isPreviewableAttachment(att.fileName, att.fileType);
            const visibility: AttachmentVisibility =
              att.visibility === "internal" ? "internal" : "supplier";
            const canEditMeta =
              !readOnly && (canEditAttachment ? canEditAttachment(att) : true);
            const canDelete =
              !readOnly && (canDeleteAttachment ? canDeleteAttachment(att) : true);
            return (
              <li
                key={att.id}
                className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 shadow-sm"
              >
                <div className="flex items-start gap-1.5">
                  <span className="mt-0.5 shrink-0">
                    <FileGlyph name={att.fileName} type={att.fileType} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-[11px] font-semibold text-neutral-800"
                      title={att.fileName}
                    >
                      {att.fileName}
                    </p>
                    <p className="text-[9px] leading-relaxed text-neutral-400">
                      <span className="uppercase">{att.fileType || "file"}</span>
                      {" · "}
                      {formatFileSize(att.fileSize)}
                      {att.version ? ` · v${att.version}` : ""}
                      {att.source === "procurement" ? " · Procurement" : ""}
                    </p>
                    <p className="text-[9px] text-neutral-400">
                      {att.uploadedBy || "—"}
                      {att.uploadedAt
                        ? ` · ${formatUploadedAt(att.uploadedAt)}`
                        : ""}
                    </p>
                    {canEditMeta ? (
                      <div className="mt-1 grid gap-1">
                        <label className="block text-[9px] font-medium text-neutral-500">
                          Visibility
                          <select
                            value={visibility}
                            onChange={(e) =>
                              patchPersisted(att.id, {
                                visibility: e.target
                                  .value as AttachmentVisibility,
                              })
                            }
                            className="mt-0.5 w-full rounded border border-neutral-200 bg-white px-1 py-0.5 text-[10px] text-neutral-700"
                          >
                            <option value="supplier">Supplier Visible</option>
                            <option value="internal">Internal Only</option>
                          </select>
                        </label>
                        <label className="block text-[9px] font-medium text-neutral-500">
                          Document Type
                          <select
                            value={
                              att.documentType ||
                              inferDocumentTypeFromFileName(att.fileName)
                            }
                            onChange={(e) =>
                              patchPersisted(att.id, {
                                documentType: e.target.value,
                              })
                            }
                            className="mt-0.5 w-full rounded border border-neutral-200 bg-white px-1 py-0.5 text-[10px] text-neutral-700"
                          >
                            {documentTypes.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : (
                      <p className="mt-0.5 text-[9px] text-neutral-500">
                        {att.documentType ||
                          inferDocumentTypeFromFileName(att.fileName)}
                        {" · "}
                        {visibility === "internal"
                          ? "Internal Only"
                          : "Supplier Visible"}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {canPreview && (
                        <button
                          type="button"
                          onClick={() =>
                            openPreview({
                              fileName: att.fileName,
                              href,
                              fileType: att.fileType,
                            })
                          }
                          className="inline-flex items-center gap-0.5 rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 hover:bg-neutral-50"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
                      )}
                      <a
                        href={href}
                        download={att.fileName}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 hover:bg-neutral-50"
                      >
                        <Download className="h-3 w-3" /> Download
                      </a>
                      {!readOnly && canDelete && (
                        <button
                          type="button"
                          onClick={() => removePersisted(att.id)}
                          className="inline-flex items-center gap-0.5 rounded border border-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}

          {pending.map((item) => {
            const canPreview = isPreviewableAttachment(item.file.name, item.file.type);
            const visibility: AttachmentVisibility =
              item.visibility === "internal" ? "internal" : "supplier";
            return (
              <li
                key={item.id}
                className="rounded-lg border border-amber-200 bg-amber-50/50 px-2 py-1.5"
              >
                <div className="flex items-start gap-1.5">
                  <span className="mt-0.5 shrink-0">
                    <FileGlyph name={item.file.name} type={item.file.type} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-[11px] font-semibold text-neutral-800"
                      title={item.file.name}
                    >
                      {item.file.name}
                    </p>
                    <p className="text-[9px] text-amber-700">
                      {formatFileSize(item.file.size)} · Pending upload
                    </p>
                    {!readOnly && (
                      <div className="mt-1 grid gap-1">
                        <label className="block text-[9px] font-medium text-neutral-500">
                          Visibility
                          <select
                            value={visibility}
                            onChange={(e) =>
                              patchPending(item.id, {
                                visibility: e.target
                                  .value as AttachmentVisibility,
                              })
                            }
                            className="mt-0.5 w-full rounded border border-neutral-200 bg-white px-1 py-0.5 text-[10px] text-neutral-700"
                          >
                            <option value="supplier">Supplier Visible</option>
                            <option value="internal">Internal Only</option>
                          </select>
                        </label>
                        <label className="block text-[9px] font-medium text-neutral-500">
                          Document Type
                          <select
                            value={
                              item.documentType ||
                              inferDocumentTypeFromFileName(item.file.name)
                            }
                            onChange={(e) =>
                              patchPending(item.id, {
                                documentType: e.target.value,
                              })
                            }
                            className="mt-0.5 w-full rounded border border-neutral-200 bg-white px-1 py-0.5 text-[10px] text-neutral-700"
                          >
                            {documentTypes.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {canPreview && (
                        <button
                          type="button"
                          onClick={() =>
                            openPreview({
                              fileName: item.file.name,
                              href: item.localUrl,
                              fileType: item.file.type,
                            })
                          }
                          className="inline-flex items-center gap-0.5 rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 hover:bg-neutral-50"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removePending(item.id)}
                        className="inline-flex items-center gap-0.5 rounded border border-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50"
                      >
                        <X className="h-3 w-3" /> Remove
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && total > 0 && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] font-semibold text-primary-700 hover:bg-primary-50"
        >
          <Plus className="h-3 w-3" /> Upload More
        </button>
      )}

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
                {preview.title}
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
              {preview.kind === "image" ? (
                <img
                  src={preview.href}
                  alt={preview.title}
                  className="mx-auto max-h-[70vh] max-w-full object-contain"
                />
              ) : (
                <iframe
                  title={preview.title}
                  src={preview.href}
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
