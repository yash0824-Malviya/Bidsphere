/**
 * Synchronize BidSphere enterprise UOM master into ERPNext UOM DocType.
 *
 * Usage: node scripts/setup-uom-master.mjs
 *
 * Creates missing UOMs only — never deletes existing UOMs (no data loss).
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
).replace(/\/$/, "");
const apiKey = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
const apiSecret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

/** Keep in sync with src/config/uomMaster.ts ENTERPRISE_UOM_MASTER */
const ENTERPRISE_UOM_MASTER = [
  "Nos",
  "Pcs",
  "Kg",
  "Lb",
  "G",
  "Ton",
  "Ltr",
  "Ml",
  "Gal",
  "Mtr",
  "Cm",
  "Mm",
  "Ft",
  "In",
  "Sq Ft",
  "Sq Mtr",
  "Cu Ft",
  "Cu Mtr",
  "Box",
  "Carton",
  "Pallet",
  "Roll",
  "Sheet",
  "Coil",
  "Set",
  "Pair",
  "Bag",
  "Drum",
  "Tube",
  "Bottle",
  "Can",
  "Pack",
  "Bundle",
  "Reel",
  "Dozen",
  "Kit",
];

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
    const msg = JSON.stringify(data);
    if (/duplicate|already exists|DuplicateEntryError/i.test(msg)) {
      return { skipped: true };
    }
    throw new Error(`${method} ${path} (${res.status}): ${msg}`);
  }
  return data?.data ?? data?.message ?? data;
}

async function listExistingUoms() {
  try {
    const rows = await api(
      "GET",
      `/api/resource/UOM?fields=${encodeURIComponent(
        JSON.stringify(["name", "uom_name"]),
      )}&limit_page_length=2000`,
    );
    const list = Array.isArray(rows) ? rows : [];
    return new Set(
      list
        .flatMap((r) => [r.name, r.uom_name])
        .map((v) => String(v ?? "").trim().toLowerCase())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

async function ensureUom(name) {
  const existing = await listExistingUoms();
  if (existing.has(name.toLowerCase())) {
    return "exists";
  }
  // Re-check via GET by name (ERP often uses uom_name as name).
  try {
    await api("GET", `/api/resource/UOM/${encodeURIComponent(name)}`);
    return "exists";
  } catch {
    /* create */
  }

  const result = await api("POST", "/api/resource/UOM", {
    doctype: "UOM",
    uom_name: name,
    enabled: 1,
  });
  if (result?.skipped) return "exists";
  return "created";
}

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET");
    process.exit(1);
  }

  console.log("BidSphere Enterprise UOM master sync");
  console.log(`Target: ${baseUrl}`);
  console.log(`Master count: ${ENTERPRISE_UOM_MASTER.length}`);

  let created = 0;
  let existed = 0;
  let failed = 0;

  // Refresh existing set once, then create missing one-by-one.
  const existing = await listExistingUoms();

  for (const uom of ENTERPRISE_UOM_MASTER) {
    if (existing.has(uom.toLowerCase())) {
      existed += 1;
      continue;
    }
    try {
      const status = await ensureUom(uom);
      if (status === "created") {
        created += 1;
        existing.add(uom.toLowerCase());
        console.log(`✓ Created UOM: ${uom}`);
      } else {
        existed += 1;
      }
    } catch (err) {
      failed += 1;
      console.error(`✗ ${uom}:`, err.message);
    }
  }

  console.log("\nDone.", { created, existed, failed, total: ENTERPRISE_UOM_MASTER.length });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
