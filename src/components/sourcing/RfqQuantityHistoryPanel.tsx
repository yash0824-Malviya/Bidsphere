/**
 * Internal RFQ quantity history — Department / Warehouse / Procurement Final.
 * Never shown to suppliers.
 */

import {
  getDepartmentRequestedQty,
  getProcurementFinalQty,
  getWarehouseAvailableQty,
} from "../../utils/rfqProcurementQty";
import type { RFQItem } from "../../types/erpnext";

export default function RfqQuantityHistoryPanel({
  items,
}: {
  items: RFQItem[];
}) {
  if (!items.length) return null;

  return (
    <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-neutral-900">
          Quantity History
        </h3>
        <p className="mt-0.5 text-[11px] text-neutral-500">
          Internal only — suppliers see Procurement Final Qty as Quantity to
          Quote
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2 text-right">Department Requested</th>
              <th className="px-4 py-2 text-right">Warehouse Available</th>
              <th className="px-4 py-2 text-right">Procurement Final Qty</th>
              <th className="px-4 py-2">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {items.map((it) => {
              const dept = getDepartmentRequestedQty(it);
              const wh = getWarehouseAvailableQty(it);
              const final = getProcurementFinalQty(it);
              const uom = it.uom || "Nos";
              return (
                <tr key={it.name || it.item_code}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-neutral-900">
                      {it.item_name || it.item_code}
                    </p>
                    <p className="text-[11px] text-neutral-500">{it.item_code}</p>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-700">
                    {dept} {uom}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-700">
                    {wh == null ? "—" : `${wh} ${uom}`}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-primary-700">
                    {final} {uom}
                  </td>
                  <td className="px-4 py-2.5 text-neutral-600">
                    {it.custom_qty_change_reason?.trim() || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
