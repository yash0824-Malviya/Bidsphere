import { describe, expect, it } from "vitest";
import {
  assertEcrWorkflowPermission,
  assertPrWorkflowPermission,
  enforceEcrMutationRbac,
  enforcePrMutationRbac,
  resolveServerRole,
  type AccessPrincipal,
  type AppRole,
} from "./rbacAuth";

function principal(role: AppRole): Extract<AccessPrincipal, { typ: "internal" }> {
  return {
    typ: "internal",
    sub: `${role}@example.com`,
    email: `${role}@example.com`,
    role,
    iat: Date.now(),
    exp: Date.now() + 60_000,
  };
}

describe("server ECR RBAC", () => {
  it("uses actual ERP roles for ECR identities", () => {
    expect(resolveServerRole({ name: "any", email: "any@example.com", erpnext_roles: ["Desk User", "Purchase User", "Quality Manager"] })).toBe("quality");
  });

  it("does not promote an unrecognized ERP user to Procurement Manager", () => {
    expect(resolveServerRole({
      name: "desk.user@example.com",
      email: "desk.user@example.com",
      erpnext_roles: ["Desk User"],
    })).toBeNull();
    expect(resolveServerRole({
      name: "unknown@example.com",
      email: "unknown@example.com",
      erpnext_roles: [],
    })).toBeNull();
  });

  it("does not restore a revoked well-known account from its email address", () => {
    expect(resolveServerRole({
      name: "procurement@netlink.com",
      email: "procurement@netlink.com",
      erpnext_roles: [],
    })).toBeNull();
  });

  it("requires matching role and server-loaded status", () => {
    expect(() => assertEcrWorkflowPermission(principal("engineering"), "Approve", "Engineering Review")).not.toThrow();
    expect(() => assertEcrWorkflowPermission(principal("procurement_team"), "Approve", "Procurement Review")).not.toThrow();
    expect(() => assertEcrWorkflowPermission(principal("procurement"), "Create RFQ", "RFQ Pending")).not.toThrow();
    expect(() => assertEcrWorkflowPermission(principal("procurement_team"), "Create RFQ", "RFQ Pending")).toThrow(/cannot perform/i);
    expect(() => assertEcrWorkflowPermission(principal("engineering"), "Approve Operations Review", "Operations Review")).toThrow(/cannot perform/i);
    expect(() => assertEcrWorkflowPermission(principal("operations"), "Approve Operations Review", "Engineering Review")).toThrow(/cannot perform/i);
  });

  it("prevents approval managers from creating requests", () => {
    expect(() => enforceEcrMutationRbac(principal("engineering"), "resource/Engineering%20Change%20Request", "POST", {})).toThrow(/secured \/api\/ecr-create/i);
    expect(() => enforceEcrMutationRbac(principal("engineer"), "resource/Engineering%20Change%20Request", "POST", {})).toThrow(/secured \/api\/ecr-create/i);
  });

  it("prevents engineers from creating or editing another engineer's ECR", () => {
    const engineer = principal("engineer");
    expect(() => enforceEcrMutationRbac(
      engineer,
      "resource/Engineering%20Change%20Request",
      "POST",
      { ecr_owner: "someone.else@example.com" },
    )).toThrow(/secured \/api\/ecr-create/i);

    expect(() => enforceEcrMutationRbac(
      engineer,
      "resource/Engineering%20Change%20Request/ECR-001",
      "PUT",
      { ecr_title: "Changed" },
      "Draft",
      { ecr_owner: "someone.else@example.com" },
    )).toThrow(/only their own ECRs/i);

    expect(() => enforceEcrMutationRbac(
      engineer,
      "resource/Engineering%20Change%20Request/ECR-001",
      "PUT",
      { ecr_title: "Changed" },
      "Sent Back",
      { ecr_owner: engineer.email },
    )).not.toThrow();
  });

  it("prevents a Sent Back owner from rewriting owner or downstream traceability", () => {
    const engineer = principal("engineer");
    for (const payload of [
      { ecr_owner: "someone.else@example.com" },
      { purchase_order: "PO-ATTACK" },
      { bidsphere_create_idempotency_key: "replacement" },
    ]) {
      expect(() => enforceEcrMutationRbac(
        engineer,
        "resource/Engineering%20Change%20Request/ECR-001",
        "PUT",
        payload,
        "Sent Back",
        { ecr_owner: engineer.email },
      )).toThrow(/server-managed|cannot update/i);
    }
  });

  it("does not let non-admin roles delete ECRs", () => {
    expect(() => enforceEcrMutationRbac(principal("engineer"), "resource/Engineering%20Change%20Request/ECR-001", "DELETE", {}, "Draft")).toThrow(/administrator/i);
  });

  it("blocks generic Frappe mutations from bypassing secured ECR endpoints", () => {
    expect(() => enforceEcrMutationRbac(
      principal("engineer"),
      "method/frappe.client.save",
      "POST",
      { doc: { doctype: "Engineering Change Request", name: "ECR-001" } },
      "Draft",
    )).toThrow(/generic ERP document mutations are disabled/i);
  });

  it("blocks direct Frappe workflow calls for reviewers and administrators", () => {
    const body = {
      doc: { doctype: "Engineering Change Request", name: "ECR-001" },
      action: "Approve",
    };
    for (const role of ["engineering", "admin"] as const) {
      expect(() => enforceEcrMutationRbac(
        principal(role),
        "method/frappe.model.workflow.apply_workflow",
        "POST",
        body,
        "Engineering Review",
      )).toThrow(/secured \/api\/ecr-workflow-action endpoint/i);
    }
  });

  it("blocks direct REST writes to workflow-controlled ECR status fields", () => {
    expect(() => enforceEcrMutationRbac(
      principal("engineer"),
      "resource/Engineering Change Request/ECR-001",
      "PUT",
      { select_pxfp: "Approved" },
      "Draft",
    )).toThrow(/authorized workflow action/i);
  });

  it("protects approval tasks, business numbers, and audit metadata on parent writes", () => {
    for (const role of ["engineer", "admin"] as const) {
      expect(() => enforceEcrMutationRbac(
        principal(role),
        "resource/Engineering Change Request/ECR-001",
        "PUT",
        {
          approval_requirements: [],
          ecr_number: "ECR-2099-99999",
          modified: "2026-08-26 10:30:00.331567",
        },
        "Sent Back",
      )).toThrow(/server-managed/i);
    }
  });

  it("does not allow generic ECR resource creation", () => {
    expect(() => enforceEcrMutationRbac(
      principal("engineer"),
      "resource/Engineering Change Request",
      "POST",
      { select_pxfp: "Approved", docstatus: 1 },
    )).toThrow(/secured \/api\/ecr-create/i);
  });

  it("does not accept fabricated approval history during ECR creation", () => {
    expect(() => enforceEcrMutationRbac(
      principal("engineer"),
      "resource/Engineering Change Request",
      "POST",
      {
        ecr_number: "ECR-2026-85517",
        approval_requirements: [{ approval_role: "Program Manager", status: "Approved" }],
      },
    )).toThrow(/secured \/api\/ecr-create/i);
  });

  it("reserves ECR purchase-requisition and RFQ links for trusted endpoints", () => {
    expect(() => enforceEcrMutationRbac(
      principal("procurement"),
      "resource/Engineering Change Request/ECR-001",
      "PUT",
      { purchase_requisition: "PR-001" },
      "RFQ Pending",
    )).toThrow(/server-managed/i);
    for (const method of ["PUT", "PATCH"] as const) {
      for (const role of ["procurement", "procurement_team", "admin"] as const) {
        expect(() => enforceEcrMutationRbac(
          principal(role),
          "resource/Engineering Change Request/ECR-001",
          method,
          { rfq: "RFQ-001" },
          "RFQ Pending",
        )).toThrow(/server-managed/i);
      }
    }
    expect(() => enforceEcrMutationRbac(
      principal("procurement"),
      "resource/Engineering Change Request/ECR-001",
      "PUT",
      { affected_parts: [] },
      "RFQ Pending",
    )).toThrow(/only downstream ECR traceability fields/i);
  });
});

describe("server Purchase Requisition RBAC", () => {
  it("separates team submission from manager review and approval", () => {
    expect(() => assertPrWorkflowPermission(
      principal("procurement_team"),
      "Submit Requisition",
      "Draft",
    )).not.toThrow();
    expect(() => assertPrWorkflowPermission(
      principal("procurement_team"),
      "Approve Requisition",
      "Under Review",
    )).toThrow(/cannot perform/i);
    expect(() => assertPrWorkflowPermission(
      principal("procurement"),
      "Start Review",
      "Submitted",
    )).not.toThrow();
    expect(() => assertPrWorkflowPermission(
      principal("procurement"),
      "Approve Requisition",
      "Under Review",
    )).not.toThrow();
    expect(() => assertPrWorkflowPermission(
      principal("procurement"),
      "Submit Requisition",
      "Draft",
    )).not.toThrow();
  });

  it("keeps workflow state checks for admins and reserves RFQ completion for the server", () => {
    expect(() => assertPrWorkflowPermission(
      principal("admin"),
      "Approve Requisition",
      "Submitted",
    )).toThrow(/cannot perform/i);
    expect(() => assertPrWorkflowPermission(
      principal("procurement"),
      "Mark RFQ Created",
      "Approved",
    )).toThrow(/cannot perform/i);
  });

  it("rejects supplier workflow actions and direct status writes", () => {
    const supplier: AccessPrincipal = {
      typ: "supplier",
      sub: "SUP-001",
      supplier: "SUP-001",
      iat: Date.now(),
      exp: Date.now() + 60_000,
    };
    expect(() => enforcePrMutationRbac(
      supplier,
      "method/frappe.model.workflow.apply_workflow",
      "POST",
      {
        doc: { doctype: "Purchase Requisition", name: "PR-001" },
        action: "Approve Requisition",
      },
      "Under Review",
    )).toThrow(/internal authentication required/i);
    expect(() => enforcePrMutationRbac(
      principal("procurement"),
      "resource/Purchase Requisition/PR-001",
      "PUT",
      { status: "Approved" },
      "Submitted",
    )).toThrow(/authorized workflow action/i);
  });

  it("blocks generic Purchase Requisition saves", () => {
    expect(() => enforcePrMutationRbac(
      principal("procurement_team"),
      "method/frappe.client.save",
      "POST",
      { doc: { doctype: "Purchase Requisition", name: "PR-001" } },
      "Draft",
    )).toThrow(/generic ERP document mutations are disabled/i);
  });

  it.each(["procurement", "procurement_team", "admin"] as AppRole[])(
    "blocks direct ECR-linked Purchase Requisition creation for %s",
    (role) => {
      expect(() => enforcePrMutationRbac(
        principal(role),
        "resource/Purchase Requisition",
        "POST",
        { ecr_reference: "ECR-001", status: "Draft" },
      )).toThrow(/secured \/api\/create-pr-from-ecr/i);
    },
  );

  it("blocks direct idempotency-key injection and wrapped PR creates", () => {
    expect(() => enforcePrMutationRbac(
      principal("procurement_team"),
      "resource/Purchase Requisition",
      "POST",
      { custom_bidsphere_ecr_idempotency_key: "ECR-001", status: "Draft" },
    )).toThrow(/secured \/api\/create-pr-from-ecr/i);
    expect(() => enforcePrMutationRbac(
      principal("procurement_team"),
      "resource/Purchase Requisition",
      "POST",
      { data: { ecr_reference: "ECR-001", status: "Draft" } },
    )).toThrow(/wrapped data payloads/i);
  });

  it("keeps ECR trace fields server-managed on existing Purchase Requisitions", () => {
    expect(() => enforcePrMutationRbac(
      principal("procurement_team"),
      "resource/Purchase Requisition/PR-001",
      "PUT",
      { ecr_reference: "ECR-OTHER" },
      "Draft",
    )).toThrow(/server-managed/i);
    expect(() => enforcePrMutationRbac(
      principal("admin"),
      "resource/Purchase Requisition/PR-001",
      "PATCH",
      { custom_bidsphere_ecr_idempotency_key: "ECR-OTHER" },
      "Draft",
    )).toThrow(/server-managed/i);
  });

  it("prevents item changes after a Purchase Requisition leaves team editing", () => {
    expect(() => enforcePrMutationRbac(
      principal("procurement_team"),
      "resource/Purchase Requisition/PR-001",
      "PUT",
      { requisition_items: [{ partitem: "REAL-ITEM", quantity: 999 }] },
      "Approved",
    )).toThrow(/only by Procurement Team while Draft or Needs Revision/i);
    expect(() => enforcePrMutationRbac(
      principal("procurement_team"),
      "resource/Purchase Requisition/PR-001",
      "PUT",
      { requisition_items: [{ partitem: "REAL-ITEM", quantity: 2 }] },
      "Draft",
    )).not.toThrow();
  });
});
