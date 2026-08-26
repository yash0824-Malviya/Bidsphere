import { Send, Loader2 } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
  title: string;
}

export function SubmitConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  isSubmitting,
  title,
}: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-neutral-900/60 p-4 backdrop-blur-xs">
      <div className="relative w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600 mb-4">
          <Send className="h-6 w-6" />
        </div>

        <h3 className="text-lg font-bold text-neutral-900">
          Submit Business Need?
        </h3>

        <div className="mt-2 space-y-2 text-xs text-neutral-600 leading-relaxed">
          <p>
            You are about to submit <strong>"{title}"</strong> into the Enterprise Intake lifecycle.
          </p>
          <div className="rounded-lg bg-neutral-50 p-3 border border-neutral-200/80">
            <p className="font-semibold text-neutral-900 mb-1">What happens next?</p>
            <ol className="list-decimal list-inside space-y-1 text-neutral-600 text-[11px]">
              <li>Business Need status updates to <span className="font-semibold text-emerald-700">Submitted</span>.</li>
              <li>A linked <span className="font-semibold text-primary-700">Business Case</span> is automatically created.</li>
              <li>The case enters <span className="font-semibold text-amber-700">Pending Finance Review</span>.</li>
            </ol>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                Confirm & Submit
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
