import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    console.warn("[test-claude-api] .env file not found at project root.");
    return;
  }
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv();

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

async function verifyClaudeConfig() {
  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  const model = (process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022").trim();
  const workspaceId = (process.env.ANTHROPIC_WORKSPACE_ID || "").trim();

  console.log("=== BidSphere Claude Configuration Verification ===");
  console.log("ANTHROPIC_API_KEY configured:", apiKey ? `Yes (length: ${apiKey.length}, prefix: ${apiKey.slice(0, 7)}...)` : "NO (MISSING)");
  console.log("ANTHROPIC_MODEL configured:   ", model);
  console.log("ANTHROPIC_WORKSPACE_ID:       ", workspaceId ? `Yes (format: ${workspaceId.startsWith("wrkspc_") ? "Valid wrkspc_" : "INVALID FORMAT"})` : "None (Single-workspace / not required)");

  if (!apiKey) {
    console.error("\n[ERROR] ANTHROPIC_API_KEY is not set in .env. Enter your valid key and retry.");
    process.exit(1);
  }

  if (workspaceId && !/^wrkspc_[a-zA-Z0-9]+$/.test(workspaceId)) {
    console.error("\n[ERROR] ANTHROPIC_WORKSPACE_ID must start with 'wrkspc_' followed by alphanumeric characters.");
    process.exit(1);
  }

  // 1. Direct provider authentication & model compatibility test
  console.log("\n1. Testing direct Anthropic provider authentication & model compatibility...");
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (workspaceId) {
    headers["anthropic-workspace-id"] = workspaceId;
    console.log("   -> Attached request header: anthropic-workspace-id");
  }

  try {
    const startTime = Date.now();
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with {\"status\":\"ok\"} in JSON." }],
      }),
    });
    const latency = Date.now() - startTime;
    console.log(`   Provider HTTP Status: ${res.status} ${res.statusText} (${latency}ms)`);

    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log("   [SUCCESS] Anthropic authentication succeeded!");
      console.log("   Active Model:", json.model || model);
      console.log("   Token Usage: ", json.usage);
      const text = json.content?.[0]?.text;
      console.log("   Response:    ", text?.trim());
    } else {
      console.error("   [FAILURE] Anthropic rejected request:", json.error || json);
      if (res.status === 401) {
        console.error("   -> Reason: Authentication error (401). Check that ANTHROPIC_API_KEY is valid and active in Anthropic Console.");
      } else if (res.status === 403) {
        console.error("   -> Reason: Authorization error (403). Check workspace permissions or ANTHROPIC_WORKSPACE_ID.");
      } else if (res.status === 404) {
        console.error(`   -> Reason: Model '${model}' not found (404). Check ANTHROPIC_MODEL.`);
      } else if (res.status === 429) {
        console.error("   -> Reason: Rate limit or usage quota exceeded (429).");
      }
    }
  } catch (err) {
    console.error("   [ERROR] Network error reaching Anthropic API server:", err.message);
  }

  // 2. Local dev server endpoint check (if running)
  console.log("\n2. Checking local BidSphere backend endpoint (http://localhost:5175/api/ai/claude)...");
  try {
    const localRes = await fetch("http://localhost:5175/api/ai/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "ping", request_type: "ping" }),
      signal: AbortSignal.timeout(3000),
    });
    console.log(`   Local Gateway HTTP Status: ${localRes.status} ${localRes.statusText}`);
    const localJson = await localRes.json().catch(() => ({}));
    if (localRes.ok && localJson.success) {
      console.log("   [SUCCESS] Local BidSphere AI endpoint operational!");
    } else {
      console.log("   Local Gateway Response:", localJson);
    }
  } catch (err) {
    console.log("   (Local dev server is not currently running on port 5175 — this is normal if Vite is not running)");
  }

  console.log("\n=== Verification Finished ===");
}

verifyClaudeConfig().catch((err) => {
  console.error("Fatal error during verification:", err);
  process.exit(1);
});
