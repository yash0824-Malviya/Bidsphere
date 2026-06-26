import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { formatCurrency, formatDate } from "../../utils/format";

export interface PaymentSuccessDetails {
  paymentEntryId: string;
  paymentReference: string;
  invoiceNumber: string;
  supplier: string;
  amountPaid: number;
  paymentDate: string;
  paymentMethod: string;
}

interface Props {
  open: boolean;
  details: PaymentSuccessDetails | null;
  onViewReceipt: () => void;
  onGoToPayments: () => void;
  onBackToDashboard: () => void;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <span className="shrink-0 text-neutral-500">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold text-neutral-900">
        {value}
      </span>
    </div>
  );
}

/**
 * Post-submission success modal for Finance payment flows.
 * Closes only when the user selects an action — no backdrop dismiss.
 */
export default function PaymentSuccessModal({
  open,
  details,
  onViewReceipt,
  onGoToPayments,
  onBackToDashboard,
}: Props) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!open || !details) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-success-title"
      className="modal-overlay"
    >
      <div
        className={`absolute inset-0 bg-neutral-900/45 backdrop-blur-sm transition-opacity duration-300 ${
          entered ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden
      />
      <div
        className={`modal-panel relative max-w-md p-6 transition-all duration-300 ease-out ${
          entered
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-3 scale-[0.98] opacity-0"
        }`}
      >
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-100 text-success-600 ring-8 ring-success-50">
            <CheckCircle2 className="h-7 w-7" strokeWidth={2.25} />
          </span>
          <h2
            id="payment-success-title"
            className="mt-4 text-lg font-bold text-neutral-900"
          >
            ✅ Payment Processed Successfully
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            The supplier payment has been recorded and submitted to ERPNext.
          </p>
        </div>

        <div className="mt-5 divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-neutral-50/60 px-4">
          <DetailRow label="Payment Reference" value={details.paymentReference} />
          <DetailRow label="Invoice Number" value={details.invoiceNumber} />
          <DetailRow label="Supplier" value={details.supplier} />
          <DetailRow
            label="Amount Paid"
            value={formatCurrency(details.amountPaid)}
          />
          <DetailRow
            label="Payment Date"
            value={formatDate(details.paymentDate)}
          />
          <DetailRow label="Payment Method" value={details.paymentMethod} />
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onViewReceipt}
            className="inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600"
          >
            View Payment Receipt
          </button>
          <button
            type="button"
            onClick={onGoToPayments}
            className="inline-flex w-full items-center justify-center rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50"
          >
            Go to Payments
          </button>
          <button
            type="button"
            onClick={onBackToDashboard}
            className="inline-flex w-full items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
