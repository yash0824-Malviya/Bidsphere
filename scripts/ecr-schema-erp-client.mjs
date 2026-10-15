import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Deployment scripts only. Credentials are never included in diagnostics. */
export function createEcrSchemaErpClient() {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(envPath)) for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  const base = (process.env.ERPNEXT_URL ?? process.env.VITE_PROXY_TARGET ?? process.env.VITE_ERPNEXT_URL ?? "").replace(/\/+$/, "").replace(/\/api$/, "");
  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY;
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET;
  if (!base || !key || !secret) throw new Error("Missing ERPNext URL or API credentials.");
  return async (method, path, body) => {
    const response = await fetch(`${base}/api/${path}`, {
      method, headers: { Authorization: `token ${key}:${secret}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof payload.exception === "string" ? payload.exception : payload.exc_type || "";
      const error = new Error(`ERP ${method} ${path.split("?")[0]} returned ${response.status}${detail ? `: ${detail}` : ""}.`);
      error.status = response.status;
      throw error;
    }
    return payload.data ?? payload.message ?? payload;
  };
}

export const ecrSchemaResource = (doctype, name) => `resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ""}`;

export async function listAllEcrSchemaRows(api, doctype, fields, filters = []) {
  const result = [];
  for (let start = 0; ; start += 200) {
    const params = new URLSearchParams({ fields: JSON.stringify(fields), filters: JSON.stringify(filters), limit_start: String(start), limit_page_length: "200", order_by: "name asc" });
    const rows = await api("GET", `${ecrSchemaResource(doctype)}?${params}`);
    if (!Array.isArray(rows)) throw new Error(`Unexpected ${doctype} list response.`);
    result.push(...rows);
    if (rows.length < 200) return result;
  }
}
