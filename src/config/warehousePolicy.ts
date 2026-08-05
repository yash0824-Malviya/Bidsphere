/**
 * Warehouse company policy for Material Request stock decisions.
 *
 * Option A (default): issue available stock and forward the shortage.
 * Option B: forward the entire line to Procurement (no partial issue).
 */

export type PartialIssuePolicy =
  | "issue_partial_and_forward"
  | "forward_entire";

export const WAREHOUSE_POLICY = {
  /**
   * CASE 3 — Available Qty > 0 AND Available Qty < Requested Qty
   * Default: Option A (partial issue + forward remaining).
   */
  partialIssuePolicy: "issue_partial_and_forward" as PartialIssuePolicy,
} as const;
