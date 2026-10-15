import fs from "fs";

const env = fs.readFileSync(".env", "utf8");
const m = env.match(/ANTHROPIC_API_KEY\s*=\s*([^\r\n]+)/);
const apiKey = m ? m[1].trim() : "";

async function testMessages(model) {
  console.log(`Testing model: ${model}`);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 10,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    console.log(`Status for ${model}:`, res.status, res.statusText);
    const data = await res.json();
    console.log(`Response for ${model}:`, JSON.stringify(data));
  } catch (err) {
    console.error(`Error for ${model}:`, err.message);
  }
}

async function run() {
  await testMessages("claude-3-5-sonnet-20241022");
  await testMessages("claude-3-7-sonnet-20250219");
  await testMessages("claude-3-5-haiku-20241022");
}

run();
