import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
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

async function testClaudeApi() {
  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  console.log("ANTHROPIC_API_KEY present:", !!apiKey, "Length:", apiKey.length);
  console.log("ANTHROPIC_MODEL:", process.env.ANTHROPIC_MODEL);

  const endpoint = "http://localhost:5175/api/ai/claude";
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Say hello in JSON format: {\"greeting\": \"hello\"}",
      }),
    });
    console.log("Response status:", res.status, res.statusText);
    const text = await res.text();
    console.log("Response body:", text);
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

testClaudeApi();
