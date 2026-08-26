import { describe, it, expect } from "vitest";
import {
  calculateBusinessCaseFinancials,
  calculatePaybackPeriod,
} from "../utils/financialCalculations";

describe("Financial Analysis Engine — Authoritative Tests", () => {
  // Test 1: Normal Profitable Case (Current Test Case)
  describe("1. Normal Profitable Case (CAPEX=200000, OPEX=20000, Savings=70000, Rev=30000, CostAvoid=10000, Dur=5, Rate=10%)", () => {
    it("should calculate exact deterministic values: ROI=125%, NPV=$141,170.81, IRR=34.94%, Payback=26.67 Months", () => {
      const result = calculateBusinessCaseFinancials({
        capex: 200000,
        opex: 20000,
        expected_annual_savings: 70000,
        revenue_increase: 30000,
        cost_avoidance: 10000,
        project_duration: 5,
        discount_rate: 10,
      });

      expect(result.status).toBe("Calculated");
      expect(result.total_investment).toBe(200000);
      expect(result.annual_gross_benefit).toBe(110000);
      expect(result.annual_net_benefit).toBe(90000);
      expect(result.total_net_benefit).toBe(450000);
      expect(result.net_project_gain).toBe(250000);
      expect(result.roi).toBe(125.0);
      expect(result.roi_formatted).toBe("125.0%");

      // NPV = -200000 + 90000 * ((1 - (1.1)^-5) / 0.1) = ~141170.81
      expect(Math.round(result.npv)).toBe(141171);

      // IRR = 34.94% (~34.9%)
      expect(result.irr).toBeCloseTo(34.94, 1);
      expect(result.irr_formatted).toBe("34.9%");

      // Payback = 2 + (20000 / 90000) = 2.2222 years = 26.67 Months
      expect(result.payback_period_years).toBeCloseTo(2.2222, 3);
      expect(result.payback_period_formatted).toBe("26.67 Months");

      // Cash Flows Year 0..5
      expect(result.cash_flows).toHaveLength(6);
      expect(result.cash_flows[0].year).toBe(0);
      expect(result.cash_flows[0].investment).toBe(200000);
      expect(result.cash_flows[0].cumulative_cash_flow).toBe(-200000);

      expect(result.cash_flows[1].year).toBe(1);
      expect(result.cash_flows[1].beginning_balance).toBe(-200000);
      expect(result.cash_flows[1].annual_net_benefit).toBe(90000);
      expect(result.cash_flows[1].cumulative_cash_flow).toBe(-110000);

      expect(result.cash_flows[2].year).toBe(2);
      expect(result.cash_flows[2].cumulative_cash_flow).toBe(-20000);

      expect(result.cash_flows[3].year).toBe(3);
      expect(result.cash_flows[3].cumulative_cash_flow).toBe(70000);

      expect(result.cash_flows[4].year).toBe(4);
      expect(result.cash_flows[4].cumulative_cash_flow).toBe(160000);

      expect(result.cash_flows[5].year).toBe(5);
      expect(result.cash_flows[5].cumulative_cash_flow).toBe(250000);
    });
  });

  // Test 2: Zero Annual Benefit
  describe("2. Zero Annual Benefit (Benefits = OPEX)", () => {
    it("should report -100% ROI, negative NPV, and Not Recoverable payback", () => {
      const result = calculateBusinessCaseFinancials({
        capex: 50000,
        opex: 20000,
        expected_annual_savings: 20000,
        revenue_increase: 0,
        cost_avoidance: 0,
        project_duration: 5,
        discount_rate: 10,
      });

      expect(result.status).toBe("Calculated");
      expect(result.annual_net_benefit).toBe(0);
      expect(result.net_project_gain).toBe(-50000);
      expect(result.roi).toBe(-100.0);
      expect(result.npv).toBe(-50000);
      expect(result.payback_period_formatted).toBe("Not Recoverable");
      expect(result.irr_formatted).toBe("Not Available");
    });
  });

  // Test 3: Negative Annual Benefit
  describe("3. Negative Annual Benefit (OPEX > Benefits)", () => {
    it("should handle negative cash flows safely without crash and report Not Recoverable", () => {
      const result = calculateBusinessCaseFinancials({
        capex: 50000,
        opex: 35000,
        expected_annual_savings: 10000,
        revenue_increase: 0,
        cost_avoidance: 0,
        project_duration: 4,
        discount_rate: 10,
      });

      expect(result.status).toBe("Calculated");
      expect(result.annual_net_benefit).toBe(-25000);
      expect(result.total_net_benefit).toBe(-100000);
      expect(result.net_project_gain).toBe(-150000);
      expect(result.roi).toBe(-300.0);
      expect(result.payback_period_formatted).toBe("Not Recoverable");
      expect(result.irr_formatted).toBe("Not Available");
    });
  });

  // Test 4: Payback during Year 1
  describe("4. Payback during Year 1 (Fast Payback)", () => {
    it("should calculate fractional year/months during Year 1 correctly", () => {
      // CAPEX = 100000, Net Benefit = 150000 -> 100k / 150k = 0.6667 yr = 8.00 Months
      const payback = calculatePaybackPeriod(100000, 150000, 5);
      expect(payback.years).toBeCloseTo(0.6667, 3);
      expect(payback.months).toBe(8.0);
      expect(payback.formatted).toBe("8.00 Months");
    });
  });

  // Test 5: Payback during Year 3
  describe("5. Payback during Year 3", () => {
    it("should calculate exact months across multiple operating years", () => {
      // CAPEX = 200000, Net Benefit = 90000 -> 2 + 20/90 = 2.2222 yr = 26.67 Months
      const payback = calculatePaybackPeriod(200000, 90000, 5);
      expect(payback.years).toBeCloseTo(2.2222, 3);
      expect(payback.months).toBe(26.67);
      expect(payback.formatted).toBe("26.67 Months");
    });
  });

  // Test 6: Never Recovered during Project Duration
  describe("6. Never Recovered during Project Duration", () => {
    it("should return Not Recoverable when total inflows are less than CAPEX", () => {
      // CAPEX = 500000, Net Benefit = 50000/yr for 5 years = 250k < 500k
      const payback = calculatePaybackPeriod(500000, 50000, 5);
      expect(payback.years).toBeNull();
      expect(payback.months).toBeNull();
      expect(payback.formatted).toBe("Not Recoverable");
    });
  });

  // Test 7: Zero CAPEX
  describe("7. Zero CAPEX (CAPEX = 0)", () => {
    it("should handle CAPEX = 0 safely with Not Applicable ROI and 0 Months payback", () => {
      const result = calculateBusinessCaseFinancials({
        capex: 0,
        opex: 5000,
        expected_annual_savings: 25000,
        revenue_increase: 0,
        cost_avoidance: 0,
        project_duration: 3,
        discount_rate: 8,
      });

      expect(result.status).toBe("Calculated");
      expect(result.total_investment).toBe(0);
      expect(result.roi).toBeNull();
      expect(result.roi_formatted).toBe("Not Applicable");
      expect(result.payback_period_years).toBe(0);
      expect(result.payback_period_formatted).toBe("0 Months");
      expect(result.irr).toBeNull();
      expect(result.irr_formatted).toBe("Not Applicable");
    });
  });

  // Test 8: Zero Discount Rate
  describe("8. Zero Discount Rate (Discount Rate = 0%)", () => {
    it("should calculate NPV equal to undiscounted Net Project Gain when Discount Rate is 0%", () => {
      const result = calculateBusinessCaseFinancials({
        capex: 100000,
        opex: 10000,
        expected_annual_savings: 50000,
        project_duration: 3,
        discount_rate: 0,
      });
      // Net benefit = 40,000 / year. Total net benefit = 120,000. Gain = 20,000.
      expect(result.status).toBe("Calculated");
      expect(result.total_net_benefit).toBe(120000);
      expect(result.net_project_gain).toBe(20000);
      expect(result.npv).toBe(20000);
    });
  });

  // Test 9: Missing Inputs & Zero Benefits Validation
  describe("9. Missing Inputs & Zero Benefits Validation", () => {
    it("should return Incomplete status and Pending Analysis when required fields are missing", () => {
      const result = calculateBusinessCaseFinancials({
        capex: null,
        opex: 10000,
        expected_annual_savings: 30000,
        project_duration: 3,
        discount_rate: 10,
      });
      expect(result.status).toBe("Incomplete");
      expect(result.payback_period_formatted).toBe("Pending Analysis");
      expect(result.roi_formatted).toBe("Pending Analysis");
      expect(result.errors.some((e) => e.includes("CAPEX"))).toBe(true);
    });

    it("should return Incomplete status and Pending Analysis when all 3 annual benefit fields are zero", () => {
      const result = calculateBusinessCaseFinancials({
        capex: 180000,
        opex: 20000,
        expected_annual_savings: 0,
        revenue_increase: 0,
        cost_avoidance: 0,
        project_duration: 5,
        discount_rate: 10,
      });
      expect(result.status).toBe("Incomplete");
      expect(result.roi_formatted).toBe("Pending Analysis");
      expect(result.npv_formatted).toBe("Pending Analysis");
      expect(result.irr_formatted).toBe("Pending Analysis");
      expect(result.payback_period_formatted).toBe("Pending Analysis");
      expect(result.annual_gross_benefit).toBe(0);
      expect(result.message).toContain("No measurable annual financial benefit has been provided");
    });
  });

  // Test 10: Invalid Inputs
  describe("10. Invalid Inputs (Negative Duration / Rate > 100%)", () => {
    it("should reject negative or non-integer project duration", () => {
      const result = calculateBusinessCaseFinancials({
        capex: 50000,
        opex: 10000,
        expected_annual_savings: 30000,
        project_duration: -3,
        discount_rate: 10,
      });
      expect(result.status).toBe("Invalid");
      expect(result.payback_period_formatted).toBe("Invalid Inputs");
      expect(result.errors.some((e) => e.includes("Project Duration"))).toBe(true);
    });

    it("should reject invalid discount rate > 100% or negative", () => {
      const result = calculateBusinessCaseFinancials({
        capex: 50000,
        opex: 10000,
        expected_annual_savings: 30000,
        project_duration: 5,
        discount_rate: 150,
      });
      expect(result.status).toBe("Invalid");
      expect(result.errors.some((e) => e.includes("Discount Rate"))).toBe(true);
    });
  });
});
