import fs from "node:fs";
import path from "node:path";

/**
 * Backend single source of truth for AI Model configuration in BidSphere server functions.
 *
 * Current production model: Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`).
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";

function readEnvVarFromDotEnv(key: string): string | undefined {
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return undefined;
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const k = trimmed.slice(0, eqIdx).trim().replace(/^\uFEFF/, "");
      if (k === key) {
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        return val;
      }
    }
  } catch {
    // ignore file read error
  }
  return undefined;
}

export function getAnthropicModel(): string {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
  }
  const fileModel = readEnvVarFromDotEnv("ANTHROPIC_MODEL")?.trim();
  if (fileModel) {
    process.env.ANTHROPIC_MODEL = fileModel;
    return fileModel;
  }
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
}

export function getAnthropicApiKey(): string {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return process.env.ANTHROPIC_API_KEY?.trim() || "";
  }
  const fileKey = readEnvVarFromDotEnv("ANTHROPIC_API_KEY")?.trim();
  if (fileKey) {
    process.env.ANTHROPIC_API_KEY = fileKey;
    return fileKey;
  }
  return process.env.ANTHROPIC_API_KEY?.trim() || "";
}

export function getAnthropicWorkspaceId(): string | undefined {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return process.env.ANTHROPIC_WORKSPACE_ID?.trim() || undefined;
  }
  const fileWs = readEnvVarFromDotEnv("ANTHROPIC_WORKSPACE_ID")?.trim();
  if (fileWs) {
    process.env.ANTHROPIC_WORKSPACE_ID = fileWs;
    return fileWs;
  }
  return process.env.ANTHROPIC_WORKSPACE_ID?.trim() || undefined;
}

export const ANTHROPIC_MODEL = getAnthropicModel();

