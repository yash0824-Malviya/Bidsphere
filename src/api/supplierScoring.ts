/**
 * Supplier Scoring Configuration service.
 *
 * "Supplier Scoring Config" is a singleton (Single) DocType — ERPNext stores
 * exactly one instance whose `name` always equals the DocType name itself.
 * All reads and writes target that single document.
 *
 * Validation: all four weights must be non-negative integers that sum to 100.
 */

import {
  apiGet,
  apiPut,
  apiPost,
  buildResourceUrl,
  withSilent,
} from "./erpnext";
import type { SupplierScoringConfig } from "../types/erpnext";
import { DEFAULT_SCORING_WEIGHTS } from "../types/erpnext";

const DOCTYPE = "Supplier Scoring Config";

export type ScoringWeights = Pick<
  SupplierScoringConfig,
  "price_weight" | "delivery_weight" | "quality_weight" | "reliability_weight"
>;

/* -------------------------------------------------------------------------- */
/*  Validation                                                                */
/* -------------------------------------------------------------------------- */

export interface ScoringValidationResult {
  valid: boolean;
  total: number;
  errors: string[];
}

export function validateScoringWeights(
  weights: ScoringWeights
): ScoringValidationResult {
  const errors: string[] = [];
  const fields = [
    { key: "price_weight", label: "Price" },
    { key: "delivery_weight", label: "Delivery" },
    { key: "quality_weight", label: "Quality" },
    { key: "reliability_weight", label: "Reliability" },
  ] as const;

  for (const { key, label } of fields) {
    const v = weights[key];
    if (v == null || !Number.isFinite(v)) {
      errors.push(`${label} weight is required`);
    } else if (v < 0) {
      errors.push(`${label} weight cannot be negative`);
    } else if (!Number.isInteger(v)) {
      errors.push(`${label} weight must be a whole number`);
    }
  }

  const total =
    (weights.price_weight ?? 0) +
    (weights.delivery_weight ?? 0) +
    (weights.quality_weight ?? 0) +
    (weights.reliability_weight ?? 0);

  if (errors.length === 0 && total !== 100) {
    errors.push(`Weights must total 100 (currently ${total})`);
  }

  return { valid: errors.length === 0, total, errors };
}

/* -------------------------------------------------------------------------- */
/*  API                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Fetch the current scoring configuration.
 *
 * For a Single DocType the resource URL is `/api/resource/<Doctype>/<Doctype>`.
 * If the document doesn't exist yet (first use), returns the defaults.
 */
export async function getScoringConfig(): Promise<SupplierScoringConfig> {
  try {
    return await apiGet<SupplierScoringConfig>(
      buildResourceUrl(DOCTYPE, DOCTYPE),
      withSilent()
    );
  } catch {
    return {
      name: DOCTYPE,
      ...DEFAULT_SCORING_WEIGHTS,
    };
  }
}

/**
 * Save (create or update) the scoring configuration.
 *
 * Validates weights before sending — throws if they don't sum to 100.
 * Tries PUT first (update existing); falls back to POST (first save).
 */
export async function saveScoringConfig(
  weights: ScoringWeights
): Promise<SupplierScoringConfig> {
  const result = validateScoringWeights(weights);
  if (!result.valid) {
    throw new Error(result.errors[0]);
  }

  const payload = {
    doctype: DOCTYPE,
    ...weights,
  };

  try {
    return await apiPut<SupplierScoringConfig>(
      buildResourceUrl(DOCTYPE, DOCTYPE),
      payload
    );
  } catch {
    return await apiPost<SupplierScoringConfig>(
      buildResourceUrl(DOCTYPE),
      payload
    );
  }
}

export { DEFAULT_SCORING_WEIGHTS };
