import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const origin = "http://localhost:5175";
const routes = [
  "/sourcing/rfp/RFP-2026-00001",
  "/sourcing/rfp/RFP-2026-00001/responses/th43q445a1",
];
const moduleRoot = "/src/pages/sourcing/RFPResponseDetailPage.tsx";
const failures = [];

const pagePath = path.join(process.cwd(), moduleRoot.slice(1));
assert.ok(
  fs.readdirSync(path.dirname(pagePath)).includes(path.basename(pagePath)),
  "Response page filename must match the route import casing exactly.",
);
const pageSource = ts.createSourceFile(
  pagePath,
  fs.readFileSync(pagePath, "utf8"),
  ts.ScriptTarget.Latest,
  false,
  ts.ScriptKind.TSX,
);
assert.ok(
  pageSource.statements.some(
    (node) =>
      ts.isExportAssignment(node) ||
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword),
  ),
  "React.lazy response page must provide a default export.",
);

for (const route of routes) {
  const response = await fetch(new URL(route, origin));
  console.log(JSON.stringify({ route, status: response.status }));
  if (!response.ok) failures.push({ route, status: response.status });
  await response.arrayBuffer();
}

const visited = new Set();
const queue = [moduleRoot];
while (queue.length) {
  const batch = queue.splice(0, 8).filter((url) => !visited.has(url));
  batch.forEach((url) => visited.add(url));
  await Promise.all(
    batch.map(async (url) => {
      try {
        const response = await fetch(new URL(url, origin));
        const body = await response.text();
        if (!response.ok) {
          failures.push({ module: url, status: response.status, reason: response.statusText });
          return;
        }
        if (!String(response.headers.get("content-type")).includes("javascript")) {
          failures.push({ module: url, reason: "Module response is not JavaScript." });
          return;
        }
        const source = ts.createSourceFile(url, body, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
        for (const node of source.statements) {
          if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
          if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
          const specifier = node.moduleSpecifier.text;
          if (!specifier.startsWith("/") && !specifier.startsWith("./") && !specifier.startsWith("../")) continue;
          const dependency = new URL(specifier, new URL(url, origin));
          if (dependency.origin !== origin) continue;
          const next = dependency.pathname + dependency.search;
          if (!visited.has(next) && !queue.includes(next)) queue.push(next);
        }
      } catch (error) {
        failures.push({ module: url, reason: error.message });
      }
    }),
  );
  assert.ok(visited.size <= 700, "Unexpected module graph size.");
}

const workerPath = "/node_modules/pdfjs-dist/build/pdf.worker.min.mjs";
const worker = await fetch(new URL(workerPath, origin));
if (!worker.ok) failures.push({ module: workerPath, status: worker.status });
await worker.arrayBuffer();

console.log(JSON.stringify({
  result: failures.length ? "FAIL" : "PASS",
  moduleRoot,
  moduleCount: visited.size,
  pdfWorkerStatus: worker.status,
  exactFilenameCase: true,
  defaultExport: true,
  optimizerMetadataPresent: fs.existsSync("node_modules/.vite/deps/_metadata.json"),
  failures,
}));
process.exitCode = failures.length ? 1 : 0;
