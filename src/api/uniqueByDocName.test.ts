import { describe, expect, it } from "vitest";
import { uniqueByDocName } from "./sourcing";

describe("uniqueByDocName", () => {
  it("keeps one row per RFQ document name", () => {
    const rows = [
      { name: "PUR-RFQ-2026-00070", status: "Submitted" },
      { name: "PUR-RFQ-2026-00070", status: "Submitted" },
      { name: "PUR-RFQ-2026-00071", status: "Draft" },
      { name: "PUR-RFQ-2026-00070", status: "Open" },
    ];
    expect(uniqueByDocName(rows)).toEqual([
      { name: "PUR-RFQ-2026-00070", status: "Submitted" },
      { name: "PUR-RFQ-2026-00071", status: "Draft" },
    ]);
  });

  it("drops rows without a usable name", () => {
    expect(
      uniqueByDocName([
        { name: "  " },
        { name: null },
        { name: "PUR-RFQ-2026-00001" },
      ]),
    ).toEqual([{ name: "PUR-RFQ-2026-00001" }]);
  });
});
