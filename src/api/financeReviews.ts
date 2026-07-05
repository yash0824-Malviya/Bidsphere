/**
 * Finance Reviews API service.
 *
 * Data source: ERPNext "Legal Document Review" DocType — the SAME record
 * created for Legal Review and updated in place with `finance_*` fields.
 * There is no separate Finance DocType and no dependency on the legacy
 * `Request for Quotation` custom fields (`custom_legal_status`,
 * `custom_finance_status`) — ERPNext's `Legal Document Review` is the
 * single source of truth for the entire Legal → Finance → PO workflow.
 *
 * The `FinanceReviewItem` shape returned here is unchanged from before this
 * migration so downstream consumers (FinanceDashboard, FinanceReviewsPage,
 * FinanceReviewHistoryTable, financeWorkflow KPIs) did not need to change.
 */
import {
  getAllFinanceReviews,
  getFinancePendingReviews,
  getLegalDocsByFinanceStatus,
  getLegalDocsByRfq,
  submitFinanceReview as submitFinanceReviewApi,
  resubmitFinanceReview as resubmitFinanceReviewApi,
  type LegalDocumentSet,
} from "./legalDocs";
import type {
  FinanceReviewStatus,
  FinanceReviewItem,
  FinanceComment,
  LegalReviewStatus,
} from "../types/erpnext";

export type FinanceFilterStatus = FinanceReviewStatus | "All";

export interface FinanceReviewListParams {
  status?: FinanceFilterStatus;
  limit?: number;
}

export interface FinanceReviewFetchDiagnostics {
  /** DocType queried — ERPNext is the single source of truth. */
  doctype: "Legal Document Review";
  recordsReturned: number;
  apiError?: string;
  permissionError?: string;
  emptyReason?: string;
}

export interface FinanceReviewQueryResult {
  items: FinanceReviewItem[];
  diagnostics: FinanceReviewFetchDiagnostics;
}

const LOG_TAG = "[FinanceReviews]";

function mapLegalStatus(reviewStatus: LegalDocumentSet["review_status"]): LegalReviewStatus {
  if (reviewStatus === "Approved") return "Approved";
  if (reviewStatus === "Rejected") return "Rejected";
  return "Pending Legal Review";
}

function mapFinanceStatus(financeStatus?: LegalDocumentSet["finance_status"]): FinanceReviewStatus {
  if (financeStatus === "Approved") return "Budget Approved";
  if (financeStatus === "Rejected") return "Rejected";
  return "Pending Finance Review";
}

function deriveWorkflowStep(doc: LegalDocumentSet): FinanceReviewItem["workflow_status"] {
  if (doc.review_status === "Rejected") return "Legal Rejected";
  if (doc.finance_status === "Approved") return "Approved for PO";
  if (doc.finance_status === "Rejected") return "Finance Rejected";
  if (doc.review_status === "Approved") return "Pending Finance Review";
  return "Pending Legal Review";
}

function toFinanceItem(doc: LegalDocumentSet): FinanceReviewItem {
  const financeStatus = mapFinanceStatus(doc.finance_status);
  const financeComments: FinanceComment[] = doc.finance_comments
    ? [
        {
          comment: doc.finance_comments,
          comment_by: doc.finance_approved_by ?? "",
          comment_date: doc.finance_approved_on ?? "",
          action: financeStatus,
        },
      ]
    : [];

  return {
    rfq_name: doc.rfq_name ?? doc.name ?? "",
    legal_document_name: doc.name,
    supplier: doc.supplier,
    company: doc.company ?? "",
    rfq_value: doc.grand_total ?? 0,
    submission_date: doc.submission_date,
    created_date: doc.submission_date,
    created_by: doc.procurement_manager,
    legal_status: mapLegalStatus(doc.review_status),
    legal_review_date: doc.approved_on,
    workflow_status: deriveWorkflowStep(doc),
    finance_status: financeStatus,
    finance_reviewer: doc.finance_approved_by,
    assigned_finance_manager: doc.finance_approved_by,
    finance_review_date: doc.finance_approved_on,
    finance_comments: financeComments,
    finance_rejection_reason: doc.finance_rejection_reason,
  };
}

/**
 * Fetch ALL finance review records from ERPNext's Legal Document Review —
 * every record that has ever entered the Finance funnel (i.e. Legal has
 * approved it, so `finance_status` is set).
 */
export async function fetchAllFinanceReviewRecords(): Promise<FinanceReviewQueryResult> {
  const diagnostics: FinanceReviewFetchDiagnostics = {
    doctype: "Legal Document Review",
    recordsReturned: 0,
  };

  try {
    const rows = await getAllFinanceReviews(200);
    const items = rows.map(toFinanceItem);

    diagnostics.recordsReturned = items.length;
    if (items.length === 0) {
      diagnostics.emptyReason =
        "No RFQs have reached Finance Review yet. RFQs appear here once Legal Review is approved.";
    }

    // eslint-disable-next-line no-console
    console.log(LOG_TAG, "ERPNext response summary:", {
      recordsReturned: diagnostics.recordsReturned,
    });

    return { items, diagnostics };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    diagnostics.apiError = msg;
    if (/403|permission|not permitted/i.test(msg)) {
      diagnostics.permissionError = msg;
    }
    diagnostics.emptyReason = `Could not load Finance Reviews from ERPNext: ${msg}`;
    // eslint-disable-next-line no-console
    console.error(LOG_TAG, "ERPNext fetch failed:", msg);
    return { items: [], diagnostics };
  }
}

/**
 * Returns finance review records from ERPNext, optionally filtered by
 * status. Each status uses its own dedicated ERPNext query when possible so
 * KPI counts can never drift from the records actually displayed.
 */
export async function getFinanceReviews(
  params?: FinanceReviewListParams
): Promise<FinanceReviewQueryResult> {
  const filter = params?.status ?? "All";

  if (filter === "All") {
    const result = await fetchAllFinanceReviewRecords();
    let items = result.items;
    if (params?.limit && items.length > params.limit) items = items.slice(0, params.limit);
    return { items, diagnostics: { ...result.diagnostics, recordsReturned: items.length } };
  }

  const diagnostics: FinanceReviewFetchDiagnostics = {
    doctype: "Legal Document Review",
    recordsReturned: 0,
  };

  try {
    const rows =
      filter === "Pending Finance Review"
        ? await getFinancePendingReviews(params?.limit ?? 200)
        : await getLegalDocsByFinanceStatus({
            status: filter === "Budget Approved" ? "Approved" : "Rejected",
            limit: params?.limit,
          });

    let items = rows.map(toFinanceItem);
    if (params?.limit && items.length > params.limit) items = items.slice(0, params.limit);

    diagnostics.recordsReturned = items.length;
    if (items.length === 0) {
      diagnostics.emptyReason = `No RFQs with finance status "${filter}".`;
    }

    // eslint-disable-next-line no-console
    console.log(LOG_TAG, "Filtered response:", { filter, count: items.length });

    return { items, diagnostics };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    diagnostics.apiError = msg;
    diagnostics.emptyReason = `Could not load Finance Reviews from ERPNext: ${msg}`;
    return { items: [], diagnostics };
  }
}

/** Latest approved or rejected RFQs for dashboard/history. */
export async function getFinanceReviewHistory(limit = 10): Promise<FinanceReviewItem[]> {
  const [approved, rejected] = await Promise.all([
    getLegalDocsByFinanceStatus({ status: "Approved", limit }),
    getLegalDocsByFinanceStatus({ status: "Rejected", limit }),
  ]);

  return [...approved, ...rejected]
    .map(toFinanceItem)
    .sort((a, b) => (b.finance_review_date ?? "").localeCompare(a.finance_review_date ?? ""))
    .slice(0, limit);
}

/**
 * The ONLY way a Finance Review's verdict may change. Resolves the Legal
 * Document Review by RFQ name, then updates that SAME record's `finance_*`
 * fields via the backend gateway — never creates a new document.
 */
export async function updateFinanceReviewStatus(
  rfqName: string,
  status: FinanceReviewStatus,
  reviewedBy: string,
  comment?: string,
  rejectionReason?: string
): Promise<void> {
  const legalDoc = await getLegalDocsByRfq(rfqName);
  if (!legalDoc?.name) {
    throw new Error(`No Legal Document Review found for RFQ ${rfqName}.`);
  }
  const mapped = status === "Budget Approved" ? "Approved" : "Rejected";
  await submitFinanceReviewApi(
    legalDoc.name,
    mapped,
    reviewedBy,
    comment ?? "",
    mapped === "Rejected" ? (rejectionReason ?? comment ?? "") : undefined
  );
}

export async function resubmitFinanceReview(
  rfqName: string,
  resubmittedBy: string,
  note?: string
): Promise<void> {
  const legalDoc = await getLegalDocsByRfq(rfqName);
  if (!legalDoc?.name) {
    throw new Error(`No Legal Document Review found for RFQ ${rfqName}.`);
  }
  await resubmitFinanceReviewApi(legalDoc.name, resubmittedBy, note);
}
