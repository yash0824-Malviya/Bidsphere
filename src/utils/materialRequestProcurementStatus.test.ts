import { describe, expect, it } from "vitest";
import {
  differenceInCalendarDays,
  isMrOverdue,
  isReceivedToday,
  resolveProcurementMrDisplayStatus,
} from "./materialRequestProcurementStatus";

describe("materialRequestProcurementStatus", () => {
  describe("isReceivedToday", () => {
    it("returns true for timestamps from today", () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const todayYMD = `${year}-${month}-${day}`;

      expect(isReceivedToday(now.toISOString())).toBe(true);
      expect(isReceivedToday(todayYMD)).toBe(true);
      expect(isReceivedToday(`${todayYMD} 10:30:00`)).toBe(true);
    });

    it("returns false for past or invalid dates", () => {
      expect(isReceivedToday("2020-01-01")).toBe(false);
      expect(isReceivedToday(null)).toBe(false);
      expect(isReceivedToday("—")).toBe(false);
      expect(isReceivedToday("invalid-date")).toBe(false);
    });
  });

  describe("differenceInCalendarDays", () => {
    it("calculates exact calendar day differences", () => {
      const today = new Date(2026, 7, 31); // 2026-08-31
      expect(differenceInCalendarDays(today, new Date(2026, 7, 31))).toBe(0);
      expect(differenceInCalendarDays(today, new Date(2026, 7, 30))).toBe(1);
      expect(differenceInCalendarDays(today, new Date(2026, 7, 25))).toBe(6);
      expect(differenceInCalendarDays(today, new Date(2026, 7, 24))).toBe(7);
      expect(differenceInCalendarDays(today, new Date(2026, 7, 20))).toBe(11);
      expect(differenceInCalendarDays(today, new Date(2026, 8, 5))).toBe(-5);
    });
  });

  describe("isMrOverdue — 7-Day Business Rule", () => {
    const today = new Date(2026, 7, 31); // 2026-08-31

    it("returns NOT OVERDUE for Required Date = Today (08/31/2026, 0 days past)", () => {
      expect(isMrOverdue("2026-08-31", "Forwarded to Procurement", false, today)).toBe(false);
    });

    it("returns NOT OVERDUE for Required Date = Yesterday (08/30/2026, 1 day past)", () => {
      expect(isMrOverdue("2026-08-30", "Forwarded to Procurement", false, today)).toBe(false);
    });

    it("returns NOT OVERDUE for Required Date = 2 days ago (08/29/2026)", () => {
      expect(isMrOverdue("2026-08-29", "Forwarded to Procurement", false, today)).toBe(false);
    });

    it("returns NOT OVERDUE for Required Date = 3 days ago (08/28/2026)", () => {
      expect(isMrOverdue("2026-08-28", "Forwarded to Procurement", false, today)).toBe(false);
    });

    it("returns NOT OVERDUE for Required Date = 4 days ago (08/27/2026)", () => {
      expect(isMrOverdue("2026-08-27", "Forwarded to Procurement", false, today)).toBe(false);
    });

    it("returns NOT OVERDUE for Required Date = 5 days ago (08/26/2026)", () => {
      expect(isMrOverdue("2026-08-26", "Forwarded to Procurement", false, today)).toBe(false);
    });

    it("returns NOT OVERDUE for Required Date = 6 days ago (08/25/2026)", () => {
      expect(isMrOverdue("2026-08-25", "Forwarded to Procurement", false, today)).toBe(false);
    });

    it("returns OVERDUE for Required Date = exactly 7 days ago (08/24/2026)", () => {
      expect(isMrOverdue("2026-08-24", "Forwarded to Procurement", false, today)).toBe(true);
    });

    it("returns OVERDUE for Required Date = 8 days ago (08/23/2026)", () => {
      expect(isMrOverdue("2026-08-23", "Forwarded to Procurement", false, today)).toBe(true);
    });

    it("returns OVERDUE for Required Date = 11 days ago (08/20/2026)", () => {
      expect(isMrOverdue("2026-08-20", "Forwarded to Procurement", false, today)).toBe(true);
    });

    it("returns OVERDUE for Required Date = 31 days ago (07/31/2026)", () => {
      expect(isMrOverdue("2026-07-31", "Forwarded to Procurement", false, today)).toBe(true);
    });

    it("returns NOT OVERDUE for future dates (09/05/2026)", () => {
      expect(isMrOverdue("2026-09-05", "Forwarded to Procurement", false, today)).toBe(false);
    });

    it("returns NOT OVERDUE when MR already has RFQ (hasRFQ = true) even if date is >7 days past", () => {
      expect(isMrOverdue("2026-07-31", "Forwarded to Procurement", true, today)).toBe(false);
      expect(isMrOverdue("2026-08-20", "RFQ Created", true, today)).toBe(false);
    });

    it("returns NOT OVERDUE when MR is completed or cancelled even if date is >7 days past", () => {
      expect(isMrOverdue("2026-07-31", "Completed", false, today)).toBe(false);
      expect(isMrOverdue("2026-07-31", "Cancelled", false, today)).toBe(false);
    });
  });

  describe("resolveProcurementMrDisplayStatus", () => {
    it("resolves Completed correctly", () => {
      const status = resolveProcurementMrDisplayStatus("Completed");
      expect(status.label).toBe("Completed");
      expect(status.category).toBe("completed");
      expect(status.tone).toBe("success");
    });

    it("resolves Cancelled correctly", () => {
      const status = resolveProcurementMrDisplayStatus("Cancelled");
      expect(status.label).toBe("Cancelled");
      expect(status.category).toBe("cancelled");
      expect(status.tone).toBe("cancelled");
    });

    it("resolves RFQ Created correctly when status is RFQ Created", () => {
      const status = resolveProcurementMrDisplayStatus("RFQ Created");
      expect(status.label).toBe("RFQ Created");
      expect(status.category).toBe("in_progress");
      expect(status.tone).toBe("review");
    });

    it("resolves RFQ Created correctly when hasRFQ is true", () => {
      const status = resolveProcurementMrDisplayStatus("Forwarded to Procurement", true);
      expect(status.label).toBe("RFQ Created");
      expect(status.category).toBe("in_progress");
      expect(status.tone).toBe("review");
    });

    it("resolves Forwarded to Procurement as Awaiting RFQ Creation when hasRFQ is false", () => {
      const status = resolveProcurementMrDisplayStatus("Forwarded to Procurement", false);
      expect(status.label).toBe("Awaiting RFQ Creation");
      expect(status.category).toBe("pending");
      expect(status.tone).toBe("pending");
    });
  });
});
