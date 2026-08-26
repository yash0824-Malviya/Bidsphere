import { describe, expect, it, vi } from "vitest";
import {
  applyEcrWorkflowActionCore,
  buildSequentialApprovalRequirements,
  EcrWorkflowError,
  requireCurrentApprovalTask,
  type EcrApprovalRequirement,
  type EcrWorkflowDependencies,
  type EcrWorkflowDocument,
  type InternalEcrPrincipal,
} from "./ecrWorkflowCore";
import {
  activeApprovalRoleForStatus,
  canonicalApprovalRole,
  canonicalWorkflowStatus,
  ECR_WORKFLOW_TRANSITIONS,
  getEcrWorkflowTransition,
  requiredReviewAssessmentFieldsForStatus,
  reviewAssessmentAllowedValuesForStatus,
  reviewAssessmentFieldsForStatus,
} from "./ecrWorkflowPolicy";
import type { AppRole } from "./rbacAuth";

function principal(role: AppRole, email = `${role}@netlink.com`): InternalEcrPrincipal {
  return { typ: "internal", sub: email, email, role, iat: Date.now(), exp: Date.now() + 60_000 };
}

function pending(role = "Engineering Manager", name = `TASK-${role}`): EcrApprovalRequirement {
  return { name, doctype: "ECR Approval", approval_role: role, required: 1, status: "Pending" };
}

const ENGINEERING_REVIEW = {
  "Technical Feasibility": "Feasible",
  "Engineering Impact": "Impact assessed",
};
const PROCUREMENT_REVIEW = {
  "Procurement Assessment": "Ready for sourcing",
  "Supplier Requirement": "Yes",
  "RFQ Requirement": "Required",
};

function document(status: string, extra: Partial<EcrWorkflowDocument> = {}): EcrWorkflowDocument {
  return {
    name: "1j3b9i4moj",
    modified: "1",
    docstatus: status === "RFQ" ? 1 : 0,
    select_pxfp: status,
    status,
    ecr_owner: "engineer@netlink.com",
    owner: "engineer@netlink.com",
    supplier_response_required: "Yes",
    approval_requirements: [],
    ...extra,
  };
}

function memoryDependencies(initial: EcrWorkflowDocument): {
  dependencies: EcrWorkflowDependencies;
  read: () => EcrWorkflowDocument;
  commitWorkflowDocument: ReturnType<typeof vi.fn>;
} {
  let stored = structuredClone(initial);
  const commitWorkflowDocument = vi.fn(async (next: EcrWorkflowDocument) => {
    if (next.modified !== stored.modified) {
      throw new EcrWorkflowError("Document has been modified", 409, "conflict");
    }
    const transition = ECR_WORKFLOW_TRANSITIONS.find(
      (candidate) =>
        candidate.currentStatus === canonicalWorkflowStatus(stored.select_pxfp ?? "") &&
        candidate.nextStatus === next.select_pxfp,
    );
    if (!transition) throw new EcrWorkflowError("Invalid transition", 409, "conflict");
    stored = { ...structuredClone(next), modified: String(Number(stored.modified || "0") + 1) };
    return structuredClone(stored);
  });
  return {
    dependencies: {
      loadEcr: vi.fn(async () => structuredClone(stored)),
      loadProcurementDocument: vi.fn(async (doctype: string, name: string) => ({
        name,
        doctype,
        docstatus: 1,
        custom_ecr_reference: stored.name,
        suppliers: [{ supplier: "SUP-0001" }],
      })),
      commitWorkflowDocument,
      addTimelineComment: vi.fn(async () => undefined),
      now: () => "2026-08-26 10:30:00",
    },
    read: () => structuredClone(stored),
    commitWorkflowDocument,
  };
}

describe("sequential ECR workflow policy", () => {
  it("contains only the required sequential actions and role handoffs", () => {
    expect(ECR_WORKFLOW_TRANSITIONS).toEqual([
      expect.objectContaining({ currentStatus: "Draft", action: "Submit ECR", nextStatus: "Engineering Review", roles: ["engineer"] }),
      expect.objectContaining({ currentStatus: "Engineering Review", action: "Send Back", nextStatus: "Draft", roles: ["engineering"] }),
      expect.objectContaining({ currentStatus: "Engineering Review", action: "Reject", nextStatus: "Rejected", roles: ["engineering"] }),
      expect.objectContaining({ currentStatus: "Engineering Review", action: "Approve", nextStatus: "Procurement Review", roles: ["engineering"] }),
      expect.objectContaining({ currentStatus: "Procurement Review", action: "Send Back", nextStatus: "Draft", roles: ["procurement_team"] }),
      expect.objectContaining({ currentStatus: "Procurement Review", action: "Reject", nextStatus: "Rejected", roles: ["procurement_team"] }),
      expect.objectContaining({ currentStatus: "Procurement Review", action: "Approve", nextStatus: "RFQ Pending", roles: ["procurement_team"] }),
      expect.objectContaining({ currentStatus: "RFQ Pending", action: "Create RFQ", nextStatus: "RFQ", roles: ["procurement"] }),
    ]);
  });

  it("canonicalizes active aliases and exposes the procurement assessment contract", () => {
    expect(getEcrWorkflowTransition("Under Review", "Approve")?.nextStatus).toBe("Procurement Review");
    expect(getEcrWorkflowTransition("Procurement", "Approve")?.nextStatus).toBe("RFQ Pending");
    expect(getEcrWorkflowTransition("Procurement.team Review", "Approve")?.nextStatus).toBe("RFQ Pending");
    expect(canonicalWorkflowStatus("RFQ.Pending")).toBe("RFQ Pending");
    expect(canonicalApprovalRole("Procurement.team")).toBe("Procurement Team");
    expect(activeApprovalRoleForStatus("Under Review")).toBe("Engineering Manager");
    expect(activeApprovalRoleForStatus("Procurement.team Review")).toBe("Procurement Team");
    expect(activeApprovalRoleForStatus("RFQ Pending")).toBe("Procurement Manager");
    expect(reviewAssessmentFieldsForStatus("Procurement Review")).toEqual([
      "Procurement Assessment", "Supplier Requirement", "RFQ Requirement",
    ]);
    expect(requiredReviewAssessmentFieldsForStatus("Procurement Review"))
      .toEqual(["Procurement Assessment", "Supplier Requirement", "RFQ Requirement"]);
    expect(reviewAssessmentAllowedValuesForStatus("Procurement.team Review")).toEqual({
      "Supplier Requirement": ["Yes", "No"],
      "RFQ Requirement": ["Required", "Not Required"],
    });
  });

  it("does not expose removed stages or the old direct procurement RFQ shortcut", () => {
    for (const [status, action] of [
      ["Engineering Review", "Approve Engineering Review"],
      ["Operations Review", "Approve"],
      ["Quality Review", "Approve"],
      ["Program Review", "Approve"],
      ["Procurement Review", "Create RFQ"],
      ["Procurement", "Create RFQ"],
      ["Implementation", "Start Validation"],
    ]) {
      expect(getEcrWorkflowTransition(status, action)).toBeNull();
    }
  });
});

describe("single pending-task invariant", () => {
  it.each([
    ["Engineering Review", "engineering", "Engineering Manager"],
    ["Procurement Review", "procurement_team", "Procurement Team"],
    ["RFQ Pending", "procurement", "Procurement Manager"],
  ] as const)("requires one task at %s", (status, appRole, taskRole) => {
    expect(requireCurrentApprovalTask({ rows: [pending(taskRole)], currentStatus: status, principalRole: appRole }))
      .toHaveLength(1);
    for (const rows of [
      [],
      [{ ...pending(taskRole), required: 0 }],
      [pending("Operations Manager")],
      [pending(taskRole), pending(taskRole, "TASK-DUPLICATE")],
      [pending(taskRole), pending("Operations Manager", "TASK-FUTURE")],
    ]) {
      expect(() => requireCurrentApprovalTask({ rows, currentStatus: status, principalRole: appRole }))
        .toThrow(new RegExp(`exactly one active ${taskRole}`, "i"));
    }
  });

  it("rejects the wrong actor and pending tasks at Draft or RFQ", () => {
    expect(() => requireCurrentApprovalTask({
      rows: [pending("Procurement Team")],
      currentStatus: "Procurement Review",
      principalRole: "procurement",
    })).toThrow(/not assigned to this role/i);
    for (const status of ["Draft", "RFQ"]) {
      expect(() => requireCurrentApprovalTask({
        rows: [pending("Procurement Manager")],
        currentStatus: status,
        principalRole: "procurement",
      })).toThrow(/must not have an active approval task/i);
    }
  });

  it("creates only the next task and completes only the current task", () => {
    const submitted = buildSequentialApprovalRequirements({
      rows: [],
      transition: getEcrWorkflowTransition("Draft", "Submit ECR")!,
      actor: "engineer@netlink.com",
      owner: "engineer@netlink.com",
      timestamp: "2026-08-26 10:30:00",
    });
    expect(submitted).toEqual([
      expect.objectContaining({ approval_role: "Engineering Manager", status: "Pending", required: 1 }),
    ]);

    const engineeringApproved = buildSequentialApprovalRequirements({
      rows: submitted,
      transition: getEcrWorkflowTransition("Engineering Review", "Approve")!,
      actor: "engineering.manager@netlink.com",
      timestamp: "2026-08-26 10:35:00",
    });
    expect(engineeringApproved.filter((row) => row.status === "Pending"))
      .toEqual([expect.objectContaining({ approval_role: "Procurement Team" })]);
    expect(engineeringApproved).toContainEqual(expect.objectContaining({
      approval_role: "Engineering Manager", status: "Approved",
    }));

    const procurementApproved = buildSequentialApprovalRequirements({
      rows: engineeringApproved,
      transition: getEcrWorkflowTransition("Procurement Review", "Approve")!,
      actor: "procurement.team@netlink.com",
      timestamp: "2026-08-26 10:40:00",
    });
    expect(procurementApproved.filter((row) => row.status === "Pending"))
      .toEqual([expect.objectContaining({ approval_role: "Procurement Manager" })]);
    expect(procurementApproved).toContainEqual(expect.objectContaining({
      approval_role: "Procurement Team", status: "Approved",
    }));
  });
});

describe("trusted ECR workflow actions", () => {
  it("submits Draft with exactly one Engineering Manager task", async () => {
    const memory = memoryDependencies(document("Draft"));
    const result = await applyEcrWorkflowActionCore({
      name: "1j3b9i4moj", action: "Submit ECR", principal: principal("engineer", "engineer@netlink.com"),
    }, memory.dependencies);
    expect(result.newStatus).toBe("Engineering Review");
    expect(result.approvalRequirements).toEqual([
      expect.objectContaining({ approval_role: "Engineering Manager", required: 1, status: "Pending" }),
    ]);
    expect(memory.read()).toMatchObject({
      select_pxfp: "Engineering Review", status: "Engineering Review", docstatus: 0,
    });
  });

  it("resubmits a returned Draft with a fresh manager task while preserving history", async () => {
    const history = [{
      ...pending("Engineering Manager", "TASK-OLD"), status: "Sent Back", approver: "manager@netlink.com",
    }];
    const memory = memoryDependencies(document("Draft", { approval_requirements: history }));
    const result = await applyEcrWorkflowActionCore({
      name: "1j3b9i4moj", action: "Submit ECR", principal: principal("engineer", "engineer@netlink.com"),
    }, memory.dependencies);
    expect(result.approvalRequirements).toContainEqual(expect.objectContaining({ name: "TASK-OLD", status: "Sent Back" }));
    expect(result.approvalRequirements.filter((row) => row.status === "Pending"))
      .toEqual([expect.objectContaining({ approval_role: "Engineering Manager" })]);
  });

  it("Engineering Manager approval creates one Procurement Team task", async () => {
    const memory = memoryDependencies(document("Engineering Review", {
      approval_requirements: [pending("Engineering Manager")],
    }));
    const result = await applyEcrWorkflowActionCore({
      name: "1j3b9i4moj",
      action: "Approve",
      comment: "Engineering approved.",
      reviewFields: ENGINEERING_REVIEW,
      principal: principal("engineering", "engineering.manager@netlink.com"),
    }, memory.dependencies);
    expect(result.newStatus).toBe("Procurement Review");
    expect(result.approvalRequirements.filter((row) => row.status === "Pending"))
      .toEqual([expect.objectContaining({ approval_role: "Procurement Team", required: 1 })]);
    expect(result.approvalRequirements).toContainEqual(expect.objectContaining({
      approval_role: "Engineering Manager", status: "Approved", approver: "engineering.manager@netlink.com",
    }));
    expect(memory.read()).toMatchObject({
      select_pxfp: "Procurement Review", status: "Procurement Review", docstatus: 0,
    });
    expect(memory.read().approval_requirements?.filter((row) => row.status === "Pending"))
      .toEqual([expect.objectContaining({ approval_role: "Procurement Team", required: 1 })]);
  });

  it("Procurement Team approval creates one Procurement Manager task", async () => {
    const memory = memoryDependencies(document("Procurement Review", {
      approval_requirements: [
        { ...pending("Engineering Manager"), status: "Approved" },
        pending("Procurement Team"),
      ],
    }));
    const result = await applyEcrWorkflowActionCore({
      name: "1j3b9i4moj",
      action: "Approve",
      comment: "Commercial inputs verified",
      reviewFields: PROCUREMENT_REVIEW,
      principal: principal("procurement_team", "procurement.team@netlink.com"),
    }, memory.dependencies);
    expect(result.newStatus).toBe("RFQ Pending");
    expect(result.approvalRequirements.filter((row) => row.status === "Pending"))
      .toEqual([expect.objectContaining({ approval_role: "Procurement Manager", required: 1 })]);
    expect(result.approvalRequirements).toContainEqual(expect.objectContaining({
      approval_role: "Procurement Team",
      status: "Approved",
      approver: "procurement.team@netlink.com",
      comments: expect.stringContaining("Review Comments: Commercial inputs verified"),
    }));
    expect(memory.read()).toMatchObject({ select_pxfp: "RFQ Pending", status: "RFQ Pending", docstatus: 0 });
    expect(memory.read().approval_requirements?.filter((row) => row.status === "Pending"))
      .toEqual([expect.objectContaining({ approval_role: "Procurement Manager", required: 1 })]);
  });

  it("persists both role handoffs across fresh reads", async () => {
    const memory = memoryDependencies(document("Engineering Review", {
      approval_requirements: [pending("Engineering Manager")],
    }));
    await applyEcrWorkflowActionCore({
      name: "1j3b9i4moj",
      action: "Approve",
      reviewFields: ENGINEERING_REVIEW,
      principal: principal("engineering"),
    }, memory.dependencies);

    const refreshedProcurementReview = await memory.dependencies.loadEcr("1j3b9i4moj");
    expect(refreshedProcurementReview).toMatchObject({
      select_pxfp: "Procurement Review",
      status: "Procurement Review",
      approval_requirements: [
        expect.objectContaining({ approval_role: "Engineering Manager", status: "Approved" }),
        expect.objectContaining({ approval_role: "Procurement Team", status: "Pending", required: 1 }),
      ],
    });

    await applyEcrWorkflowActionCore({
      name: "1j3b9i4moj",
      action: "Approve",
      reviewFields: PROCUREMENT_REVIEW,
      principal: principal("procurement_team"),
    }, memory.dependencies);
    const refreshedRfqPending = await memory.dependencies.loadEcr("1j3b9i4moj");
    expect(refreshedRfqPending).toMatchObject({
      select_pxfp: "RFQ Pending",
      status: "RFQ Pending",
      approval_requirements: [
        expect.objectContaining({ approval_role: "Engineering Manager", status: "Approved" }),
        expect.objectContaining({ approval_role: "Procurement Team", status: "Approved" }),
        expect.objectContaining({ approval_role: "Procurement Manager", status: "Pending", required: 1 }),
      ],
    });
    expect(refreshedRfqPending.approval_requirements?.filter((row) => row.status === "Pending"))
      .toHaveLength(1);
  });

  it("repairs punctuated Procurement Team stage and task aliases while approving", async () => {
    const memory = memoryDependencies(document("Procurement.team Review", {
      approval_requirements: [
        { ...pending("Engineering.manager"), status: "Approved" },
        pending("Procurement.team"),
      ],
    }));
    await expect(applyEcrWorkflowActionCore({
      name: "1j3b9i4moj",
      action: "Approve",
      reviewFields: PROCUREMENT_REVIEW,
      principal: principal("procurement_team"),
    }, memory.dependencies)).resolves.toMatchObject({ newStatus: "RFQ Pending" });
    expect(memory.read()).toMatchObject({
      select_pxfp: "RFQ Pending",
      status: "RFQ Pending",
    });
    expect(memory.read().approval_requirements?.filter((row) => row.status === "Pending"))
      .toEqual([expect.objectContaining({ approval_role: "Procurement Manager", required: 1 })]);
    expect(memory.read().approval_requirements).toContainEqual(expect.objectContaining({
      approval_role: "Procurement Team",
      status: "Approved",
    }));
  });

  it("preserves submitted legacy docstatus and tolerates a missing duplicate status field", async () => {
    const legacy = document("Procurement", {
      docstatus: 1,
      approval_requirements: [
        { ...pending("Engineering Manager"), status: "Approved" },
        pending("Procurement Team"),
      ],
    });
    delete legacy.status;
    const memory = memoryDependencies(legacy);

    await expect(applyEcrWorkflowActionCore({
      name: "1j3b9i4moj",
      action: "Approve",
      reviewFields: PROCUREMENT_REVIEW,
      principal: principal("procurement_team"),
    }, memory.dependencies)).resolves.toMatchObject({ newStatus: "RFQ Pending" });
    expect(memory.read()).toMatchObject({
      select_pxfp: "RFQ Pending",
      docstatus: 1,
    });
    expect(Object.prototype.hasOwnProperty.call(memory.read(), "status")).toBe(false);
    expect(memory.read().approval_requirements?.filter((row) => row.status === "Pending"))
      .toEqual([expect.objectContaining({ approval_role: "Procurement Manager" })]);
  });

  it.each([
    ["Send Back", "Draft", "Sent Back"],
    ["Reject", "Rejected", "Rejected"],
  ] as const)(
    "keeps a submitted legacy Procurement Review at docstatus 1 for %s",
    async (action, expectedStatus, expectedTaskStatus) => {
      const legacy = document("Procurement", {
        docstatus: 1,
        approval_requirements: [
          { ...pending("Engineering Manager"), status: "Approved" },
          pending("Procurement Team"),
        ],
      });
      const memory = memoryDependencies(legacy);

      await expect(applyEcrWorkflowActionCore({
        name: "1j3b9i4moj",
        action,
        comment: action === "Send Back" ? "Please revise." : "Not acceptable.",
        principal: principal("procurement_team"),
      }, memory.dependencies)).resolves.toMatchObject({ newStatus: expectedStatus });

      expect(memory.read()).toMatchObject({
        select_pxfp: expectedStatus,
        status: expectedStatus,
        docstatus: 1,
      });
      expect(memory.read().approval_requirements).toContainEqual(expect.objectContaining({
        approval_role: "Procurement Team",
        status: expectedTaskStatus,
      }));
      expect(memory.read().approval_requirements?.filter((row) => row.status === "Pending"))
        .toEqual([]);
    },
  );

  it("does not let the live legacy Procurement row bypass its missing current task", async () => {
    const legacy = document("Procurement", {
      docstatus: 1,
      approval_requirements: [
        { ...pending("Engineering Manager"), status: "Approved" },
      ],
    });
    const memory = memoryDependencies(legacy);
    await expect(applyEcrWorkflowActionCore({
      name: "1j3b9i4moj",
      action: "Approve",
      reviewFields: PROCUREMENT_REVIEW,
      principal: principal("procurement_team"),
    }, memory.dependencies)).rejects.toThrow(/exactly one active Procurement Team task/i);
    expect(memory.commitWorkflowDocument).not.toHaveBeenCalled();
  });

  it.each([
    ["Engineering Review", "engineering", "Engineering Manager"],
    ["Procurement Review", "procurement_team", "Procurement Team"],
  ] as const)("supports Send Back and Reject at %s", async (status, role, taskRole) => {
    const sentBack = memoryDependencies(document(status, { approval_requirements: [pending(taskRole)] }));
    await expect(applyEcrWorkflowActionCore({
      name: "1j3b9i4moj", action: "Send Back", comment: "Please revise.", principal: principal(role),
    }, sentBack.dependencies)).resolves.toMatchObject({ newStatus: "Draft" });
    expect(sentBack.read().approval_requirements).toContainEqual(expect.objectContaining({
      approval_role: taskRole, status: "Sent Back",
    }));
    expect(sentBack.read()).toMatchObject({ select_pxfp: "Draft", status: "Draft", docstatus: 0 });
    expect(sentBack.read().approval_requirements?.filter((row) => row.status === "Pending")).toEqual([]);

    const rejected = memoryDependencies(document(status, { approval_requirements: [pending(taskRole)] }));
    await expect(applyEcrWorkflowActionCore({
      name: "1j3b9i4moj", action: "Reject", comment: "Not acceptable.", principal: principal(role),
    }, rejected.dependencies)).resolves.toMatchObject({ newStatus: "Rejected" });
    expect(rejected.read()).toMatchObject({ select_pxfp: "Rejected", status: "Rejected", docstatus: 0 });
    expect(rejected.read().approval_requirements?.filter((row) => row.status === "Pending")).toEqual([]);
  });

  it.each([
    "Procurement Assessment",
    "Supplier Requirement",
    "RFQ Requirement",
  ])("requires %s before Procurement Team approval", async (missingField) => {
    const memory = memoryDependencies(document("Procurement Review", {
      approval_requirements: [pending("Procurement Team")],
    }));
    await expect(applyEcrWorkflowActionCore({
      name: "1j3b9i4moj",
      action: "Approve",
      reviewFields: Object.fromEntries(
        Object.entries(PROCUREMENT_REVIEW).filter(([field]) => field !== missingField),
      ),
      principal: principal("procurement_team"),
    }, memory.dependencies)).rejects.toMatchObject({
      status: 422,
      fieldErrors: { [missingField]: expect.stringContaining("required") },
    });
    expect(memory.commitWorkflowDocument).not.toHaveBeenCalled();
  });

  it.each([
    ["Supplier Requirement", "Maybe", /Yes, No/i],
    ["RFQ Requirement", "Maybe", /Required, Not Required/i],
  ] as const)("rejects an uncontrolled %s value", async (field, value, message) => {
    const memory = memoryDependencies(document("Procurement Review", {
      approval_requirements: [pending("Procurement Team")],
    }));
    await expect(applyEcrWorkflowActionCore({
      name: "1j3b9i4moj",
      action: "Approve",
      reviewFields: { ...PROCUREMENT_REVIEW, [field]: value },
      principal: principal("procurement_team"),
    }, memory.dependencies)).rejects.toMatchObject({
      status: 422,
      fieldErrors: { [field]: expect.stringMatching(message) },
    });
    expect(memory.commitWorkflowDocument).not.toHaveBeenCalled();
  });

  it("accepts the negative controlled selections without changing the RFQ handoff", async () => {
    const memory = memoryDependencies(document("Procurement Review", {
      approval_requirements: [pending("Procurement Team")],
    }));
    await expect(applyEcrWorkflowActionCore({
      name: "1j3b9i4moj",
      action: "Approve",
      reviewFields: {
        ...PROCUREMENT_REVIEW,
        "Supplier Requirement": "No",
        "RFQ Requirement": "Not Required",
      },
      principal: principal("procurement_team"),
    }, memory.dependencies)).resolves.toMatchObject({ newStatus: "RFQ Pending" });
  });

  it.each(["No", ""])(
    "blocks Procurement Team approval when Supplier Required is %j",
    async (supplierRequired) => {
      const memory = memoryDependencies(document("Procurement Review", {
        supplier_response_required: supplierRequired,
        approval_requirements: [pending("Procurement Team")],
      }));
      await expect(applyEcrWorkflowActionCore({
        name: "1j3b9i4moj",
        action: "Approve",
        reviewFields: PROCUREMENT_REVIEW,
        principal: principal("procurement_team"),
      }, memory.dependencies)).rejects.toMatchObject({
        status: 422,
        fieldErrors: {
          supplier_response_required: expect.stringContaining("must be Yes"),
        },
      });
      expect(memory.commitWorkflowDocument).not.toHaveBeenCalled();
    },
  );

  it("fails closed for a missing, duplicate, future, or wrong-role task", async () => {
    const invalidRows: EcrApprovalRequirement[][] = [
      [],
      [pending("Procurement Manager")],
      [{ ...pending("Procurement Team"), required: 0 }],
      [pending("Procurement Team"), pending("Procurement Team", "TASK-DUPLICATE")],
      [pending("Procurement Team"), pending("Procurement Manager", "TASK-FUTURE")],
    ];
    for (const rows of invalidRows) {
      const memory = memoryDependencies(document("Procurement Review", { approval_requirements: rows }));
      await expect(applyEcrWorkflowActionCore({
        name: "1j3b9i4moj", action: "Approve", reviewFields: PROCUREMENT_REVIEW, principal: principal("procurement_team"),
      }, memory.dependencies)).rejects.toThrow(/exactly one active Procurement Team task/i);
      expect(memory.commitWorkflowDocument).not.toHaveBeenCalled();
    }
  });

  it("rejects cross-role actions", async () => {
    const procurementReview = memoryDependencies(document("Procurement Review", {
      approval_requirements: [pending("Procurement Team")],
    }));
    await expect(applyEcrWorkflowActionCore({
      name: "1j3b9i4moj", action: "Approve", reviewFields: PROCUREMENT_REVIEW, principal: principal("procurement"),
    }, procurementReview.dependencies)).rejects.toThrow(/Access denied/i);

    const rfqPending = memoryDependencies(document("RFQ Pending", {
      approval_requirements: [pending("Procurement Manager")], rfq: "RFQ-00001",
    }));
    await expect(applyEcrWorkflowActionCore({
      name: "1j3b9i4moj", action: "Create RFQ", principal: principal("procurement_team"),
    }, rfqPending.dependencies)).rejects.toThrow(/Access denied/i);
  });

  it("requires the ECR owner for Draft submission", async () => {
    const memory = memoryDependencies(document("Draft"));
    await expect(applyEcrWorkflowActionCore({
      name: "1j3b9i4moj", action: "Submit ECR", principal: principal("engineer", "other@netlink.com"),
    }, memory.dependencies)).rejects.toThrow(/Only the ECR owner/i);
  });

  it("allows only Procurement Manager to finalize a persisted RFQ and task", async () => {
    const memory = memoryDependencies(document("RFQ Pending", {
      approval_requirements: [
        { ...pending("Procurement Team"), status: "Approved" },
        pending("Procurement Manager"),
      ],
      rfq: "RFQ-00001",
    }));
    const result = await applyEcrWorkflowActionCore({
      name: "1j3b9i4moj", action: "Create RFQ", principal: principal("procurement", "procurement.manager@netlink.com"),
    }, memory.dependencies);
    expect(result.newStatus).toBe("RFQ");
    expect(result.approvalRequirements.filter((row) => row.status === "Pending")).toEqual([]);
    expect(result.approvalRequirements).toContainEqual(expect.objectContaining({
      approval_role: "Procurement Manager", status: "Completed", approver: "procurement.manager@netlink.com",
    }));
    expect(memory.read()).toMatchObject({
      select_pxfp: "RFQ", status: "RFQ", rfq: "RFQ-00001", docstatus: 1,
    });
  });

  it("does not advance RFQ Pending through the generic endpoint without RFQ evidence", async () => {
    const memory = memoryDependencies(document("RFQ Pending", {
      approval_requirements: [pending("Procurement Manager")],
    }));
    await expect(applyEcrWorkflowActionCore({
      name: "1j3b9i4moj", action: "Create RFQ", principal: principal("procurement"),
    }, memory.dependencies)).rejects.toThrow(/persisted RFQ linked/i);
    expect(memory.commitWorkflowDocument).not.toHaveBeenCalled();
  });
});
