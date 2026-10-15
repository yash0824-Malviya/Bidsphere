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
import type { AIRecommendation, SupplierScoringResult } from "../types/erpnext";
import type { ScoringEngineResult } from "./supplierScoringEngine";
import { toScoreRows } from "./supplierScoringEngine";
import { findRecommendationWinner, normalizeAndDeduplicateRecommendation } from "../utils/aiRecommendationNormalization";
import { applyEvaluationDecisionProjection } from "../utils/aiEvaluationDecision";

const DOCTYPE = "Supplier Scoring Result";
const CHILD_DOCTYPE = "Supplier Score Row";

function snapshotAnalysis(snapshot: unknown): AIRecommendation | undefined {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const record = snapshot as Record<string, unknown>;
  const analysis = (record.analysis ?? record) as AIRecommendation;
  return Array.isArray(analysis.supplier_analysis) ? analysis : undefined;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)));
  });
}

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
  const scoreRows = toScoreRows(result.suppliers);
  const supplierIds = scoreRows.map((row) => row.supplier.trim());
  if (supplierIds.some((id) => !id) || new Set(supplierIds).size !== supplierIds.length) {
    throw new Error("Cannot persist ambiguous or duplicate supplier scoring identities.");
  }
  const analysis = snapshotAnalysis(snapshot);
  const snapshotRecord = snapshot && typeof snapshot === "object"
    ? snapshot as Record<string, unknown> : undefined;
  if ((snapshotRecord?.rfq_name && snapshotRecord.rfq_name !== rfqName) ||
      (analysis?.rfq_id && analysis.rfq_id !== rfqName)) {
    throw new Error("Cannot persist an evaluation under a different RFQ.");
  }
  const winner = analysis ? findRecommendationWinner(analysis) : undefined;
  if (analysis && !winner) throw new Error("Cannot persist an evaluation without an unambiguous recommended supplier.");
  const projectedAnalysis = analysis && winner ? applyEvaluationDecisionProjection({
    ...analysis,
    recommended_quotation_id: winner.quotation_id || winner.supplier_quotation_id,
    recommended_supplier_id: winner.supplier_id,
  }) : undefined;
  const persistedSnapshot = projectedAnalysis
    ? snapshotRecord?.analysis ? { ...snapshotRecord, analysis: projectedAnalysis } : projectedAnalysis
    : snapshot;
  const engineWinner = winner
    ? result.suppliers.find((row) => winner.supplier_id
      ? row.supplier === winner.supplier_id : row.supplier_name === winner.name)
    : undefined;
  const recommendedSupplier = winner?.supplier_id || engineWinner?.supplier || topRanked?.supplier || "";

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
    recommended_supplier: recommendedSupplier,
    ...(snapshot !== undefined
      ? { analysis_snapshot: JSON.stringify(persistedSnapshot) }
      : {}),
    supplier_scores: scoreRows.map((row) => ({
      doctype: CHILD_DOCTYPE,
      ...row,
    })),
  };

  const created = await apiPost<SupplierScoringResult>(
    buildResourceUrl(DOCTYPE),
    payload,
    withSilent()
  );
  if (!created?.name) throw new Error("ERPNext did not return the saved scoring result identity.");
  const persisted = await apiGet<SupplierScoringResult>(
    buildResourceUrl(DOCTYPE, created.name), withSilent(),
  );
  if (persisted.rfq !== rfqName || persisted.recommended_supplier !== recommendedSupplier) {
    throw new Error("Saved scoring result RFQ or recommended supplier failed verification.");
  }
  if (snapshot !== undefined) {
    let savedSnapshot: unknown;
    try { savedSnapshot = JSON.parse(persisted.analysis_snapshot ?? ""); }
    catch { throw new Error("ERPNext did not retain the evaluation snapshot."); }
    if (canonicalJson(savedSnapshot) !== canonicalJson(persistedSnapshot)) {
      throw new Error("Saved evaluation snapshot differs from the completed evaluation.");
    }
  }
  const savedRows = persisted.supplier_scores ?? [];
  const savedBySupplier = new Map(savedRows.map((row) => [row.supplier, row]));
  const numericFields = ["price_score", "delivery_score", "quality_score", "reliability_score", "final_score", "ranking"] as const;
  if (savedRows.length !== scoreRows.length || savedBySupplier.size !== scoreRows.length ||
      scoreRows.some((expected) => {
        const actual = savedBySupplier.get(expected.supplier);
        return !actual || numericFields.some((field) => Number(actual[field]) !== expected[field]);
      })) {
    throw new Error("Saved supplier scores differ from the completed evaluation.");
  }
  if (import.meta.env.DEV) {
    console.debug("[AI EVALUATION DEBUG]", {
      stage: "persisted", rfq: rfqName, record_id: persisted.name,
      evaluation_run_id: analysis?.evaluation_run_id,
      suppliers: analysis?.supplier_analysis.map((row) => ({
        quotation_id: row.quotation_id, supplier_id: row.supplier_id,
        evaluation_run_id: row.evaluation_run_id, score: row.score,
        risk: row.risk, verdict: row.verdict,
      })),
    });
  }
  return persisted;
}

function sanitizeSnapshotRecord<T = unknown>(parsed: T, rfqName: string): T | null {
  if (!parsed || typeof parsed !== "object") return null;
  const s = parsed as Record<string, unknown>;
  if (s.rfq_name && s.rfq_name !== rfqName) return null;
  const analysis = snapshotAnalysis(parsed);
  if (!analysis) return null;
  const normalized = normalizeAndDeduplicateRecommendation({
    recommendation: analysis, authoritativeQuotes: [], rfqId: rfqName,
    evaluationRunId: typeof s.evaluation_run_id === "string" ? s.evaluation_run_id : analysis.evaluation_run_id,
  });
  if (!normalized.supplier_analysis.length) return null;
  // Normalize once using the same stable identity/run rules as the frontend.
  // Project risk, verdict and decision guidance from that same saved evaluation.
  if (!s.analysis) return normalized as T;
  return {
    ...s,
    recommended_supplier: normalized.recommended_supplier,
    confidence_score: normalized.confidence_score,
    analysis: normalized,
  } as T;
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
    const raw = JSON.parse(result.analysis_snapshot);
    return sanitizeSnapshotRecord<T>(raw, rfqName);
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
        order_by: "scored_at desc, creation desc",
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
        order_by: "scored_at desc, creation desc",
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
