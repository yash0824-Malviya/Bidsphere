/**
 * RFQ procurement workflow — single source of truth for the RFQ Detail
 * timeline, Status Center, AI card gates, and Create-PO readiness.
 *
 * Stages unlock strictly left-to-right. Later stages can never appear
 * Completed/Current while an earlier stage is still Pending.
 *
 * Sequence when Contract Required = Yes:
 * Material Request → RFQ Created → Supplier Invitation → Supplier Response →
 * AI Analysis → Supplier Selection → Contract Decision → CLM Request →
 * Procurement Team Review → Contract Created → Legal Review → Finance Review →
 * Purchase Order → Completed
 *
 * Sequence when Contract Required = No:
 * Material Request → RFQ Created → Supplier Invitation → Supplier Response →
 * AI Analysis → Supplier Selection → Contract Decision → Purchase Order → Completed
 */

export type RfqWorkflowStageId =
  | "material_request"
  | "rfq_created"
  | "supplier_invitation"
  | "supplier_response"
  | "ai_analysis"
  | "supplier_selected"
  | "contract_decision"
  | "clm_request"
  | "procurement_review"
  | "contract_created"
  | "clm"
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
  /** Persisted signature/artifact proof from the same Legal Document Review. */
  legalSigned?: boolean;
  /**
   * ERPNext `workflow_state` from the Legal Document Review record.
   * The backend writes "Finance Review" after e-signature completion,
   * and "Completed" after Finance approval. Used to gate Purchase Order
   * "Ready" display so it aligns with `isRfqReadyForPurchaseOrder`.
   */
  legalWorkflowState?: string | null;
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
  /** Live CLM gate. null means verification is pending/unavailable; omitted preserves legacy callers. */
  contract?: {
    decision: "Pending" | "Yes" | "No";
    status: string;
    continuation_ready: boolean;
    blocks_procurement: boolean;
    request?: { name: string; status: string; assigned_role?: string; current_stage?: string } | null;
    contract?: { name: string; status: string; phase?: string; stage?: string } | null;
  } | null;
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
  /**
   * Raw ERPNext workflow_state from the Legal Document Review record — forwarded
   * from input for callers that need it (e.g. "Finance Review" → "Completed").
   */
  legalWorkflowState: string;
}

const STAGE_LABELS: Record<RfqWorkflowStageId, string> = {
  material_request: "Material Request",
  rfq_created: "RFQ Created",
  supplier_invitation: "Supplier Invitation",
  supplier_response: "Supplier Response",
  ai_analysis: "AI Analysis",
  supplier_selected: "Supplier Selection",
  contract_decision: "Contract Decision",
  clm_request: "CLM Request",
  procurement_review: "Procurement Team Review",
  contract_created: "Contract Created",
  clm: "CLM",
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
  supplier_selected: { current: "Procurement", next: "Procurement Team" },
  contract_decision: { current: "Procurement", next: "Procurement Team" },
  clm_request: { current: "Procurement", next: "Procurement Team" },
  procurement_review: { current: "Procurement Team", next: "Procurement Team" },
  contract_created: { current: "Procurement Team", next: "Legal Reviewer" },
  clm: { current: "Contract Management", next: "Procurement" },
  legal_review: { current: "Legal Reviewer", next: "Finance Manager" },
  finance_review: { current: "Finance Manager", next: "Procurement Team" },
  purchase_order: { current: "Procurement Team", next: "—" },
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
  const legalWorkflowStateRaw = String(input.legalWorkflowState ?? "").trim();
  const hasContractGate = input.contract !== undefined;
  // A server-verified pre-existing PO does not acquire a new decision retroactively.
  const historicalOrder = input.poExists && input.contract?.decision === "Pending" && input.contract.continuation_ready && !input.contract.blocks_procurement;
  const contractReady = !hasContractGate || historicalOrder || !!input.contract && input.contract.decision !== "Pending" && input.contract.continuation_ready && !input.contract.blocks_procurement;

  let order: RfqWorkflowStageId[];
  if (!hasContractGate || historicalOrder || !hasSelectedSupplier) {
    order = [...ORDER];
  } else if (input.contract?.decision === "Yes") {
    order = [
      "material_request",
      "rfq_created",
      "supplier_invitation",
      "supplier_response",
      "ai_analysis",
      "supplier_selected",
      "contract_decision",
      "clm_request",
      "procurement_review",
      "contract_created",
      "legal_review",
      "finance_review",
      "purchase_order",
      "completed",
    ];
  } else if (input.contract?.decision === "No") {
    order = [
      "material_request",
      "rfq_created",
      "supplier_invitation",
      "supplier_response",
      "ai_analysis",
      "supplier_selected",
      "contract_decision",
      "legal_review",
      "finance_review",
      "purchase_order",
      "completed",
    ];
  } else {
    // contract decision is pending or null
    order = [
      "material_request",
      "rfq_created",
      "supplier_invitation",
      "supplier_response",
      "ai_analysis",
      "supplier_selected",
      "contract_decision",
      "legal_review",
      "finance_review",
      "purchase_order",
      "completed",
    ];
  }

  const contractDecisionDone = hasSelectedSupplier && !!input.contract && input.contract.decision !== "Pending";
  const clmRequestDone = contractDecisionDone && input.contract?.decision === "Yes" && Boolean(input.contract.request?.name);
  const contractCreatedDone = clmRequestDone && Boolean(input.contract?.contract?.name);
  const procurementReviewDone = contractCreatedDone;

  const isContractYes = hasContractGate && input.contract?.decision === "Yes";
  const isContractNo = hasContractGate && input.contract?.decision === "No";
  const legalPrereqDone = (!hasContractGate || historicalOrder)
    ? hasSelectedSupplier
    : isContractYes
      ? contractCreatedDone
      : isContractNo
        ? contractDecisionDone
        : false;

  const contractPhase = (input.contract?.contract?.phase || "").trim();
  const contractStatus = (input.contract?.status || input.contract?.contract?.status || "").trim();
  const continuationReady = input.contract?.continuation_ready === true;

  let contractLegalApproved = false;
  let contractFinanceApproved = false;
  let contractLegalRejected = false;
  let contractFinanceRejected = false;

  if (isContractYes && contractCreatedDone && input.contract) {
    if (
      contractPhase === "finance_review" ||
      contractPhase === "procurement" ||
      contractPhase === "completed" ||
      contractStatus === "Pending Finance Approval" ||
      contractStatus === "Finance Approved" ||
      contractStatus === "Completed" ||
      (continuationReady && !contractPhase)
    ) {
      contractLegalApproved = true;
    }

    if (
      contractPhase === "procurement" ||
      contractPhase === "completed" ||
      contractStatus === "Finance Approved" ||
      contractStatus === "Completed" ||
      (continuationReady && !contractPhase && financeRaw !== "Pending")
    ) {
      contractFinanceApproved = true;
    }

    if (contractPhase === "rejected" || contractStatus === "Rejected") {
      contractLegalRejected = true;
      contractFinanceRejected = true;
    }
  }

  // Legal/Finance are evaluated from the linked Contract when Contract Required = Yes,
  // preserving the existing legalDoc evaluation when no linked Contract exists.
  const legalApproved = isContractYes && contractCreatedDone
    ? legalPrereqDone && (contractLegalApproved || (legalRaw === "Approved" && input.legalSigned === true))
    : legalPrereqDone && legalRaw === "Approved" && input.legalSigned === true;
  const legalRejected = isContractYes && contractCreatedDone
    ? legalPrereqDone && (contractLegalRejected || legalRaw === "Rejected")
    : legalPrereqDone && legalRaw === "Rejected";
  const financeApproved = isContractYes && contractCreatedDone
    ? legalApproved && (contractFinanceApproved || financeRaw === "Approved")
    : legalApproved && financeRaw === "Approved";
  const financeRejected = isContractYes && contractCreatedDone
    ? legalApproved && (contractFinanceRejected || financeRaw === "Rejected")
    : legalApproved && financeRaw === "Rejected";

  /**
   * Backend-verified PO readiness: the ERPNext backend writes `workflow_state`
   * to "Completed" only after Finance approval AND all integrity checks pass.
   * This aligns the timeline "Ready" badge with the real `isRfqReadyForPurchaseOrder`
   * gate used at PO creation time, so the display never shows "Ready" prematurely.
   */
  const legalWorkflowStateProvided = input.legalWorkflowState !== undefined && input.legalWorkflowState !== null;
  const legalWorkflowCompleted =
    legalWorkflowStateRaw === "Completed" || legalWorkflowStateRaw === "Procurement";
  const financeVerifiedForPO = historicalOrder || isContractYes
    ? financeApproved
    : legalWorkflowStateProvided
      ? financeApproved && legalWorkflowCompleted
      : financeApproved;

  // On RFQ Detail, Material Request is a prior stage (linked or N/A) and RFQ exists.
  const mrDone = input.hasMaterialRequest !== false;
  const rfqDone = true;
  const invitationDone = input.supplierCount > 0;
  const responsesDone = input.hasQuotations;
  const aiDoneRaw = hasAnalysis || hasSelectedSupplier;
  const selectionDone = hasSelectedSupplier;

  const poDone = Boolean(input.poExists) && (historicalOrder || (financeVerifiedForPO && contractReady));
  const completedDone = poDone;

  const rawDone: Record<RfqWorkflowStageId, boolean> = {
    material_request: mrDone,
    rfq_created: rfqDone,
    supplier_invitation: invitationDone,
    supplier_response: responsesDone,
    ai_analysis: aiDoneRaw,
    supplier_selected: selectionDone,
    contract_decision: contractDecisionDone,
    clm_request: clmRequestDone,
    procurement_review: procurementReviewDone,
    contract_created: contractCreatedDone,
    clm: contractReady,
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
    contract_decision: false,
    clm_request: false,
    procurement_review: false,
    contract_created: false,
    clm: false,
    legal_review: false,
    finance_review: false,
    purchase_order: false,
    completed: false,
  };

  let blocked = false;
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    if (i === 0) {
      gatedDone[id] = rawDone[id];
      continue;
    }
    const prevId = order[i - 1];
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
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      const priorOk = i === 0 || gatedDone[order[i - 1]];
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

  const stages: RfqWorkflowStep[] = order.map((id, idx) => {
    const priorOk = idx === 0 || gatedDone[order[idx - 1]];
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
        legalPrereqDone,
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

  const canCreatePO = historicalOrder
    ? hasSelectedSupplier && !input.poExists
    : hasSelectedSupplier && legalApproved && financeVerifiedForPO && contractReady && !input.poExists;

  const purchaseOrderStatus: PurchaseOrderStatus = poDone
    ? "Created"
    : canCreatePO
      ? "Ready"
      : "Pending";

  const workflowStatus: WorkflowOverallStatus =
    (legalRejected || financeRejected) && contractReady
      ? "Rejected"
      : completedDone
        ? "Completed"
        : "In Progress";

  const owners = OWNERS[currentStageId] || { current: "Procurement", next: "—" };

  const aiButtonMode: RfqProcurementWorkflow["aiButtonMode"] =
    poDone || input.poExists
      ? "finalized"
      : hasAnalysis
        ? "view_and_rerun"
        : "perform";

  const currentStageLabel = STAGE_LABELS[currentStageId] || currentStageId;
  const isClmPhase =
    isContractYes ||
    currentStageId === "contract_decision" ||
    currentStageId === "clm_request" ||
    currentStageId === "procurement_review" ||
    currentStageId === "contract_created" ||
    currentStageId === "clm";

  return {
    stages,
    currentStageId,
    currentStage: currentStageLabel,
    workflowStatus,
    documentStatus: input.documentStatus || input.rfqStatus || "—",
    currentOwner:
      (!isClmPhase && (input.currentOwnerOverride ?? "").trim()) ||
      (workflowStatus === "Completed" ? "—" : owners.current),
    nextApprover:
      (!isClmPhase && (input.nextApproverOverride ?? "").trim()) ||
      (workflowStatus === "Completed" ? "—" : owners.next),
    legalStatus: !hasSelectedSupplier
      ? "—"
      : legalRejected
        ? "Rejected"
        : legalApproved
          ? "Approved"
          : !legalPrereqDone
            ? "Locked"
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
    legalWorkflowState: legalWorkflowStateRaw,
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
    legalPrereqDone: boolean;
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
          ? `Top score: ${input.recommendedSupplier}`
          : "Pending";
    case "contract_decision":
      if (!ctx.hasSelectedSupplier) return "Locked";
      if (!input.contract) return "Verifying saved decision";
      if (input.contract.decision === "Pending") return "Contract / CLM required?";
      return input.contract.decision === "Yes" ? "Contract required" : "No contract required";
    case "clm_request":
      if (input.contract?.request?.name) return input.contract.request.name;
      return ctx.done ? "Created" : "Pending";
    case "procurement_review":
      if (input.contract?.contract?.name) return "Reviewed";
      if (input.contract?.request?.name) return "Pending Procurement Team";
      return "Locked";
    case "contract_created":
      if (input.contract?.contract?.name) return input.contract.contract.name;
      return "Pending";
    case "clm":
      return input.contract?.status || "Awaiting CLM";
    case "legal_review":
      if (ctx.isRejected) return "Rejected";
      if (ctx.legalApproved) return "Approved";
      if (!ctx.legalPrereqDone) return "Locked";
      if (input.contract?.contract?.phase === "signature" || input.contract?.status === "Pending Signatures") {
        return "Pending Signature";
      }
      return ctx.hasSelectedSupplier ? "Pending" : "Locked";
    case "finance_review":
      if (ctx.isRejected) return "Rejected";
      if (ctx.financeApproved) return "Approved";
      return ctx.legalApproved ? "Pending" : "Locked";
    case "purchase_order":
      if (input.poExists) return input.poName || "Created";
      if (ctx.financeApproved && (input.contract === undefined || (input.contract?.continuation_ready && !input.contract.blocks_procurement))) return "Ready to create";
      return "Locked";
    case "completed":
      return ctx.done ? "Workflow complete" : "Pending";
    default:
      return "Pending";
  }
}
