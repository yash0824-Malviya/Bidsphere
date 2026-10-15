import type { ClmRecord } from "../src/types/clm.js";
import { ClmError } from "./clmCore.js";

/** The award owns the final amount; its winning quotation supplies the established currency. */
export function persistedRfqAwardValue(award: ClmRecord, quotation: ClmRecord): { amount: number; currency: string } {
  const raw = award.grand_total;
  const currency = typeof quotation.currency === "string" ? quotation.currency.trim() : "";
  const awardCurrency = typeof award.currency === "string" ? award.currency.trim() : "";
  if ((typeof raw !== "number" && typeof raw !== "string") || String(raw).trim() === "" || !Number.isFinite(Number(raw)) || Number(raw) < 0 || !currency) {
    throw new ClmError("The saved supplier award must include a valid final award value and winning quotation currency. Original quotation totals and estimates cannot replace the final award.", 409);
  }
  if (awardCurrency && awardCurrency !== currency) throw new ClmError("The saved supplier award currency differs from its winning quotation. Reconcile the award before continuing.", 409);
  return { amount: Number(raw), currency };
}
