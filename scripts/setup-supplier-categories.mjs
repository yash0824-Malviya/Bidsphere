/**
 * Seeds Supplier Categories using ERPNext "Supplier Group" and assigns demo suppliers.
 *
 * This is a data/setup script (no API changes). The UI maps Category ↔ supplier_group.
 *
 * Usage: node scripts/setup-supplier-categories.mjs
 * Requires .env: ERPNEXT_URL (or VITE_ERPNEXT_URL), ERP_API_KEY, ERP_API_SECRET
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
const apiSecret =
  process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

async function api(method, path, body) {
  const url = `${baseUrl}${path}`;
  const headers = {
    Authorization: `token ${apiKey}:${apiSecret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      json.exception ||
        json._server_messages ||
        JSON.stringify(json) ||
        res.statusText
    );
  }
  return json.data;
}

const CATEGORIES = [
  "Raw Materials",
  "Manufacturing Components",
  "Electrical & Electronics",
  "Industrial Equipment",
  "MRO (Maintenance, Repair & Operations)",
  "Logistics & Transportation",
  "Packaging",
  "Chemicals & Consumables",
  "Office & IT Supplies",
  "Professional Services",
  "Facility Management",
  "Capital Equipment",
];

const DEMO_ASSIGNMENTS = {
  "Atlantic Precision Manufacturing": "Manufacturing Components",
  "Blue Ridge Manufacturing Inc": "Manufacturing Components",
  "Eagle Peak Technologies Inc": "Electrical & Electronics",
  "Frontier Industrial Solutions Inc.": "Industrial Equipment",
  "Liberty Components Corporation": "Manufacturing Components",
  "Midwest Materials & Equipment Co.": "Raw Materials",
  "Northstar Procurement Services": "Professional Services",
  "Pioneer Equipment Solutions": "Industrial Equipment",
  "Redwood Supply Chain Partners": "Logistics & Transportation",
  "Summit Industrial Supply LLC": "MRO (Maintenance, Repair & Operations)",
  "Titan Industrial Products LLC": "Raw Materials",
};

async function resolveRootSupplierGroup() {
  // Try the standard ERPNext root first.
  try {
    await api(
      "GET",
      `/api/resource/Supplier%20Group/${encodeURIComponent(
        "All Supplier Groups"
      )}`
    );
    return "All Supplier Groups";
  } catch {
    // Fall back to any top-level group (parent not set) if present.
    try {
      const rows = await api(
        "GET",
        `/api/resource/Supplier%20Group?fields=${encodeURIComponent(
          JSON.stringify(["name", "parent_supplier_group", "is_group"])
        )}&filters=${encodeURIComponent(
          JSON.stringify([["parent_supplier_group", "is", "not set"]])
        )}&limit_page_length=50`
      );
      const root = (rows ?? []).find((r) => r?.name);
      return root?.name ?? null;
    } catch {
      return null;
    }
  }
}

async function ensureCategoryGroups() {
  const rootGroup = await resolveRootSupplierGroup();
  console.log(`Seeding Supplier Groups on ${baseUrl}...`);
  console.log(`• Root group: ${rootGroup ?? "(none)"}`);

  for (const name of CATEGORIES) {
    let exists = null;
    try {
      exists = await api(
        "GET",
        `/api/resource/Supplier%20Group/${encodeURIComponent(name)}`
      );
    } catch {
      exists = null;
    }
    if (exists) {
      console.log(`✓ ${name}`);
      continue;
    }
    const payload = {
      supplier_group_name: name,
      is_group: 0,
      ...(rootGroup ? { parent_supplier_group: rootGroup } : {}),
    };
    await api("POST", "/api/resource/Supplier%20Group", payload);
    console.log(`+ Created ${name}`);
  }
}

async function findSupplierDocId(identifier) {
  // Prefer exact match by supplier_name (display).
  const rowsByName = await api(
    "GET",
    `/api/resource/Supplier?fields=${encodeURIComponent(
      JSON.stringify(["name", "supplier_name", "supplier_group"])
    )}&filters=${encodeURIComponent(
      JSON.stringify([["supplier_name", "=", identifier]])
    )}&limit_page_length=1`
  );
  if (rowsByName?.[0]?.name) return rowsByName[0];

  // Fallback to matching by docname.
  const rowsById = await api(
    "GET",
    `/api/resource/Supplier?fields=${encodeURIComponent(
      JSON.stringify(["name", "supplier_name", "supplier_group"])
    )}&filters=${encodeURIComponent(
      JSON.stringify([["name", "=", identifier]])
    )}&limit_page_length=1`
  );
  if (rowsById?.[0]?.name) return rowsById[0];

  return null;
}

async function assignDemoSuppliers() {
  console.log("\nAssigning demo suppliers to categories...");
  for (const [supplierName, category] of Object.entries(DEMO_ASSIGNMENTS)) {
    const row = await findSupplierDocId(supplierName);
    if (!row) {
      console.log(`! Not found: ${supplierName}`);
      continue;
    }
    if ((row.supplier_group ?? "") === category) {
      console.log(`✓ ${supplierName} → ${category}`);
      continue;
    }
    await api(
      "PUT",
      `/api/resource/Supplier/${encodeURIComponent(row.name)}`,
      { supplier_group: category }
    );
    console.log(`→ ${supplierName} → ${category}`);
  }
}

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Set ERPNEXT_URL, ERP_API_KEY, ERP_API_SECRET in .env");
    process.exit(1);
  }
  await ensureCategoryGroups();
  await assignDemoSuppliers();
  console.log("\n✅ Supplier Categories setup complete.");
}

main().catch((err) => {
  console.error("❌ Setup failed:", err.message);
  process.exit(1);
});

