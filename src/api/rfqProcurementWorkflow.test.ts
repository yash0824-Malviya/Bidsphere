import { describe, expect, it } from "vitest";
import { deriveRfqProcurementWorkflow } from "./rfqProcurementWorkflow";

describe("RFQ conditional CLM branch", () => {
  const approvedAward = {
    supplierCount: 2,
    respondedCount: 2,
    hasQuotations: true,
    hasAnalysis: true,
    selectedSupplier: "Acme",
    legalStatus: "Approved" as const,
    legalSigned: true,
    financeStatus: "Approved" as const,
    poExists: false,
  };

  it.each([
    null,
    { decision: "Pending" as const, status: "Decision Required", continuation_ready: false, blocks_procurement: true },
  ])("holds the awarded RFQ before a verified decision: %j", (contract) => {
    const workflow = deriveRfqProcurementWorkflow({ ...approvedAward, contract, currentOwnerOverride: "Finance Manager" });
    expect(workflow.currentStageId).toBe("contract_decision");
    expect(workflow.currentOwner).toBe("Procurement");
    expect(workflow.canCreatePO).toBe(false);
    expect(workflow.purchaseOrderStatus).toBe("Pending");
    expect(workflow.stages.some((row) => row.id === "clm_request")).toBe(false);
    expect(workflow.stages.filter((row) => row.active)).toHaveLength(1);
  });

  it("advances Yes workflow to clm_request when no request is created yet", () => {
    const workflow = deriveRfqProcurementWorkflow({
      ...approvedAward,
      contract: { decision: "Yes", status: "Awaiting Request", continuation_ready: false, blocks_procurement: true },
    });
    expect(workflow.currentStageId).toBe("clm_request");
    expect(workflow.workflowStatus).toBe("In Progress");
    expect(workflow.canCreatePO).toBe(false);
    expect(workflow.stages.find((row) => row.id === "clm_request")?.state).toBe("current");
    expect(workflow.stages.find((row) => row.id === "procurement_review")?.state).toBe("pending");
    expect(workflow.stages.find((row) => row.id === "legal_review")?.state).toBe("pending");
  });

  it("advances Yes workflow to procurement_review when request exists but contract is not yet created", () => {
    const workflow = deriveRfqProcurementWorkflow({
      ...approvedAward,
      contract: {
        decision: "Yes",
        status: "Pending Procurement Team",
        continuation_ready: false,
        blocks_procurement: true,
        request: { name: "CTRQ-2026-0001", status: "Pending Review", assigned_role: "procurement_team" },
      },
    });
    expect(workflow.currentStageId).toBe("procurement_review");
    expect(workflow.currentOwner).toBe("Procurement Team");
    expect(workflow.canCreatePO).toBe(false);
    expect(workflow.stages.find((row) => row.id === "clm_request")?.done).toBe(true);
    expect(workflow.stages.find((row) => row.id === "procurement_review")?.state).toBe("current");
    expect(workflow.stages.find((row) => row.id === "legal_review")?.state).toBe("pending");
    expect(workflow.stages.find((row) => row.id === "legal_review")?.meta).toBe("Locked");
  });

  it("unlocks Legal Review after contract is created", () => {
    const workflow = deriveRfqProcurementWorkflow({
      ...approvedAward,
      legalStatus: "Pending",
      legalSigned: false,
      contract: {
        decision: "Yes",
        status: "Pending Legal Review",
        continuation_ready: false,
        blocks_procurement: true,
        request: { name: "CTRQ-2026-0001", status: "Approved", assigned_role: "procurement_team" },
        contract: { name: "CON-2026-0001", status: "Pending Legal" },
      },
    });
    expect(workflow.currentStageId).toBe("legal_review");
    expect(workflow.currentOwner).toBe("Legal Reviewer");
    expect(workflow.canCreatePO).toBe(false);
    expect(workflow.stages.find((row) => row.id === "contract_created")?.done).toBe(true);
    expect(workflow.stages.find((row) => row.id === "legal_review")?.state).toBe("current");
  });

  it("preserves Legal Review and Finance Review when Contract Required = No", () => {
    const workflow = deriveRfqProcurementWorkflow({
      ...approvedAward,
      contract: { decision: "No", status: "Not Required", continuation_ready: true, blocks_procurement: false },
    });
    expect(workflow.currentStageId).toBe("purchase_order");
    expect(workflow.canCreatePO).toBe(true);
    expect(workflow.purchaseOrderStatus).toBe("Ready");
    expect(workflow.stages.map((s) => s.id)).toEqual([
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
    ]);

    const legalPending = deriveRfqProcurementWorkflow({
      ...approvedAward,
      legalStatus: "Pending",
      legalSigned: false,
      contract: { decision: "No", status: "Not Required", continuation_ready: true, blocks_procurement: false },
    });
    expect(legalPending.currentStageId).toBe("legal_review");
    expect(legalPending.canCreatePO).toBe(false);

    const financePending = deriveRfqProcurementWorkflow({
      ...approvedAward,
      financeStatus: "Pending",
      contract: { decision: "No", status: "Not Required", continuation_ready: true, blocks_procurement: false },
    });
    expect(financePending.currentStageId).toBe("finance_review");
    expect(financePending.canCreatePO).toBe(false);
  });

  it("unlocks PO creation for Yes decision after contract creation, legal approval, and finance approval", () => {
    const contract = {
      decision: "Yes" as const,
      status: "Executed",
      continuation_ready: true,
      blocks_procurement: false,
      request: { name: "CTRQ-2026-0001", status: "Approved" },
      contract: { name: "CON-2026-0001", status: "Active" },
    };
    const workflow = deriveRfqProcurementWorkflow({ ...approvedAward, contract });
    expect(workflow.canCreatePO).toBe(true);
    expect(workflow.currentStageId).toBe("purchase_order");
    expect(workflow.purchaseOrderStatus).toBe("Ready");

    const completed = deriveRfqProcurementWorkflow({ ...approvedAward, contract, poExists: true });
    expect(completed.workflowStatus).toBe("Completed");
    expect(completed.currentStageId).toBe("completed");

    const financePending = deriveRfqProcurementWorkflow({ ...approvedAward, contract, financeStatus: "Pending" });
    expect(financePending.canCreatePO).toBe(false);
    expect(financePending.currentStageId).toBe("finance_review");
  });

  it("synchronizes downstream contract stages from linked Contract state (PUR-RFQ-2026-00117 / CON-2026-00005)", () => {
    // When Contract Required = Yes, the standalone legalDoc remains in review_status: "Pending".
    // Downstream contract progress must derive from the actual linked Contract's saved lifecycle state.
    const workflow = deriveRfqProcurementWorkflow({
      ...approvedAward,
      legalStatus: "Pending",
      legalSigned: false,
      financeStatus: "",
      contract: {
        decision: "Yes",
        status: "Finance Approved",
        continuation_ready: true,
        blocks_procurement: false,
        request: { name: "CTRQ-2026-0011", status: "Completed" },
        contract: {
          name: "CON-2026-00005",
          status: "Executed",
          phase: "procurement",
          stage: "Procurement Finalization",
        },
      },
    });

    expect(workflow.legalApproved).toBe(true);
    expect(workflow.financeApproved).toBe(true);
    expect(workflow.stages.find((s) => s.id === "contract_created")?.done).toBe(true);
    expect(workflow.stages.find((s) => s.id === "legal_review")?.done).toBe(true);
    expect(workflow.stages.find((s) => s.id === "legal_review")?.meta).toBe("Approved");
    expect(workflow.stages.find((s) => s.id === "finance_review")?.done).toBe(true);
    expect(workflow.stages.find((s) => s.id === "finance_review")?.meta).toBe("Approved");
    expect(workflow.stages.find((s) => s.id === "purchase_order")?.state).toBe("current");
    expect(workflow.stages.find((s) => s.id === "purchase_order")?.meta).toBe("Ready to create");
    expect(workflow.currentStageId).toBe("purchase_order");
    expect(workflow.currentOwner).toBe("Procurement Team");
    expect(workflow.canCreatePO).toBe(true);
    expect(workflow.purchaseOrderStatus).toBe("Ready");
  });

  it("shows finance_review as current stage when linked Contract is in finance_review phase", () => {
    const workflow = deriveRfqProcurementWorkflow({
      ...approvedAward,
      legalStatus: "Pending",
      legalSigned: false,
      financeStatus: "",
      contract: {
        decision: "Yes",
        status: "Pending Finance Approval",
        continuation_ready: false,
        blocks_procurement: true,
        request: { name: "CTRQ-2026-0011", status: "Completed" },
        contract: {
          name: "CON-2026-00005",
          status: "Pending Finance",
          phase: "finance_review",
          stage: "Finance Approval",
        },
      },
    });

    expect(workflow.legalApproved).toBe(true);
    expect(workflow.financeApproved).toBe(false);
    expect(workflow.stages.find((s) => s.id === "legal_review")?.done).toBe(true);
    expect(workflow.stages.find((s) => s.id === "finance_review")?.state).toBe("current");
    expect(workflow.currentStageId).toBe("finance_review");
    expect(workflow.currentOwner).toBe("Finance Manager");
    expect(workflow.canCreatePO).toBe(false);
  });

  it("shows legal_review with Pending Signature meta when linked Contract is in signature phase", () => {
    const workflow = deriveRfqProcurementWorkflow({
      ...approvedAward,
      legalStatus: "Pending",
      legalSigned: false,
      financeStatus: "",
      contract: {
        decision: "Yes",
        status: "Pending Signatures",
        continuation_ready: false,
        blocks_procurement: true,
        request: { name: "CTRQ-2026-0011", status: "Completed" },
        contract: {
          name: "CON-2026-00005",
          status: "Pending Signature",
          phase: "signature",
          stage: "E-Signature",
        },
      },
    });

    expect(workflow.legalApproved).toBe(false);
    expect(workflow.financeApproved).toBe(false);
    expect(workflow.stages.find((s) => s.id === "legal_review")?.state).toBe("current");
    expect(workflow.stages.find((s) => s.id === "legal_review")?.meta).toBe("Pending Signature");
    expect(workflow.currentStageId).toBe("legal_review");
    expect(workflow.currentOwner).toBe("Legal Reviewer");
    expect(workflow.canCreatePO).toBe(false);
  });

  it("does not alter any pre-award stage", () => {
    const input = { ...approvedAward, selectedSupplier: "", hasAnalysis: false, legalStatus: "Pending" as const, legalSigned: false };
    const original = deriveRfqProcurementWorkflow(input);
    const branch = deriveRfqProcurementWorkflow({ ...input, contract: null });
    expect(branch.stages).toEqual(original.stages);
    expect(branch.currentStageId).toBe(original.currentStageId);
  });

  it("preserves completed historical POs without a retrospective contract decision step", () => {
    const input = { ...approvedAward, poExists: true, poName: "PO-existing" };
    const original = deriveRfqProcurementWorkflow(input);
    const historical = deriveRfqProcurementWorkflow({
      ...input,
      contract: { decision: "Pending", status: "Existing Purchase Order", continuation_ready: true, blocks_procurement: false },
    });
    expect(historical).toEqual(original);
    expect(historical.currentStageId).toBe("completed");
    expect(historical.workflowStatus).toBe("Completed");
    expect(historical.stages.some((row) => row.id === "contract_decision")).toBe(false);
  });

  it("does not treat an RFQ without a PO as historical merely because a summary says ready", () => {
    const workflow = deriveRfqProcurementWorkflow({
      ...approvedAward,
      contract: { decision: "Pending", status: "Existing Purchase Order", continuation_ready: true, blocks_procurement: false },
    });
    expect(workflow.currentStageId).toBe("contract_decision");
    expect(workflow.canCreatePO).toBe(false);
  });
});

describe("deriveRfqProcurementWorkflow sequential gating", () => {
  it("labels an unselected numerical score leader without implying an award recommendation", () => {
    const workflow = deriveRfqProcurementWorkflow({
      supplierCount: 3,
      respondedCount: 3,
      hasQuotations: true,
      hasAnalysis: true,
      recommendedSupplier: "Apex Fasteners Ltd",
      selectedSupplier: null,
      legalStatus: "Pending",
      financeStatus: "Pending",
      poExists: false,
    });
    expect(workflow.stages.find((stage) => stage.id === "supplier_selected")).toMatchObject({
      meta: "Top score: Apex Fasteners Ltd",
      state: "current",
      done: false,
    });
    expect(workflow.hasSelectedSupplier).toBe(false);
    expect(workflow.canCreatePO).toBe(false);
    expect(workflow.stages.find((stage) => stage.id === "legal_review")?.state).toBe("pending");
  });

  it("never marks Legal completed while Supplier Selection is pending", () => {
    const wf = deriveRfqProcurementWorkflow({
      supplierCount: 3,
      respondedCount: 2,
      hasQuotations: true,
      hasAnalysis: true,
      recommendedSupplier: "Acme",
      selectedSupplier: null,
      legalStatus: "Approved",
      financeStatus: "Pending",
      poExists: false,
    });

    const selection = wf.stages.find((s) => s.id === "supplier_selected")!;
    const legal = wf.stages.find((s) => s.id === "legal_review")!;
    const finance = wf.stages.find((s) => s.id === "finance_review")!;
    const po = wf.stages.find((s) => s.id === "purchase_order")!;

    expect(selection.state).toBe("current");
    expect(legal.state).toBe("pending");
    expect(legal.done).toBe(false);
    expect(finance.done).toBe(false);
    expect(po.done).toBe(false);
    expect(wf.currentStage).toBe("Supplier Selection");
    expect(wf.stages.filter((s) => s.active).length).toBe(1);
  });

  it("never marks Finance or PO current before Supplier Selection", () => {
    const wf = deriveRfqProcurementWorkflow({
      supplierCount: 2,
      respondedCount: 2,
      hasQuotations: true,
      hasAnalysis: false,
      selectedSupplier: "",
      legalStatus: "Approved",
      financeStatus: "Approved",
      poExists: false,
    });

    expect(wf.currentStage).toBe("AI Analysis");
    expect(wf.stages.find((s) => s.id === "finance_review")!.state).toBe("pending");
    expect(wf.stages.find((s) => s.id === "purchase_order")!.state).toBe("pending");
    expect(wf.canCreatePO).toBe(false);
  });

  it("unlocks Finance only after Legal signature with selection", () => {
    const wf = deriveRfqProcurementWorkflow({
      supplierCount: 2,
      respondedCount: 2,
      hasQuotations: true,
      hasAnalysis: true,
      selectedSupplier: "Acme",
      legalStatus: "Approved",
      legalSigned: true,
      financeStatus: "Pending",
      poExists: false,
    });

    expect(wf.stages.find((s) => s.id === "supplier_selected")!.done).toBe(true);
    expect(wf.stages.find((s) => s.id === "legal_review")!.done).toBe(true);
    expect(wf.currentStage).toBe("Finance Review");
    expect(wf.canCreatePO).toBe(false);
    expect(wf.currentOwner).toBe("Finance Manager");
  });

  it("enables Create PO only when selected + signed + finance approved", () => {
    const wf = deriveRfqProcurementWorkflow({
      supplierCount: 2,
      respondedCount: 2,
      hasQuotations: true,
      hasAnalysis: true,
      selectedSupplier: "Acme",
      legalStatus: "Approved",
      legalSigned: true,
      financeStatus: "Approved",
      poExists: false,
    });

    expect(wf.canCreatePO).toBe(true);
    expect(wf.purchaseOrderStatus).toBe("Ready");
    expect(wf.currentStage).toBe("Purchase Order");
    expect(wf.aiButtonMode).toBe("view_and_rerun");
  });

  it("surfaces Completed when PO exists after full approval", () => {
    const wf = deriveRfqProcurementWorkflow({
      supplierCount: 2,
      respondedCount: 2,
      hasQuotations: true,
      hasAnalysis: true,
      selectedSupplier: "Acme",
      legalStatus: "Approved",
      legalSigned: true,
      financeStatus: "Approved",
      poExists: true,
      poName: "PO-1",
    });

    expect(wf.workflowStatus).toBe("Completed");
    expect(wf.currentStage).toBe("Completed");
    expect(wf.canCreatePO).toBe(false);
    expect(wf.purchaseOrderStatus).toBe("Created");
    expect(wf.stages.find((s) => s.id === "completed")!.done).toBe(true);
  });

  it("marks Legal as rejected and blocks Finance/PO", () => {
    const wf = deriveRfqProcurementWorkflow({
      supplierCount: 2,
      respondedCount: 2,
      hasQuotations: true,
      hasAnalysis: true,
      selectedSupplier: "Acme",
      legalStatus: "Rejected",
      financeStatus: "",
      poExists: false,
    });

    expect(wf.stages.find((s) => s.id === "legal_review")!.state).toBe("rejected");
    expect(wf.stages.find((s) => s.id === "finance_review")!.done).toBe(false);
    expect(wf.workflowStatus).toBe("Rejected");
    expect(wf.stages.filter((s) => s.active || s.state === "current").length).toBeLessThanOrEqual(1);
  });

  it("blocks Finance and PO when statuses are approved without signature proof", () => {
    const wf = deriveRfqProcurementWorkflow({
      supplierCount: 1,
      respondedCount: 1,
      hasQuotations: true,
      hasAnalysis: true,
      selectedSupplier: "Acme",
      legalStatus: "Approved",
      financeStatus: "Approved",
      poExists: false,
    });
    expect(wf.canCreatePO).toBe(false);
    expect(wf.currentStage).toBe("Legal Review");
    expect(wf.purchaseOrderStatus).toBe("Pending");
  });

  it("exposes the full enterprise stage sequence", () => {
    const wf = deriveRfqProcurementWorkflow({
      hasMaterialRequest: true,
      materialRequestLabel: "MAT-001",
      supplierCount: 2,
      respondedCount: 0,
      hasQuotations: false,
      hasAnalysis: false,
      poExists: false,
    });

    expect(wf.stages.map((s) => s.id)).toEqual([
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
    ]);
    expect(wf.currentStage).toBe("Supplier Response");
  });
});
