/**
 * Persist per-line Target Price + Show-to-Supplier flags after RFQ create/update.
 *
 * Run scripts/setup-rfq-target-price.mjs once so Custom Fields exist with
 * allow_on_submit = 1.
 */

import { getRFQ, updateRFQ } from "./sourcing";
import { logRfqTargetPriceAudit } from "./rfqTargetPriceAudit";
import {
  getItemTargetPrice,
  isItemTargetPriceVisibleToSupplier,
  isTruthyFlag,
} from "../utils/rfqTargetPrice";

export type TargetPricingLine = {
  target_price: number | null;
  show_to_supplier: boolean;
};

export async function persistRfqTargetPricing(input: {
  rfqName: string;
  /** item_code → target + visibility. */
  linesByItemCode: Map<string, TargetPricingLine>;
  audit?: boolean;
}): Promise<void> {
  const fresh = await getRFQ(input.rfqName);
  let anyShow = false;

  const nextItems = (fresh.items ?? []).map((it) => {
    const line = input.linesByItemCode.get(it.item_code);
    if (!line) return it;
    const tp = line.target_price;
    const show = !!line.show_to_supplier;
    if (show) anyShow = true;
    return {
      ...it,
      custom_target_price:
        tp != null && Number.isFinite(Number(tp)) && Number(tp) > 0
          ? Number(tp)
          : null,
      custom_show_target_price_to_supplier: (show ? 1 : 0) as 0 | 1,
    };
  });

  /* Header OR-flag kept for legacy readers / PDF helpers. */
  await updateRFQ(input.rfqName, {
    custom_show_target_price_to_supplier: anyShow ? 1 : 0,
    items: nextItems,
  });

  const verified = await getRFQ(input.rfqName);
  const headerOk =
    isTruthyFlag(verified.custom_show_target_price_to_supplier) === anyShow;
  if (!headerOk) {
    throw new Error(
      `Show Target Price flag was not saved on ${input.rfqName}. ` +
        `If the RFQ is submitted, run: node scripts/setup-rfq-target-price.mjs`,
    );
  }

  for (const [itemCode, expected] of input.linesByItemCode.entries()) {
    const row = (verified.items ?? []).find((i) => i.item_code === itemCode);
    if (!row) continue;
    const actual = getItemTargetPrice(row);
    const want =
      expected.target_price != null &&
      Number.isFinite(Number(expected.target_price)) &&
      Number(expected.target_price) > 0
        ? Number(expected.target_price)
        : null;
    if (want != null && actual !== want) {
      throw new Error(
        `Target Price for ${itemCode} was not saved on ${input.rfqName}. ` +
          `Expected ${want}, got ${actual ?? "empty"}.`,
      );
    }
    const showActual = isItemTargetPriceVisibleToSupplier(row, verified);
    if (showActual !== !!expected.show_to_supplier) {
      throw new Error(
        `Show Target Price for ${itemCode} was not saved on ${input.rfqName}. ` +
          `Expected ${expected.show_to_supplier ? "ON" : "OFF"}. ` +
          `Run: node scripts/setup-rfq-target-price.mjs`,
      );
    }
  }

  if (input.audit) {
    const lines = [...input.linesByItemCode.entries()]
      .filter(([, v]) => v.target_price != null && Number(v.target_price) > 0)
      .map(
        ([code, v]) =>
          `${code}=${v.target_price}${v.show_to_supplier ? " (shown)" : " (hidden)"}`,
      );
    await logRfqTargetPriceAudit({
      rfqName: input.rfqName,
      subject: "Target Pricing saved",
      content: lines.length
        ? `Line targets: ${lines.join("; ")}`
        : "No target prices set",
    });
  }
}
