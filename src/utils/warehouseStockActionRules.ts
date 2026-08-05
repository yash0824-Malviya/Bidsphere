/**
 * Warehouse Material Request stock-decision business rules.
 *
 * CASE 1 — Available >= Requested → Issue Material only
 * CASE 2 — Available = 0         → Forward to Procurement only
 * CASE 3 — 0 < Available < Req → Option A: issue partial + forward remaining
 *                                   Option B: forward entire request
 */

import {
  WAREHOUSE_POLICY,
  type PartialIssuePolicy,
} from "../config/warehousePolicy";
import { nonNegativeQty } from "./inventoryStock";

export type WarehouseStockCase = "full" | "none" | "partial";

/** Persisted / selectable line actions on Stock Decision. */
export type WarehouseLineAction = "issue" | "issue_partial" | "forward";

export interface LineActionPlan {
  stockCase: WarehouseStockCase;
  availableQty: number;
  requestedQty: number;
  shortageQty: number;
  /** Default action after stock check. */
  defaultAction: WarehouseLineAction;
  /** Actions the warehouse user may select. */
  allowedActions: WarehouseLineAction[];
  /** Suggested issue qty for the default / selected path. */
  issueQty: number;
  /** Suggested forward qty for the default / selected path. */
  forwardQty: number;
}

export function resolveWarehouseStockCase(
  availableQty: unknown,
  requestedQty: unknown,
): WarehouseStockCase {
  const available = nonNegativeQty(availableQty);
  const requested = nonNegativeQty(requestedQty);
  if (requested <= 0) {
    return available > 0 ? "full" : "none";
  }
  if (available + 1e-9 >= requested) return "full";
  if (available <= 0) return "none";
  return "partial";
}

export function resolveLineActionPlan(
  availableQty: unknown,
  requestedQty: unknown,
  policy: PartialIssuePolicy = WAREHOUSE_POLICY.partialIssuePolicy,
): LineActionPlan {
  const available = nonNegativeQty(availableQty);
  const requested = nonNegativeQty(requestedQty);
  const shortageQty = Math.max(0, requested - available);
  const stockCase = resolveWarehouseStockCase(available, requested);

  if (stockCase === "full") {
    return {
      stockCase,
      availableQty: available,
      requestedQty: requested,
      shortageQty: 0,
      defaultAction: "issue",
      allowedActions: ["issue"],
      issueQty: requested,
      forwardQty: 0,
    };
  }

  if (stockCase === "none") {
    return {
      stockCase,
      availableQty: 0,
      requestedQty: requested,
      shortageQty: requested,
      defaultAction: "forward",
      allowedActions: ["forward"],
      issueQty: 0,
      forwardQty: requested,
    };
  }

  // CASE 3 — partial stock
  if (policy === "forward_entire") {
    return {
      stockCase,
      availableQty: available,
      requestedQty: requested,
      shortageQty,
      defaultAction: "forward",
      allowedActions: ["forward"],
      issueQty: 0,
      forwardQty: requested,
    };
  }

  // Option A (default): issue available, forward remaining; allow full forward.
  return {
    stockCase,
    availableQty: available,
    requestedQty: requested,
    shortageQty,
    defaultAction: "issue_partial",
    allowedActions: ["issue_partial", "forward"],
    issueQty: available,
    forwardQty: shortageQty,
  };
}

export function isIssueAction(action: WarehouseLineAction): boolean {
  return action === "issue" || action === "issue_partial";
}

export function computeIssueAndForwardQty(
  availableQty: unknown,
  requestedQty: unknown,
  action: WarehouseLineAction,
): { issueQty: number; forwardQty: number } {
  const available = nonNegativeQty(availableQty);
  const requested = nonNegativeQty(requestedQty);

  if (action === "forward") {
    return { issueQty: 0, forwardQty: requested };
  }
  if (action === "issue") {
    // Full issue only when stock covers demand.
    if (available + 1e-9 < requested || available <= 0) {
      return { issueQty: 0, forwardQty: requested };
    }
    return { issueQty: requested, forwardQty: 0 };
  }
  // issue_partial
  const issueQty = Math.min(available, requested);
  if (issueQty <= 0) {
    return { issueQty: 0, forwardQty: requested };
  }
  return {
    issueQty,
    forwardQty: Math.max(0, requested - issueQty),
  };
}

/**
 * Validate a selected action against live availability.
 * Returns an error message, or null when valid.
 */
export function validateWarehouseLineAction(
  availableQty: unknown,
  requestedQty: unknown,
  action: WarehouseLineAction,
  policy: PartialIssuePolicy = WAREHOUSE_POLICY.partialIssuePolicy,
): string | null {
  const available = nonNegativeQty(availableQty);
  const plan = resolveLineActionPlan(availableQty, requestedQty, policy);

  if (!plan.allowedActions.includes(action)) {
    if (action === "issue" || action === "issue_partial") {
      if (available <= 0) {
        return "Cannot issue material when Available Qty is 0. Forward this request to Procurement.";
      }
      if (plan.stockCase === "partial" && policy === "forward_entire") {
        return "Company policy does not allow partial issue. Forward the entire request to Procurement.";
      }
      if (plan.stockCase === "partial" && action === "issue") {
        return "Full issue is not available for this line. Use Issue Partial Stock or Forward to Procurement.";
      }
    }
    return "Selected warehouse action is not allowed for the current stock level.";
  }

  if (isIssueAction(action) && available <= 0) {
    return "Cannot issue material when Available Qty is 0. Forward this request to Procurement.";
  }

  const { issueQty } = computeIssueAndForwardQty(
    availableQty,
    requestedQty,
    action,
  );
  if (isIssueAction(action) && issueQty <= 0) {
    return "Cannot issue material when Available Qty is 0. Forward this request to Procurement.";
  }
  if (issueQty > available + 1e-9) {
    return `Issue Qty (${issueQty}) cannot exceed Available Qty (${available}).`;
  }

  return null;
}

/** Backend guard used by issue APIs — never issue when available <= 0. */
export function assertCanIssueQuantity(
  itemCode: string,
  availableQty: unknown,
  issueQty: unknown,
): void {
  const available = nonNegativeQty(availableQty);
  const issue = nonNegativeQty(issueQty);
  if (issue <= 0) return;
  if (available <= 0) {
    throw new Error(
      `Cannot issue ${itemCode || "item"}: Available Qty is 0. Forward this request to Procurement.`,
    );
  }
  if (issue > available + 1e-9) {
    throw new Error(
      `Cannot issue ${itemCode || "item"}: Issue Qty (${issue}) exceeds Available Qty (${available}).`,
    );
  }
}

export function warehouseActionLabel(action: WarehouseLineAction): string {
  switch (action) {
    case "issue":
      return "Issue Material";
    case "issue_partial":
      return "Issue Partial Stock";
    case "forward":
      return "Forward to Procurement";
  }
}

export function buildWarehouseReviewAuditLines(
  lines: Array<{
    item_code: string;
    available_qty: number;
    requested_qty: number;
    action: WarehouseLineAction;
    uom?: string;
  }>,
): string[] {
  return lines.map((line) => {
    const uom = line.uom || "Nos";
    const { issueQty, forwardQty } = computeIssueAndForwardQty(
      line.available_qty,
      line.requested_qty,
      line.action,
    );
    if (line.action === "forward" && line.available_qty <= 0) {
      return (
        `Warehouse reviewed request. Item ${line.item_code}: ` +
        `Available Qty = 0. Forwarded to Procurement.`
      );
    }
    if (line.action === "forward") {
      return (
        `Warehouse reviewed request. Item ${line.item_code}: ` +
        `Forwarded entire request (${line.requested_qty} ${uom}) to Procurement.`
      );
    }
    if (forwardQty > 0) {
      return (
        `Warehouse reviewed request. Item ${line.item_code}: ` +
        `Issued ${issueQty} ${uom}. Forwarded remaining ${forwardQty} ${uom}.`
      );
    }
    return (
      `Warehouse reviewed request. Item ${line.item_code}: ` +
      `Issued ${issueQty} ${uom}.`
    );
  });
}
