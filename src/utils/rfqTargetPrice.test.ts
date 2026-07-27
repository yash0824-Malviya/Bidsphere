import { describe, expect, it } from "vitest";

import {
  computeTargetPriceVariance,
  getItemTargetPrice,
  isItemTargetPriceVisibleToSupplier,
  isTargetPriceVisibleToSupplier,
  sanitizeRfqForSupplier,
} from "./rfqTargetPrice";
import type { RFQ } from "../types/erpnext";

describe("rfqTargetPrice", () => {
  it("reads visibility flag", () => {
    expect(isTargetPriceVisibleToSupplier({ custom_show_target_price_to_supplier: 1 })).toBe(true);
    expect(isTargetPriceVisibleToSupplier({ custom_show_target_price_to_supplier: 0 })).toBe(false);
    expect(isTargetPriceVisibleToSupplier({})).toBe(false);
  });

  it("treats ERP empty Currency (0) as unset", () => {
    expect(getItemTargetPrice({ custom_target_price: 0 })).toBeNull();
    expect(getItemTargetPrice({ custom_target_price: 58 })).toBe(58);
  });

  it("uses per-item show flag with header fallback", () => {
    expect(
      isItemTargetPriceVisibleToSupplier(
        { custom_show_target_price_to_supplier: 1 },
        { custom_show_target_price_to_supplier: 0 },
      ),
    ).toBe(true);
    expect(
      isItemTargetPriceVisibleToSupplier(
        { custom_show_target_price_to_supplier: 0 },
        { custom_show_target_price_to_supplier: 1 },
      ),
    ).toBe(false);
    expect(
      isItemTargetPriceVisibleToSupplier(
        {},
        { custom_show_target_price_to_supplier: 1 },
      ),
    ).toBe(true);
  });

  it("strips target prices when hidden from suppliers", () => {
    const rfq = {
      name: "RFQ-1",
      custom_show_target_price_to_supplier: 0,
      items: [
        { item_code: "A", qty: 1, custom_target_price: 10, custom_show_target_price_to_supplier: 0 },
        { item_code: "B", qty: 2, custom_target_price: 20, custom_show_target_price_to_supplier: 0 },
      ],
      suppliers: [],
    } as unknown as RFQ;

    const sanitized = sanitizeRfqForSupplier(rfq);
    expect(sanitized.show_target_price).toBe(false);
    expect(sanitized.items.every((i) => i.custom_target_price === undefined)).toBe(true);
  });

  it("keeps only lines flagged visible to suppliers", () => {
    const rfq = {
      name: "RFQ-1",
      custom_show_target_price_to_supplier: 0,
      items: [
        { item_code: "A", qty: 1, custom_target_price: 10, custom_show_target_price_to_supplier: 1 },
        { item_code: "B", qty: 2, custom_target_price: 20, custom_show_target_price_to_supplier: 0 },
      ],
      suppliers: [],
    } as unknown as RFQ;

    const sanitized = sanitizeRfqForSupplier(rfq);
    expect(sanitized.show_target_price).toBe(true);
    expect(getItemTargetPrice(sanitized.items[0]!)).toBe(10);
    expect(sanitized.items[0]!.target_price).toBe(10);
    expect(sanitized.items[1]!.custom_target_price).toBeUndefined();
  });

  it("computes variance and potential savings", () => {
    const quoted = new Map([["A", { unit_price: 8 }], ["B", { unit_price: 25 }]]);
    const result = computeTargetPriceVariance({
      items: [
        { item_code: "A", qty: 10, custom_target_price: 10 },
        { item_code: "B", qty: 2, custom_target_price: 20 },
      ],
      quotedByItem: quoted,
    });
    expect(result.totalPotentialSavings).toBe(20); // (10-8)*10
    expect(result.totalOverTarget).toBe(10); // (25-20)*2
  });
});
