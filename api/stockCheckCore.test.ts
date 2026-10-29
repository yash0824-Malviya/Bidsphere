import { describe, it, expect, vi, beforeEach } from "vitest";
import { runStockCheck, StockCheckError } from "./stockCheckCore";

// Mock global fetch for ERPNext API calls in stockCheckCore
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("stockCheckCore validation and execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ERPNEXT_URL = "http://erp.test:8090";
    process.env.ERP_API_KEY = "test_key";
    process.env.ERP_API_SECRET = "test_secret";
  });

  it("successfully performs stock check for valid company Bidsphere warehouses", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      const urlStr = String(url);

      if (urlStr.includes("resource/Item/DIR-STE-016")) {
        return new Response(JSON.stringify({ data: { name: "DIR-STE-016", is_stock_item: 1 } }), { status: 200 });
      }
      if (urlStr.includes("resource/Item/DIR-STE-036")) {
        return new Response(JSON.stringify({ data: { name: "DIR-STE-036", is_stock_item: 1 } }), { status: 200 });
      }
      if (urlStr.includes("resource/Warehouse/Finished%20Goods%20-%20B")) {
        return new Response(JSON.stringify({ data: { name: "Finished Goods - B", company: "Bidsphere" } }), { status: 200 });
      }
      if (urlStr.includes("resource/Warehouse")) {
        return new Response(JSON.stringify({ data: [{ name: "Finished Goods - B", company: "Bidsphere" }] }), { status: 200 });
      }
      if (urlStr.includes("resource/Bin")) {
        return new Response(JSON.stringify({
          data: [
            { item_code: "DIR-STE-016", warehouse: "Finished Goods - B", actual_qty: 0, reserved_qty: 0 },
            { item_code: "DIR-STE-036", warehouse: "Finished Goods - B", actual_qty: 0, reserved_qty: 0 }
          ]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: "Not found" }), { status: 404 });
    });

    const result = await runStockCheck({
      mr_number: "MAT-MR-2026-00130",
      company: "Bidsphere",
      mr_company: "Bidsphere",
      warehouse: "Finished Goods - B",
      warehouses: ["Finished Goods - B"],
      items: [
        { item_code: "DIR-STE-016", requested_qty: 25, mr_warehouse: "Finished Goods - B" },
        { item_code: "DIR-STE-036", requested_qty: 25, mr_warehouse: "Finished Goods - B" }
      ],
      user: "Warehouse"
    });

    expect(result.success).toBe(true);
    expect(result.company).toBe("Bidsphere");
    expect(result.warehouse).toBe("Finished Goods - B");
    expect(result.lines).toHaveLength(2);

    expect(result.lines[0]?.item_code).toBe("DIR-STE-016");
    expect(result.lines[0]?.requested_qty).toBe(25);
    expect(result.lines[0]?.available_qty).toBe(0);
    expect(result.lines[0]?.shortage_qty).toBe(25);
    expect(result.lines[0]?.recommendation).toBe("Forward to Procurement");

    expect(result.lines[1]?.item_code).toBe("DIR-STE-036");
    expect(result.lines[1]?.requested_qty).toBe(25);
    expect(result.lines[1]?.available_qty).toBe(0);
    expect(result.lines[1]?.shortage_qty).toBe(25);
    expect(result.lines[1]?.recommendation).toBe("Forward to Procurement");
  });

  it("rejects mismatched warehouse belonging to a different company", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      const urlStr = String(url);
      if (urlStr.includes("resource/Item/DIR-STE-016")) {
        return new Response(JSON.stringify({ data: { name: "DIR-STE-016", is_stock_item: 1 } }), { status: 200 });
      }
      if (urlStr.includes("resource/Warehouse/Stores%20-%20NSGAI")) {
        return new Response(JSON.stringify({ data: { name: "Stores - NSGAI", company: "Netlink" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: "Not found" }), { status: 404 });
    });

    await expect(
      runStockCheck({
        mr_number: "MAT-MR-2026-00130",
        company: "Bidsphere",
        mr_company: "Bidsphere",
        warehouse: "Stores - NSGAI",
        items: [{ item_code: "DIR-STE-016", requested_qty: 25 }],
        user: "Warehouse"
      })
    ).rejects.toThrow(StockCheckError);
  });
});
