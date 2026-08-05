import { describe, expect, it } from "vitest";

import {
  formatUnknownErpLabelError,
  matchErpLabel,
} from "./erpLabelMatch";

const CATEGORIES = [
  "Raw Material",
  "Auto Parts",
  "Lubricants",
  "Electrical Materials",
  "Office Supplies",
];

describe("matchErpLabel", () => {
  it("matches case-insensitively and trims spaces", () => {
    expect(matchErpLabel("  raw material  ", CATEGORIES)).toEqual({
      ok: true,
      value: "Raw Material",
      kind: "ci",
    });
    expect(matchErpLabel("RAW MATERIAL", CATEGORIES)).toEqual({
      ok: true,
      value: "Raw Material",
      kind: "ci",
    });
  });

  it("normalizes plural Raw Materials → Raw Material", () => {
    const result = matchErpLabel("Raw Materials", CATEGORIES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("Raw Material");
      expect(result.kind).toBe("normalized");
    }
  });

  it("normalizes Lubricant → Lubricants when unique", () => {
    const result = matchErpLabel("Lubricant", CATEGORIES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("Lubricants");
  });

  it("normalizes Electrical Material → Electrical Materials", () => {
    const result = matchErpLabel("Electrical Material", CATEGORIES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("Electrical Materials");
  });

  it("suggests Did you mean on unknown labels", () => {
    const result = matchErpLabel("Raw Materyal", CATEGORIES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const msg = formatUnknownErpLabelError(
        "Raw Materyal",
        "Procurement Category",
        result,
      );
      expect(msg).toMatch(/Unknown Procurement Category/);
      expect(msg).toMatch(/Raw Material/);
    }
  });
});
