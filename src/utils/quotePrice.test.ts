import { describe, expect, it } from "vitest";

import {
  calculateQuoteLineTotal,
  formatQuoteTotal,
  getSupplierQuoteTotal,
  resolveQuotePrice,
} from "./quotePrice";

describe("quote price resolution & canonical getSupplierQuoteTotal", () => {
  it("keeps a valid submitted amount from header", () => {
    expect(getSupplierQuoteTotal({ grand_total: 12_500 })).toBe(12_500);
    expect(resolveQuotePrice({ grand_total: 12_500 })).toEqual({
      amount: 12_500,
      status: "submitted",
    });
    expect(formatQuoteTotal(12_500, "submitted")).toMatch(/12,500\.00/);
  });

  it("distinguishes no quotation from zero", () => {
    expect(getSupplierQuoteTotal(undefined)).toBeNull();
    expect(resolveQuotePrice(undefined)).toEqual({
      amount: null,
      status: "not_submitted",
    });
    expect(formatQuoteTotal(null, "not_submitted")).toBe("Not Submitted");
  });

  it("keeps an incomplete quotation price missing without turning it to $0.00", () => {
    const quote = {
      grand_total: "",
      items: [{ rate: "", amount: null, qty: 2 }],
    };
    expect(getSupplierQuoteTotal(quote)).toBeNull();
    const price = resolveQuotePrice(quote);
    expect(price).toEqual({
      amount: null,
      status: "price_not_provided",
    });
    expect(formatQuoteTotal(price.amount, price.status)).toBe(
      "Amount unavailable",
    );
  });

  it("preserves an explicitly submitted zero-value quote when lines are priced at 0", () => {
    const price = resolveQuotePrice({
      grand_total: 0,
      items: [{ rate: 0, amount: 0, qty: 1 }],
    });
    expect(price).toEqual({ amount: 0, status: "submitted" });
    expect(formatQuoteTotal(price.amount, price.status)).toMatch(/0\.00/);
  });

  it("does not trust an automatic zero header when line pricing is absent", () => {
    expect(
      resolveQuotePrice({
        grand_total: 0,
        items: [{ rate: undefined, amount: null, qty: 1 }],
      }),
    ).toEqual({ amount: null, status: "price_not_provided" });
  });

  it("calculates Blue Ridge quote correctly from line items when header is 0/missing", () => {
    const blueRidgeQuote = {
      supplier: "Blue Ridge Manufacturing Inc",
      grand_total: 0,
      items: [
        {
          item_code: "BR-PART-01",
          item_name: "Machined Part",
          qty: 1,
          unit_price: 7500,
        },
      ],
    };
    expect(getSupplierQuoteTotal(blueRidgeQuote)).toBe(7500);
    const resolved = resolveQuotePrice(blueRidgeQuote);
    expect(resolved.amount).toBe(7500);
    expect(resolved.status).toBe("submitted");
    expect(formatQuoteTotal(resolved.amount, resolved.status)).toBe("$7,500.00");
  });

  it("calculates multi-item quotes (lineTotal = qty × unitPrice + taxes - discounts)", () => {
    const quote = {
      supplier: "Atlantic Precision Manufacturing",
      items: [
        { item_code: "ITEM-A", qty: 2, unit_price: 3000 },
        { item_code: "ITEM-B", qty: 4, rate: 1000 },
      ],
      taxes_and_charges_added: 500,
      discount_amount: 200,
    };
    // 2*3000 + 4*1000 = 10000 + 500 - 200 = 10300
    expect(getSupplierQuoteTotal(quote)).toBe(10300);
  });

  it("calculates individual line item totals via calculateQuoteLineTotal", () => {
    expect(calculateQuoteLineTotal({ qty: 5, unit_price: 150 })).toBe(750);
    expect(calculateQuoteLineTotal({ qty: 10, rate: 25 })).toBe(250);
    expect(calculateQuoteLineTotal({ amount: 1200 })).toBe(1200);
    expect(calculateQuoteLineTotal({ qty: 5, unit_price: 0 })).toBe(0);
    expect(calculateQuoteLineTotal({ qty: 5 })).toBeNull();
  });
});
