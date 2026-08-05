/**
 * Supplier Portal — RFQ documents (supplier-visible only).
 *
 * Resolves engineering attachments from:
 *  - RFQ Item JSON / legacy drawing
 *  - File DocType on Request for Quotation Item
 *  - Linked Material Request Item (JSON + File DocType)
 *  - Department source MR Item (when Purchase MR shortfall rows are empty)
 *
 * Internal Only files are stripped before returning to the supplier.
 */

import {
  filterSupplierVisibleAttachments,
  inferDocumentTypeFromFileName,
  normalizeAttachmentVisibility,
  normalizeErpFilePath,
  parseAttachmentVisibilityRows,
  supplierMayAccessAttachmentPath,
  type AttachmentVisibilityRow,
} from "../src/utils/rfqAttachmentVisibility.js";

export interface ErpAdminConfig {
  baseUrl: string;
  key: string;
  secret: string;
}

export class SupplierRfqDocumentsError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "SupplierRfqDocumentsError";
    this.status = status;
  }
}

export interface SupplierRfqDocument {
  id: string;
  fileName: string;
  fileUrl: string;
  documentType: string;
  fileType: string;
  version: number;
  uploadedBy: string;
  uploadedAt: string;
  fileSize: number;
  itemCode?: string;
  itemName?: string;
  previewable: boolean;
}

interface RfqItemRow {
  name?: string;
  item_code?: string;
  item_name?: string;
  material_request?: string;
  material_request_item?: string;
  custom_2d_drawing?: string;
  custom_engineering_attachments?: string;
}

interface RfqDoc {
  name?: string;
  docstatus?: number;
  status?: string;
  suppliers?: Array<{ supplier?: string; supplier_name?: string }>;
  items?: RfqItemRow[];
}

function normalizeSupplierKey(value: string): string {
  return String(value || "").trim().toLowerCase();
}

/** Collect distinct ERP supplier identifiers from portal session / JWT. */
export function buildSupplierAccessCandidates(input: {
  explicitSupplierId?: string | null;
  jwtSupplier?: string | null;
  jwtSub?: string | null;
  extra?: Array<string | null | undefined>;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [
    input.explicitSupplierId,
    input.jwtSupplier,
    input.jwtSub,
    ...(input.extra ?? []),
  ]) {
    const value = String(raw ?? "").trim();
    const key = normalizeSupplierKey(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** True when any candidate matches RFQ Supplier invitation rows. */
export function isSupplierInvitedToRfq(
  rfq: RfqDoc,
  supplierCandidates: string[],
): boolean {
  const keys = supplierCandidates
    .map(normalizeSupplierKey)
    .filter(Boolean);
  if (keys.length === 0) return false;

  return (rfq.suppliers ?? []).some((row) => {
    const supplier = normalizeSupplierKey(String(row.supplier || ""));
    const supplierName = normalizeSupplierKey(String(row.supplier_name || ""));
    return keys.some(
      (key) => key === supplier || (supplierName && key === supplierName),
    );
  });
}

async function assertSupplierInvitedToRfq(
  cfg: ErpAdminConfig,
  rfq: RfqDoc,
  supplierCandidates: string[],
): Promise<void> {
  if (isSupplierInvitedToRfq(rfq, supplierCandidates)) return;

  /* Fallback: supplier may already have a quotation against this RFQ. */
  const rfqName = String(rfq.name || "").trim();
  if (rfqName) {
    for (const candidate of supplierCandidates) {
      const filters = encodeURIComponent(
        JSON.stringify([
          ["items.request_for_quotation", "=", rfqName],
          ["supplier", "=", candidate],
        ]),
      );
      const fields = encodeURIComponent(JSON.stringify(["name"]));
      const sq = await erpFetch<Array<{ name?: string }>>(
        cfg,
        `resource/Supplier%20Quotation?filters=${filters}&fields=${fields}&limit_page_length=1`,
      );
      if ((sq.data ?? []).length > 0) return;
    }
  }

  throw new SupplierRfqDocumentsError("Supplier not assigned", 403);
}

interface ErpFileRow {
  name?: string;
  file_name?: string;
  file_url?: string;
  file_size?: number;
  owner?: string;
  creation?: string;
}

interface MrHeaderLite {
  name?: string;
  custom_warehouse_remarks?: string;
  remarks?: string;
  items?: Array<{ description?: string; item_code?: string; name?: string }>;
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
    throw new SupplierRfqDocumentsError(
      "RFQ documents backend misconfigured: missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET.",
      500,
    );
  }
  return { baseUrl, key, secret };
}

async function erpFetch<T = unknown>(
  cfg: ErpAdminConfig,
  path: string,
): Promise<{ status: number; data: T | null }> {
  const res = await fetch(`${cfg.baseUrl}/api/${path}`, {
    method: "GET",
    headers: {
      Authorization: `token ${cfg.key}:${cfg.secret}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    return { status: res.status, data: null };
  }
  const data = (json as { data?: T })?.data ?? (json as T);
  return { status: res.status, data: data ?? null };
}

function isPreviewable(fileName: string, fileType?: string): boolean {
  const path = fileName.split("?")[0]?.toLowerCase() ?? "";
  if (/\.(png|jpe?g|pdf|gif|webp)$/i.test(path)) return true;
  const t = (fileType ?? "").toLowerCase();
  return t.includes("pdf") || t.startsWith("image/");
}

function toDocument(
  row: AttachmentVisibilityRow,
  meta?: { itemCode?: string; itemName?: string },
): SupplierRfqDocument {
  const fileName = row.fileName || fileLabel(row.fileUrl);
  const ext =
    (fileName.split(".").pop() || "").toLowerCase() ||
    String(row.fileType || "file").toLowerCase();
  return {
    id: String(row.id || `doc_${normalizeErpFilePath(row.fileUrl)}`),
    fileName,
    fileUrl: row.fileUrl,
    documentType:
      row.documentType || inferDocumentTypeFromFileName(fileName),
    fileType: ext || "file",
    version: row.version && row.version > 0 ? row.version : 1,
    uploadedBy: row.uploadedBy || "—",
    uploadedAt: row.uploadedAt || "",
    fileSize: row.fileSize ?? 0,
    itemCode: meta?.itemCode,
    itemName: meta?.itemName,
    previewable: isPreviewable(fileName, row.fileType),
  };
}

function fileLabel(url: string): string {
  try {
    const path = url.split("?")[0] ?? url;
    const seg = path.split("/").pop() ?? path;
    return decodeURIComponent(seg);
  } catch {
    return url;
  }
}

function mergeAttachmentRows(
  ...lists: AttachmentVisibilityRow[][]
): AttachmentVisibilityRow[] {
  const byPath = new Map<string, AttachmentVisibilityRow>();
  for (const list of lists) {
    for (const row of list) {
      const key = normalizeErpFilePath(row.fileUrl);
      if (!key) continue;
      const existing = byPath.get(key);
      if (!existing) {
        byPath.set(key, { ...row });
        continue;
      }
      /* Prefer richer metadata; keep explicit internal visibility if any copy has it. */
      byPath.set(key, {
        ...existing,
        ...row,
        id: existing.id || row.id,
        fileName: existing.fileName || row.fileName,
        fileType: existing.fileType || row.fileType,
        fileSize: existing.fileSize || row.fileSize || 0,
        uploadedBy: existing.uploadedBy || row.uploadedBy,
        uploadedAt: existing.uploadedAt || row.uploadedAt,
        documentType: existing.documentType || row.documentType,
        version: existing.version || row.version || 1,
        visibility:
          normalizeAttachmentVisibility(existing.visibility) === "internal" ||
          normalizeAttachmentVisibility(row.visibility) === "internal"
            ? "internal"
            : "supplier",
        source: existing.source || row.source,
      });
    }
  }
  return [...byPath.values()];
}

async function loadFileDoctypeAttachments(
  cfg: ErpAdminConfig,
  doctype: string,
  docName: string,
  defaults?: Partial<AttachmentVisibilityRow>,
): Promise<AttachmentVisibilityRow[]> {
  const name = String(docName || "").trim();
  if (!name) return [];

  const filters = encodeURIComponent(
    JSON.stringify([
      ["attached_to_doctype", "=", doctype],
      ["attached_to_name", "=", name],
      ["is_folder", "=", 0],
    ]),
  );
  const fields = encodeURIComponent(
    JSON.stringify([
      "name",
      "file_name",
      "file_url",
      "file_size",
      "owner",
      "creation",
    ]),
  );
  const files = await erpFetch<ErpFileRow[]>(
    cfg,
    `resource/File?filters=${filters}&fields=${fields}&limit_page_length=50&order_by=creation%20asc`,
  );

  if (files.status >= 400) {
    // Primary RFQ File lookups must surface errors (never silent empty).
    // Secondary MR/item File lookups degrade so one bad link does not blank
    // the whole documents section.
    if (doctype === "Request for Quotation") {
      throw new SupplierRfqDocumentsError(
        `Unable to load RFQ attachments (HTTP ${files.status}).`,
        files.status >= 500 ? 502 : files.status,
      );
    }
    return [];
  }

  const out: AttachmentVisibilityRow[] = [];
  for (const row of files.data ?? []) {
    const fileUrl = String(row.file_url || "").trim();
    if (!fileUrl) continue;
    const fileName = String(row.file_name || fileLabel(fileUrl)).trim();
    out.push({
      id: row.name,
      fileUrl,
      fileName,
      fileType: (fileName.split(".").pop() || "file").toLowerCase(),
      fileSize: Number(row.file_size ?? 0) || 0,
      uploadedBy: row.owner || defaults?.uploadedBy,
      uploadedAt: row.creation || defaults?.uploadedAt || "",
      visibility: defaults?.visibility ?? "supplier",
      documentType:
        defaults?.documentType || inferDocumentTypeFromFileName(fileName),
      source: defaults?.source,
      version: defaults?.version ?? 1,
    });
  }
  return out;
}

function collectFromJsonAndLegacy(source: {
  custom_engineering_attachments?: string;
  custom_2d_drawing?: string;
}): AttachmentVisibilityRow[] {
  const fromJson = parseAttachmentVisibilityRows(
    source.custom_engineering_attachments,
  );
  if (fromJson.length > 0) return fromJson;
  const legacy = String(source.custom_2d_drawing || "").trim();
  if (!legacy) return [];
  return [
    {
      fileUrl: legacy,
      fileName: fileLabel(legacy),
      visibility: "supplier",
      documentType: inferDocumentTypeFromFileName(fileLabel(legacy)),
      version: 1,
      fileSize: 0,
      source: "department",
    },
  ];
}

async function loadMrItemAttachments(
  cfg: ErpAdminConfig,
  mrItemName: string,
): Promise<AttachmentVisibilityRow[]> {
  const name = String(mrItemName || "").trim();
  if (!name) return [];

  const child = await erpFetch<{
    custom_engineering_attachments?: string;
    custom_2d_drawing?: string;
  }>(
    cfg,
    `resource/Material%20Request%20Item/${encodeURIComponent(name)}`,
  );

  const fromJson = collectFromJsonAndLegacy({
    custom_engineering_attachments: child.data?.custom_engineering_attachments,
    custom_2d_drawing: child.data?.custom_2d_drawing,
  });

  const fromFiles = await loadFileDoctypeAttachments(
    cfg,
    "Material Request Item",
    name,
    { visibility: "supplier", source: "department" },
  );

  return mergeAttachmentRows(fromJson, fromFiles);
}

/** Mirror of extractSourceDepartmentMrName — kept local for serverless bundle. */
function extractSourceDepartmentMrName(mr: MrHeaderLite): string | undefined {
  const remarks = String(mr.custom_warehouse_remarks ?? mr.remarks ?? "");
  const fromDecision = remarks.match(
    /Created from warehouse decision on\s+([A-Z0-9/-]+)/i,
  );
  if (fromDecision?.[1]?.trim()) return fromDecision[1].trim();

  const fromReview = remarks.match(
    /Created from warehouse review of\s+([A-Z0-9/-]+)/i,
  );
  if (fromReview?.[1]?.trim()) return fromReview[1].trim();

  for (const it of mr.items ?? []) {
    const m = String(it?.description ?? "").match(
      /\[Shortfall from\s+([^\]]+)\]/i,
    );
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return undefined;
}

async function loadDepartmentSourceMrAttachments(
  cfg: ErpAdminConfig,
  purchaseMrName: string | undefined,
  itemCode: string | undefined,
): Promise<AttachmentVisibilityRow[]> {
  const mrName = String(purchaseMrName || "").trim();
  const code = String(itemCode || "").trim();
  if (!mrName || !code) return [];

  const mrRes = await erpFetch<MrHeaderLite>(
    cfg,
    `resource/Material%20Request/${encodeURIComponent(mrName)}`,
  );
  if (!mrRes.data?.name) return [];

  const sourceName = extractSourceDepartmentMrName(mrRes.data);
  if (!sourceName || sourceName === mrName) return [];

  const filters = encodeURIComponent(
    JSON.stringify([
      ["parent", "=", sourceName],
      ["item_code", "=", code],
    ]),
  );
  const fields = encodeURIComponent(JSON.stringify(["name", "item_code"]));
  const rows = await erpFetch<Array<{ name?: string }>>(
    cfg,
    `resource/Material%20Request%20Item?filters=${filters}&fields=${fields}&limit_page_length=1`,
  );
  const childName = String(rows.data?.[0]?.name || "").trim();
  if (!childName) return [];
  return loadMrItemAttachments(cfg, childName);
}

async function collectAllForRfqItem(
  cfg: ErpAdminConfig,
  item: RfqItemRow,
): Promise<AttachmentVisibilityRow[]> {
  const fromRfqJson = collectFromJsonAndLegacy(item);
  const fromRfqFiles = item.name
    ? await loadFileDoctypeAttachments(
        cfg,
        "Request for Quotation Item",
        item.name,
        { visibility: "supplier", source: "procurement" },
      )
    : [];

  let fromMr: AttachmentVisibilityRow[] = [];
  if (item.material_request_item) {
    fromMr = await loadMrItemAttachments(cfg, item.material_request_item);
  }

  let fromDept: AttachmentVisibilityRow[] = [];
  if (fromMr.length === 0 || fromRfqJson.length === 0) {
    fromDept = await loadDepartmentSourceMrAttachments(
      cfg,
      item.material_request,
      item.item_code,
    );
  }

  /* If purchase MR link exists but department still has extras, merge them. */
  if (fromDept.length === 0 && item.material_request && item.item_code) {
    fromDept = await loadDepartmentSourceMrAttachments(
      cfg,
      item.material_request,
      item.item_code,
    );
  }

  return mergeAttachmentRows(fromRfqJson, fromRfqFiles, fromMr, fromDept);
}

/**
 * List RFQ-level (header) documents only — not line-item attachments.
 */
export async function listSupplierRfqHeaderDocuments(input: {
  rfqName: string;
  supplierId: string;
  supplierCandidates?: string[];
  cfg?: ErpAdminConfig;
}): Promise<SupplierRfqDocument[]> {
  const rfqName = String(input.rfqName || "").trim();
  const supplierCandidates = buildSupplierAccessCandidates({
    explicitSupplierId: input.supplierId,
    extra: input.supplierCandidates,
  });
  if (!rfqName) {
    throw new SupplierRfqDocumentsError("RFQ name is required.", 400);
  }
  if (supplierCandidates.length === 0) {
    throw new SupplierRfqDocumentsError("Supplier identity is required.", 401);
  }

  const cfg = input.cfg ?? readErpAdminConfig();
  await assertSupplierRfqAccess(cfg, rfqName, supplierCandidates);

  const merged: SupplierRfqDocument[] = [];
  const seen = new Set<string>();

  const headerFiles = await loadFileDoctypeAttachments(
    cfg,
    "Request for Quotation",
    rfqName,
    { visibility: "supplier", source: "procurement" },
  );
  for (const row of filterSupplierVisibleAttachments(headerFiles)) {
    const key = normalizeErpFilePath(row.fileUrl);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(toDocument(row));
  }

  merged.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return merged;
}

/**
 * List supplier-visible documents for a single RFQ line item.
 */
export async function listSupplierRfqItemDocuments(input: {
  rfqName: string;
  itemCode: string;
  supplierId: string;
  supplierCandidates?: string[];
  cfg?: ErpAdminConfig;
}): Promise<SupplierRfqDocument[]> {
  const rfqName = String(input.rfqName || "").trim();
  const itemCode = String(input.itemCode || "").trim();
  const supplierCandidates = buildSupplierAccessCandidates({
    explicitSupplierId: input.supplierId,
    extra: input.supplierCandidates,
  });
  if (!rfqName || !itemCode) {
    throw new SupplierRfqDocumentsError("RFQ name and item code are required.", 400);
  }
  if (supplierCandidates.length === 0) {
    throw new SupplierRfqDocumentsError("Supplier identity is required.", 401);
  }

  const cfg = input.cfg ?? readErpAdminConfig();
  const rfq = await assertSupplierRfqAccess(cfg, rfqName, supplierCandidates);
  const item = (rfq.items ?? []).find(
    (row) => String(row.item_code || "").trim() === itemCode,
  );
  if (!item) {
    return [];
  }

  const rows = filterSupplierVisibleAttachments(
    await collectAllForRfqItem(cfg, item),
  );
  const docs = rows.map((row) =>
    toDocument(row, {
      itemCode: item.item_code,
      itemName: item.item_name,
    }),
  );
  docs.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return docs;
}

async function assertSupplierRfqAccess(
  cfg: ErpAdminConfig,
  rfqName: string,
  supplierCandidates: string[],
): Promise<RfqDoc> {
  const rfqRes = await erpFetch<RfqDoc>(
    cfg,
    `resource/Request%20for%20Quotation/${encodeURIComponent(rfqName)}`,
  );
  if (rfqRes.status === 404 || !rfqRes.data?.name) {
    throw new SupplierRfqDocumentsError("RFQ not found", 404);
  }
  const rfq = rfqRes.data;
  const docstatus = Number(rfq.docstatus ?? 0);
  if (docstatus === 0) {
    throw new SupplierRfqDocumentsError("This RFQ has not been published yet.", 403);
  }
  if (docstatus === 2) {
    throw new SupplierRfqDocumentsError("RFQ closed", 403);
  }
  const status = String(rfq.status || "").trim().toLowerCase();
  if (status === "cancelled" || status === "closed") {
    throw new SupplierRfqDocumentsError("RFQ closed", 403);
  }
  await assertSupplierInvitedToRfq(cfg, rfq, supplierCandidates);
  return rfq;
}

/** All supplier-visible paths on an RFQ (header + every line) — used for file ACL. */
async function listAllSupplierRfqDocumentsForAcl(input: {
  rfqName: string;
  supplierId: string;
  supplierCandidates?: string[];
  cfg?: ErpAdminConfig;
}): Promise<SupplierRfqDocument[]> {
  const rfqName = String(input.rfqName || "").trim();
  const supplierCandidates = buildSupplierAccessCandidates({
    explicitSupplierId: input.supplierId,
    extra: input.supplierCandidates,
  });
  if (!rfqName || supplierCandidates.length === 0) return [];

  const cfg = input.cfg ?? readErpAdminConfig();
  const rfq = await assertSupplierRfqAccess(cfg, rfqName, supplierCandidates);

  const merged: SupplierRfqDocument[] = [];
  const seen = new Set<string>();

  for (const item of rfq.items ?? []) {
    const rows = filterSupplierVisibleAttachments(
      await collectAllForRfqItem(cfg, item),
    );
    for (const row of rows) {
      const key = normalizeErpFilePath(row.fileUrl);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(
        toDocument(row, {
          itemCode: item.item_code,
          itemName: item.item_name,
        }),
      );
    }
  }

  const headerFiles = await loadFileDoctypeAttachments(
    cfg,
    "Request for Quotation",
    rfqName,
    { visibility: "supplier", source: "procurement" },
  );
  for (const row of filterSupplierVisibleAttachments(headerFiles)) {
    const key = normalizeErpFilePath(row.fileUrl);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(toDocument(row));
  }

  return merged;
}

/**
 * List supplier-visible RFQ documents for an invited supplier.
 *
 * Default scope returns header + all line-item documents (what the supplier
 * RFQ Documents section needs). Pass `itemCode` for a single line, or
 * `scope: "header"` for header-only.
 */
export async function listSupplierRfqDocuments(input: {
  rfqName: string;
  supplierId: string;
  /** Additional ERP supplier ids to try (JWT sub/supplier, session linked id). */
  supplierCandidates?: string[];
  cfg?: ErpAdminConfig;
  /** When set, returns documents for that line item only. */
  itemCode?: string;
  /** header = RFQ-level only; all (default) = header + line items. */
  scope?: "header" | "item" | "all";
}): Promise<SupplierRfqDocument[]> {
  const itemCode = String(input.itemCode || "").trim();
  if (itemCode || input.scope === "item") {
    if (!itemCode) {
      throw new SupplierRfqDocumentsError("Item code is required for item scope.", 400);
    }
    return listSupplierRfqItemDocuments({
      rfqName: input.rfqName,
      itemCode,
      supplierId: input.supplierId,
      supplierCandidates: input.supplierCandidates,
      cfg: input.cfg,
    });
  }
  if (input.scope === "header") {
    return listSupplierRfqHeaderDocuments(input);
  }

  const docs = await listAllSupplierRfqDocumentsForAcl(input);
  docs.sort((a, b) => {
    const aItem = a.itemCode || "";
    const bItem = b.itemCode || "";
    if (aItem !== bItem) return aItem.localeCompare(bItem);
    return a.fileName.localeCompare(b.fileName);
  });
  // eslint-disable-next-line no-console
  console.info("[supplier-rfq-documents] listed", {
    rfqId: String(input.rfqName || "").trim(),
    documentCount: docs.length,
    scope: "all",
  });
  return docs;
}

/**
 * Backend ACL for file-proxy: deny Internal Only paths for suppliers when
 * the file is referenced by the given RFQ with visibility=internal.
 */
export async function assertSupplierMayDownloadRfqFile(input: {
  rfqName: string;
  supplierId: string;
  supplierCandidates?: string[];
  filePath: string;
  cfg?: ErpAdminConfig;
}): Promise<void> {
  const docs = await listAllSupplierRfqDocumentsForAcl({
    rfqName: input.rfqName,
    supplierId: input.supplierId,
    supplierCandidates: input.supplierCandidates,
    cfg: input.cfg,
  });
  const allowed = docs.some(
    (d) =>
      normalizeErpFilePath(d.fileUrl) === normalizeErpFilePath(input.filePath),
  );
  if (!allowed) {
    /* Double-check: path may be internal-only on this RFQ. */
    const cfg = input.cfg ?? readErpAdminConfig();
    const rfqRes = await erpFetch<RfqDoc>(
      cfg,
      `resource/Request%20for%20Quotation/${encodeURIComponent(input.rfqName)}`,
    );
    const rows: AttachmentVisibilityRow[] = [];
    for (const item of rfqRes.data?.items ?? []) {
      rows.push(...(await collectAllForRfqItem(cfg, item)));
    }
    if (!supplierMayAccessAttachmentPath(input.filePath, rows)) {
      throw new SupplierRfqDocumentsError(
        "You do not have permission to view this document.",
        403,
      );
    }
    throw new SupplierRfqDocumentsError(
      "You do not have permission to view this document.",
      403,
    );
  }
}

export function attachmentVisibilityFromItemJson(
  raw: unknown,
): AttachmentVisibilityRow[] {
  return parseAttachmentVisibilityRows(raw).map((r) => ({
    ...r,
    visibility: normalizeAttachmentVisibility(r.visibility),
  }));
}

function collectFromRfqItem(item: RfqItemRow): AttachmentVisibilityRow[] {
  return collectFromJsonAndLegacy(item);
}

export { collectFromRfqItem };
