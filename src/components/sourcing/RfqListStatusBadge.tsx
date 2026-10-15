/**
 * RFQ list status badge — maps list fields to real procurement workflow stages
 * and renders through the shared StatusBadge (single visual system app-wide).
 */

import StatusBadge from "../StatusBadge";
import type { LegalDocumentSet } from "../../api/legalDocs";

export type RfqEnterpriseListStatus =
  | "Material Request"
  | "RFQ Created"
  | "Supplier Invitation"
  | "Supplier Response"
  | "AI Analysis"
  | "Supplier Selection"
  | "Legal Review"
  | "Finance Review"
  | "Purchase Order"
  | "Completed"
  | "Draft"
  | "Cancelled"
  | "Closed"
  | "Rejected";

export interface ResolveRfqEnterpriseListStatusOptions {
  erpStatus?: string | null;
  supplierCount?: number;
  quoteCount: number;
  hasPO: boolean;
  legalDoc?: LegalDocumentSet | null;
  hasAnalysis?: boolean;
}

/**
 * Derive actual procurement workflow stage from live RFQ data.
 * Replaces generic "Open" with specific workflow stages matching the Procurement Status component.
 */
export function resolveRfqEnterpriseListStatus(
  opts: ResolveRfqEnterpriseListStatusOptions,
): string {
  const {
    supplierCount,
    quoteCount,
    hasPO,
    legalDoc,
    hasAnalysis,
  } = opts;
  const erp = (opts.erpStatus ?? "Draft").trim();

  // 1. Terminal ERP statuses
  if (erp === "Cancelled") return "Cancelled";
  if (erp === "Closed") return "Closed";
  if (erp === "Completed") return "Completed";

  // 2. Purchase Order created / Ordered
  const poExists =
    hasPO || erp === "Ordered" || erp === "Awarded" || erp === "Partially Ordered";
  if (poExists) {
    return "Purchase Order";
  }

  // 3. Draft with 0 suppliers and no quotes
  const resolvedSupplierCount =
    typeof supplierCount === "number"
      ? supplierCount
      : erp === "Submitted" || erp === "Open" || erp === "Replied"
        ? 1
        : 0;

  if (erp === "Draft" && resolvedSupplierCount === 0 && quoteCount === 0) {
    return "Draft";
  }

  // 4. Supplier Selected & Legal / Finance Review
  const selectedSupplier = (legalDoc?.supplier ?? "").trim();
  const legalStatus = String(legalDoc?.review_status ?? "").trim();
  const financeStatus = String(legalDoc?.finance_status ?? "").trim();

  if (selectedSupplier || legalDoc) {
    if (legalStatus === "Rejected" || financeStatus === "Rejected") {
      return "Rejected";
    }
    if (legalStatus === "Approved" && financeStatus === "Approved") {
      return "Purchase Order";
    }
    if (legalStatus === "Approved") {
      return "Finance Review";
    }
    return "Legal Review";
  }

  // 5. Supplier Responses submitted → AI Analysis / Supplier Selection
  if (quoteCount > 0) {
    if (hasAnalysis || quoteCount >= 2) {
      return "Supplier Selection";
    }
    return "AI Analysis";
  }

  // 6. Waiting for Supplier Responses or Supplier Invitation
  if (resolvedSupplierCount > 0) {
    return "Supplier Response";
  }

  return "Supplier Invitation";
}

export default function RfqListStatusBadge({
  status,
}: {
  status: RfqEnterpriseListStatus | string;
}) {
  return <StatusBadge status={status} />;
}
