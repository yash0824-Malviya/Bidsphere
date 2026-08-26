import { describe, expect, it, vi } from "vitest";
import {
  createPrFromEcrCore,
  ECR_PR_IDEMPOTENCY_FIELD,
  type CreatePrFromEcrDependencies,
  type PurchaseRequisitionTrace,
  type SourceEcr,
} from "./createPrFromEcrCore";
import type { InternalEcrPrincipal } from "./ecrWorkflowCore";

function principal(role: InternalEcrPrincipal["role"] = "procurement_team"): InternalEcrPrincipal {
  return {
    typ: "internal",
    sub: `${role}@netlink.com`,
    email: `${role}@netlink.com`,
    role,
    iat: 1,
    exp: 9_999_999_999,
  };
}

function baseEcr(overrides: Partial<SourceEcr> = {}): SourceEcr {
  return {
    name: "ECR-2026-100001",
    modified: "2026-08-26 10:30:00.000001",
    ecr_number: "ECR-2026-100001",
    select_pxfp: "Approved",
    supplier_response_required: "Yes",
    procurement_reference_type: "None",
    ecr_title: "Door latch redesign",
    ecr_owner: "engineer@netlink.com",
    requesting_department: "Engineering",
    plant: "Plant 1",
    target_implementation_date: "2026-09-30",
    priority: "High",
    chnage_description: "Update the latch geometry.",
    reason_for_change: "Durability improvement.",
    ecr_type: "Design Change",
    suggested_supplier: "SUP-001",
    affected_parts: [{
      partitem: "LAT-4401",
      part_description: "Door Latch",
      new_revision: "B",
      quantity: 2,
      uom: "Nos",
      plant: "Plant 1",
      proposed_supplier: "SUP-001",
      change_required: "Update geometry",
      technical_notes: "Use revision B drawing",
    }],
    ...overrides,
  };
}

function mutableDependencies(
  ecrOverrides: Partial<SourceEcr> = {},
  initialPrs: PurchaseRequisitionTrace[] = [],
): {
  deps: CreatePrFromEcrDependencies;
  getEcr: () => SourceEcr;
  getPrs: () => PurchaseRequisitionTrace[];
} {
  let ecr = baseEcr(ecrOverrides);
  const prs = new Map(initialPrs.map((pr) => [pr.name, { ...pr }]));
  const deps: CreatePrFromEcrDependencies = {
    loadEcr: vi.fn(async () => ({ ...ecr })),
    loadPr: vi.fn(async (name) => {
      const pr = prs.get(name);
      if (!pr) throw new Error("not found");
      return { ...pr };
    }),
    findPrCandidates: vi.fn(async (ecrName) => [...prs.values()]
      .filter((pr) =>
        pr.ecr_reference === ecrName ||
        pr[ECR_PR_IDEMPOTENCY_FIELD] === ecrName
      )
      .map((pr) => ({ ...pr }))),
    createPr: vi.fn(async (payload) => {
      const pr: PurchaseRequisitionTrace = {
        ...payload,
        name: "PR-2026-00001",
        docstatus: 0,
      };
      prs.set(pr.name, pr);
      return { ...pr };
    }),
    updatePr: vi.fn(async (name, payload) => {
      const current = prs.get(name);
      if (!current) throw new Error("not found");
      const updated = { ...current, ...payload };
      prs.set(name, updated);
      return { ...updated };
    }),
    updateEcr: vi.fn(async (_name, payload) => {
      ecr = { ...ecr, ...payload, modified: "2026-08-26 10:31:00.000001" };
      return { ...ecr };
    }),
    advanceEcrWorkflow: vi.fn(async () => {
      ecr = { ...ecr, select_pxfp: "Purchase Requisition", docstatus: 1 };
    }),
  };
  return {
    deps,
    getEcr: () => ({ ...ecr }),
    getPrs: () => [...prs.values()].map((pr) => ({ ...pr })),
  };
}

describe("createPrFromEcrCore", () => {
  it("creates one traced PR, links it to the live ECR, and advances through the central workflow", async () => {
    const { deps, getEcr } = mutableDependencies();

    const result = await createPrFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps);

    expect(result).toMatchObject({
      success: true,
      prName: "PR-2026-00001",
      created: true,
      replayed: false,
    });
    expect(deps.createPr).toHaveBeenCalledWith(expect.objectContaining({
      source_type: "ECR",
      ecr_reference: "ECR-2026-100001",
      custom_bidsphere_ecr_idempotency_key: "ECR-2026-100001",
      requester: "engineer@netlink.com",
      requisition_items: [expect.objectContaining({
        partitem: "LAT-4401",
        quantity: 2,
        uom: "Nos",
        technical_requirement: "Update geometry\nUse revision B drawing",
      })],
    }));
    expect(deps.updateEcr).toHaveBeenCalledWith(
      "ECR-2026-100001",
      { purchase_requisition: "PR-2026-00001" },
      expect.objectContaining({
        name: "ECR-2026-100001",
        modified: "2026-08-26 10:30:00.000001",
      }),
    );
    expect(deps.advanceEcrWorkflow).toHaveBeenCalledWith(
      "ECR-2026-100001",
      expect.objectContaining({ role: "procurement_team" }),
    );
    expect(getEcr()).toMatchObject({
      purchase_requisition: "PR-2026-00001",
      select_pxfp: "Purchase Requisition",
    });
  });

  it("rejects creation before approval", async () => {
    const { deps } = mutableDependencies({ select_pxfp: "Program Review" });
    await expect(createPrFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).rejects.toMatchObject({ status: 409, code: "conflict" });
    expect(deps.findPrCandidates).not.toHaveBeenCalled();
    expect(deps.createPr).not.toHaveBeenCalled();
  });

  it.each([
    [{ supplier_response_required: "No" }, "Supplier Required"],
    [{ procurement_reference_type: "RFQ", existing_rfq_reference: "PUR-RFQ-0001" }, "no existing RFQ"],
    [{ rfq: "PUR-RFQ-0002" }, "downstream RFQ"],
    [{ purchase_order: "PUR-ORD-0001" }, "downstream Purchase Order"],
  ])("rejects an invalid or already-started source path", async (overrides, expected) => {
    const { deps } = mutableDependencies(overrides);
    await expect(createPrFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining(expected),
    });
    expect(deps.createPr).not.toHaveBeenCalled();
  });

  it("reuses a persisted idempotency candidate and repairs the ECR backlink", async () => {
    const existing: PurchaseRequisitionTrace = {
      name: "PR-2026-00008",
      status: "Draft",
      docstatus: 0,
      ecr_reference: "ECR-2026-100001",
      custom_bidsphere_ecr_idempotency_key: "ECR-2026-100001",
    };
    const { deps, getEcr } = mutableDependencies({}, [existing]);

    const result = await createPrFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal("procurement"),
    }, deps);

    expect(result).toMatchObject({
      prName: "PR-2026-00008",
      created: false,
      replayed: true,
    });
    expect(deps.createPr).not.toHaveBeenCalled();
    expect(getEcr()).toMatchObject({
      purchase_requisition: "PR-2026-00008",
      select_pxfp: "Purchase Requisition",
    });
  });

  it("heals a legacy linked PR with missing idempotency trace", async () => {
    const existing: PurchaseRequisitionTrace = {
      name: "PR-LEGACY-0001",
      status: "Draft",
      docstatus: 0,
      ecr_reference: "ECR-2026-100001",
    };
    const { deps, getPrs } = mutableDependencies({
      purchase_requisition: existing.name,
      select_pxfp: "Purchase Requisition",
    }, [existing]);

    await expect(createPrFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).resolves.toMatchObject({
      prName: "PR-LEGACY-0001",
      created: false,
    });
    expect(deps.updatePr).toHaveBeenCalledWith("PR-LEGACY-0001", {
      custom_bidsphere_ecr_idempotency_key: "ECR-2026-100001",
    });
    expect(getPrs()[0]).toMatchObject({
      custom_bidsphere_ecr_idempotency_key: "ECR-2026-100001",
    });
    expect(deps.advanceEcrWorkflow).not.toHaveBeenCalled();
  });

  it("replays a verified linked PR after the ECR has advanced to RFQ", async () => {
    const existing: PurchaseRequisitionTrace = {
      name: "PR-2026-00012",
      status: "RFQ Created",
      docstatus: 1,
      ecr_reference: "ECR-2026-100001",
      custom_bidsphere_ecr_idempotency_key: "ECR-2026-100001",
    };
    const { deps } = mutableDependencies({
      purchase_requisition: existing.name,
      select_pxfp: "RFQ",
      rfq: "PUR-RFQ-2026-00012",
    }, [existing]);

    await expect(createPrFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).resolves.toMatchObject({
      prName: existing.name,
      created: false,
      replayed: true,
    });
    expect(deps.createPr).not.toHaveBeenCalled();
    expect(deps.advanceEcrWorkflow).not.toHaveBeenCalled();
  });

  it("fails closed when legacy data contains multiple PRs for one ECR", async () => {
    const { deps } = mutableDependencies({}, [
      { name: "PR-0001", ecr_reference: "ECR-2026-100001" },
      { name: "PR-0002", custom_bidsphere_ecr_idempotency_key: "ECR-2026-100001" },
    ]);
    await expect(createPrFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).rejects.toMatchObject({
      status: 409,
      code: "conflict",
      message: expect.stringContaining("multiple Purchase Requisitions"),
    });
    expect(deps.createPr).not.toHaveBeenCalled();
  });

  it("does not overwrite an ECR backlink that points to a different PR", async () => {
    const { deps } = mutableDependencies({
      purchase_requisition: "PR-OTHER",
      select_pxfp: "Purchase Requisition",
    }, [{
      name: "PR-OTHER",
      ecr_reference: "ECR-DIFFERENT",
      custom_bidsphere_ecr_idempotency_key: "ECR-DIFFERENT",
    }]);
    await expect(createPrFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).rejects.toMatchObject({ status: 409, code: "conflict" });
    expect(deps.createPr).not.toHaveBeenCalled();
  });

  it("treats a concurrent verified workflow advance as a successful replay", async () => {
    const { deps, getEcr } = mutableDependencies();
    vi.mocked(deps.advanceEcrWorkflow).mockImplementationOnce(async () => {
      await deps.updateEcr(
        "ECR-2026-100001",
        { select_pxfp: "Purchase Requisition" },
        getEcr(),
      );
      throw new Error("timestamp mismatch");
    });

    await expect(createPrFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).resolves.toMatchObject({ success: true, prName: "PR-2026-00001" });
    expect(getEcr().select_pxfp).toBe("Purchase Requisition");
  });

  it("reports a repairable partial result when the PR exists but workflow advance fails", async () => {
    const { deps } = mutableDependencies();
    vi.mocked(deps.advanceEcrWorkflow).mockRejectedValueOnce(new Error("ERP unavailable"));

    await expect(createPrFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).rejects.toMatchObject({
      status: 409,
      code: "partial",
      prName: "PR-2026-00001",
    });
    expect(deps.createPr).toHaveBeenCalledTimes(1);
  });

  it("validates source items before writing a PR", async () => {
    const { deps } = mutableDependencies({ affected_parts: [{ quantity: 0, uom: "Nos" }] });
    await expect(createPrFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).rejects.toMatchObject({
      status: 422,
      fieldErrors: expect.objectContaining({
        "requisition_items.0.partitem": expect.any(String),
        "requisition_items.0.quantity": expect.any(String),
      }),
    });
    expect(deps.createPr).not.toHaveBeenCalled();
  });
});
