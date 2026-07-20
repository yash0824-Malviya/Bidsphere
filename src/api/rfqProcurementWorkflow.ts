/**
 * RFQ procurement workflow — single source of truth for the RFQ Detail
 * timeline, Status Center, AI card gates, and Create-PO readiness.
 *
 * Stages unlock strictly left-to-right. Later stages can never appear
 * Completed/Current while an earlier stage is still Pending.
 *
 * Canonical sequence:
 * Material Request → RFQ Created → Supplier Invitation → Supplier Response →
 * AI Analysis → Supplier Selection → Legal → Finance → Purchase Order → Completed
 *
 * Post-selection Legal/Finance status is read from Legal Document Review
 * (same DocType Legal & Finance dashboards use). Selection + AI + PO come
 * from RFQ/quotations/linked PO — never from a parallel mock timeline.
 */

export type RfqWorkflowStageId =
  | "material_request"
  | "rfq_created"
  | "supplier_invitation"
  | "supplier_response"
  | "ai_analysis"
  | "supplier_selected"
  | "legal_review"
  | "finance_review"
  | "purchase_order"
  | "completed";

export type RfqStepVisualState = "completed" | "current" | "pending" | "rejected";

export type SupplierSelectionStatus = "Pending" | "Recommended" | "Selected";
export type PurchaseOrderStatus = "Pending" | "Ready" | "Created";
export type WorkflowOverallStatus = "In Progress" | "Completed" | "Rejected";

export interface RfqWorkflowStep {
  id: RfqWorkflowStageId;
  label: string;
  meta: string;
  state: RfqStepVisualState;
  /** @deprecated use `state === "completed"` — kept for existing TimelineStep props */
  done: boolean;
  /** @deprecated use `state === "current"` */
  active: boolean;
  rejected: boolean;
}

export interface RfqProcurementWorkflowInput {
  transactionDate?: string;
  documentStatus?: string;
  rfqStatus?: string;
  /** Linked Material Request name(s), if any. */
  materialRequestLabel?: string | null;
  hasMaterialRequest?: boolean;
  supplierCount: number;
  respondedCount: number;
  hasQuotations: boolean;
  /** Persisted AI analysis exists for this RFQ. */
  hasAnalysis: boolean;
  analysisConfidence?: number | null;
  recommendedSupplier?: string | null;
  selectedSupplier?: string | null;
  legalStatus?: "Pending" | "Approved" | "Rejected" | "" | null;
  financeStatus?: "Pending" | "Approved" | "Rejected" | "" | null;
  legalApprovedBy?: string | null;
  legalApprovedOn?: string | null;
  financeApprovedBy?: string | null;
  financeApprovedOn?: string | null;
  poExists: boolean;
  poName?: string | null;
  /** Optional live owners from Legal Document Review (overrides stage defaults). */
  currentOwnerOverride?: string | null;
  nextApproverOverride?: string | null;
}

export interface RfqProcurementWorkflow {
  stages: RfqWorkflowStep[];
  currentStageId: RfqWorkflowStageId;
  currentStage: string;
  workflowStatus: WorkflowOverallStatus;
  documentStatus: string;
  currentOwner: string;
  nextApprover: string;
  legalStatus: string;
  financeStatus: string;
  supplierSelectionStatus: SupplierSelectionStatus;
  purchaseOrderStatus: PurchaseOrderStatus;
  legalApproved: boolean;
  financeApproved: boolean;
  legalRejected: boolean;
  financeRejected: boolean;
  hasSelectedSupplier: boolean;
  hasAnalysis: boolean;
  canCreatePO: boolean;
  /** AI card primary actions */
  aiButtonMode: "perform" | "view" | "view_and_rerun" | "finalized";
  lastUpdatedLabel?: string;
}

const STAGE_LABELS: Record<RfqWorkflowStageId, string> = {
  material_request: "Material Request",
  rfq_created: "RFQ Created",
  supplier_invitation: "Supplier Invitation",
  supplier_response: "Supplier Response",
  ai_analysis: "AI Analysis",
  supplier_selected: "Supplier Selection",
  legal_review: "Legal Review",
  finance_review: "Finance Review",
  purchase_order: "Purchase Order",
  completed: "Completed",
};

const OWNERS: Record<RfqWorkflowStageId, { current: string; next: string }> = {
  material_request: { current: "Requester", next: "Procurement" },
  rfq_created: { current: "Procurement", next: "Suppliers" },
  supplier_invitation: { current: "Procurement", next: "Suppliers" },
  supplier_response: { current: "Suppliers", next: "Procurement" },
  ai_analysis: { current: "Procurement", next: "Procurement" },
  supplier_selected: { current: "Procurement", next: "Legal Reviewer" },
  legal_review: { current: "Legal Reviewer", next: "Finance Manager" },
  finance_review: { current: "Finance Manager", next: "Procurement" },
  purchase_order: { current: "Procurement", next: "—" },
  completed: { current: "—", next: "—" },
};

const ORDER: RfqWorkflowStageId[] = [
  "material_request",
  "rfq_created",
  "supplier_invitation",
  "supplier_response",
  "ai_analysis",
  "supplier_selected",
  "legal_review",
  "finance_review",
  "purchase_order",
  "completed",
];

/**
 * Derive a sequentially gated RFQ workflow from live ERPNext signals.
 * Never invents stages or marks later steps done before earlier ones.
 */
export function deriveRfqProcurementWorkflow(
  input: RfqProcurementWorkflowInput,
): RfqProcurementWorkflow {
  const selected = (input.selectedSupplier ?? "").trim();
  const hasSelectedSupplier = selected.length > 0;
  const hasAnalysis = Boolean(input.hasAnalysis);
  const legalRaw = String(input.legalStatus ?? "").trim();
  const financeRaw = String(input.financeStatus ?? "").trim();

  // Legal/Finance are meaningless until a supplier is selected.
  const legalApproved = hasSelectedSupplier && legalRaw === "Approved";
  const legalRejected = hasSelectedSupplier && legalRaw === "Rejected";
  const financeApproved = legalApproved && financeRaw === "Approved";
  const financeRejected = legalApproved && financeRaw === "Rejected";

  // On RFQ Detail, Material Request is a prior stage (linked or N/A) and RFQ exists.
  const mrDone = input.hasMaterialRequest !== false;
  const rfqDone = true;
  const invitationDone = input.supplierCount > 0;
  const responsesDone = input.hasQuotations;
  const aiDoneRaw = hasAnalysis || hasSelectedSupplier;
  const selectionDone = hasSelectedSupplier;
  const poDone = Boolean(input.poExists) && financeApproved;
  const completedDone = poDone;

  const rawDone: Record<RfqWorkflowStageId, boolean> = {
    material_request: mrDone,
    rfq_created: rfqDone,
    supplier_invitation: invitationDone,
    supplier_response: responsesDone,
    ai_analysis: aiDoneRaw,
    supplier_selected: selectionDone,
    legal_review: legalApproved,
    finance_review: financeApproved,
    purchase_order: poDone,
    completed: completedDone,
  };

  const rawRejected: Partial<Record<RfqWorkflowStageId, boolean>> = {
    legal_review: legalRejected,
    finance_review: financeRejected,
  };

  // Sequential lock: a stage is only completed if every prior stage is completed
  // and the stage itself is raw-done. Rejected stages block the chain.
  const gatedDone: Record<RfqWorkflowStageId, boolean> = {
    material_request: false,
    rfq_created: false,
    supplier_invitation: false,
    supplier_response: false,
    ai_analysis: false,
    supplier_selected: false,
    legal_review: false,
    finance_review: false,
    purchase_order: false,
    completed: false,
  };

  let blocked = false;
  for (let i = 0; i < ORDER.length; i++) {
    const id = ORDER[i];
    if (i === 0) {
      gatedDone[id] = rawDone[id];
      continue;
    }
    const prevId = ORDER[i - 1];
    if (blocked || !gatedDone[prevId]) {
      gatedDone[id] = false;
      continue;
    }
    if (rawRejected[prevId]) {
      blocked = true;
      gatedDone[id] = false;
      continue;
    }
    gatedDone[id] = rawDone[id];
  }

  // Current = first rejected stage with priors complete, else first incomplete.
  let currentId: RfqWorkflowStageId = "material_request";
  if (gatedDone.completed) {
    currentId = "completed";
  } else {
    for (let i = 0; i < ORDER.length; i++) {
      const id = ORDER[i];
      const priorOk = i === 0 || gatedDone[ORDER[i - 1]];
      if (rawRejected[id] && priorOk) {
        currentId = id;
        break;
      }
      if (!gatedDone[id]) {
        currentId = id;
        break;
      }
    }
  }

  const stages: RfqWorkflowStep[] = ORDER.map((id, idx) => {
    const priorOk = idx === 0 || gatedDone[ORDER[idx - 1]];
    const isRejected = Boolean(rawRejected[id] && priorOk);
    const done = gatedDone[id] && !isRejected;
    const isFocus = id === currentId;
    const state: RfqStepVisualState = isRejected
      ? "rejected"
      : done
        ? "completed"
        : isFocus
          ? "current"
          : "pending";

    return {
      id,
      label: STAGE_LABELS[id],
      meta: stageMeta(id, input, {
        hasSelectedSupplier,
        legalApproved,
        financeApproved,
        isRejected,
        done,
      }),
      state,
      done,
      active: state === "current" || state === "rejected",
      rejected: isRejected,
    };
  });

  // Guarantee exactly one focus badge (Current or Rejected).
  let focusAssigned = false;
  for (const step of stages) {
    if ((step.state === "current" || step.state === "rejected") && !focusAssigned) {
      focusAssigned = true;
      step.active = true;
    } else {
      step.active = false;
      if (step.state === "current") step.state = "pending";
    }
  }

  const currentStageId = currentId;

  const supplierSelectionStatus: SupplierSelectionStatus = hasSelectedSupplier
    ? "Selected"
    : hasAnalysis && (input.recommendedSupplier ?? "").trim()
      ? "Recommended"
      : "Pending";

  const purchaseOrderStatus: PurchaseOrderStatus = poDone
    ? "Created"
    : financeApproved && !input.poExists
      ? "Ready"
      : "Pending";

  const workflowStatus: WorkflowOverallStatus =
    legalRejected || financeRejected
      ? "Rejected"
      : completedDone
        ? "Completed"
        : "In Progress";

  const owners = OWNERS[currentStageId];
  const canCreatePO =
    hasSelectedSupplier && legalApproved && financeApproved && !input.poExists;

  const aiButtonMode: RfqProcurementWorkflow["aiButtonMode"] =
    poDone || input.poExists
      ? "finalized"
      : hasAnalysis
        ? "view_and_rerun"
        : "perform";

  const currentStageLabel = STAGE_LABELS[currentStageId];

  return {
    stages,
    currentStageId,
    currentStage: currentStageLabel,
    workflowStatus,
    documentStatus: input.documentStatus || input.rfqStatus || "—",
    currentOwner:
      (input.currentOwnerOverride ?? "").trim() ||
      (workflowStatus === "Completed" ? "—" : owners.current),
    nextApprover:
      (input.nextApproverOverride ?? "").trim() ||
      (workflowStatus === "Completed" ? "—" : owners.next),
    legalStatus: !hasSelectedSupplier
      ? "—"
      : legalRejected
        ? "Rejected"
        : legalApproved
          ? "Approved"
          : legalRaw || "Pending",
    financeStatus: !legalApproved
      ? "—"
      : financeRejected
        ? "Rejected"
        : financeApproved
          ? "Approved"
          : financeRaw || "Pending",
    supplierSelectionStatus,
    purchaseOrderStatus,
    legalApproved,
    financeApproved,
    legalRejected,
    financeRejected,
    hasSelectedSupplier,
    hasAnalysis,
    canCreatePO,
    aiButtonMode,
  };
}

function stageMeta(
  id: RfqWorkflowStageId,
  input: RfqProcurementWorkflowInput,
  ctx: {
    hasSelectedSupplier: boolean;
    legalApproved: boolean;
    financeApproved: boolean;
    isRejected: boolean;
    done: boolean;
  },
): string {
  switch (id) {
    case "material_request":
      return input.materialRequestLabel?.trim() || (ctx.done ? "Linked" : "Pending");
    case "rfq_created":
      return input.transactionDate || "Created";
    case "supplier_invitation":
      return input.supplierCount > 0
        ? `${input.supplierCount} invited`
        : "Awaiting invitations";
    case "supplier_response":
      return input.hasQuotations
        ? `${input.respondedCount} of ${input.supplierCount}`
        : "Awaiting responses";
    case "ai_analysis":
      if (!ctx.done) return "Pending";
      return input.analysisConfidence != null
        ? `Confidence ${Math.round(Number(input.analysisConfidence))}%`
        : "Completed";
    case "supplier_selected":
      return ctx.hasSelectedSupplier
        ? (input.selectedSupplier ?? "Selected")
        : input.hasAnalysis && (input.recommendedSupplier ?? "").trim()
          ? `Recommended: ${input.recommendedSupplier}`
          : "Pending";
    case "legal_review":
      if (ctx.isRejected) return "Rejected";
      if (ctx.legalApproved) return "Approved";
      return ctx.hasSelectedSupplier ? "Pending" : "Locked";
    case "finance_review":
      if (ctx.isRejected) return "Rejected";
      if (ctx.financeApproved) return "Approved";
      return ctx.legalApproved ? "Pending" : "Locked";
    case "purchase_order":
      if (input.poExists) return input.poName || "Created";
      if (ctx.financeApproved) return "Ready to create";
      return "Locked";
    case "completed":
      return ctx.done ? "Workflow complete" : "Pending";
    default:
      return "Pending";
  }
}
