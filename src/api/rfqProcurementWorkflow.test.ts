import { describe, expect, it } from "vitest";
import { deriveRfqProcurementWorkflow } from "./rfqProcurementWorkflow";

describe("deriveRfqProcurementWorkflow sequential gating", () => {
  it("never marks Legal completed while Supplier Selection is pending", () => {
    const wf = deriveRfqProcurementWorkflow({
      supplierCount: 3,
      respondedCount: 2,
      hasQuotations: true,
      hasAnalysis: true,
      recommendedSupplier: "Acme",
      selectedSupplier: null,
      // LDR somehow approved without selection — must NOT unlock Legal
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

  it("unlocks Finance only after Legal approval with selection", () => {
    const wf = deriveRfqProcurementWorkflow({
      supplierCount: 2,
      respondedCount: 2,
      hasQuotations: true,
      hasAnalysis: true,
      selectedSupplier: "Acme",
      legalStatus: "Approved",
      financeStatus: "Pending",
      poExists: false,
    });

    expect(wf.stages.find((s) => s.id === "supplier_selected")!.done).toBe(true);
    expect(wf.stages.find((s) => s.id === "legal_review")!.done).toBe(true);
    expect(wf.currentStage).toBe("Finance Review");
    expect(wf.canCreatePO).toBe(false);
    expect(wf.currentOwner).toBe("Finance Manager");
  });

  it("enables Create PO only when selected + legal + finance approved", () => {
    const wf = deriveRfqProcurementWorkflow({
      supplierCount: 2,
      respondedCount: 2,
      hasQuotations: true,
      hasAnalysis: true,
      selectedSupplier: "Acme",
      legalStatus: "Approved",
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
