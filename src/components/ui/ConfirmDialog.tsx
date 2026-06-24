import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

export type ConfirmTone = "danger" | "warning" | "primary";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** When true, the confirm button shows a spinner and is disabled. */
  isLoading?: boolean;
}

const TONE_BUTTON: Record<ConfirmTone, string> = {
  danger:
    "bg-danger hover:bg-danger-700 focus-visible:ring-danger-200 text-white",
  warning:
    "bg-warning-500 hover:bg-warning-600 focus-visible:ring-warning-200 text-white",
  primary:
    "bg-primary hover:bg-primary-700 focus-visible:ring-primary-200 text-white",
};

const TONE_ICON: Record<ConfirmTone, string> = {
  danger: "bg-danger-50 text-danger-600",
  warning: "bg-warning-50 text-warning-600",
  primary: "bg-primary-50 text-primary-600",
};

/**
 * Accessible confirmation modal for destructive or significant actions.
 * Closes on Escape, on backdrop click, and after a successful `onConfirm`.
 */
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  isLoading,
}: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleConfirm() {
    await onConfirm();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="modal-overlay"
    >
      <div
        className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="modal-panel relative max-w-md p-5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${TONE_ICON[tone]}`}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="confirm-title"
              className="text-base font-semibold text-neutral-900"
            >
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-sm text-neutral-600">{description}</p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="btn-touch w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 sm:w-auto sm:py-1.5"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isLoading}
            className={`btn-touch w-full rounded-md px-3 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 disabled:opacity-60 sm:w-auto sm:py-1.5 ${TONE_BUTTON[tone]}`}
          >
            {isLoading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
