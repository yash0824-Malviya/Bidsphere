import { useRef, useState, type DragEvent } from "react";
import toast from "react-hot-toast";
import {
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";

import {
  getFullFileUrl,
  openErpFileInBrowser,
} from "../../api/legalDocsStorage";
import { formatDate } from "../../utils/format";
import { formatFileSize } from "../../utils/materialRequestItemFiles";

export type DocumentUploadStatus = "empty" | "uploading" | "uploaded";

/** Loose file shape — RFI/RFP uploads and ERPNext attachments. */
export interface DocumentFileRef {
  file_name?: string;
  file_url?: string | null;
  file_id?: string | null;
  attachment?: string | null;
  file_size?: number | null;
  uploaded_at?: string | null;
}

/**
 * Canonical stored file path only — never treat bare file_id as openable.
 * Accepts ERP `/files` paths, absolute http(s), data URLs, or already-proxied URLs.
 */
export function resolveStoredFileUrl(
  file?: DocumentFileRef | null,
): string | null {
  if (!file) return null;
  const url = String(file.file_url ?? "").trim();
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  if (url.includes("/api/file-proxy")) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^\/?(private\/)?files\//.test(url)) {
    return url.startsWith("/") ? url : `/${url}`;
  }
  return null;
}

export function hasDocumentFile(file?: DocumentFileRef | null): boolean {
  return Boolean(resolveStoredFileUrl(file));
}

/** Browser-loadable URL for View/Download (fresh proxy token each call). */
export function resolveOpenableFileUrl(
  file?: DocumentFileRef | null,
): string | null {
  const stored = resolveStoredFileUrl(file);
  if (!stored) return null;
  if (stored.startsWith("data:") || stored.includes("/api/file-proxy")) {
    return stored;
  }
  if (/^\/?(private\/)?files\//.test(stored)) {
    const proxied = getFullFileUrl(stored);
    return proxied || null;
  }
  if (/^https?:\/\//i.test(stored)) {
    return getFullFileUrl(stored) || stored;
  }
  return null;
}

interface Props {
  title: string;
  required?: boolean;
  file?: DocumentFileRef | null;
  uploading?: boolean;
  /** 0–100 while uploading; omit for indeterminate. */
  uploadProgress?: number | null;
  readOnly?: boolean;
  accept?: string;
  /** Shown under the title (e.g. PDF, DOCX). */
  allowedFileTypes?: string[];
  /** Advisory max size in MB. */
  maxFileSizeMb?: number;
  onUpload: (file: File) => void;
  /** Clear the selected / uploaded file. */
  onRemove?: () => void;
  /** Called when View/Download detects a missing URL — parent should clear state. */
  onUnavailable?: () => void;
}

function StatusBadge({ status }: { status: DocumentUploadStatus }) {
  if (status === "uploading") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-0.5 text-[11px] font-semibold text-primary-700 ring-1 ring-inset ring-primary-200">
        <span className="h-1.5 w-1.5 rounded-full bg-primary-500" />
        Uploading
      </span>
    );
  }
  if (status === "uploaded") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Uploaded
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Not Uploaded
    </span>
  );
}

export default function RequiredDocumentUploadCard({
  title,
  required = false,
  file,
  uploading = false,
  uploadProgress = null,
  readOnly = false,
  accept,
  allowedFileTypes,
  maxFileSizeMb,
  onUpload,
  onRemove,
  onUnavailable,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [opening, setOpening] = useState<"view" | "download" | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const storedUrl = resolveStoredFileUrl(file);
  const status: DocumentUploadStatus = uploading
    ? "uploading"
    : storedUrl
      ? "uploaded"
      : "empty";

  const openOrClear = async (mode: "view" | "download") => {
    const openUrl = resolveOpenableFileUrl(file);
    if (!openUrl || !storedUrl) {
      // eslint-disable-next-line no-console
      console.warn("[RequiredDocument] blocked open — missing file_url", {
        file_name: file?.file_name ?? null,
        file_id: file?.file_id ?? null,
        file_url: file?.file_url ?? null,
        mode,
      });
      onUnavailable?.();
      return;
    }

    setOpening(mode);
    try {
      await openErpFileInBrowser(storedUrl, {
        mode,
        fileName: file?.file_name || "document",
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : mode === "download"
            ? "Download failed."
            : "View failed.";
      toast.error(
        message.startsWith("View failed") || message.startsWith("Download failed")
          ? message
          : `${mode === "download" ? "Download failed" : "View failed"}: ${message}`,
      );
    } finally {
      setOpening(null);
    }
  };

  const pickFile = () => {
    if (readOnly || uploading) return;
    inputRef.current?.click();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (readOnly || uploading) return;
    const next = e.dataTransfer.files?.[0];
    if (next) onUpload(next);
  };

  const hints: string[] = [];
  if (allowedFileTypes?.length) {
    hints.push(`Types: ${allowedFileTypes.join(", ")}`);
  }
  if (maxFileSizeMb) {
    hints.push(`Max ${maxFileSizeMb} MB`);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!readOnly && !uploading) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`flex h-full min-h-[188px] flex-col rounded-xl border bg-white p-4 shadow-sm transition-colors ${
        dragOver
          ? "border-primary-400 bg-primary-50/40"
          : "border-neutral-200"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-lg bg-primary-50 p-2.5 text-primary-700">
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-neutral-900">
                {title}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {required ? (
                  <span className="inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 ring-1 ring-inset ring-rose-200">
                    Mandatory
                  </span>
                ) : (
                  <span className="inline-flex rounded-full bg-neutral-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600 ring-1 ring-inset ring-neutral-200">
                    Optional
                  </span>
                )}
                <StatusBadge status={status} />
              </div>
            </div>
          </div>

          {hints.length ? (
            <p className="mt-2 text-[11px] text-neutral-500">{hints.join(" · ")}</p>
          ) : null}

          {status === "uploaded" ? (
            <dl className="mt-2 space-y-1 text-xs text-neutral-500">
              <div className="flex gap-2">
                <dt className="shrink-0 text-neutral-400">Filename</dt>
                <dd className="min-w-0 truncate font-medium text-neutral-700">
                  {file?.file_name || "—"}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 text-neutral-400">Upload Date</dt>
                <dd className="whitespace-nowrap font-medium text-neutral-700">
                  {file?.uploaded_at
                    ? formatDate(file.uploaded_at, "d MMM yyyy")
                    : "—"}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 text-neutral-400">File Size</dt>
                <dd className="whitespace-nowrap font-medium text-neutral-700">
                  {typeof file?.file_size === "number"
                    ? formatFileSize(file.file_size)
                    : "—"}
                </dd>
              </div>
            </dl>
          ) : status === "uploading" ? (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-primary-700">
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Uploading…
                </span>
                {typeof uploadProgress === "number" ? (
                  <span>
                    {Math.max(0, Math.min(100, Math.round(uploadProgress)))}%
                  </span>
                ) : null}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-primary-100">
                {typeof uploadProgress === "number" ? (
                  <div
                    className="h-full rounded-full bg-primary-600 transition-all"
                    style={{
                      width: `${Math.max(4, Math.min(100, uploadProgress))}%`,
                    }}
                  />
                ) : (
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-primary-500" />
                )}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-neutral-500">
              {dragOver
                ? "Drop file to upload…"
                : "Drag & drop a file here, or choose a file to upload."}
            </p>
          )}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={accept}
          disabled={readOnly || uploading}
          onChange={(e) => {
            const next = e.target.files?.[0];
            e.target.value = "";
            if (next) onUpload(next);
          }}
        />

        {status === "uploading" ? (
          <button
            type="button"
            disabled
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white opacity-80"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Uploading…
          </button>
        ) : null}

        {status === "empty" && !readOnly ? (
          <button
            type="button"
            onClick={pickFile}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white hover:bg-primary-700"
          >
            <Upload className="h-3.5 w-3.5" />
            Choose File
          </button>
        ) : null}

        {status === "uploaded" ? (
          <>
            <button
              type="button"
              disabled={!!opening}
              onClick={() => {
                void openOrClear("view");
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              {opening === "view" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              View
            </button>
            <button
              type="button"
              disabled={!!opening}
              onClick={() => {
                void openOrClear("download");
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              {opening === "download" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Download
            </button>
            {!readOnly ? (
              <>
                <button
                  type="button"
                  disabled={!!opening}
                  onClick={pickFile}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Replace File
                </button>
                {onRemove ? (
                  <button
                    type="button"
                    disabled={!!opening}
                    onClick={onRemove}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove File
                  </button>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
