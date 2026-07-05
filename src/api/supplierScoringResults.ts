/**
 * Supplier Scoring Result persistence service.
 *
 * Stores and retrieves weighted scoring results for an RFQ in ERPNext
 * via the "Supplier Scoring Result" custom DocType.
 */

import {
  apiGet,
  apiPost,
  buildResourceUrl,
  buildListConfig,
  withSilent,
} from "./erpnext";
import { formatERPNextDatetime } from "../utils/erpNextDate";
import type { SupplierScoringResult } from "../types/erpnext";
import type { ScoringEngineResult } from "./supplierScoringEngine";
import { toScoreRows } from "./supplierScoringEngine";

const DOCTYPE = "Supplier Scoring Result";
const CHILD_DOCTYPE = "Supplier Score Row";

/**
 * Persist a scoring engine result to ERPNext.
 *
 * Creates a new Supplier Scoring Result document linked to the given RFQ.
 * Each supplier's dimension scores, final score, ranking, and recommendation
 * reason are stored as child rows.
 *
 * `snapshot`, when provided, is the FULL AI recommendation envelope (as
 * displayed to the user — narrative summary, cost analysis, risk flags,
 * etc.), JSON-serialized into `analysis_snapshot`. This is what lets Legal
 * and Finance reviewers see the exact same AI analysis Procurement saw,
 * regardless of browser/device — ERPNext, not localStorage, is the source
 * of truth for this record.
 */
export async function saveScoringResult(
  rfqName: string,
  result: ScoringEngineResult,
  snapshot?: unknown
): Promise<SupplierScoringResult> {
  const topRanked = [...result.suppliers].sort((a, b) => a.ranking - b.ranking)[0];
  const payload = {
    doctype: DOCTYPE,
    rfq: rfqName,
    // ERPNext Datetime columns reject raw ISO strings (`toISOString()`) with
    // a hard MySQL OperationalError — always normalize before writing.
    scored_at: formatERPNextDatetime(result.scored_at) ?? formatERPNextDatetime(new Date()),
    price_weight: result.weights.price_weight,
    delivery_weight: result.weights.delivery_weight,
    quality_weight: result.weights.quality_weight,
    reliability_weight: result.weights.reliability_weight,
    recommended_supplier: topRanked?.supplier ?? "",
    ...(snapshot !== undefined
      ? { analysis_snapshot: JSON.stringify(snapshot) }
      : {}),
    supplier_scores: toScoreRows(result.suppliers).map((row) => ({
      doctype: CHILD_DOCTYPE,
      ...row,
    })),
  };

  return apiPost<SupplierScoringResult>(
    buildResourceUrl(DOCTYPE),
    payload,
    withSilent()
  );
}

/**
 * Fetch and parse the `analysis_snapshot` JSON blob of the most recent
 * scoring result for an RFQ — the ERPNext-backed source of truth for the AI
 * analysis envelope shown on the RFQ / Legal Review / Finance Review pages.
 * Returns `null` if no result exists yet or the snapshot can't be parsed.
 */
export async function getLatestAnalysisSnapshot<T = unknown>(
  rfqName: string
): Promise<T | null> {
  const result = await getLatestScoringResult(rfqName);
  if (!result?.analysis_snapshot) return null;
  try {
    return JSON.parse(result.analysis_snapshot) as T;
  } catch {
    return null;
  }
}

/**
 * Fetch the most recent scoring result for a given RFQ.
 * Returns null if no results exist yet.
 */
export async function getLatestScoringResult(
  rfqName: string
): Promise<SupplierScoringResult | null> {
  try {
    const list = await apiGet<Array<{ name: string }>>(
      buildResourceUrl(DOCTYPE),
      { ...buildListConfig({
        filters: [["rfq", "=", rfqName]],
        fields: ["name"],
        order_by: "scored_at desc",
        limit_page_length: 1,
      }), ...withSilent() }
    );

    if (!list || list.length === 0) return null;

    return apiGet<SupplierScoringResult>(
      buildResourceUrl(DOCTYPE, list[0].name),
      withSilent()
    );
  } catch {
    return null;
  }
}

/**
 * Fetch all scoring results for a given RFQ (history).
 */
export async function getScoringResults(
  rfqName: string
): Promise<SupplierScoringResult[]> {
  try {
    const list = await apiGet<Array<{ name: string }>>(
      buildResourceUrl(DOCTYPE),
      { ...buildListConfig({
        filters: [["rfq", "=", rfqName]],
        fields: ["name"],
        order_by: "scored_at desc",
        limit_page_length: 20,
      }), ...withSilent() }
    );

    if (!list || list.length === 0) return [];

    const detailed = await Promise.allSettled(
      list.map((row) =>
        apiGet<SupplierScoringResult>(
          buildResourceUrl(DOCTYPE, row.name),
          withSilent()
        )
      )
    );

    return detailed
      .filter(
        (r): r is PromiseFulfilledResult<SupplierScoringResult> =>
          r.status === "fulfilled"
      )
      .map((r) => r.value);
  } catch {
    return [];
  }
}
