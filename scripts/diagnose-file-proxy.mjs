/**
 * Exercise api/fileProxyCore against a real Legal Review file path.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchErpPdf } from "../api/fileProxyCore.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnv() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const base = (
  process.env.ERPNEXT_URL ||
  process.env.VITE_ERPNEXT_URL ||
  process.env.VITE_PROXY_TARGET ||
  ""
).replace(/\/+$/, "");
const key = process.env.ERP_API_KEY || process.env.VITE_API_KEY || "";
const secret = process.env.ERP_API_SECRET || process.env.VITE_API_SECRET || "";

const paths = process.argv.slice(2);
const targets =
  paths.length > 0
    ? paths
    : ["/private/files/INV 001.pdf", "/files/missing.pdf"];

for (const filePath of targets) {
  console.log("\n=== fetchErpPdf", filePath);
  const withAuth = await fetchErpPdf({
    baseUrl: base,
    filePath,
    apiKey: key,
    apiSecret: secret,
  });
  console.log("WITH_AUTH", {
    ok: withAuth.ok,
    status: withAuth.ok ? withAuth.status : withAuth.status,
    contentType: withAuth.ok ? withAuth.contentType : undefined,
    bytes: withAuth.ok ? withAuth.buffer.byteLength : undefined,
    body: withAuth.ok ? undefined : withAuth.body,
    targetUrl: withAuth.targetUrl,
  });

  const noAuth = await fetchErpPdf({
    baseUrl: base,
    filePath,
    apiKey: "",
    apiSecret: "",
  });
  console.log("NO_AUTH", {
    ok: noAuth.ok,
    status: noAuth.status,
    body: noAuth.ok ? undefined : noAuth.body,
    targetUrl: noAuth.targetUrl,
    preview: noAuth.ok
      ? undefined
      : noAuth.body?.detail,
  });
}
