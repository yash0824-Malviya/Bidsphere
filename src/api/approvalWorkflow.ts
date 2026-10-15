/**
 * Approval workflow — single source of truth for Legal → E-Signature → Finance → Completed.
 *
 * RFQ workflow: Legal document verification → E-Signature → Finance Review → Procurement / PO
 *
 * Reads go through `/api/legal-review/list` (privileged gateway) — the same
 * backend path that Legal approve writes through. Never mock data. Never a
 * separate Finance DocType.
 *
 * Completed e-signature automatically transitions the LDR record:
 *   review_status   = "Approved"
 *   workflow_state  = "Finance Review"
 *   finance_status  = "Pending"
 *   current_owner   = "Finance Manager"
 *
 * Finance Review NEVER depends on a manual Legal Final Approval action —
 * the signature completion IS the Legal handoff to Finance.
 */
import type { QueryClient } from "@tanstack/react-query";

import { getAllLegalDocs, type LegalDocumentSet } from "./legalDocs";
import { isLegalReviewExecuted } from "../types/legalEsign";

/** UI readiness only; the backend revalidates the current private PDF bytes.
 * An RFQ is ready for Finance only after:
 *   1. All required documents verified (viewed + approved + hash match)
 *   2. E-signature completed on all required documents (isLegalReviewExecuted)
 *   3. workflow_state transitioned to "Finance Review" by signature completion
 *   4. finance_status = "Pending" (set automatically by signature completion)
 *
 * Finance Review is NOT triggered by a manual Legal Final Approval click.
 * The e-signature completion IS the trigger that hands off to Finance.
 */
export function isRfqReadyForFinance(doc: LegalDocumentSet | null | undefined): boolean {
  return !!doc && doc.review_status === "Approved" && doc.workflow_state === "Finance Review" &&
    doc.finance_status === "Pending" && isLegalReviewExecuted(doc);
}

export function isRfqReadyForPurchaseOrder(doc: LegalDocumentSet | null | undefined): boolean {
  return !!doc && doc.review_status === "Approved" && doc.finance_status === "Approved" &&
    doc.workflow_state === "Completed" && isLegalReviewExecuted(doc);
}

/** Mirrors `FINANCE_DASHBOARD_METRICS_KEY` — kept local to avoid circular imports. */
const FINANCE_DASHBOARD_METRICS_KEY = "finance-dashboard-metrics";

/** Canonical workflow stages used by every dashboard filter. */
export type ApprovalWorkflowStage =
  | "Legal Review"
  | "Finance Review"
  | "Procurement"
  | "Completed"
  | "Rejected";

export type DocumentStatus = "Pending" | "Approved" | "Rejected" | "";

export interface ReviewHistoryEntry {
  stage: "Legal" | "Finance";
  status: DocumentStatus;
  by?: string;
  on?: string;
  comments?: string;
  rejectionReason?: string;
}

/**
 * One workflow record = one Legal Document Review row.
 * Dashboards filter this shape; they never invent parallel lists.
 */
export interface ApprovalWorkflowRecord {
  /** LDR document name (unique workflow id). */
  id: string;
  /** Primary business identifier shown on every dashboard. */
  rfqNumber: string;
  /** Supplier Quotation linked to this review (legal detail route key). */
  sqName: string;
  supplier: string;
  company?: string;
  legalStatus: DocumentStatus;
  financeStatus: DocumentStatus;
  workflowStage: ApprovalWorkflowStage;
  currentOwner: string;
  nextApprover: string;
  reviewHistory: ReviewHistoryEntry[];
  approver?: string;
  createdDate?: string;
  updatedDate?: string;
  documentStatus: DocumentStatus;
  grandTotal: number;
  procurementManager?: string;
  legalRejectionReason?: string;
  financeRejectionReason?: string;
  /** Raw LDR row — for detail pages that need file URLs / flags. */
  source: LegalDocumentSet;
}

/** Shared React Query root key for the unified workflow dataset. */
export const APPROVAL_WORKFLOW_QUERY_KEY = "approval-workflow";

const OWNERS: Record<ApprovalWorkflowStage, string> = {
  "Legal Review": "Legal Reviewer",
  "Finance Review": "Finance Manager",
  Procurement: "Procurement",
  Completed: "—",
  Rejected: "—",
};

/**
 * Derive the active stage from status fields.
 *
 * PRIORITY ORDER:
 * 1. Rejected (any party) — highest priority
 * 2. Persisted workflow_state: "Finance Review" or "Completed" — trust the
 *    server-written state directly. The backend writes these ONLY after full
 *    validation (e-signature completion). This avoids requiring esign_envelope
 *    to be populated in list responses, which can be absent even when the ERP
 *    record is correct, causing Finance queue to show 0 items.
 * 3. Legacy reconstruction: derive from review_status + finance_status fields.
 */
export function deriveWorkflowStage(doc: LegalDocumentSet): ApprovalWorkflowStage {
  const legal = (doc.review_status ?? "").trim();
  const finance = String(doc.finance_status ?? "").trim();
  const persisted = (doc.workflow_state ?? "").trim();

  // 1. Any rejection wins immediately.
  if (legal === "Rejected" || finance === "Rejected" || persisted === "Rejected") {
    return "Rejected";
  }

  // 2. Trust server-persisted workflow_state for Finance and Completed stages.
  //    The backend only writes these states after all validations pass (full
  //    e-signature chain, legal approval). This fixes the Finance queue going
  //    dark when esign_envelope is missing or null in the list API response.
  if (persisted === "Finance Review") {
    return "Finance Review";
  }
  if (persisted === "Completed") {
    return "Completed";
  }

  // 3. Legacy "Procurement" edge case — Pending Review with Procurement owner.
  if (legal === "Pending" && persisted === "Pending Review" && doc.current_owner === "Procurement") {
    return "Procurement";
  }

  // 4. Fallback reconstruction for rows without a persisted workflow_state.
  //    isRfqReadyForPurchaseOrder / isRfqReadyForFinance parse esign_envelope
  //    to verify signatures — only reliable when the envelope is present.
  if (isRfqReadyForPurchaseOrder(doc)) return "Procurement";
  if (isRfqReadyForFinance(doc)) return "Finance Review";

  // 5. Default: Legal Review stage for anything else.
  return "Legal Review";
}

/** Finance queue membership: stage Finance Review AND finance still pending. */
export function isFinancePendingRecord(record: ApprovalWorkflowRecord): boolean {
  if (record.workflowStage !== "Finance Review") return false;
  const fs = String(record.financeStatus ?? "").trim();
  return !fs || fs === "Pending";
}

function buildHistory(doc: LegalDocumentSet): ReviewHistoryEntry[] {
  const history: ReviewHistoryEntry[] = [];
  if (doc.review_status && doc.review_status !== "Pending") {
    history.push({
      stage: "Legal",
      status: doc.review_status,
      by: doc.approved_by,
      on: doc.approved_on,
      comments: doc.legal_comments,
      rejectionReason: doc.rejection_reason,
    });
  }
  if (doc.finance_status && doc.finance_status !== "Pending") {
    history.push({
      stage: "Finance",
      status: doc.finance_status,
      by: doc.finance_approved_by,
      on: doc.finance_approved_on,
      comments: doc.finance_comments,
      rejectionReason: doc.finance_rejection_reason,
    });
  }
  return history;
}

function currentApprover(doc: LegalDocumentSet, stage: ApprovalWorkflowStage): string | undefined {
  if (stage === "Completed" || stage === "Procurement") {
    return doc.finance_approved_by || doc.approved_by;
  }
  if (stage === "Rejected") {
    return doc.finance_status === "Rejected"
      ? doc.finance_approved_by
      : doc.approved_by;
  }
  if (stage === "Finance Review") return doc.approved_by;
  return undefined;
}

function documentStatusFor(stage: ApprovalWorkflowStage): DocumentStatus {
  if (stage === "Completed" || stage === "Procurement") return "Approved";
  if (stage === "Rejected") return "Rejected";
  return "Pending";
}

/** Map one LDR row → one workflow record. Never clones into a second object store. */
export function toWorkflowRecord(doc: LegalDocumentSet): ApprovalWorkflowRecord {
  const stage = deriveWorkflowStage(doc);
  const rfqNumber = (doc.rfq_name || doc.sq_name || doc.name || "").trim();
  const ownerFallback = OWNERS[stage];
  return {
    id: doc.name || rfqNumber || doc.sq_name,
    rfqNumber,
    sqName: doc.sq_name,
    supplier: doc.supplier ?? "",
    company: doc.company,
    legalStatus: (doc.review_status as DocumentStatus) || "Pending",
    financeStatus: (doc.finance_status as DocumentStatus) || "",
    workflowStage: stage,
    currentOwner: (doc.current_owner || ownerFallback).trim() || ownerFallback,
    nextApprover: (doc.next_approver || ownerFallback).trim() || ownerFallback,
    reviewHistory: buildHistory(doc),
    approver: currentApprover(doc, stage),
    createdDate: doc.submission_date,
    updatedDate: doc.modified || doc.finance_approved_on || doc.approved_on || doc.submission_date,
    documentStatus: documentStatusFor(stage),
    grandTotal: doc.grand_total ?? 0,
    procurementManager: doc.procurement_manager,
    legalRejectionReason: doc.rejection_reason,
    financeRejectionReason: doc.finance_rejection_reason,
    source: doc,
  };
}

/**
 * Load the complete approval workflow dataset via the privileged gateway.
 * Callers filter by stage — they must not maintain parallel arrays.
 */
export async function getApprovalWorkflowRecords(): Promise<ApprovalWorkflowRecord[]> {
  const rows = await getAllLegalDocs();
  const byId = new Map<string, ApprovalWorkflowRecord>();
  for (const row of rows) {
    const record = toWorkflowRecord(row);
    if (!record.id) continue;
    byId.set(record.id, record);
  }
  return Array.from(byId.values()).sort((a, b) =>
    (b.updatedDate ?? "").localeCompare(a.updatedDate ?? ""),
  );
}

export function filterByWorkflowStage(
  records: ApprovalWorkflowRecord[],
  stage: ApprovalWorkflowStage,
): ApprovalWorkflowRecord[] {
  return records.filter((r) => r.workflowStage === stage);
}

/** Finance Dashboard pending queue — stage + financeStatus filters. */
export function filterFinancePendingQueue(
  records: ApprovalWorkflowRecord[],
): ApprovalWorkflowRecord[] {
  return records.filter(isFinancePendingRecord);
}

export interface ApprovalWorkflowCounters {
  pendingLegal: number;
  pendingFinance: number;
  approved: number;
  rejected: number;
  pendingLegalValue: number;
  pendingFinanceValue: number;
}

/** Dynamic counters from the same workflow dataset — never hardcoded. */
export function computeApprovalWorkflowCounters(
  records: ApprovalWorkflowRecord[],
): ApprovalWorkflowCounters {
  let pendingLegal = 0;
  let pendingFinance = 0;
  let approved = 0;
  let rejected = 0;
  let pendingLegalValue = 0;
  let pendingFinanceValue = 0;

  for (const r of records) {
    if (r.workflowStage === "Legal Review") {
      pendingLegal += 1;
      pendingLegalValue += r.grandTotal;
    } else if (isFinancePendingRecord(r)) {
      pendingFinance += 1;
      pendingFinanceValue += r.grandTotal;
    } else if (r.workflowStage === "Completed" || r.workflowStage === "Procurement") {
      approved += 1;
    } else if (r.workflowStage === "Rejected") {
      rejected += 1;
    }
  }

  return {
    pendingLegal,
    pendingFinance,
    approved,
    rejected,
    pendingLegalValue,
    pendingFinanceValue,
  };
}

/**
 * Invalidate + actively refetch every Legal + Finance queue/counter.
 * Call after Legal approve/reject and Finance approve/reject/resubmit.
 */
export function invalidateApprovalWorkflow(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: [APPROVAL_WORKFLOW_QUERY_KEY] });
  void queryClient.invalidateQueries({ queryKey: ["legal-document-reviews"] });
  void queryClient.invalidateQueries({ queryKey: ["legal-doc-review"] });
  void queryClient.invalidateQueries({ queryKey: ["legal-document-review"] });
  void queryClient.invalidateQueries({ queryKey: ["finance-reviews-all"] });
  void queryClient.invalidateQueries({ queryKey: ["finance-review-history"] });
  void queryClient.invalidateQueries({ queryKey: ["finance-pending-reviews"] });
  void queryClient.invalidateQueries({ queryKey: [FINANCE_DASHBOARD_METRICS_KEY] });
  void queryClient.invalidateQueries({ queryKey: ["finance-dashboard"] });
  void queryClient.invalidateQueries({ queryKey: ["rfq"] });
  void queryClient.invalidateQueries({ queryKey: ["rfq-quotes"] });
  void queryClient.invalidateQueries({ queryKey: ["rfq-linked-pos"] });
  // Force active observers (Finance Dashboard / pending queue) to refetch now.
  void queryClient.refetchQueries({ queryKey: [APPROVAL_WORKFLOW_QUERY_KEY] });
  void queryClient.refetchQueries({ queryKey: [FINANCE_DASHBOARD_METRICS_KEY] });
}
