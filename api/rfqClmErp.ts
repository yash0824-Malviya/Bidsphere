import { createClmDependencies, getClmFields } from "./clmErp.js";
import type { ClmRecord } from "../src/types/clm.js";
import type { RfqClmTransaction } from "./rfqClmCore.js";
import { persistRfqClmDecision } from "./rfqClmRest.js";
import { ensureInitialRfqContractRequest } from "./rfqInitialClmRequest.js";
import type { AccessPrincipal } from "./rbacAuth.js";

export async function ensureInitialRfqContractRequestErp(principal: AccessPrincipal, rfq: string, options: { allowCreate?: boolean } = {}) {
  const deps = { ...createClmDependencies(), fields: getClmFields };
  const result = await ensureInitialRfqContractRequest(principal, rfq, deps, options);
  return { ...result, rfq: await deps.load("Request for Quotation", rfq) };
}

/** Standard ERPNext persistence; no custom Frappe app or fallback transport. */
export async function commitRfqClmDecision(input: RfqClmTransaction): Promise<{ created: boolean; request?: ClmRecord; contract?: ClmRecord }> {
  return persistRfqClmDecision(input, { ...createClmDependencies(), fields: getClmFields });
}
