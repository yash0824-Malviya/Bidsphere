/**
 * Single source of truth for AI Model configuration across BidSphere.
 *
 * Current production model: Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`).
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";

/**
 * Resolves the configured Anthropic model from environment variables
 * with a fallback to the default production model.
 */
export function getAnthropicModel(): string {
  if (typeof process !== "undefined" && process.env) {
    const envModel = process.env.ANTHROPIC_MODEL;
    if (envModel && typeof envModel === "string" && envModel.trim()) {
      return envModel.trim();
    }
  }
  try {
    const viteModel = import.meta?.env?.VITE_ANTHROPIC_MODEL;
    if (typeof viteModel === "string" && viteModel.trim()) {
      return viteModel.trim();
    }
  } catch {
    /* ignore if import.meta is not accessible */
  }
  return DEFAULT_ANTHROPIC_MODEL;
}

export const ANTHROPIC_MODEL = getAnthropicModel();

