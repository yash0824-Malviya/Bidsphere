import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE } from "../api/vouchers";
import type { InvoiceStatus } from "../types/voucher";

const FALLBACK_TONE =
  "bg-neutral-100 text-neutral-700 ring-neutral-200";

export default function InvoiceStatusBadge({
  status,
  label,
}: {
  status: InvoiceStatus;
  /** Optional label override. */
  label?: string;
}) {
  const tone = INVOICE_STATUS_TONE[status] ?? FALLBACK_TONE;
  const resolvedLabel = label ?? INVOICE_STATUS_LABEL[status] ?? String(status || "—");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone}`}
    >
      {resolvedLabel}
    </span>
  );
}
