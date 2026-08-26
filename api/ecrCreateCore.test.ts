import { describe, expect, it, vi } from "vitest";
import {
  createEcrDraftCore,
  EcrAutonameCollisionError,
  EcrCreateError,
  sanitizeEcrCreatePayload,
  type EcrCreateDependencies,
  type InternalEcrCreatePrincipal,
} from "./ecrCreateCore";
import type { AppRole } from "./rbacAuth";

function principal(
  role: AppRole = "engineer",
  email = `${role}@netlink.com`,
): InternalEcrCreatePrincipal {
  return {
    typ: "internal",
    sub: email,
    email,
    role,
    iat: Date.now(),
    exp: Date.now() + 60_000,
  };
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    idempotency_key: "ecr-create-test-0001",
    ecr_title: "Door latch redesign",
    ecr_type: "Design Change",
    priority: "High",
    ecr_owner: "attacker@netlink.com",
    requesting_department: "Engineering",
    plant: "Plant 1",
    target_implementation_date: "2026-09-30",
    chnage_description: "Update the latch geometry.",
    reason_for_change: "Durability improvement.",
    procurement_reference_type: "None",
    supplier_response_required: "No",
    affected_parts: [{ partitem: "LAT-4401", quantity: 1, uom: "Nos" }],
    ...overrides,
  };
}

function dependencies(
  insertEcr = vi.fn(async () => ({
    name: "ECR-2026-00042",
    ecr_title: "Door latch redesign",
    ecr_owner: "engineer@netlink.com",
    select_pxfp: "Draft",
    docstatus: 0,
    approval_requirements: [],
  })),
): EcrCreateDependencies {
  return {
    company: "Netlink",
    loadMasterReferenceCandidates: vi.fn(async (kind, value) => {
      switch (kind) {
        case "owner":
          return [{ name: value.toLowerCase(), email: value.toLowerCase(), enabled: 1 }];
        case "department":
          return [{ name: value, department_name: value }];
        case "plant":
          return [{ name: value, floor_name: value }];
        case "supplier":
          return [{ name: value, supplier_name: value, disabled: 0 }];
        case "item":
          return [{ name: value, item_code: value, item_name: value, disabled: 0 }];
      }
    }),
    loadProcurementDocument: vi.fn(),
    findEcrByIdempotencyKey: vi.fn(async () => null),
    insertEcr,
  };
}

describe("trusted ECR Draft creation", () => {
  it("forces the signed-in owner and creates only an unsubmitted Draft", async () => {
    const insertEcr = vi.fn(async () => ({
      name: "ECR-2026-00042",
      ecr_title: "Door latch redesign",
      ecr_owner: "engineer.one@netlink.com",
      select_pxfp: "Draft",
      docstatus: 0,
      approval_requirements: [],
    }));
    const deps = dependencies(insertEcr);

    const result = await createEcrDraftCore({
      payload: payload(),
      principal: principal("engineer", "Engineer.One@Netlink.com"),
    }, deps);

    expect(insertEcr).toHaveBeenCalledTimes(1);
    const inserted = insertEcr.mock.calls[0]?.[0];
    expect(inserted).toMatchObject({
      ecr_title: "Door latch redesign",
      ecr_owner: "engineer.one@netlink.com",
      company: "Netlink",
      status: "Draft",
      select_pxfp: "Draft",
      docstatus: 0,
      approval_requirements: [],
    });
    expect(inserted).not.toHaveProperty("ecr_number");
    expect(inserted).not.toHaveProperty("amended_from");
    expect(inserted).not.toHaveProperty("idempotency_key");
    expect(inserted?.bidsphere_create_idempotency_key).toMatch(/^[a-f0-9]{64}$/);
    expect(result).toMatchObject({
      name: "ECR-2026-00042",
      ecr_number: "ECR-2026-00042",
      ecr_owner: "engineer.one@netlink.com",
      select_pxfp: "Draft",
      docstatus: 0,
      approval_requirements: [],
      create_replayed: false,
    });
  });

  it("uses canonical User.name rather than email for Link-field ownership", async () => {
    const insertEcr = vi.fn(async () => ({ name: "ECR-2026-100042" }));
    const deps = dependencies(insertEcr);
    const canonicalPrincipal = principal();
    canonicalPrincipal.sub = "engineer";
    canonicalPrincipal.email = "engineer@netlink.com";

    const result = await createEcrDraftCore({
      payload: payload(),
      principal: canonicalPrincipal,
    }, deps);

    expect(insertEcr.mock.calls[0]?.[0]).toMatchObject({ ecr_owner: "engineer" });
    expect(result.ecr_owner).toBe("engineer");
  });

  it("canonicalizes unique master display-name matches before procurement validation and insert", async () => {
    const insertEcr = vi.fn(async () => ({ name: "ECR-2026-100043" }));
    const deps = dependencies(insertEcr);
    deps.loadMasterReferenceCandidates = vi.fn(async (kind) => {
      switch (kind) {
        case "owner":
          return [{
            name: "engineer",
            email: "engineer@netlink.com",
            full_name: "Engineering User",
            enabled: 1,
          }];
        case "department":
          return [{ name: "Engineering - NTL", department_name: "Engineering" }];
        case "plant":
          return [{ name: "MAIN-FLOOR", floor_name: "Main Assembly" }];
        case "supplier":
          return [{ name: "SUP-APEX", supplier_name: "Apex Fasteners Ltd", disabled: 0 }];
        case "item":
          return [{ name: "LAT-4401", item_code: "LAT-4401", item_name: "Door Latch", disabled: 0 }];
      }
    });

    const result = await createEcrDraftCore({
      payload: payload({
        requesting_department: "Engineering",
        plant: "Main Assembly",
        suggested_supplier: "Apex Fasteners Ltd",
        affected_parts: [{ partitem: "Door Latch", quantity: 1, uom: "Nos" }],
      }),
      principal: principal(),
    }, deps);

    expect(insertEcr.mock.calls[0]?.[0]).toMatchObject({
      ecr_owner: "engineer",
      requesting_department: "Engineering - NTL",
      plant: "MAIN-FLOOR",
      suggested_supplier: "SUP-APEX",
      affected_parts: [{ partitem: "LAT-4401", quantity: 1, uom: "Nos" }],
    });
    expect(result.ecr_owner).toBe("engineer");
  });

  it("returns distinct field errors for missing, disabled, and ambiguous master references", async () => {
    const deps = dependencies();
    deps.loadMasterReferenceCandidates = vi.fn(async (kind) => {
      switch (kind) {
        case "owner":
          return [{ name: "engineer@netlink.com", enabled: 0 }];
        case "department":
          return [
            { name: "Engineering - A", department_name: "Engineering" },
            { name: "Engineering - B", department_name: "Engineering" },
          ];
        case "plant":
          return [];
        case "supplier":
          return [{ name: "SUP-001", supplier_name: "SUP-001", disabled: 1 }];
        case "item":
          return [];
      }
    });

    await expect(createEcrDraftCore({
      payload: payload({ suggested_supplier: "SUP-001" }),
      principal: principal(),
    }, deps)).rejects.toMatchObject({
      status: 422,
      code: "validation",
      fieldErrors: {
        ecr_owner: expect.stringMatching(/disabled/i),
        requesting_department: expect.stringMatching(/does not exist/i),
        plant: expect.stringMatching(/does not exist/i),
        suggested_supplier: expect.stringMatching(/disabled/i),
        "partitem.0": expect.stringMatching(/does not exist/i),
      },
    } satisfies Partial<EcrCreateError>);
    expect(deps.loadProcurementDocument).not.toHaveBeenCalled();
    expect(deps.insertEcr).not.toHaveBeenCalled();
  });

  it("returns a field-scoped 422 when live master validation is unavailable", async () => {
    const deps = dependencies();
    deps.loadMasterReferenceCandidates = vi.fn(async (kind, value) => {
      if (kind === "plant") throw new Error("ERP timeout");
      if (kind === "owner") return [{ name: value, email: value, enabled: 1 }];
      if (kind === "department") return [{ name: value, department_name: value }];
      if (kind === "item") return [{ name: value, item_code: value, disabled: 0 }];
      return [];
    });

    await expect(createEcrDraftCore({
      payload: payload(),
      principal: principal(),
    }, deps)).rejects.toMatchObject({
      status: 422,
      fieldErrors: {
        plant: expect.stringMatching(/unable to validate/i),
      },
    });
    expect(deps.insertEcr).not.toHaveBeenCalled();
  });

  it("allows only Engineer or Admin principals", async () => {
    await expect(createEcrDraftCore({
      payload: payload(),
      principal: principal("engineering"),
    }, dependencies())).rejects.toThrow(/permission/i);

    await expect(createEcrDraftCore({
      payload: payload(),
      principal: principal("admin"),
    }, dependencies())).resolves.toMatchObject({ name: "ECR-2026-00042" });
  });

  it.each([
    "ecr_number",
    "amended_from",
    "status",
    "select_pxfp",
    "docstatus",
    "approval_requirements",
    "owner",
    "modified",
    "company",
    "purchase_requisition",
  ])("rejects client-managed server field %s", (field) => {
    expect(() => sanitizeEcrCreatePayload(payload({ [field]: "forged" })))
      .toThrow(new RegExp(`${field} is server-managed`, "i"));
  });

  it("rejects Frappe metadata embedded in child rows", () => {
    expect(() => sanitizeEcrCreatePayload(payload({
      affected_parts: [{ name: "existing-child", partitem: "LAT-4401" }],
    }))).toThrow(/child-row workflow and audit fields are server-managed/i);
  });

  it("retries an ERP autoname collision without generating a number in application code", async () => {
    const insertEcr = vi.fn()
      .mockRejectedValueOnce(new EcrAutonameCollisionError())
      .mockResolvedValueOnce({ name: "ECR-2026-00043" });
    const deps = dependencies(insertEcr);

    await expect(createEcrDraftCore({
      payload: payload(),
      principal: principal(),
    }, deps)).resolves.toMatchObject({
      name: "ECR-2026-00043",
      ecr_number: "ECR-2026-00043",
    });
    expect(insertEcr).toHaveBeenCalledTimes(2);
    expect(insertEcr.mock.calls[0]?.[0]).not.toHaveProperty("ecr_number");
    expect(insertEcr.mock.calls[1]?.[0]).toEqual(insertEcr.mock.calls[0]?.[0]);
  });

  it("returns an existing ECR for a replay without validating or inserting again", async () => {
    const deps = dependencies();
    deps.findEcrByIdempotencyKey = vi.fn(async () => ({
      name: "ECR-2026-00041",
      ecr_owner: "engineer@netlink.com",
      select_pxfp: "Engineering Review",
      docstatus: 0,
      approval_requirements: [{
        approval_role: "Engineering Manager",
        status: "Pending",
      }],
      bidsphere_create_idempotency_key: "server-secret-hash",
    }));

    const result = await createEcrDraftCore({
      payload: payload(),
      principal: principal(),
    }, deps);

    expect(result).toMatchObject({
      name: "ECR-2026-00041",
      ecr_number: "ECR-2026-00041",
      select_pxfp: "Engineering Review",
      docstatus: 0,
      approval_requirements: [{
        approval_role: "Engineering Manager",
        status: "Pending",
      }],
      create_replayed: true,
    });
    expect(result).not.toHaveProperty("bidsphere_create_idempotency_key");
    expect(deps.loadMasterReferenceCandidates).not.toHaveBeenCalled();
    expect(deps.loadProcurementDocument).not.toHaveBeenCalled();
    expect(deps.insertEcr).not.toHaveBeenCalled();
  });

  it("returns the committed ECR when the first create response was lost", async () => {
    let persisted: Record<string, unknown> | null = null;
    const deps = dependencies();
    deps.findEcrByIdempotencyKey = vi.fn(async () => persisted);
    deps.insertEcr = vi.fn(async (document) => {
      persisted = {
        ...document,
        name: "ECR-2026-00049",
        ecr_number: "",
        select_pxfp: "Draft",
        docstatus: 0,
        approval_requirements: [],
      };
      throw new EcrCreateError("Connection closed after ERP commit.", 502, "erp");
    });
    const request = {
      payload: payload({ idempotency_key: "response-lost-create-0001" }),
      principal: principal(),
    };

    await expect(createEcrDraftCore(request, deps)).rejects.toThrow(/after ERP commit/i);
    await expect(createEcrDraftCore(request, deps)).resolves.toMatchObject({
      name: "ECR-2026-00049",
      ecr_number: "ECR-2026-00049",
      select_pxfp: "Draft",
      docstatus: 0,
      approval_requirements: [],
      create_replayed: true,
    });
    expect(deps.insertEcr).toHaveBeenCalledTimes(1);
  });

  it("resolves a concurrent unique-key collision as an idempotent replay", async () => {
    const insertEcr = vi.fn()
      .mockRejectedValueOnce(new EcrAutonameCollisionError("duplicate idempotency key"));
    const deps = dependencies(insertEcr);
    (deps.findEcrByIdempotencyKey as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ name: "ECR-2026-00047" });

    await expect(createEcrDraftCore({
      payload: payload(),
      principal: principal(),
    }, deps)).resolves.toMatchObject({
      name: "ECR-2026-00047",
      ecr_number: "ECR-2026-00047",
    });
    expect(insertEcr).toHaveBeenCalledTimes(1);
  });

  it("requires a bounded transport idempotency key", async () => {
    const deps = dependencies();
    await expect(createEcrDraftCore({
      payload: payload({ idempotency_key: "" }),
      principal: principal(),
    }, deps)).rejects.toMatchObject({
      status: 422,
      fieldErrors: {
        idempotency_key: expect.stringMatching(/required/i),
      },
    });
    expect(deps.findEcrByIdempotencyKey).not.toHaveBeenCalled();
    expect(deps.insertEcr).not.toHaveBeenCalled();
  });

  it("stops after bounded autoname collision retries", async () => {
    const insertEcr = vi.fn(async () => {
      throw new EcrAutonameCollisionError();
    });
    await expect(createEcrDraftCore({
      payload: payload(),
      principal: principal(),
    }, dependencies(insertEcr))).rejects.toMatchObject({
      status: 409,
      code: "conflict",
    } satisfies Partial<EcrCreateError>);
    expect(insertEcr).toHaveBeenCalledTimes(4);
  });

  it("validates the Supplier -> RFQ -> item relationship before insert", async () => {
    const insertEcr = vi.fn(async () => ({ name: "ECR-2026-00044" }));
    const deps = dependencies(insertEcr);
    deps.loadProcurementDocument = vi.fn(async () => ({
      name: "PUR-RFQ-2026-00015",
      status: "Submitted",
      docstatus: 1,
      suppliers: [{ supplier: "SUP-001" }],
      items: [{
        name: "rfq-line-1",
        item_code: "LAT-4401",
        description: "Door latch",
        qty: 100,
        uom: "Nos",
      }],
    }));

    await createEcrDraftCore({
      payload: payload({
        supplier_response_required: "Yes",
        suggested_supplier: "SUP-001",
        procurement_reference_type: "RFQ",
        existing_rfq_reference: "PUR-RFQ-2026-00015",
        affected_parts: [{
          partitem: "LAT-4401",
          part_description: "Door latch",
          quantity: 100,
          uom: "Nos",
          source_reference_type: "RFQ",
          source_document_reference: "PUR-RFQ-2026-00015",
          source_item_reference: "rfq-line-1",
        }],
      }),
      principal: principal(),
    }, deps);

    expect(deps.loadProcurementDocument).toHaveBeenCalledWith(
      "Request for Quotation",
      "PUR-RFQ-2026-00015",
    );
    expect(insertEcr).toHaveBeenCalledTimes(1);
  });

  it("does not insert when a procurement relationship is invalid", async () => {
    const insertEcr = vi.fn(async () => ({ name: "ECR-2026-00045" }));
    const deps = dependencies(insertEcr);
    deps.loadProcurementDocument = vi.fn(async () => ({
      name: "PUR-RFQ-2026-00015",
      suppliers: [{ supplier: "SUP-OTHER" }],
      items: [],
    }));

    await expect(createEcrDraftCore({
      payload: payload({
        supplier_response_required: "Yes",
        suggested_supplier: "SUP-001",
        procurement_reference_type: "RFQ",
        existing_rfq_reference: "PUR-RFQ-2026-00015",
      }),
      principal: principal(),
    }, deps)).rejects.toMatchObject({
      status: 422,
      fieldErrors: {
        existing_rfq_reference: expect.stringMatching(/not associated/i),
      },
    });
    expect(insertEcr).not.toHaveBeenCalled();
  });
});
