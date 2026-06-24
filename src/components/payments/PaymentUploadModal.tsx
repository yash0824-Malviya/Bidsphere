import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  CloudUpload,
  FileText,
  Loader2,
  X,
} from "lucide-react";

import {
  isAllowedPaymentAttachment,
  PAYMENT_ATTACHMENT_ACCEPT,
  simulateAttachmentUpload,
} from "../../utils/paymentAttachmentUtils";

type UploadPhase = "idle" | "uploading" | "success" | "error";

interface Props {
  open: boolean;
  categoryLabel: string;
  replaceMode?: boolean;
  onClose: () => void;
  onComplete: (file: File) => void;
}

export default function PaymentUploadModal({
  open,
  categoryLabel,
  replaceMode = false,
  onClose,
  onComplete,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [selectedName, setSelectedName] = useState("");

  const reset = useCallback(() => {
    setPhase("idle");
    setProgress(0);
    setError("");
    setSelectedName("");
    setDragOver(false);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && phase !== "uploading") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, phase, onClose]);

  async function processFile(file: File) {
    if (!isAllowedPaymentAttachment(file)) {
      setError("Only PDF, PNG, JPG, and JPEG files are supported.");
      setPhase("error");
      return;
    }

    setSelectedName(file.name);
    setError("");
    setPhase("uploading");
    setProgress(0);

    try {
      await simulateAttachmentUpload(file, setProgress);
      setPhase("success");
      window.setTimeout(() => {
        onComplete(file);
        onClose();
      }, 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setPhase("error");
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (phase === "uploading") return;
    const file = e.dataTransfer.files?.[0];
    if (file) void processFile(file);
  }

  function handleBrowse(files: FileList | null) {
    const file = files?.[0];
    if (file) void processFile(file);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-upload-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-neutral-900/50 backdrop-blur-[2px]"
        aria-label="Close upload dialog"
        onClick={() => phase !== "uploading" && onClose()}
      />

      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-neutral-200 px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-primary-600">
              {replaceMode ? "Replace Document" : "Upload Document"}
            </p>
            <h2
              id="payment-upload-title"
              className="mt-0.5 text-lg font-semibold text-neutral-900"
            >
              {categoryLabel}
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              PDF, PNG, JPG, or JPEG · Max recommended 10 MB
            </p>
          </div>
          <button
            type="button"
            disabled={phase === "uploading"}
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-5">
          {phase === "success" ? (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="payment-upload-success-ring mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success-100">
                <CheckCircle2 className="h-9 w-9 text-success-500 payment-upload-success-icon" />
              </div>
              <p className="text-sm font-semibold text-neutral-900">
                Upload complete
              </p>
              <p className="mt-1 max-w-xs truncate text-xs text-neutral-500">
                {selectedName}
              </p>
            </div>
          ) : (
            <>
              <div
                onDragEnter={(e) => {
                  e.preventDefault();
                  if (phase !== "uploading") setDragOver(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (phase !== "uploading") setDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                }}
                onDrop={handleDrop}
                className={`relative rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                  dragOver
                    ? "border-primary-400 bg-primary-50/60"
                    : "border-neutral-300 bg-neutral-50/80"
                } ${phase === "uploading" ? "pointer-events-none opacity-80" : ""}`}
              >
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-neutral-200">
                  {phase === "uploading" ? (
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  ) : (
                    <CloudUpload className="h-6 w-6 text-primary" />
                  )}
                </div>
                <p className="text-sm font-medium text-neutral-800">
                  {phase === "uploading"
                    ? "Uploading…"
                    : "Drag & drop your file here"}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  or browse from your computer
                </p>
                {phase !== "uploading" && (
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600"
                  >
                    <FileText className="h-4 w-4" />
                    Browse Files
                  </button>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept={PAYMENT_ATTACHMENT_ACCEPT}
                  className="sr-only"
                  onChange={(e) => {
                    handleBrowse(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>

              {phase === "uploading" && (
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="truncate font-medium text-neutral-700">
                      {selectedName}
                    </span>
                    <span className="tabular-nums text-neutral-500">
                      {progress}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-neutral-200">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-150 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              {phase === "error" && error && (
                <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-600">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
