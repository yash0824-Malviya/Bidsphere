import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
vi.mock("./erpnext", () => ({
  apiGet,
  buildResourceUrl: (doctype: string, name?: string) => name ? `${doctype}/${name}` : doctype,
  buildListConfig: (config: unknown) => config,
  withSilent: (config: unknown) => config,
}));
import { getSupplierPerformance } from "./supplierPerformance";

const supplier = '"Supplier A"';
type Doc = Record<string, unknown>;

function seedHistory(orders: Doc[], receipts: Doc[], invoices: Doc[] = []) {
  const documents = new Map<string, unknown>([
    ["Purchase Order", orders], ["Purchase Receipt", receipts], ["Purchase Invoice", invoices],
    ...orders.map((doc): [string, unknown] => [`Purchase Order/${doc.name}`, doc]),
    ...receipts.map((doc): [string, unknown] => [`Purchase Receipt/${doc.name}`, doc]),
  ]);
  apiGet.mockImplementation(async (path: string) => {
    if (!documents.has(path)) throw new Error("Unavailable");
    return structuredClone(documents.get(path));
  });
}

describe("supplier historical performance", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    apiGet.mockReset();
  });

  it("matches receipts to the exact order and child row, preserving literal supplier IDs", async () => {
    seedHistory([
      { name: "PO-NEW", supplier, status: "Completed", per_received: 100, schedule_date: "2026-07-15",
        items: [{ name: "ROW-NEW", qty: 7, schedule_date: "2026-07-15" }] },
      { name: "PO-OLD", supplier, status: "Completed", per_received: 100, schedule_date: "2026-06-29",
        items: [{ name: "ROW-OLD", qty: 3, schedule_date: "2026-06-29" }] },
    ], [
      { name: "GRN-NEW", supplier, posting_date: "2026-07-08",
        items: [{ purchase_order: "PO-NEW", purchase_order_item: "ROW-NEW", received_qty: 7, rejected_qty: 0 }] },
      { name: "GRN-OLD", supplier, posting_date: "2026-07-04",
        items: [{ purchase_order: "PO-OLD", purchase_order_item: "ROW-OLD", received_qty: 3, rejected_qty: 0 }] },
    ]);

    const result = (await getSupplierPerformance([supplier]))[supplier];
    expect(apiGet.mock.calls[0][1].filters[0]).toEqual(["supplier", "in", [supplier]]);
    expect(result).toMatchObject({
      total_pos: 2, total_grns: 2, on_time_deliveries: 1, late_deliveries: 1,
      avg_delay_days: 5, delivery_score: 35,
      total_ordered_qty: 10, total_received_qty: 10, total_rejected_qty: 0,
      quality_score: 100, reliability_score: 100, has_sufficient_data: true,
    });
  });

  it("uses actual rejected quantities in the existing accepted/ordered quality formula", async () => {
    seedHistory([
      { name: "PO", supplier, status: "Completed", per_received: 100,
        items: [{ name: "PO-LINE", qty: 10, schedule_date: "2026-07-15" }] },
    ], [
      { name: "GRN", supplier, posting_date: "2026-07-10",
        items: [{ purchase_order: "PO", purchase_order_item: "PO-LINE", received_qty: 10, rejected_qty: 2 }] },
    ]);
    const result = (await getSupplierPerformance([supplier]))[supplier];
    expect(result).toMatchObject({ total_ordered_qty: 10, total_received_qty: 10,
      total_rejected_qty: 2, qty_accuracy_pct: 80, quality_score: 80 });
  });

  it("marks unlinked delivery and quality unavailable instead of assuming on-time", async () => {
    seedHistory([
      { name: "PO", supplier, status: "Completed", schedule_date: "2026-08-01",
        items: [{ name: "ROW", qty: 10 }] },
    ], [
      { name: "GRN", supplier, posting_date: "2026-07-10",
        items: [{ purchase_order: "UNRELATED-PO", received_qty: 10, rejected_qty: 0 }] },
    ]);
    const result = (await getSupplierPerformance([supplier]))[supplier];
    expect(result).toMatchObject({ on_time_deliveries: 0, late_deliveries: 0,
      delivery_score: -1, quality_score: -1, has_sufficient_data: false,
      has_delivery_data: false, has_quality_data: false });
    expect(result.unavailable_metrics).toEqual(["delivery", "quality"]);
  });

  it("does not substitute missing receipt details or billing dates with successful performance", async () => {
    seedHistory([
      { name: "PO", supplier, status: "Completed", schedule_date: "2026-08-01", per_received: 100 },
    ], [{ name: "GRN", supplier, posting_date: "2026-07-10" }],
    [{ name: "INV", supplier, posting_date: "2026-07-10" }]);
    const result = (await getSupplierPerformance([supplier]))[supplier];
    expect(result).toMatchObject({ total_ordered_qty: 0, total_received_qty: 0,
      delivery_score: -1, quality_score: -1, reliability_score: -1, invoices_on_time: 0,
      has_sufficient_data: false });
  });

  it("keeps unavailable sources distinct from successful empty history", async () => {
    apiGet.mockRejectedValue(new Error("ERP unavailable"));
    const result = (await getSupplierPerformance([supplier]))[supplier];
    expect(result).toMatchObject({ delivery_score: -1, quality_score: -1,
      reliability_score: -1, has_sufficient_data: false });
    expect(result.unavailable_metrics).toEqual(["delivery", "quality", "reliability"]);
  });

  it("does not match another supplier merely because its display name matches the requested ID", async () => {
    seedHistory([{ name: "PO", supplier: "OTHER-ID", supplier_name: supplier,
      status: "Completed", per_received: 100, items: [{ name: "ROW", qty: 10 }] }], []);
    const result = (await getSupplierPerformance([supplier]))[supplier];
    expect(result.total_pos).toBe(0);
    expect(result.reliability_score).toBe(-1);
  });
});
