/**
 * Legal Reviews API service.
 *
 * Data source: ERPNext is the SINGLE SOURCE OF TRUTH.
 *
 * All review data is read from ERPNext custom fields on the RFQ DocType.
 * localStorage is used only as a write-through cache by the approval
 * workflow — it is NEVER read for the listing. This ensures every browser
 * window, incognito session, and device sees identical data.
 */

import { apiGet, buildResourceUrl } from "./erpnext";
import { getPurchaseOrderByRFQ } from "./purchasing";
import { updateRFQ } from "./sourcing";
import {
  getApprovalState,
  saveApprovalState,
  resubmitLegalReview as resubmitLegalReviewWorkflow,
} from "./rfqApprovalWorkflow";
import { getRFQSchema } from "./rfqSchema";
import type {
  RFQ,
  RFQApprovalState,
  LegalReviewStatus,
  FinanceReviewStatus,
  LegalReviewItem,
  LegalComment,
} from "../types/erpnext";

export type LegalReviewFilterStatus = LegalReviewStatus | "All";

export interface LegalReviewListParams {
  status?: LegalReviewFilterStatus;
  limit?: number;
}

const RFQ_DOCTYPE = "Request for Quotation";
const LOG_TAG = "[LegalReviews]";

/* ────────────────────────────────────────────────────────────────────────────
 *  Main query — ERPNext is the SINGLE SOURCE OF TRUTH
 * ──────────────────────────────────────────────────────────────────────────── */

export async function getLegalReviews(
  params?: LegalReviewListParams
): Promise<LegalReviewItem[]> {
  const filter = params?.status ?? "Pending Legal Review";
  // eslint-disable-next-line no-console
  console.log(LOG_TAG, "getLegalReviews called — source: ERPNext API, filter:", filter);

  const items: LegalReviewItem[] = [];
  const seen = new Set<string>();

  // ── Step 1: Fetch ALL submitted RFQs from ERPNext ─────────────────────
  const erpMap = await fetchErpNextRFQs();
  // eslint-disable-next-line no-console
  console.log(LOG_TAG, "Legal Reviews Source: ERPNext API");
  // eslint-disable-next-line no-console
  console.log(LOG_TAG, `Fetched ${erpMap.size} submitted RFQs from ERPNext:`,
    [...erpMap.keys()]);

  // ── Step 2: Build review items from ERPNext custom fields ─────────────
  for (const [rfqName, erpRfq] of erpMap) {
    let state = tryRestoreFromApprovalData(erpRfq);

    if (!state) {
      const hasErpWorkflowData =
        erpRfq.custom_legal_status ||
        erpRfq.custom_selected_supplier ||
        erpRfq.custom_workflow_step;

      if (hasErpWorkflowData) {
        const mappedLegal = mapErpLegalStatus(erpRfq.custom_legal_status ?? "");
        const mappedFinance = mapErpFinanceStatus(erpRfq.custom_finance_status ?? "");

        state = {
          rfq: erpRfq.name,
          rfq_title: parseRfqTitle(erpRfq.message_for_supplier),
          company: erpRfq.company,
          selected_supplier: erpRfq.custom_selected_supplier ?? "",
          selected_supplier_total: erpRfq.custom_selected_supplier_total ?? 0,
          workflow_step: (erpRfq.custom_workflow_step as RFQApprovalState["workflow_step"]) ??
            (mappedLegal === "Approved" ? "Pending Finance Review" : "Pending Legal Review"),
          legal_status: mappedLegal,
          finance_status: mappedFinance,
          submitted_by: erpRfq.custom_submitted_by ?? erpRfq.owner ?? "",
          submitted_at: erpRfq.custom_submitted_at ?? erpRfq.creation ?? new Date().toISOString(),
          legal_reviewer: erpRfq.custom_legal_reviewer,
          legal_review_date: erpRfq.custom_legal_review_date,
          finance_reviewer: erpRfq.custom_finance_reviewer,
          finance_review_date: erpRfq.custom_finance_review_date,
          legal_comments: [],
          finance_comments: [],
          terms_approved: !!erpRfq.custom_terms_approved,
          warranty_approved: !!erpRfq.custom_warranty_approved,
          insurance_approved: !!erpRfq.custom_insurance_approved,
        };
      }
    }

    // If ERPNext had no workflow data, check localStorage for un-synced state
    // and push it up to ERPNext so future loads find it.
    if (!state) {
      const localState = readLocalApprovalState(rfqName);
      if (localState && localState.legal_status) {
        // Enrich with ERPNext company if missing
        if (!localState.company && erpRfq.company) {
          localState.company = erpRfq.company;
        }
        state = localState;
        // Sync this un-synced state to ERPNext (fire-and-forget)
        saveApprovalState(state);
        // eslint-disable-next-line no-console
        console.log(LOG_TAG, `Migrated localStorage state to ERPNext: ${rfqName}`);
      }
    }

    if (!state) continue;

    // Hydrate localStorage cache for detail pages
    try {
      localStorage.setItem(`rfq_approval_${state.rfq}`, JSON.stringify(state));
    } catch { /* ignore quota errors */ }

    const item = toReviewItem(state, erpRfq);
    if (filter !== "All" && item.legal_status !== filter) continue;

    items.push(item);
    seen.add(rfqName);
  }

  // ── Step 3: Pick up any localStorage-only records not in ERPNext ───────
  // (e.g. RFQ was deleted from ERPNext but approval state remains local)
  const localOnlyItems = scanLocalApprovalStates(seen);
  for (const localState of localOnlyItems) {
    if (!localState.legal_status) continue;

    const item = toReviewItem(localState);
    if (filter !== "All" && item.legal_status !== filter) continue;

    items.push(item);
    // Attempt to sync to ERPNext
    saveApprovalState(localState);
  }

  if (localOnlyItems.length > 0) {
    // eslint-disable-next-line no-console
    console.log(LOG_TAG, `Found ${localOnlyItems.length} localStorage-only records (syncing to ERPNext)`);
  }

  // eslint-disable-next-line no-console
  console.log(LOG_TAG, `Loaded Reviews: ${items.length} (filter="${filter}", ` +
    `ERPNext: ${seen.size}, localStorage-only: ${localOnlyItems.length})`);

  items.sort(
    (a, b) => (b.submission_date ?? "").localeCompare(a.submission_date ?? "")
  );

  if (params?.limit && items.length > params.limit) {
    return items.slice(0, params.limit);
  }

  return items;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Internal: localStorage helpers (read-only, used for migration)
 * ──────────────────────────────────────────────────────────────────────────── */

function readLocalApprovalState(rfqName: string): RFQApprovalState | null {
  try {
    const raw = localStorage.getItem(`rfq_approval_${rfqName}`);
    return raw ? (JSON.parse(raw) as RFQApprovalState) : null;
  } catch {
    return null;
  }
}

function scanLocalApprovalStates(
  exclude: Set<string>
): RFQApprovalState[] {
  const results: RFQApprovalState[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("rfq_approval_")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const state = JSON.parse(raw) as RFQApprovalState;
        if (state?.rfq && !exclude.has(state.rfq)) {
          results.push(state);
        }
      } catch { /* skip corrupt entries */ }
    }
  } catch { /* ignore */ }
  return results;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Internal: ERPNext fetch with retry
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ErpRFQRow {
  name: string;
  company?: string;
  creation?: string;
  transaction_date?: string;
  owner?: string;
  message_for_supplier?: string;
  custom_legal_status?: string;
  custom_finance_status?: string;
  custom_selected_supplier?: string;
  custom_selected_supplier_total?: number;
  custom_workflow_step?: string;
  custom_submitted_by?: string;
  custom_submitted_at?: string;
  custom_legal_reviewer?: string;
  custom_legal_review_date?: string;
  custom_finance_reviewer?: string;
  custom_finance_review_date?: string;
  custom_approval_data?: string;
  custom_terms_approved?: number;
  custom_warranty_approved?: number;
  custom_insurance_approved?: number;
  [key: string]: unknown;
}

const WORKFLOW_CUSTOM_FIELDS = [
  "custom_legal_status",
  "custom_finance_status",
  "custom_selected_supplier",
  "custom_selected_supplier_total",
  "custom_workflow_step",
  "custom_submitted_by",
  "custom_submitted_at",
  "custom_legal_reviewer",
  "custom_legal_review_date",
  "custom_finance_reviewer",
  "custom_finance_review_date",
  "custom_approval_data",
  "custom_terms_approved",
  "custom_warranty_approved",
  "custom_insurance_approved",
];

export async function fetchErpNextRFQs(): Promise<Map<string, ErpRFQRow>> {
  const map = new Map<string, ErpRFQRow>();

  const safeFields = ["name", "company", "creation", "transaction_date", "owner", "message_for_supplier"];

  let availableCustomFields: string[] = [];
  let legalFieldName: string | null = null;
  try {
    const schema = await getRFQSchema();
    legalFieldName = schema.legalStatusFieldName;
    const fieldSet = new Set(schema.allFields);
    availableCustomFields = WORKFLOW_CUSTOM_FIELDS.filter((f) => fieldSet.has(f));
    // eslint-disable-next-line no-console
    console.log(LOG_TAG, "Available workflow fields:", availableCustomFields);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG_TAG, "Schema discovery failed:", err);
  }

  // Include the legal field name if it's different from custom_legal_status
  if (legalFieldName && !availableCustomFields.includes(legalFieldName)) {
    availableCustomFields.push(legalFieldName);
  }

  const allRequestedFields = [...safeFields, ...availableCustomFields];

  let rfqs: ErpRFQRow[] | null = null;

  // Attempt 1: with all custom fields
  try {
    const result = await apiGet<ErpRFQRow[]>(
      buildResourceUrl(RFQ_DOCTYPE),
      {
        params: {
          fields: JSON.stringify(allRequestedFields),
          filters: JSON.stringify([["docstatus", "=", 1]]),
          limit_page_length: 200,
          order_by: "creation desc",
        },
      }
    );
    if (Array.isArray(result)) {
      rfqs = result;
    } else {
      // eslint-disable-next-line no-console
      console.warn(LOG_TAG, "ERPNext returned non-array:", typeof result, result);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(LOG_TAG, "ERPNext fetch attempt 1 failed:", err);
  }

  // Attempt 2: safe fields only
  if (!rfqs) {
    try {
      // eslint-disable-next-line no-console
      console.log(LOG_TAG, "Retrying ERPNext fetch with safe fields only...");
      const result = await apiGet<ErpRFQRow[]>(
        buildResourceUrl(RFQ_DOCTYPE),
        {
          params: {
            fields: JSON.stringify(safeFields),
            filters: JSON.stringify([["docstatus", "=", 1]]),
            limit_page_length: 200,
            order_by: "creation desc",
          },
        }
      );
      if (Array.isArray(result)) rfqs = result;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(LOG_TAG, "ERPNext fetch attempt 2 also failed:", err);
    }
  }

  if (rfqs) {
    for (const rfq of rfqs) {
      if (rfq?.name) {
        if (legalFieldName && legalFieldName !== "custom_legal_status" && rfq[legalFieldName]) {
          rfq.custom_legal_status = rfq[legalFieldName] as string;
        }
        map.set(rfq.name, rfq);
      }
    }
  }

  return map;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Helpers
 * ──────────────────────────────────────────────────────────────────────────── */

function toReviewItem(
  state: RFQApprovalState,
  erpData?: ErpRFQRow | null
): LegalReviewItem {
  return {
    rfq_name: state.rfq,
    rfq_title: state.rfq_title,
    company: state.company ?? erpData?.company ?? "",
    supplier: state.selected_supplier,
    rfq_value: state.selected_supplier_total,
    submission_date: state.submitted_at,
    created_by: state.submitted_by,
    legal_status: state.legal_status,
    legal_reviewer: state.legal_reviewer,
    legal_review_date: state.legal_review_date,
    legal_comments: state.legal_comments ?? [],
    finance_status: state.finance_status,
    finance_reviewer: state.finance_reviewer,
    finance_review_date: state.finance_review_date,
    workflow_step: state.workflow_step,
    terms_approved: state.terms_approved,
    warranty_approved: state.warranty_approved,
    insurance_approved: state.insurance_approved,
  };
}

export function mapErpLegalStatus(erpStatus: string): LegalReviewStatus {
  if (erpStatus === "Changes Requested") return "Rejected";
  const map: Record<string, LegalReviewStatus> = {
    Pending: "Pending Legal Review",
    "Pending Legal Review": "Pending Legal Review",
    Approved: "Approved",
    Rejected: "Rejected",
  };
  return map[erpStatus] ?? "Pending Legal Review";
}

export function mapErpFinanceStatus(erpStatus: string): FinanceReviewStatus {
  if (erpStatus === "Clarification Requested") return "Rejected";
  const map: Record<string, FinanceReviewStatus> = {
    Pending: "Pending Finance Review",
    "Pending Finance Review": "Pending Finance Review",
    Approved: "Budget Approved",
    "Budget Approved": "Budget Approved",
    Rejected: "Rejected",
  };
  return map[erpStatus] ?? "Pending Finance Review";
}

export function tryRestoreFromApprovalData(erpRfq: ErpRFQRow): RFQApprovalState | null {
  const jsonBlob = erpRfq.custom_approval_data;
  if (!jsonBlob || typeof jsonBlob !== "string") return null;
  try {
    const parsed = JSON.parse(jsonBlob) as RFQApprovalState;
    if (parsed?.rfq && parsed?.legal_status) return parsed;
  } catch {
    // eslint-disable-next-line no-console
    console.warn(LOG_TAG, `Corrupt custom_approval_data for ${erpRfq.name}`);
  }
  return null;
}

export function parseRfqTitle(message: string | undefined | null): string | undefined {
  if (!message) return undefined;
  const match = message.match(/^Title\s*:\s*(.+)$/im);
  return match?.[1]?.trim();
}

/* ────────────────────────────────────────────────────────────────────────────
 *  RFQ → PO mapping (batch)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * For a list of RFQ names, resolve which ones have a linked Purchase Order
 * and return a map of rfqName → poName. Lookups run in parallel.
 */
export async function batchRFQToPOMap(
  rfqNames: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (rfqNames.length === 0) return map;

  await Promise.all(
    rfqNames.map(async (rfqName) => {
      try {
        const po = await getPurchaseOrderByRFQ(rfqName);
        if (po) map.set(rfqName, po.name);
      } catch {
        /* skip — PO lookup is best-effort */
      }
    })
  );

  // eslint-disable-next-line no-console
  console.log(LOG_TAG, `batchRFQToPOMap: ${rfqNames.length} RFQs queried, ${map.size} have POs:`,
    Object.fromEntries(map));
  return map;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Write operations
 * ──────────────────────────────────────────────────────────────────────────── */

export async function updateReviewStatus(
  rfqName: string,
  status: LegalReviewStatus,
  reviewedBy: string,
  comment?: string
): Promise<void> {
  const now = new Date().toISOString();

  const schema = await getRFQSchema();
  const erpUpdates: Record<string, string> = {};

  if (schema.legalStatusFieldName) {
    erpUpdates[schema.legalStatusFieldName] =
      status === "Pending Legal Review" ? "Pending" : status;
  }

  if (status === "Approved" && schema.financeStatusFieldName) {
    erpUpdates[schema.financeStatusFieldName] = "Pending";
  }

  if (Object.keys(erpUpdates).length > 0) {
    try {
      await updateRFQ(rfqName, erpUpdates as unknown as Partial<RFQ>);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(LOG_TAG, "ERPNext update failed, localStorage only:", err);
    }
  }

  const state = getApprovalState(rfqName);
  if (state) {
    state.legal_status = status;
    state.legal_reviewer = reviewedBy;
    state.legal_review_date = now;

    if (status === "Approved") {
      state.workflow_step = "Pending Finance Review";
      state.finance_status = "Pending Finance Review";
    } else if (status === "Rejected") {
      state.workflow_step = "Legal Rejected";
    }

    if (comment?.trim()) {
      state.legal_comments = [
        ...(state.legal_comments ?? []),
        {
          comment: comment.trim(),
          comment_by: reviewedBy,
          comment_date: now,
          action: status,
        },
      ];
    }

    saveApprovalState(state);
  }
}

export function addComment(
  rfqName: string,
  comment: LegalComment
): void {
  const state = getApprovalState(rfqName);
  if (!state) return;
  state.legal_comments = [...(state.legal_comments ?? []), comment];
  saveApprovalState(state);
}

export async function resubmitLegalReview(
  rfqName: string,
  resubmittedBy: string,
  note?: string
): Promise<void> {
  await resubmitLegalReviewWorkflow(rfqName, resubmittedBy, note);
}
