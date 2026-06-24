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
 */
export async function saveScoringResult(
  rfqName: string,
  result: ScoringEngineResult
): Promise<SupplierScoringResult> {
  const payload = {
    doctype: DOCTYPE,
    rfq: rfqName,
    scored_at: result.scored_at,
    price_weight: result.weights.price_weight,
    delivery_weight: result.weights.delivery_weight,
    quality_weight: result.weights.quality_weight,
    reliability_weight: result.weights.reliability_weight,
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
