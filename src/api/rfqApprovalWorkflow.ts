/**
 * RFQ Approval Workflow API service.
 *
 * Manages the multi-step approval workflow for RFQs:
 * Supplier Selected → Legal Review → Finance Review → Approved for PO → PO Created
 *
 * All state is stored:
 * - On the RFQ's custom fields in ERPNext (field names discovered at runtime)
 * - In localStorage per-RFQ (full approval state including comments)
 *
 * NO separate DocType is created. Field names are NEVER hardcoded — they
 * are resolved via rfqSchema.ts at runtime.
 */

import { updateRFQ } from "./sourcing";
import { getRFQSchema } from "./rfqSchema";
import type {
  RFQ,
  RFQApprovalState,
  RFQApprovalStep,
  LegalReviewStatus,
  FinanceReviewStatus,
} from "../types/erpnext";

const STORAGE_PREFIX = "rfq_approval_";

/* ────────────────────────────────────────────────────────────────────────────
 *  Local persistence (per-RFQ workflow state)
 * ──────────────────────────────────────────────────────────────────────────── */

function storageKey(rfqName: string): string {
  return `${STORAGE_PREFIX}${rfqName}`;
}

function normalizeApprovalState(state: RFQApprovalState): RFQApprovalState {
  const legacyLegal = state.legal_status as string;
  if (legacyLegal === "Changes Requested") {
    state.legal_status = "Rejected";
    state.workflow_step = "Legal Rejected";
  }
  const legacyFinance = state.finance_status as string;
  if (legacyFinance === "Clarification Requested") {
    state.finance_status = "Rejected";
    if (state.legal_status === "Approved") {
      state.workflow_step = "Finance Rejected";
    }
  }
  const legacyStep = state.workflow_step as string;
  if (
    legacyStep === "Legal Changes Requested" ||
    legacyStep === "Finance Clarification Requested"
  ) {
    state.workflow_step = resolveWorkflowStep(
      state.legal_status,
      state.finance_status,
      false
    );
  }
  return state;
}

export function getApprovalState(rfqName: string): RFQApprovalState | null {
  try {
    const raw = localStorage.getItem(storageKey(rfqName));
    if (!raw) return null;
    return normalizeApprovalState(JSON.parse(raw) as RFQApprovalState);
  } catch {
    return null;
  }
}

export function saveApprovalState(
  state: RFQApprovalState,
  options?: { skipErpSync?: boolean }
): void {
  try {
    localStorage.setItem(storageKey(state.rfq), JSON.stringify(state));
  } catch {
    /* ignore storage errors */
  }
  if (!options?.skipErpSync) {
    // Fire-and-forget sync to ERPNext for persistence across browsers
    syncStateToErpNext(state).catch(() => {});
  }
}

/** Persist full approval state to ERPNext (awaitable — used on approve/reject). */
export async function syncApprovalStateToErpNext(
  state: RFQApprovalState
): Promise<void> {
  await syncStateToErpNext(state);
}

function latestLegalRemark(state: RFQApprovalState): string {
  const comments = state.legal_comments ?? [];
  if (comments.length === 0) return "";
  const sorted = [...comments].sort((a, b) =>
    (b.comment_date ?? "").localeCompare(a.comment_date ?? "")
  );
  return sorted[0]?.comment?.trim() ?? "";
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Workflow step helpers
 * ──────────────────────────────────────────────────────────────────────────── */

export function resolveWorkflowStep(
  legalStatus: LegalReviewStatus,
  financeStatus: FinanceReviewStatus,
  poCreated: boolean
): RFQApprovalStep {
  if (poCreated) return "PO Created";

  if (legalStatus === "Approved" && financeStatus === "Budget Approved")
    return "Approved for PO";

  if (legalStatus === "Rejected") return "Legal Rejected";

  if (financeStatus === "Rejected") return "Finance Rejected";

  if (legalStatus === "Approved" && financeStatus === "Pending Finance Review")
    return "Pending Finance Review";

  if (legalStatus === "Pending Legal Review")
    return "Pending Legal Review";

  return "Supplier Selected";
}

export function isApprovedForPO(state: RFQApprovalState | null): boolean {
  if (!state) return false;
  return (
    state.legal_status === "Approved" &&
    state.finance_status === "Budget Approved"
  );
}

export function canCreatePOFromWorkflow(
  state: RFQApprovalState | null,
  poExists: boolean
): boolean {
  if (poExists) return false;
  return isApprovedForPO(state);
}

/* ────────────────────────────────────────────────────────────────────────────
 *  ERPNext write helper — uses schema introspection
 * ──────────────────────────────────────────────────────────────────────────── */

async function writeToErpNext(
  rfqName: string,
  updates: { legalStatus?: string; financeStatus?: string }
): Promise<void> {
  const schema = await getRFQSchema();
  const erpUpdates: Record<string, string> = {};

  if (updates.legalStatus !== undefined && schema.legalStatusFieldName) {
    erpUpdates[schema.legalStatusFieldName] = updates.legalStatus;
  }
  if (updates.financeStatus !== undefined && schema.financeStatusFieldName) {
    erpUpdates[schema.financeStatusFieldName] = updates.financeStatus;
  }

  if (Object.keys(erpUpdates).length > 0) {
    // eslint-disable-next-line no-console
    console.log("[Workflow] Writing to ERPNext:", rfqName, erpUpdates);
    try {
      await updateRFQ(rfqName, erpUpdates as unknown as Partial<RFQ>);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[Workflow] ERPNext write failed (localStorage still updated):", err);
    }
  } else {
    // eslint-disable-next-line no-console
    console.log("[Workflow] No ERPNext fields to write — localStorage only");
  }
}

/**
 * Persist the full approval state to ERPNext custom fields so it survives
 * browser/localStorage resets. Individual fields are written for easy
 * querying; the full JSON blob goes into custom_approval_data as backup.
 */
async function syncStateToErpNext(state: RFQApprovalState): Promise<void> {
  const schema = await getRFQSchema();
  const fieldSet = new Set(schema.allFields);
  const updates: Record<string, unknown> = {};

  if (schema.legalStatusFieldName) {
    const erpVal = state.legal_status === "Pending Legal Review" ? "Pending" : state.legal_status;
    updates[schema.legalStatusFieldName] = erpVal;
  }
  if (schema.financeStatusFieldName) {
    const erpVal =
      state.finance_status === "Pending Finance Review"
        ? "Pending"
        : state.finance_status === "Budget Approved"
          ? "Approved"
          : state.finance_status;
    updates[schema.financeStatusFieldName] = erpVal;
  }

  if (fieldSet.has("custom_selected_supplier"))
    updates.custom_selected_supplier = state.selected_supplier ?? "";
  if (fieldSet.has("custom_selected_supplier_total"))
    updates.custom_selected_supplier_total = state.selected_supplier_total ?? 0;
  if (fieldSet.has("custom_workflow_step"))
    updates.custom_workflow_step = state.workflow_step ?? "";
  if (fieldSet.has("custom_submitted_by"))
    updates.custom_submitted_by = state.submitted_by ?? "";
  if (fieldSet.has("custom_submitted_at"))
    updates.custom_submitted_at = state.submitted_at ?? "";
  if (fieldSet.has("custom_legal_reviewer"))
    updates.custom_legal_reviewer = state.legal_reviewer ?? "";
  if (fieldSet.has("custom_legal_review_date"))
    updates.custom_legal_review_date = state.legal_review_date ?? "";
  if (fieldSet.has("custom_legal_comments")) {
    updates.custom_legal_comments = latestLegalRemark(state);
  }
  if (fieldSet.has("custom_finance_reviewer"))
    updates.custom_finance_reviewer = state.finance_reviewer ?? "";
  if (fieldSet.has("custom_finance_review_date"))
    updates.custom_finance_review_date = state.finance_review_date ?? "";

  if (fieldSet.has("custom_terms_approved"))
    updates.custom_terms_approved = state.terms_approved ? 1 : 0;
  if (fieldSet.has("custom_warranty_approved"))
    updates.custom_warranty_approved = state.warranty_approved ? 1 : 0;
  if (fieldSet.has("custom_insurance_approved"))
    updates.custom_insurance_approved = state.insurance_approved ? 1 : 0;

  if (fieldSet.has("custom_approval_data")) {
    try {
      updates.custom_approval_data = JSON.stringify(state);
    } catch { /* ignore */ }
  }

  if (Object.keys(updates).length === 0) return;

  try {
    await updateRFQ(state.rfq, updates as unknown as Partial<RFQ>);
    // eslint-disable-next-line no-console
    console.log("[Workflow] Full state synced to ERPNext:", state.rfq, Object.keys(updates));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[Workflow] ERPNext full sync failed:", err);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Submit for review (initiates the workflow)
 * ──────────────────────────────────────────────────────────────────────────── */

export async function submitForReview(params: {
  rfqName: string;
  rfqTitle?: string;
  company?: string;
  selectedSupplier: string;
  selectedSupplierTotal: number;
  rfqValue?: number;
  submittedBy: string;
}): Promise<RFQApprovalState> {
  // eslint-disable-next-line no-console
  console.log("[Workflow] submitForReview called:", {
    rfqName: params.rfqName,
    supplier: params.selectedSupplier,
    total: params.selectedSupplierTotal,
    company: params.company,
    submittedBy: params.submittedBy,
  });

  const now = new Date().toISOString();

  const state: RFQApprovalState = {
    rfq: params.rfqName,
    rfq_title: params.rfqTitle,
    company: params.company,
    selected_supplier: params.selectedSupplier,
    selected_supplier_total: params.selectedSupplierTotal,
    workflow_step: "Pending Legal Review",
    legal_status: "Pending Legal Review",
    finance_status: "Pending Finance Review",
    submitted_by: params.submittedBy,
    submitted_at: now,
    legal_comments: [],
    finance_comments: [],
  };

  // Save to localStorage first for immediate availability
  try {
    localStorage.setItem(storageKey(params.rfqName), JSON.stringify(state));
  } catch { /* ignore */ }

  // Sync full state to ERPNext for cross-browser persistence
  await syncStateToErpNext(state);

  // Verify the write succeeded
  const verify = getApprovalState(params.rfqName);
  // eslint-disable-next-line no-console
  console.log("[Workflow] submitForReview: saved to localStorage, verified:",
    verify ? `✓ key=rfq_approval_${params.rfqName}, step=${verify.workflow_step}` : "✗ VERIFICATION FAILED");

  return state;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Update legal status (called from LegalReviewsPage actions)
 * ──────────────────────────────────────────────────────────────────────────── */

export function updateLegalStatus(
  rfqName: string,
  status: LegalReviewStatus
): RFQApprovalState | null {
  const state = getApprovalState(rfqName);
  if (!state) return null;

  state.legal_status = status;

  if (status === "Approved") {
    state.workflow_step = "Pending Finance Review";
  } else if (status === "Rejected") {
    state.workflow_step = "Legal Rejected";
  }

  saveApprovalState(state);
  return state;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Update finance status
 * ──────────────────────────────────────────────────────────────────────────── */

export async function updateFinanceStatus(
  rfqName: string,
  status: FinanceReviewStatus,
  reviewedBy?: string,
  comment?: string
): Promise<RFQApprovalState | null> {
  const state = getApprovalState(rfqName);
  if (!state) return null;

  const now = new Date().toISOString();
  state.finance_status = status;
  state.finance_reviewer = reviewedBy ?? state.finance_reviewer;
  state.finance_review_date = now;

  let erpFinanceStatus: string;

  if (status === "Budget Approved" && state.legal_status === "Approved") {
    state.workflow_step = "Approved for PO";
    erpFinanceStatus = "Approved";
  } else if (status === "Rejected") {
    state.workflow_step = "Finance Rejected";
    erpFinanceStatus = "Rejected";
  } else {
    erpFinanceStatus = "Pending";
  }

  if (comment?.trim()) {
    state.finance_comments = [
      ...(state.finance_comments ?? []),
      {
        comment: comment.trim(),
        comment_by: reviewedBy ?? "",
        comment_date: now,
        action: status,
      },
    ];
  }

  await writeToErpNext(rfqName, { financeStatus: erpFinanceStatus });

  saveApprovalState(state);
  return state;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Mark PO created
 * ──────────────────────────────────────────────────────────────────────────── */

export function markPOCreated(rfqName: string): void {
  const state = getApprovalState(rfqName);
  if (!state) return;
  state.workflow_step = "PO Created";
  saveApprovalState(state);
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Resubmit after rejection (procurement)
 * ──────────────────────────────────────────────────────────────────────────── */

export async function resubmitLegalReview(
  rfqName: string,
  resubmittedBy: string,
  note?: string
): Promise<RFQApprovalState> {
  const state = getApprovalState(rfqName);
  if (!state) throw new Error("No approval workflow found for this RFQ.");
  if (state.legal_status !== "Rejected") {
    throw new Error("Only legally rejected RFQs can be resubmitted for legal review.");
  }

  const now = new Date().toISOString();
  state.legal_status = "Pending Legal Review";
  state.workflow_step = "Pending Legal Review";
  state.finance_status = "Pending Finance Review";

  state.legal_comments = [
    ...(state.legal_comments ?? []),
    {
      comment:
        note?.trim() ||
        "RFQ resubmitted for legal review after rejection.",
      comment_by: resubmittedBy,
      comment_date: now,
      action: "Resubmit",
    },
  ];

  await writeToErpNext(rfqName, { legalStatus: "Pending" });
  saveApprovalState(state);
  return state;
}

export async function resubmitFinanceReview(
  rfqName: string,
  resubmittedBy: string,
  note?: string
): Promise<RFQApprovalState> {
  const state = getApprovalState(rfqName);
  if (!state) throw new Error("No approval workflow found for this RFQ.");
  if (state.legal_status !== "Approved") {
    throw new Error("Legal approval is required before finance resubmission.");
  }
  if (state.finance_status !== "Rejected") {
    throw new Error("Only finance-rejected RFQs can be resubmitted for finance review.");
  }

  const now = new Date().toISOString();
  state.finance_status = "Pending Finance Review";
  state.workflow_step = "Pending Finance Review";

  state.finance_comments = [
    ...(state.finance_comments ?? []),
    {
      comment:
        note?.trim() ||
        "RFQ resubmitted for finance review after rejection.",
      comment_by: resubmittedBy,
      comment_date: now,
      action: "Resubmit",
    },
  ];

  await writeToErpNext(rfqName, { financeStatus: "Pending" });
  saveApprovalState(state);
  return state;
}
