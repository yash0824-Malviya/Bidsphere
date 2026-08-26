import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRfqFromPrCore,
  type CreateRfqFromPrDependencies,
} from "./createRfqFromPrCore";

function dependencies(): CreateRfqFromPrDependencies {
  return {
    loadPr: vi.fn().mockResolvedValue({
      name: "PR-0001",
      status: "Approved",
      requisition_title: "Standalone latch sourcing",
      required_date: "2026-08-31",
      requisition_items: [{
        partitem: "ENG012",
        description: "Real source item",
        quantity: 2,
        uom: "Nos",
      }],
    }),
    loadRfq: vi.fn().mockImplementation(async (name: string) => ({
      name,
      docstatus: 0,
      custom_purchase_requisition_reference: "PR-0001",
      custom_bidsphere_pr_idempotency_key: "PR-0001",
    })),
    assertSupplierExists: vi.fn().mockResolvedValue(undefined),
    findExistingRfq: vi.fn().mockResolvedValue(null),
    createRfq: vi.fn().mockResolvedValue("PUR-RFQ-2026-00020"),
    updatePr: vi.fn().mockResolvedValue(undefined),
    updateRfq: vi.fn().mockResolvedValue(undefined),
    applyWorkflow: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createRfqFromPrCore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an ECR-linked PR before reading, creating, linking, or advancing an RFQ", async () => {
    const deps = dependencies();
    vi.mocked(deps.loadPr).mockResolvedValue({
      name: "PR-0001",
      status: "Draft",
      ecr_reference: "ECR-0001",
      requisition_items: [{ partitem: "ENG012", quantity: 2, uom: "Nos" }],
    });

    await expect(createRfqFromPrCore({
      prName: "PR-0001",
      suppliers: ["SUP-001"],
    }, deps)).rejects.toMatchObject({
      status: 409,
      code: "conflict",
      message: expect.stringMatching(/linked to ECR ECR-0001.*create-rfq-from-ecr/i),
    });
    expect(deps.findExistingRfq).not.toHaveBeenCalled();
    expect(deps.loadRfq).not.toHaveBeenCalled();
    expect(deps.assertSupplierExists).not.toHaveBeenCalled();
    expect(deps.createRfq).not.toHaveBeenCalled();
    expect(deps.updatePr).not.toHaveBeenCalled();
    expect(deps.applyWorkflow).not.toHaveBeenCalled();
  });

  it("does not allow an already-linked RFQ to replay through an ECR-linked PR", async () => {
    const deps = dependencies();
    vi.mocked(deps.loadPr).mockResolvedValue({
      name: "PR-0001",
      status: "RFQ Created",
      ecr_reference: "ECR-0001",
      rfq: "PUR-RFQ-2026-00018",
      requisition_items: [],
    });

    await expect(createRfqFromPrCore({
      prName: "PR-0001",
      suppliers: [],
    }, deps)).rejects.toMatchObject({ status: 409, code: "conflict" });
    expect(deps.loadRfq).not.toHaveBeenCalled();
    expect(deps.applyWorkflow).not.toHaveBeenCalled();
  });

  it("creates an RFQ for a standalone PR and never writes ECR traceability", async () => {
    const deps = dependencies();
    const result = await createRfqFromPrCore({
      prName: "PR-0001",
      suppliers: ["SUP-001", "SUP-001"],
    }, deps);

    expect(result).toMatchObject({
      success: true,
      rfqName: "PUR-RFQ-2026-00020",
      created: true,
      warnings: [],
    });
    expect(deps.assertSupplierExists).toHaveBeenCalledTimes(1);
    expect(deps.createRfq).toHaveBeenCalledWith(expect.objectContaining({
      suppliers: [{ supplier: "SUP-001" }],
      custom_purchase_requisition_reference: "PR-0001",
      custom_bidsphere_pr_idempotency_key: "PR-0001",
    }));
    expect(deps.createRfq).toHaveBeenCalledWith(
      expect.not.objectContaining({ custom_ecr_reference: expect.anything() }),
    );
    expect(deps.updatePr).toHaveBeenCalledWith("PR-0001", {
      rfq: "PUR-RFQ-2026-00020",
    });
    expect(deps.applyWorkflow).toHaveBeenCalledTimes(1);
    expect(deps.applyWorkflow).toHaveBeenCalledWith(
      "Purchase Requisition",
      "PR-0001",
      "Mark RFQ Created",
    );
    expect(deps.applyWorkflow).not.toHaveBeenCalledWith(
      "Engineering Change Request",
      expect.any(String),
      expect.any(String),
    );
  });

  it("reports standalone PR workflow follow-up honestly", async () => {
    const deps = dependencies();
    vi.mocked(deps.applyWorkflow).mockRejectedValueOnce(new Error("Transition unavailable"));

    const result = await createRfqFromPrCore({
      prName: "PR-0001",
      suppliers: ["SUP-001"],
    }, deps);

    expect(result.warnings).toEqual([
      "PR workflow was not advanced: Transition unavailable",
    ]);
    expect(result.message).toMatch(/follow-up is required/i);
  });

  it("recovers an RFQ found by standalone PR traceability instead of duplicating it", async () => {
    const deps = dependencies();
    vi.mocked(deps.findExistingRfq).mockResolvedValue("PUR-RFQ-2026-00019");

    await expect(createRfqFromPrCore({
      prName: "PR-0001",
      suppliers: ["SUP-001"],
    }, deps)).resolves.toMatchObject({
      rfqName: "PUR-RFQ-2026-00019",
      created: false,
    });
    expect(deps.createRfq).not.toHaveBeenCalled();
    expect(deps.loadRfq).toHaveBeenCalledWith("PUR-RFQ-2026-00019");
    expect(deps.updatePr).toHaveBeenCalledWith("PR-0001", {
      rfq: "PUR-RFQ-2026-00019",
    });
  });

  it("recovers the winning standalone RFQ when concurrent creation hits the unique PR key", async () => {
    const deps = dependencies();
    vi.mocked(deps.findExistingRfq)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("PUR-RFQ-2026-00021");
    vi.mocked(deps.createRfq).mockRejectedValueOnce(
      new Error("Duplicate entry for custom_bidsphere_pr_idempotency_key"),
    );

    await expect(createRfqFromPrCore({
      prName: "PR-0001",
      suppliers: ["SUP-001"],
    }, deps)).resolves.toMatchObject({
      rfqName: "PUR-RFQ-2026-00021",
      created: false,
    });
    expect(deps.loadRfq).toHaveBeenCalledWith("PUR-RFQ-2026-00021");
  });

  it("returns an already-linked standalone RFQ idempotently", async () => {
    const deps = dependencies();
    vi.mocked(deps.loadPr).mockResolvedValue({
      name: "PR-0001",
      status: "RFQ Created",
      rfq: "PUR-RFQ-2026-00018",
      requisition_items: [],
    });

    await expect(createRfqFromPrCore({
      prName: "PR-0001",
      suppliers: [],
    }, deps)).resolves.toMatchObject({
      rfqName: "PUR-RFQ-2026-00018",
      created: false,
      warnings: [],
    });
    expect(deps.createRfq).not.toHaveBeenCalled();
    expect(deps.applyWorkflow).not.toHaveBeenCalled();
  });

  it("heals a missed standalone PR workflow transition on replay", async () => {
    const deps = dependencies();
    vi.mocked(deps.loadPr).mockResolvedValue({
      name: "PR-0001",
      status: "Approved",
      rfq: "PUR-RFQ-2026-00018",
      requisition_items: [],
    });

    await expect(createRfqFromPrCore({
      prName: "PR-0001",
      suppliers: [],
    }, deps)).resolves.toMatchObject({ created: false, warnings: [] });
    expect(deps.applyWorkflow).toHaveBeenCalledWith(
      "Purchase Requisition",
      "PR-0001",
      "Mark RFQ Created",
    );
  });

  it("rejects an already-linked RFQ without trusted standalone PR traceability", async () => {
    const deps = dependencies();
    vi.mocked(deps.loadPr).mockResolvedValue({
      name: "PR-0001",
      status: "RFQ Created",
      rfq: "PUR-RFQ-2026-00018",
      requisition_items: [],
    });
    vi.mocked(deps.loadRfq).mockResolvedValue({
      name: "PUR-RFQ-2026-00018",
      docstatus: 0,
    });

    await expect(createRfqFromPrCore({
      prName: "PR-0001",
      suppliers: [],
    }, deps)).rejects.toMatchObject({
      status: 409,
      code: "conflict",
      rfqName: "PUR-RFQ-2026-00018",
      message: expect.stringContaining("trusted traceability"),
    });
    expect(deps.updatePr).not.toHaveBeenCalled();
  });

  it("rejects a reusable PR RFQ carrying ECR traceability", async () => {
    const deps = dependencies();
    vi.mocked(deps.findExistingRfq).mockResolvedValue("PUR-RFQ-2026-00018");
    vi.mocked(deps.loadRfq).mockResolvedValue({
      name: "PUR-RFQ-2026-00018",
      docstatus: 0,
      custom_purchase_requisition_reference: "PR-0001",
      custom_bidsphere_pr_idempotency_key: "PR-0001",
      custom_ecr_reference: "ECR-0001",
    });

    await expect(createRfqFromPrCore({
      prName: "PR-0001",
      suppliers: ["SUP-001"],
    }, deps)).rejects.toMatchObject({
      status: 409,
      code: "conflict",
      message: expect.stringMatching(/ECR-0001.*create-rfq-from-ecr/i),
    });
    expect(deps.updatePr).not.toHaveBeenCalled();
  });

  it("rejects a cancelled RFQ instead of reusing it", async () => {
    const deps = dependencies();
    vi.mocked(deps.loadPr).mockResolvedValue({
      name: "PR-0001",
      status: "RFQ Created",
      rfq: "PUR-RFQ-2026-00018",
      requisition_items: [],
    });
    vi.mocked(deps.loadRfq).mockResolvedValue({
      name: "PUR-RFQ-2026-00018",
      docstatus: 2,
      custom_bidsphere_pr_idempotency_key: "PR-0001",
    });

    await expect(createRfqFromPrCore({
      prName: "PR-0001",
      suppliers: [],
    }, deps)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("cancelled or inactive"),
    });
  });

  it("heals missing standalone PR trace fields without adding ECR traceability", async () => {
    const deps = dependencies();
    vi.mocked(deps.loadPr).mockResolvedValue({
      name: "PR-0001",
      status: "Approved",
      rfq: "PUR-RFQ-2026-00018",
      requisition_items: [],
    });
    vi.mocked(deps.loadRfq).mockResolvedValue({
      name: "PUR-RFQ-2026-00018",
      docstatus: 1,
      custom_purchase_requisition_reference: "PR-0001",
    });

    await expect(createRfqFromPrCore({
      prName: "PR-0001",
      suppliers: [],
    }, deps)).resolves.toMatchObject({ success: true, created: false });
    expect(deps.updateRfq).toHaveBeenCalledWith("PUR-RFQ-2026-00018", {
      custom_bidsphere_pr_idempotency_key: "PR-0001",
    });
  });
});
