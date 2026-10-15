/**
 * Backend single source of truth for AI Model configuration in BidSphere server functions.
 *
 * Current production model: Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`).
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";

export function getAnthropicModel(): string {
  const envModel = process.env.ANTHROPIC_MODEL;
  if (envModel && typeof envModel === "string" && envModel.trim()) {
    return envModel.trim();
  }
  return DEFAULT_ANTHROPIC_MODEL;
}

export const ANTHROPIC_MODEL = getAnthropicModel();

