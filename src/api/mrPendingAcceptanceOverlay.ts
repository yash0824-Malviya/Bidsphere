/**
 * Overlay Material Request workflow status from Material Issue Receipts
 * (localStorage + MIR remarks sidecar) so Department and Warehouse stay in sync.
 */

import { resolveIssueAcceptanceDisplayStatus } from "../utils/warehouseIssueFulfillmentSync";

const STORE_KEY = "bidsphere:material-issue-receipts";

type ReceiptLite = {
  mr_name?: string;
  status?: string;
};

function readReceipts(): ReceiptLite[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, ReceiptLite>;
    if (!parsed || typeof parsed !== "object") return [];
    return Object.values(parsed);
  } catch {
    return [];
  }
}

/**
 * When ERP stores "Material Issued" / still shows "Forwarded to Procurement"
 * after a warehouse stock issue, restore the UI status for acceptance.
 */
export function overlayMrStatusFromReceipts(
  mrName: string,
  status: string | null | undefined,
  remarks?: string | null,
): string {
  const name = String(mrName || "").trim();
  const st = String(status || "").trim();
  if (!name) return st;

  // Prefer cross-user MIR / ForwardedItems signals on MR remarks.
  if (remarks != null) {
    const fromRemarks = resolveIssueAcceptanceDisplayStatus(st, remarks);
    if (fromRemarks !== st) return fromRemarks;
  }

  const related = readReceipts().filter((r) => r.mr_name === name);
  if (related.length === 0) return st;

  const hasRejected = related.some((r) => r.status === "Acceptance Rejected");
  const hasPendingDept = related.some(
    (r) => r.status === "Pending Department Acceptance",
  );
  const hasWaitingWh = related.some(
    (r) => r.status === "Waiting Warehouse Signature",
  );
  const allConfirmed =
    related.length > 0 && related.every((r) => r.status === "Confirmed");

  if (allConfirmed) return st === "Completed" ? "Completed" : st;

  if (hasWaitingWh || hasPendingDept || hasRejected) {
    if (
      st === "Material Issued" ||
      st === "Pending Department Acceptance" ||
      st === "Stock Available" ||
      st === "Forwarded to Procurement" ||
      st === "RFQ Created" ||
      !st
    ) {
      return "Pending Department Acceptance";
    }
  }

  return st;
}
