import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler, { handleClaudeRequest } from "./ai-claude";
import type { EvaluationContext } from "../src/utils/aiEvaluationScore";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const rawText = '{"ranking":[{"quotation_id":"SQ-A","supplier_id":"SUP-A","score":75}]}';

function currentContext(): EvaluationContext {
  return {
    rfq_id: "RFQ-A",
    evaluation_run_id: "run-A",
    weights: { price_weight: 40, delivery_weight: 25, quality_weight: 20, reliability_weight: 15 },
    quotations: ["A", "B", "C"].map((id) => ({
      quotation_id: `SQ-${id}`,
      supplier_id: `SUP-${id}`,
      supplier_name: `Supplier ${id}`,
      total_value: 15,
    })),
  };
}

function evaluationOutput(): Record<string, unknown> & { ranking: Record<string, unknown>[] } {
  return {
    evaluation_run_id: "run-A",
    recommendedSupplier: "Supplier C",
    summary: "Each supplier has its own evaluation.",
    ranking: ["C", "A", "B"].map((id, index) => ({
      quotation_id: `SQ-${id}`,
      supplier_id: `SUP-${id}`,
      supplier: `Supplier ${id}`,
      evaluation_run_id: "run-A",
      rank: index + 1,
      score: 75,
      price_score: id === "C" ? 0 : id === "B" ? 50 : 100,
      delivery_score: id === "C" ? 0 : id === "B" ? 80 : 72,
      quality_score: id === "C" ? 0 : id === "B" ? 90 : 100,
      reliability_score: id === "C" ? 0 : 80,
      risk: "Low",
      verdict: index === 0 ? "BEST VALUE" : "GOOD OPTION",
      reason: `Supplier-specific assessment for ${id}.`,
    })),
  };
}

describe("Claude gateway evaluation diagnostics", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only-api-key");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-haiku-4-5");
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      stop_reason: "end_turn",
      content: [{ type: "text", text: rawText }],
      usage: { input_tokens: 50, output_tokens: 30 },
    }), { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fetchMock.mockReset();
  });

  it("captures the exact request and raw response for one opted-in development run", async () => {
    const result = await handleClaudeRequest({
      prompt: "Evaluate SQ-A for SUP-A independently.",
      system: "Return JSON.",
      rfq_id: "RFQ-A",
      request_type: "recommendation",
      evaluation_debug: { enabled: true, evaluation_run_id: "run-A" },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    const actualPayload = JSON.parse(request.body);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(actualPayload).toEqual({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      temperature: 0,
      messages: [{ role: "user", content: "Evaluate SQ-A for SUP-A independently." }],
      system: "Return JSON.",
    });
    expect(result.text).toBe(rawText);
    expect(result.tokensUsed).toBe(80);
    expect(result.requestedModel).toBe("claude-haiku-4-5");
    expect(result.model).toBe("claude-haiku-4-5-20251001");
    expect(result.stopReason).toBe("end_turn");
    expect(result.evaluation_debug).toEqual({
      rfq_id: "RFQ-A",
      evaluation_run_id: "run-A",
      request: actualPayload,
      response: {
        model: "claude-haiku-4-5-20251001",
        stop_reason: "end_turn",
        usage: { input_tokens: 50, output_tokens: 30 },
        text: rawText,
      },
    });
    expect(JSON.stringify(result)).not.toContain("test-only-api-key");
    expect(JSON.stringify(result)).not.toContain("x-api-key");
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(rawText);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("Evaluate SQ-A");
  });

  it.each(["production", "test"])("never returns the diagnostic envelope in %s", async (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    const result = await handleClaudeRequest({
      prompt: "Private quotation data",
      evaluation_debug: { enabled: true, evaluation_run_id: "run-A" },
    });
    expect(result).not.toHaveProperty("evaluation_debug");
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("Private quotation data");
    expect(result.text).toBe(rawText);
  });

  it.each([
    undefined,
    { enabled: false, evaluation_run_id: "run-A" },
    { enabled: true },
    { enabled: true, evaluation_run_id: "  " },
  ])("requires explicit opt-in and a run ID in development", async (evaluation_debug) => {
    const result = await handleClaudeRequest({ prompt: "Evaluate.", evaluation_debug });
    expect(result).not.toHaveProperty("evaluation_debug");
  });

  it("preserves legacy response handling without claiming provider metadata was supplied", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: "text", text: rawText }],
    }), { status: 200 }));
    const result = await handleClaudeRequest({
      messages: [{ role: "user", content: "Evaluate." }],
      evaluation_debug: { enabled: true, evaluation_run_id: "run-A" },
    });
    expect(result.model).toBe("claude-haiku-4-5");
    expect(result.evaluation_debug?.response.model).toBeNull();
    expect(result.stopReason).toBeNull();
    expect(result.usage).toEqual({});
    expect(result.text).toBe(rawText);
  });

  function mockEvaluation(value: unknown, stopReason = "end_turn") {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      stop_reason: stopReason,
      content: [{ type: "text", text: JSON.stringify(value) }],
    }), { status: 200 }));
  }

  it("recalculates all three independent scores by stable IDs and retains raw model output", async () => {
    const output = evaluationOutput();
    output.ranking[0].raw_ai_score = 99;
    mockEvaluation(output);
    const result = await handleClaudeRequest({
      prompt: "Evaluate the three current quotations.",
      request_type: "recommendation",
      rfq_id: "RFQ-A",
      evaluation_context: currentContext(),
      evaluation_debug: { enabled: true, evaluation_run_id: "run-A" },
    });
    const parsed = JSON.parse(result.text);
    expect(parsed.ranking.map((row: Record<string, unknown>) => [row.quotation_id, row.supplier_id, row.score, row.raw_ai_score]))
      .toEqual([["SQ-A", "SUP-A", 90, 75], ["SQ-B", "SUP-B", 70, 75], ["SQ-C", "SUP-C", 0, 75]]);
    expect(parsed.evaluation_run_id).toBe("run-A");
    expect(parsed.recommendedSupplier).toBe("Supplier A");
    expect(result.evaluation_debug?.response.text).toBe(JSON.stringify(output));
    const actualRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(actualRequest).not.toHaveProperty("evaluation_context");
    expect(actualRequest).not.toHaveProperty("evaluation_debug");
  });

  it("returns the numerical leader with High / AVOID review guidance while retaining exact raw provider output", async () => {
    const output = evaluationOutput();
    const leader = output.ranking.find((row) => row.quotation_id === "SQ-A")!;
    Object.assign(leader, { score: 91, price_score: 100, delivery_score: 100, quality_score: 59,
      reliability_score: 95, risk: "High", verdict: "AVOID", reason: "The supplied quality history requires review." });
    output.recommendedSupplier = "Supplier A";
    output.summary = "Supplier A is recommended without reservations.";
    output.provider_summary = "A model-supplied claim about a different original summary.";
    mockEvaluation(output);
    const result = await handleClaudeRequest({ prompt: "Evaluate.", rfq_id: "RFQ-A", evaluation_context: currentContext(),
      evaluation_debug: { enabled: true, evaluation_run_id: "run-A" } });
    const parsed = JSON.parse(result.text);
    expect(parsed.ranking[0]).toMatchObject({ quotation_id: "SQ-A", supplier_id: "SUP-A", score: 91,
      risk: "High", verdict: "AVOID", is_top_ranked: true, recommendation_status: "REQUIRES_REVIEW" });
    expect(parsed.recommended_quotation_id).toBe("SQ-A");
    expect(parsed.summary).toContain("risk High; verdict AVOID");
    expect(parsed.summary).not.toContain("without reservations");
    expect(parsed.provider_summary).toBe(output.summary);
    expect(result.evaluation_debug?.response.text).toBe(JSON.stringify(output));
  });

  it.each([
    ["missing quality", (out: ReturnType<typeof evaluationOutput>) => { delete out.ranking[0].quality_score; }],
    ["missing overall", (out: ReturnType<typeof evaluationOutput>) => { delete out.ranking[0].score; }],
    ["out-of-range score", (out: ReturnType<typeof evaluationOutput>) => { out.ranking[0].score = 101; }],
    ["mismatched supplier", (out: ReturnType<typeof evaluationOutput>) => { out.ranking[0].supplier_id = "SUP-A"; }],
    ["duplicate quotation", (out: ReturnType<typeof evaluationOutput>) => { out.ranking[0] = { ...out.ranking[1] }; }],
    ["missing quotation", (out: ReturnType<typeof evaluationOutput>) => { out.ranking.pop(); }],
    ["mismatched run", (out: ReturnType<typeof evaluationOutput>) => { out.ranking[0].evaluation_run_id = "older-run"; }],
    ["missing risk", (out: ReturnType<typeof evaluationOutput>) => { delete out.ranking[0].risk; }],
  ])("rejects %s without substituting a score", async (_label, mutate) => {
    const output = evaluationOutput();
    mutate(output);
    mockEvaluation(output);
    await expect(handleClaudeRequest({
      prompt: "Evaluate.", rfq_id: "RFQ-A", evaluation_context: currentContext(),
    })).rejects.toMatchObject({ statusCode: 422 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a provider truncation even if the returned JSON happens to parse", async () => {
    mockEvaluation(evaluationOutput(), "max_tokens");
    await expect(handleClaudeRequest({
      prompt: "Evaluate.", rfq_id: "RFQ-A", evaluation_context: currentContext(),
    })).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining("truncated") });
  });

  it("rejects invalid current identities before contacting Claude", async () => {
    const context = currentContext();
    context.quotations[2].supplier_id = context.quotations[0].supplier_id;
    await expect(handleClaudeRequest({
      prompt: "Evaluate.", rfq_id: "RFQ-A", evaluation_context: context,
    })).rejects.toMatchObject({ statusCode: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires configured weights before contacting Claude", async () => {
    const context = currentContext();
    context.weights.price_weight = 41;
    await expect(handleClaudeRequest({
      prompt: "Evaluate.", rfq_id: "RFQ-A", evaluation_context: context,
    })).rejects.toMatchObject({ statusCode: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a non-retryable HTTP 422 when an evaluation is incomplete", async () => {
    const output = evaluationOutput();
    delete output.ranking[0].quality_score;
    mockEvaluation(output);
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    await handler({
      method: "POST",
      body: { prompt: "Evaluate.", rfq_id: "RFQ-A", evaluation_context: currentContext() },
    } as VercelRequest, response as unknown as VercelResponse);
    expect(response.status).toHaveBeenCalledWith(422);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      message: expect.stringContaining("AI evaluation incomplete"),
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns HTTP 401 when ANTHROPIC_API_KEY is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    await handler({
      method: "POST",
      body: { prompt: "Test prompt" },
    } as VercelRequest, response as unknown as VercelResponse);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining("ANTHROPIC_API_KEY missing"),
      errorType: "authentication_error",
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates HTTP 401 with descriptive message when provider rejects key", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
    }), { status: 401, statusText: "Unauthorized" }));

    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    await handler({
      method: "POST",
      body: { prompt: "Test prompt" },
    } as VercelRequest, response as unknown as VercelResponse);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining("Claude API authentication failed (401)"),
    }));
  });

  it("propagates HTTP 429 when provider rate limits requests", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      type: "error",
      error: { type: "rate_limit_error", message: "Rate limit reached" },
    }), { status: 429, statusText: "Too Many Requests" }));

    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    await handler({
      method: "POST",
      body: { prompt: "Test prompt" },
    } as VercelRequest, response as unknown as VercelResponse);

    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining("rate limit or quota exceeded (429)"),
    }));
  });

  it("propagates HTTP 404 when model ID is invalid", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      type: "error",
      error: { type: "not_found_error", message: "model not found" },
    }), { status: 404, statusText: "Not Found" }));

    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    await handler({
      method: "POST",
      body: { prompt: "Test prompt" },
    } as VercelRequest, response as unknown as VercelResponse);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining("model or resource not found (404)"),
    }));
  });

  it("attaches anthropic-workspace-id header when valid ANTHROPIC_WORKSPACE_ID is set", async () => {
    vi.stubEnv("ANTHROPIC_WORKSPACE_ID", "wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ");

    await handleClaudeRequest({ prompt: "Hello" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["anthropic-workspace-id"]).toBe("wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ");
    expect(headers["x-api-key"]).toBe("test-only-api-key");
  });

  it("does not attach anthropic-workspace-id header when ANTHROPIC_WORKSPACE_ID is unset", async () => {
    vi.stubEnv("ANTHROPIC_WORKSPACE_ID", "");

    await handleClaudeRequest({ prompt: "Hello" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers).not.toHaveProperty("anthropic-workspace-id");
  });

  it("rejects invalid ANTHROPIC_WORKSPACE_ID format before making API calls", async () => {
    vi.stubEnv("ANTHROPIC_WORKSPACE_ID", "invalid_workspace_123");

    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    await handler({
      method: "POST",
      body: { prompt: "Test prompt" },
    } as VercelRequest, response as unknown as VercelResponse);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringContaining("Invalid ANTHROPIC_WORKSPACE_ID format"),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

