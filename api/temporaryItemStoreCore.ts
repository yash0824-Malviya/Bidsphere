/**
 * Temporary Item Store — staging area for BOM lines not yet in Item Master.
 * Master Data approves → ERP Item is created. Reject → Pending Review.
 */
import { BomError, readErpAdminConfig, type BomParsedRow } from "./bomCore.js";

export type TemporaryItemStatus = "Pending Review" | "Approved" | "Rejected";

export interface TemporaryItemRecord {
  name: string;
  item_name: string;
  proposed_item_code?: string;
  description?: string;
  item_group?: string;
  commodity?: string;
  default_uom?: string;
  manufacturer?: string;
  drawing_number?: string;
  revision?: string;
  qty?: number;
  status: TemporaryItemStatus;
  source_upload?: string;
  department?: string;
  project?: string;
  program?: string;
  uploaded_by?: string;
  erp_item?: string;
  rejection_reason?: string;
  modified?: string;
}

const TEMP_DOCTYPE = "Temporary Item Store";

async function erpFetch<T = unknown>(
  cfg: ReturnType<typeof readErpAdminConfig>,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `token ${cfg.key}:${cfg.secret}`,
    Accept: "application/json",
  };
  let body: BodyInit | undefined;
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
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
    const msg =
      (data as { message?: string; exc?: string })?.message ||
      (data as { exc?: string })?.exc ||
      text ||
      `ERPNext request failed (${res.status})`;
    throw new BomError(String(msg).slice(0, 500), res.status >= 500 ? 502 : 400);
  }
  const envelope = data as { message?: T; data?: T };
  if (envelope.data !== undefined) return envelope.data;
  if (envelope.message !== undefined) return envelope.message;
  return data as T;
}

function slugItemCode(row: BomParsedRow): string {
  const fromRow = String(row.item_code || "").trim();
  if (fromRow) return fromRow.slice(0, 140);
  const base = String(row.item_name || "TEMP")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `TMP-${base || "ITEM"}-${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

export async function createTemporaryItemsFromBomRows(input: {
  rows: BomParsedRow[];
  sourceUpload: string;
  department?: string;
  project?: string;
  program?: string;
  uploadedBy?: string;
}): Promise<TemporaryItemRecord[]> {
  const cfg = readErpAdminConfig();
  const created: TemporaryItemRecord[] = [];

  for (const row of input.rows) {
    if (row.exists_in_erp || row.status === "invalid" || row.status === "duplicate") {
      continue;
    }
    const doc = {
      doctype: TEMP_DOCTYPE,
      item_name: row.item_name || row.item_code || "Unnamed item",
      proposed_item_code: slugItemCode(row),
      description: row.description || row.item_name,
      item_group: row.category || row.commodity || "Raw Material",
      commodity: row.commodity || "",
      default_uom: row.uom || "Nos",
      manufacturer: row.manufacturer || "",
      drawing_number: row.drawing_number || "",
      revision: row.revision || "",
      qty: row.qty || 1,
      status: "Pending Review",
      source_upload: input.sourceUpload,
      department: input.department || "",
      project: input.project || "",
      program: input.program || "",
      uploaded_by: input.uploadedBy || "",
    };
    try {
      const saved = await erpFetch<{ name?: string }>(cfg, `resource/${encodeURIComponent(TEMP_DOCTYPE)}`, {
        method: "POST",
        body: doc,
      });
      created.push({
        name: saved?.name || "",
        item_name: doc.item_name,
        proposed_item_code: doc.proposed_item_code,
        description: doc.description,
        item_group: doc.item_group,
        commodity: doc.commodity,
        default_uom: doc.default_uom,
        manufacturer: doc.manufacturer,
        drawing_number: doc.drawing_number,
        revision: doc.revision,
        qty: doc.qty,
        status: "Pending Review",
        source_upload: input.sourceUpload,
        department: input.department,
        project: input.project,
        program: input.program,
        uploaded_by: input.uploadedBy,
      });
    } catch (err) {
      console.warn("[TemporaryItemStore] create skipped:", err instanceof Error ? err.message : err);
    }
  }
  return created;
}

export async function listTemporaryItems(limit = 200): Promise<TemporaryItemRecord[]> {
  const cfg = readErpAdminConfig();
  try {
    const rows = await erpFetch<
      Array<Record<string, unknown>>
    >(
      cfg,
      `resource/${encodeURIComponent(TEMP_DOCTYPE)}?fields=${encodeURIComponent(
        JSON.stringify([
          "name",
          "item_name",
          "proposed_item_code",
          "description",
          "item_group",
          "commodity",
          "default_uom",
          "manufacturer",
          "drawing_number",
          "revision",
          "qty",
          "status",
          "source_upload",
          "department",
          "project",
          "program",
          "uploaded_by",
          "erp_item",
          "rejection_reason",
          "modified",
        ]),
      )}&limit_page_length=${limit}&order_by=${encodeURIComponent("modified desc")}`,
    );
    return (rows ?? []).map(mapTempRow);
  } catch {
    return [];
  }
}

function mapTempRow(r: Record<string, unknown>): TemporaryItemRecord {
  return {
    name: String(r.name ?? ""),
    item_name: String(r.item_name ?? ""),
    proposed_item_code: String(r.proposed_item_code ?? ""),
    description: String(r.description ?? ""),
    item_group: String(r.item_group ?? ""),
    commodity: String(r.commodity ?? ""),
    default_uom: String(r.default_uom ?? "Nos"),
    manufacturer: String(r.manufacturer ?? ""),
    drawing_number: String(r.drawing_number ?? ""),
    revision: String(r.revision ?? ""),
    qty: Number(r.qty) || 1,
    status: (String(r.status ?? "Pending Review") as TemporaryItemStatus) || "Pending Review",
    source_upload: String(r.source_upload ?? ""),
    department: String(r.department ?? ""),
    project: String(r.project ?? ""),
    program: String(r.program ?? ""),
    uploaded_by: String(r.uploaded_by ?? ""),
    erp_item: String(r.erp_item ?? ""),
    rejection_reason: String(r.rejection_reason ?? ""),
    modified: String(r.modified ?? ""),
  };
}

export async function approveTemporaryItem(name: string): Promise<TemporaryItemRecord> {
  const cfg = readErpAdminConfig();
  const doc = await erpFetch<{ data?: Record<string, unknown> }>(
    cfg,
    `resource/${encodeURIComponent(TEMP_DOCTYPE)}/${encodeURIComponent(name)}`,
  );
  const row = mapTempRow((doc as { data?: Record<string, unknown> }).data ?? (doc as Record<string, unknown>));
  if (row.status === "Approved" && row.erp_item) return row;

  const itemCode = String(row.proposed_item_code || slugItemCode({
    row_number: 0,
    item_code: "",
    item_name: row.item_name,
    description: row.description || "",
    qty: row.qty || 1,
    uom: row.default_uom || "Nos",
    required_date: "",
    commodity: row.commodity || "",
    category: row.item_group || "",
    manufacturer: row.manufacturer || "",
    manufacturer_part_number: "",
    drawing_number: row.drawing_number || "",
    revision: row.revision || "",
    remarks: "",
    status: "new",
    status_label: "New",
    exists_in_erp: false,
    errors: [],
  })).trim();

  let erpItem = itemCode;
  try {
    await erpFetch(cfg, `resource/Item/${encodeURIComponent(itemCode)}`);
  } catch {
    await erpFetch(cfg, "resource/Item", {
      method: "POST",
      body: {
        doctype: "Item",
        item_code: itemCode,
        item_name: row.item_name,
        item_group: row.item_group || "Raw Material",
        stock_uom: row.default_uom || "Nos",
        description: row.description || row.item_name,
        is_stock_item: 1,
        is_purchase_item: 1,
      },
    });
  }

  await erpFetch(cfg, `resource/${encodeURIComponent(TEMP_DOCTYPE)}/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: {
      status: "Approved",
      erp_item: erpItem,
      rejection_reason: "",
    },
  });

  return { ...row, status: "Approved", erp_item: erpItem };
}

export async function rejectTemporaryItem(
  name: string,
  reason?: string,
): Promise<TemporaryItemRecord> {
  const cfg = readErpAdminConfig();
  await erpFetch(cfg, `resource/${encodeURIComponent(TEMP_DOCTYPE)}/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: {
      status: "Rejected",
      rejection_reason: reason || "Rejected by Master Data",
    },
  });
  const rows = await listTemporaryItems(1);
  const found = rows.find((r) => r.name === name);
  return found ?? mapTempRow({ name, status: "Rejected" });
}
