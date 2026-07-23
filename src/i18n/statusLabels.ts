import type { TFunction } from "i18next";

/**
 * Maps canonical ERPNext status strings (always English) to i18n keys so
 * status badges display in the active language. Unknown statuses fall back to
 * the raw English label — never a key name or `undefined`.
 */
const STATUS_KEYS: Record<string, string> = {
  Completed: "statusBadge.completed",
  "To Receive and Bill": "statusBadge.toReceiveAndBill",
  "To Bill": "statusBadge.toBill",
  Cancelled: "statusBadge.cancelled",
  Draft: "statusBadge.draft",
  Paid: "statusBadge.paid",
  Partial: "statusBadge.partial",
  Failed: "statusBadge.failed",
  Voided: "statusBadge.voided",
  Scheduled: "statusBadge.scheduled",
  Processing: "statusBadge.processing",
  Unpaid: "statusBadge.unpaid",
  Overdue: "statusBadge.overdue",
  Submitted: "statusBadge.submitted",
  Approved: "statusBadge.approved",
  Rejected: "statusBadge.rejected",
  Pending: "statusBadge.pending",
  "Pending Acceptance": "statusBadge.pendingAcceptance",
  "Pending Supplier Acceptance": "statusBadge.pendingSupplierAcceptance",
  "To Receive": "statusBadge.toReceive",
  Accepted: "statusBadge.accepted",
  "In Transit": "statusBadge.inTransit",
  "Partially Received": "statusBadge.partiallyReceived",
  Delivered: "statusBadge.delivered",
  Closed: "statusBadge.closed",
  Ordered: "statusBadge.ordered",
  "Partly Paid": "statusBadge.partlyPaid",
  "On Hold": "statusBadge.onHold",
  Active: "statusBadge.active",
  Inactive: "statusBadge.inactive",
  "Below Reorder": "statusBadge.belowReorder",
  "Admin Review": "statusBadge.adminReview",
  "Under Warehouse Review": "statusBadge.underWarehouseReview",
  "Stock Available": "statusBadge.stockAvailable",
  "Material Issued": "statusBadge.materialIssued",
  "Pending Department Acceptance": "statusBadge.waitingForAcceptance",
  "Waiting for Department Acceptance": "statusBadge.waitingForDepartmentAcceptance",
  "Waiting for Acceptance": "statusBadge.waitingForAcceptance",
  "Partially Issued": "statusBadge.partiallyIssued",
  "Waiting Warehouse Signature": "statusBadge.waitingWarehouseSignature",
  Confirmed: "statusBadge.confirmed",
  "Acceptance Rejected": "statusBadge.acceptanceRejected",
  "Material Receipt Confirmed": "statusBadge.materialReceiptConfirmed",
  "Procurement Required": "statusBadge.procurementRequired",
  "Forwarded to Procurement": "statusBadge.forwardedToProcurement",
  "RFQ Created": "statusBadge.rfqCreated",
  "Return Issued": "statusBadge.returnIssued",
  Return: "statusBadge.return",
  "Debit Note Issued": "statusBadge.debitNoteIssued",
  "Internal Transfer": "statusBadge.internalTransfer",
  Live: "statusBadge.live",
  Open: "statusBadge.open",
  Awarded: "statusBadge.awarded",
};

/** Translate a status label, falling back to the original English text. */
export function translateStatus(
  t: TFunction,
  status: string | undefined | null
): string {
  const label = status?.trim();
  if (!label) return "—";
  const key = STATUS_KEYS[label];
  return key ? (t(key, { defaultValue: label }) as string) : label;
}
