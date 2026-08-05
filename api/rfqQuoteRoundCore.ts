/**
 * Enterprise RFQ Quote Rounds — privileged ERP writes.
 */
import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";
import {
  inviteSuppliersToRfqCore,
  type InviteSupplierInput,
} from "./rfqSupplierInviteCore.js";

const RFQ_DOCTYPE = "Request for Quotation";
const RFQ_ROUND_DOCTYPE = "RFQ Round";

function buildRfqRoundTrackingId(rfqName: string, roundNumber: number): string {
  const padded = String(Math.max(1, roundNumber)).padStart(2, "0");
  return `${rfqName.trim()}-R${padded}`;
}

export const RFQ_ROUND_REASON_CODES = [
  "Engineering Change",
  "New Parts Added",
  "Parts Removed",
  "Quantity Changed",
  "Drawing Revision",
  "Specification Changed",
  "Commercial Revision",
  "New Supplier Added",
  "Supplier Removed",
  "Price Negotiation",
  "Delivery Schedule Changed",
  "Initial RFQ",
  "Other",
] as const;

export type RfqRoundReasonCode = (typeof RFQ_ROUND_REASON_CODES)[number];
export type RfqRoundStatus = "Draft" | "Active" | "Closed" | "Cancelled";

export class RfqQuoteRoundError extends Error {
  status: number;
  code: "blocked" | "validation" | "not_found" | "erp" | "config";

  constructor(
    message: string,
    status = 400,
    code: RfqQuoteRoundError["code"] = "validation",
  ) {
    super(message);
    this.name = "RfqQuoteRoundError";
    this.status = status;
    this.code = code;
  }
}

export type ErpAdminConfig = { baseUrl: string; key: string; secret: string };

type RfqItemRow = Record<string, unknown>;
type RfqSupplierRow = Record<string, unknown>;

type RfqDoc = {
  name: string;
  docstatus?: number;
  status?: string;
  modified?: string;
  company?: string;
  transaction_date?: string;
  valid_till?: string;
  message_for_supplier?: string;
  terms?: string;
  custom_selected_supplier?: string;
  custom_active_rfq_round?: string;
  custom_current_round_number?: number;
  items?: RfqItemRow[];
  suppliers?: RfqSupplierRow[];
};

/**
 * Live ERP "RFQ Round" schema (discovered via DocType meta) uses:
 *   remark (not remarks), created_by / created_on, is_latest
 * Child item/supplier tables from setup-rfq-round-doctype.mjs may be absent
 * on older sites — create payloads must not require them.
 */
export type RfqRoundDoc = {
  name: string;
  rfq: string;
  round_number: number;
  tracking_id: string;
  previous_round?: string;
  reason_code: string;
  /** Normalized from ERP `remark` (or legacy `remarks`). */
  remarks: string;
  /** Raw ERP field when present. */
  remark?: string;
  status: RfqRoundStatus;
  created_by_user?: string;
  created_by?: string;
  created_on?: string;
  creation?: string;
  modified?: string;
  is_latest?: 0 | 1 | boolean;
  message_for_supplier?: string;
  terms?: string;
  valid_till?: string;
  items?: RfqItemRow[];
  suppliers?: RfqSupplierRow[];
  change_log?: Array<Record<string, unknown>>;
};

/**
 * Candidate list fields. Only fields present on DocType meta are requested.
 * Prefer `remark` / `created_by` (live ERP) over legacy `remarks` / `created_by_user`.
 */
const RFQ_ROUND_LIST_FIELD_CANDIDATES = [
  "name",
  "rfq",
  "round_number",
  "tracking_id",
  "previous_round",
  "reason_code",
  "remark",
  "remarks",
  "status",
  "created_by",
  "created_by_user",
  "created_on",
  "is_latest",
  "creation",
  "modified",
] as const;

/** Standard DocType columns always queryable. */
const STANDARD_META_FIELDS = new Set([
  "name",
  "owner",
  "creation",
  "modified",
  "modified_by",
  "docstatus",
  "idx",
]);

type RoundMetaCache = {
  fieldnames: Set<string>;
  fetchedAt: number;
};

let roundMetaCache: RoundMetaCache | null = null;

function extractForbiddenField(message: string): string | null {
  const match = /Field not permitted in query:\s*([A-Za-z0-9_]+)/i.exec(
    message,
  );
  return match?.[1] ?? null;
}

function logQuoteRoundFailure(
  context: string,
  details: Record<string, unknown>,
  err?: unknown,
) {
  const erpMessage =
    err != null ? extractErpErrorMessage(err, "") : "";
  // eslint-disable-next-line no-console
  console.error(`[RFQ Quote Round] ${context}`, {
    doctype: RFQ_ROUND_DOCTYPE,
    ...details,
    error: err instanceof Error ? err.message : String(err ?? ""),
    erpMessage: erpMessage || undefined,
    stack:
      err instanceof Error
        ? err.stack
        : details.stack ?? new Error().stack,
  });
}

function logQuoteRoundStep(
  step: string,
  details: Record<string, unknown> = {},
): void {
  // eslint-disable-next-line no-console
  console.info(`[RFQ Quote Round · ${step}]`, {
    doctype: RFQ_ROUND_DOCTYPE,
    ...details,
  });
}

function formatRoundLabel(roundNumber: number): string {
  return `R${String(Math.max(1, roundNumber)).padStart(2, "0")}`;
}

function extractErpErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof RfqQuoteRoundError) return err.message;
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (typeof err === "string" && err.trim()) return err.trim();

  const json = err as {
    exception?: string;
    message?: string | { message?: string };
    _server_messages?: string;
  };
  if (json?._server_messages) {
    try {
      const parsed = JSON.parse(json._server_messages) as string[];
      const first = parsed[0] ? JSON.parse(parsed[0]) : null;
      if (first?.message) return String(first.message);
    } catch {
      /* keep */
    }
  }
  if (typeof json?.exception === "string" && json.exception.trim()) {
    return json.exception.replace(/^[^:]+:\s*/, "").trim();
  }
  if (typeof json?.message === "string" && json.message.trim()) {
    return json.message.trim();
  }
  return fallback;
}

function isDuplicateRoundError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    /duplicate|unique|already exists|1062|tracking_id/i.test(lower) &&
    (/tracking_id|rfq round|round_number|round number/i.test(lower) ||
      /r\d{2}/i.test(lower))
  );
}

function isDatabaseError(message: string): boolean {
  return /pymysql|operationalerror|dataerror|1213|deadlock|sql/i.test(
    message.toLowerCase(),
  );
}

function mapStepFailure(
  step:
    | "validate"
    | "copy_items"
    | "copy_attachments"
    | "copy_terms"
    | "create_round"
    | "sync_rfq"
    | "invite_suppliers"
    | "send_emails",
  err: unknown,
  roundLabel?: string,
): RfqQuoteRoundError {
  if (err instanceof RfqQuoteRoundError) return err;

  const raw = extractErpErrorMessage(err, "Unexpected error.");
  logQuoteRoundFailure(`Step failed: ${step}`, { roundLabel, rawMessage: raw }, err);

  if (roundLabel && isDuplicateRoundError(raw)) {
    return new RfqQuoteRoundError(
      `Quote Round ${roundLabel} already exists.`,
      409,
      "validation",
    );
  }

  if (isDatabaseError(raw)) {
    // eslint-disable-next-line no-console
    console.error("[RFQ Quote Round] database error detail", {
      step,
      roundLabel,
      sqlHint: raw,
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (roundLabel && /duplicate|unique|1062/i.test(raw.toLowerCase())) {
      return new RfqQuoteRoundError(
        `Quote Round ${roundLabel} already exists.`,
        409,
        "validation",
      );
    }
  }

  const friendly: Record<typeof step, string> = {
    validate: raw,
    copy_items: "Failed to copy RFQ items.",
    copy_attachments: "Failed to copy RFQ attachments.",
    copy_terms: "Failed to copy terms and conditions.",
    create_round: "Failed to create quote round.",
    sync_rfq: "Failed to link the new quote round to the RFQ.",
    invite_suppliers: "Failed to send invitations.",
    send_emails: "Failed to send invitations.",
  };

  if (/already invited|already been invited|duplicate entry.*supplier/i.test(raw)) {
    return new RfqQuoteRoundError(
      "Supplier already invited in this round.",
      409,
      "validation",
    );
  }

  return new RfqQuoteRoundError(friendly[step], 502, "erp");
}

function assertRoundNumberAvailable(
  rounds: RfqRoundDoc[],
  rfqName: string,
  nextNumber: number,
): void {
  const label = formatRoundLabel(nextNumber);
  const trackingId = buildRfqRoundTrackingId(rfqName, nextNumber);
  const duplicate = rounds.find(
    (r) =>
      r.round_number === nextNumber ||
      String(r.tracking_id ?? "").trim() === trackingId,
  );
  if (duplicate) {
    throw new RfqQuoteRoundError(
      `Quote Round ${label} already exists.`,
      409,
      "validation",
    );
  }
}

async function validateSuppliersExist(
  cfg: ErpAdminConfig,
  suppliers: string[],
): Promise<void> {
  for (const supplier of suppliers) {
    const id = supplier.trim();
    if (!id) continue;
    try {
      await erpFetch<{ name?: string }>(
        cfg,
        "GET",
        `/api/resource/Supplier/${encodeURIComponent(id)}`,
      );
    } catch (err) {
      logQuoteRoundFailure("Supplier validation failed", { supplier: id }, err);
      throw new RfqQuoteRoundError(
        `Supplier "${id}" is not valid or could not be found.`,
        400,
        "validation",
      );
    }
  }
}

async function deleteRoundDoc(
  cfg: ErpAdminConfig,
  roundName: string,
): Promise<void> {
  try {
    await erpFetch(
      cfg,
      "DELETE",
      `/api/resource/${encodeURIComponent(RFQ_ROUND_DOCTYPE)}/${encodeURIComponent(roundName)}`,
    );
    logQuoteRoundStep("Rollback — deleted round document", { roundName });
  } catch (err) {
    logQuoteRoundFailure("Rollback failed — could not delete round document", {
      roundName,
    }, err);
  }
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
    throw new RfqQuoteRoundError(
      "RFQ quote round backend misconfigured: missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET.",
      500,
      "config",
    );
  }
  return { baseUrl, key, secret };
}

async function erpFetch<T>(
  cfg: ErpAdminConfig,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const url = `${cfg.baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `token ${cfg.key}:${cfg.secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(sanitizeErpPayloadDates(body)) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    exception?: string;
    _server_messages?: string;
    message?: string;
  };
  if (!res.ok) {
    const msg = extractErpErrorMessage(json, `${method} ${path} failed (${res.status})`);
    logQuoteRoundFailure("ERP request failed", {
      method,
      path,
      status: res.status,
      queryFields: typeof path === "string" && path.includes("fields=")
        ? path
        : undefined,
      bodyKeys: body ? Object.keys(body) : [],
      bodyFields: body ? Object.keys(body) : [],
      message: String(msg),
      serverMessages: json._server_messages,
    });
    throw new RfqQuoteRoundError(String(msg), res.status >= 500 ? 502 : 400, "erp");
  }
  return (json.data ?? json) as T;
}

async function getRoundMetaFieldnames(cfg: ErpAdminConfig): Promise<Set<string>> {
  if (roundMetaCache && Date.now() - roundMetaCache.fetchedAt < 5 * 60_000) {
    return roundMetaCache.fieldnames;
  }
  try {
    const meta = await erpFetch<{ fields?: Array<{ fieldname?: string }> }>(
      cfg,
      "GET",
      `/api/resource/DocType/${encodeURIComponent(RFQ_ROUND_DOCTYPE)}`,
    );
    const fieldnames = new Set<string>(STANDARD_META_FIELDS);
    for (const f of meta.fields ?? []) {
      if (f.fieldname) fieldnames.add(f.fieldname);
    }
    roundMetaCache = { fieldnames, fetchedAt: Date.now() };
    return fieldnames;
  } catch (err) {
    logQuoteRoundFailure("Failed to load RFQ Round DocType meta — using candidates", {
      candidates: [...RFQ_ROUND_LIST_FIELD_CANDIDATES],
    }, err);
    // Prefer live-site field names when meta cannot be loaded.
    return new Set([
      ...STANDARD_META_FIELDS,
      "rfq",
      "round_number",
      "tracking_id",
      "previous_round",
      "reason_code",
      "remark",
      "status",
      "created_by",
      "created_on",
      "is_latest",
    ]);
  }
}

async function resolveRoundListFields(cfg: ErpAdminConfig): Promise<string[]> {
  const meta = await getRoundMetaFieldnames(cfg);
  const fields = RFQ_ROUND_LIST_FIELD_CANDIDATES.filter((f) => meta.has(f));
  // Avoid requesting both remark and remarks when both somehow exist — prefer singular.
  if (fields.includes("remark") && fields.includes("remarks")) {
    return fields.filter((f) => f !== "remarks");
  }
  if (fields.includes("created_by") && fields.includes("created_by_user")) {
    return fields.filter((f) => f !== "created_by_user");
  }
  return fields.length > 0
    ? fields
    : ["name", "rfq", "round_number", "tracking_id", "status", "creation", "modified"];
}

function pickWriteField(
  meta: Set<string>,
  preferred: string,
  legacy: string,
): string | null {
  if (meta.has(preferred)) return preferred;
  if (meta.has(legacy)) return legacy;
  return null;
}

function normalizeRoundDoc(row: Record<string, unknown>): RfqRoundDoc {
  const remark = String(row.remark ?? row.remarks ?? "").trim();
  const createdBy = String(
    row.created_by_user ?? row.created_by ?? "",
  ).trim();
  return {
    name: String(row.name ?? ""),
    rfq: String(row.rfq ?? ""),
    round_number: Number(row.round_number) || 0,
    tracking_id: String(row.tracking_id ?? ""),
    previous_round: String(row.previous_round ?? "") || undefined,
    reason_code: String(row.reason_code ?? ""),
    remarks: remark,
    remark,
    status: (String(row.status ?? "Draft") as RfqRoundStatus) || "Draft",
    created_by_user: createdBy || undefined,
    created_by: String(row.created_by ?? "") || undefined,
    created_on: String(row.created_on ?? "") || undefined,
    creation: String(row.creation ?? row.created_on ?? "") || undefined,
    modified: String(row.modified ?? "") || undefined,
    is_latest: row.is_latest as 0 | 1 | boolean | undefined,
    message_for_supplier: String(row.message_for_supplier ?? "") || undefined,
    terms: String(row.terms ?? "") || undefined,
    valid_till: String(row.valid_till ?? "") || undefined,
    items: Array.isArray(row.items) ? (row.items as RfqItemRow[]) : undefined,
    suppliers: Array.isArray(row.suppliers)
      ? (row.suppliers as RfqSupplierRow[])
      : undefined,
    change_log: Array.isArray(row.change_log)
      ? (row.change_log as Array<Record<string, unknown>>)
      : undefined,
  };
}

export function stripChildNames(rows: RfqItemRow[] | RfqSupplierRow[] | undefined) {
  return (rows ?? []).map((row) => {
    const copy = { ...row };
    delete copy.name;
    delete copy.idx;
    delete copy.parent;
    delete copy.parentfield;
    delete copy.parenttype;
    delete copy.doctype;
    return copy;
  });
}

function mapRfqItemsToRoundItems(items: RfqItemRow[]): RfqItemRow[] {
  return items.map((it) => ({
    doctype: "RFQ Round Item",
    item_code: it.item_code,
    item_name: it.item_name,
    description: it.description,
    qty: it.qty,
    uom: it.uom,
    schedule_date: it.schedule_date,
    warehouse: it.warehouse,
    custom_part_name: it.custom_part_name,
    custom_2d_drawing: it.custom_2d_drawing,
    custom_engineering_attachments: it.custom_engineering_attachments,
    custom_target_price: it.custom_target_price,
    custom_procurement_final_qty: it.custom_procurement_final_qty,
    custom_qty_change_reason: it.custom_qty_change_reason,
    source_rfq_item: it.name,
  }));
}

function mapRfqSuppliersToRoundSuppliers(suppliers: RfqSupplierRow[]): RfqSupplierRow[] {
  return suppliers.map((s) => ({
    doctype: "RFQ Round Supplier",
    supplier: s.supplier,
    supplier_name: s.supplier_name,
    email_id: s.email_id,
    contact: s.contact,
    send_email: s.send_email ?? 1,
    quote_status: "Pending",
    source_rfq_supplier: s.name,
  }));
}

function mapRoundItemsToRfqItems(items: RfqItemRow[]): RfqItemRow[] {
  return items.map((it) => ({
    doctype: "Request for Quotation Item",
    item_code: it.item_code,
    item_name: it.item_name,
    description: it.description,
    qty: it.qty,
    uom: it.uom ?? "Nos",
    schedule_date: it.schedule_date,
    warehouse: it.warehouse,
    custom_part_name: it.custom_part_name,
    custom_2d_drawing: it.custom_2d_drawing,
    custom_engineering_attachments: it.custom_engineering_attachments,
    custom_target_price: it.custom_target_price,
    custom_procurement_final_qty: it.custom_procurement_final_qty,
    custom_qty_change_reason: it.custom_qty_change_reason,
  }));
}

function mapRoundSuppliersToRfqSuppliers(suppliers: RfqSupplierRow[]): RfqSupplierRow[] {
  return suppliers.map((s) => ({
    doctype: "Request for Quotation Supplier",
    supplier: s.supplier,
    supplier_name: s.supplier_name,
    email_id: s.email_id,
    contact: s.contact,
    send_email: s.send_email ?? 1,
    quote_status: "Pending",
  }));
}

function assertNotAwarded(rfq: RfqDoc) {
  if (rfq.custom_selected_supplier?.trim()) {
    throw new RfqQuoteRoundError(
      "Cannot create a new quote round after a supplier has been awarded.",
      403,
      "blocked",
    );
  }
  const status = (rfq.status ?? "").trim().toLowerCase();
  if (status === "cancelled" || rfq.docstatus === 2) {
    throw new RfqQuoteRoundError("This RFQ is cancelled.", 403, "blocked");
  }
}

function validateReason(reasonCode: string, remarks: string) {
  if (!RFQ_ROUND_REASON_CODES.includes(reasonCode as RfqRoundReasonCode)) {
    throw new RfqQuoteRoundError("Invalid reason code.", 400, "validation");
  }
  if (!remarks.trim()) {
    throw new RfqQuoteRoundError("Remarks are required to create a new round.", 400, "validation");
  }
}

async function getRfq(cfg: ErpAdminConfig, rfqName: string): Promise<RfqDoc> {
  try {
    const doc = await erpFetch<RfqDoc>(
      cfg,
      "GET",
      `/api/resource/${encodeURIComponent(RFQ_DOCTYPE)}/${encodeURIComponent(rfqName)}`,
    );
    if (!doc?.name) {
      throw new RfqQuoteRoundError(
        `RFQ "${rfqName}" was not found.`,
        404,
        "not_found",
      );
    }
    return doc;
  } catch (err) {
    if (err instanceof RfqQuoteRoundError) throw err;
    const raw = extractErpErrorMessage(err, "");
    if (/not found|does not exist|404/i.test(raw)) {
      throw new RfqQuoteRoundError(
        `RFQ "${rfqName}" was not found.`,
        404,
        "not_found",
      );
    }
    throw err;
  }
}

async function putRfq(
  cfg: ErpAdminConfig,
  rfqName: string,
  data: Record<string, unknown>,
): Promise<RfqDoc> {
  return erpFetch<RfqDoc>(
    cfg,
    "PUT",
    `/api/resource/${encodeURIComponent(RFQ_DOCTYPE)}/${encodeURIComponent(rfqName)}`,
    data,
  );
}

export async function listRfqRoundsCore(rfqName: string): Promise<RfqRoundDoc[]> {
  const cfg = readErpAdminConfig();
  let fields = await resolveRoundListFields(cfg);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      // eslint-disable-next-line no-console
      console.info("[RFQ Quote Round] listRfqRounds query", {
        doctype: RFQ_ROUND_DOCTYPE,
        rfqName,
        queryFields: fields,
        attempt,
      });
      const rows = await erpFetch<Array<Record<string, unknown>>>(
        cfg,
        "GET",
        `/api/resource/${encodeURIComponent(RFQ_ROUND_DOCTYPE)}?${new URLSearchParams({
          fields: JSON.stringify(fields),
          filters: JSON.stringify([["rfq", "=", rfqName]]),
          order_by: "round_number asc",
          limit_page_length: "100",
        }).toString()}`,
      );
      const list = Array.isArray(rows) ? rows : [];
      return list.map((row) => normalizeRoundDoc(row));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const forbidden = extractForbiddenField(message);
      if (forbidden && fields.includes(forbidden)) {
        logQuoteRoundFailure("listRfqRounds field rejected — retrying without it", {
          rfqName,
          queryFields: fields,
          removedField: forbidden,
        }, err);
        fields = fields.filter((f) => f !== forbidden);
        continue;
      }
      logQuoteRoundFailure("listRfqRounds failed", {
        rfqName,
        queryFields: fields,
      }, err);
      throw err;
    }
  }
  throw new RfqQuoteRoundError(
    "Unable to list RFQ rounds after field retries.",
    502,
    "erp",
  );
}

export async function getRfqRoundCore(name: string): Promise<RfqRoundDoc> {
  const cfg = readErpAdminConfig();
  const row = await erpFetch<Record<string, unknown>>(
    cfg,
    "GET",
    `/api/resource/${encodeURIComponent(RFQ_ROUND_DOCTYPE)}/${encodeURIComponent(name)}`,
  );
  return normalizeRoundDoc(row);
}

async function createRoundDoc(
  cfg: ErpAdminConfig,
  payload: Record<string, unknown>,
): Promise<RfqRoundDoc> {
  const row = await erpFetch<Record<string, unknown>>(
    cfg,
    "POST",
    `/api/resource/${encodeURIComponent(RFQ_ROUND_DOCTYPE)}`,
    payload,
  );
  return normalizeRoundDoc(row);
}

async function updateRoundDoc(
  cfg: ErpAdminConfig,
  name: string,
  payload: Record<string, unknown>,
): Promise<RfqRoundDoc> {
  const row = await erpFetch<Record<string, unknown>>(
    cfg,
    "PUT",
    `/api/resource/${encodeURIComponent(RFQ_ROUND_DOCTYPE)}/${encodeURIComponent(name)}`,
    payload,
  );
  return normalizeRoundDoc(row);
}

async function buildRoundSnapshotFromRfq(
  cfg: ErpAdminConfig,
  rfq: RfqDoc,
  roundNumber: number,
  opts: {
    reasonCode: string;
    remarks: string;
    createdBy: string;
    previousRound?: string;
    status: RfqRoundStatus;
    /** When set, only these suppliers are stored on the round (not the full RFQ list). */
    associateSuppliersOnly?: RfqSupplierRow[];
  },
): Promise<Record<string, unknown>> {
  const meta = await getRoundMetaFieldnames(cfg);
  const trackingId = buildRfqRoundTrackingId(rfq.name, roundNumber);
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const remarkField = pickWriteField(meta, "remark", "remarks");
  const createdByField = pickWriteField(meta, "created_by", "created_by_user");

  const payload: Record<string, unknown> = {
    doctype: RFQ_ROUND_DOCTYPE,
  };

  const core: Record<string, unknown> = {
    rfq: rfq.name,
    round_number: roundNumber,
    tracking_id: trackingId,
    previous_round: opts.previousRound ?? "",
    reason_code: opts.reasonCode,
    status: opts.status,
  };
  for (const [key, value] of Object.entries(core)) {
    if (meta.has(key) || key === "rfq" || key === "round_number" || key === "tracking_id") {
      payload[key] = value;
    }
  }

  if (remarkField) payload[remarkField] = opts.remarks.trim();
  // `created_by` is Link → User on live ERP; only set when value looks like a User id.
  if (createdByField) {
    const createdBy = opts.createdBy.trim();
    const looksLikeUser =
      createdBy.includes("@") ||
      createdBy === "Administrator" ||
      createdByField === "created_by_user";
    if (looksLikeUser) payload[createdByField] = createdBy;
  }
  if (meta.has("created_on")) payload.created_on = now;
  if (meta.has("is_latest")) payload.is_latest = 1;
  if (meta.has("copied_form") && opts.previousRound) {
    payload.copied_form = opts.previousRound;
  }

  // Live DocType status options are Draft / Active / Closed (no Cancelled).
  if (payload.status === "Cancelled") payload.status = "Closed";

  // Optional commercial / snapshot fields — only when present on DocType.
  if (meta.has("message_for_supplier")) {
    payload.message_for_supplier = rfq.message_for_supplier ?? "";
  }
  if (meta.has("terms")) payload.terms = rfq.terms ?? "";
  if (meta.has("valid_till")) payload.valid_till = rfq.valid_till ?? "";

  if (meta.has("items")) {
    payload.items = mapRfqItemsToRoundItems(rfq.items ?? []);
  }
  if (meta.has("suppliers")) {
    if (opts.associateSuppliersOnly) {
      payload.suppliers = mapRfqSuppliersToRoundSuppliers(
        opts.associateSuppliersOnly,
      );
    } else if (opts.reasonCode !== "New Supplier Added") {
      payload.suppliers = mapRfqSuppliersToRoundSuppliers(rfq.suppliers ?? []);
    } else {
      payload.suppliers = [];
    }
  }
  if (meta.has("change_log")) {
    const supplierNote =
      opts.associateSuppliersOnly && opts.associateSuppliersOnly.length > 0
        ? ` Newly added suppliers: ${opts.associateSuppliersOnly.length}.`
        : "";
    payload.change_log = [
      {
        doctype: "RFQ Round Change Log",
        change_type: roundNumber === 1 ? "Initial Round" : "New Round Created",
        reason_code: opts.reasonCode,
        remarks: `${opts.remarks.trim()}${supplierNote}`,
        changed_by: opts.createdBy,
        changed_on: now,
      },
    ];
  }

  // eslint-disable-next-line no-console
  console.info("[RFQ Quote Round] create payload fields", {
    doctype: RFQ_ROUND_DOCTYPE,
    rfq: rfq.name,
    roundNumber,
    queryFields: Object.keys(payload),
  });

  return payload;
}

/**
 * Point the RFQ at the active round. Do not overwrite RFQ items/suppliers from
 * a round snapshot that may lack child tables on older DocType installs.
 */
async function syncRfqToRound(
  cfg: ErpAdminConfig,
  rfq: RfqDoc,
  round: RfqRoundDoc,
): Promise<RfqDoc> {
  const payload: Record<string, unknown> = {
    modified: rfq.modified,
    custom_active_rfq_round: round.name,
    custom_current_round_number: round.round_number,
  };
  // Only restore commercial fields from round when the round actually carries them.
  if (round.message_for_supplier != null && String(round.message_for_supplier).length) {
    payload.message_for_supplier = round.message_for_supplier;
  }
  if (round.terms != null && String(round.terms).length) {
    payload.terms = round.terms;
  }
  if (round.valid_till) payload.valid_till = round.valid_till;
  if (Array.isArray(round.items) && round.items.length > 0) {
    payload.items = mapRoundItemsToRfqItems(round.items);
  }
  if (Array.isArray(round.suppliers) && round.suppliers.length > 0) {
    payload.suppliers = mapRoundSuppliersToRfqSuppliers(round.suppliers);
  }
  return putRfq(cfg, rfq.name, payload);
}

export async function ensureInitialRfqRoundCore(input: {
  rfqName: string;
  createdBy?: string;
}): Promise<{ round: RfqRoundDoc; created: boolean }> {
  const cfg = readErpAdminConfig();
  const rfqName = input.rfqName.trim();
  if (!rfqName) throw new RfqQuoteRoundError("RFQ name is required.", 400);

  const existing = await listRfqRoundsCore(rfqName);
  if (existing.length > 0) {
    const active =
      existing.find((r) => r.status === "Active") ??
      existing[existing.length - 1];
    return { round: active, created: false };
  }

  const rfq = await getRfq(cfg, rfqName);
  const status: RfqRoundStatus =
    rfq.docstatus === 1 ? "Active" : "Draft";
  const createdBy = input.createdBy?.trim() || "Procurement";

  const createPayload = await buildRoundSnapshotFromRfq(cfg, rfq, 1, {
    reasonCode: "Initial RFQ",
    remarks: "Initial RFQ round.",
    createdBy,
    status,
  });

  let round: RfqRoundDoc;
  try {
    round = await createRoundDoc(cfg, createPayload);
  } catch (err) {
    const slim = { ...createPayload };
    delete slim.created_by;
    delete slim.created_by_user;
    delete slim.items;
    delete slim.suppliers;
    delete slim.change_log;
    delete slim.message_for_supplier;
    delete slim.terms;
    delete slim.valid_till;
    logQuoteRoundFailure(
      "ensureInitial round create failed — retrying slim payload",
      {
        queryFields: Object.keys(slim),
        previousFields: Object.keys(createPayload),
      },
      err,
    );
    round = await createRoundDoc(cfg, slim);
  }

  await putRfq(cfg, rfq.name, {
    modified: rfq.modified,
    custom_active_rfq_round: round.name,
    custom_current_round_number: 1,
  });

  return { round, created: true };
}

export type CreateNextRfqRoundResult = {
  round: RfqRoundDoc;
  previousRound?: RfqRoundDoc;
  invited?: InviteSupplierInput[];
  inviteWarning?: string;
  emailWarning?: string;
};

export async function createNextRfqRoundCore(input: {
  rfqName: string;
  reasonCode: string;
  remarks: string;
  createdBy: string;
  /** Suppliers stored on the new round document snapshot. */
  associateSuppliers?: InviteSupplierInput[];
  /** Suppliers to append on the RFQ and email after the round is created. */
  inviteSuppliers?: InviteSupplierInput[];
}): Promise<CreateNextRfqRoundResult> {
  const cfg = readErpAdminConfig();
  const rfqName = input.rfqName.trim();
  validateReason(input.reasonCode, input.remarks);
  if (!rfqName) throw new RfqQuoteRoundError("RFQ name is required.", 400);

  logQuoteRoundStep("Validate RFQ", { rfqName });
  let rfq: RfqDoc;
  try {
    rfq = await getRfq(cfg, rfqName);
    assertNotAwarded(rfq);
  } catch (err) {
    throw mapStepFailure("validate", err);
  }

  const inviteList = (input.inviteSuppliers ?? []).filter((s) =>
    String(s.supplier ?? "").trim(),
  );
  const associateList = (input.associateSuppliers ?? []).filter((s) =>
    String(s.supplier ?? "").trim(),
  );
  const suppliersToValidate = [
    ...new Set([
      ...inviteList.map((s) => s.supplier.trim()),
      ...associateList.map((s) => s.supplier.trim()),
    ]),
  ];
  if (suppliersToValidate.length > 0) {
    logQuoteRoundStep("Validate suppliers", {
      rfqName,
      count: suppliersToValidate.length,
    });
    await validateSuppliersExist(cfg, suppliersToValidate);
  }

  logQuoteRoundStep("List existing rounds", { rfqName });
  let rounds = await listRfqRoundsCore(rfqName);
  if (rounds.length === 0) {
    await ensureInitialRfqRoundCore({
      rfqName,
      createdBy: input.createdBy,
    });
    rounds = await listRfqRoundsCore(rfqName);
  }

  const latest = rounds[rounds.length - 1];
  const nextNumber = (latest?.round_number ?? 0) + 1;
  const roundLabel = formatRoundLabel(nextNumber);

  logQuoteRoundStep("Validate round number", {
    rfqName,
    nextNumber,
    roundLabel,
    trackingId: buildRfqRoundTrackingId(rfqName, nextNumber),
  });
  assertRoundNumberAvailable(rounds, rfqName, nextNumber);

  if (latest) {
    logQuoteRoundStep("Close previous round", {
      rfqName,
      previousRound: latest.name,
      previousNumber: latest.round_number,
    });
    const meta = await getRoundMetaFieldnames(cfg);
    const closePayload: Record<string, unknown> = { status: "Closed" };
    if (meta.has("is_latest")) closePayload.is_latest = 0;
    try {
      if (latest.status === "Active" || latest.status === "Draft") {
        await updateRoundDoc(cfg, latest.name, closePayload);
      } else if (meta.has("is_latest")) {
        await updateRoundDoc(cfg, latest.name, { is_latest: 0 });
      }
    } catch (err) {
      throw mapStepFailure("create_round", err, roundLabel);
    }
  }

  const freshRfq = await getRfq(cfg, rfqName);
  const newStatus: RfqRoundStatus =
    freshRfq.docstatus === 1 ? "Active" : "Draft";

  const associateOnly =
    associateList.length > 0
      ? associateList.map((s) => ({
          supplier: s.supplier,
          supplier_name: s.supplier_name || s.supplier,
          email_id: s.email_id,
        }))
      : input.reasonCode === "New Supplier Added"
        ? []
        : undefined;

  const rfqItems = freshRfq.items ?? [];
  const attachmentCount = rfqItems.filter(
    (it) =>
      String(it.custom_2d_drawing ?? "").trim() ||
      String(it.custom_engineering_attachments ?? "").trim(),
  ).length;

  logQuoteRoundStep("Copy RFQ Items", {
    rfqName,
    roundLabel,
    itemCount: rfqItems.length,
  });

  logQuoteRoundStep("Copy Attachments", {
    rfqName,
    roundLabel,
    itemsWithAttachments: attachmentCount,
  });

  logQuoteRoundStep("Copy Terms & Conditions", {
    rfqName,
    roundLabel,
    hasTerms: Boolean(String(freshRfq.terms ?? "").trim()),
    hasMessage: Boolean(String(freshRfq.message_for_supplier ?? "").trim()),
  });

  let createPayload = await buildRoundSnapshotFromRfq(
    cfg,
    freshRfq,
    nextNumber,
    {
      reasonCode: input.reasonCode,
      remarks: input.remarks.trim(),
      createdBy: input.createdBy.trim() || "Procurement",
      previousRound: latest?.name,
      status: newStatus,
      associateSuppliersOnly: associateOnly,
    },
  );

  logQuoteRoundStep("Create Quote Round", {
    rfqName,
    roundLabel,
    payloadFields: Object.keys(createPayload),
  });

  let round: RfqRoundDoc;
  let itemsCopied = Array.isArray(createPayload.items) && createPayload.items.length > 0;
  try {
    round = await createRoundDoc(cfg, createPayload);
  } catch (err) {
    const raw = extractErpErrorMessage(err, "");
    if (roundLabel && isDuplicateRoundError(raw)) {
      throw mapStepFailure("create_round", err, roundLabel);
    }

    const slim = { ...createPayload };
    delete slim.created_by;
    delete slim.created_by_user;
    delete slim.items;
    delete slim.suppliers;
    delete slim.change_log;
    delete slim.message_for_supplier;
    delete slim.terms;
    delete slim.valid_till;

    logQuoteRoundFailure(
      "Create Quote Round — retrying without child tables / optional fields",
      {
        rfqName,
        roundLabel,
        slimFields: Object.keys(slim),
        fullFields: Object.keys(createPayload),
      },
      err,
    );

    if (Object.keys(slim).length >= 5) {
      try {
        createPayload = slim;
        itemsCopied = false;
        round = await createRoundDoc(cfg, createPayload);
      } catch (retryErr) {
        throw mapStepFailure("create_round", retryErr, roundLabel);
      }
    } else {
      throw mapStepFailure("create_round", err, roundLabel);
    }
  }

  if (!itemsCopied && rfqItems.length > 0) {
    logQuoteRoundFailure(
      "Copy RFQ Items — round created without item rows (DocType may lack child table)",
      { rfqName, roundLabel, itemCount: rfqItems.length },
    );
  }

  logQuoteRoundStep("Link RFQ to new round", {
    rfqName,
    roundName: round.name,
    roundLabel,
  });

  try {
    await syncRfqToRound(cfg, freshRfq, round);
  } catch (err) {
    await deleteRoundDoc(cfg, round.name);
    throw mapStepFailure("sync_rfq", err, roundLabel);
  }

  const result: CreateNextRfqRoundResult = {
    round: {
      ...round,
      status: newStatus,
    },
    previousRound: latest,
  };

  if (inviteList.length === 0) {
    return result;
  }

  logQuoteRoundStep("Create Supplier Invitations", {
    rfqName,
    roundLabel,
    supplierCount: inviteList.length,
  });

  try {
    const inviteResult = await inviteSuppliersToRfqCore({
      rfqName,
      suppliers: inviteList,
    });
    result.invited = inviteResult.invited;
    if (inviteResult.emailWarning) {
      result.emailWarning = inviteResult.emailWarning;
    }
    logQuoteRoundStep("Send Emails", {
      rfqName,
      roundLabel,
      invitedCount: inviteResult.invited.length,
      rfqSubmitted: inviteResult.rfq.docstatus === 1,
      emailWarning: inviteResult.emailWarning,
    });
  } catch (err) {
    const inviteErr = mapStepFailure("invite_suppliers", err, roundLabel);
    result.inviteWarning = inviteErr.message;
    logQuoteRoundFailure(
      "Create Supplier Invitations — round kept; invitations failed",
      { rfqName, roundName: round.name, roundLabel },
      err,
    );
  }

  return result;
}

export async function getActiveRfqRoundCore(
  rfqName: string,
): Promise<RfqRoundDoc | null> {
  const rounds = await listRfqRoundsCore(rfqName);
  if (!rounds.length) return null;
  return (
    rounds.find((r) => r.status === "Active") ??
    rounds.find((r) => r.status === "Draft") ??
    rounds[rounds.length - 1]
  );
}

export async function activateRfqRoundCore(input: {
  roundName: string;
  createdBy?: string;
}): Promise<RfqRoundDoc> {
  const cfg = readErpAdminConfig();
  const round = await getRfqRoundCore(input.roundName);
  const rfq = await getRfq(cfg, round.rfq);
  assertNotAwarded(rfq);

  const rounds = await listRfqRoundsCore(round.rfq);
  for (const r of rounds) {
    if (r.name !== round.name && r.status === "Active") {
      await updateRoundDoc(cfg, r.name, { status: "Closed" });
    }
  }

  const activated = await updateRoundDoc(cfg, round.name, { status: "Active" });
  await syncRfqToRound(cfg, rfq, activated);
  return activated;
}
