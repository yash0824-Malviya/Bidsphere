import fs from "fs";

let content = fs.readFileSync("src/api/procurementChat.ts", "utf8");
content = content.replace('"VITE_ANTHROPIC_API_KEY"', '"ANTHROPIC_API_KEY"');
fs.writeFileSync("src/api/procurementChat.ts", content, "utf8");
console.log("Fixed line 91");
