/**
 * RFQ list status badge — maps list fields to enterprise labels and renders
 * through the shared StatusBadge (single visual system app-wide).
 */

import StatusBadge from "../StatusBadge";

export type RfqEnterpriseListStatus =
  | "Draft"
  | "Open"
  | "Awaiting Supplier Response"
  | "AI Analysis"
  | "Under Legal Review"
  | "Under Finance Review"
  | "Purchase Order Created"
  | "Closed"
  | "Completed"
  | "Cancelled";

const SHORT_LABEL: Record<RfqEnterpriseListStatus, string> = {
  Draft: "Draft",
  Open: "Open",
  "Awaiting Supplier Response": "Awaiting Response",
  "AI Analysis": "AI Analysis",
  "Under Legal Review": "Legal Review",
  "Under Finance Review": "Finance Review",
  "Purchase Order Created": "PO Created",
  Closed: "Closed",
  Completed: "Completed",
  Cancelled: "Cancelled",
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
  if (erp === "Closed") return "Closed";
  if (
    erp === "Ordered" ||
    erp === "Partially Ordered" ||
    erp === "Awarded"
  ) {
    return "Purchase Order Created";
  }
  if (erp === "Draft") return "Draft";
  if (quoteCount <= 0) return "Awaiting Supplier Response";
  return "Open";
}

export default function RfqListStatusBadge({
  status,
}: {
  status: RfqEnterpriseListStatus | string;
}) {
  const key = (
    SHORT_LABEL[status as RfqEnterpriseListStatus] ? status : "Open"
  ) as RfqEnterpriseListStatus;
  const label = SHORT_LABEL[key] ?? status;

  return <StatusBadge status={label} />;
}
