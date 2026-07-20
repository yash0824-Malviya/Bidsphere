import { VOUCHER_STATUS_LABEL, VOUCHER_STATUS_TONE } from "../api/vouchers";
import type { VoucherStatus } from "../types/voucher";

const FALLBACK_TONE =
  "bg-neutral-100 text-neutral-700 ring-neutral-200";

export default function VoucherStatusBadge({
  status,
  label,
}: {
  status: VoucherStatus;
  /** Optional label override (e.g. supplier-facing wording). */
  label?: string;
}) {
  const tone = VOUCHER_STATUS_TONE[status] ?? FALLBACK_TONE;
  const resolvedLabel = label ?? VOUCHER_STATUS_LABEL[status] ?? String(status || "—");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone}`}
    >
      {resolvedLabel}
    </span>
  );
}
