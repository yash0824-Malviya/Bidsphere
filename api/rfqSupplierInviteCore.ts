/**
 * RFQ supplier invitation — privileged ERP writes via Frappe REST APIs.
 *
 * Uses the admin API key (never exposed to the browser) to append suppliers
 * on submitted RFQs, send invitation emails, and create portal users — without
 * ERPNext Server Scripts.
 */
import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";

const RFQ_DOCTYPE = "Request for Quotation";
const RFQ_SUPPLIER_DOCTYPE = "Request for Quotation Supplier";
const SEND_RFQ_EMAILS_METHOD =
  "erpnext.buying.doctype.request_for_quotation.request_for_quotation.send_supplier_emails";

export class RfqSupplierInviteError extends Error {
  status: number;
  code:
    | "blocked"
    | "duplicate"
    | "validation"
    | "permission"
    | "erp"
    | "config";

  constructor(
    message: string,
    status = 400,
    code: RfqSupplierInviteError["code"] = "validation",
  ) {
    super(message);
    this.name = "RfqSupplierInviteError";
    this.status = status;
    this.code = code;
  }
}

export type ErpAdminConfig = { baseUrl: string; key: string; secret: string };

export type InviteSupplierInput = {
  supplier: string;
  supplier_name?: string;
  email_id?: string;
};

type RfqSupplierRow = {
  name?: string;
  idx?: number;
  supplier?: string;
  supplier_name?: string;
  email_id?: string;
  send_email?: number;
  email_sent?: number;
  quote_status?: string;
  doctype?: string;
};

type RfqDoc = {
  name: string;
  docstatus?: number;
  status?: string;
  modified?: string;
  custom_selected_supplier?: string;
  suppliers?: RfqSupplierRow[];
};

let suppliersAllowOnSubmitEnsured = false;

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
    throw new RfqSupplierInviteError(
      "RFQ supplier invite backend misconfigured: missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET.",
      500,
      "config",
    );
  }
  return { baseUrl, key, secret };
}

function normSupplier(id: string): string {
  return id.trim().toLowerCase();
}

function extractErpErrorMessage(json: unknown, fallback: string): string {
  const data = (json ?? {}) as {
    exception?: string;
    exc_type?: string;
    message?: string | { message?: string };
    _server_messages?: string;
  };
  if (data._server_messages) {
    try {
      const parsed = JSON.parse(data._server_messages) as string[];
      const first = parsed[0] ? JSON.parse(parsed[0]) : null;
      if (first?.message) return String(first.message);
    } catch {
      /* keep */
    }
  }
  if (typeof data.exception === "string" && data.exception.trim()) {
    return data.exception.replace(/^[^:]+:\s*/, "").trim();
  }
  if (typeof data.message === "string" && data.message.trim()) {
    return data.message.trim();
  }
  if (
    data.message &&
    typeof data.message === "object" &&
    typeof data.message.message === "string"
  ) {
    return data.message.message.trim();
  }
  if (typeof data.exc_type === "string" && data.exc_type.trim()) {
    return data.exc_type;
  }
  return fallback;
}

async function erpFetch<T = unknown>(
  cfg: ErpAdminConfig,
  path: string,
  init?: { method?: string; body?: unknown; search?: Record<string, string> },
): Promise<{ status: number; data: T; raw: unknown }> {
  const qs = init?.search
    ? `?${new URLSearchParams(init.search).toString()}`
    : "";
  const method = init?.method ?? "GET";
  const url = `${cfg.baseUrl}/api/${path}${qs}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `token ${cfg.key}:${cfg.secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body:
      init?.body !== undefined
        ? JSON.stringify(sanitizeErpPayloadDates(init.body))
        : undefined,
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const friendly = extractErpErrorMessage(
      json,
      text || `ERPNext request failed (${res.status})`,
    );
    throw new RfqSupplierInviteError(friendly, res.status || 502, "erp");
  }

  const wrapped = json as { data?: T; message?: T };
  const data =
    wrapped?.data !== undefined
      ? wrapped.data
      : wrapped?.message !== undefined
        ? wrapped.message
        : (json as T);

  return { status: res.status, data, raw: json };
}

async function loadRfq(cfg: ErpAdminConfig, rfqName: string): Promise<RfqDoc> {
  const { data } = await erpFetch<RfqDoc>(
    cfg,
    `resource/${encodeURIComponent(RFQ_DOCTYPE)}/${encodeURIComponent(rfqName)}`,
  );
  if (!data?.name) {
    throw new RfqSupplierInviteError(
      `RFQ ${rfqName} was not found.`,
      404,
      "validation",
    );
  }
  return data;
}

async function rfqHasLinkedPurchaseOrder(
  cfg: ErpAdminConfig,
  rfqName: string,
): Promise<boolean> {
  const { data: sqRows } = await erpFetch<Array<{ name?: string }>>(
    cfg,
    "resource/Supplier%20Quotation",
    {
      search: {
        fields: JSON.stringify(["name"]),
        filters: JSON.stringify([["items.request_for_quotation", "=", rfqName]]),
        limit_page_length: "100",
      },
    },
  );
  const sqNames = (sqRows ?? [])
    .map((r) => String(r.name ?? "").trim())
    .filter(Boolean);
  if (sqNames.length === 0) return false;

  const { data: poRows } = await erpFetch<Array<{ name?: string }>>(
    cfg,
    "resource/Purchase%20Order",
    {
      search: {
        fields: JSON.stringify(["name"]),
        filters: JSON.stringify([
          ["Purchase Order Item", "supplier_quotation", "in", sqNames],
        ]),
        limit_page_length: "1",
      },
    },
  );
  return (poRows ?? []).length > 0;
}

function assertRfqOpenForInvite(rfq: RfqDoc, poExists: boolean): void {
  if (rfq.docstatus === 2) {
    throw new RfqSupplierInviteError(
      "This RFQ has been cancelled. Additional suppliers cannot be invited.",
      409,
      "blocked",
    );
  }

  const status = (rfq.status ?? "").trim().toLowerCase();
  if (status === "cancelled") {
    throw new RfqSupplierInviteError(
      "This RFQ has been cancelled. Additional suppliers cannot be invited.",
      409,
      "blocked",
    );
  }
  if (status === "closed") {
    throw new RfqSupplierInviteError(
      "This RFQ is closed. Additional suppliers cannot be invited.",
      409,
      "blocked",
    );
  }

  const awarded = (rfq.custom_selected_supplier ?? "").trim();
  if (awarded) {
    throw new RfqSupplierInviteError(
      "A supplier has already been awarded on this RFQ. Additional invitations are locked.",
      409,
      "blocked",
    );
  }

  if (poExists) {
    throw new RfqSupplierInviteError(
      "A Purchase Order already exists for this RFQ. Additional suppliers cannot be invited.",
      409,
      "blocked",
    );
  }
}

/**
 * Production-safe alternative to editing the standard DocType in Developer Mode.
 * Allows appending supplier child rows after RFQ submit.
 */
async function ensureRfqSuppliersAllowOnSubmit(
  cfg: ErpAdminConfig,
): Promise<void> {
  if (suppliersAllowOnSubmitEnsured) return;

  const propertySetterName = "Request for Quotation-suppliers-allow_on_submit";
  try {
    await erpFetch(
      cfg,
      `resource/Property%20Setter/${encodeURIComponent(propertySetterName)}`,
    );
    suppliersAllowOnSubmitEnsured = true;
    return;
  } catch {
    /* create below */
  }

  try {
    await erpFetch(cfg, "resource/Property%20Setter", {
      method: "POST",
      body: {
        doctype: "Property Setter",
        doc_type: RFQ_DOCTYPE,
        doctype_or_field: "DocField",
        field_name: "suppliers",
        property: "allow_on_submit",
        property_type: "Check",
        value: "1",
      },
    });
    suppliersAllowOnSubmitEnsured = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate|already exists/i.test(msg)) {
      suppliersAllowOnSubmitEnsured = true;
      return;
    }
    console.warn(
      "[rfq-invite] Could not ensure suppliers.allow_on_submit Property Setter:",
      msg,
    );
  }
}

function stripChildMeta(row: RfqSupplierRow): RfqSupplierRow {
  const next: RfqSupplierRow = {
    ...row,
    doctype: RFQ_SUPPLIER_DOCTYPE,
  };
  const rec = next as Record<string, unknown>;
  delete rec.creation;
  delete rec.modified;
  delete rec.modified_by;
  delete rec.owner;
  delete rec.docstatus;
  return next;
}

function nextChildIdx(suppliers: RfqSupplierRow[]): number {
  const max = Math.max(0, ...(suppliers ?? []).map((s) => Number(s.idx) || 0));
  return max + 1;
}

function buildNewSupplierRow(
  inv: InviteSupplierInput,
  idx: number,
): RfqSupplierRow {
  return {
    doctype: RFQ_SUPPLIER_DOCTYPE,
    idx,
    supplier: inv.supplier,
    supplier_name: inv.supplier_name || inv.supplier,
    email_id: inv.email_id,
    send_email: 1,
    email_sent: 0,
    quote_status: "Pending",
  };
}

async function insertSupplierChildRow(
  cfg: ErpAdminConfig,
  rfqName: string,
  inv: InviteSupplierInput,
  idx: number,
): Promise<void> {
  await erpFetch(cfg, "method/frappe.client.insert", {
    method: "POST",
    body: {
      doc: {
        doctype: RFQ_SUPPLIER_DOCTYPE,
        parent: rfqName,
        parenttype: RFQ_DOCTYPE,
        parentfield: "suppliers",
        idx,
        supplier: inv.supplier,
        supplier_name: inv.supplier_name || inv.supplier,
        email_id: inv.email_id,
        send_email: 1,
        email_sent: 0,
        quote_status: "Pending",
      },
    },
  });
}

async function postSupplierChildResource(
  cfg: ErpAdminConfig,
  rfqName: string,
  inv: InviteSupplierInput,
  idx: number,
): Promise<void> {
  await erpFetch(cfg, `resource/${encodeURIComponent(RFQ_SUPPLIER_DOCTYPE)}`, {
    method: "POST",
    body: {
      parent: rfqName,
      parenttype: RFQ_DOCTYPE,
      parentfield: "suppliers",
      idx,
      supplier: inv.supplier,
      supplier_name: inv.supplier_name || inv.supplier,
      email_id: inv.email_id,
      send_email: 1,
      email_sent: 0,
      quote_status: "Pending",
    },
  });
}

async function saveRfqWithAppendedSuppliers(
  cfg: ErpAdminConfig,
  rfq: RfqDoc,
  toInvite: InviteSupplierInput[],
): Promise<void> {
  const existing = (rfq.suppliers ?? []).map(stripChildMeta);
  let idx = nextChildIdx(existing);
  const appended = [...existing];

  for (const inv of toInvite) {
    appended.push(buildNewSupplierRow(inv, idx));
    idx += 1;
  }

  await erpFetch(cfg, "method/frappe.client.save", {
    method: "POST",
    body: {
      doc: {
        ...rfq,
        doctype: RFQ_DOCTYPE,
        suppliers: appended,
      },
    },
  });
}

function classifyAppendFailure(err: unknown): RfqSupplierInviteError {
  if (err instanceof RfqSupplierInviteError) {
    const lower = err.message.toLowerCase();
    if (
      lower.includes("updateaftersubmit") ||
      lower.includes("cannot be changed") ||
      lower.includes("already been submitted")
    ) {
      return new RfqSupplierInviteError(
        "ERPNext blocked updating suppliers on this submitted RFQ. Ensure the admin API key can write Property Setters, or contact your ERPNext administrator.",
        502,
        "erp",
      );
    }
    return err;
  }
  const msg = err instanceof Error ? err.message : "Could not add suppliers.";
  return new RfqSupplierInviteError(msg, 502, "erp");
}

async function appendSuppliersToRfq(
  cfg: ErpAdminConfig,
  rfq: RfqDoc,
  toInvite: InviteSupplierInput[],
): Promise<void> {
  if (rfq.docstatus === 1) {
    await ensureRfqSuppliersAllowOnSubmit(cfg);
  }

  let lastError: unknown;
  try {
    await saveRfqWithAppendedSuppliers(cfg, rfq, toInvite);
    return;
  } catch (err) {
    lastError = err;
  }

  if (rfq.docstatus !== 1) {
    throw classifyAppendFailure(lastError);
  }

  let idx = nextChildIdx(rfq.suppliers ?? []);
  let successCount = 0;
  for (const inv of toInvite) {
    try {
      await insertSupplierChildRow(cfg, rfq.name, inv, idx);
      idx += 1;
      successCount += 1;
      continue;
    } catch (err) {
      lastError = err;
      try {
        await postSupplierChildResource(cfg, rfq.name, inv, idx);
        idx += 1;
        successCount += 1;
      } catch (err2) {
        lastError = err2;
      }
    }
  }

  if (successCount === toInvite.length) {
    return;
  }

  throw classifyAppendFailure(lastError);
}

async function setChildRowSendEmail(
  cfg: ErpAdminConfig,
  rowName: string,
  value: 0 | 1,
): Promise<void> {
  await erpFetch(cfg, "method/frappe.client.set_value", {
    method: "POST",
    body: {
      doctype: RFQ_SUPPLIER_DOCTYPE,
      name: rowName,
      fieldname: "send_email",
      value,
    },
  });
}

/**
 * ERPNext send_supplier_emails emails every row with send_email=1. Temporarily
 * disable send_email on previously invited rows so only new suppliers receive mail.
 */
async function sendInvitationEmailsToNewSuppliers(
  cfg: ErpAdminConfig,
  rfqName: string,
  newSupplierIds: Set<string>,
): Promise<{ sent: boolean; error?: string }> {
  const rfq = await loadRfq(cfg, rfqName);
  const existingRowNames: string[] = [];

  for (const row of rfq.suppliers ?? []) {
    const rowName = String(row.name ?? "").trim();
    const supplier = normSupplier(String(row.supplier ?? ""));
    if (!rowName || !supplier) continue;
    if (!newSupplierIds.has(supplier)) {
      existingRowNames.push(rowName);
    }
  }

  const restored: string[] = [];
  for (const rowName of existingRowNames) {
    try {
      await setChildRowSendEmail(cfg, rowName, 0);
      restored.push(rowName);
    } catch {
      /* best-effort */
    }
  }

  try {
    await erpFetch(cfg, `method/${encodeURIComponent(SEND_RFQ_EMAILS_METHOD)}`, {
      method: "POST",
      body: { rfq_name: rfqName },
    });
    return { sent: true };
  } catch (err) {
    const msg = extractErpErrorMessage(
      err,
      "Failed to send invitation emails.",
    );
    console.warn("[rfq-invite] send_supplier_emails failed (invites still created):", msg);
    return { sent: false, error: "Failed to send invitations." };
  } finally {
    for (const rowName of restored) {
      try {
        await setChildRowSendEmail(cfg, rowName, 1);
      } catch {
        /* best-effort */
      }
    }
  }
}

export async function inviteSuppliersToRfqCore(input: {
  rfqName: string;
  suppliers: InviteSupplierInput[];
}): Promise<{
  rfq: RfqDoc;
  invited: InviteSupplierInput[];
  emailWarning?: string;
}> {
  const cfg = readErpAdminConfig();
  const rfqName = input.rfqName.trim();
  if (!rfqName) {
    throw new RfqSupplierInviteError("RFQ name is required.", 400, "validation");
  }

  const requested = (input.suppliers ?? []).filter((s) => s.supplier?.trim());
  if (requested.length === 0) {
    throw new RfqSupplierInviteError(
      "Select at least one supplier to invite.",
      400,
      "validation",
    );
  }

  const rfq = await loadRfq(cfg, rfqName);
  const poExists = await rfqHasLinkedPurchaseOrder(cfg, rfqName);
  assertRfqOpenForInvite(rfq, poExists);

  const existingIds = new Set(
    (rfq.suppliers ?? []).map((s) => normSupplier(String(s.supplier ?? ""))),
  );

  const duplicateNames = requested.filter((s) =>
    existingIds.has(normSupplier(s.supplier)),
  );
  const toInvite = requested.filter(
    (s) => !existingIds.has(normSupplier(s.supplier)),
  );

  if (toInvite.length === 0) {
    throw new RfqSupplierInviteError(
      duplicateNames.length === 1
        ? "This supplier has already been invited to this RFQ."
        : "All selected suppliers are already invited to this RFQ.",
      409,
      "duplicate",
    );
  }

  await appendSuppliersToRfq(cfg, rfq, toInvite);

  const newSupplierIds = new Set(toInvite.map((s) => normSupplier(s.supplier)));
  let emailWarning: string | undefined;
  if (rfq.docstatus === 1) {
    const emailResult = await sendInvitationEmailsToNewSuppliers(
      cfg,
      rfqName,
      newSupplierIds,
    );
    if (!emailResult.sent && emailResult.error) {
      emailWarning = emailResult.error;
    }
  }

  const updated = await loadRfq(cfg, rfqName);
  return { rfq: updated, invited: toInvite, emailWarning };
}
