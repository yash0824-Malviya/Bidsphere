import { describe, expect, it } from "vitest";

import {
  assertCanIssueQuantity,
  buildWarehouseReviewAuditLines,
  computeIssueAndForwardQty,
  resolveLineActionPlan,
  resolveWarehouseStockCase,
  validateWarehouseLineAction,
} from "./warehouseStockActionRules";

describe("resolveWarehouseStockCase", () => {
  it("classifies full / none / partial", () => {
    expect(resolveWarehouseStockCase(45, 45)).toBe("full");
    expect(resolveWarehouseStockCase(50, 45)).toBe("full");
    expect(resolveWarehouseStockCase(0, 45)).toBe("none");
    expect(resolveWarehouseStockCase(20, 45)).toBe("partial");
  });
});

describe("resolveLineActionPlan", () => {
  it("CASE 1 — only Issue Material", () => {
    const plan = resolveLineActionPlan(45, 45);
    expect(plan.defaultAction).toBe("issue");
    expect(plan.allowedActions).toEqual(["issue"]);
    expect(plan.issueQty).toBe(45);
    expect(plan.forwardQty).toBe(0);
  });

  it("CASE 2 — only Forward when available is 0", () => {
    const plan = resolveLineActionPlan(0, 45);
    expect(plan.defaultAction).toBe("forward");
    expect(plan.allowedActions).toEqual(["forward"]);
    expect(plan.issueQty).toBe(0);
    expect(plan.forwardQty).toBe(45);
  });

  it("CASE 3 Option A — issue partial + allow forward entire", () => {
    const plan = resolveLineActionPlan(20, 45, "issue_partial_and_forward");
    expect(plan.defaultAction).toBe("issue_partial");
    expect(plan.allowedActions).toEqual(["issue_partial", "forward"]);
    expect(plan.issueQty).toBe(20);
    expect(plan.forwardQty).toBe(25);
  });

  it("CASE 3 Option B — forward entire only", () => {
    const plan = resolveLineActionPlan(20, 45, "forward_entire");
    expect(plan.defaultAction).toBe("forward");
    expect(plan.allowedActions).toEqual(["forward"]);
    expect(plan.issueQty).toBe(0);
    expect(plan.forwardQty).toBe(45);
  });
});

describe("validateWarehouseLineAction", () => {
  it("blocks Issue when available is 0", () => {
    expect(validateWarehouseLineAction(0, 45, "issue")).toMatch(/Available Qty is 0/i);
    expect(validateWarehouseLineAction(0, 45, "issue_partial")).toMatch(
      /Available Qty is 0/i,
    );
    expect(validateWarehouseLineAction(0, 45, "forward")).toBeNull();
  });

  it("blocks full issue on partial stock", () => {
    expect(validateWarehouseLineAction(20, 45, "issue")).toMatch(/not available/i);
    expect(validateWarehouseLineAction(20, 45, "issue_partial")).toBeNull();
  });
});

describe("computeIssueAndForwardQty", () => {
  it("splits partial issue correctly", () => {
    expect(computeIssueAndForwardQty(20, 45, "issue_partial")).toEqual({
      issueQty: 20,
      forwardQty: 25,
    });
  });
});

describe("assertCanIssueQuantity", () => {
  it("throws when issuing with zero availability", () => {
    expect(() => assertCanIssueQuantity("ITEM-1", 0, 10)).toThrow(
      /Available Qty is 0/i,
    );
    expect(() => assertCanIssueQuantity("ITEM-1", 5, 3)).not.toThrow();
  });
});

describe("buildWarehouseReviewAuditLines", () => {
  it("formats zero-stock forward and partial issue audits", () => {
    const lines = buildWarehouseReviewAuditLines([
      {
        item_code: "A",
        available_qty: 0,
        requested_qty: 10,
        action: "forward",
        uom: "Nos",
      },
      {
        item_code: "B",
        available_qty: 20,
        requested_qty: 45,
        action: "issue_partial",
        uom: "Nos",
      },
    ]);
    expect(lines[0]).toMatch(/Available Qty = 0\. Forwarded to Procurement/);
    expect(lines[1]).toMatch(/Issued 20 Nos\. Forwarded remaining 25 Nos/);
  });
});
