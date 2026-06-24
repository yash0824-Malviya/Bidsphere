import { describe, expect, it } from "vitest";

import {
  assertERPNextDate,
  compareERPNextDates,
  ERP_NEXT_ISO_DATE_RE,
  formatERPNextDate,
  formatUsDisplayDate,
  isERPNextDateBefore,
  parseERPNextDateInput,
  parseUsDisplayDate,
  resolveGrnPostingDate,
  resolvePoHeaderScheduleDate,
  resolvePoItemScheduleDate,
  resolvePoTransactionDate,
} from "./erpNextDate";

describe("formatERPNextDate", () => {
  it("normalizes US display MM/DD/YYYY to YYYY-MM-DD", () => {
    expect(formatERPNextDate("06/13/2026")).toBe("2026-06-13");
    expect(formatERPNextDate("06/11/2026")).toBe("2026-06-11");
  });

  it("normalizes dashed DD-MM-YYYY to YYYY-MM-DD", () => {
    expect(formatERPNextDate("11-06-2026")).toBe("2026-06-11");
    expect(formatERPNextDate("19-06-2026")).toBe("2026-06-19");
  });

  it("normalizes dashed MM-DD-YYYY to YYYY-MM-DD", () => {
    expect(formatERPNextDate("06-11-2026")).toBe("2026-06-11");
    expect(formatERPNextDate("06-19-2026")).toBe("2026-06-19");
  });

  it("passes through YYYY-MM-DD", () => {
    expect(formatERPNextDate("2026-06-11")).toBe("2026-06-11");
    expect(formatERPNextDate("2026-06-19")).toBe("2026-06-19");
  });

  it("never returns non-ISO formats", () => {
    for (const input of [
      "06/13/2026",
      "06/11/2026",
      "11-06-2026",
      "19-06-2026",
      "06-11-2026",
      "2026-06-11",
      "2026-06-19",
    ]) {
      const out = formatERPNextDate(input);
      expect(out).toMatch(ERP_NEXT_ISO_DATE_RE);
    }
  });

  it("returns null for unsupported formats", () => {
    expect(formatERPNextDate("not-a-date")).toBeNull();
    expect(formatERPNextDate("06-06-2026")).toBeNull();
  });
});

describe("formatUsDisplayDate", () => {
  it("formats ISO to MM/DD/YYYY", () => {
    expect(formatUsDisplayDate("2026-06-13")).toBe("06/13/2026");
    expect(formatUsDisplayDate("2026-06-11")).toBe("06/11/2026");
  });
});

describe("parseUsDisplayDate", () => {
  it("parses MM/DD/YYYY to ISO", () => {
    expect(parseUsDisplayDate("06/13/2026")).toBe("2026-06-13");
    expect(parseUsDisplayDate("06/11/2026")).toBe("2026-06-11");
  });
});

describe("assertERPNextDate", () => {
  it("returns ISO string for valid input", () => {
    expect(assertERPNextDate("06/19/2026", "posting_date")).toBe("2026-06-19");
  });

  it("throws for invalid input", () => {
    expect(() => assertERPNextDate("not-a-date", "posting_date")).toThrow();
  });
});

describe("parseERPNextDateInput", () => {
  it("parses ISO and US strings into comparable dates", () => {
    const iso = parseERPNextDateInput("2026-06-19");
    const us = parseERPNextDateInput("06/19/2026");
    expect(iso?.valueOf()).toBe(us?.valueOf());
  });
});

describe("compareERPNextDates", () => {
  it("compares calendar dates correctly", () => {
    expect(compareERPNextDates("2026-06-19", "2026-06-11")).toBeGreaterThan(0);
    expect(compareERPNextDates("06/11/2026", "2026-06-11")).toBe(0);
    expect(isERPNextDateBefore("06/10/2026", "06/11/2026")).toBe(true);
    expect(isERPNextDateBefore("2026-06-19", "2026-06-11")).toBe(false);
  });
});

describe("resolveGrnPostingDate", () => {
  it("uses PO date when today is earlier", () => {
    expect(resolveGrnPostingDate("2026-06-19", "2026-06-11")).toBe("2026-06-19");
    expect(resolveGrnPostingDate("06/11/2026", "06/10/2026")).toBe("2026-06-11");
  });

  it("uses today when today is on or after PO date", () => {
    expect(resolveGrnPostingDate("2026-06-11", "2026-06-19")).toBe("2026-06-19");
    expect(resolveGrnPostingDate("06/11/2026", "2026-06-19")).toBe("2026-06-19");
  });
});

describe("resolvePoItemScheduleDate", () => {
  it("uses RFQ item schedule when on or after PO transaction date", () => {
    expect(
      resolvePoItemScheduleDate("2026-07-15", "2026-06-10")
    ).toBe("2026-07-15");
  });

  it("falls back to PO transaction date when item schedule is earlier", () => {
    expect(
      resolvePoItemScheduleDate("2026-06-01", "2026-06-10")
    ).toBe("2026-06-10");
  });

  it("normalizes US display RFQ schedule before comparing", () => {
    expect(
      resolvePoItemScheduleDate("07/15/2026", "2026-06-10")
    ).toBe("2026-07-15");
  });
});

describe("resolvePoHeaderScheduleDate", () => {
  it("returns latest item schedule date", () => {
    expect(
      resolvePoHeaderScheduleDate(
        ["2026-06-10", "2026-07-15", "2026-06-20"],
        "2026-06-10"
      )
    ).toBe("2026-07-15");
  });
});

describe("resolvePoTransactionDate", () => {
  it("returns YYYY-MM-DD", () => {
    expect(resolvePoTransactionDate()).toMatch(ERP_NEXT_ISO_DATE_RE);
  });
});
