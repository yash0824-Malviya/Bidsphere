import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAnthropicModel } from "./aiConfig.ts";
import {
  calculateWeightedEvaluationScore,
  validateAndScoreEvaluation,
  type EvaluationContext,
} from "../src/utils/aiEvaluationScore.ts";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface ClaudeRequestBody {
  prompt?: string;
  system?: string;
  messages?: Array<{ role: string; content: string }>;
  max_tokens?: number;
  rfq_id?: string;
  request_type?: "recommendation" | "chat" | string;
  evaluation_context?: EvaluationContext;
  evaluation_debug?: {
    enabled?: boolean;
    evaluation_run_id?: string;
  };
}

class EvaluationValidationError extends Error {
  readonly statusCode = 422;
}

/** Validate the caller's current quotation set before spending a provider call. */
function validateEvaluationContext(body: ClaudeRequestBody): EvaluationContext | undefined {
  const context = body.evaluation_context;
  if (context === undefined) return undefined;
  const invalid = (message: string): never => {
    throw new EvaluationValidationError(`AI evaluation incomplete: ${message}`);
  };
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return invalid("evaluation context is invalid.");
  }
  const nonempty = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
  if (!nonempty(context.rfq_id) || context.rfq_id !== body.rfq_id ||
      !nonempty(context.evaluation_run_id)) {
    return invalid("RFQ or evaluation run identity is missing or mismatched.");
  }
  if (body.evaluation_debug?.enabled === true &&
      body.evaluation_debug.evaluation_run_id !== context.evaluation_run_id) {
    return invalid("diagnostic run identity does not match the current evaluation.");
  }
  if (!Array.isArray(context.quotations) || context.quotations.length === 0) {
    return invalid("current quotation identities are required.");
  }
  const quotationIds = new Set<string>();
  const supplierIds = new Set<string>();
  for (const quote of context.quotations) {
    if (!quote || typeof quote !== "object" ||
        !nonempty(quote.quotation_id) || !nonempty(quote.supplier_id) ||
        !nonempty(quote.supplier_name) || quotationIds.has(quote.quotation_id) ||
        supplierIds.has(quote.supplier_id) ||
        (quote.total_value !== null && (typeof quote.total_value !== "number" ||
          !Number.isFinite(quote.total_value) || quote.total_value < 0))) {
      return invalid("each current quotation requires unique quotation/supplier IDs and valid pricing availability.");
    }
    quotationIds.add(quote.quotation_id);
    supplierIds.add(quote.supplier_id);
  }
  try {
    calculateWeightedEvaluationScore({
      price_score: 0,
      delivery_score: 0,
      quality_score: 0,
      reliability_score: 0,
    }, context.weights);
  } catch {
    return invalid("all four configured weights must be non-negative integers totaling 100.");
  }
  return context;
}

function scoreEvaluationResponse(
  rawText: string,
  stopReason: string | null,
  context: EvaluationContext,
): string {
  if (stopReason === "max_tokens") {
    throw new EvaluationValidationError("AI evaluation incomplete: Claude response was truncated.");
  }
  try {
    const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    // Capture the actual provider summary before normalization. An older saved
    // evaluation may contain backend-generated text and cannot supply this provenance.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      parsed.provider_summary = typeof parsed.summary === "string" ? parsed.summary : undefined;
    }
    // Only the provider's actual score is the raw score. Do not trust a model
    // field that claims a different pre-calculation score.
    if (parsed && Array.isArray(parsed.ranking)) {
      parsed.ranking = parsed.ranking.map((row: unknown) =>
        row && typeof row === "object" && !Array.isArray(row)
          ? { ...row, raw_ai_score: (row as Record<string, unknown>).score }
          : row,
      );
    }
    return JSON.stringify(validateAndScoreEvaluation(parsed, context));
  } catch (error) {
    throw new EvaluationValidationError(
      error instanceof SyntaxError
        ? "AI evaluation incomplete: Claude did not return valid evaluation JSON."
        : error instanceof Error ? error.message : "AI evaluation incomplete.",
    );
  }
}

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeResult {
  text: string;
  tokensUsed: number;
  /** Provider-reported model; requested model for older responses without it. */
  model: string;
  requestedModel: string;
  stopReason: string | null;
  usage: ClaudeUsage;
  evaluation_debug?: {
    rfq_id: string | null;
    evaluation_run_id: string;
    request: Record<string, unknown>;
    response: {
      model: string | null;
      stop_reason: string | null;
      usage: ClaudeUsage;
      text: string;
    };
  };
}

export class ClaudeApiError extends Error {
  readonly statusCode: number;
  readonly errorType?: string;
  readonly isRetryable: boolean;

  constructor(
    message: string,
    statusCode = 500,
    errorType?: string,
    isRetryable = false,
  ) {
    super(message);
    this.name = "ClaudeApiError";
    this.statusCode = statusCode;
    this.errorType = errorType;
    this.isRetryable = isRetryable;
  }
}

export async function handleClaudeRequest(
  body: ClaudeRequestBody,
): Promise<ClaudeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  if (!apiKey) {
    throw new ClaudeApiError(
      "Anthropic API key is not configured on the BidSphere server (ANTHROPIC_API_KEY missing).",
      401,
      "authentication_error",
      false,
    );
  }

  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  if (workspaceId && !/^wrkspc_[a-zA-Z0-9]+$/.test(workspaceId)) {
    throw new ClaudeApiError(
      "Invalid ANTHROPIC_WORKSPACE_ID format. Workspace ID must start with 'wrkspc_'.",
      400,
      "invalid_request_error",
      false,
    );
  }

  const messages =
    Array.isArray(body.messages) && body.messages.length > 0
      ? body.messages
      : body.prompt && typeof body.prompt === "string"
      ? [{ role: "user", content: body.prompt }]
      : null;

  if (!messages) {
    throw new ClaudeApiError(
      "Missing or invalid 'prompt' or 'messages' field in request body.",
      400,
      "invalid_request_error",
      false,
    );
  }
  const evaluationContext = validateEvaluationContext(body);

  const model = getAnthropicModel();
  const maxTokens = Math.min(Math.max(Number(body.max_tokens) || 2048, 256), 4096);
  const startTime = Date.now();

  const payload: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    temperature: 0,
    messages,
  };
  if (body.system && typeof body.system === "string") {
    payload.system = body.system;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (workspaceId) {
    headers["anthropic-workspace-id"] = workspaceId;
  }

  const MAX_RETRIES = 2; // Bounded retries: 1 initial attempt + up to 2 retries
  let attempt = 0;
  let response: Response | undefined;
  let responseJson: {
    model?: string;
    stop_reason?: string | null;
    content?: Array<{ type: string; text?: string }>;
    usage?: ClaudeUsage;
    error?: { message?: string; type?: string };
  } | undefined;

  while (attempt <= MAX_RETRIES) {
    attempt++;
    try {
      response = await fetch(ANTHROPIC_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      try {
        responseJson = (await response.json()) as typeof responseJson;
      } catch {
        responseJson = undefined;
      }

      if (response.ok) {
        break;
      }

      const status = response.status;
      const isRetryable = [429, 500, 502, 503, 504, 529].includes(status);
      if (isRetryable && attempt <= MAX_RETRIES) {
        const backoffMs = attempt * 500;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      const errMsg = responseJson?.error?.message || response.statusText || "Anthropic error";
      const errType = responseJson?.error?.type || "api_error";
      let formattedMsg = `Claude API error (${status}): ${errMsg}`;

      if (status === 401) {
        formattedMsg = `Claude API authentication failed (401): ${errMsg}. Please verify ANTHROPIC_API_KEY.`;
      } else if (status === 403) {
        formattedMsg = `Claude API authorization failed (403): ${errMsg}. Please verify ANTHROPIC_API_KEY permissions and ANTHROPIC_WORKSPACE_ID.`;
      } else if (status === 404) {
        formattedMsg = `Claude API model or resource not found (404): ${errMsg}. Verify ANTHROPIC_MODEL ('${model}').`;
      } else if (status === 429) {
        formattedMsg = `Claude API rate limit or quota exceeded (429): ${errMsg}.`;
      } else if (status >= 500) {
        formattedMsg = `Anthropic provider service error (${status}): ${errMsg}.`;
      }

      if (process.env.NODE_ENV === "development") {
        // eslint-disable-next-line no-console
        console.error("[AI Server] Anthropic API returned failure:", {
          status,
          model,
          request_type: body.request_type || "general",
          rfq_id: body.rfq_id || "N/A",
          latency_ms: Date.now() - startTime,
          error: errMsg,
        });
      }

      throw new ClaudeApiError(formattedMsg, status, errType, isRetryable);
    } catch (fetchErr) {
      if (fetchErr instanceof ClaudeApiError || fetchErr instanceof EvaluationValidationError) {
        throw fetchErr;
      }
      if (attempt <= MAX_RETRIES) {
        const backoffMs = attempt * 500;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      const latency = Date.now() - startTime;
      if (process.env.NODE_ENV === "development") {
        // eslint-disable-next-line no-console
        console.error("[AI Server] Network error contacting Anthropic:", {
          model,
          request_type: body.request_type || "general",
          rfq_id: body.rfq_id || "N/A",
          latency_ms: latency,
          error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
        });
      }
      throw new ClaudeApiError(
        `Failed to reach Anthropic API server: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
        502,
        "network_error",
        true,
      );
    }
  }

  if (!response || !response.ok || !responseJson) {
    throw new ClaudeApiError("Failed to obtain response from Anthropic API.", 500, "api_error", false);
  }

  const json = responseJson;
  const latency = Date.now() - startTime;
  const textBlock = json.content?.find((c) => c.type === "text" && c.text);
  if (!textBlock?.text) {
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.error("[AI Server] Claude returned empty content:", {
        model,
        request_type: body.request_type || "general",
        rfq_id: body.rfq_id || "N/A",
        latency_ms: latency,
      });
    }
    throw new ClaudeApiError("Claude returned no text content.", 502, "empty_content_error", false);
  }

  const tokensUsed =
    (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0);
  const responseModel = typeof json.model === "string" && json.model.trim()
    ? json.model
    : null;
  const stopReason = typeof json.stop_reason === "string" ? json.stop_reason : null;
  const usage = json.usage ?? {};

  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.log("[AI Server] Claude request completed successfully:", {
      model: responseModel ?? model,
      requested_model: model,
      stop_reason: stopReason,
      request_type: body.request_type || "general",
      rfq_id: body.rfq_id || "N/A",
      tokens_used: tokensUsed,
      latency_ms: latency,
    });
  }

  const result: ClaudeResult = {
    text: evaluationContext
      ? scoreEvaluationResponse(textBlock.text, stopReason, evaluationContext)
      : textBlock.text,
    tokensUsed,
    model: responseModel ?? model,
    requestedModel: model,
    stopReason,
    usage,
  };

  // Explicitly opt in for a single development evaluation. Keep quotation
  // contents out of production diagnostics and never capture request headers.
  const runId = body.evaluation_debug?.evaluation_run_id;
  if (
    process.env.NODE_ENV === "development" &&
    body.evaluation_debug?.enabled === true &&
    typeof runId === "string" &&
    runId.trim()
  ) {
    result.evaluation_debug = {
      rfq_id: typeof body.rfq_id === "string" ? body.rfq_id : null,
      evaluation_run_id: runId.trim(),
      request: payload,
      response: {
        model: responseModel,
        stop_reason: stopReason,
        usage,
        text: textBlock.text,
      },
    };
  }

  return result;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({
      success: false,
      message: "Method Not Allowed. Use POST /api/ai/claude.",
    });
    return;
  }

  try {
    let body = req.body as ClaudeRequestBody;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json({ success: false, message: "Invalid JSON body." });
        return;
      }
    }

    const result = await handleClaudeRequest(body || {});
    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI request failed.";
    const statusCode =
      err instanceof EvaluationValidationError
        ? err.statusCode
        : err instanceof ClaudeApiError
        ? err.statusCode
        : 500;
    res.status(statusCode).json({
      success: false,
      message,
      ...(err instanceof ClaudeApiError && err.errorType ? { errorType: err.errorType } : {}),
    });
  }
}

