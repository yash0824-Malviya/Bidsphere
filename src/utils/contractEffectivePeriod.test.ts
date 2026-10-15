import { describe, expect, it } from "vitest";
import {
  evaluateContractEffectivePeriod,
  getBusinessToday,
  getContractEffectiveDates,
  isValidIsoDate,
  DEFAULT_BUSINESS_TIMEZONE,
} from "./contractEffectivePeriod";

describe("contractEffectivePeriod utility", () => {
  describe("isValidIsoDate", () => {
    it("accepts valid ISO calendar dates", () => {
      expect(isValidIsoDate("2026-10-15")).toBe(true);
      expect(isValidIsoDate("2026-02-28")).toBe(true);
      expect(isValidIsoDate("2024-02-29")).toBe(true); // leap year
    });

    it("rejects non-string or malformed date inputs", () => {
      expect(isValidIsoDate(null)).toBe(false);
      expect(isValidIsoDate(undefined)).toBe(false);
      expect(isValidIsoDate("")).toBe(false);
      expect(isValidIsoDate("15-10-2026")).toBe(false);
      expect(isValidIsoDate("2026/10/15")).toBe(false);
      expect(isValidIsoDate("invalid-date")).toBe(false);
    });

    it("rejects non-existent calendar dates", () => {
      expect(isValidIsoDate("2026-02-29")).toBe(false); // 2026 is not a leap year
      expect(isValidIsoDate("2026-04-31")).toBe(false); // April has 30 days
      expect(isValidIsoDate("2026-13-01")).toBe(false); // invalid month
      expect(isValidIsoDate("2026-00-10")).toBe(false);
    });
  });

  describe("getBusinessToday", () => {
    it("formats today as YYYY-MM-DD in Asia/Kolkata timezone", () => {
      const fixedDate = new Date("2026-10-13T17:00:00+05:30");
      expect(getBusinessToday(fixedDate, DEFAULT_BUSINESS_TIMEZONE)).toBe("2026-10-13");
    });

    it("does not shift calendar date across midnight in Asia/Kolkata", () => {
      // 2026-10-13 23:30 IST is 18:00 UTC on 2026-10-13
      const lateIst = new Date("2026-10-13T18:00:00.000Z");
      expect(getBusinessToday(lateIst, "Asia/Kolkata")).toBe("2026-10-13");

      // 2026-10-14 00:30 IST is 19:00 UTC on 2026-10-13
      const earlyMorningIst = new Date("2026-10-13T19:00:00.000Z");
      expect(getBusinessToday(earlyMorningIst, "Asia/Kolkata")).toBe("2026-10-14");
    });
  });

  describe("getContractEffectiveDates", () => {
    it("extracts start_date and end_date", () => {
      const dates = getContractEffectiveDates({
        start_date: "2026-10-15",
        end_date: "2027-10-14",
      });
      expect(dates).toEqual({ startDate: "2026-10-15", endDate: "2027-10-14" });
    });

    it("falls back to contract_start_date and contract_end_date", () => {
      const dates = getContractEffectiveDates({
        contract_start_date: "2026-10-01",
        contract_end_date: "2027-09-30",
      });
      expect(dates).toEqual({ startDate: "2026-10-01", endDate: "2027-09-30" });
    });
  });

  describe("evaluateContractEffectivePeriod", () => {
    const contract = {
      name: "CON-2026-00004",
      start_date: "2026-10-15",
      end_date: "2027-10-14",
    };

    // Scenario 1: Current date before effective start date
    it("rejects when current business date is before effective start date with permitted date", () => {
      const result = evaluateContractEffectivePeriod(contract, "2026-10-13");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("future_start_date");
      expect(result.permittedActivationDate).toBe("2026-10-15");
      expect(result.message).toContain("effective period");
      expect(result.message).toContain("2026-10-15");
      expect(result.message).toContain("2026-10-13");
    });

    // Scenario 2: Current date equal to effective start date (start boundary)
    it("allows activation when current date is equal to effective start date", () => {
      const result = evaluateContractEffectivePeriod(contract, "2026-10-15");
      expect(result.valid).toBe(true);
      expect(result.startDate).toBe("2026-10-15");
      expect(result.endDate).toBe("2027-10-14");
    });

    // Scenario 3: Current date within effective period
    it("allows activation when current date is within the effective period", () => {
      const result = evaluateContractEffectivePeriod(contract, "2026-11-01");
      expect(result.valid).toBe(true);
    });

    // Scenario 4: Current date equal to effective end date (end boundary)
    it("allows activation when current date is equal to effective end date", () => {
      const result = evaluateContractEffectivePeriod(contract, "2027-10-14");
      expect(result.valid).toBe(true);
    });

    // Scenario 5: Current date after effective end date (expired)
    it("rejects when current date is after effective end date", () => {
      const result = evaluateContractEffectivePeriod(contract, "2027-10-15");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("contract_expired");
      expect(result.message).toContain("effective period");
      expect(result.message).toContain("ended on 2027-10-14");
    });

    // Scenario 6: Missing and invalid effective dates
    it("rejects when start_date is missing", () => {
      const result = evaluateContractEffectivePeriod({ end_date: "2027-10-14" }, "2026-10-15");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("missing_start_date");
      expect(result.message).toBe("Contract Start Date is required before activation.");
    });

    it("rejects when end_date is missing", () => {
      const result = evaluateContractEffectivePeriod({ start_date: "2026-10-15" }, "2026-10-15");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("missing_end_date");
      expect(result.message).toBe("Contract End Date is required before activation.");
    });

    it("rejects when start_date is invalid", () => {
      const result = evaluateContractEffectivePeriod(
        { start_date: "2026-02-30", end_date: "2027-10-14" },
        "2026-02-28",
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid_start_date");
      expect(result.message).toContain("is not a valid calendar date");
    });

    it("rejects when end_date is invalid", () => {
      const result = evaluateContractEffectivePeriod(
        { start_date: "2026-10-15", end_date: "2027-13-01" },
        "2026-10-15",
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid_end_date");
      expect(result.message).toContain("is not a valid calendar date");
    });

    it("rejects when end_date is before start_date", () => {
      const result = evaluateContractEffectivePeriod(
        { start_date: "2027-10-15", end_date: "2026-10-14" },
        "2026-10-15",
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("end_before_start");
      expect(result.message).toContain("cannot be before Contract Start Date");
    });

    // Scenario 7: Timezone and date-boundary handling
    it("handles boundary dates cleanly without timezone shift", () => {
      // Exactly at start boundary
      expect(evaluateContractEffectivePeriod(contract, "2026-10-15").valid).toBe(true);
      // One day before start boundary
      expect(evaluateContractEffectivePeriod(contract, "2026-10-14").valid).toBe(false);
      // Exactly at end boundary
      expect(evaluateContractEffectivePeriod(contract, "2027-10-14").valid).toBe(true);
      // One day after end boundary
      expect(evaluateContractEffectivePeriod(contract, "2027-10-15").valid).toBe(false);
    });
  });
});
