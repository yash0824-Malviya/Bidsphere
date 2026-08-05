import { describe, expect, it } from "vitest";

import {
  buildWarehouseReviewSummary,
  cleanWarehouseProseForDisplay,
  stripAllBidSphereMetadata,
} from "./warehouseReviewSummary";

describe("cleanWarehouseProseForDisplay", () => {
  it("removes BidSphere Forwarded audit tag and JSON payloads", () => {
    const raw = [
      "Purchase MR for shortfall: MAT-MR-2026-00068",
      "[BidSphere:Forwarded:Warehouse Manager|2026-07-28 11:18:24]",
      '[BidSphere:ForwardedItems:[{"item_code":"OF001","item_name":"Engine Oil Filter","requested_qty":45,"available_qty":0,"forward_qty":45,"uom":"Nos"}]]',
      "Created from Warehouse Review for Material Request MAT-MR-2026-00067.",
    ].join("\n");

    const cleaned = cleanWarehouseProseForDisplay(raw);
    expect(cleaned).toContain("Purchase MR for shortfall: MAT-MR-2026-00068");
    expect(cleaned).toContain(
      "Created from Warehouse Review for Material Request MAT-MR-2026-00067.",
    );
    expect(cleaned).not.toMatch(/BidSphere/i);
    expect(cleaned).not.toMatch(/ForwardedItems/i);
    expect(cleaned).not.toMatch(/item_code/i);
  });
});

describe("stripAllBidSphereMetadata", () => {
  it("removes StockDecisions nested JSON without leaving fragments", () => {
    const raw = [
      "Insufficient inventory available.",
      '[BidSphere:StockDecisions:[{"item_code":"OF001","recommended_action":"forward","selected_action":"forward","selected_by":"Warehouse Manager","selected_at":"2026-07-28T10:00:00.000Z"}]]',
    ].join("\n");
    expect(stripAllBidSphereMetadata(raw)).toBe(
      "Insufficient inventory available.",
    );
  });
});

describe("buildWarehouseReviewSummary", () => {
  it("parses forwarded items into a decision summary without exposing metadata", () => {
    const raw = [
      "Purchase MR for shortfall: MAT-MR-2026-00068",
      "Created from Warehouse Review for Material Request MAT-MR-2026-00067.",
      "[BidSphere:Forwarded:Jane Warehouse|2026-07-28 11:18:24]",
      '[BidSphere:ForwardedItems:[{"item_code":"OF001","item_name":"Engine Oil Filter","requested_qty":45,"available_qty":0,"forward_qty":45,"uom":"Nos","warehouse":"Stores - NSGAI"}]]',
      '[BidSphere:StockDecisions:[{"item_code":"OF001","recommended_action":"forward","selected_action":"forward","selected_by":"Jane Warehouse","selected_at":"2026-07-28T06:30:00.000Z"}]]',
    ].join("\n");

    const summary = buildWarehouseReviewSummary(raw, {
      forwarded_by: "Jane Warehouse",
      forwarded_on: "2026-07-28 11:18:24",
    });

    expect(summary.hasContent).toBe(true);
    expect(summary.reviewer_name).toBe("Jane Warehouse");
    expect(summary.review_date).toMatch(/28-Jul-2026/i);
    expect(summary.items_forwarded).toHaveLength(1);
    expect(summary.items_forwarded[0]).toMatchObject({
      name: "Engine Oil Filter",
      qty: 45,
      uom: "Nos",
    });
    expect(summary.reason).toBe("Insufficient inventory available.");
    expect(summary.action).toBe("Forwarded to Procurement.");
    expect(summary.warehouse_notes).toContain(
      "Purchase MR for shortfall: MAT-MR-2026-00068",
    );
    expect(summary.warehouse_notes).not.toMatch(/BidSphere/i);
  });
});
