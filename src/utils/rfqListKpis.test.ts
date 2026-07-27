import { describe, expect, it, vi } from "vitest";

import {
  aggregateRfqKpiBuckets,
  checkRfqKpiConsistency,
  computeRfqListKpis,
  enterpriseStatusToKpiBucket,
  warnIfRfqKpisInconsistent,
} from "./rfqListKpis";

describe("enterpriseStatusToKpiBucket", () => {
  it("maps statuses into mutually exclusive buckets", () => {
    expect(enterpriseStatusToKpiBucket("Awaiting Supplier Response")).toBe(
      "awaiting",
    );
    expect(enterpriseStatusToKpiBucket("Draft")).toBe("draftOpen");
    expect(enterpriseStatusToKpiBucket("Open")).toBe("draftOpen");
    expect(enterpriseStatusToKpiBucket("Purchase Order Created")).toBe(
      "poCreated",
    );
    expect(enterpriseStatusToKpiBucket("Completed")).toBe("poCreated");
    expect(enterpriseStatusToKpiBucket("Closed")).toBe("closed");
    expect(enterpriseStatusToKpiBucket("Cancelled")).toBe("closed");
  });
});

describe("computeRfqListKpis", () => {
  it("uses the same PO + quote signals as the list table", () => {
    const rows = [
      { name: "RFQ-1", status: "Submitted" },
      { name: "RFQ-2", status: "Submitted" },
      { name: "RFQ-3", status: "Draft" },
      { name: "RFQ-4", status: "Submitted" },
      { name: "RFQ-5", status: "Closed" },
      { name: "RFQ-6", status: "Cancelled" },
      { name: "RFQ-7", status: "Ordered" },
    ];
    const quotes = new Map<string, number>([
      ["RFQ-1", 0],
      ["RFQ-2", 3],
      ["RFQ-3", 0],
      ["RFQ-4", 1],
      ["RFQ-5", 2],
      ["RFQ-6", 0],
      ["RFQ-7", 2],
    ]);
    // RFQ-4 has a linked PO even though ERP status is still Submitted
    const poSet = new Set(["RFQ-4"]);

    const kpis = computeRfqListKpis(rows, quotes, poSet);

    expect(kpis).toEqual({
      total: 7,
      awaiting: 1, // RFQ-1
      draftOpen: 2, // RFQ-2 (Open) + RFQ-3 (Draft)
      poCreated: 2, // RFQ-4 (has PO) + RFQ-7 (Ordered)
      closed: 2, // RFQ-5 + RFQ-6
    });
    expect(checkRfqKpiConsistency(kpis).ok).toBe(true);
  });

  it("is collectively exhaustive for mixed enterprise labels", () => {
    const kpis = aggregateRfqKpiBuckets([
      "Draft",
      "Open",
      "Awaiting Supplier Response",
      "Purchase Order Created",
      "Closed",
      "Cancelled",
      "AI Analysis",
    ]);
    expect(kpis.total).toBe(7);
    expect(
      kpis.awaiting + kpis.draftOpen + kpis.poCreated + kpis.closed,
    ).toBe(7);
    expect(checkRfqKpiConsistency(kpis).ok).toBe(true);
  });
});

describe("warnIfRfqKpisInconsistent", () => {
  it("logs when buckets diverge from total", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = warnIfRfqKpisInconsistent({
      total: 10,
      awaiting: 1,
      draftOpen: 1,
      poCreated: 1,
      closed: 1,
    });
    expect(ok).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
