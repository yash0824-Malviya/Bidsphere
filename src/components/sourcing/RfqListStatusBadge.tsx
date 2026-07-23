/**
 * Presentation-only RFQ list status badge.
 * Maps existing list fields (ERP status, quote count, PO link) to enterprise labels.
 */

export type RfqEnterpriseListStatus =
  | "Draft"
  | "Open"
  | "Awaiting Supplier Response"
  | "AI Analysis"
  | "Under Legal Review"
  | "Under Finance Review"
  | "Purchase Order Created"
  | "Completed"
  | "Cancelled";

const STYLES: Record<RfqEnterpriseListStatus, string> = {
  Draft: "bg-neutral-100 text-neutral-700",
  Open: "bg-blue-50 text-blue-700",
  "Awaiting Supplier Response": "bg-orange-50 text-orange-800",
  "AI Analysis": "bg-purple-50 text-purple-700",
  "Under Legal Review": "bg-indigo-50 text-indigo-700",
  "Under Finance Review": "bg-teal-50 text-teal-800",
  "Purchase Order Created": "bg-emerald-50 text-emerald-700",
  Completed: "bg-emerald-50 text-emerald-700",
  Cancelled: "bg-red-50 text-red-700",
};

/** Derive enterprise label from already-loaded list data (no extra API). */
export function resolveRfqEnterpriseListStatus(opts: {
  erpStatus?: string | null;
  quoteCount: number;
  hasPO: boolean;
}): RfqEnterpriseListStatus {
  const { quoteCount, hasPO } = opts;
  const erp = (opts.erpStatus ?? "Draft").trim();

  if (hasPO) return "Purchase Order Created";
  if (erp === "Cancelled") return "Cancelled";
  if (erp === "Ordered" || erp === "Closed") return "Completed";
  if (erp === "Draft") return "Draft";

  // Submitted / open RFQs — refine with quotation signal already on the page.
  // Legal / Finance / AI Analysis labels are supported by the badge styles when
  // richer list fields become available; list payload today only has quotes + PO.
  if (quoteCount <= 0) return "Awaiting Supplier Response";
  return "Open";
}

export default function RfqListStatusBadge({
  status,
}: {
  status: RfqEnterpriseListStatus | string;
}) {
  const key = (STYLES[status as RfqEnterpriseListStatus]
    ? status
    : "Open") as RfqEnterpriseListStatus;
  const cls = STYLES[key] ?? STYLES.Open;

  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded px-2 py-0.5 text-[12px] font-medium ${cls}`}
      title={status}
    >
      {status}
    </span>
  );
}
