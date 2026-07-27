/**
 * Provisions Target Pricing custom fields for BidSphere RFQs.
 *
 * Creates / updates:
 *   1. custom_target_price on Request for Quotation Item (Currency, allow_on_submit)
 *   2. custom_show_target_price_to_supplier on Request for Quotation Item (Check, allow_on_submit)
 *   3. custom_show_target_price_to_supplier on Request for Quotation (Check, allow_on_submit)
 *      — legacy header OR-flag for backward compatibility / PDF helpers
 *
 * Usage: node scripts/setup-rfq-target-price.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvFile() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const baseUrl = (
  process.env.ERPNEXT_URL ??
  process.env.VITE_ERPNEXT_URL ??
  process.env.VITE_PROXY_TARGET ??
  ""
).replace(/\/+$/, "");
const apiKey = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const apiSecret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

if (!baseUrl || !apiKey || !apiSecret) {
  console.error("Missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET");
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `token ${apiKey}:${apiSecret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.exc_type ?? data?._server_messages ?? text;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return data?.data ?? data?.message ?? data;
}

async function getCustomField(cfName) {
  try {
    return await api(
      "GET",
      `/api/resource/${encodeURIComponent("Custom Field")}/${encodeURIComponent(cfName)}`,
    );
  } catch {
    return null;
  }
}

async function ensureCustomField(payload) {
  const cfName = `${payload.dt}-${payload.fieldname}`;
  console.log(`\nCustom Field ${payload.fieldname} on ${payload.dt} …`);
  const existing = await getCustomField(cfName);
  if (existing) {
    const needsAllow =
      !existing.allow_on_submit ||
      existing.allow_on_submit === 0 ||
      existing.allow_on_submit === "0";
    if (needsAllow) {
      await api(
        "PUT",
        `/api/resource/${encodeURIComponent("Custom Field")}/${encodeURIComponent(cfName)}`,
        { allow_on_submit: 1 },
      );
      console.log("  ✓ Updated allow_on_submit = 1");
    } else {
      console.log("  ✓ Already exists (allow_on_submit enabled)");
    }
    return;
  }
  await api("POST", "/api/resource/Custom Field", {
    doctype: "Custom Field",
    allow_on_submit: 1,
    ...payload,
  });
  console.log("  ✓ Created (allow_on_submit = 1)");
}

async function main() {
  console.log("BidSphere RFQ Target Pricing setup");
  console.log(`ERPNext: ${baseUrl}`);

  await ensureCustomField({
    dt: "Request for Quotation Item",
    fieldname: "custom_target_price",
    label: "Target Price",
    fieldtype: "Currency",
    insert_after: "uom",
    allow_on_submit: 1,
    description:
      "Target unit price set during RFQ creation. Used for variance / savings analysis.",
  });

  await ensureCustomField({
    dt: "Request for Quotation Item",
    fieldname: "custom_show_target_price_to_supplier",
    label: "Show Target Price to Supplier",
    fieldtype: "Check",
    insert_after: "custom_target_price",
    default: "0",
    allow_on_submit: 1,
    description:
      "When enabled for this line, Target Price is visible to invited suppliers.",
  });

  await ensureCustomField({
    dt: "Request for Quotation",
    fieldname: "custom_show_target_price_to_supplier",
    label: "Show Target Price to Supplier",
    fieldtype: "Check",
    insert_after: "message_for_supplier",
    default: "0",
    allow_on_submit: 1,
    description:
      "Legacy RFQ-level OR flag. Prefer per-item custom_show_target_price_to_supplier.",
  });

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
