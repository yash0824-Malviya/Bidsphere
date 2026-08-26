import { describe, expect, it, vi } from "vitest";
import {
  createRfqFromEcrCore,
  CreateRfqFromEcrError,
  ECR_RFQ_IDEMPOTENCY_FIELD,
  type CreateRfqFromEcrDependencies,
  type DirectRfqSourceEcr,
  type DirectRfqTrace,
} from "./createRfqFromEcrCore";
import type { InternalEcrPrincipal } from "./ecrWorkflowCore";

function principal(
  role: InternalEcrPrincipal["role"] = "procurement",
): InternalEcrPrincipal {
  return {
    typ: "internal",
    sub: `${role}@netlink.com`,
    email: `${role}@netlink.com`,
    role,
    iat: 1,
    exp: 9_999_999_999,
  };
}

function baseEcr(overrides: Partial<DirectRfqSourceEcr> = {}): DirectRfqSourceEcr {
  return {
    name: "ECR-2026-100001",
    modified: "2026-08-26 10:30:00.000001",
    docstatus: 0,
    select_pxfp: "RFQ Pending",
    status: "RFQ Pending",
    ecr_number: "ECR-2026-100001",
    ecr_title: "Door latch redesign",
    plant: "Main Plant",
    target_implementation_date: "2026-09-30",
    supplier_response_required: "Yes",
    suggested_supplier: "SUP-001",
    procurement_reference_type: "None",
    approval_requirements: [
      { approval_role: "Procurement Team", required: 1, status: "Approved" },
      { approval_role: "Procurement Manager", required: 1, status: "Pending" },
    ],
    affected_parts: [{
      partitem: "LAT-4401",
      part_description: "Door Latch",
      quantity: 2,
      uom: "Nos",
      plant: "Plant 1",
      change_required: "Update geometry",
      technical_notes: "Use revision B drawing",
    }],
    ...overrides,
  };
}

function memoryDependencies(
  ecrOverrides: Partial<DirectRfqSourceEcr> = {},
  initialRfqs: DirectRfqTrace[] = [],
): {
  deps: CreateRfqFromEcrDependencies;
  getEcr: () => DirectRfqSourceEcr;
  getRfqs: () => DirectRfqTrace[];
} {
  let ecr = baseEcr(ecrOverrides);
  const rfqs = new Map(initialRfqs.map((rfq) => [rfq.name, { ...rfq }]));
  const deps: CreateRfqFromEcrDependencies = {
    loadEcr: vi.fn(async () => structuredClone(ecr)),
    loadRfq: vi.fn(async (name) => {
      const rfq = rfqs.get(name);
      if (!rfq) throw new Error("not found");
      return { ...rfq };
    }),
    findRfqCandidates: vi.fn(async (ecrName) => [...rfqs.values()]
      .filter((rfq) =>
        rfq.custom_ecr_reference === ecrName ||
        rfq[ECR_RFQ_IDEMPOTENCY_FIELD] === ecrName
      )
      .map((rfq) => ({ ...rfq }))),
    assertSupplierExists: vi.fn(async () => undefined),
    resolveCompanyForPlant: vi.fn(async () => "Netlink"),
    createRfq: vi.fn(async (payload) => {
      const rfq: DirectRfqTrace = {
        ...payload,
        name: "PUR-RFQ-2026-00001",
        docstatus: 0,
        status: "Draft",
      };
      rfqs.set(rfq.name, rfq);
      return { ...rfq };
    }),
    updateRfq: vi.fn(async (name, payload) => {
      const current = rfqs.get(name);
      if (!current) throw new Error("not found");
      const updated = { ...current, ...payload };
      rfqs.set(name, updated);
      return { ...updated };
    }),
    commitEcrRfqTransition: vi.fn(async (current, rfqName, approvalRequirements) => {
      if (current.modified !== ecr.modified) throw new Error("timestamp mismatch");
      ecr = {
        ...ecr,
        rfq: rfqName,
        select_pxfp: "RFQ",
        status: "RFQ",
        docstatus: 1,
        approval_requirements: approvalRequirements,
        modified: "2026-08-26 10:31:00.000001",
      };
      return structuredClone(ecr);
    }),
    today: () => "2026-08-26",
    now: () => "2026-08-26 10:31:00",
  };
  return {
    deps,
    getEcr: () => structuredClone(ecr),
    getRfqs: () => [...rfqs.values()].map((rfq) => ({ ...rfq })),
  };
}

describe("createRfqFromEcrCore", () => {
  it("creates an RFQ from trusted ECR details and atomically completes RFQ Pending", async () => {
    const { deps, getEcr } = memoryDependencies();

    const result = await createRfqFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps);

    expect(result).toMatchObject({
      success: true,
      newStatus: "RFQ",
      rfqName: "PUR-RFQ-2026-00001",
      created: true,
      replayed: false,
      approvalRequirements: expect.arrayContaining([
        expect.objectContaining({ approval_role: "Procurement Manager", status: "Completed" }),
      ]),
    });
    expect(deps.assertSupplierExists).toHaveBeenCalledWith("SUP-001");
    expect(deps.resolveCompanyForPlant).toHaveBeenCalledWith("Main Plant");
    expect(deps.createRfq).toHaveBeenCalledWith(expect.objectContaining({
      company: "Netlink",
      title: "RFQ for Door latch redesign",
      transaction_date: "2026-08-26",
      schedule_date: "2026-09-30",
      custom_ecr_reference: "ECR-2026-100001",
      custom_bidsphere_ecr_idempotency_key: "ECR-2026-100001",
      suppliers: [{ supplier: "SUP-001" }],
      items: [{
        item_code: "LAT-4401",
        description: "Door Latch",
        qty: 2,
        uom: "Nos",
        schedule_date: "2026-09-30",
      }],
    }));
    expect(deps.commitEcrRfqTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ECR-2026-100001",
        modified: "2026-08-26 10:30:00.000001",
        select_pxfp: "RFQ Pending",
      }),
      "PUR-RFQ-2026-00001",
      expect.arrayContaining([
        expect.objectContaining({
          approval_role: "Procurement Manager",
          status: "Completed",
          approver: "procurement@netlink.com",
        }),
      ]),
    );
    expect(getEcr()).toMatchObject({
      rfq: "PUR-RFQ-2026-00001",
      select_pxfp: "RFQ",
      status: "RFQ",
      docstatus: 1,
      approval_requirements: expect.arrayContaining([
        expect.objectContaining({ approval_role: "Procurement Manager", status: "Completed" }),
      ]),
    });
  });

  it("accepts punctuated persisted RFQ-stage and Procurement Manager task aliases", async () => {
    const { deps, getEcr } = memoryDependencies({
      select_pxfp: "RFQ.Pending",
      status: "RFQ.Pending",
      docstatus: 1,
      approval_requirements: [
        { approval_role: "Procurement.team", required: 1, status: "Approved" },
        { approval_role: "Procurement.manager", required: 1, status: "pending" },
      ],
    });

    await expect(createRfqFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).resolves.toMatchObject({ newStatus: "RFQ" });
    expect(getEcr().approval_requirements).toContainEqual(expect.objectContaining({
      approval_role: "Procurement Manager",
      status: "Completed",
    }));
  });

  it("uses the exact persisted supplier identifier, including stored quotes", async () => {
    const storedSupplier = '"Blue Ridge Manufacturing Inc"';
    const { deps } = memoryDependencies({ suggested_supplier: storedSupplier });

    await createRfqFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps);

    expect(deps.assertSupplierExists).toHaveBeenCalledWith(storedSupplier);
    expect(deps.createRfq).toHaveBeenCalledWith(expect.objectContaining({
      suppliers: [{ supplier: storedSupplier }],
    }));
  });

  it("returns a clear field error when the exact persisted supplier does not exist", async () => {
    const storedSupplier = '"Blue Ridge Manufacturing Inc"';
    const { deps } = memoryDependencies({ suggested_supplier: storedSupplier });
    vi.mocked(deps.assertSupplierExists).mockRejectedValueOnce(
      new CreateRfqFromEcrError("Supplier not found", 404, "erp"),
    );

    await expect(createRfqFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).rejects.toMatchObject({
      status: 422,
      code: "validation",
      fieldErrors: {
        suggested_supplier: expect.stringContaining("does not exist in ERPNext"),
      },
    });
    expect(deps.createRfq).not.toHaveBeenCalled();
  });

  it.each(["Procurement Review", "Approved", "Engineering Review", "Draft"])(
    "rejects RFQ creation while the ECR is %s",
    async (select_pxfp) => {
      const { deps } = memoryDependencies({ select_pxfp });
      await expect(createRfqFromEcrCore({
        ecrName: "ECR-2026-100001",
        principal: principal(),
      }, deps)).rejects.toMatchObject({ status: 409, code: "conflict" });
      expect(deps.createRfq).not.toHaveBeenCalled();
    },
  );

  it.each(["engineer", "engineering", "procurement_team", "admin"] as InternalEcrPrincipal["role"][])(
    "rejects unauthorized role %s in the core",
    async (role) => {
      const { deps } = memoryDependencies();
      await expect(createRfqFromEcrCore({
        ecrName: "ECR-2026-100001",
        principal: principal(role),
      }, deps)).rejects.toMatchObject({ status: 403 });
      expect(deps.loadEcr).not.toHaveBeenCalled();
    },
  );

  it("rejects non-text identifiers before loading ERP data", async () => {
    const { deps } = memoryDependencies();
    await expect(createRfqFromEcrCore({
      ecrName: { name: "ECR-2026-100001" },
      principal: principal("procurement"),
    }, deps)).rejects.toMatchObject({ status: 422 });
    expect(deps.loadEcr).not.toHaveBeenCalled();
  });

  it.each([
    [{ supplier_response_required: "No" }, "Supplier Required"],
    [{ suggested_supplier: "" }, "Suggested Supplier"],
    [{ plant: "" }, "Plant is required"],
    [{ purchase_order: "PO-DOWNSTREAM" }, "references a Purchase Order"],
    [{ purchase_requisition: "PR-EXPLICIT" }, "PR-based RFQ flow"],
    [{ docstatus: 2 }, "active draft or a submitted legacy record"],
    [{ approval_requirements: [] }, "exactly one active Procurement Manager task"],
    [{ approval_requirements: [{ approval_role: "Procurement Team", required: 1, status: "Pending" }] }, "exactly one active Procurement Manager task"],
    [{ approval_requirements: [
      { approval_role: "Procurement Manager", required: 1, status: "Pending" },
      { approval_role: "Procurement Manager", required: 1, status: "Pending" },
    ] }, "exactly one active Procurement Manager task"],
  ])("rejects invalid direct-RFQ prerequisites", async (overrides, message) => {
    const { deps } = memoryDependencies(overrides);
    await expect(createRfqFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal("procurement"),
    }, deps)).rejects.toThrow(message);
    expect(deps.createRfq).not.toHaveBeenCalled();
  });

  it("fails with a plant field error when master data has no company", async () => {
    const { deps } = memoryDependencies();
    vi.mocked(deps.resolveCompanyForPlant).mockResolvedValueOnce("");

    await expect(createRfqFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).rejects.toMatchObject({
      status: 422,
      fieldErrors: { plant: expect.stringContaining("does not define a company") },
    });
    expect(deps.createRfq).not.toHaveBeenCalled();
  });

  it("does not mistake existing RFQ/PO source provenance for downstream output", async () => {
    const { deps } = memoryDependencies({
      procurement_reference_type: "RFQ",
      existing_rfq_reference: "SOURCE-RFQ-0001",
      existing_purchase_order_reference: "PUR-ORD-2026-00022",
    });

    await expect(createRfqFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).resolves.toMatchObject({
      created: true,
      rfqName: "PUR-RFQ-2026-00001",
    });
    expect(deps.createRfq).toHaveBeenCalledWith(expect.objectContaining({
      custom_ecr_reference: "ECR-2026-100001",
      custom_bidsphere_ecr_idempotency_key: "ECR-2026-100001",
    }));
  });

  it("replays a verified RFQ after the ECR is already in RFQ state", async () => {
    const existing: DirectRfqTrace = {
      name: "PUR-RFQ-2026-00009",
      docstatus: 0,
      status: "Draft",
      custom_ecr_reference: "ECR-2026-100001",
      custom_bidsphere_ecr_idempotency_key: "ECR-2026-100001",
    };
    const { deps } = memoryDependencies({
      select_pxfp: "RFQ",
      status: "RFQ",
      docstatus: 1,
      rfq: existing.name,
      approval_requirements: [
        { approval_role: "Procurement Manager", required: 1, status: "Completed" },
      ],
    }, [existing]);

    await expect(createRfqFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).resolves.toMatchObject({
      rfqName: existing.name,
      created: false,
      replayed: true,
    });
    expect(deps.createRfq).not.toHaveBeenCalled();
    expect(deps.commitEcrRfqTransition).not.toHaveBeenCalled();
  });

  it("recovers an unlinked RFQ created before a lost response", async () => {
    const existing: DirectRfqTrace = {
      name: "PUR-RFQ-2026-00010",
      docstatus: 0,
      status: "Draft",
      custom_ecr_reference: "ECR-2026-100001",
      custom_bidsphere_ecr_idempotency_key: "ECR-2026-100001",
    };
    const { deps, getEcr } = memoryDependencies({}, [existing]);

    await expect(createRfqFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).resolves.toMatchObject({
      rfqName: existing.name,
      created: false,
      replayed: true,
    });
    expect(deps.createRfq).not.toHaveBeenCalled();
    expect(getEcr()).toMatchObject({ rfq: existing.name, select_pxfp: "RFQ" });
  });

  it("heals legacy RFQ traceability before linking it", async () => {
    const existing: DirectRfqTrace = {
      name: "PUR-RFQ-LEGACY",
      docstatus: 0,
      status: "Draft",
      custom_ecr_reference: "ECR-2026-100001",
    };
    const { deps, getRfqs } = memoryDependencies({}, [existing]);

    await createRfqFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps);

    expect(deps.updateRfq).toHaveBeenCalledWith(existing.name, {
      custom_bidsphere_ecr_idempotency_key: "ECR-2026-100001",
    });
    expect(getRfqs()[0]).toMatchObject({
      custom_bidsphere_ecr_idempotency_key: "ECR-2026-100001",
    });
  });

  it("fails closed when multiple RFQs reference one ECR", async () => {
    const { deps } = memoryDependencies({}, [
      {
        name: "RFQ-1",
        docstatus: 0,
        custom_ecr_reference: "ECR-2026-100001",
      },
      {
        name: "RFQ-2",
        docstatus: 0,
        custom_bidsphere_ecr_idempotency_key: "ECR-2026-100001",
      },
    ]);
    await expect(createRfqFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).rejects.toThrow(/multiple RFQs/i);
    expect(deps.createRfq).not.toHaveBeenCalled();
  });

  it("accepts a concurrent commit only when the persisted ECR has the same RFQ and stage", async () => {
    const { deps, getEcr } = memoryDependencies();
    vi.mocked(deps.commitEcrRfqTransition).mockImplementationOnce(async (_ecr, rfqName, approvalRequirements) => {
      const current = getEcr();
      Object.assign(current, {
        rfq: rfqName,
        select_pxfp: "RFQ",
        status: "RFQ",
        docstatus: 1,
        approval_requirements: approvalRequirements,
      });
      vi.mocked(deps.loadEcr).mockResolvedValue(current);
      throw new Error("timestamp mismatch");
    });

    await expect(createRfqFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).resolves.toMatchObject({ success: true });
  });

  it("returns a repairable partial error when RFQ creation succeeds but ECR sync fails", async () => {
    const { deps } = memoryDependencies();
    vi.mocked(deps.commitEcrRfqTransition).mockRejectedValueOnce(new Error("ERP unavailable"));
    await expect(createRfqFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).rejects.toMatchObject({
      status: 409,
      code: "partial",
      rfqName: "PUR-RFQ-2026-00001",
    });
  });

  it("validates RFQ items before creating anything", async () => {
    const { deps } = memoryDependencies({
      affected_parts: [{ partitem: "", quantity: 0, uom: "" }],
    });
    await expect(createRfqFromEcrCore({
      ecrName: "ECR-2026-100001",
      principal: principal(),
    }, deps)).rejects.toMatchObject({
      status: 422,
      fieldErrors: expect.objectContaining({
        "affected_parts.0.partitem": expect.any(String),
        "affected_parts.0.quantity": expect.any(String),
        "affected_parts.0.uom": expect.any(String),
      }),
    });
    expect(deps.createRfq).not.toHaveBeenCalled();
  });

  it("coalesces same-process concurrent requests into one RFQ", async () => {
    const { deps } = memoryDependencies();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const originalCreate = vi.mocked(deps.createRfq).getMockImplementation();
    expect(originalCreate).toBeDefined();
    vi.mocked(deps.createRfq).mockImplementationOnce(async (payload) => {
      await gate;
      return originalCreate!(payload);
    });

    const first = createRfqFromEcrCore({
      ecrName: "ECR-CONCURRENT",
      principal: principal(),
    }, deps);
    const second = createRfqFromEcrCore({
      ecrName: "ECR-CONCURRENT",
      principal: principal(),
    }, deps);
    release?.();

    const [one, two] = await Promise.all([first, second]);
    expect(one.rfqName).toBe(two.rfqName);
    expect([one.created, two.created].sort()).toEqual([false, true]);
    expect(deps.createRfq).toHaveBeenCalledTimes(1);
  });

  it("does not let an unauthorized request piggyback on an in-flight manager request", async () => {
    const { deps } = memoryDependencies();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const originalCreate = vi.mocked(deps.createRfq).getMockImplementation();
    expect(originalCreate).toBeDefined();
    vi.mocked(deps.createRfq).mockImplementationOnce(async (payload) => {
      await gate;
      return originalCreate!(payload);
    });

    const authorized = createRfqFromEcrCore({
      ecrName: "ECR-IN-FLIGHT-AUTH",
      principal: principal("procurement"),
    }, deps);
    await expect(createRfqFromEcrCore({
      ecrName: "ECR-IN-FLIGHT-AUTH",
      principal: principal("procurement_team"),
    }, deps)).rejects.toMatchObject({ status: 403 });
    release?.();
    await expect(authorized).resolves.toMatchObject({ success: true });
  });
});
