import { describe, expect, it } from "vitest";
import {
  formatBidOutbidMessage,
  lowestRateByItemFromRows,
  toBidRate,
  validateItemBidCore,
} from "./reverseBiddingBidValidation";

const sameSupplier = (a?: string, b?: string) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

const fmt = (value: number) => `$${value.toFixed(2)}`;

describe("toBidRate", () => {
  it("coerces ERP string rates", () => {
    expect(toBidRate("100.5")).toBe(100.5);
    expect(toBidRate("999")).toBe(999);
  });
});

describe("lowestRateByItemFromRows", () => {
  it("compares numeric values not strings", () => {
    const map = lowestRateByItemFromRows([
      { item_code: "A", supplier: "S1", current_rate: "1000" },
      { item_code: "A", supplier: "S2", current_rate: "999" },
    ]);
    expect(map.get("A")).toBe(999);
  });
});

describe("formatBidOutbidMessage", () => {
  it("includes submitted and latest amounts", () => {
    const msg = formatBidOutbidMessage(50, 49, fmt);
    expect(msg).toContain("$50.00");
    expect(msg).toContain("$49.00");
    expect(msg).toContain("latest lowest bid");
  });
});

describe("validateItemBidCore", () => {
  const baseItems = [
    { item_code: "ITEM-1", supplier: "Alpha", current_rate: "100" },
    { item_code: "ITEM-1", supplier: "Beta", current_rate: "110" },
  ];

  it("accepts first bid when no lowest exists yet", () => {
    const v = validateItemBidCore({
      derivedAuctionStatus: "Live",
      supplierInvited: true,
      items: [{ item_code: "ITEM-1", supplier: "Alpha", current_rate: 0 }],
      supplier: "Alpha",
      itemCode: "ITEM-1",
      rate: 50,
      minimumDecrement: 5,
      sameSupplier,
      formatAmount: fmt,
    });
    expect(v.ok).toBe(true);
  });

  it("accepts undercut with string lowest rates", () => {
    const v = validateItemBidCore({
      derivedAuctionStatus: "Live",
      supplierInvited: true,
      items: baseItems,
      supplier: "Beta",
      itemCode: "ITEM-1",
      rate: 95,
      minimumDecrement: 5,
      sameSupplier,
      formatAmount: fmt,
    });
    expect(v.ok).toBe(true);
  });

  it("accepts leader improving their own item price", () => {
    const v = validateItemBidCore({
      derivedAuctionStatus: "Live",
      supplierInvited: true,
      items: [
        { item_code: "ITEM-1", supplier: "Alpha", current_rate: 43 },
        { item_code: "ITEM-1", supplier: "Beta", current_rate: 50 },
      ],
      supplier: "Alpha",
      itemCode: "ITEM-1",
      rate: 42,
      minimumDecrement: 1,
      sameSupplier,
      formatAmount: fmt,
    });
    expect(v.ok).toBe(true);
    expect(v.isLeader).toBe(true);
  });

  it("returns detailed outbid message when bid is not below fresh lowest", () => {
    const v = validateItemBidCore({
      derivedAuctionStatus: "Live",
      supplierInvited: true,
      items: [
        { item_code: "ITEM-1", supplier: "Alpha", current_rate: 90 },
        { item_code: "ITEM-1", supplier: "Beta", current_rate: 110 },
      ],
      supplier: "Beta",
      itemCode: "ITEM-1",
      rate: 95,
      minimumDecrement: 0,
      sameSupplier,
      formatAmount: fmt,
    });
    expect(v.ok).toBe(false);
    expect(v.reasonCode).toBe("outbid");
    expect(v.reason).toContain("$95.00");
    expect(v.reason).toContain("$90.00");
  });

  it("rejects when auction is not live", () => {
    const v = validateItemBidCore({
      derivedAuctionStatus: "Completed",
      supplierInvited: true,
      items: baseItems,
      supplier: "Beta",
      itemCode: "ITEM-1",
      rate: 95,
      minimumDecrement: 0,
      sameSupplier,
      formatAmount: fmt,
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("The auction is not live.");
  });
});
