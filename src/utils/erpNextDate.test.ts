import { describe, expect, it } from "vitest";

import {
  assertERPNextDate,
  compareERPNextDates,
  ERP_NEXT_ISO_DATE_RE,
  formatERPNextDate,
  formatGrnPostingDateMessage,
  formatUsDisplayDate,
  GRN_POSTING_ADJUSTED_TO_PO_MSG,
  isERPNextDateBefore,
  isGrnPostingDateFuture,
  normalizeGrnPostingDate,
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

describe("normalizeGrnPostingDate / resolveGrnPostingDate", () => {
  it("defaults to PO date (not today) when Create GRN opens", () => {
    // PO 30-Jul, today 31-Jul → default GRN 30-Jul
    expect(resolveGrnPostingDate("2026-07-30", "2026-07-31")).toBe("2026-07-30");
    // Never initialize to today when PO is later
    expect(resolveGrnPostingDate("2026-07-31", "2026-07-30")).toBe("2026-07-31");
  });

  it("PO 30-Jul → GRN 30-Jul allow; PO 30-Jul → GRN 31-Jul allow", () => {
    const erpToday = "2026-07-31";
    expect(
      normalizeGrnPostingDate({
        selected: "2026-07-30",
        poDate: "2026-07-30",
        erpToday,
      }).postingDate,
    ).toBe("2026-07-30");
    expect(
      normalizeGrnPostingDate({
        selected: "2026-07-31",
        poDate: "2026-07-30",
        erpToday,
      }).postingDate,
    ).toBe("2026-07-31");
  });

  it("PO 31-Jul → GRN 30-Jul blocked (raised to PO)", () => {
    const blocked = normalizeGrnPostingDate({
      selected: "2026-07-30",
      poDate: "2026-07-31",
      erpToday: "2026-07-31",
    });
    expect(blocked.postingDate).toBe("2026-07-31");
    expect(blocked.clampedToPoDate).toBe(true);
    expect(
      formatGrnPostingDateMessage("adjusted_to_po", {
        poDate: "2026-07-31",
        selectedDate: "2026-07-30",
      }),
    ).toContain(GRN_POSTING_ADJUSTED_TO_PO_MSG);
    expect(
      formatGrnPostingDateMessage("adjusted_to_po", {
        poDate: "2026-07-31",
        selectedDate: "2026-07-30",
      }),
    ).toContain("Purchase Order Date: 2026-07-31");
    expect(
      formatGrnPostingDateMessage("adjusted_to_po", {
        poDate: "2026-07-31",
        selectedDate: "2026-07-30",
      }),
    ).toContain("Selected GRN Date: 2026-07-30");
  });

  it("future GRN is blocked (clamped to today)", () => {
    const future = normalizeGrnPostingDate({
      selected: "2026-08-01",
      poDate: "2026-07-30",
      erpToday: "2026-07-31",
    });
    expect(future.postingDate).toBe("2026-07-31");
    expect(future.wouldBeFuture).toBe(true);
    expect(future.clampedToErpToday).toBe(true);
  });

  it("never exceeds ERP today when browser today is ahead (TZ skew)", () => {
    const resolved = normalizeGrnPostingDate({
      selected: "2026-07-31",
      poDate: "2026-07-20",
      erpToday: "2026-07-30",
      browserToday: "2026-07-31",
    });
    expect(resolved.postingDate).toBe("2026-07-30");
    expect(resolved.clampedToErpToday).toBe(true);
  });

  it("marks invalid window when PO is after today", () => {
    const win = normalizeGrnPostingDate({
      selected: null,
      poDate: "2026-07-31",
      erpToday: "2026-07-30",
    });
    expect(win.postingDate).toBe("2026-07-31");
    expect(win.invalidWindow).toBe(true);
  });

  it("isGrnPostingDateFuture compares YYYY-MM-DD only", () => {
    expect(isGrnPostingDateFuture("2026-07-31", "2026-07-31")).toBe(false);
    expect(isGrnPostingDateFuture("2026-07-30", "2026-07-31")).toBe(false);
    expect(isGrnPostingDateFuture("2026-08-01", "2026-07-31")).toBe(true);
    expect(
      isGrnPostingDateFuture("2026-07-31T23:59:59.000Z", "2026-07-31"),
    ).toBe(false);
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
