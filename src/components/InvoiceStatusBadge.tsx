import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE } from "../api/vouchers";
import type { InvoiceStatus } from "../types/voucher";

export default function InvoiceStatusBadge({
  status,
  label,
}: {
  status: InvoiceStatus;
  /** Optional label override. */
  label?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${INVOICE_STATUS_TONE[status]}`}
    >
      {label ?? INVOICE_STATUS_LABEL[status]}
    </span>
  );
}
