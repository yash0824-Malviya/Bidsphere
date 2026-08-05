/**
 * Backfill / correct Procurement Type + Category on ERPNext Items.
 *
 * Usage: node scripts/backfill-item-procurement.mjs
 *
 * Procurement Category master: MRO, CAPEX, OPEX, Production, Engineering,
 * Packaging, Services, Tooling, Facility
 *
 * Item Group stays ERPNext item_group — never overwritten from category.
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

const MASTER = [
  "MRO",
  "CAPEX",
  "OPEX",
  "Production",
  "Engineering",
  "Packaging",
  "Services",
  "Tooling",
  "Facility",
];

const LEGACY_TO_CATEGORY = {
  "raw material": "Production",
  "auto parts": "Production",
  "brake assembly": "Production",
  "engine parts": "Production",
  "transmission assembly": "Production",
  "suspension system": "Production",
  "electrical materials": "Engineering",
  "ignition components": "Engineering",
  products: "Production",
  mechanical: "Production",
  electrical: "Engineering",
  electronics: "Engineering",
  stationery: "OPEX",
  housekeeping: "Facility",
  "it equipment": "CAPEX",
  "office supplies": "OPEX",
  lubricants: "MRO",
  consumables: "MRO",
  fluids: "MRO",
  services: "Services",
  "logistics services": "Services",
  "maintenance supplies": "MRO",
  "maintenance services": "Services",
  "inspection services": "Services",
  safety: "Facility",
  logistics: "Services",
  packaging: "Packaging",
  tooling: "Tooling",
  mro: "MRO",
};

function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

function migrateCategory(stored, itemGroup) {
  const raw = String(stored ?? "").trim();
  if (MASTER.includes(raw)) return raw;
  if (raw && LEGACY_TO_CATEGORY[norm(raw)]) return LEGACY_TO_CATEGORY[norm(raw)];
  const g = norm(itemGroup);
  for (const [key, cat] of Object.entries(LEGACY_TO_CATEGORY)) {
    if (g === key || g.includes(key)) return cat;
  }
  return "";
}

function inferType(category, itemGroup) {
  const cat = String(category ?? "").trim();
  if (["Production", "Engineering", "Packaging", "Tooling"].includes(cat)) {
    return "Direct";
  }
  if (["OPEX", "CAPEX", "Facility", "Services", "MRO"].includes(cat)) {
    return "Indirect";
  }
  const g = norm(itemGroup);
  if (
    /station|housekeep|office|lubricant|consumable|fluid|it equipment|service|logistic|facility/.test(
      g,
    )
  ) {
    return "Indirect";
  }
  if (
    /raw material|auto part|brake|engine|transmission|suspension|electrical|ignition|product/.test(
      g,
    )
  ) {
    return "Direct";
  }
  return "";
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
    throw new Error(`${method} ${path} (${res.status}): ${JSON.stringify(data)}`);
  }
  return data?.data ?? data?.message ?? data;
}

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET");
    process.exit(1);
  }

  console.log("Backfill Procurement Type/Category (master ≠ Item Group)");
  console.log(`Target: ${baseUrl}`);

  const rows = await api(
    "GET",
    `/api/resource/Item?fields=${encodeURIComponent(
      JSON.stringify([
        "name",
        "item_code",
        "item_group",
        "custom_procurement_type",
        "custom_procurement_category",
      ]),
    )}&limit_page_length=2000`,
  );

  const list = Array.isArray(rows) ? rows : [];
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of list) {
    const code = row.item_code || row.name;
    const storedType = String(row.custom_procurement_type ?? "").trim();
    const storedCat = String(row.custom_procurement_category ?? "").trim();
    const itemGroup = String(row.item_group ?? "").trim();

    const category = migrateCategory(storedCat, itemGroup);
    let type =
      storedType === "Direct" || storedType === "Indirect" ? storedType : "";
    const implied = inferType(category, itemGroup);
    if (!type) type = implied;
    if (
      implied &&
      type !== implied &&
      /station|housekeep|office|lubricant|consumable|it equipment/.test(
        norm(itemGroup),
      )
    ) {
      type = implied;
    }

    if (!type || !category) {
      skipped += 1;
      continue;
    }
    if (storedType === type && storedCat === category) {
      skipped += 1;
      continue;
    }

    try {
      await api("PUT", `/api/resource/Item/${encodeURIComponent(code)}`, {
        custom_procurement_type: type,
        custom_procurement_category: category,
      });
      updated += 1;
      console.log(
        `✓ ${code}: ${storedType || "(empty)"}/${storedCat || "(empty)"} → ${type}/${category} (group=${itemGroup})`,
      );
    } catch (err) {
      failed += 1;
      console.error(`✗ ${code}:`, err.message);
    }
  }

  console.log("\nDone.", { updated, skipped, failed, total: list.length });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
