import fs from "fs";

const env = fs.readFileSync(".env", "utf8");
const m = env.match(/ANTHROPIC_API_KEY\s*=\s*([^\r\n]+)/);
if (m) {
  const raw = m[1];
  console.log("raw length:", raw.length, "trimmed length:", raw.trim().length);
  console.log("starts with quote:", raw.startsWith('"') || raw.startsWith("'"));
  console.log("ends with quote:", raw.endsWith('"') || raw.endsWith("'"));
  console.log("contains whitespace inside:", /\s/.test(raw.trim()));
  console.log("first 14 chars:", raw.trim().slice(0, 14));
  console.log("last 4 chars:", raw.trim().slice(-4));
} else {
  console.log("No ANTHROPIC_API_KEY found in .env");
}
