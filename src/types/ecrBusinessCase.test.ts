import { describe, expect, it } from "vitest";
import { calculateECRBusinessCaseFinancials, emptyECRBusinessCasePayload, parseECRBusinessCase } from "./ecrBusinessCase";

describe("ECR Business Case financial calculations", () => {
  it("calculates the requested savings, ROI and payback from unit costs and annual volume", () => {
    expect(calculateECRBusinessCaseFinancials({ current_cost: 10, proposed_cost: 8, annual_volume: 1000, implementation_cost: 500 })).toEqual({ expected_annual_savings: 2000, roi: 300, payback_period: 3 });
  });
  it("keeps negative savings visible and avoids a misleading negative payback", () => {
    expect(calculateECRBusinessCaseFinancials({ current_cost: 8, proposed_cost: 10, annual_volume: 1000, implementation_cost: 500 })).toEqual({ expected_annual_savings: -2000, roi: -500, payback_period: null });
  });
  it("does not divide by zero for a zero-cost change or zero savings", () => {
    expect(calculateECRBusinessCaseFinancials(emptyECRBusinessCasePayload())).toEqual({ expected_annual_savings: 0, roi: null, payback_period: null });
    expect(calculateECRBusinessCaseFinancials({ current_cost: 10, proposed_cost: 9, annual_volume: 100, implementation_cost: 0 })).toEqual({ expected_annual_savings: 100, roi: null, payback_period: 0 });
  });
  it("safely handles missing or malformed persisted Business Case JSON", () => {
    for (const value of [undefined, "", "{bad", "null", "[]", "{}", '{"name":"BC-1"}']) expect(parseECRBusinessCase(value)).toBeNull();
    expect(parseECRBusinessCase('{"name":"BC-1","ecr_reference":"ECR-1"}')?.name).toBe("BC-1");
  });
});
