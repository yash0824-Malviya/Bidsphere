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
import { formatERPNextDatetime } from "../src/utils/erpNextDate";

const DOCTYPE = "Legal Document Review";

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
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
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

/* ────────────────────────────────────────────────────────────────────────
 *  Create — gated on "Supplier Selected" (called once per RFQ, ever)
 * ──────────────────────────────────────────────────────────────────────── */

export async function createLegalDocumentReview(
  input: CreateLegalReviewInput
): Promise<{ created: boolean; record: LegalDocumentRecord }> {
  const cfg = readErpAdminConfig();

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
    workflow_state: "Pending Review",
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

  // Fetching first both validates the record exists and gives a clean 404.
  await getByName(cfg, name);

  const body: Record<string, unknown> = {
    review_status: input.status,
    workflow_state: input.status,
    approved_by: input.reviewedBy,
    approved_on: formatERPNextDatetime(new Date()),
    legal_comments: input.comments ?? "",
    rejection_reason: input.status === "Rejected" ? rejectionReason : "",
  };

  // The moment Legal approves, Finance Review becomes actionable on this
  // SAME record — no separate document, no client-side transition. A Legal
  // rejection never enters the Finance funnel, so finance_status stays unset.
  if (input.status === "Approved") {
    body.finance_status = "Pending";
  }

  const updated = await erpFetch<LegalDocumentRecord>(
    cfg,
    `resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(name)}`,
    { method: "PUT", body }
  );

  // eslint-disable-next-line no-console
  console.log(`[legal-review] ${input.status} ${name} by ${input.reviewedBy}`);
  return updated;
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
        workflow_state: "Pending",
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
        finance_rejection_reason: input.status === "Rejected" ? rejectionReason : "",
      },
    }
  );

  // eslint-disable-next-line no-console
  console.log(`[legal-review] Finance ${input.status} ${name} by ${input.reviewedBy}`);
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

  return erpFetch<LegalDocumentRecord>(
    cfg,
    `resource/${encodeURIComponent(DOCTYPE)}/${encodeURIComponent(name)}`,
    { method: "PUT", body: safeUpdates }
  );
}
