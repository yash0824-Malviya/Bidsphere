/**
 * Audit & correct swapped Procurement Category vs Item Group on ERP Items.
 *
 * Usage: node scripts/audit-fix-procurement-category-item-group.mjs
 *
 * - Procurement Category = typed master (Direct / Indirect lists)
 * - Item Group = ERPNext item_group only (Stationery, Auto Parts, Raw Material, …)
 * - Never copy Item Group names into Procurement Category (except via legacy map)
 * - Never overwrite item_group with a Procurement Category
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

const DIRECT_CATEGORIES = new Set([
  "Production",
  "Engineering",
  "Packaging",
  "Tooling",
  "Raw Material",
]);

const INDIRECT_CATEGORIES = new Set([
  "MRO",
  "CAPEX",
  "OPEX",
  "Services",
  "Facility",
  "Office Supplies",
  "IT",
  "Housekeeping",
]);

const MASTER = new Set([...DIRECT_CATEGORIES, ...INDIRECT_CATEGORIES]);

/** Legacy / Item-Group-like labels wrongly stored as Procurement Category. */
const LEGACY_TO_CATEGORY = {
  "raw material": "Raw Material",
  "raw materials": "Raw Material",
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
  stationery: "Office Supplies",
  housekeeping: "Housekeeping",
  "it equipment": "IT",
  it: "IT",
  "office supplies": "Office Supplies",
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
  capex: "CAPEX",
  opex: "OPEX",
  production: "Production",
  engineering: "Engineering",
  facility: "Facility",
};

function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

function migrateCategory(stored, itemGroup) {
  const raw = String(stored ?? "").trim();
  if (MASTER.has(raw)) return raw;
  if (raw && LEGACY_TO_CATEGORY[norm(raw)]) return LEGACY_TO_CATEGORY[norm(raw)];

  const g = norm(itemGroup);
  if (!g) return "";
  for (const [key, cat] of Object.entries(LEGACY_TO_CATEGORY)) {
    if (g === key || g.includes(key)) return cat;
  }
  return "";
}

function typeForCategory(category) {
  const cat = String(category ?? "").trim();
  if (DIRECT_CATEGORIES.has(cat)) return "Direct";
  if (INDIRECT_CATEGORIES.has(cat)) return "Indirect";
  return "";
}

function inferType(category, itemGroup) {
  const fromCat = typeForCategory(category);
  if (fromCat) return fromCat;
  const g = norm(itemGroup);
  if (
    /station|housekeep|office|lubricant|consumable|fluid|it equipment|\bit\b|service|logistic|facility|mro|opex|capex/.test(
      g,
    )
  ) {
    return "Indirect";
  }
  if (
    /raw material|auto part|brake|engine|transmission|suspension|electrical|ignition|product|packaging|tooling/.test(
      g,
    )
  ) {
    return "Direct";
  }
  return "";
}

/**
 * Detect swap: category looks like an Item Group name, while item_group looks
 * like a Procurement Category (or is empty / generic).
 */
function detectSwap(storedCat, itemGroup) {
  const cat = String(storedCat ?? "").trim();
  const group = String(itemGroup ?? "").trim();
  if (!cat) return false;
  if (MASTER.has(cat)) return false;
  if (LEGACY_TO_CATEGORY[norm(cat)]) return true;
  if (MASTER.has(group) && !MASTER.has(cat)) return true;
  return false;
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

  console.log("Audit / fix Procurement Category vs Item Group");
  console.log(`Target: ${baseUrl}`);
  console.log("Category master:", [...MASTER].join(", "));

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
  let swaps = 0;

  for (const row of list) {
    const code = row.item_code || row.name;
    const storedType = String(row.custom_procurement_type ?? "").trim();
    const storedCat = String(row.custom_procurement_category ?? "").trim();
    const itemGroup = String(row.item_group ?? "").trim();

    const swapped = detectSwap(storedCat, itemGroup);
    if (swapped) swaps += 1;

    let nextCat = migrateCategory(storedCat, itemGroup);

    // Refine broad legacy categories when Item Group implies a specific one.
    const g = norm(itemGroup);
    if (/^raw materials?$/.test(g) && (!nextCat || nextCat === "Production")) {
      nextCat = "Raw Material";
    } else if (
      /^station(e|a)ry$/.test(g) &&
      (!nextCat || nextCat === "OPEX")
    ) {
      nextCat = "Office Supplies";
    } else if (
      /^it equipment$/.test(g) &&
      (!nextCat || nextCat === "CAPEX")
    ) {
      nextCat = "IT";
    } else if (
      /^housekeeping$/.test(g) &&
      (!nextCat || nextCat === "Facility" || nextCat === "OPEX")
    ) {
      nextCat = "Housekeeping";
    }

    let nextType =
      storedType === "Direct" || storedType === "Indirect" ? storedType : "";

    // Category always wins for type when it is a typed master value.
    const catType = typeForCategory(nextCat);
    if (catType) {
      nextType = catType;
    } else if (!nextType) {
      nextType = inferType(nextCat, itemGroup);
    }

    // Soft-correct Indirect item groups wrongly marked Direct.
    const fromGroup = inferType(nextCat, itemGroup);
    if (
      fromGroup &&
      nextType &&
      fromGroup !== nextType &&
      /station|housekeep|office|lubricant|consumable|it equipment/.test(
        norm(itemGroup),
      )
    ) {
      nextType = fromGroup;
    }

    if (!nextCat || !nextType) {
      skipped += 1;
      continue;
    }
    if (storedCat === nextCat && storedType === nextType) {
      skipped += 1;
      continue;
    }

    try {
      await api("PUT", `/api/resource/Item/${encodeURIComponent(code)}`, {
        custom_procurement_type: nextType,
        custom_procurement_category: nextCat,
        // Never write item_group from category — Item Group stays ERP hierarchy.
      });
      updated += 1;
      console.log(
        `✓ ${code}${swapped ? " [swap]" : ""}: type ${storedType || "(empty)"}→${nextType}; ` +
          `category "${storedCat || "(empty)"}"→"${nextCat}"; item_group="${itemGroup}"`,
      );
    } catch (err) {
      failed += 1;
      console.error(`✗ ${code}:`, err.message);
    }
  }

  console.log("\nDone.", {
    updated,
    skipped,
    failed,
    swapsDetected: swaps,
    total: list.length,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
