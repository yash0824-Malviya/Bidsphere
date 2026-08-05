/**
 * Persist Procurement Final Qty trail on RFQ items after create/update.
 *
 * Sets:
 *   - custom_department_requested_qty
 *   - custom_warehouse_available_qty
 *   - custom_procurement_final_qty
 *   - custom_qty_change_reason
 *   - qty (= procurement_final_qty) so suppliers / AI / PO stay aligned
 *
 * Run scripts/setup-rfq-procurement-qty.mjs once so Custom Fields exist.
 */

import { getRFQ, updateRFQ } from "./sourcing";
import { logRfqQtyAudit } from "./rfqQtyAudit";
import {
  getDepartmentRequestedQty,
  getProcurementFinalQty,
} from "../utils/rfqProcurementQty";

export type ProcurementQtyLine = {
  department_requested_qty: number;
  warehouse_available_qty: number | null;
  procurement_final_qty: number;
  qty_change_reason?: string | null;
};

export async function persistRfqProcurementQty(input: {
  rfqName: string;
  linesByItemCode: Map<string, ProcurementQtyLine>;
  audit?: boolean;
}): Promise<void> {
  const fresh = await getRFQ(input.rfqName);

  const nextItems = (fresh.items ?? []).map((it) => {
    const line = input.linesByItemCode.get(it.item_code);
    if (!line) return it;
    const finalQty =
      Number.isFinite(line.procurement_final_qty) &&
      line.procurement_final_qty > 0
        ? Number(line.procurement_final_qty)
        : Number(it.qty) || 1;
    const dept =
      Number.isFinite(line.department_requested_qty) &&
      line.department_requested_qty > 0
        ? Number(line.department_requested_qty)
        : finalQty;
    const wh =
      line.warehouse_available_qty != null &&
      Number.isFinite(line.warehouse_available_qty)
        ? Number(line.warehouse_available_qty)
        : null;
    const changed = Math.abs(dept - finalQty) > 1e-9;
    return {
      ...it,
      qty: finalQty,
      custom_department_requested_qty: dept,
      custom_warehouse_available_qty: wh,
      custom_procurement_final_qty: finalQty,
      custom_qty_change_reason: changed
        ? String(line.qty_change_reason || "").trim() || null
        : null,
    };
  });

  await updateRFQ(input.rfqName, { items: nextItems });

  const verified = await getRFQ(input.rfqName);
  for (const [itemCode, expected] of input.linesByItemCode.entries()) {
    const row = (verified.items ?? []).find((i) => i.item_code === itemCode);
    if (!row) continue;
    const actual = getProcurementFinalQty(row);
    const want = Number(expected.procurement_final_qty);
    if (Number.isFinite(want) && want > 0 && Math.abs(actual - want) > 1e-6) {
      throw new Error(
        `Procurement Final Qty for ${itemCode} was not saved on ${input.rfqName}. ` +
          `Expected ${want}, got ${actual}. ` +
          `Run: node scripts/setup-rfq-procurement-qty.mjs`,
      );
    }
    if (Math.abs(Number(row.qty) - actual) > 1e-6 && actual > 0) {
      throw new Error(
        `RFQ Item.qty for ${itemCode} does not match Procurement Final Qty on ${input.rfqName}.`,
      );
    }
  }

  if (input.audit) {
    const lines: string[] = [];
    for (const [code, v] of input.linesByItemCode.entries()) {
      const dept = v.department_requested_qty;
      const final = v.procurement_final_qty;
      if (Math.abs(dept - final) > 1e-9) {
        lines.push(
          `${code}: Department requested ${dept}; Procurement changed RFQ quantity from ${dept} to ${final}` +
            (v.qty_change_reason ? `. Reason: ${v.qty_change_reason}` : "."),
        );
      } else {
        lines.push(
          `${code}: Department requested ${dept}; Procurement Final Qty ${final}` +
            (v.warehouse_available_qty != null
              ? `; Warehouse available ${v.warehouse_available_qty}`
              : ""),
        );
      }
    }
    await logRfqQtyAudit({
      rfqName: input.rfqName,
      subject: "Procurement Final Quantity saved",
      content: lines.length ? lines.join(" ") : "No quantity overrides",
    });

    /* Also log department / warehouse baseline for the audit timeline. */
    for (const [code, v] of input.linesByItemCode.entries()) {
      await logRfqQtyAudit({
        rfqName: input.rfqName,
        subject: `Quantity trail — ${code}`,
        content:
          `Department requested ${v.department_requested_qty}.` +
          (v.warehouse_available_qty != null
            ? ` Warehouse confirmed ${v.warehouse_available_qty} available.`
            : "") +
          ` Procurement Final Qty ${v.procurement_final_qty}.`,
      });
    }
  }
}

/** Read qty trail from a persisted RFQ item (for internal UI). */
export function readQtyTrailFromRfqItem(item: {
  item_code: string;
  qty?: number;
  custom_department_requested_qty?: number | null;
  custom_warehouse_available_qty?: number | null;
  custom_procurement_final_qty?: number | null;
  custom_qty_change_reason?: string | null;
}) {
  const fullItem = { ...item, qty: item.qty ?? 0 };
  return {
    item_code: item.item_code,
    department_requested_qty: getDepartmentRequestedQty(fullItem),
    warehouse_available_qty: item.custom_warehouse_available_qty ?? null,
    procurement_final_qty: getProcurementFinalQty(fullItem),
    qty_change_reason: item.custom_qty_change_reason ?? null,
  };
}
