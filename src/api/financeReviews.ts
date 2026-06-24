/**
 * Finance Reviews API service.
 *
 * Data source: ERPNext is the SINGLE SOURCE OF TRUTH.
 * Returns complete finance review history — pending, approved, rejected,
 * and RFQs that have progressed to PO (not just the active pending queue).
 */

import {
  fetchErpNextRFQs,
  mapErpFinanceStatus,
  mapErpLegalStatus,
  parseRfqTitle,
  tryRestoreFromApprovalData,
  type ErpRFQRow,
} from "./legalReviews";
import {
  getApprovalState,
  saveApprovalState,
  updateFinanceStatus,
  resubmitFinanceReview as resubmitFinanceReviewWorkflow,
} from "./rfqApprovalWorkflow";
import type {
  FinanceReviewStatus,
  FinanceReviewItem,
  FinanceComment,
  RFQApprovalState,
  LegalReviewStatus,
} from "../types/erpnext";

export type FinanceFilterStatus = FinanceReviewStatus | "All";

export interface FinanceReviewListParams {
  status?: FinanceFilterStatus;
  limit?: number;
}

const LOG_TAG = "[FinanceReviews]";

/** RFQ qualifies if it ever entered the finance review workflow. */
function qualifiesForFinanceHistory(item: FinanceReviewItem): boolean {
  if (item.legal_status === "Approved") return true;
  if (item.finance_reviewer || item.finance_review_date) return true;
  const fs = item.finance_status;
  if (fs === "Budget Approved" || fs === "Rejected") {
    return true;
  }
  return false;
}

function stateFromErpRow(erpRfq: ErpRFQRow): RFQApprovalState | null {
  const restored = tryRestoreFromApprovalData(erpRfq);
  if (restored) return restored;

  const hasFinanceData =
    erpRfq.custom_finance_status ||
    erpRfq.custom_finance_reviewer ||
    erpRfq.custom_finance_review_date;
  const hasWorkflowData =
    erpRfq.custom_legal_status ||
    erpRfq.custom_selected_supplier ||
    erpRfq.custom_workflow_step ||
    hasFinanceData;

  if (!hasWorkflowData) return null;

  const mappedLegal = mapErpLegalStatus(erpRfq.custom_legal_status ?? "");
  const mappedFinance = mapErpFinanceStatus(erpRfq.custom_finance_status ?? "");

  return {
    rfq: erpRfq.name,
    rfq_title: parseRfqTitle(erpRfq.message_for_supplier),
    company: erpRfq.company ?? "",
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

function toFinanceItem(state: RFQApprovalState): FinanceReviewItem {
  const cached = getApprovalState(state.rfq);
  const merged = cached ? { ...state, ...cached, rfq: state.rfq } : state;

  return {
    rfq_name: merged.rfq,
    rfq_title: merged.rfq_title,
    supplier: merged.selected_supplier,
    rfq_value: merged.selected_supplier_total ?? 0,
    submission_date: merged.submitted_at,
    created_by: merged.submitted_by,
    legal_status: merged.legal_status as LegalReviewStatus,
    finance_status: merged.finance_status ?? "Pending Finance Review",
    finance_reviewer: merged.finance_reviewer,
    finance_review_date: merged.finance_review_date,
    finance_comments: merged.finance_comments ?? [],
  };
}

function scanLocalFinanceRecords(exclude: Set<string>): FinanceReviewItem[] {
  const results: FinanceReviewItem[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("rfq_approval_")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const state = JSON.parse(raw) as RFQApprovalState;
        if (!state?.rfq || exclude.has(state.rfq)) continue;
        const item = toFinanceItem(state);
        if (qualifiesForFinanceHistory(item)) {
          results.push(item);
        }
      } catch {
        continue;
      }
    }
  } catch {
    /* ignore storage errors */
  }
  return results;
}

/**
 * Fetch ALL finance review records from ERPNext — no pending-only restriction.
 * ERPNext query uses docstatus=1 only; finance_status is NOT filtered server-side.
 */
export async function fetchAllFinanceReviewRecords(): Promise<FinanceReviewItem[]> {
  // eslint-disable-next-line no-console
  console.log(LOG_TAG, "fetchAllFinanceReviewRecords — ERPNext source, no finance_status filter");

  const erpMap = await fetchErpNextRFQs();
  const items: FinanceReviewItem[] = [];
  const seen = new Set<string>();

  for (const [rfqName, erpRfq] of erpMap) {
    const state = stateFromErpRow(erpRfq);
    if (!state) {
      const localState = getApprovalState(rfqName);
      if (localState) {
        const item = toFinanceItem(localState);
        if (qualifiesForFinanceHistory(item)) {
          items.push(item);
          seen.add(rfqName);
        }
      }
      continue;
    }

    try {
      localStorage.setItem(`rfq_approval_${state.rfq}`, JSON.stringify(state));
    } catch {
      /* ignore quota */
    }

    const item = toFinanceItem(state);
    if (!qualifiesForFinanceHistory(item)) continue;

    items.push(item);
    seen.add(rfqName);
  }

  const localOnly = scanLocalFinanceRecords(seen);
  for (const item of localOnly) {
    items.push(item);
    const state = getApprovalState(item.rfq_name);
    if (state) saveApprovalState(state);
  }

  items.sort((a, b) => {
    const da = a.finance_review_date ?? a.submission_date ?? "";
    const db = b.finance_review_date ?? b.submission_date ?? "";
    return db.localeCompare(da);
  });

  // eslint-disable-next-line no-console
  console.log("Finance Review API Response", {
    erpRfqCount: erpMap.size,
    totalRecords: items.length,
    pending: items.filter((r) => r.finance_status === "Pending Finance Review").length,
    approved: items.filter((r) => r.finance_status === "Budget Approved").length,
    rejected: items.filter((r) => r.finance_status === "Rejected").length,
    data: items,
  });

  if (items.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      LOG_TAG,
      "No finance review records returned — verify ERPNext custom_finance_status / custom_legal_status fields",
      [...erpMap.values()].slice(0, 5)
    );
  }

  return items;
}

/**
 * Returns finance review records, optionally filtered by finance_status client-side.
 * Default filter is "All" (complete history).
 */
export async function getFinanceReviews(
  params?: FinanceReviewListParams
): Promise<FinanceReviewItem[]> {
  const filter = params?.status ?? "All";
  const allItems = await fetchAllFinanceReviewRecords();

  let items =
    filter === "All"
      ? allItems
      : allItems.filter((i) => i.finance_status === filter);

  if (params?.limit && items.length > params.limit) {
    items = items.slice(0, params.limit);
  }

  // eslint-disable-next-line no-console
  console.log("RFQ Review Response", { filter, count: items.length, items });

  return items;
}

/** Latest approved or rejected RFQs for dashboard history. */
export async function getFinanceReviewHistory(limit = 10): Promise<FinanceReviewItem[]> {
  const all = await fetchAllFinanceReviewRecords();
  return all
    .filter(
      (r) =>
        r.finance_status === "Budget Approved" ||
        r.finance_status === "Rejected"
    )
    .slice(0, limit);
}

export async function updateFinanceReviewStatus(
  rfqName: string,
  status: FinanceReviewStatus,
  reviewedBy: string,
  comment?: string
): Promise<void> {
  await updateFinanceStatus(rfqName, status, reviewedBy, comment);
}

export function addFinanceComment(
  rfqName: string,
  comment: FinanceComment
): void {
  const state = getApprovalState(rfqName);
  if (!state) return;
  state.finance_comments = [...(state.finance_comments ?? []), comment];
  saveApprovalState(state);
}

export async function resubmitFinanceReview(
  rfqName: string,
  resubmittedBy: string,
  note?: string
): Promise<void> {
  await resubmitFinanceReviewWorkflow(rfqName, resubmittedBy, note);
}
