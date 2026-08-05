/**
 * Finance Reviews API service.
 *
 * Data source: the shared approval workflow (`approvalWorkflow.ts`), which
 * projects ERPNext "Legal Document Review" rows — the SAME records Legal
 * uses. There is no separate Finance DocType and no mock/demo arrays.
 *
 * Filters are stage-based:
 *   Pending Finance Review → Workflow Stage == Finance Review
 *   Budget Approved        → Workflow Stage == Completed | Procurement
 *   Rejected               → Workflow Stage == Rejected
 */
import {
  filterByWorkflowStage,
  filterFinancePendingQueue,
  getApprovalWorkflowRecords,
  type ApprovalWorkflowRecord,
} from "./approvalWorkflow";
import {
  getLegalDocsByRfq,
  submitFinanceReview as submitFinanceReviewApi,
  resubmitFinanceReview as resubmitFinanceReviewApi,
} from "./legalDocs";
import type {
  FinanceReviewStatus,
  FinanceReviewItem,
  FinanceComment,
  LegalReviewStatus,
  RFQApprovalStep,
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

function mapLegalStatus(status: ApprovalWorkflowRecord["legalStatus"]): LegalReviewStatus {
  if (status === "Approved") return "Approved";
  if (status === "Rejected") return "Rejected";
  return "Pending Legal Review";
}

function mapFinanceStatus(record: ApprovalWorkflowRecord): FinanceReviewStatus {
  if (record.workflowStage === "Completed" || record.workflowStage === "Procurement") {
    return "Budget Approved";
  }
  if (record.workflowStage === "Rejected" && record.financeStatus === "Rejected") {
    return "Rejected";
  }
  if (record.financeStatus === "Approved") return "Budget Approved";
  if (record.financeStatus === "Rejected") return "Rejected";
  return "Pending Finance Review";
}

function deriveWorkflowStep(record: ApprovalWorkflowRecord): RFQApprovalStep {
  switch (record.workflowStage) {
    case "Rejected":
      return record.financeStatus === "Rejected" ? "Finance Rejected" : "Legal Rejected";
    case "Completed":
    case "Procurement":
      return "Approved for PO";
    case "Finance Review":
      return "Pending Finance Review";
    default:
      return "Pending Legal Review";
  }
}

function toFinanceItem(record: ApprovalWorkflowRecord): FinanceReviewItem {
  const financeStatus = mapFinanceStatus(record);
  const doc = record.source;
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
    rfq_name: record.rfqNumber,
    legal_document_name: record.id,
    supplier: record.supplier,
    company: record.company ?? "",
    rfq_value: record.grandTotal,
    submission_date: record.createdDate,
    created_date: record.createdDate,
    created_by: record.procurementManager,
    legal_status: mapLegalStatus(record.legalStatus),
    legal_review_date: doc.approved_on,
    workflow_status: deriveWorkflowStep(record),
    finance_status: financeStatus,
    finance_reviewer: doc.finance_approved_by,
    assigned_finance_manager: doc.finance_approved_by,
    finance_review_date: doc.finance_approved_on,
    finance_comments: financeComments,
    finance_rejection_reason: doc.finance_rejection_reason,
  };
}

/** Records that have entered (or finished) the Finance funnel. */
function isFinanceFunnel(record: ApprovalWorkflowRecord): boolean {
  return (
    record.workflowStage === "Finance Review" ||
    record.workflowStage === "Completed" ||
    record.workflowStage === "Procurement" ||
    (record.workflowStage === "Rejected" && record.legalStatus === "Approved")
  );
}

/**
 * Fetch ALL finance-funnel records from the shared approval workflow.
 */
export async function fetchAllFinanceReviewRecords(): Promise<FinanceReviewQueryResult> {
  const diagnostics: FinanceReviewFetchDiagnostics = {
    doctype: "Legal Document Review",
    recordsReturned: 0,
  };

  try {
    const workflow = await getApprovalWorkflowRecords();
    const items = workflow.filter(isFinanceFunnel).map(toFinanceItem);

    diagnostics.recordsReturned = items.length;
    if (items.length === 0) {
      diagnostics.emptyReason =
        "No RFQs have reached Finance Review yet. RFQs appear here once Legal Review is approved.";
    }

    // eslint-disable-next-line no-console
    console.log(LOG_TAG, "Workflow response summary:", {
      recordsReturned: diagnostics.recordsReturned,
    });

    return { items, diagnostics };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    diagnostics.apiError = msg;
    if (/403|permission|not permitted/i.test(msg)) {
      diagnostics.permissionError = msg;
    }
    diagnostics.emptyReason = `Could not load Finance Reviews: ${msg}`;
    // eslint-disable-next-line no-console
    console.error(LOG_TAG, "Workflow fetch failed:", msg);
    return { items: [], diagnostics };
  }
}

/**
 * Returns finance review records from the shared workflow, optionally
 * filtered by status / stage.
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
    const workflow = await getApprovalWorkflowRecords();
    let stageRecords: ApprovalWorkflowRecord[];

    if (filter === "Pending Finance Review") {
      stageRecords = filterFinancePendingQueue(workflow);
    } else if (filter === "Budget Approved") {
      stageRecords = [
        ...filterByWorkflowStage(workflow, "Completed"),
        ...filterByWorkflowStage(workflow, "Procurement"),
      ];
    } else {
      // Rejected — finance funnel only (legal-rejected never enters Finance)
      stageRecords = filterByWorkflowStage(workflow, "Rejected").filter(
        (r) => r.legalStatus === "Approved" || r.financeStatus === "Rejected",
      );
    }

    let items = stageRecords.map(toFinanceItem);
    if (params?.limit && items.length > params.limit) items = items.slice(0, params.limit);

    diagnostics.recordsReturned = items.length;
    if (items.length === 0) {
      diagnostics.emptyReason = `No RFQs with finance status "${filter}".`;
    }

    // eslint-disable-next-line no-console
    console.log(LOG_TAG, "Filtered workflow response:", { filter, count: items.length });

    return { items, diagnostics };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    diagnostics.apiError = msg;
    diagnostics.emptyReason = `Could not load Finance Reviews: ${msg}`;
    return { items: [], diagnostics };
  }
}

/** Latest approved or rejected RFQs for dashboard/history. */
export async function getFinanceReviewHistory(limit = 10): Promise<FinanceReviewItem[]> {
  const workflow = await getApprovalWorkflowRecords();
  const decided = [
    ...filterByWorkflowStage(workflow, "Completed"),
    ...filterByWorkflowStage(workflow, "Procurement"),
    ...filterByWorkflowStage(workflow, "Rejected").filter(
      (r) => r.legalStatus === "Approved" || r.financeStatus === "Rejected",
    ),
  ];

  return decided
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
