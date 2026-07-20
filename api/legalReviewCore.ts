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
  return erpFetch<LegalDocumentRecord>(
    cfg,
    `resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(name)}`
  );
}

/**
 * Privileged workflow list — the ONLY authoritative read path for Legal and
 * Finance queues. Uses server ERP credentials + an explicit field list so
 * browser permission quirks / `fields=["*"]` failures can never empty the
 * Finance queue after a successful Legal approve.
 */
export async function listWorkflowRecords(options?: {
  limit?: number;
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

  return Array.isArray(rows) ? rows : [];
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
    return { created: false, record: existing };
  }

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
  reviewedBy: string;
  /** Reviewer's comments — recorded for both Approve and Reject. */
  comments?: string;
  /** Required for Reject; ignored (cleared) for Approve. */
  rejectionReason?: string;
}

export async function decideLegalDocumentReview(
  input: ReviewDecisionInput
): Promise<LegalDocumentRecord> {
  const cfg = readErpAdminConfig();

  const name = (input.name ?? "").trim();
  if (!name) throw new LegalReviewError("name is required.", 400);
  if (input.status !== "Approved" && input.status !== "Rejected") {
    throw new LegalReviewError('status must be "Approved" or "Rejected".', 400);
  }
  if (!input.reviewedBy) throw new LegalReviewError("reviewedBy is required.", 400);

  const rejectionReason = (input.rejectionReason ?? input.comments ?? "").trim();
  if (input.status === "Rejected" && !rejectionReason) {
    throw new LegalReviewError("rejectionReason is required to reject a review.", 400);
  }

  // Self-heal DocType schema before writing Finance handoff fields.
  await ensureLegalDocumentReviewSchema(cfg);

  // Fetching first both validates the record exists and gives a clean 404.
  const existing = await getByName(cfg, name);

  // Approve requires a placed electronic signature (type signature).
  if (input.status === "Approved") {
    const status = String(existing.esign_status ?? "").toLowerCase();
    const hasEnvelopeSig =
      status === "signed" ||
      status === "locked" ||
      (typeof existing.esign_envelope === "string" &&
        /"role"\s*:\s*"legal"/.test(existing.esign_envelope) &&
        /"status"\s*:\s*"(signed|locked)"/.test(existing.esign_envelope));
    // Also accept per-doc approved flags set by a successful client burn-in
    // when esign_* DocType fields are not yet provisioned on ERPNext.
    const checklistSigned = Boolean(
      existing.terms_approved ||
        existing.warranty_approved ||
        existing.insurance_approved,
    );
    if (!hasEnvelopeSig && !existing.esign_signed_by && !checklistSigned) {
      throw new LegalReviewError(
        "Please sign the document before approval.",
        400,
      );
    }
  }

  const approvedOn = formatERPNextDatetime(new Date());
  const body: Record<string, unknown> = {
    review_status: input.status,
    approved_by: input.reviewedBy,
    approved_on: approvedOn,
    legal_comments: input.comments ?? "",
    rejection_reason: input.status === "Rejected" ? rejectionReason : "",
  };

  // The moment Legal approves, Finance Review becomes actionable on this
  // SAME record — no separate DocType. Rejection never enters Finance.
  if (input.status === "Approved") {
    body.finance_status = FINANCE_REVIEW_STATUS.PENDING;
    body.workflow_state = LDR_WORKFLOW_STATE.FINANCE_REVIEW;
    body.current_owner = LDR_OWNERS.FINANCE;
    body.next_approver = LDR_OWNERS.FINANCE;
    body.esign_status = "locked";
    // Lock envelope JSON when present (best-effort; ignore parse errors).
    if (existing.esign_envelope) {
      try {
        const env = JSON.parse(existing.esign_envelope) as {
          locked?: boolean;
          status?: string;
          approvalStatus?: string;
          approvalTimestamp?: string;
          signatures?: Array<{ status?: string }>;
          auditTrail?: unknown[];
        };
        env.locked = true;
        env.status = "locked";
        env.approvalStatus = "Approved";
        env.approvalTimestamp = new Date().toISOString();
        if (Array.isArray(env.signatures)) {
          env.signatures = env.signatures.map((s) => ({
            ...s,
            status: "locked",
          }));
        }
        if (Array.isArray(env.auditTrail)) {
          env.auditTrail.push(
            {
              id: `aud_${Date.now()}`,
              action: "approval_completed",
              user: input.reviewedBy,
              at: new Date().toISOString(),
              detail: "Legal Approved",
            },
            {
              id: `aud_${Date.now() + 1}`,
              action: "moved_to_finance_review",
              user: input.reviewedBy,
              at: new Date().toISOString(),
              detail: "Moved to Finance Review — Finance queue activated",
            },
          );
        }
        body.esign_envelope = JSON.stringify(env);
      } catch {
        /* keep prior envelope */
      }
    }
  } else {
    body.workflow_state = LDR_WORKFLOW_STATE.REJECTED;
    body.current_owner = LDR_OWNERS.NONE;
    body.next_approver = LDR_OWNERS.NONE;
    if (existing.esign_envelope) {
      try {
        const env = JSON.parse(existing.esign_envelope) as {
          auditTrail?: unknown[];
          approvalStatus?: string;
        };
        if (Array.isArray(env.auditTrail)) {
          env.auditTrail.push({
            id: `aud_${Date.now()}`,
            action: "document_rejected",
            user: input.reviewedBy,
            at: new Date().toISOString(),
          });
        }
        env.approvalStatus = "Rejected";
        body.esign_envelope = JSON.stringify(env);
      } catch {
        /* ignore */
      }
    }
  }

  await erpFetch<LegalDocumentRecord>(
    cfg,
    `resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(name)}`,
    { method: "PUT", body },
  );

  // Re-read from ERPNext — never trust a silent field drop.
  let verified = await getByName(cfg, name);

  if (input.status === "Approved") {
    if (verified.review_status !== LEGAL_REVIEW_STATUS.APPROVED) {
      throw new LegalReviewError(
        "Legal approval did not persist review_status=Approved on Legal Document Review.",
        500,
      );
    }

    const handoffOk =
      verified.finance_status === FINANCE_REVIEW_STATUS.PENDING &&
      verified.workflow_state === LDR_WORKFLOW_STATE.FINANCE_REVIEW;

    if (!handoffOk) {
      // eslint-disable-next-line no-console
      console.warn(
        `[legal-review] Finance handoff incomplete after approve on ${name}; retrying`,
        {
          finance_status: verified.finance_status,
          workflow_state: verified.workflow_state,
          current_owner: verified.current_owner,
          next_approver: verified.next_approver,
        },
      );
      // Force schema again (cache may have been stale) and rewrite handoff fields.
      schemaEnsurePromise = null;
      await ensureLegalDocumentReviewSchema(cfg);
      await erpFetch(
        cfg,
        `resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(name)}`,
        {
          method: "PUT",
          body: {
            finance_status: FINANCE_REVIEW_STATUS.PENDING,
            workflow_state: LDR_WORKFLOW_STATE.FINANCE_REVIEW,
            current_owner: LDR_OWNERS.FINANCE,
            next_approver: LDR_OWNERS.FINANCE,
          },
        },
      );
      verified = await getByName(cfg, name);
    }

    if (verified.finance_status !== FINANCE_REVIEW_STATUS.PENDING) {
      throw new LegalReviewError(
        "Legal approval saved, but Finance handoff failed: finance_status was not set to Pending. " +
          "Ensure the Legal Document Review DocType has a finance_status Select field " +
          `(options: ${FINANCE_REVIEW_STATUS.PENDING}/${FINANCE_REVIEW_STATUS.APPROVED}/${FINANCE_REVIEW_STATUS.REJECTED}). ` +
          "Run: node scripts/setup-legal-review-doctype.mjs",
        500,
      );
    }

    if (verified.workflow_state !== LDR_WORKFLOW_STATE.FINANCE_REVIEW) {
      throw new LegalReviewError(
        "Legal approval saved, but workflow_state was not set to Finance Review. " +
          `Got: ${verified.workflow_state ?? "(empty)"}.`,
        500,
      );
    }

    await syncRfqAfterLegalApprove(
      cfg,
      verified.rfq_name,
      input.reviewedBy,
      approvedOn,
    );

    // eslint-disable-next-line no-console
    console.log(
      `[legal-review] Approved ${name} by ${input.reviewedBy} → Finance Pending ` +
        `(workflow=${verified.workflow_state}, owner=${verified.current_owner}, next=${verified.next_approver})`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.log(`[legal-review] Rejected ${name} by ${input.reviewedBy}`);
  }

  return verified;
}

/* ────────────────────────────────────────────────────────────────────────
 *  Finance Review decision — updates the SAME record's finance_* fields.
 *  Gated on review_status === "Approved": Finance can never act on an RFQ
 *  that Legal hasn't (yet) approved.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Resets a legal-rejected record back to "Pending" for resubmission after
 * Procurement edits the RFQ. Mirrors `resubmitFinanceReview` below — this is
 * the counterpart that was missing, which previously left Procurement's
 * "Resubmit RFQ" button writing only to legacy RFQ custom fields
 * (`rfqApprovalWorkflow.ts`) while the actual Legal Document Review record
 * that Legal's queue reads from stayed stuck on "Rejected" forever.
 */
export async function resubmitLegalReview(
  name: string,
  resubmittedBy: string,
  note?: string
): Promise<LegalDocumentRecord> {
  const cfg = readErpAdminConfig();
  if (!name) throw new LegalReviewError("name is required.", 400);

  const existing = await getByName(cfg, name);
  if (existing.review_status !== "Rejected") {
    throw new LegalReviewError("Only legally-rejected reviews can be resubmitted.", 400);
  }

  const remark = (note ?? "").trim() || "RFQ resubmitted for legal review after rejection.";
  const updated = await erpFetch<LegalDocumentRecord>(
    cfg,
    `resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      body: {
        review_status: "Pending",
        workflow_state: LDR_WORKFLOW_STATE.PENDING_REVIEW,
        finance_status: "",
        current_owner: LDR_OWNERS.LEGAL,
        next_approver: LDR_OWNERS.LEGAL,
        approved_by: "",
        approved_on: "",
        legal_comments: `Resubmitted by ${resubmittedBy}: ${remark}`,
        rejection_reason: "",
      },
    }
  );

  // eslint-disable-next-line no-console
  console.log(`[legal-review] Legal resubmit ${name} by ${resubmittedBy}`);
  return updated;
}

export interface FinanceDecisionInput {
  name: string;
  status: "Approved" | "Rejected";
  reviewedBy: string;
  /** Finance reviewer's comments — captured for both Approve and Reject. */
  comments?: string;
  /** Required for Reject; ignored (cleared) for Approve. */
  rejectionReason?: string;
}

export async function decideFinanceReview(
  input: FinanceDecisionInput
): Promise<LegalDocumentRecord> {
  const cfg = readErpAdminConfig();

  const name = (input.name ?? "").trim();
  if (!name) throw new LegalReviewError("name is required.", 400);
  if (input.status !== "Approved" && input.status !== "Rejected") {
    throw new LegalReviewError('status must be "Approved" or "Rejected".', 400);
  }
  if (!input.reviewedBy) throw new LegalReviewError("reviewedBy is required.", 400);

  const comments = (input.comments ?? "").trim();
  const rejectionReason = (input.rejectionReason ?? input.comments ?? "").trim();
  if (input.status === "Rejected" && !rejectionReason) {
    throw new LegalReviewError("rejectionReason is required to reject a finance review.", 400);
  }

  const existing = await getByName(cfg, name);
  if (existing.review_status !== "Approved") {
    throw new LegalReviewError(
      "Finance review requires Legal approval first. Current legal review_status: " +
        `${existing.review_status}.`,
      400
    );
  }

  await ensureLegalDocumentReviewSchema(cfg);

  const updated = await erpFetch<LegalDocumentRecord>(
    cfg,
    `resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      body: {
        finance_status: input.status,
        finance_approved_by: input.reviewedBy,
        finance_approved_on: formatERPNextDatetime(new Date()),
        finance_comments: comments,
        finance_rejection_reason:
          input.status === "Rejected" ? rejectionReason : "",
        workflow_state:
          input.status === "Approved"
            ? LDR_WORKFLOW_STATE.COMPLETED
            : LDR_WORKFLOW_STATE.REJECTED,
        current_owner:
          input.status === "Approved" ? LDR_OWNERS.PROCUREMENT : LDR_OWNERS.NONE,
        next_approver:
          input.status === "Approved" ? LDR_OWNERS.PROCUREMENT : LDR_OWNERS.NONE,
      },
    }
  );

  // eslint-disable-next-line no-console
  console.log(`[legal-review] Finance ${input.status} ${name} by ${input.reviewedBy}`, {
    workflow_state: updated.workflow_state,
    finance_status: updated.finance_status,
    current_owner: updated.current_owner,
    next_approver: updated.next_approver,
  });
  return updated;
}

/**
 * Resets a finance-rejected record back to "Pending" so Procurement/Finance
 * can resubmit it for another finance decision — the SAME record, never a
 * new one. Only valid when the record is currently Finance-Rejected.
 */
export async function resubmitFinanceReview(
  name: string,
  resubmittedBy: string,
  note?: string
): Promise<LegalDocumentRecord> {
  const cfg = readErpAdminConfig();
  if (!name) throw new LegalReviewError("name is required.", 400);

  const existing = await getByName(cfg, name);
  if (existing.review_status !== "Approved") {
    throw new LegalReviewError("Legal approval is required before finance resubmission.", 400);
  }
  if (existing.finance_status !== "Rejected") {
    throw new LegalReviewError("Only finance-rejected reviews can be resubmitted.", 400);
  }

  const remark = (note ?? "").trim() || "RFQ resubmitted for finance review after rejection.";
  const updated = await erpFetch<LegalDocumentRecord>(
    cfg,
    `resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      body: {
        finance_status: "Pending",
        finance_approved_by: "",
        finance_approved_on: "",
        finance_comments: `Resubmitted by ${resubmittedBy}: ${remark}`,
        finance_rejection_reason: "",
        workflow_state: LDR_WORKFLOW_STATE.FINANCE_REVIEW,
        current_owner: LDR_OWNERS.FINANCE,
        next_approver: LDR_OWNERS.FINANCE,
      },
    }
  );

  // eslint-disable-next-line no-console
  console.log(`[legal-review] Finance resubmit ${name} by ${resubmittedBy}`);
  return updated;
}

/* ────────────────────────────────────────────────────────────────────────
 *  Flag / note updates — everything EXCEPT the review decision itself
 * ──────────────────────────────────────────────────────────────────────── */

const ALLOWED_FLAG_FIELDS = new Set([
  "terms_file_url",
  "terms_note",
  "terms_viewed",
  "terms_approved",
  "warranty_file_url",
  "warranty_note",
  "warranty_viewed",
  "warranty_approved",
  "insurance_file_url",
  "insurance_note",
  "insurance_viewed",
  "insurance_approved",
  "esign_envelope",
  "esign_status",
  "esign_document_hash",
  "esign_signed_file_url",
  "esign_signed_by",
  "esign_signed_on",
]);

export async function updateLegalDocumentFlags(
  name: string,
  updates: Record<string, unknown>
): Promise<LegalDocumentRecord> {
  const cfg = readErpAdminConfig();
  if (!name) throw new LegalReviewError("name is required.", 400);

  const safeUpdates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates ?? {})) {
    if (ALLOWED_FLAG_FIELDS.has(key)) safeUpdates[key] = value;
  }

  if (Object.keys(safeUpdates).length === 0) {
    throw new LegalReviewError("No updatable fields provided.", 400);
  }

  // Datetime columns (e.g. esign_signed_on) must never receive ISO-8601.
  const sanitized = sanitizeErpPayloadDates(safeUpdates);

  return erpFetch<LegalDocumentRecord>(
    cfg,
    `resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(name)}`,
    { method: "PUT", body: sanitized }
  );
}
