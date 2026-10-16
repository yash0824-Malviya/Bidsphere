import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveWarehouseStockCompany,
  assertMaterialRequestIsWarehouseCompany,
} from "./warehouseCompany";

describe("warehouseCompany resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves stockCompany to Bidsphere when Material Request company is Bidsphere", () => {
    const ctx = resolveWarehouseStockCompany("Bidsphere");
    expect(ctx.mrCompany).toBe("Bidsphere");
    expect(ctx.stockCompany).toBe("Bidsphere");
    expect(ctx.notice).toBeDefined();
  });

  it("resolves stockCompany to BidSphere when casing is BidSphere", () => {
    const ctx = resolveWarehouseStockCompany("BidSphere");
    expect(ctx.mrCompany).toBe("BidSphere");
    expect(ctx.stockCompany).toBe("BidSphere");
  });

  it("resolves stockCompany to Netlink when Material Request company is Netlink", () => {
    const ctx = resolveWarehouseStockCompany("Netlink");
    expect(ctx.mrCompany).toBe("Netlink");
    expect(ctx.stockCompany).toBe("Netlink");
    expect(ctx.companyDiffer).toBe(false);
  });

  it("assertMaterialRequestIsWarehouseCompany returns the MR company for both Bidsphere and Netlink", () => {
    expect(assertMaterialRequestIsWarehouseCompany("Bidsphere")).toBe("Bidsphere");
    expect(assertMaterialRequestIsWarehouseCompany("BidSphere")).toBe("BidSphere");
    expect(assertMaterialRequestIsWarehouseCompany("Netlink")).toBe("Netlink");
  });
});
