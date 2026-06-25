/**
 * Shared loading-step labels for the AI Procurement analysis.
 *
 * Kept in its own tiny module so the RFQ detail page can read the step count
 * without statically importing (and therefore bundling) the heavy
 * `AIAnalysisModal`, which is loaded lazily.
 */
export const ANALYSIS_STEPS = [
  "Comparing prices",
  "Evaluating delivery timelines",
  "Reviewing supplier performance",
  "Calculating recommendation score",
] as const;
