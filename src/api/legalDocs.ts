import erpnextClient, { buildResourceUrl } from "./erpnext";

const DOCTYPE = "Legal Document Review";

/**
 * Legal Document Review is an ERPNext business document. Every WRITE
 * (create, approve, reject, or field update) goes through the backend
 * gateway at `/api/legal-review/*` — never a direct POST/PUT to
 * `/api/resource/Legal Document Review` from the browser.
 *
 *   - Production (Vercel): api/legal-review.ts
 *   - Local dev (`npm run dev`): vite.config.ts dev middleware
 *
 * Both adapters call the exact same `api/legalReviewCore.ts` module, which
 * holds the privileged ERPNext API credentials (never shipped to the
 * browser bundle), enforces field whitelisting, forces `review_status` to
 * "Pending" on create, and de-duplicates by `rfq_name` (backed by a
 * DB-level unique constraint on that field in ERPNext).
 *
 * Reads are unaffected — `getLegalDocs` / `getAllLegalDocs` still read
 * directly from ERPNext, which remains the single source of truth.
 */
async function callLegalReviewApi<T>(action: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/legal-review/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

  let json: { success?: boolean; error?: string } & Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    json = {};
  }

  if (!res.ok || json.success === false) {
    const message = json.error || `Legal review request failed (${res.status}).`;
    // eslint-disable-next-line no-console
    console.error(`[LegalDocs] backend action="${action}" FAILED:`, message, body);
    throw new Error(message);
  }

  return json as T;
}

export interface LegalDocumentSet {
  name?: string;
  /** ERPNext's own last-modified timestamp — used to sort History by recency. */
  modified?: string;
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
  /** JSON-encoded array of { item_code, item_name, qty, uom, rate, amount } */
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
  /** Set only once review_status !== "Pending" — the reviewer's identity. */
  approved_by?: string;
  /** Set only once review_status !== "Pending" — server-stamped decision time. */
  approved_on?: string;
  /** Reviewer's comments — captured on both Approve and Reject. */
  legal_comments?: string;
  /** Required context for a Rejected decision; empty when Approved. */
  rejection_reason?: string;
  /**
   * Finance Review verdict on this SAME record — no separate Finance
   * DocType exists. Unset until Legal approves; the backend stamps this
   * "Pending" automatically the moment `review_status` becomes "Approved".
   */
  finance_status?: "Pending" | "Approved" | "Rejected" | "";
  /** Set only once finance_status !== "Pending" — the Finance reviewer's identity. */
  finance_approved_by?: string;
  /** Set only once finance_status !== "Pending" — server-stamped decision time. */
  finance_approved_on?: string;
  /** Finance reviewer's comments — captured on both Approve and Reject. */
  finance_comments?: string;
  /** Required context for a finance Rejected decision; empty when Approved. */
  finance_rejection_reason?: string;
}

export interface LegalDocumentItemSummary {
  item_code: string;
  item_name?: string;
  qty: number;
  uom?: string;
  rate: number;
  amount?: number;
}

export type LegalDocFlagField =
  | "terms_viewed"
  | "terms_approved"
  | "warranty_viewed"
  | "warranty_approved"
  | "insurance_viewed"
  | "insurance_approved";

function resourceBase(): string {
  return buildResourceUrl(DOCTYPE);
}

/**
 * Extracts every diagnostic scrap Frappe can return for a failed request so
 * failures are never silently swallowed — full traceback, exception type,
 * and server messages are always logged together.
 */
function logFullFailure(context: string, err: unknown, payload?: unknown): string {
  const ax = err as {
    message?: string;
    response?: {
      status?: number;
      data?: {
        exc?: string;
        exc_type?: string;
        message?: string;
        _server_messages?: string;
        exception?: string;
      };
    };
  };
  const data = ax.response?.data;
  let traceback: string | undefined;
  if (data?.exc) {
    try {
      const parsed = JSON.parse(data.exc);
      traceback = Array.isArray(parsed) ? parsed.join("\n") : String(parsed);
    } catch {
      traceback = data.exc;
    }
  }

  // eslint-disable-next-line no-console
  console.error(`[LegalDocs] ${context} FAILED`, {
    status: ax.response?.status,
    exc_type: data?.exc_type,
    message: data?.message ?? data?.exception,
    server_messages: data?._server_messages,
    traceback,
    payload,
  });

  return (
    data?.message ||
    data?.exception ||
    ax.message ||
    (err instanceof Error ? err.message : String(err)) ||
    "Unknown ERPNext error"
  );
}

/* ────────────────────────────────────────────────────────────────────────
 *  Reads — ERPNext remains the single source of truth
 * ──────────────────────────────────────────────────────────────────────── */

export const getLegalDocs = async (
  sqName: string
): Promise<LegalDocumentSet | null> => {
  if (!sqName) return null;
  try {
    const list = (await erpnextClient.get(resourceBase(), {
      params: {
        filters: JSON.stringify([["sq_name", "=", sqName]]),
        fields: JSON.stringify(["name"]),
        limit_page_length: 1,
      },
    })) as Array<{ name: string }>;

    if (!Array.isArray(list) || list.length === 0) return null;

    const full = (await erpnextClient.get(
      `${resourceBase()}/${encodeURIComponent(list[0].name)}`
    )) as LegalDocumentSet;
    return full ?? null;
  } catch (err: unknown) {
    logFullFailure(`getLegalDocs(${sqName})`, err);
    return null;
  }
};

export const getLegalDocsByRfq = async (
  rfqName: string
): Promise<LegalDocumentSet | null> => {
  if (!rfqName) return null;
  try {
    const list = (await erpnextClient.get(resourceBase(), {
      params: {
        filters: JSON.stringify([["rfq_name", "=", rfqName]]),
        fields: JSON.stringify(["name"]),
        limit_page_length: 1,
      },
    })) as Array<{ name: string }>;

    if (!Array.isArray(list) || list.length === 0) return null;

    const full = (await erpnextClient.get(
      `${resourceBase()}/${encodeURIComponent(list[0].name)}`
    )) as LegalDocumentSet;
    return full ?? null;
  } catch (err: unknown) {
    logFullFailure(`getLegalDocsByRfq(${rfqName})`, err);
    return null;
  }
};

export const getAllLegalDocs = async (): Promise<LegalDocumentSet[]> => {
  try {
    const rows = (await erpnextClient.get(resourceBase(), {
      params: {
        fields: JSON.stringify(["*"]),
        limit_page_length: 200,
        // "modified desc" so History (Approved/Rejected) surfaces the most
        // recently decided reviews first — matches the required query:
        // SELECT ... WHERE review_status IN ("Approved","Rejected")
        // ORDER BY modified DESC.
        order_by: "modified desc",
      },
    })) as LegalDocumentSet[];
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    logFullFailure("getAllLegalDocs", err);
    return [];
  }
};

export interface GetLegalDocsByStatusOptions {
  status: "Pending" | "Approved" | "Rejected";
  orderBy?: string;
  limit?: number;
}

/**
 * Runs a DEDICATED, server-side-filtered ERPNext query for a single
 * `review_status` — e.g. `SELECT * FROM tabLegal Document Review WHERE
 * review_status = "Approved" ORDER BY approved_on DESC`. Used so the Legal
 * Dashboard's "Recent Approved/Rejected" panels, the KPI counters, and each
 * tab on the "All Reviews" list page are all backed by their own explicit
 * ERPNext fetch — never by client-side filtering of one shared array — so
 * a count can never silently drift from the list it describes.
 */
export const getLegalDocsByStatus = async (
  options: GetLegalDocsByStatusOptions
): Promise<LegalDocumentSet[]> => {
  try {
    const rows = (await erpnextClient.get(resourceBase(), {
      params: {
        fields: JSON.stringify(["*"]),
        filters: JSON.stringify([["review_status", "=", options.status]]),
        limit_page_length: options.limit ?? 200,
        order_by: options.orderBy ?? "modified desc",
      },
    })) as LegalDocumentSet[];
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    logFullFailure(`getLegalDocsByStatus(${options.status})`, err);
    return [];
  }
};

/**
 * Legal-approved records currently awaiting a Finance decision —
 * `SELECT * FROM tabLegal Document Review WHERE review_status = "Approved"
 * AND finance_status = "Pending"`. This is the Finance Dashboard's Pending
 * queue, sourced entirely from ERPNext.
 */
export const getFinancePendingReviews = async (
  limit = 200
): Promise<LegalDocumentSet[]> => {
  try {
    const rows = (await erpnextClient.get(resourceBase(), {
      params: {
        fields: JSON.stringify(["*"]),
        filters: JSON.stringify([
          ["review_status", "=", "Approved"],
          ["finance_status", "=", "Pending"],
        ]),
        limit_page_length: limit,
        order_by: "modified desc",
      },
    })) as LegalDocumentSet[];
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    logFullFailure("getFinancePendingReviews", err);
    return [];
  }
};

export interface GetFinanceDocsByStatusOptions {
  status: "Approved" | "Rejected";
  orderBy?: string;
  limit?: number;
}

/**
 * Finance-decided records — `SELECT * FROM tabLegal Document Review WHERE
 * finance_status = "Approved" | "Rejected"`. Used for the Finance Dashboard's
 * "Recent" panels and the Finance History / All Reviews tabs.
 */
export const getLegalDocsByFinanceStatus = async (
  options: GetFinanceDocsByStatusOptions
): Promise<LegalDocumentSet[]> => {
  try {
    const rows = (await erpnextClient.get(resourceBase(), {
      params: {
        fields: JSON.stringify(["*"]),
        filters: JSON.stringify([["finance_status", "=", options.status]]),
        limit_page_length: options.limit ?? 200,
        order_by: options.orderBy ?? "finance_approved_on desc",
      },
    })) as LegalDocumentSet[];
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    logFullFailure(`getLegalDocsByFinanceStatus(${options.status})`, err);
    return [];
  }
};

/**
 * Every record that has ever reached the Finance stage (finance_status is
 * set to Pending/Approved/Rejected) — `WHERE finance_status IN
 * ("Pending","Approved","Rejected")`. Backs the Finance Reviews list page.
 */
export const getAllFinanceReviews = async (
  limit = 200
): Promise<LegalDocumentSet[]> => {
  try {
    const rows = (await erpnextClient.get(resourceBase(), {
      params: {
        fields: JSON.stringify(["*"]),
        filters: JSON.stringify([
          ["finance_status", "in", ["Pending", "Approved", "Rejected"]],
        ]),
        limit_page_length: limit,
        order_by: "modified desc",
      },
    })) as LegalDocumentSet[];
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    logFullFailure("getAllFinanceReviews", err);
    return [];
  }
};

/* ────────────────────────────────────────────────────────────────────────
 *  Writes — ALL go through /api/legal-review/* (backend-owned)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Called the moment a Procurement Manager selects the winning supplier for
 * an RFQ (RFQ workflow → "Pending Legal Review"). The backend creates the
 * Legal Document Review record if one doesn't already exist for this RFQ
 * (dedup by `rfq_name`, enforced again at the DB level by a unique
 * constraint), or returns the existing one untouched — an in-progress or
 * already-decided review (Approved/Rejected) can never be reset to Pending.
 */
export const ensureLegalDocumentReviewForSelection = async (
  input: Omit<LegalDocumentSet, "name" | "review_status">
): Promise<LegalDocumentSet> => {
  if (!input.sq_name) {
    throw new Error(
      "Cannot create Legal Document Review: sq_name (Supplier Quotation) is required."
    );
  }
  if (!input.supplier) {
    throw new Error(
      "Cannot create Legal Document Review: supplier is required."
    );
  }

  // eslint-disable-next-line no-console
  console.log("[LegalDocs] Requesting backend Legal Review creation...", {
    rfq: input.rfq_name,
    supplier: input.supplier,
    sq_name: input.sq_name,
  });

  const { created, record } = await callLegalReviewApi<{
    created: boolean;
    record: LegalDocumentSet;
  }>("create", input);

  if (created) {
    // eslint-disable-next-line no-console
    console.log("[LegalDocs] Legal Review Created:");
    // eslint-disable-next-line no-console
    console.log("  Document Name:", record?.name ?? "(unknown)");
    // eslint-disable-next-line no-console
    console.log("  RFQ:", input.rfq_name);
    // eslint-disable-next-line no-console
    console.log("  Supplier:", input.supplier);
  } else {
    // eslint-disable-next-line no-console
    console.log(
      `[LegalDocs] Legal Document Review already exists for RFQ ${input.rfq_name} — backend skipped duplicate creation.`,
      { name: record?.name, review_status: record?.review_status }
    );
  }

  return record;
};

/** @deprecated Use `ensureLegalDocumentReviewForSelection` — kept for callers not yet migrated. */
export const upsertLegalDocumentReview = async (
  input: Omit<LegalDocumentSet, "name">
): Promise<LegalDocumentSet> => {
  const { record } = await callLegalReviewApi<{
    created: boolean;
    record: LegalDocumentSet;
  }>("create", input);
  return record;
};

/** @deprecated Use `ensureLegalDocumentReviewForSelection` — kept for callers not yet migrated. */
export const getOrCreateLegalDocs = async (
  sqName: string,
  supplier: string,
  rfqName?: string
): Promise<LegalDocumentSet> => {
  return upsertLegalDocumentReview({
    sq_name: sqName,
    rfq_name: rfqName || "",
    supplier,
    review_status: "Pending",
  });
};

/** @deprecated Use `ensureLegalDocumentReviewForSelection` — kept for callers not yet migrated. */
export const createLegalDocs = async (
  docs: Omit<LegalDocumentSet, "name">
): Promise<LegalDocumentSet> => {
  return upsertLegalDocumentReview(docs);
};

/**
 * Updates non-decision fields only (file URLs, notes, viewed/approved
 * checkboxes). The backend whitelists exactly these fields — it will
 * reject any attempt to smuggle `review_status`/`reviewed_by`/`reviewed_at`
 * through this path; use `submitLegalReview` for the actual decision.
 */
export const updateLegalDocs = async (
  name: string,
  updates: Partial<LegalDocumentSet>
): Promise<LegalDocumentSet> => {
  const { record } = await callLegalReviewApi<{ record: LegalDocumentSet }>("update-flags", {
    name,
    updates,
  });
  return record;
};

/**
 * The ONLY way a Legal Document Review's `review_status` may change.
 * Delegates entirely to the backend, which stamps `approved_on` using the
 * server clock (always correctly formatted for ERPNext) rather than
 * trusting a client-supplied timestamp. `rejectionReason` is required by
 * the backend when `status === "Rejected"`.
 */
export const submitLegalReview = async (
  name: string,
  status: "Approved" | "Rejected",
  reviewedBy: string,
  comments: string,
  rejectionReason?: string
): Promise<LegalDocumentSet> => {
  const action = status === "Approved" ? "approve" : "reject";
  const { record } = await callLegalReviewApi<{ record: LegalDocumentSet }>(action, {
    name,
    reviewedBy,
    comments,
    rejectionReason,
  });
  return record;
};

/**
 * The ONLY way a Legal Document Review's `finance_status` may change.
 * Delegates entirely to the backend, which enforces that Legal must already
 * be "Approved" before Finance can decide, and stamps `finance_approved_on`
 * using the server clock. Updates the SAME record — never creates another.
 */
export const submitFinanceReview = async (
  name: string,
  status: "Approved" | "Rejected",
  reviewedBy: string,
  comments: string,
  rejectionReason?: string
): Promise<LegalDocumentSet> => {
  const action = status === "Approved" ? "finance-approve" : "finance-reject";
  const { record } = await callLegalReviewApi<{ record: LegalDocumentSet }>(action, {
    name,
    reviewedBy,
    comments,
    rejectionReason,
  });
  return record;
};

/** Resets a legally-rejected record back to "Pending" for resubmission. */
export const resubmitLegalReview = async (
  name: string,
  resubmittedBy: string,
  note?: string
): Promise<LegalDocumentSet> => {
  const { record } = await callLegalReviewApi<{ record: LegalDocumentSet }>("resubmit", {
    name,
    resubmittedBy,
    note,
  });
  return record;
};

/** Resets a finance-rejected record back to "Pending" for resubmission. */
export const resubmitFinanceReview = async (
  name: string,
  resubmittedBy: string,
  note?: string
): Promise<LegalDocumentSet> => {
  const { record } = await callLegalReviewApi<{ record: LegalDocumentSet }>("finance-resubmit", {
    name,
    resubmittedBy,
    note,
  });
  return record;
};

/** No-op — legacy localStorage cleanup removed after ERPNext migration. */
export function cleanupOversizedLegalDocs(): void {
  /* intentionally empty */
}
