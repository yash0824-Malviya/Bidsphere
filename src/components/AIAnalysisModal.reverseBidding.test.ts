import { describe, expect, it } from "vitest";
import {
  getReverseBiddingHelperText,
  REVERSE_BIDDING_MAX_SUPPLIERS,
  REVERSE_BIDDING_MIN_SUPPLIERS,
} from "./AIAnalysisModal";

describe("Reverse Bidding Supplier Selection Rules", () => {
  it("defines correct min and max supplier limits (2 to 5)", () => {
    expect(REVERSE_BIDDING_MIN_SUPPLIERS).toBe(2);
    expect(REVERSE_BIDDING_MAX_SUPPLIERS).toBe(5);
  });

  it("returns correct dynamic helper text for 0 selected suppliers", () => {
    expect(getReverseBiddingHelperText(0)).toBe(
      "Select 2–5 suppliers to start reverse bidding."
    );
  });

  it("returns correct dynamic helper text for 1 selected supplier", () => {
    expect(getReverseBiddingHelperText(1)).toBe(
      "Select at least 1 more supplier to start reverse bidding."
    );
  });

  it("returns correct dynamic helper text for 2 selected suppliers", () => {
    expect(getReverseBiddingHelperText(2)).toBe(
      "2 suppliers selected — ready to start reverse bidding."
    );
  });

  it("returns correct dynamic helper text for 3 to 5 selected suppliers", () => {
    expect(getReverseBiddingHelperText(3)).toBe(
      "3 suppliers selected — ready to start reverse bidding."
    );
    expect(getReverseBiddingHelperText(4)).toBe(
      "4 suppliers selected — ready to start reverse bidding."
    );
    expect(getReverseBiddingHelperText(5)).toBe(
      "5 suppliers selected — ready to start reverse bidding."
    );
  });

  it("adapts helper text dynamically when fewer than 5 suppliers are available", () => {
    expect(getReverseBiddingHelperText(0, 2)).toBe(
      "Select 2 suppliers to start reverse bidding."
    );
    expect(getReverseBiddingHelperText(0, 3)).toBe(
      "Select 2–3 suppliers to start reverse bidding."
    );
    expect(getReverseBiddingHelperText(0, 4)).toBe(
      "Select 2–4 suppliers to start reverse bidding."
    );
  });
});
