/**
 * Procurement BOM Reader — server-owned business logic.
 *
 * This is NOT Manufacturing BOM. It only:
 *   1. Parses uploaded Excel (.xlsx / .xls)
 *   2. Validates rows
 *   3. Looks up Item Master (read-only — never auto-creates on upload)
 *   4. Recommends suppliers
 *   5. Creates a standard ERPNext Request for Quotation
 *   6. Stores an "Uploaded BOM" audit record
 *
 * Runs in two adapters that share this exact code:
 *   - api/bom.ts              → Vercel serverless (production)
 *   - vite.config.ts plugin   → local `npm run dev` parity
 *
 * Auth: privileged ERPNext API-key token only. Never touches browser `sid`.
 */

import * as XLSX from "xlsx";
import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";

/* ────────────────────────────────────────────────────────────────────────
 *  Types
 * ──────────────────────────────────────────────────────────────────────── */

export type BomRowStatus =
  | "exists"
  | "new"
  | "missing_uom"
  | "duplicate"
  | "invalid";

export interface BomParsedRow {
  row_number: number;
  item_code: string;
  item_name: string;
  description: string;
  qty: number;
  uom: string;
  required_date: string;
  commodity: string;
  category: string;
  manufacturer: string;
  manufacturer_part_number: string;
  drawing_number: string;
  revision: string;
  remarks: string;
  status: BomRowStatus;
  status_label: string;
  exists_in_erp: boolean;
  erp_item_group?: string;
  errors: string[];
}

export interface BomUploadSummary {
  total_rows: number;
  existing_items: number;
  new_items: number;
  warnings: number;
  invalid_rows: number;
}

export interface RecommendedSupplier {
  name: string;
  supplier_name: string;
  supplier_group: string;
  country?: string;
  score: number;
  reasons: string[];
}

export interface SupplierRecommendationMeta {
  bom_categories: string[];
  bom_commodities: string[];
  bom_item_groups: string[];
  supplier_groups_in_erp: string[];
  matched_supplier_groups: string[];
  active_suppliers_queried: number;
  category_matched_suppliers: number;
  returned_suppliers: number;
  fallback_used: boolean;
  fallback_reason: string;
  query_notes: string[];
}

export interface BomUploadResult {
  success: true;
  rows: BomParsedRow[];
  summary: BomUploadSummary;
  recommended_suppliers: RecommendedSupplier[];
  supplier_categories: string[];
  file_name: string;
  warnings: string[];
  supplier_recommendation?: SupplierRecommendationMeta;
}

export interface CreateBomRfqInput {
  rows: BomParsedRow[];
  suppliers: Array<{ supplier: string; supplier_name?: string }>;
  uploaded_by?: string;
  remarks?: string;
  message_for_supplier?: string;
  company?: string;
  file_name?: string;
  /** Base64 of original file (optional — stored on Uploaded BOM). */
  file_base64?: string;
  file_mime?: string;
}

export interface CreateBomRfqResult {
  success: true;
  rfq_name: string;
  uploaded_bom_name: string;
  items_ensured: string[];
}

export interface BomHistoryRow {
  name: string;
  bom_number: string;
  uploaded_by: string;
  upload_date: string;
  status: string;
  total_items: number;
  rfq: string;
  remarks: string;
  original_file: string;
}

export class BomError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BomError";
    this.status = status;
  }
}

/* ────────────────────────────────────────────────────────────────────────
 *  ERP admin client (server-side only)
 * ──────────────────────────────────────────────────────────────────────── */

export interface ErpAdminConfig {
  baseUrl: string;
  key: string;
  secret: string;
}

export function readErpAdminConfig(): ErpAdminConfig {
  const baseUrl = (
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL ??
    ""
  )
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");

  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";

  if (!baseUrl || !key || !secret) {
    throw new BomError(
      "BOM backend is misconfigured: missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET.",
      503,
    );
  }

  return { baseUrl, key, secret };
}

async function erpFetch<T = unknown>(
  cfg: ErpAdminConfig,
  path: string,
  init?: { method?: string; body?: unknown; formData?: FormData },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `token ${cfg.key}:${cfg.secret}`,
    Accept: "application/json",
  };

  let body: BodyInit | undefined;
  if (init?.formData) {
    body = init.formData as unknown as BodyInit;
  } else if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(sanitizeErpPayloadDates(init.body));
  }

  const res = await fetch(`${cfg.baseUrl}/api/${path}`, {
    method: init?.method ?? "GET",
    headers,
    body,
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const errObj = data as Record<string, unknown>;
    const msg =
      (typeof errObj.message === "string" && errObj.message) ||
      (typeof errObj.exception === "string" && errObj.exception) ||
      (typeof errObj._server_messages === "string" && errObj._server_messages) ||
      `ERPNext request failed (${res.status})`;
    throw new BomError(String(msg).slice(0, 500), res.status >= 500 ? 502 : 400);
  }

  const envelope = data as { message?: T; data?: T };
  // Prefer `data` for resource list/doc responses. Only use `message` when
  // `data` is absent (method endpoints).
  if (envelope.data !== undefined) return envelope.data;
  if (envelope.message !== undefined) return envelope.message;
  return data as T;
}

/* ────────────────────────────────────────────────────────────────────────
 *  Column mapping & validation
 * ──────────────────────────────────────────────────────────────────────── */

const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Canonical BOM column → accepted header aliases.
 * Matching uses {@link normalizeHeader} on both sides (case/spacing/_/-).
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  item_code: [
    "Item Code",
    "ItemCode",
    "Item_Code",
    "Item-Code",
    "Part Number",
    "Part No",
    "Part No.",
    "Material Code",
    "code",
    "sku",
  ],
  item_name: [
    "Item Name",
    "ItemName",
    "Item_Name",
    "Item-Name",
    "Description",
    "Material Name",
    "Part Name",
    "product name",
    "name",
  ],
  // Plain "Description" is also an Item Name alias; claimed-column logic
  // prefers Item Name first, then binds a second Description column here.
  description: ["Description", "item description", "desc", "long description"],
  qty: ["Qty", "Quantity", "Required Qty", "qty.", "qnty", "qty required"],
  uom: [
    "UOM",
    "Unit",
    "Unit Of Measure",
    "Unit of Measure",
    "uom/unit",
    "stock uom",
  ],
  required_date: [
    "required date",
    "required_date",
    "need by",
    "delivery date",
    "schedule date",
  ],
  commodity: ["commodity", "commodity code"],
  category: ["category", "item category", "item group", "group"],
  manufacturer: ["manufacturer", "mfr", "make"],
  manufacturer_part_number: [
    "manufacturer part number",
    "mfr part number",
    "mpn",
    "manufacturer_part_number",
  ],
  drawing_number: ["drawing number", "drawing_number", "drawing no", "dwg"],
  revision: ["revision", "rev", "rev."],
  remarks: ["remarks", "remark", "notes", "comment", "comments"],
};

/** Match order — identity + qty first; each Excel column claimed once. */
const COLUMN_FIELD_ORDER = [
  "item_code",
  "item_name",
  "qty",
  "uom",
  "description",
  "required_date",
  "commodity",
  "category",
  "manufacturer",
  "manufacturer_part_number",
  "drawing_number",
  "revision",
  "remarks",
] as const;

const ACCEPTED_COLUMN_HELP = [
  "Item Code: Item Code, ItemCode, Item_Code, Part Number, Part No, Material Code",
  "Item Name: Item Name, ItemName, Description, Material Name, Part Name",
  "Qty: Qty, Quantity, Required Qty",
  "UOM: UOM, Unit, Unit Of Measure",
];

const FALLBACK_UOMS = new Set(
  [
    "Nos",
    "Nos.",
    "Unit",
    "Units",
    "Pcs",
    "Pc",
    "Box",
    "Boxes",
    "Kg",
    "Kilogram",
    "g",
    "Gram",
    "Litre",
    "Liter",
    "L",
    "Meter",
    "Metre",
    "m",
    "cm",
    "mm",
    "Set",
    "Pair",
    "Hour",
    "Day",
    "Month",
    "Year",
    "Pack",
    "Packet",
    "Roll",
    "Sheet",
    "Dozen",
    "Ton",
    "MT",
    "Service",
    "Job",
    "Lot",
  ].map((u) => u.toLowerCase()),
);

/** Normalize Excel headers for fuzzy matching (case, _, -, spaces). */
export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_/\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mapHeaders(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const normalized = headers.map(normalizeHeader);
  const claimed = new Set<number>();

  for (const field of COLUMN_FIELD_ORDER) {
    const aliases = (COLUMN_ALIASES[field] ?? []).map(normalizeHeader);
    const idx = normalized.findIndex(
      (h, i) => Boolean(h) && !claimed.has(i) && aliases.includes(h),
    );
    if (idx >= 0) {
      map[field] = idx;
      claimed.add(idx);
    }
  }
  return map;
}

function formatColumnValidationError(
  detectedHeaders: string[],
  colMap: Record<string, number>,
): string {
  const detected = detectedHeaders
    .map((h) => String(h ?? "").trim())
    .filter(Boolean);
  const missing: string[] = [];
  if (colMap.item_code === undefined && colMap.item_name === undefined) {
    missing.push("Item Code OR Item Name");
  }
  if (colMap.qty === undefined) {
    missing.push("Qty / Quantity");
  }

  return [
    "Missing required columns. Excel must include at least Item Code or Item Name.",
    "",
    "Detected Columns:",
    ...(detected.length ? detected.map((c) => `  - ${c}`) : ["  - (none)"]),
    "",
    "Missing Columns:",
    ...(missing.length ? missing.map((m) => `  - ${m}`) : ["  - (none)"]),
    "",
    "Accepted Names:",
    ...ACCEPTED_COLUMN_HELP.map((a) => `  - ${a}`),
  ].join("\n");
}

/**
 * Real-world workbooks often have a title row above the header.
 * Scan the first rows and pick the best identity+qty match.
 */
function findHeaderRow(matrix: unknown[][]): {
  headerRow: string[];
  dataStart: number;
  colMap: Record<string, number>;
} {
  const maxScan = Math.min(20, matrix.length);
  let best: {
    score: number;
    index: number;
    colMap: Record<string, number>;
    headerRow: string[];
  } | null = null;

  for (let i = 0; i < maxScan; i++) {
    const headerRow = (matrix[i] ?? []).map((h) => String(h ?? ""));
    if (!headerRow.some((h) => h.trim())) continue;
    const colMap = mapHeaders(headerRow);
    const hasIdentity =
      colMap.item_code !== undefined || colMap.item_name !== undefined;
    if (!hasIdentity) continue;

    let score = 0;
    if (colMap.item_code !== undefined) score += 3;
    if (colMap.item_name !== undefined) score += 3;
    if (colMap.qty !== undefined) score += 2;
    if (colMap.uom !== undefined) score += 1;

    if (!best || score > best.score) {
      best = { score, index: i, colMap, headerRow };
    }
  }

  if (best) {
    return {
      headerRow: best.headerRow,
      dataStart: best.index + 1,
      colMap: best.colMap,
    };
  }

  const headerRow = (matrix[0] ?? []).map((h) => String(h ?? ""));
  return {
    headerRow,
    dataStart: 1,
    colMap: mapHeaders(headerRow),
  };
}

function cellStr(row: unknown[], idx: number | undefined): string {
  if (idx === undefined) return "";
  const v = row[idx];
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function cellQty(row: unknown[], idx: number | undefined): number {
  if (idx === undefined) return NaN;
  const v = row[idx];
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/,/g, "").trim());
  return n;
}

function statusLabel(status: BomRowStatus): string {
  switch (status) {
    case "exists":
      return "✓ Exists in ERP";
    case "new":
      return "⚠ New Item";
    case "missing_uom":
      return "Missing UOM";
    case "duplicate":
      return "Duplicate";
    case "invalid":
      return "Invalid";
  }
}

function sanitizeItemCode(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9\-_/ ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 140);
  return cleaned || `BOM-ITEM-${Date.now()}`;
}

/* ────────────────────────────────────────────────────────────────────────
 *  Excel parse
 * ──────────────────────────────────────────────────────────────────────── */

export function parseBomExcelBuffer(
  buffer: Buffer,
  fileName: string,
  validUoms: Set<string>,
): { rows: BomParsedRow[]; warnings: string[] } {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
    throw new BomError("Unsupported file. Please upload an Excel file (.xlsx or .xls).");
  }
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new BomError("File is too large. Maximum size is 20 MB.");
  }
  if (buffer.byteLength === 0) {
    throw new BomError("The uploaded file is empty.");
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    throw new BomError("Invalid Excel file. The file could not be read.");
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new BomError("Excel file has no sheets.");

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });

  if (!matrix.length) throw new BomError("Excel sheet is empty.");

  const { headerRow, dataStart, colMap } = findHeaderRow(matrix);

  if (colMap.item_name === undefined && colMap.item_code === undefined) {
    throw new BomError(formatColumnValidationError(headerRow, colMap));
  }
  if (colMap.qty === undefined) {
    throw new BomError(formatColumnValidationError(headerRow, colMap));
  }

  const warnings: string[] = [];
  if (colMap.uom === undefined) {
    warnings.push('Column "UOM" not found — defaulting to Nos where blank.');
  }

  const seenKeys = new Map<string, number>();
  const rows: BomParsedRow[] = [];

  for (let i = dataStart; i < matrix.length; i++) {
    const raw = matrix[i] ?? [];
    if (!raw.some((c) => String(c ?? "").trim())) continue;

    const excelRow = i + 1;
    const itemCodeRaw = cellStr(raw, colMap.item_code);
    const itemNameRaw = cellStr(raw, colMap.item_name);
    const item_name = itemNameRaw || itemCodeRaw;
    const item_code = itemCodeRaw || (itemNameRaw ? sanitizeItemCode(itemNameRaw) : "");
    const description = cellStr(raw, colMap.description) || item_name;
    const qty = cellQty(raw, colMap.qty);
    let uom = cellStr(raw, colMap.uom) || "Nos";

    const errors: string[] = [];
    if (!item_name) errors.push("Item name is empty");
    if (!Number.isFinite(qty) || qty <= 0) errors.push("Quantity must be greater than 0");

    const uomOk =
      validUoms.size === 0
        ? FALLBACK_UOMS.has(uom.toLowerCase())
        : validUoms.has(uom.toLowerCase()) || FALLBACK_UOMS.has(uom.toLowerCase());
    if (!cellStr(raw, colMap.uom)) {
      // blank UOM → default Nos, warn via status if needed
      uom = "Nos";
    } else if (!uomOk) {
      errors.push(`Invalid UOM "${uom}"`);
    }

    const dedupeKey = `${item_code.toLowerCase()}||${item_name.toLowerCase()}`;
    const prev = seenKeys.get(dedupeKey);
    let status: BomRowStatus = "new";
    if (errors.length) {
      status = "invalid";
    } else if (prev !== undefined) {
      status = "duplicate";
      errors.push(`Duplicate of row ${prev}`);
    } else if (!cellStr(raw, colMap.uom)) {
      status = "missing_uom";
    }
    if (!errors.length && prev === undefined) seenKeys.set(dedupeKey, excelRow);

    rows.push({
      row_number: excelRow,
      item_code,
      item_name,
      description,
      qty: Number.isFinite(qty) ? qty : 0,
      uom,
      required_date: cellStr(raw, colMap.required_date),
      commodity: cellStr(raw, colMap.commodity),
      category: cellStr(raw, colMap.category),
      manufacturer: cellStr(raw, colMap.manufacturer),
      manufacturer_part_number: cellStr(raw, colMap.manufacturer_part_number),
      drawing_number: cellStr(raw, colMap.drawing_number),
      revision: cellStr(raw, colMap.revision),
      remarks: cellStr(raw, colMap.remarks),
      status,
      status_label: statusLabel(status),
      exists_in_erp: false,
      errors,
    });
  }

  if (rows.length === 0) {
    throw new BomError("No data rows found in the Excel file.");
  }
  if (rows.length > 5000) {
    throw new BomError("Too many rows. Please upload a file with at most 5,000 items.");
  }

  return { rows, warnings };
}

/* ────────────────────────────────────────────────────────────────────────
 *  ERP lookups
 * ──────────────────────────────────────────────────────────────────────── */

async function loadValidUoms(cfg: ErpAdminConfig): Promise<Set<string>> {
  try {
    const list = await erpFetch<Array<{ name: string }>>(
      cfg,
      `resource/UOM?fields=${encodeURIComponent(JSON.stringify(["name"]))}&limit_page_length=500`,
    );
    const set = new Set<string>();
    for (const u of list ?? []) {
      if (u?.name) set.add(u.name.toLowerCase());
    }
    return set;
  } catch {
    return new Set();
  }
}

async function lookupItems(
  cfg: ErpAdminConfig,
  rows: BomParsedRow[],
): Promise<void> {
  const codes = Array.from(
    new Set(rows.map((r) => r.item_code).filter(Boolean)),
  );
  if (codes.length === 0) return;

  const found = new Map<string, { item_name: string; item_group?: string; stock_uom?: string }>();

  // Batch in chunks of 50 to stay under URL/filter limits
  for (let i = 0; i < codes.length; i += 50) {
    const chunk = codes.slice(i, i + 50);
    try {
      const list = await erpFetch<
        Array<{
          name: string;
          item_code?: string;
          item_name?: string;
          item_group?: string;
          stock_uom?: string;
          disabled?: number;
        }>
      >(
        cfg,
        `resource/Item?fields=${encodeURIComponent(
          JSON.stringify([
            "name",
            "item_code",
            "item_name",
            "item_group",
            "stock_uom",
            "disabled",
          ]),
        )}&filters=${encodeURIComponent(
          JSON.stringify([["item_code", "in", chunk]]),
        )}&limit_page_length=${chunk.length}`,
      );
      for (const item of list ?? []) {
        if (item.disabled === 1) continue;
        const code = (item.item_code || item.name || "").trim();
        if (!code) continue;
        found.set(code.toLowerCase(), {
          item_name: item.item_name || item.name,
          item_group: item.item_group,
          stock_uom: item.stock_uom,
        });
      }
    } catch (err) {
      throw new BomError(
        err instanceof BomError
          ? err.message
          : "ERP Item lookup failed. ERPNext may be offline.",
        502,
      );
    }
  }

  // Also try matching by item_name for rows without a real code match
  const unmatchedNames = rows
    .filter((r) => !found.has(r.item_code.toLowerCase()) && r.item_name)
    .map((r) => r.item_name);
  const uniqueNames = Array.from(new Set(unmatchedNames)).slice(0, 100);
  for (let i = 0; i < uniqueNames.length; i += 20) {
    const chunk = uniqueNames.slice(i, i + 20);
    try {
      const list = await erpFetch<
        Array<{
          name: string;
          item_code?: string;
          item_name?: string;
          item_group?: string;
          disabled?: number;
        }>
      >(
        cfg,
        `resource/Item?fields=${encodeURIComponent(
          JSON.stringify(["name", "item_code", "item_name", "item_group", "disabled"]),
        )}&filters=${encodeURIComponent(
          JSON.stringify([["item_name", "in", chunk]]),
        )}&limit_page_length=${chunk.length}`,
      );
      for (const item of list ?? []) {
        if (item.disabled === 1) continue;
        const code = (item.item_code || item.name || "").trim();
        const name = (item.item_name || "").trim().toLowerCase();
        if (code) {
          found.set(code.toLowerCase(), {
            item_name: item.item_name || item.name,
            item_group: item.item_group,
          });
        }
        if (name) {
          found.set(`name:${name}`, {
            item_name: item.item_name || item.name,
            item_group: item.item_group,
          });
          // Allow resolving by name key
          (found as Map<string, { item_name: string; item_group?: string; resolved_code?: string }>).set(
            `name:${name}`,
            {
              item_name: item.item_name || item.name,
              item_group: item.item_group,
              resolved_code: code,
            },
          );
        }
      }
    } catch {
      // name lookup is best-effort
    }
  }

  for (const row of rows) {
    if (row.status === "invalid" || row.status === "duplicate") continue;

    const byCode = found.get(row.item_code.toLowerCase());
    const byName = found.get(`name:${row.item_name.toLowerCase()}`) as
      | { item_name: string; item_group?: string; resolved_code?: string }
      | undefined;

    if (byCode) {
      row.exists_in_erp = true;
      row.erp_item_group = byCode.item_group;
      if (row.status === "new" || row.status === "missing_uom") {
        row.status = row.status === "missing_uom" ? "missing_uom" : "exists";
        row.status_label = statusLabel(row.status);
      }
    } else if (byName?.resolved_code) {
      row.exists_in_erp = true;
      row.item_code = byName.resolved_code;
      row.erp_item_group = byName.item_group;
      if (row.status === "new") {
        row.status = "exists";
        row.status_label = statusLabel("exists");
      }
    } else {
      row.exists_in_erp = false;
      if (row.status !== "missing_uom") {
        row.status = "new";
        row.status_label = statusLabel("new");
      }
    }
  }
}

function asRecordArray<T extends Record<string, unknown>>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const nested = (value as { data?: unknown }).data;
    if (Array.isArray(nested)) return nested as T[];
  }
  return [];
}

async function recommendSuppliers(
  cfg: ErpAdminConfig,
  rows: BomParsedRow[],
): Promise<{
  suppliers: RecommendedSupplier[];
  categories: string[];
  meta: SupplierRecommendationMeta;
}> {
  const bomCategories = Array.from(
    new Set(rows.map((r) => r.category.trim()).filter(Boolean)),
  );
  const bomCommodities = Array.from(
    new Set(rows.map((r) => r.commodity.trim()).filter(Boolean)),
  );
  const bomItemGroups = Array.from(
    new Set(rows.map((r) => (r.erp_item_group || "").trim()).filter(Boolean)),
  );

  // Prefer explicit Category, then Commodity, then ERP Item Group
  const categories = Array.from(
    new Set([...bomCategories, ...bomCommodities, ...bomItemGroups]),
  );

  // eslint-disable-next-line no-console
  console.log("[BOM:suppliers] Parsed BOM category signals", {
    per_row: rows.map((r) => ({
      row: r.row_number,
      item_code: r.item_code,
      item_name: r.item_name,
      category: r.category || null,
      commodity: r.commodity || null,
      erp_item_group: r.erp_item_group || null,
    })),
    bom_categories: bomCategories,
    bom_commodities: bomCommodities,
    bom_item_groups: bomItemGroups,
    effective_categories: categories,
  });

  const queryNotes: string[] = [];

  let supplierGroups: Array<{ name: string; is_group?: number }> = [];
  try {
    const rawGroups = await erpFetch(
      cfg,
      `resource/Supplier%20Group?` +
        new URLSearchParams({
          fields: JSON.stringify(["name", "is_group"]),
          limit_page_length: "200",
        }).toString(),
    );
    supplierGroups = asRecordArray<{ name: string; is_group?: number }>(rawGroups);
    // Prefer leaf groups; if none, keep all named groups
    const leaves = supplierGroups.filter((g) => g.is_group !== 1 && g.name);
    if (leaves.length > 0) supplierGroups = leaves;
    queryNotes.push(`Supplier Group master returned ${supplierGroups.length} group(s)`);
  } catch (err) {
    queryNotes.push(
      `Supplier Group query failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    supplierGroups = [];
  }

  const categorySet = new Set(categories.map((c) => c.toLowerCase()));
  const matchedGroups = supplierGroups
    .map((g) => g.name)
    .filter((name) => {
      const n = name.toLowerCase();
      if (categorySet.has(n)) return true;
      for (const c of categorySet) {
        // Avoid ultra-short false positives (e.g. "it", "mro")
        if (c.length < 3) continue;
        if (n.includes(c) || c.includes(n)) return true;
      }
      return false;
    });

  // eslint-disable-next-line no-console
  console.log("[BOM:suppliers] Category → Supplier Group mapping", {
    matched_supplier_groups: matchedGroups,
    all_supplier_groups: supplierGroups.map((g) => g.name),
  });

  type SupplierRow = {
    name: string;
    supplier_name?: string;
    supplier_group?: string;
    country?: string;
    disabled?: number;
  };

  const listSuppliers = async (
    filters: Array<[string, string, string | number | string[]]>,
    label: string,
  ): Promise<SupplierRow[]> => {
    const qs = new URLSearchParams({
      fields: JSON.stringify([
        "name",
        "supplier_name",
        "supplier_group",
        "country",
        "disabled",
      ]),
      filters: JSON.stringify(filters),
      limit_page_length: "100",
      order_by: "supplier_name asc",
    });
    // eslint-disable-next-line no-console
    console.log(`[BOM:suppliers] Query (${label})`, {
      path: `resource/Supplier?${qs.toString()}`,
      filters,
    });
    const raw = await erpFetch(cfg, `resource/Supplier?${qs.toString()}`);
    const list = asRecordArray<SupplierRow>(raw).filter((s) => s && s.disabled !== 1);
    // eslint-disable-next-line no-console
    console.log(`[BOM:suppliers] Result (${label}): ${list.length} supplier(s)`);
    queryNotes.push(`${label}: ${list.length} supplier(s)`);
    return list;
  };

  // Always load active suppliers first (same baseline as New RFQ wizard).
  // Category matching is used for SCORE / ranking — never as a hard empty filter.
  let suppliers: SupplierRow[] = [];
  try {
    suppliers = await listSuppliers([["disabled", "=", 0]], "all_active");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[BOM:suppliers] Active supplier query failed", err);
    throw new BomError("Could not load suppliers. ERPNext may be offline.", 502);
  }

  let categoryMatchedCount = 0;
  let fallbackUsed = false;
  let fallbackReason = "";

  if (suppliers.length === 0) {
    // Retry without disabled filter in case the field is missing / unexpected
    try {
      suppliers = await listSuppliers([], "unfiltered_retry");
      fallbackUsed = true;
      fallbackReason =
        "No suppliers found with disabled=0; retried without the disabled filter.";
    } catch {
      /* keep empty */
    }
  }

  if (matchedGroups.length > 0 && suppliers.length > 0) {
    const matchedSet = new Set(matchedGroups);
    categoryMatchedCount = suppliers.filter((s) =>
      matchedSet.has(s.supplier_group || ""),
    ).length;

    if (categoryMatchedCount === 0) {
      fallbackUsed = true;
      fallbackReason =
        `BOM categories [${categories.join(", ") || "none"}] mapped to ` +
        `supplier groups [${matchedGroups.join(", ")}] but no active suppliers ` +
        `are assigned to those groups. Showing all active suppliers so RFQ can continue.`;
      queryNotes.push(fallbackReason);
    } else {
      queryNotes.push(
        `${categoryMatchedCount} supplier(s) match mapped groups; ranking those higher.`,
      );
    }
  } else if (categories.length === 0) {
    fallbackUsed = true;
    fallbackReason =
      "BOM rows had no Category / Commodity / Item Group. Showing all active suppliers.";
    queryNotes.push(fallbackReason);
  } else if (matchedGroups.length === 0) {
    fallbackUsed = true;
    fallbackReason =
      `No Supplier Group matched BOM categories [${categories.join(", ")}]. ` +
      `Showing all active suppliers.`;
    queryNotes.push(fallbackReason);
  }

  // Past RFQ participation boost (best-effort, capped)
  const rfqCounts = new Map<string, number>();
  try {
    const recentRaw = await erpFetch(
      cfg,
      `resource/Request%20for%20Quotation?` +
        new URLSearchParams({
          fields: JSON.stringify(["name"]),
          limit_page_length: "20",
          order_by: "modified desc",
        }).toString(),
    );
    const recent = asRecordArray<{ name: string }>(recentRaw);
    for (const rfq of recent.slice(0, 10)) {
      try {
        const doc = await erpFetch<{
          suppliers?: Array<{ supplier?: string }>;
        }>(
          cfg,
          `resource/Request%20for%20Quotation/${encodeURIComponent(rfq.name)}`,
        );
        for (const s of doc?.suppliers ?? []) {
          if (!s.supplier) continue;
          rfqCounts.set(s.supplier, (rfqCounts.get(s.supplier) ?? 0) + 1);
        }
      } catch {
        // ignore per-doc failures
      }
    }
  } catch {
    queryNotes.push("Past RFQ boost skipped (query failed).");
  }

  const matchedSet = new Set(matchedGroups);
  const scored: RecommendedSupplier[] = suppliers.map((s) => {
    const reasons: string[] = [];
    let score = 35;
    const group = s.supplier_group || "";
    if (group && matchedSet.has(group)) {
      score += 40;
      reasons.push(`Matches category "${group}"`);
    } else if (group) {
      score += 5;
      reasons.push(`Supplier group: ${group}`);
    }
    const past = rfqCounts.get(s.name) ?? 0;
    if (past > 0) {
      score += Math.min(20, past * 4);
      reasons.push(`Participated in ${past} recent RFQ(s)`);
    }
    if (s.country) {
      score += 5;
      reasons.push(`Location: ${s.country}`);
    }
    if (fallbackUsed && reasons.length === 0) {
      reasons.push("Active supplier (category fallback)");
    } else if (reasons.length === 0) {
      reasons.push("Active supplier");
    }
    return {
      name: s.name,
      supplier_name: s.supplier_name || s.name,
      supplier_group: group,
      country: s.country,
      score: Math.min(100, score),
      reasons,
    };
  });

  // Prefer category-matched suppliers first, then score
  scored.sort((a, b) => {
    const aMatch = matchedSet.has(a.supplier_group) ? 1 : 0;
    const bMatch = matchedSet.has(b.supplier_group) ? 1 : 0;
    if (bMatch !== aMatch) return bMatch - aMatch;
    return b.score - a.score;
  });

  const returned = scored.slice(0, 50);

  // eslint-disable-next-line no-console
  console.log("[BOM:suppliers] Final recommendation", {
    active_suppliers_queried: suppliers.length,
    category_matched_suppliers: categoryMatchedCount,
    returned_suppliers: returned.length,
    fallback_used: fallbackUsed,
    fallback_reason: fallbackReason || null,
    top: returned.slice(0, 5).map((s) => ({
      name: s.name,
      group: s.supplier_group,
      score: s.score,
    })),
  });

  const groupNames = supplierGroups.map((g) => g.name).filter(Boolean);
  const allCategories = Array.from(
    new Set([...groupNames, ...categories]),
  ).sort((a, b) => a.localeCompare(b));

  return {
    suppliers: returned,
    // Dropdown should list real supplier groups (not raw BOM-only labels)
    categories: groupNames.length > 0 ? groupNames.sort((a, b) => a.localeCompare(b)) : allCategories,
    meta: {
      bom_categories: bomCategories,
      bom_commodities: bomCommodities,
      bom_item_groups: bomItemGroups,
      supplier_groups_in_erp: groupNames,
      matched_supplier_groups: matchedGroups,
      active_suppliers_queried: suppliers.length,
      category_matched_suppliers: categoryMatchedCount,
      returned_suppliers: returned.length,
      fallback_used: fallbackUsed,
      fallback_reason: fallbackReason,
      query_notes: queryNotes,
    },
  };
}

function buildSummary(rows: BomParsedRow[]): BomUploadSummary {
  return {
    total_rows: rows.length,
    existing_items: rows.filter((r) => r.status === "exists").length,
    new_items: rows.filter((r) => r.status === "new" || r.status === "missing_uom").length,
    warnings: rows.filter(
      (r) =>
        r.status === "missing_uom" ||
        r.status === "duplicate" ||
        r.status === "new",
    ).length,
    invalid_rows: rows.filter((r) => r.status === "invalid").length,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 *  Public API: upload / parse
 * ──────────────────────────────────────────────────────────────────────── */

export async function processBomUpload(
  buffer: Buffer,
  fileName: string,
): Promise<BomUploadResult> {
  const cfg = readErpAdminConfig();
  const validUoms = await loadValidUoms(cfg);
  const { rows, warnings } = parseBomExcelBuffer(buffer, fileName, validUoms);

  // eslint-disable-next-line no-console
  console.log("[BOM:upload] Parsed rows", {
    file: fileName,
    count: rows.length,
    categories: rows.map((r) => ({
      row: r.row_number,
      category: r.category,
      commodity: r.commodity,
      item_group: r.erp_item_group,
    })),
  });

  await lookupItems(cfg, rows);
  const { suppliers, categories, meta } = await recommendSuppliers(cfg, rows);

  if (meta.fallback_used && meta.fallback_reason) {
    warnings.push(meta.fallback_reason);
  }
  if (suppliers.length === 0) {
    warnings.push(
      "No active suppliers were found in ERPNext. Add suppliers in the Supplier master, then re-upload.",
    );
  }

  return {
    success: true,
    rows,
    summary: buildSummary(rows),
    recommended_suppliers: suppliers,
    supplier_categories: categories,
    file_name: fileName,
    warnings,
    supplier_recommendation: meta,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 *  Ensure non-stock items for new requirements (only at RFQ create time)
 * ──────────────────────────────────────────────────────────────────────── */

async function ensureNonStockItem(
  cfg: ErpAdminConfig,
  row: BomParsedRow,
): Promise<string> {
  const code = sanitizeItemCode(row.item_code || row.item_name);
  try {
    const existing = await erpFetch<{ name?: string; item_code?: string }>(
      cfg,
      `resource/Item/${encodeURIComponent(code)}`,
    );
    if (existing?.name || existing?.item_code) return code;
  } catch {
    // not found — create
  }

  const itemGroup = row.category || row.erp_item_group || "All Item Groups";

  const basePayload: Record<string, unknown> = {
    item_code: code,
    item_name: row.item_name || code,
    description: row.description || row.item_name || code,
    item_group: itemGroup,
    stock_uom: row.uom || "Nos",
    is_stock_item: 0,
    is_purchase_item: 1,
    include_item_in_manufacturing: 0,
  };

  const tryCreate = async (payload: Record<string, unknown>) => {
    await erpFetch(cfg, "resource/Item", { method: "POST", body: payload });
  };

  try {
    await tryCreate(basePayload);
    return code;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Retry with All Item Groups if category/group is invalid
    if (itemGroup !== "All Item Groups") {
      try {
        await tryCreate({ ...basePayload, item_group: "All Item Groups" });
        return code;
      } catch {
        /* fall through to HSN retry */
      }
    }

    // India GST sites often require HSN/SAC — use a generic services SAC
    if (/hsn|sac/i.test(msg)) {
      const sac = "998399";
      try {
        await erpFetch(cfg, "resource/GST%20HSN%20Code", {
          method: "POST",
          body: {
            doctype: "GST HSN Code",
            name: sac,
            hsn_code: sac,
            description: "Other professional / technical services",
          },
        });
      } catch {
        // may already exist
      }
      try {
        await tryCreate({
          ...basePayload,
          item_group: "All Item Groups",
          gst_hsn_code: sac,
        });
        return code;
      } catch (hsnErr) {
        const hsnMsg = hsnErr instanceof Error ? hsnErr.message : String(hsnErr);
        throw new BomError(`Could not register new item "${code}": ${hsnMsg}`);
      }
    }

    throw new BomError(`Could not register new item "${code}": ${msg}`);
  }
}

async function lookupDefaultWarehouse(
  cfg: ErpAdminConfig,
  company: string,
): Promise<string> {
  if (!company) return "";
  try {
    const list = await erpFetch<Array<{ name: string }>>(
      cfg,
      `resource/Warehouse?fields=${encodeURIComponent(
        JSON.stringify(["name"]),
      )}&filters=${encodeURIComponent(
        JSON.stringify([
          ["company", "=", company],
          ["is_group", "=", 0],
        ]),
      )}&limit_page_length=20&order_by=${encodeURIComponent("name asc")}`,
    );
    if (!list?.length) return "";
    const stores = list.find((w) => w.name.toLowerCase().startsWith("stores"));
    return (stores ?? list[0]).name;
  } catch {
    return "";
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ────────────────────────────────────────────────────────────────────────
 *  Create RFQ + Uploaded BOM record
 * ──────────────────────────────────────────────────────────────────────── */

export async function createRfqFromBom(
  input: CreateBomRfqInput,
): Promise<CreateBomRfqResult> {
  const cfg = readErpAdminConfig();

  if (!input.rows?.length) {
    throw new BomError("No BOM items provided.");
  }
  if (!input.suppliers?.length) {
    throw new BomError("Select at least one supplier.");
  }

  const usable = input.rows.filter(
    (r) => r.status !== "invalid" && r.status !== "duplicate" && r.qty > 0 && r.item_name,
  );
  if (usable.length === 0) {
    throw new BomError("No valid items to include in the RFQ.");
  }

  const company =
    input.company ||
    process.env.VITE_COMPANY ||
    process.env.COMPANY_NAME ||
    "";

  const warehouse = company ? await lookupDefaultWarehouse(cfg, company) : "";
  if (company && !warehouse) {
    throw new BomError(
      `No warehouse found for company "${company}". Configure a warehouse in ERPNext before creating an RFQ.`,
    );
  }

  const itemsEnsured: string[] = [];
  const rfqItems: Array<Record<string, unknown>> = [];

  for (const row of usable) {
    let code = row.item_code;
    if (!row.exists_in_erp || row.status === "new" || row.status === "missing_uom") {
      // Only create non-stock Item at RFQ time (never on upload/preview)
      if (!row.exists_in_erp) {
        code = await ensureNonStockItem(cfg, row);
        itemsEnsured.push(code);
      }
    }
    const schedule =
      row.required_date && /^\d{4}-\d{2}-\d{2}/.test(row.required_date)
        ? row.required_date.slice(0, 10)
        : todayIso();

    rfqItems.push({
      doctype: "Request for Quotation Item",
      item_code: code,
      item_name: row.item_name || code,
      description: row.description || row.item_name || code,
      qty: row.qty,
      uom: row.uom || "Nos",
      stock_uom: row.uom || "Nos",
      conversion_factor: 1,
      warehouse: warehouse || undefined,
      schedule_date: schedule,
    });
  }

  const doc = {
    doctype: "Request for Quotation",
    transaction_date: todayIso(),
    status: "Draft",
    message_for_supplier:
      input.message_for_supplier ||
      `RFQ created from uploaded procurement BOM${input.file_name ? ` (${input.file_name})` : ""}.`,
    company: company || undefined,
    items: rfqItems,
    suppliers: input.suppliers.map((s) => ({
      doctype: "Request for Quotation Supplier",
      supplier: s.supplier,
      supplier_name: s.supplier_name || s.supplier,
    })),
  };

  let rfqName = "";
  try {
    const saved = await erpFetch<{ name?: string }>(cfg, "method/frappe.client.save", {
      method: "POST",
      body: { doc },
    });
    rfqName = saved?.name || "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BomError(`Failed to create RFQ: ${msg}`, 502);
  }
  if (!rfqName) throw new BomError("RFQ was created but no name was returned.", 502);

  // Persist Uploaded BOM audit record (best-effort if DocType not yet set up)
  let uploadedBomName = "";
  try {
    const bomDoc = {
      doctype: "Uploaded BOM",
      bom_number: `BOM-${Date.now()}`,
      uploaded_by: input.uploaded_by || "Guest",
      upload_date: todayIso(),
      status: "RFQ Created",
      total_items: usable.length,
      rfq: rfqName,
      remarks: input.remarks || "",
      items: usable.map((r) => ({
        doctype: "Uploaded BOM Item",
        item_code: r.item_code,
        item_name: r.item_name,
        qty: r.qty,
        uom: r.uom,
        description: r.description,
        exists_in_erp: r.exists_in_erp ? 1 : 0,
      })),
    };
    const created = await erpFetch<{ name?: string }>(cfg, "resource/Uploaded%20BOM", {
      method: "POST",
      body: bomDoc,
    });
    uploadedBomName = created?.name || "";

    // Attach original file if provided
    if (uploadedBomName && input.file_base64 && input.file_name) {
      try {
        const bin = Buffer.from(input.file_base64, "base64");
        const form = new FormData();
        // Node 18+ / Vercel: Blob is available. Cast Buffer for BlobPart.
        const blob = new Blob([new Uint8Array(bin)], {
          type:
            input.file_mime ||
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        form.append("file", blob, input.file_name);
        form.append("is_private", "1");
        form.append("doctype", "Uploaded BOM");
        form.append("docname", uploadedBomName);
        form.append("fieldname", "original_file");
        await erpFetch(cfg, "method/upload_file", {
          method: "POST",
          formData: form,
        });
      } catch {
        // file attach is best-effort
      }
    }
  } catch {
    // DocType may not be installed yet — RFQ still succeeded
    uploadedBomName = uploadedBomName || "";
  }

  return {
    success: true,
    rfq_name: rfqName,
    uploaded_bom_name: uploadedBomName,
    items_ensured: itemsEnsured,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 *  History
 * ──────────────────────────────────────────────────────────────────────── */

export async function getBomHistory(limit = 50): Promise<BomHistoryRow[]> {
  const cfg = readErpAdminConfig();
  try {
    const list = await erpFetch<
      Array<{
        name: string;
        bom_number?: string;
        uploaded_by?: string;
        upload_date?: string;
        status?: string;
        total_items?: number;
        rfq?: string;
        remarks?: string;
        original_file?: string;
      }>
    >(
      cfg,
      `resource/Uploaded%20BOM?fields=${encodeURIComponent(
        JSON.stringify([
          "name",
          "bom_number",
          "uploaded_by",
          "upload_date",
          "status",
          "total_items",
          "rfq",
          "remarks",
          "original_file",
        ]),
      )}&limit_page_length=${limit}&order_by=${encodeURIComponent("modified desc")}`,
    );

    return (list ?? []).map((r) => ({
      name: r.name,
      bom_number: r.bom_number || r.name,
      uploaded_by: r.uploaded_by || "",
      upload_date: r.upload_date || "",
      status: r.status || "",
      total_items: r.total_items ?? 0,
      rfq: r.rfq || "",
      remarks: r.remarks || "",
      original_file: r.original_file || "",
    }));
  } catch {
    return [];
  }
}

/* ────────────────────────────────────────────────────────────────────────
 *  Sample template
 * ──────────────────────────────────────────────────────────────────────── */

export function buildSampleBomWorkbook(): Buffer {
  const headers = [
    "Item Code",
    "Item Name",
    "Description",
    "Quantity",
    "UOM",
    "Required Date",
    "Commodity",
    "Category",
    "Manufacturer",
    "Manufacturer Part Number",
    "Drawing Number",
    "Revision",
    "Remarks",
  ];
  const sample = [
    [
      "SRM005",
      "Conveyor Maintenance",
      "Annual conveyor maintenance service",
      10,
      "Nos",
      "2026-08-01",
      "Services",
      "MRO (Maintenance, Repair & Operations)",
      "",
      "",
      "",
      "",
      "Plant A",
    ],
    [
      "",
      "Internet Provider",
      "Dedicated 100 Mbps leased line",
      1,
      "Month",
      "2026-07-15",
      "IT",
      "Professional Services",
      "",
      "",
      "",
      "",
      "New requirement",
    ],
    [
      "",
      "Cleaning Service",
      "Monthly facility cleaning",
      12,
      "Nos",
      "2026-07-20",
      "Facility",
      "Facility Management",
      "",
      "",
      "",
      "",
      "",
    ],
  ];

  const sheet = XLSX.utils.aoa_to_sheet([headers, ...sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "BOM");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
