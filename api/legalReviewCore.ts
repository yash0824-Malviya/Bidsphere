import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { assertLegalReviewFileAccess, resolveLegalReviewFile } from "./legalAttachmentAccess.js";
import { canonicalErpFilePath, fetchErpFile } from "./fileProxyCore.js";
import { requireRoles, type AccessPrincipal, type AppRole } from "./rbacAuth.js";
import { assertSupplierAwardEligible } from "./supplierAwardEligibilityGuard.js";
import { rfqInitialClmHold, withoutInitialClmHeldReviews } from "./rfqInitialClmHold.js";
import { canStartLegalSignature, createEmptyEnvelope, LEGAL_CHECKPOINT_IDS, LEGAL_DOC_KEYS, parseEsignBundle, areRequiredDocumentsVerified, isLegalDocumentVerified, isLegalReviewExecuted, type LegalDocKey, type LegalEsignAuditAction, type LegalEsignBundle, type LegalEsignSignature } from "../src/types/legalEsign.js";
import { burnTypedSignatureIntoPdf } from "../src/utils/legalPdfSignature.js";
/**
 * Legal Document Review — server-owned business logic.
 *
 * This module is the SINGLE place in the entire stack allowed to write to
 * the ERPNext "Legal Document Review" DocType. It runs in two adapters that
 * share this exact code (never duplicated):
 *
 *   - api/legal-review.ts        → Vercel serverless function (production)
 *   - vite.config.ts (dev plugin) → local `npm run dev` parity
 *
 * The React app (`src/api/legalDocs.ts`) never builds an ERPNext document or
 * talks to `/api/resource/Legal Document Review` for writes — it only POSTs
 * a minimal action + identifiers here, and this module decides exactly what
 * gets written, using the privileged ERPNext API key (never exposed to the
 * browser).
 *
 * Duplicate protection is defense-in-depth:
 *   1. This module checks for an existing record by `rfq_name` before
 *      inserting (fast path, avoids unnecessary round-trips).
 *   2. The `rfq_name` field on the ERPNext DocType itself has a DB-level
 *      `unique` constraint (see scripts/setup-legal-review-doctype.mjs),
 *      so even a race between two concurrent requests cannot create two
 *      records for the same RFQ — MySQL rejects the second INSERT outright.
 */
import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";
import { formatERPNextDatetime } from "../src/utils/erpNextDate.js";

const DOCTYPE = "Legal Document Review";
const RFQ_DOCTYPE = "Request for Quotation";

/**
 * Canonical Select / workflow values for Legal Document Review.
 * Must stay aligned with `scripts/setup-legal-review-doctype.mjs` options —
 * not arbitrary UI labels.
 */
export const LEGAL_REVIEW_STATUS = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
} as const;

export const FINANCE_REVIEW_STATUS = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
} as const;

/** `workflow_state` tracks the active stage after Legal decides. */
export const LDR_WORKFLOW_STATE = {
  PENDING_REVIEW: "Pending Review",
  FINANCE_REVIEW: "Finance Review",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
} as const;

/** Canonical owners written onto the LDR row during stage transitions. */
export const LDR_OWNERS = {
  LEGAL: "Legal Reviewer",
  FINANCE: "Finance Manager",
  PROCUREMENT: "Procurement",
  PROCUREMENT_TEAM: "Procurement Team",
  NONE: "—",
} as const;

/** Fields required for Legal → Finance handoff (created at runtime if missing). */
const FINANCE_HANDOFF_FIELDS: Array<{
  fieldname: string;
  label: string;
  fieldtype: string;
  options?: string;
  insert_after: string;
  in_list_view?: number;
}> = [
  {
    fieldname: "workflow_state",
    label: "Workflow State",
    fieldtype: "Data",
    insert_after: "review_status",
    in_list_view: 1,
  },
  {
    fieldname: "finance_status",
    label: "Finance Status",
    fieldtype: "Select",
    options: `\n${FINANCE_REVIEW_STATUS.PENDING}\n${FINANCE_REVIEW_STATUS.APPROVED}\n${FINANCE_REVIEW_STATUS.REJECTED}`,
    insert_after: "rejection_reason",
    in_list_view: 1,
  },
  {
    fieldname: "finance_approved_by",
    label: "Finance Approved/Rejected By",
    fieldtype: "Data",
    insert_after: "finance_status",
    in_list_view: 1,
  },
  {
    fieldname: "finance_approved_on",
    label: "Finance Approved/Rejected On",
    fieldtype: "Datetime",
    insert_after: "finance_approved_by",
    in_list_view: 1,
  },
  {
    fieldname: "finance_comments",
    label: "Finance Comments",
    fieldtype: "Small Text",
    insert_after: "finance_approved_on",
  },
  {
    fieldname: "finance_rejection_reason",
    label: "Finance Rejection Reason",
    fieldtype: "Small Text",
    insert_after: "finance_comments",
  },
  {
    fieldname: "current_owner",
    label: "Current Owner",
    fieldtype: "Data",
    insert_after: "workflow_state",
    in_list_view: 1,
  },
  {
    fieldname: "next_approver",
    label: "Next Approver",
    fieldtype: "Data",
    insert_after: "current_owner",
    in_list_view: 1,
  },
];

/** Explicit list fields — never rely on `fields=["*"]` (Frappe often drops it). */
const WORKFLOW_LIST_FIELDS = [
  "name",
  "modified",
  "sq_name",
  "rfq_name",
  "supplier",
  "company",
  "quotation_number",
  "procurement_manager",
  "submission_date",
  "workflow_state",
  "current_owner",
  "next_approver",
  "grand_total",
  "review_status",
  "approved_by",
  "approved_on",
  "legal_comments",
  "rejection_reason",
  "finance_status",
  "finance_approved_by",
  "finance_approved_on",
  "finance_comments",
  "finance_rejection_reason",
  "esign_status",
  "esign_envelope",
  "esign_signed_by",
  "esign_signed_on",
  "esign_signed_file_url",
  "terms_file_url",
  "warranty_file_url",
  "insurance_file_url",
] as const;

let schemaEnsurePromise: Promise<void> | null = null;

/* ────────────────────────────────────────────────────────────────────────
 *  Privileged ERPNext client (server-side only — never bundled to browser)
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
    throw new Error(
      "Legal review backend is misconfigured: missing ERPNEXT_URL / ERP_API_KEY / ERP_API_SECRET."
    );
  }

  return { baseUrl, key, secret };
}

export class LegalReviewError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "LegalReviewError";
    this.status = status;
  }
}

async function erpFetch<T = unknown>(
  cfg: ErpAdminConfig,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch(`${cfg.baseUrl}/api/${path}`, {
    method: init?.method ?? "GET",
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
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON response */
  }

  if (!res.ok) {
    const data = (json ?? {}) as {
      exception?: string;
      exc_type?: string;
      _server_messages?: string;
    };
    let friendly = data.exception ?? data.exc_type ?? text ?? "ERPNext request failed";
    if (data._server_messages) {
      try {
        const parsed = JSON.parse(data._server_messages) as string[];
        const first = parsed[0] ? JSON.parse(parsed[0]) : null;
        if (first?.message) friendly = first.message;
      } catch {
        /* keep default */
      }
    }
    throw new LegalReviewError(friendly, res.status);
  }

  return (json as { data?: T })?.data ?? (json as T);
}

/* ────────────────────────────────────────────────────────────────────────
 *  Types
 * ──────────────────────────────────────────────────────────────────────── */

export interface LegalDocumentRecord {
  name: string;
  sq_name: string;
  rfq_name?: string;
  supplier: string;
  company?: string;
  quotation_number?: string;
  procurement_manager?: string;
  submission_date?: string;
  workflow_state?: string;
  grand_total?: number;
  valid_till?: string;
  payment_terms?: string;
  supplier_notes?: string;
  item_summary?: string;
  terms_file_url?: string;
  terms_note?: string;
  terms_viewed?: 0 | 1;
  terms_approved?: 0 | 1;
  warranty_file_url?: string;
  warranty_note?: string;
  warranty_viewed?: 0 | 1;
  warranty_approved?: 0 | 1;
  insurance_file_url?: string;
  insurance_note?: string;
  insurance_viewed?: 0 | 1;
  insurance_approved?: 0 | 1;
  review_status: "Pending" | "Approved" | "Rejected";
  /** Set only when review_status !== "Pending" — the reviewer's identity. */
  approved_by?: string;
  /** Set only when review_status !== "Pending" — server-stamped decision time. */
  approved_on?: string;
  /** Reviewer's comments — captured on both Approve and Reject. */
  legal_comments?: string;
  /** Required context for a Rejected decision; empty/unset when Approved. */
  rejection_reason?: string;
  /**
   * Finance Review verdict — lives on this SAME record (no separate Finance
   * DocType). Unset until Legal approves; stamped "Pending" the moment
   * `review_status` becomes "Approved" (see decideLegalDocumentReview).
   */
  finance_status?: "Pending" | "Approved" | "Rejected" | "";
  /** Set only once finance_status !== "Pending" — the Finance reviewer's identity. */
  finance_approved_by?: string;
  /** Set only once finance_status !== "Pending" — server-stamped decision time. */
  finance_approved_on?: string;
  /** Finance reviewer's comments — captured on both Approve and Reject. */
  finance_comments?: string;
  /** Required for a finance Reject; empty/unset when Approved. */
  finance_rejection_reason?: string;
  /** Active queue owner — written on every stage transition. */
  current_owner?: string;
  /** Next approver role — written on every stage transition. */
  next_approver?: string;
  modified?: string;
  /** JSON envelope for Legal PDF e-sign (future multi-role ready). */
  esign_envelope?: string;
  esign_status?: string;
  esign_document_hash?: string;
  esign_signed_file_url?: string;
  esign_signed_by?: string;
  esign_signed_on?: string;
  /** Response-only: derived from the current server-owned attachment slots. */
  required_document_keys?: LegalDocKey[];
}

export interface CreateLegalReviewInput {
  sq_name: string;
  rfq_name: string;
  supplier: string;
  company?: string;
  quotation_number?: string;
  procurement_manager?: string;
  submission_date?: string;
  grand_total?: number;
  valid_till?: string;
  payment_terms?: string;
  supplier_notes?: string;
  item_summary?: string;
  terms_file_url?: string;
  terms_note?: string;
  warranty_file_url?: string;
  warranty_note?: string;
  insurance_file_url?: string;
  insurance_note?: string;
}

/* ────────────────────────────────────────────────────────────────────────
 *  Lookups
 * ──────────────────────────────────────────────────────────────────────── */

async function findByRfqName(
  cfg: ErpAdminConfig,
  rfqName: string
): Promise<LegalDocumentRecord | null> {
  const rows = await erpFetch<Array<{ name: string }>>(
    cfg,
    `resource/${encodeURIComponent(DOCTYPE)}?` +
      new URLSearchParams({
        filters: JSON.stringify([["rfq_name", "=", rfqName]]),
        fields: JSON.stringify(["name"]),
        limit_page_length: "1",
      }).toString()
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return erpFetch<LegalDocumentRecord>(
    cfg,
    `resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(rows[0].name)}`
  );
}

async function getByName(
  cfg: ErpAdminConfig,
  name: string
): Promise<LegalDocumentRecord> {
  const record = await erpFetch<LegalDocumentRecord>(
    cfg,
    `resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(name)}`
  );
  return withRequiredDocuments(record);
}

function withRequiredDocuments(record: LegalDocumentRecord): LegalDocumentRecord {
  // This ERP schema has no mandatory-document child table or reqd flags.
  // Its persisted review attachment slots define the existing instrument set;
  // two populated slots require two documents, not a hardcoded three.
  return { ...record, required_document_keys: LEGAL_DOC_KEYS.filter(key => Boolean(record[`${key}_file_url`]?.trim())) };
}

/**
 * Privileged workflow list — the ONLY authoritative read path for Legal and
 * Finance queues. Uses server ERP credentials + an explicit field list so
 * browser permission quirks / `fields=["*"]` failures can never empty the
 * Finance queue after a successful Legal approve.
 */
export async function listWorkflowRecords(options?: {
  limit?: number;
  excludeInitialClmHeld?: boolean;
}): Promise<LegalDocumentRecord[]> {
  const cfg = readErpAdminConfig();
  await ensureLegalDocumentReviewSchema(cfg);

  const limit = Math.min(Math.max(options?.limit ?? 200, 1), 500);

  const fetchList = (fields: readonly string[]) =>
    erpFetch<LegalDocumentRecord[]>(
      cfg,
      `resource/${encodeURIComponent(DOCTYPE)}?` +
        new URLSearchParams({
          fields: JSON.stringify([...fields]),
          limit_page_length: String(limit),
          order_by: "modified desc",
        }).toString(),
    );

  let rows: LegalDocumentRecord[];
  try {
    rows = await fetchList(WORKFLOW_LIST_FIELDS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // New owner fields may not be queryable until DocType cache refreshes —
    // retry without them so Finance queue never goes dark after Legal approve.
    if (/Field not permitted|Unknown column|not found/i.test(msg)) {
      const fallbackFields = WORKFLOW_LIST_FIELDS.filter(
        (f) => f !== "current_owner" && f !== "next_approver",
      );
      // eslint-disable-next-line no-console
      console.warn(
        "[legal-review] listWorkflowRecords retrying without owner fields:",
        msg,
      );
      rows = await fetchList(fallbackFields);
    } else {
      throw err;
    }
  }

  const records = Array.isArray(rows) ? rows.map(withRequiredDocuments) : [];
  return options?.excludeInitialClmHeld ? withoutInitialClmHeldReviews(records, (doctype, name) => erpFetch<Record<string, unknown>>(cfg, resource(doctype, name))) : records;
}

/**
 * Ensures Finance handoff fields exist on Legal Document Review.
 * Missing `finance_status` is the primary cause of "leaves Legal, never
 * appears in Finance" — ERPNext silently drops unknown fields on PUT while
 * still accepting known ones like `review_status`.
 */
async function ensureLegalDocumentReviewSchemaOnce(
  cfg: ErpAdminConfig,
): Promise<void> {
  const doc = await erpFetch<{
    name?: string;
    fields?: Array<Record<string, unknown>>;
  }>(cfg, `resource/DocType/${encodeURIComponent(DOCTYPE)}`);

  const fields = Array.isArray(doc.fields) ? [...doc.fields] : [];
  const existingNames = new Set(
    fields
      .map((f) => String(f.fieldname ?? ""))
      .filter(Boolean),
  );

  let modified = false;
  for (const required of FINANCE_HANDOFF_FIELDS) {
    if (existingNames.has(required.fieldname)) continue;
    fields.push({
      ...required,
      parent: DOCTYPE,
      parentfield: "fields",
      parenttype: "DocType",
      doctype: "DocField",
    });
    existingNames.add(required.fieldname);
    modified = true;
    // eslint-disable-next-line no-console
    console.log(
      `[legal-review] Adding missing DocType field: ${required.fieldname}`,
    );
  }

  // Keep review_status options complete so Pending/Approved/Rejected all stick.
  const reviewStatus = fields.find((f) => f.fieldname === "review_status");
  const expectedReviewOpts = `${LEGAL_REVIEW_STATUS.PENDING}\n${LEGAL_REVIEW_STATUS.APPROVED}\n${LEGAL_REVIEW_STATUS.REJECTED}`;
  if (
    reviewStatus &&
    String(reviewStatus.options ?? "") !== expectedReviewOpts
  ) {
    reviewStatus.options = expectedReviewOpts;
    modified = true;
  }

  if (!modified) return;

  await erpFetch(cfg, `resource/DocType/${encodeURIComponent(DOCTYPE)}`, {
    method: "PUT",
    body: { fields },
  });

  try {
    await erpFetch(cfg, "method/frappe.clear_cache", {
      method: "POST",
      body: {},
    });
  } catch {
    /* non-fatal — field is still on DocType */
  }

  // eslint-disable-next-line no-console
  console.log("[legal-review] Legal Document Review schema updated for Finance handoff");
}

export async function ensureLegalDocumentReviewSchema(
  cfg?: ErpAdminConfig,
): Promise<void> {
  const admin = cfg ?? readErpAdminConfig();
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = ensureLegalDocumentReviewSchemaOnce(admin).catch(
      (err) => {
        schemaEnsurePromise = null;
        throw err;
      },
    );
  }
  await schemaEnsurePromise;
}

/**
 * Best-effort RFQ custom-field sync so any legacy readers of
 * custom_legal_status / custom_finance_status / custom_workflow_step stay
 * aligned with Legal Document Review (source of truth).
 */
async function syncRfqAfterLegalApprove(
  cfg: ErpAdminConfig,
  rfqName: string | undefined,
  reviewedBy: string,
  approvedOn: string,
): Promise<void> {
  const name = (rfqName ?? "").trim();
  if (!name) return;

  try {
    const meta = await erpFetch<{
      fields?: Array<{ fieldname?: string; options?: string }>;
    }>(cfg, `resource/DocType/${encodeURIComponent(RFQ_DOCTYPE)}`);
    const fieldMeta = new Map(
      (meta.fields ?? [])
        .filter((f) => f.fieldname)
        .map((f) => [String(f.fieldname), f] as const),
    );

    const body: Record<string, unknown> = {};

    const legalField =
      ["custom_legal_status", "custom_legal_review_status"].find((f) =>
        fieldMeta.has(f),
      ) ?? null;
    if (legalField) body[legalField] = LEGAL_REVIEW_STATUS.APPROVED;

    const financeField =
      ["custom_finance_status", "custom_finance_review_status"].find((f) =>
        fieldMeta.has(f),
      ) ?? null;
    if (financeField) {
      const opts = String(fieldMeta.get(financeField)?.options ?? "");
      // Prefer the DocType's own option vocabulary when present.
      body[financeField] = opts.includes("Pending Finance Review")
        ? "Pending Finance Review"
        : FINANCE_REVIEW_STATUS.PENDING;
    }

    if (fieldMeta.has("custom_workflow_step")) {
      const opts = String(fieldMeta.get("custom_workflow_step")?.options ?? "");
      body.custom_workflow_step = opts.includes("Pending Finance Review")
        ? "Pending Finance Review"
        : LDR_WORKFLOW_STATE.FINANCE_REVIEW;
    }
    if (fieldMeta.has("custom_legal_reviewer")) {
      body.custom_legal_reviewer = reviewedBy;
    }
    if (fieldMeta.has("custom_legal_review_date")) {
      body.custom_legal_review_date = approvedOn;
    }

    if (Object.keys(body).length === 0) return;

    await erpFetch(
      cfg,
      `resource/${encodeURIComponent(RFQ_DOCTYPE)}/${encodeURIComponent(name)}`,
      { method: "PUT", body },
    );
    // eslint-disable-next-line no-console
    console.log(`[legal-review] Synced RFQ ${name} after Legal approve`, body);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[legal-review] RFQ sync after Legal approve failed for ${name}:`,
      err,
    );
  }
}

/* ────────────────────────────────────────────────────────────────────────
 *  Create — gated on "Supplier Selected" (called once per RFQ, ever)
 * ──────────────────────────────────────────────────────────────────────── */

export async function createLegalDocumentReview(
  input: CreateLegalReviewInput
): Promise<{ created: boolean; record: LegalDocumentRecord }> {
  const cfg = readErpAdminConfig();
  await ensureLegalDocumentReviewSchema(cfg);

  const rfqName = (input.rfq_name ?? "").trim();
  const sqName = (input.sq_name ?? "").trim();
  const supplier = (input.supplier ?? "").trim();

  if (!rfqName) throw new LegalReviewError("rfq_name is required.", 400);
  if (!sqName) throw new LegalReviewError("sq_name is required.", 400);
  if (!supplier) throw new LegalReviewError("supplier is required.", 400);

  // STEP 3 — dedup by rfq_name. This is the primary, fast-path check; the
  // DB-level unique constraint on rfq_name is the hard backstop against races.
  const existing = await findByRfqName(cfg, rfqName);
  if (existing) {
    if (existing.sq_name !== sqName || existing.supplier !== supplier) throw new LegalReviewError("This RFQ already has a different selected supplier or quotation.", 409);
    return { created: false, record: existing };
  }

  // The browser's score/rank or eligibility flags cannot authorize an award.
  // Preserve the Legal workflow, but refuse to initialize it for an AVOID quote.
  await assertSupplierAwardEligible({ rfqId: rfqName, supplierId: supplier, quotationId: sqName });

  const payload: Record<string, unknown> = {
    doctype: DOCTYPE,
    sq_name: sqName,
    rfq_name: rfqName,
    supplier,
    company: input.company ?? "",
    quotation_number: input.quotation_number ?? sqName,
    procurement_manager: input.procurement_manager ?? "",
    submission_date: formatERPNextDatetime(input.submission_date) ?? formatERPNextDatetime(new Date()),
    grand_total: input.grand_total ?? 0,
    valid_till: input.valid_till ?? "",
    payment_terms: input.payment_terms ?? "",
    supplier_notes: input.supplier_notes ?? "",
    item_summary: input.item_summary ?? "[]",
    terms_file_url: input.terms_file_url ?? "",
    terms_note: input.terms_note ?? "",
    warranty_file_url: input.warranty_file_url ?? "",
    warranty_note: input.warranty_note ?? "",
    insurance_file_url: input.insurance_file_url ?? "",
    insurance_note: input.insurance_note ?? "",
    // Never trust a client-supplied review_status — every new record starts Pending.
    review_status: "Pending",
    workflow_state: LDR_WORKFLOW_STATE.PENDING_REVIEW,
    current_owner: LDR_OWNERS.LEGAL,
    next_approver: LDR_OWNERS.LEGAL,
  };

  try {
    const created = await erpFetch<LegalDocumentRecord>(cfg, `resource/${encodeURIComponent(DOCTYPE)}`, {
      method: "POST",
      body: payload,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[legal-review] Created ${created?.name ?? "(unknown)"} for RFQ ${rfqName}, SQ ${sqName}, supplier ${supplier}`
    );
    return { created: true, record: created };
  } catch (err) {
    // Race condition: another request created the record between our
    // lookup and this insert. MySQL's unique constraint on rfq_name
    // rejects the duplicate — treat that as success, not failure.
    if (err instanceof LegalReviewError && /rfq_name|unique|UniqueValidationError|Duplicate/i.test(err.message)) {
      const raceWinner = await findByRfqName(cfg, rfqName);
      if (raceWinner) {
        // eslint-disable-next-line no-console
        console.log(`[legal-review] Race detected for RFQ ${rfqName} — returning existing ${raceWinner.name}`);
        return { created: false, record: raceWinner };
      }
    }
    throw err;
  }
}

/* ────────────────────────────────────────────────────────────────────────
 *  Approve / Reject — the ONLY way review_status may change
 * ──────────────────────────────────────────────────────────────────────── */


export interface ReviewDecisionInput {
  name: string;
  status: "Approved" | "Rejected";
  reviewedBy?: string; // Compatibility only: never used as identity.
  comments?: string;
  rejectionReason?: string;
}
export type FinanceDecisionInput = ReviewDecisionInput;

const reviewPath = (name: string) => `resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(name)}`;
const actorId = (principal: AccessPrincipal) => {
  if (principal.typ !== "internal") throw new LegalReviewError("Internal authentication required.", 403);
  return principal.email || principal.sub;
};
function requireActorRoles(principal: AccessPrincipal, roles: AppRole[]): asserts principal is Extract<AccessPrincipal, { typ: "internal" }> {
  if (principal.typ !== "internal") throw new LegalReviewError("Internal signing/workflow authentication is required.", 403);
  requireRoles(principal, roles);
}
const now = () => new Date().toISOString();
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const resource = (doctype: string, name: string) => `resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;

async function loadReview(name: string, principal: AccessPrincipal, readOnly = false) {
  if (typeof name !== "string" || !name.trim()) throw new LegalReviewError("Review name is required.", 400);
  const cfg = readErpAdminConfig();
  const record = await getByName(cfg, name);
  const quotation = await erpFetch<Record<string, unknown>>(cfg, resource("Supplier Quotation", record.sq_name));
  assertLegalReviewFileAccess(principal, { ...record }, quotation);
  if (!readOnly) {
    const hold = await rfqInitialClmHold({ ...record }, (doctype, docname) => erpFetch<Record<string, unknown>>(cfg, resource(doctype, docname)));
    if (hold) throw new LegalReviewError(hold, 409);
  }
  return { cfg, record, quotation };
}

export async function getLegalReview(name: string, principal: AccessPrincipal) {
  return (await loadReview(name, principal, true)).record;
}

async function requireActiveRfq(cfg: ErpAdminConfig, record: LegalDocumentRecord) {
  if (!record.rfq_name?.trim()) throw new LegalReviewError("This Legal Review is not linked to an RFQ; verify its parent before signing.", 409);
  const quotation = await erpFetch<Record<string, unknown>>(cfg, resource("Supplier Quotation", record.sq_name));
  const rfq = await erpFetch<Record<string, unknown>>(cfg, resource(RFQ_DOCTYPE, record.rfq_name));
  for (const source of [quotation, rfq]) {
    if (!source) continue;
    if (Number(source.docstatus) === 2 || [source.status, source.workflow_state, source.custom_status]
      .some(value => /^(rejected|cancelled|canceled|closed|stopped)$/i.test(String(value || "").trim()))) {
      throw new LegalReviewError("This RFQ or quotation is rejected, cancelled, or closed.", 409);
    }
  }
  const quotationRfqNames = new Set([
    quotation.request_for_quotation,
    ...(Array.isArray(quotation.items)
      ? quotation.items.map(item => item && typeof item === "object" ? item.request_for_quotation : undefined)
      : []),
  ].filter((value): value is string => typeof value === "string" && !!value.trim()));
  if (!quotationRfqNames.has(record.rfq_name) || quotation.supplier !== record.supplier ||
      (quotation.company && record.company && quotation.company !== record.company) ||
      (rfq.company && record.company && rfq.company !== record.company) ||
      (typeof rfq.custom_selected_supplier === "string" && rfq.custom_selected_supplier.trim() &&
        rfq.custom_selected_supplier !== record.supplier)) {
    throw new LegalReviewError("The Legal Review no longer matches its selected supplier quotation.", 409);
  }
}

/** Every successful mutation returns a fresh read, verifying ALL written fields. */
async function saveVerified(cfg: ErpAdminConfig, record: LegalDocumentRecord, updates: Record<string, unknown>) {
  await erpFetch(cfg, reviewPath(record.name), {
    method: "PUT",
    // Frappe's save timestamp check rejects stale concurrent updates.
    body: { ...updates, modified: record.modified },
  });
  const saved = await getByName(cfg, record.name);
  for (const [key, expected] of Object.entries(updates)) {
    const actual = (saved as unknown as Record<string, unknown>)[key];
    const equal = key === "esign_envelope"
      ? JSON.stringify(parseEsignBundle(actual)) === JSON.stringify(parseEsignBundle(expected))
      : (actual ?? "") === (expected ?? "") || typeof expected === "number" && Number(actual) === expected;
    if (!equal) throw new LegalReviewError(`Backend did not persist ${key}. Refresh before retrying.`, 502);
  }
  return saved;
}

function requireLegalStage(record: LegalDocumentRecord) {
  if (record.review_status !== "Pending" || !["", "Pending Review", "Legal Review", "Ready for Signature", "Pending Signature"].includes(record.workflow_state || "") ||
      record.current_owner === LDR_OWNERS.PROCUREMENT) {
    throw new LegalReviewError("This record is not awaiting Legal Review.", 409);
  }
}
function audit(bundle: LegalEsignBundle, principal: AccessPrincipal, action: LegalEsignAuditAction, detail: string) {
  bundle.auditTrail ||= [];
  bundle.auditTrail.push({ id: randomUUID(), action, user: actorId(principal), userId: actorId(principal), at: now(), detail });
  for (const env of Object.values(bundle.documents)) {
    if (env) env.auditTrail.push({ id: randomUUID(), action, user: actorId(principal), userId: actorId(principal), at: now(), detail });
  }
}
function attachedKeys(record: LegalDocumentRecord) {
  const keys = LEGAL_DOC_KEYS.filter(key => !!record[`${key}_file_url`]);
  if (!keys.length) throw new LegalReviewError("No contract PDF is attached for review.", 422);
  return keys;
}
function resetEvidence(record: LegalDocumentRecord, principal: AccessPrincipal, detail: string) {
  const bundle = parseEsignBundle(record.esign_envelope);
  audit(bundle, principal, "version_changed", detail);
  for (const env of Object.values(bundle.documents)) {
    if (!env) continue;
    if (env.signedFileUrl) env.auditTrail.push({
      id: randomUUID(), action: "version_changed", user: actorId(principal), at: now(),
      detail: `Archived signed version: ${env.documentHash}; ${env.signedFileHash}; ${env.signedFileUrl}`,
    });
    delete env.viewedBy; delete env.viewedAt; delete env.approvedHash; delete env.approvedFileId;
    delete env.approvedBy; delete env.approvalTimestamp; delete env.signatureRequest;
    delete env.signedFileUrl; delete env.signedFileHash;
    env.signatures = []; env.locked = false; env.status = "unsigned"; env.approvalStatus = "Pending";
  }
  bundle.reviewChecklist = [];
  return {
    review_status: "Pending", workflow_state: LDR_WORKFLOW_STATE.PENDING_REVIEW,
    current_owner: LDR_OWNERS.LEGAL, next_approver: LDR_OWNERS.LEGAL,
    approved_by: "", approved_on: "", finance_status: "", finance_approved_by: "", finance_approved_on: "",
    esign_status: "unsigned", esign_signed_by: "", esign_signed_on: "", esign_signed_file_url: "", esign_document_hash: "",
    terms_viewed: 0, warranty_viewed: 0, insurance_viewed: 0,
    terms_approved: 0, warranty_approved: 0, insurance_approved: 0,
    esign_envelope: JSON.stringify(bundle),
  };
}

const quotationFileFields: Record<LegalDocKey, string[]> = {
  terms: ["custom_terms__condition", "custom_terms_condition"],
  warranty: ["custom_warenty_certificate", "custom_warranty_certificate"],
  insurance: ["custom_insurance_certificate"],
};

/** Resolves the existing parent-bound File record and checks real, parseable PDF bytes. */
async function currentPdf(cfg: ErpAdminConfig, record: LegalDocumentRecord, principal: AccessPrincipal, key: LegalDocKey, readOnly = false) {
  if (!LEGAL_DOC_KEYS.includes(key)) throw new LegalReviewError("Invalid document key.", 400);
  const fileUrl = record[`${key}_file_url`] || "";
  const loadDocument = (doctype: string, name: string) => erpFetch<Record<string, unknown>>(cfg, resource(doctype, name));
  const file = await resolveLegalReviewFile({
    principal, reviewName: record.name, documentKey: key, requestedPath: fileUrl, loadDocument,
  });
  if (file.attached_to_doctype === "Supplier Quotation") {
    const quotation = await loadDocument("Supplier Quotation", record.sq_name);
    const latest = quotationFileFields[key].map(field => quotation[field]).find(value => typeof value === "string" && value);
    if (!latest || canonicalErpFilePath(String(latest)) !== canonicalErpFilePath(fileUrl)) {
      if (!readOnly && !Object.values(parseEsignBundle(record.esign_envelope).documents).some(env => env?.signatureRequest?.completedAt)) {
        await saveVerified(cfg, record, resetEvidence(record, principal, "Quotation attachment changed; resubmit the current version."));
      }
      throw new LegalReviewError("The quotation PDF changed. Procurement must resubmit the current version for Legal Review.", 409);
    }
  }
  const result = await fetchErpFile({
    baseUrl: cfg.baseUrl, apiKey: cfg.key, apiSecret: cfg.secret, filePath: fileUrl, fileId: file.name,
    authorizeFile: async resolved => {
      if (resolved.name !== file.name || resolved.attached_to_doctype !== file.attached_to_doctype ||
          resolved.attached_to_name !== file.attached_to_name) throw new LegalReviewError("Attachment changed.", 409);
    },
  });
  if (!result.ok) throw new LegalReviewError(result.body.message, result.status);
  if (!result.contentType.toLowerCase().startsWith("application/pdf") || result.buffer.subarray(0, 5).toString() !== "%PDF-") {
    throw new LegalReviewError("Attachment is not a PDF document.", 422);
  }
  let pages: number;
  try { pages = (await PDFDocument.load(result.buffer)).getPageCount(); }
  catch { throw new LegalReviewError("The PDF is corrupt or encrypted and cannot be reviewed.", 422); }
  if (!pages) throw new LegalReviewError("The PDF has no pages.", 422);
  const hash = digest(result.buffer);
  const prior = parseEsignBundle(record.esign_envelope).documents[key];
  if (prior?.viewedAt && (prior.documentHash !== hash || prior.sourceFileId !== file.name || prior.sourceFileUrl !== fileUrl)) {
    if (!readOnly && !Object.values(parseEsignBundle(record.esign_envelope).documents).some(env => env?.signatureRequest?.completedAt)) {
      await saveVerified(cfg, record, resetEvidence(record, principal, `Changed ${key}: ${prior.documentHash} → ${hash}`));
    }
    throw new LegalReviewError("Document Integrity: Failed. The PDF differs from the verified version; review the replacement before proceeding.", 409);
  }
  return { file, fileUrl, hash, bytes: result.buffer, pages };
}

async function verifiedPdfsForSignature(cfg: ErpAdminConfig, record: LegalDocumentRecord, principal: AccessPrincipal, readOnly = false) {
  requireActorRoles(principal, ["legal"]);
  requireLegalStage(record);
  await requireActiveRfq(cfg, record);
  if (!canStartLegalSignature(record)) {
    if (!areRequiredDocumentsVerified(record)) {
      throw new LegalReviewError("Verify all required legal documents before e-signature.", 409);
    }
    throw new LegalReviewError("Prerequisites for e-signature are not met.", 409);
  }
  const bundle = parseEsignBundle(record.esign_envelope);
  for (const key of attachedKeys(record)) {
    const pdf = await currentPdf(cfg, record, principal, key, readOnly);
    const env = bundle.documents[key];
    if (!record[`${key}_approved`] || !env?.viewedAt || !env.viewedBy || env.documentHash !== pdf.hash || env.sourceFileId !== pdf.file.name ||
        (env.approvedHash && env.approvedHash !== pdf.hash) || (env.approvedFileId && env.approvedFileId !== pdf.file.name)) {
      throw new LegalReviewError(`The current ${key} PDF must be viewed and verified before e-signature.`, 409);
    }
    // Bind legacy reviewed flags to freshly fetched bytes, never client hashes.
    env.approvedHash = pdf.hash; env.approvedFileId = pdf.file.name;
  }
  return bundle;
}

export interface LegalSignatureEligibilityResult {
  record: LegalDocumentRecord;
  requiredDocumentKeys: LegalDocKey[];
  verifiedDocumentKeys: LegalDocKey[];
  pendingDocumentKeys: LegalDocKey[];
  canSignDocumentKeys: LegalDocKey[];
  eligible: boolean;
  reason?: string;
  checkedAt: string;
}

const SIGNATURE_SAVE_PENDING_REASON = "This signature has an in-progress or unconfirmed save. Refresh; if it remains pending, an administrator must reconcile the existing request before retrying.";

/** Read-only preflight: the UI uses the same current-file rules as begin/complete. */
export async function getLegalSignatureEligibility(name: string, principal: AccessPrincipal): Promise<LegalSignatureEligibilityResult> {
  requireActorRoles(principal, ["legal"]);
  const { cfg, record } = await loadReview(name, principal);
  const requiredDocumentKeys = record.required_document_keys || [];
  const verifiedDocumentKeys = requiredDocumentKeys.filter(key => isLegalDocumentVerified(record, key));
  const pendingDocumentKeys = requiredDocumentKeys.filter(key => !verifiedDocumentKeys.includes(key));
  const result: LegalSignatureEligibilityResult = {
    record, requiredDocumentKeys, verifiedDocumentKeys, pendingDocumentKeys,
    canSignDocumentKeys: [], eligible: false, checkedAt: now(),
  };
  if (!requiredDocumentKeys.length || pendingDocumentKeys.length) {
    return { ...result, reason: "Verify all required supplier documents before signing." };
  }
  if (isLegalReviewExecuted(record)) return { ...result, reason: "Document has already been signed." };
  try {
    // Read-only prevents a readiness refresh from altering verification or signatures.
    const bundle = await verifiedPdfsForSignature(cfg, record, principal, true);
    const latest = await getByName(cfg, record.name);
    if (latest.modified !== record.modified) {
      const latestKeys = latest.required_document_keys || [];
      const latestVerified = latestKeys.filter(key => isLegalDocumentVerified(latest, key));
      return { ...result, record: latest, requiredDocumentKeys: latestKeys, verifiedDocumentKeys: latestVerified,
        pendingDocumentKeys: latestKeys.filter(key => !latestVerified.includes(key)),
        reason: "The Legal Review changed during validation. Refresh status before signing." };
    }
    const canSignDocumentKeys = requiredDocumentKeys.filter(key => {
      const request = bundle.documents[key]?.signatureRequest;
      return canStartLegalSignature(record, key) && (!request || request.signerId === actorId(principal)) &&
        (!request?.saveAttempt || Boolean(request.saveAttempt.failedAt));
    });
    const unconfirmedSave = requiredDocumentKeys.some(key => {
      const request = bundle.documents[key]?.signatureRequest;
      return !request?.completedAt && request?.saveAttempt && !request.saveAttempt.failedAt;
    });
    return { ...result, canSignDocumentKeys, eligible: canSignDocumentKeys.length > 0,
      reason: canSignDocumentKeys.length ? undefined : unconfirmedSave ? SIGNATURE_SAVE_PENDING_REASON : "A different signer owns the pending signature request.", checkedAt: now() };
  } catch (error) {
    const status = Number((error as { status?: number })?.status);
    return { ...result, reason: Number.isFinite(status) && status < 500 && error instanceof Error
      ? error.message : "Unable to verify current RFQ documents. Refresh status before signing." };
  }
}

export interface LegalDocumentIntegrityResult {
  record: LegalDocumentRecord;
  documents: Array<{ documentKey: LegalDocKey; status: "Verified" | "Failed" | "Unavailable"; documentHash?: string; signedFileHash?: string; message?: string }>;
}

async function inspectIntegrity(cfg: ErpAdminConfig, record: LegalDocumentRecord, principal: AccessPrincipal): Promise<LegalDocumentIntegrityResult> {
  const bundle = parseEsignBundle(record.esign_envelope);
  const documents: LegalDocumentIntegrityResult["documents"] = [];
  for (const key of record.required_document_keys || []) {
    const env = bundle.documents[key];
    if (!env?.signatureRequest?.completedAt || !env.signedFileUrl || !env.signedFileHash ||
        !env.signatures.some(signature => signature.role === "legal" && ["signed", "locked"].includes(signature.status))) {
      documents.push({ documentKey: key, status: "Unavailable", message: "Document has not been signed." });
      continue;
    }
    try {
      const source = await currentPdf(cfg, record, principal, key, true);
      if (env.signatureRequest.sourceHash !== source.hash || env.signatureRequest.sourceFileId !== source.file.name ||
          env.approvedHash !== source.hash || env.approvedFileId !== source.file.name) {
        throw new LegalReviewError("The signed source is not the verified PDF version.", 409);
      }
      const query = new URLSearchParams({ filters: JSON.stringify([
        ["attached_to_doctype", "=", DOCTYPE], ["attached_to_name", "=", record.name], ["file_url", "=", env.signedFileUrl],
      ]), fields: JSON.stringify(["name", "file_url", "is_private"]), limit_page_length: "2" });
      const rows = await erpFetch<Array<{ name: string; file_url: string; is_private: number }>>(cfg, `resource/File?${query}`);
      if (rows.length !== 1 || !rows[0].name || (env.signedFileId && env.signedFileId !== rows[0].name)) {
        throw new LegalReviewError("The private signed artifact is missing or ambiguous.", 409);
      }
      const artifact = await fetchErpFile({
        baseUrl: cfg.baseUrl, apiKey: cfg.key, apiSecret: cfg.secret, filePath: env.signedFileUrl, fileId: rows[0].name,
        authorizeFile: async file => {
          if (file.attached_to_doctype !== DOCTYPE || file.attached_to_name !== record.name || Number(file.is_private) !== 1) {
            throw new LegalReviewError("The signed artifact is not private or not attached to this review.", 403);
          }
        },
      });
      if (!artifact.ok || !artifact.contentType.toLowerCase().startsWith("application/pdf") ||
          artifact.buffer.subarray(0, 5).toString() !== "%PDF-" || digest(artifact.buffer) !== env.signedFileHash) {
        throw new LegalReviewError("The signed PDF failed SHA-256 integrity verification.", 409);
      }
      documents.push({ documentKey: key, status: "Verified", documentHash: source.hash, signedFileHash: digest(artifact.buffer) });
    } catch (error) {
      const status = Number((error as { status?: number })?.status);
      const unavailable = !Number.isFinite(status) || status >= 500;
      documents.push({ documentKey: key, status: unavailable ? "Unavailable" : "Failed",
        message: unavailable ? "Unable to verify current PDF bytes." : "Document Integrity: Failed. The source or signed PDF no longer matches its stored evidence." });
    }
  }
  return { record, documents };
}

/** Read-only check on reopen: always hashes source AND persisted signed bytes. */
export async function verifyLegalDocumentIntegrity(name: string, principal: AccessPrincipal): Promise<LegalDocumentIntegrityResult> {
  const { cfg, record } = await loadReview(name, principal, true);
  return inspectIntegrity(cfg, record, principal);
}

async function assertExecutedIntegrity(cfg: ErpAdminConfig, record: LegalDocumentRecord, principal: AccessPrincipal) {
  if (!isLegalReviewExecuted(record)) throw new LegalReviewError("Complete electronic signature on all required documents before Finance approval or Procurement.", 409);
  const result = await inspectIntegrity(cfg, record, principal);
  if (!result.documents.length || result.documents.some(document => document.status !== "Verified")) {
    throw new LegalReviewError("Document Integrity: Failed or unavailable. Approval and Procurement are blocked until the exact signed version is verified.", 409);
  }
}

export async function assertLegalReviewReadyForPurchaseOrder(name: string, principal: AccessPrincipal) {
  requireActorRoles(principal, ["procurement_team"]);
  const { cfg, record } = await loadReview(name, principal);
  if (record.review_status !== "Approved" || record.finance_status !== "Approved" || record.workflow_state !== "Completed") {
    throw new LegalReviewError("RFQ purchase orders require completed electronic signature and Finance approval.", 409);
  }
  await requireActiveRfq(cfg, record);
  await assertExecutedIntegrity(cfg, record, principal);
  return record;
}

export async function recordLegalDocumentViewed(name: string, key: LegalDocKey, hash: string, principal: AccessPrincipal) {
  requireActorRoles(principal, ["legal"]);
  const { cfg, record } = await loadReview(name, principal);
  const pdf = await currentPdf(cfg, record, principal, key);
  if (hash !== pdf.hash) throw new LegalReviewError("The rendered PDF is not the current version. Reload it.", 409);
  const bundle = parseEsignBundle(record.esign_envelope);
  const prior = bundle.documents[key];
  // Viewing is not approval, and repeated renders must not rewrite signature evidence.
  if (prior?.viewedAt && prior.documentHash === hash && prior.viewedBy === actorId(principal)) return record;
  const env = prior || createEmptyEnvelope({
    documentKey: key, documentName: pdf.file.file_name || key, documentNumber: name, documentHash: hash,
  });
  env.documentHash = hash; env.sourceFileId = pdf.file.name; env.sourceFileUrl = pdf.fileUrl;
  env.documentVersion = hash.slice(0, 12);
  env.viewedBy = actorId(principal); env.viewedAt = now(); env.reviewStartedAt ||= now();
  env.auditTrail.push({ id: randomUUID(), action: "document_opened", user: actorId(principal), at: now(), detail: `Rendered ${key}; File ${pdf.file.name}; SHA-256 ${hash}` });
  bundle.documents[key] = env;
  return saveVerified(cfg, record, { esign_envelope: JSON.stringify(bundle), [`${key}_viewed`]: 1 });
}

export async function saveLegalChecklist(name: string, items: unknown, principal: AccessPrincipal) {
  const { cfg, record } = await loadReview(name, principal);
  requireLegalStage(record);
  if (!Array.isArray(items) || items.length !== LEGAL_CHECKPOINT_IDS.length ||
      new Set(items.map(item => item?.id)).size !== LEGAL_CHECKPOINT_IDS.length ||
      !items.every(item => LEGAL_CHECKPOINT_IDS.includes(item?.id) &&
        ["Pending", "Compliant", "Non-Compliant", "Not Applicable", "Exception", "Requires Clarification"].includes(item?.status))) {
    throw new LegalReviewError("Invalid legal checklist.", 422);
  }
  const bundle = parseEsignBundle(record.esign_envelope);
  bundle.reviewChecklist = items.map(item => ({ ...item, reviewedBy: actorId(principal), reviewedAt: now() }));
  return saveVerified(cfg, record, { esign_envelope: JSON.stringify(bundle) });
}

export async function decideLegalDocumentReview(input: ReviewDecisionInput, principal: AccessPrincipal): Promise<LegalDocumentRecord> {
  requireActorRoles(principal, ["legal"]);
  const { cfg, record } = await loadReview(input.name, principal);
  if (input.status === "Approved" && record.review_status === "Approved" && record.workflow_state === "Finance Review") {
    await assertExecutedIntegrity(cfg, record, principal);
    return record; // Signature completion already performed the Legal handoff.
  }
  requireLegalStage(record);
  const reason = String(input.rejectionReason || input.comments || "").trim();
  if (!reason) throw new LegalReviewError("A decision reason is required.", 422);
  const bundle = parseEsignBundle(record.esign_envelope);
  if (input.status === "Approved") {
    await requireActiveRfq(cfg, record);
    await assertExecutedIntegrity(cfg, record, principal);
  } else if (input.status !== "Rejected") throw new LegalReviewError("Invalid decision.", 400);
  audit(bundle, principal, input.status === "Approved" ? "approval_completed" : "document_rejected", reason);
  const approvedOn = formatERPNextDatetime(new Date())!;
  const approved = input.status === "Approved";
  const saved = await saveVerified(cfg, record, {
    review_status: input.status, approved_by: actorId(principal), approved_on: approvedOn,
    legal_comments: input.comments || reason, rejection_reason: approved ? "" : reason,
    finance_status: approved ? "Pending" : "", finance_approved_by: "", finance_approved_on: "",
    workflow_state: approved ? "Finance Review" : "Rejected",
    current_owner: approved ? LDR_OWNERS.FINANCE : LDR_OWNERS.NONE,
    next_approver: approved ? LDR_OWNERS.FINANCE : LDR_OWNERS.NONE,
    esign_envelope: JSON.stringify(bundle),
  });
  if (approved) await syncRfqAfterLegalApprove(cfg, saved.rfq_name, actorId(principal), approvedOn);
  return saved;
}

export async function requestLegalChanges(name: string, comments: string, principal: AccessPrincipal) {
  const { cfg, record } = await loadReview(name, principal);
  requireLegalStage(record);
  if (typeof comments !== "string" || !comments.trim()) throw new LegalReviewError("Required changes must be specified.", 422);
  const updates = resetEvidence(record, principal, "Legal requested a revision.");
  const bundle = parseEsignBundle(updates.esign_envelope);
  audit(bundle, principal, "changes_requested", comments.trim());
  return saveVerified(cfg, record, {
    ...updates, current_owner: LDR_OWNERS.PROCUREMENT, next_approver: LDR_OWNERS.PROCUREMENT,
    legal_comments: comments.trim(), esign_envelope: JSON.stringify(bundle),
  });
}

export async function resubmitLegalReview(name: string, _resubmittedBy: string, note: string | undefined, principal: AccessPrincipal) {
  const { cfg, record, quotation } = await loadReview(name, principal);
  if (record.review_status !== "Rejected" && record.review_status !== "Pending") throw new LegalReviewError("Only rejected or returned reviews can be resubmitted.", 409);
  const updates: Record<string, unknown> = {
    ...resetEvidence(record, principal, "Resubmitted for Legal Review."),
    legal_comments: `Resubmitted by ${actorId(principal)}: ${note || ""}`, rejection_reason: "",
  };
  for (const key of LEGAL_DOC_KEYS) {
    const value = quotationFileFields[key].map(field => quotation[field]).find(value => typeof value === "string" && value.trim());
    // An explicit resubmission starts a new review set from the latest ERP quotation.
    updates[`${key}_file_url`] = value || "";
  }
  return saveVerified(cfg, record, updates);
}

export async function decideFinanceReview(input: FinanceDecisionInput, principal: AccessPrincipal) {
  requireActorRoles(principal, ["finance"]);
  const { cfg, record } = await loadReview(input.name, principal);
  if (record.review_status !== "Approved" || record.workflow_state !== "Finance Review" || record.finance_status !== "Pending") {
    throw new LegalReviewError("Finance approval is available only after all required electronic signatures are complete.", 409);
  }
  await requireActiveRfq(cfg, record);
  await assertExecutedIntegrity(cfg, record, principal);
  if (!["Approved", "Rejected"].includes(input.status)) throw new LegalReviewError("Invalid Finance decision.", 400);
  const reason = String(input.rejectionReason || input.comments || "").trim();
  if (input.status === "Rejected" && !reason) throw new LegalReviewError("A rejection reason is required.", 422);
  const bundle = parseEsignBundle(record.esign_envelope);
  audit(bundle, principal, "finance_decision", `${input.status}: ${reason}`);
  return saveVerified(cfg, record, {
    finance_status: input.status, finance_approved_by: actorId(principal), finance_approved_on: formatERPNextDatetime(new Date()),
    finance_comments: input.comments || "", finance_rejection_reason: input.status === "Rejected" ? reason : "",
    workflow_state: input.status === "Approved" ? "Completed" : "Rejected",
    current_owner: input.status === "Approved" ? LDR_OWNERS.PROCUREMENT_TEAM : LDR_OWNERS.NONE,
    next_approver: input.status === "Approved" ? LDR_OWNERS.PROCUREMENT_TEAM : LDR_OWNERS.NONE,
    esign_envelope: JSON.stringify(bundle),
  });
}

export async function resubmitFinanceReview(name: string, _by: string, note: string | undefined, principal: AccessPrincipal) {
  const { cfg, record } = await loadReview(name, principal);
  if (record.review_status !== "Approved" || record.finance_status !== "Rejected") throw new LegalReviewError("Only finance-rejected reviews can be resubmitted.", 409);
  return saveVerified(cfg, record, {
    finance_status: "Pending", finance_approved_by: "", finance_approved_on: "",
    finance_comments: `Resubmitted by ${actorId(principal)}: ${note || ""}`, finance_rejection_reason: "",
    workflow_state: "Finance Review", current_owner: LDR_OWNERS.FINANCE, next_approver: LDR_OWNERS.FINANCE,
  });
}

export async function updateLegalDocumentFlags(name: string, updates: Record<string, unknown>, principal: AccessPrincipal) {
  requireActorRoles(principal, ["legal"]);
  const { cfg, record } = await loadReview(name, principal);
  requireLegalStage(record);
  const safe: Record<string, unknown> = {};
  const bundle = parseEsignBundle(record.esign_envelope);
  for (const [field, value] of Object.entries(updates || {})) {
    const key = LEGAL_DOC_KEYS.find(key => field === `${key}_approved` || field === `${key}_note`);
    if (!key) throw new LegalReviewError("Only review notes and reviewed-document approvals can be updated here.", 400);
    if (field.endsWith("_approved")) {
      if (value !== 0 && value !== 1) throw new LegalReviewError("Invalid review flag.", 400);
      if (bundle.documents[key]?.signatureRequest) {
        throw new LegalReviewError("A signature has started for this version; request a revision to change verification.", 409);
      }
      if (value === 1) {
        const pdf = await currentPdf(cfg, record, principal, key);
        const env = bundle.documents[key];
        if (!env?.viewedAt || env.viewedBy !== actorId(principal) || env.documentHash !== pdf.hash) {
          throw new LegalReviewError("Render and inspect the current PDF before marking it reviewed.", 422);
        }
        env.approvedHash = pdf.hash; env.approvedFileId = pdf.file.name;
        env.approvedBy = actorId(principal); env.approvalTimestamp = now();
        env.approvalStatus = "Approved";
      } else {
        const env = bundle.documents[key];
        if (env) {
          delete env.approvedHash; delete env.approvedFileId; delete env.approvedBy;
          delete env.approvalTimestamp; env.approvalStatus = "Pending";
        }
      }
    } else if (typeof value !== "string") throw new LegalReviewError("Invalid note.", 400);
    safe[field] = value;
  }
  if (!Object.keys(safe).length) throw new LegalReviewError("No review updates provided.", 400);
  return saveVerified(cfg, record, { ...safe, esign_envelope: JSON.stringify(bundle) });
}

export async function beginLegalSignature(name: string, key: LegalDocKey, principal: AccessPrincipal) {
  requireActorRoles(principal, ["legal"]);
  const { cfg, record } = await loadReview(name, principal);
  if (!canStartLegalSignature(record, key)) {
    if (!areRequiredDocumentsVerified(record)) {
      throw new LegalReviewError("Verify all required legal documents before e-signature.", 409);
    }
    throw new LegalReviewError("Prerequisites for e-signature are not met.", 409);
  }
  const bundle = await verifiedPdfsForSignature(cfg, record, principal);
  const env = bundle.documents[key]!;
  if (env.signatureRequest && env.signatureRequest.sourceHash === env.documentHash) {
    if (env.signatureRequest.signerId !== actorId(principal)) throw new LegalReviewError("A different signer owns this signature request.", 409);
    if (env.signatureRequest.saveAttempt && !env.signatureRequest.saveAttempt.failedAt) throw new LegalReviewError(SIGNATURE_SAVE_PENDING_REASON, 409);
    return record;
  }
  if (env.signatures.length) throw new LegalReviewError("Executed signatures cannot be replaced.", 409);
  env.signatureRequest = { id: randomUUID(), sourceHash: env.documentHash, sourceFileId: env.sourceFileId || "", signerId: actorId(principal), startedAt: now() };
  env.auditTrail.push({ id: randomUUID(), action: "signature_initiated", user: actorId(principal), at: now(), detail: `Request ${env.signatureRequest.id}; ${env.documentHash}` });
  return saveVerified(cfg, record, { esign_envelope: JSON.stringify(bundle) });
}

// Serializes retries in one process; ERP's modified check also rejects stale writers.
const signatureWrites = new Map<string, Promise<LegalDocumentRecord>>();
export async function completeLegalSignature(name: string, key: LegalDocKey, requestId: string, signature: LegalEsignSignature, principal: AccessPrincipal) {
  const lockKey = `${name}:${key}:${requestId}`;
  if (signatureWrites.has(lockKey)) throw new LegalReviewError("Signature save is in progress. Refresh before retrying.", 409);
  const work = completeSignature(name, key, requestId, signature, principal);
  signatureWrites.set(lockKey, work);
  try { return await work; } finally { signatureWrites.delete(lockKey); }
}

async function completeSignature(name: string, key: LegalDocKey, requestId: string, signature: LegalEsignSignature, principal: AccessPrincipal) {
  requireActorRoles(principal, ["legal"]);
  const { cfg, record } = await loadReview(name, principal);
  const bundleCheck = parseEsignBundle(record.esign_envelope);
  const existingEnv = bundleCheck.documents[key];
  if (existingEnv?.signatureRequest?.id === requestId &&
      existingEnv.signatureRequest.completedAt &&
      existingEnv.signedFileUrl &&
      existingEnv.signatures.length) {
    if (existingEnv.signatureRequest.signerId !== actorId(principal)) {
      throw new LegalReviewError("A different signer owns this signature request.", 409);
    }
    const integrity = await inspectIntegrity(cfg, record, principal);
    if (integrity.documents.find(document => document.documentKey === key)?.status !== "Verified") {
      throw new LegalReviewError("Document Integrity: Failed. The completed signature cannot be confirmed.", 409);
    }
    return record;
  }
  if (!canStartLegalSignature(record, key)) {
    if (!areRequiredDocumentsVerified(record)) {
      throw new LegalReviewError("Verify all required legal documents before e-signature.", 409);
    }
    throw new LegalReviewError("Prerequisites for e-signature are not met.", 409);
  }
  const bundle = await verifiedPdfsForSignature(cfg, record, principal);
  const env = bundle.documents[key]!;
  const request = env.signatureRequest;
  const expectedHash = env.documentHash;
  if (!request || request.id !== requestId || request.signerId !== actorId(principal) ||
      request.sourceHash !== expectedHash) {
    throw new LegalReviewError("Signature request does not match the verified version and signer.", 409);
  }
  if (request.completedAt && env.signedFileUrl && env.signatures.length) return record;
  if (request.saveAttempt && !request.saveAttempt.failedAt) {
    throw new LegalReviewError(SIGNATURE_SAVE_PENDING_REASON, 409);
  }
  const pdf = await currentPdf(cfg, record, principal, key);
  const p = signature?.placement;
  if (typeof signature?.typedName !== "string" || !signature.typedName.trim() || signature.typedName.length > 120 ||
      !p || !Number.isInteger(p.page) || p.page < 1 || p.page > pdf.pages ||
      ![p.xNorm, p.yNorm, p.widthNorm, p.heightNorm].every(n => Number.isFinite(n) && n > 0 && n <= 1)) {
    throw new LegalReviewError("Invalid typed signature or placement.", 422);
  }
  // Persist canonical signer/time/placement before creating an artifact. Retries
  // reuse this intent and deterministic filename; clients cannot supply signed bytes.
  const canonical: LegalEsignSignature = env.signatures[0] || {
    ...signature, id: request.id, sequence: 1, reviewerId: actorId(principal), reviewerName: actorId(principal),
    role: "legal", signedAt: request.startedAt, typedName: signature.typedName.trim(), status: "pending",
  };
  canonical.signedAt = request.startedAt;
  env.signatures = [canonical];
  const attemptId = randomUUID();
  request.saveAttempt = { id: attemptId, startedAt: now() };
  const reserved = await saveVerified(cfg, record, { esign_envelope: JSON.stringify(bundle), esign_status: "unsigned" });
  let uploadOutcomeUnknown = false;
  try {
  const signed = await burnTypedSignatureIntoPdf(new Uint8Array(pdf.bytes).buffer, canonical.typedName, "Legal Reviewer", new Date(canonical.signedAt), canonical.placement);
  const signedHash = digest(signed);
  const fileName = `legal-${request.id}.pdf`;
  const params = new URLSearchParams({
    filters: JSON.stringify([["attached_to_doctype", "=", DOCTYPE], ["attached_to_name", "=", name], ["file_name", "=", fileName]]),
    fields: JSON.stringify(["name", "file_url", "is_private"]), limit_page_length: "2",
  });
  const existing = await erpFetch<Array<{ name: string; file_url: string; is_private: number }>>(cfg, `resource/File?${params}`);
  if (existing.length > 1) throw new LegalReviewError("Multiple artifacts exist for this signature request; manual verification required.", 409);
  let signedFile = existing[0];
  if (!signedFile) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(signed)], { type: "application/pdf" }), fileName);
    form.append("is_private", "1"); form.append("doctype", DOCTYPE); form.append("docname", name);
    uploadOutcomeUnknown = true;
    const response = await fetch(`${cfg.baseUrl}/api/method/upload_file`, {
      method: "POST", headers: { Authorization: `token ${cfg.key}:${cfg.secret}` }, body: form,
    });
    if (!response.ok) {
      // A gateway/server timeout may have committed an upload upstream.
      uploadOutcomeUnknown = response.status >= 500;
      throw new LegalReviewError("Unable to confirm the signed PDF upload. Refresh before retrying.", 502);
    }
    const payload = await response.json() as { message?: { name: string; file_url: string; is_private: number } };
    if (!payload.message?.name) throw new LegalReviewError("Signed PDF upload was not confirmed.", 502);
    signedFile = payload.message;
    uploadOutcomeUnknown = false;
  }
  const savedFile = await erpFetch<Record<string, unknown>>(cfg, resource("File", signedFile.name));
  if (Number(savedFile.is_private) !== 1 || savedFile.attached_to_doctype !== DOCTYPE || savedFile.attached_to_name !== name) {
    throw new LegalReviewError("The signed artifact is not a private attachment of this review.", 409);
  }
  const verifiedBytes = await fetchErpFile({
    baseUrl: cfg.baseUrl, apiKey: cfg.key, apiSecret: cfg.secret, filePath: String(savedFile.file_url), fileId: signedFile.name,
    authorizeFile: async file => {
      if (file.attached_to_doctype !== DOCTYPE || file.attached_to_name !== name || !file.is_private) throw new LegalReviewError("Invalid signature artifact.", 403);
    },
  });
  if (!verifiedBytes.ok || digest(verifiedBytes.buffer) !== signedHash) throw new LegalReviewError("The signed artifact failed integrity verification.", 409);
  // Re-check source and workflow after upload, before recording execution.
  const fresh = await getByName(cfg, name);
  if (fresh.modified !== reserved.modified) throw new LegalReviewError("The review changed while signing. Refresh before retrying.", 409);
  await verifiedPdfsForSignature(cfg, fresh, principal);
  canonical.status = "locked"; env.status = "locked"; env.locked = true;
  env.signedFileUrl = String(savedFile.file_url); env.signedFileHash = signedHash; env.signedFileId = signedFile.name;
  env.signatureMethod = "typed_pdf"; request.completedAt = now();
  env.auditTrail.push({ id: randomUUID(), action: "signature_created", user: actorId(principal), at: now(), detail: `Completed request ${request.id}; source ${request.sourceHash}; signed ${signedHash}` });
  const complete = attachedKeys(record).every(docKey => bundle.documents[docKey]?.signatureRequest?.completedAt);
  if (complete) await assertExecutedIntegrity(cfg, { ...fresh, esign_envelope: JSON.stringify(bundle) }, principal);
  const saved = await saveVerified(cfg, fresh, {
    esign_envelope: JSON.stringify(bundle), esign_status: complete ? "signed" : "unsigned",
    esign_document_hash: pdf.hash, esign_signed_file_url: env.signedFileUrl,
    esign_signed_by: actorId(principal), esign_signed_on: formatERPNextDatetime(canonical.signedAt),
    ...(complete ? {
      review_status: "Approved", approved_by: actorId(principal), approved_on: formatERPNextDatetime(new Date()),
      finance_status: "Pending", finance_approved_by: "", finance_approved_on: "",
      finance_comments: "", finance_rejection_reason: "", workflow_state: "Finance Review",
      current_owner: LDR_OWNERS.FINANCE, next_approver: LDR_OWNERS.FINANCE,
    } : {}),
  });
  if (complete) await syncRfqAfterLegalApprove(cfg, saved.rfq_name, actorId(principal), saved.approved_on!);
  return saved;
  } catch (error) {
    // Known failures can be retried with the same request/artifact. An unknown
    // upload outcome stays reserved: never risk producing a second signed file.
    if (!uploadOutcomeUnknown) {
      const latest = await getByName(cfg, name);
      const latestBundle = parseEsignBundle(latest.esign_envelope);
      const latestRequest = latestBundle.documents[key]?.signatureRequest;
      if (latestRequest?.saveAttempt?.id === attemptId && !latestRequest.completedAt) {
        latestRequest.saveAttempt.failedAt = now();
        await saveVerified(cfg, latest, { esign_envelope: JSON.stringify(latestBundle), esign_status: "unsigned" });
      }
    }
    throw error;
  }
}
