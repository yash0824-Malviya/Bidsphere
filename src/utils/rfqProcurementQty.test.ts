import { describe, expect, it } from "vitest";
import {
  getDepartmentRequestedQty,
  getProcurementFinalQty,
  getWarehouseAvailableQty,
  sanitizeItemQtyForSupplier,
  qtyChangedFromDepartment,
} from "./rfqProcurementQty";
import { sanitizeRfqForSupplier } from "./rfqTargetPrice";
import type { RFQ, RFQItem } from "../types/erpnext";

describe("rfqProcurementQty", () => {
  it("falls back to qty for legacy RFQs", () => {
    const item = { qty: 50 } as RFQItem;
    expect(getDepartmentRequestedQty(item)).toBe(50);
    expect(getProcurementFinalQty(item)).toBe(50);
    expect(getWarehouseAvailableQty(item)).toBeNull();
  });

  it("prefers custom trail fields when present", () => {
    const item = {
      qty: 200,
      custom_department_requested_qty: 50,
      custom_warehouse_available_qty: 0,
      custom_procurement_final_qty: 200,
      custom_qty_change_reason: "Minimum Order Quantity (MOQ)",
    } as RFQItem;
    expect(getDepartmentRequestedQty(item)).toBe(50);
    expect(getWarehouseAvailableQty(item)).toBe(0);
    expect(getProcurementFinalQty(item)).toBe(200);
    expect(qtyChangedFromDepartment(item)).toBe(true);
  });

  it("strips internal qty fields for suppliers and keeps final qty", () => {
    const item = {
      item_code: "ITEM-1",
      qty: 200,
      custom_department_requested_qty: 50,
      custom_warehouse_available_qty: 0,
      custom_procurement_final_qty: 200,
      custom_qty_change_reason: "Bulk Discount",
    } as RFQItem;
    const sanitized = sanitizeItemQtyForSupplier(item);
    expect(sanitized.qty).toBe(200);
    expect(
      (sanitized as RFQItem).custom_department_requested_qty,
    ).toBeUndefined();
    expect(
      (sanitized as RFQItem).custom_warehouse_available_qty,
    ).toBeUndefined();
    expect(
      (sanitized as RFQItem).custom_procurement_final_qty,
    ).toBeUndefined();
    expect((sanitized as RFQItem).custom_qty_change_reason).toBeUndefined();
  });

  it("sanitizeRfqForSupplier removes qty trail from items", () => {
    const rfq = {
      name: "RFQ-1",
      transaction_date: "2026-01-01",
      custom_show_target_price_to_supplier: 0,
      items: [
        {
          item_code: "A",
          qty: 200,
          custom_department_requested_qty: 50,
          custom_warehouse_available_qty: 0,
          custom_procurement_final_qty: 200,
          custom_qty_change_reason: "MOQ",
          custom_show_target_price_to_supplier: 0,
        },
      ],
      suppliers: [],
    } as unknown as RFQ;
    const out = sanitizeRfqForSupplier(rfq);
    expect(out.items[0].qty).toBe(200);
    expect(out.items[0].custom_department_requested_qty).toBeUndefined();
    expect(out.items[0].custom_qty_change_reason).toBeUndefined();
  });
});
