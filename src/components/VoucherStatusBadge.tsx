import { VOUCHER_STATUS_LABEL, VOUCHER_STATUS_TONE } from "../api/vouchers";
import type { VoucherStatus } from "../types/voucher";

export default function VoucherStatusBadge({
  status,
  label,
}: {
  status: VoucherStatus;
  /** Optional label override (e.g. supplier-facing wording). */
  label?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${VOUCHER_STATUS_TONE[status]}`}
    >
      {label ?? VOUCHER_STATUS_LABEL[status]}
    </span>
  );
}
