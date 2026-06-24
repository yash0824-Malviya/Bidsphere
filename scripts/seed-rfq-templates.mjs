/**
 * Seed 8 default RFQ Templates into ERPNext.
 *
 * Tries to resolve real Item and Supplier records from ERPNext.
 * Falls back to generic names when items/suppliers aren't found.
 *
 * Usage:
 *   node scripts/seed-rfq-templates.mjs
 *
 * Prerequisites:
 *   1. Run `node scripts/setup-rfq-template.mjs` first to create DocTypes.
 *   2. .env must have ERPNEXT_URL, ERP_API_KEY, ERP_API_SECRET.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

/* ── Load .env ──────────────────────────────────────────────────────────── */

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
const apiSecret =
  process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

/* ── HTTP helper ────────────────────────────────────────────────────────── */

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
  return data;
}

/* ── Fetch real ERPNext data ────────────────────────────────────────────── */

async function fetchItems(limit = 50) {
  try {
    const res = await api(
      "GET",
      `/api/resource/Item?fields=["name","item_name","item_group","stock_uom"]&filters=[["disabled","=",0]]&limit_page_length=${limit}&order_by=creation desc`
    );
    return res?.data ?? [];
  } catch {
    return [];
  }
}

async function fetchSuppliers(limit = 20) {
  try {
    const res = await api(
      "GET",
      `/api/resource/Supplier?fields=["name","supplier_name","supplier_group"]&filters=[["disabled","=",0]]&limit_page_length=${limit}&order_by=creation desc`
    );
    return res?.data ?? [];
  } catch {
    return [];
  }
}

/* ── Template definitions ───────────────────────────────────────────────── */

function buildTemplates(items, suppliers) {
  const sup = suppliers.length > 0
    ? suppliers.slice(0, 5).map((s) => ({
        doctype: "RFQ Template Supplier",
        supplier: s.name,
        supplier_name: s.supplier_name || s.name,
      }))
    : [{ doctype: "RFQ Template Supplier", supplier: "Default Supplier", supplier_name: "Default Supplier" }];

  function pickItems(keywords, count = 3) {
    const matched = items.filter((i) => {
      const text = `${i.name} ${i.item_name} ${i.item_group}`.toLowerCase();
      return keywords.some((kw) => text.includes(kw.toLowerCase()));
    });
    const picked = matched.length > 0 ? matched.slice(0, count) : items.slice(0, count);
    if (picked.length === 0) {
      return [{ doctype: "RFQ Template Item", item_code: "ITEM-001", item_name: "Sample Item", qty: 10, uom: "Nos" }];
    }
    return picked.map((i) => ({
      doctype: "RFQ Template Item",
      item_code: i.name,
      item_name: i.item_name || i.name,
      qty: 100,
      uom: i.stock_uom || "Nos",
    }));
  }

  return [
    {
      template_name: "Raw Material Procurement",
      category: "Raw Materials",
      description: "Standard template for procuring raw materials including metals, plastics, and chemicals.",
      estimated_value: 50000,
      items: pickItems(["raw", "material", "steel", "metal", "plastic", "chemical"]),
      suppliers: sup,
    },
    {
      template_name: "Manufacturing Components",
      category: "Manufacturing Components",
      description: "Template for manufacturing parts, assemblies, and sub-components.",
      estimated_value: 75000,
      items: pickItems(["component", "assembly", "part", "bearing", "gear", "manufacturing"]),
      suppliers: sup,
    },
    {
      template_name: "Electrical Components",
      category: "Electrical Components",
      description: "Template for electrical parts including wiring, switches, and control panels.",
      estimated_value: 35000,
      items: pickItems(["electrical", "wire", "switch", "panel", "cable", "motor"]),
      suppliers: sup,
    },
    {
      template_name: "Packaging Materials",
      category: "Packaging Materials",
      description: "Template for packaging supplies including boxes, tape, and wrapping materials.",
      estimated_value: 15000,
      items: pickItems(["packaging", "box", "carton", "tape", "wrap", "label"]),
      suppliers: sup,
    },
    {
      template_name: "MRO Supplies",
      category: "MRO Supplies",
      description: "Maintenance, Repair and Operations supplies for facility upkeep.",
      estimated_value: 25000,
      items: pickItems(["mro", "maintenance", "repair", "tool", "safety", "lubricant"]),
      suppliers: sup,
    },
    {
      template_name: "Warehouse Consumables",
      category: "Warehouse Consumables",
      description: "Warehouse operations consumables including PPE, cleaning supplies, and storage materials.",
      estimated_value: 10000,
      items: pickItems(["consumable", "warehouse", "ppe", "cleaning", "glove", "storage"]),
      suppliers: sup,
    },
    {
      template_name: "IT Equipment Procurement",
      category: "IT Equipment",
      description: "Template for IT hardware including computers, peripherals, and networking equipment.",
      estimated_value: 100000,
      items: pickItems(["computer", "laptop", "monitor", "printer", "network", "server", "it"]),
      suppliers: sup,
    },
    {
      template_name: "Logistics & Transportation",
      category: "Logistics & Transportation",
      description: "Template for logistics services, shipping supplies, and transportation equipment.",
      estimated_value: 45000,
      items: pickItems(["logistics", "transport", "shipping", "freight", "pallet", "container"]),
      suppliers: sup,
    },
  ];
}

/* ── Main ───────────────────────────────────────────────────────────────── */

async function main() {
  if (!baseUrl || !apiKey || !apiSecret) {
    console.error("Missing ERPNEXT_URL and ERP API credentials in .env");
    process.exit(1);
  }

  console.log(`Seeding RFQ Templates on ${baseUrl}\n`);

  const [items, suppliers] = await Promise.all([
    fetchItems(),
    fetchSuppliers(),
  ]);

  console.log(`Found ${items.length} items and ${suppliers.length} suppliers in ERPNext\n`);

  const templates = buildTemplates(items, suppliers);
  let created = 0;
  let skipped = 0;

  for (const tpl of templates) {
    try {
      // Check if already exists
      const existing = await api(
        "GET",
        `/api/resource/RFQ Template?filters=[["template_name","=",${JSON.stringify(tpl.template_name)}]]&limit_page_length=1`
      );
      if (existing?.data?.length > 0) {
        console.log(`  ⏭  "${tpl.template_name}" already exists — skipping`);
        skipped++;
        continue;
      }

      await api("POST", "/api/resource/RFQ Template", {
        doctype: "RFQ Template",
        template_name: tpl.template_name,
        category: tpl.category,
        description: tpl.description,
        status: "Active",
        estimated_value: tpl.estimated_value,
        usage_count: 0,
        items: tpl.items,
        suppliers: tpl.suppliers,
      });

      console.log(`  ✓  Created "${tpl.template_name}"`);
      created++;
    } catch (err) {
      console.error(`  ✗  Failed "${tpl.template_name}": ${err.message}`);
    }
  }

  console.log(`\n──────────────────────────────────────`);
  console.log(`Done.  Created: ${created}, Skipped: ${skipped}`);
  console.log(`──────────────────────────────────────\n`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
