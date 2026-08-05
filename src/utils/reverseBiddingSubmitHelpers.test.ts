import { describe, expect, it } from "vitest";
import {
  bidRateLess,
  formatBidOutbidMessage,
  lowestRateByItemFromRows,
  validateItemBidCore,
} from "./reverseBiddingBidValidation";
import { isRetryableSaveError, isTimestampConflictError } from "./reverseBiddingSubmitHelpers";

const sameSupplier = (a?: string, b?: string) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

const fmt = (value: number) => `$${value.toFixed(2)}`;

describe("isTimestampConflictError", () => {
  it("detects ERP timestamp mismatch messages", () => {
    expect(
      isTimestampConflictError(
        new Error("Document has been modified after you have opened it"),
      ),
    ).toBe(true);
  });

  it("does not treat unrelated modified-field errors as conflicts", () => {
    expect(
      isTimestampConflictError(new Error("Field modified_by is read only")),
    ).toBe(false);
  });
});

describe("isRetryableSaveError", () => {
  it("retries HTTP 409 conflicts", () => {
    const err = new Error("Conflict") as Error & { status: number };
    err.status = 409;
    expect(isRetryableSaveError(err)).toBe(true);
  });

  it("does not retry validation failures", () => {
    expect(isRetryableSaveError(new Error("Mandatory field missing"))).toBe(
      false,
    );
  });
});

describe("concurrent bid validation", () => {
  const items = [
    { item_code: "ITEM-1", supplier: "Alpha", current_rate: 60 },
    { item_code: "ITEM-1", supplier: "Beta", current_rate: 70 },
  ];

  it("accepts a lower bid below the live item lowest", () => {
    const v = validateItemBidCore({
      derivedAuctionStatus: "Live",
      supplierInvited: true,
      items,
      supplier: "Beta",
      itemCode: "ITEM-1",
      rate: 50,
      minimumDecrement: 0,
      sameSupplier,
      formatAmount: fmt,
    });
    expect(v.ok).toBe(true);
  });

  it("rejects after a concurrent supplier undercuts", () => {
    const staleUiLowest = lowestRateByItemFromRows(items).get("ITEM-1");
    expect(staleUiLowest).toBe(60);

    const freshItems = [
      { item_code: "ITEM-1", supplier: "Alpha", current_rate: 45 },
      { item_code: "ITEM-1", supplier: "Beta", current_rate: 70 },
    ];
    const v = validateItemBidCore({
      derivedAuctionStatus: "Live",
      supplierInvited: true,
      items: freshItems,
      supplier: "Beta",
      itemCode: "ITEM-1",
      rate: 50,
      minimumDecrement: 0,
      sameSupplier,
      formatAmount: fmt,
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe(formatBidOutbidMessage(50, 45, fmt));
    expect(bidRateLess(50, staleUiLowest!)).toBe(true);
  });
});
