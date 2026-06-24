/**
 * RFQ Template service — localStorage primary store with ERPNext sync when available.
 */

import {
  apiGet,
  apiPost,
  apiPut,
  buildResourceUrl,
  buildListConfig,
  isDocNotFoundError,
  withSilent,
  COMPANY as DEFAULT_COMPANY,
} from "./erpnext";
import type { ListParams } from "./erpnext";
import type {
  RFQ,
  RFQTemplate,
  RFQTemplateCategory,
  RFQTemplateRfqType,
  RFQTemplateStatus,
  RFQTemplateItemRow,
  RFQTemplateSupplierRow,
  RFQTemplateRequiredDocuments,
  RFQTemplateWorkflowRules,
} from "../types/erpnext";
import {
  DEFAULT_REQUIRED_DOCUMENTS,
  DEFAULT_WORKFLOW_RULES,
} from "../types/erpnext";
import { lookupDefaultWarehouse } from "./sourcing";
import { assertSuppliersActive } from "./supplier";
import { assertERPNextDate, todayERPNextDate } from "../utils/erpNextDate";
import {
  createLocalTemplate,
  getLocalTemplate,
  incrementLocalTemplateUsage,
  isLocalTemplateId,
  logTemplateStorage,
  mergeTemplateLists,
  readLocalTemplates,
  saveLocalTemplate,
} from "./rfqTemplateStorage";
import {
  buildMetaFromTemplate,
  stashRFQCreationMeta,
} from "./rfqCreationMeta";

const TEMPLATE_DOCTYPE = "RFQ Template";
const TEMPLATE_ITEM_DOCTYPE = "RFQ Template Item";
const TEMPLATE_SUPPLIER_DOCTYPE = "RFQ Template Supplier";
const RFQ_DOCTYPE = "Request for Quotation";
const RFQ_ITEM_DOCTYPE = "Request for Quotation Item";
const RFQ_SUPPLIER_DOCTYPE = "Request for Quotation Supplier";

export const RFQ_TEMPLATE_CATEGORIES: RFQTemplateCategory[] = [
  "Raw Materials",
  "Manufacturing Components",
  "Electrical Components",
  "Packaging Materials",
  "MRO Supplies",
  "Warehouse Consumables",
  "IT Equipment",
  "Logistics & Transportation",
];

export const RFQ_TEMPLATE_RFQ_TYPES: RFQTemplateRfqType[] = [
  "Standard RFQ",
  "Single Source",
  "Emergency",
  "Framework Agreement",
  "Services",
];

export let usingFallbackTemplates = false;

export interface RFQTemplateInput {
  template_name: string;
  category: RFQTemplateCategory;
  rfq_type?: RFQTemplateRfqType;
  description?: string;
  status?: RFQTemplateStatus;
  estimated_value?: number;
  items?: Array<{
    item_code: string;
    item_name?: string;
    qty: number | string;
    uom?: string;
    target_price?: number;
    specification?: string;
  }>;
  suppliers?: Array<{ supplier: string; supplier_name?: string }>;
  required_documents?: RFQTemplateRequiredDocuments;
  workflow_rules?: RFQTemplateWorkflowRules;
}

function validateTemplateInput(data: RFQTemplateInput): void {
  if (!data.template_name?.trim()) throw new Error("Template name is required.");
  if (!data.items?.length) throw new Error("At least one item is required.");
  if (!data.suppliers?.length) throw new Error("At least one supplier is required.");
}

function mapInputToTemplate(
  data: RFQTemplateInput,
  existing?: RFQTemplate
): Omit<RFQTemplate, "name" | "creation" | "modified" | "owner"> & {
  name?: string;
} {
  return {
    name: existing?.name,
    template_name: data.template_name.trim(),
    category: data.category,
    rfq_type: data.rfq_type ?? "Standard RFQ",
    description: data.description ?? "",
    status: data.status ?? existing?.status ?? "Active",
    estimated_value: data.estimated_value ?? 0,
    usage_count: existing?.usage_count ?? 0,
    last_used_at: existing?.last_used_at,
    items: (data.items ?? []).map(
      (item, i) =>
        ({
          name: existing?.items?.[i]?.name ?? `item-${i}`,
          item_code: item.item_code,
          item_name: item.item_name || item.item_code,
          qty: Number(item.qty) || 1,
          uom: item.uom || "Nos",
          target_price: item.target_price ?? 0,
          specification: item.specification ?? "",
        }) as RFQTemplateItemRow
    ),
    suppliers: (data.suppliers ?? []).map(
      (s, i) =>
        ({
          name: existing?.suppliers?.[i]?.name ?? `sup-${i}`,
          supplier: s.supplier,
          supplier_name: s.supplier_name || s.supplier,
        }) as RFQTemplateSupplierRow
    ),
    required_documents: data.required_documents ?? {
      ...DEFAULT_REQUIRED_DOCUMENTS,
    },
    workflow_rules: data.workflow_rules ?? { ...DEFAULT_WORKFLOW_RULES },
  };
}

function buildErpPayload(data: RFQTemplateInput): Record<string, unknown> {
  return {
    doctype: TEMPLATE_DOCTYPE,
    template_name: data.template_name,
    category: data.category,
    description: JSON.stringify({
      rfq_type: data.rfq_type,
      required_documents: data.required_documents,
      workflow_rules: data.workflow_rules,
      note: data.description,
    }),
    status: data.status ?? "Active",
    estimated_value: data.estimated_value ?? 0,
    usage_count: 0,
    items: (data.items ?? []).map((item) => ({
      doctype: TEMPLATE_ITEM_DOCTYPE,
      item_code: item.item_code,
      item_name: item.item_name || item.item_code,
      qty: Number(item.qty) || 1,
      uom: item.uom || "Nos",
    })),
    suppliers: (data.suppliers ?? []).map((s) => ({
      doctype: TEMPLATE_SUPPLIER_DOCTYPE,
      supplier: s.supplier,
      supplier_name: s.supplier_name || s.supplier,
    })),
  };
}

/** List templates — localStorage merged with ERPNext when available. */
export async function getRFQTemplates(
  params?: ListParams
): Promise<RFQTemplate[]> {
  logTemplateStorage("FETCH list — start");
  const local = readLocalTemplates();

  try {
    const result = await apiGet<RFQTemplate[]>(
      buildResourceUrl(TEMPLATE_DOCTYPE),
      withSilent(
        buildListConfig({
          fields: [
            "name",
            "template_name",
            "category",
            "description",
            "status",
            "estimated_value",
            "usage_count",
            "modified",
            "creation",
            "owner",
          ],
          limit_page_length: 200,
          order_by: "modified desc",
          ...params,
        })
      )
    );
    usingFallbackTemplates = false;
    const erp = Array.isArray(result) ? result : [];
    const merged = mergeTemplateLists(erp, local);
    logTemplateStorage("FETCH list — merged", { erp: erp.length, local: local.length, total: merged.length });
    return merged;
  } catch (err) {
    if (isDocNotFoundError(err) || local.length > 0) {
      usingFallbackTemplates = true;
      if (local.length > 0) {
        logTemplateStorage("FETCH list — local only", { count: local.length });
        return local;
      }
      logTemplateStorage("FETCH list — demo fallback");
      const demos = await buildFallbackTemplates();
      for (const d of demos) saveLocalTemplate(d);
      return demos;
    }
    throw err;
  }
}

/** Get single template with child tables. */
export async function getRFQTemplate(name: string): Promise<RFQTemplate> {
  logTemplateStorage("FETCH one", { name });
  const local = getLocalTemplate(name);
  if (local) return local;

  if (!isLocalTemplateId(name)) {
    try {
      const erp = await apiGet<RFQTemplate>(
        buildResourceUrl(TEMPLATE_DOCTYPE, name),
        withSilent()
      );
      return normalizeErpTemplate(erp);
    } catch {
      /* fall through */
    }
  }

  const all = await getRFQTemplates();
  const found = all.find((t) => t.name === name);
  if (found) return found;
  throw new Error(`Template "${name}" not found.`);
}

function normalizeErpTemplate(raw: RFQTemplate): RFQTemplate {
  let rfq_type: RFQTemplateRfqType | undefined;
  let required_documents = { ...DEFAULT_REQUIRED_DOCUMENTS };
  let workflow_rules = { ...DEFAULT_WORKFLOW_RULES };
  let description = raw.description ?? "";

  try {
    if (description.startsWith("{")) {
      const cfg = JSON.parse(description) as {
        rfq_type?: RFQTemplateRfqType;
        required_documents?: RFQTemplateRequiredDocuments;
        workflow_rules?: RFQTemplateWorkflowRules;
        note?: string;
      };
      rfq_type = cfg.rfq_type;
      if (cfg.required_documents) required_documents = cfg.required_documents;
      if (cfg.workflow_rules) workflow_rules = cfg.workflow_rules;
      if (cfg.note) description = cfg.note;
    }
  } catch {
    /* plain description */
  }

  return {
    ...raw,
    rfq_type: rfq_type ?? "Standard RFQ",
    description,
    required_documents,
    workflow_rules,
    items: raw.items ?? [],
    suppliers: raw.suppliers ?? [],
  };
}

export async function createRFQTemplate(
  data: RFQTemplateInput
): Promise<RFQTemplate> {
  validateTemplateInput(data);
  logTemplateStorage("CREATE — start", data.template_name);

  const saved = createLocalTemplate(mapInputToTemplate(data));

  try {
    const erp = await apiPost<RFQTemplate>(
      buildResourceUrl(TEMPLATE_DOCTYPE),
      buildErpPayload(data)
    );
    saveLocalTemplate({ ...saved, name: erp.name });
    logTemplateStorage("CREATE — ERPNext synced", erp.name);
    return getLocalTemplate(erp.name) ?? saved;
  } catch (err) {
    logTemplateStorage("CREATE — local only", { name: saved.name, err });
    return saved;
  }
}

export async function updateRFQTemplate(
  name: string,
  data: Partial<RFQTemplateInput>
): Promise<RFQTemplate> {
  const existing = await getRFQTemplate(name);
  const merged: RFQTemplateInput = {
    template_name: data.template_name ?? existing.template_name,
    category: data.category ?? existing.category,
    rfq_type: data.rfq_type ?? existing.rfq_type,
    description: data.description ?? existing.description,
    status: data.status ?? existing.status,
    estimated_value: data.estimated_value ?? existing.estimated_value,
    items:
      data.items ??
      existing.items.map((i) => ({
        item_code: i.item_code,
        item_name: i.item_name,
        qty: i.qty,
        uom: i.uom,
        target_price: i.target_price,
        specification: i.specification,
      })),
    suppliers:
      data.suppliers ??
      existing.suppliers.map((s) => ({
        supplier: s.supplier,
        supplier_name: s.supplier_name,
      })),
    required_documents: data.required_documents ?? existing.required_documents,
    workflow_rules: data.workflow_rules ?? existing.workflow_rules,
  };
  validateTemplateInput(merged);

  const saved = saveLocalTemplate({
    ...existing,
    ...mapInputToTemplate(merged, existing),
    name: existing.name,
    creation: existing.creation,
    owner: existing.owner,
  });

  if (!isLocalTemplateId(name)) {
    try {
      await apiPut(buildResourceUrl(TEMPLATE_DOCTYPE, name), buildErpPayload(merged));
      logTemplateStorage("UPDATE — ERPNext synced", name);
    } catch {
      logTemplateStorage("UPDATE — local only", name);
    }
  }
  return saved;
}

export async function cloneRFQTemplate(
  sourceName: string,
  newName?: string
): Promise<RFQTemplate> {
  const source = await getRFQTemplate(sourceName);
  return createRFQTemplate({
    template_name: newName ?? `${source.template_name} (Copy)`,
    category: source.category,
    rfq_type: source.rfq_type,
    description: source.description,
    estimated_value: source.estimated_value,
    items: source.items.map((i) => ({
      item_code: i.item_code,
      item_name: i.item_name,
      qty: i.qty,
      uom: i.uom,
      target_price: i.target_price,
      specification: i.specification,
    })),
    suppliers: source.suppliers.map((s) => ({
      supplier: s.supplier,
      supplier_name: s.supplier_name,
    })),
    required_documents: source.required_documents,
    workflow_rules: source.workflow_rules,
    status: "Active",
  });
}

export async function archiveRFQTemplate(name: string): Promise<RFQTemplate> {
  return updateRFQTemplate(name, { status: "Archived" });
}

/* ─── Fallback demo templates ─────────────────────────────────────────────── */

interface MinimalItem {
  name: string;
  item_name?: string;
  stock_uom?: string;
  item_group?: string;
}

interface MinimalSupplier {
  name: string;
  supplier_name?: string;
}

async function fetchItemsSafe(): Promise<MinimalItem[]> {
  try {
    return await apiGet<MinimalItem[]>("/api/resource/Item", {
      params: {
        fields: JSON.stringify(["name", "item_name", "stock_uom", "item_group"]),
        filters: JSON.stringify([["disabled", "=", 0]]),
        limit_page_length: 30,
        order_by: "creation desc",
      },
    });
  } catch {
    return [];
  }
}

async function fetchSuppliersSafe(): Promise<MinimalSupplier[]> {
  try {
    return await apiGet<MinimalSupplier[]>("/api/resource/Supplier", {
      params: {
        fields: JSON.stringify(["name", "supplier_name"]),
        filters: JSON.stringify([["disabled", "=", 0]]),
        limit_page_length: 10,
        order_by: "creation desc",
      },
    });
  } catch {
    return [];
  }
}

const FALLBACK_DEFS: Array<{
  name: string;
  template_name: string;
  category: RFQTemplateCategory;
  rfq_type: RFQTemplateRfqType;
  description: string;
  estimated_value: number;
  keywords: string[];
}> = [
  {
    name: "DEMO-TPL-001",
    template_name: "Raw Material Procurement",
    category: "Raw Materials",
    rfq_type: "Standard RFQ",
    description: "Standard template for procuring raw materials.",
    estimated_value: 50000,
    keywords: ["raw", "material", "steel"],
  },
  {
    name: "DEMO-TPL-002",
    template_name: "IT Equipment Procurement",
    category: "IT Equipment",
    rfq_type: "Standard RFQ",
    description: "Template for IT hardware and peripherals.",
    estimated_value: 100000,
    keywords: ["computer", "laptop", "server"],
  },
  {
    name: "DEMO-TPL-003",
    template_name: "Emergency MRO Supplies",
    category: "MRO Supplies",
    rfq_type: "Emergency",
    description: "Fast-track MRO procurement with legal and finance gates.",
    estimated_value: 25000,
    keywords: ["mro", "maintenance", "tool"],
  },
];

async function buildFallbackTemplates(): Promise<RFQTemplate[]> {
  const [items, suppliers] = await Promise.all([
    fetchItemsSafe(),
    fetchSuppliersSafe(),
  ]);
  const now = new Date().toISOString();

  const defaultSuppliers: RFQTemplateSupplierRow[] =
    suppliers.length > 0
      ? suppliers.slice(0, 3).map((s) => ({
          name: s.name,
          supplier: s.name,
          supplier_name: s.supplier_name || s.name,
        }))
      : [{ name: "demo-sup", supplier: "Demo Supplier", supplier_name: "Demo Supplier" }];

  function pickItems(keywords: string[]): RFQTemplateItemRow[] {
    const matched = items.filter((i) => {
      const text = `${i.name} ${i.item_name} ${i.item_group}`.toLowerCase();
      return keywords.some((kw) => text.includes(kw));
    });
    const picked = matched.length ? matched.slice(0, 3) : items.slice(0, 3);
    if (!picked.length) {
      return [
        {
          name: "demo-item",
          item_code: "ITEM-001",
          item_name: "Sample Item",
          qty: 100,
          uom: "Nos",
          target_price: 0,
          specification: "",
        },
      ];
    }
    return picked.map((i) => ({
      name: i.name,
      item_code: i.name,
      item_name: i.item_name || i.name,
      qty: 100,
      uom: i.stock_uom || "Nos",
      target_price: 0,
      specification: "",
    }));
  }

  return FALLBACK_DEFS.map((def) => ({
    name: def.name,
    template_name: def.template_name,
    category: def.category,
    rfq_type: def.rfq_type,
    description: def.description,
    status: "Active" as RFQTemplateStatus,
    estimated_value: def.estimated_value,
    usage_count: 0,
    items: pickItems(def.keywords),
    suppliers: defaultSuppliers,
    required_documents: { ...DEFAULT_REQUIRED_DOCUMENTS },
    workflow_rules: { ...DEFAULT_WORKFLOW_RULES },
    modified: now,
    creation: now,
    owner: "System",
  }));
}

/* ─── Create RFQ from template ────────────────────────────────────────────── */

export interface CreateRFQFromTemplateInput {
  template_id: string;
  rfq_name?: string;
}

export function stashRFQTemplateMeta(
  rfqName: string,
  template: RFQTemplate
): void {
  stashRFQCreationMeta(rfqName, buildMetaFromTemplate(template));
}

export async function createRFQFromTemplate(
  input: CreateRFQFromTemplateInput
): Promise<RFQ> {
  logTemplateStorage("CREATE RFQ from template", input);
  const template = await getRFQTemplate(input.template_id);

  if (!template.items?.length) throw new Error("Template has no items.");
  if (!template.suppliers?.length) throw new Error("Template has no suppliers.");

  await assertSuppliersActive(template.suppliers.map((s) => s.supplier));

  const today = todayERPNextDate();
  const company = DEFAULT_COMPANY;
  const warehouse = await lookupDefaultWarehouse(company);

  const docLines: string[] = [];
  if (template.description) docLines.push(template.description);
  if (template.rfq_type) docLines.push(`RFQ Type: ${template.rfq_type}`);
  const req = template.required_documents;
  if (req) {
    const docs = [
      req.terms_and_conditions && "Terms & Conditions",
      req.warranty_certificate && "Warranty Certificate",
      req.insurance_certificate && "Insurance Certificate",
      req.nda && "NDA",
      req.compliance_certificate && "Compliance Certificate",
    ].filter(Boolean);
    if (docs.length) docLines.push(`Required Documents: ${docs.join(", ")}`);
  }

  const payload = {
    doctype: RFQ_DOCTYPE,
    transaction_date: assertERPNextDate(today, "transaction_date"),
    status: "Draft",
    company,
    message_for_supplier: [input.rfq_name || template.template_name, ...docLines].join("\n\n"),
    items: template.items.map((item) => ({
      doctype: RFQ_ITEM_DOCTYPE,
      item_code: item.item_code,
      item_name: item.item_name || item.item_code,
      description: item.specification || item.item_name || item.item_code,
      qty: Number(item.qty) || 1,
      uom: item.uom || "Nos",
      stock_uom: item.uom || "Nos",
      conversion_factor: 1,
      warehouse,
      schedule_date: today,
      rate: item.target_price ?? 0,
    })),
    suppliers: template.suppliers.map((s) => ({
      doctype: RFQ_SUPPLIER_DOCTYPE,
      supplier: s.supplier,
      supplier_name: s.supplier_name || s.supplier,
    })),
  };

  const rfq = await apiPost<RFQ>(buildResourceUrl(RFQ_DOCTYPE), payload);
  stashRFQTemplateMeta(rfq.name, template);
  incrementLocalTemplateUsage(template.name);

  try {
    if (!isLocalTemplateId(template.name)) {
      await apiPut(buildResourceUrl(TEMPLATE_DOCTYPE, template.name), {
        usage_count: (template.usage_count ?? 0) + 1,
      });
    }
  } catch {
    /* non-critical */
  }

  logTemplateStorage("CREATE RFQ from template — done", rfq.name);
  return rfq;
}
