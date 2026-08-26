import {
  canonicalECRStage,
  getECRHighLevelStatus,
  type ECRHighLevelStatus,
} from "../../config/ecrRoles";
import type { ECRStatus } from "../../types/erpnext";

const STYLES: Record<string, string> = {
  Unknown: "border-neutral-300 bg-neutral-50 text-neutral-600",
  Draft: "border-neutral-200 bg-neutral-100 text-neutral-700",
  "In Review": "border-blue-200 bg-blue-50 text-blue-700",
  "Engineering Review": "border-blue-200 bg-blue-50 text-blue-700",
  "Procurement Review": "border-sky-200 bg-sky-50 text-sky-700",
  "RFQ Pending": "border-cyan-200 bg-cyan-50 text-cyan-700",
  "Operations Review": "border-orange-200 bg-orange-50 text-orange-700",
  "Quality Review": "border-violet-200 bg-violet-50 text-violet-700",
  "Program Review": "border-indigo-200 bg-indigo-50 text-indigo-700",
  "Sent Back": "border-amber-200 bg-amber-50 text-amber-700",
  Approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Procurement: "border-sky-200 bg-sky-50 text-sky-700",
  "Purchase Requisition": "border-sky-200 bg-sky-50 text-sky-700",
  RFQ: "border-cyan-200 bg-cyan-50 text-cyan-700",
  "Supplier Response": "border-purple-200 bg-purple-50 text-purple-700",
  "Supplier Evaluation": "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  "Supplier Selection": "border-teal-200 bg-teal-50 text-teal-700",
  Implementation: "border-cyan-200 bg-cyan-50 text-cyan-700",
  Validation: "border-yellow-200 bg-yellow-50 text-yellow-800",
  Closed: "border-slate-300 bg-slate-100 text-slate-700",
  Rejected: "border-rose-200 bg-rose-50 text-rose-700",
  Cancelled: "border-neutral-200 bg-neutral-100 text-neutral-500",
  "Rejected / Cancelled": "border-rose-200 bg-rose-50 text-rose-700",
};

export default function ECRStatusBadge({
  status,
  isHighLevel = false,
}: {
  status?: ECRStatus | ECRHighLevelStatus | string | null;
  isHighLevel?: boolean;
}) {
  const displayValue = isHighLevel
    ? getECRHighLevelStatus(status)
    : status && STYLES[status]
      ? status
      : canonicalECRStage(status);

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        STYLES[displayValue] ?? STYLES.Draft
      }`}
      title={status && status !== displayValue ? `ERP status: ${status}` : undefined}
    >
      {displayValue}
    </span>
  );
}
