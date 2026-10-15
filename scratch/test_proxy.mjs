import fetch from "node-fetch";

async function testClaudeProxy() {
  const res = await fetch("http://localhost:5175/api/ai/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "Respond with exactly: {\"status\":\"ok\"}",
      rfq_id: "PUR-RFQ-2026-00089",
      request_type: "recommendation",
    }),
  });
  console.log("Status:", res.status);
  const json = await res.json();
  console.log("Response:", json);
}

testClaudeProxy().catch(console.error);
