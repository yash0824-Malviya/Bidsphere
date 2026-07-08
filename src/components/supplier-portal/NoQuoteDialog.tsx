import { useEffect, useState } from "react";
import { AlertTriangle, Ban, Loader2, X } from "lucide-react";
import { DECLINE_REASONS } from "../../api/supplierRfqResponse";

export interface NoQuotePayload {
  reason: string;
  reasonDetails?: string;
  comment?: string;
}

interface Props {
  open: boolean;
  rfqName: string;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: NoQuotePayload) => void | Promise<void>;
}

/**
 * "Unable to Submit a Quotation?" — lets a supplier explicitly decline an RFQ
 * with a mandatory reason (and required details when "Other"). Warning-styled.
 */
export default function NoQuoteDialog({
  open,
  rfqName,
  submitting = false,
  onClose,
  onSubmit,
}: Props) {
  const [reason, setReason] = useState("");
  const [reasonDetails, setReasonDetails] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setReason("");
      setReasonDetails("");
      setComment("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const isOther = reason === "Other";

  async function handleSubmit() {
    if (!reason) {
      setError("Please select a reason for declining.");
      return;
    }
    if (isOther && !reasonDetails.trim()) {
      setError("Please provide the reason details.");
      return;
    }
    setError(null);
    await onSubmit({
      reason,
      reasonDetails: reasonDetails.trim() || undefined,
      comment: comment.trim() || undefined,
    });
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="no-quote-title" className="modal-overlay">
      <div
        className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm"
        onClick={submitting ? undefined : onClose}
        aria-hidden
      />
      <div className="modal-panel relative max-w-lg p-5">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-warning-50 text-warning-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="no-quote-title" className="text-base font-semibold text-neutral-900">
              Unable to Submit a Quotation?
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              Please tell the buyer why you are declining{" "}
              <span className="font-medium text-neutral-800">{rfqName}</span>.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-700">
              Reason for declining <span className="text-danger-500">*</span>
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              className="input-field w-full"
            >
              <option value="">Select a reason…</option>
              {DECLINE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {isOther && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-700">
                Reason Details <span className="text-danger-500">*</span>
              </label>
              <textarea
                value={reasonDetails}
                onChange={(e) => setReasonDetails(e.target.value)}
                disabled={submitting}
                rows={3}
                placeholder="Explain why you are declining this RFQ…"
                className="input-field w-full resize-none"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-700">
              Additional Comments <span className="font-normal text-neutral-400">(optional)</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={submitting}
              rows={3}
              placeholder="Anything else the buyer should know…"
              className="input-field w-full resize-none"
            />
          </div>

          {error && (
            <p className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-xs font-medium text-danger-700">
              {error}
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="btn-touch w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 sm:w-auto sm:py-1.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-touch inline-flex w-full items-center justify-center gap-2 rounded-md bg-warning-500 px-3 py-2.5 text-sm font-semibold text-white hover:bg-warning-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning-200 disabled:opacity-60 sm:w-auto sm:py-1.5"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
            {submitting ? "Submitting…" : "Submit No Quote"}
          </button>
        </div>
      </div>
    </div>
  );
}
