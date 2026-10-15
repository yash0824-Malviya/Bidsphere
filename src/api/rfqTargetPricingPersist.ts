/**
 * Persist per-line Target Price + Show-to-Supplier flags after RFQ create/update.
 *
 * Run scripts/setup-rfq-target-price.mjs once so Custom Fields exist with
 * allow_on_submit = 1.
 */

import { getRFQ, updateRFQ } from "./sourcing";
import { logRfqTargetPriceAudit } from "./rfqTargetPriceAudit";
import { savedRfqFromClmRoutingError } from "./rfqContractRequirement";
import type { RFQ, RFQItem } from "../types/erpnext";
import {
  getItemTargetPrice,
  isItemTargetPriceVisibleToSupplier,
  isTruthyFlag,
} from "../utils/rfqTargetPrice";

export type TargetPricingLine = {
  target_price: number | null;
  show_to_supplier: boolean;
};
export type TargetPricingItemLine = TargetPricingLine & { item_code: string };
type MatchedPricingLine = { itemCode: string; line: TargetPricingLine; rowName?: string; position: number };

const target = (value: number | null) => value != null && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

function rowForPricing(rfq: RFQ, expected: MatchedPricingLine): RFQItem {
  const row = expected.rowName ? (rfq.items ?? []).find(item => item.name === expected.rowName) : rfq.items?.[expected.position];
  if (!row || row.item_code !== expected.itemCode) throw new Error(`RFQ ${rfq.name} item row ${expected.position + 1} no longer matches ${expected.itemCode}; its Target Price could not be verified.`);
  return row;
}

function verifyPricing(rfq: RFQ, expected: MatchedPricingLine[], anyShow: boolean): void {
  if (isTruthyFlag(rfq.custom_show_target_price_to_supplier) !== anyShow) throw new Error(`Show Target Price flag was not saved on ${rfq.name}. Verify the existing RFQ Target Pricing fields in ERPNext.`);
  for (const matched of expected) {
      const { itemCode, line } = matched;
      const row = rowForPricing(rfq, matched);
      const actual = getItemTargetPrice({ custom_target_price: row.custom_target_price }), wanted = target(line.target_price);
      if (actual !== wanted) throw new Error(`Target Price for ${itemCode} was not saved on ${rfq.name}. Expected ${wanted ?? "empty"}, got ${actual ?? "empty"}.`);
      if (isItemTargetPriceVisibleToSupplier(row, rfq) !== !!line.show_to_supplier || line.show_to_supplier && !isTruthyFlag(row.custom_show_target_price_to_supplier)) throw new Error(`Show Target Price for ${itemCode} was not saved on ${rfq.name}. Expected ${line.show_to_supplier ? "ON" : "OFF"}. Verify the existing per-item Target Pricing field in ERPNext.`);
  }
}

export async function persistRfqTargetPricing(input: {
  rfqName: string;
  /** Complete ordered line list for creation; repeated item codes stay distinct. */
  lines?: TargetPricingItemLine[];
  /** Compatibility input for code-wide pricing edits. Do not combine with lines. */
  linesByItemCode?: Map<string, TargetPricingLine>;
  audit?: boolean;
}): Promise<{ contractRequirementWarning: string } | void> {
  const fresh = await getRFQ(input.rfqName);
  if (fresh.name !== input.rfqName) throw new Error("ERPNext returned a different RFQ while verifying Target Pricing.");
  if (input.lines && input.linesByItemCode) throw new Error("Provide per-line or item-code Target Pricing, not both.");
  const items = fresh.items ?? [];
  const expected: MatchedPricingLine[] = [];
  if (input.lines) {
    if (input.lines.length !== items.length) throw new Error(`RFQ ${input.rfqName} saved ${items.length} item rows but ${input.lines.length} Target Pricing rows were submitted. Refresh the RFQ before continuing.`);
    input.lines.forEach((line, position) => {
      const item = items[position];
      if (item.item_code !== line.item_code) throw new Error(`RFQ ${input.rfqName} item row ${position + 1} does not match ${line.item_code}; its Target Price could not be saved.`);
      expected.push({ itemCode: line.item_code, line, position, rowName: item.name });
    });
  } else {
    for (const [itemCode, line] of input.linesByItemCode ?? []) {
      const positions = items.map((item, position) => item.item_code === itemCode ? position : -1).filter(position => position >= 0);
      if (!positions.length) throw new Error(`RFQ ${input.rfqName} has no saved item ${itemCode}; its Target Price could not be saved.`);
      for (const position of positions) expected.push({ itemCode, line, position, rowName: items[position].name });
    }
  }
  const byPosition = new Map(expected.map(({ position, line }) => [position, line]));

  const nextItems = items.map((it, position) => {
    const line = byPosition.get(position);
    if (!line) return it;
    const tp = line.target_price;
    const show = !!line.show_to_supplier;
    return {
      ...it,
      custom_target_price:
        target(tp),
      custom_show_target_price_to_supplier: (show ? 1 : 0) as 0 | 1,
    };
  });
  // Preserve any visible lines not included in a partial pricing edit.
  const anyShow = nextItems.some(item => isItemTargetPriceVisibleToSupplier(item, fresh));

  let alreadyPersisted = false;
  let routingWarning = "";
  try { verifyPricing(fresh, expected, anyShow); alreadyPersisted = true; } catch { /* Save the requested differences, then verify independently. */ }
  if (!alreadyPersisted) {
    try {
      /* Header OR-flag kept for legacy readers / PDF helpers. */
      await updateRFQ(input.rfqName, {
        ...(fresh.modified ? { modified: fresh.modified } : {}),
        custom_show_target_price_to_supplier: anyShow ? 1 : 0,
        items: nextItems,
      });
    } catch (error) {
      // A routing error is returned after the RFQ write has committed. It is
      // not evidence of a pricing failure. Re-fetch the actual lines below
      // and separately return this routing failure to the caller for display.
      const saved = savedRfqFromClmRoutingError(error);
      if (saved?.name !== input.rfqName) throw error;
      routingWarning = saved.contractRequirementWarning || "The RFQ was saved, but its Contract Request could not be routed. Refresh the RFQ and retry its Contract Request.";
    }
    const verified = await getRFQ(input.rfqName);
    if (verified.name !== input.rfqName) throw new Error("ERPNext returned a different RFQ while verifying Target Pricing.");
    if (input.lines && verified.items?.length !== input.lines.length) throw new Error(`RFQ ${input.rfqName} item rows changed while saving Target Pricing. Refresh the RFQ before continuing.`);
    verifyPricing(verified, expected, anyShow);
  }

  if (input.audit) {
    const lines = expected
      .filter(({ line }) => line.target_price != null && Number(line.target_price) > 0)
      .map(
        ({ itemCode, line, position }) =>
          `Row ${position + 1} ${itemCode}=${line.target_price}${line.show_to_supplier ? " (shown)" : " (hidden)"}`,
      );
    await logRfqTargetPriceAudit({
      rfqName: input.rfqName,
      subject: "Target Pricing saved",
      content: lines.length
        ? `Line targets: ${lines.join("; ")}`
        : "No target prices set",
    });
  }
  if (routingWarning) return { contractRequirementWarning: routingWarning };
}
