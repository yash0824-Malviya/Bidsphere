import { describe, expect, it } from "vitest";
import {
  assertEcrStateReconciliationIsSafe,
  canonicalEcrApprovalRole,
  expectedEcrWorkflowDocstatus,
  isReservedNewEcrNumber,
  maxNewEcrSeriesCounter,
  reconciledEcrWorkflowState,
  reconcileApprovalTasks,
  reserveUniqueEcrNumber,
  stableLegacyEcrNumber,
  validateCancelledEcrReconciliation,
  validateEcrDocstatusReconciliation,
  validateExistingEcrRows,
} from "./ecr-workflow-migration-policy.mjs";

const states = new Set([
  "Draft",
  "Engineering Review",
  "Procurement Review",
  "RFQ Pending",
  "RFQ",
  "Closed",
]);

describe("ECR workflow migration policy", () => {
  it("fails before legacy state rewrites while an old ECR workflow is active", () => {
    expect(() => assertEcrStateReconciliationIsSafe([
      { name: "1j3b9i4moj", select_pxfp: "Approved", rfq: "" },
    ], ["ECR Approval Workflow"])).toThrow(/Deactivate those ECR workflows/i);
    expect(() => assertEcrStateReconciliationIsSafe([
      { name: "ECR-00002", select_pxfp: "Procurement Review", rfq: "" },
    ], ["ECR Approval Workflow"])).not.toThrow();
    expect(() => assertEcrStateReconciliationIsSafe([
      { name: "1j3b9i4moj", select_pxfp: "Approved", rfq: "" },
    ], [])).not.toThrow();
  });

  it("reconciles the critical approved record to Procurement Review until RFQ evidence exists", () => {
    expect(reconciledEcrWorkflowState({
      name: "1j3b9i4moj",
      select_pxfp: "Approved",
      supplier_response_required: "Yes",
      rfq: "",
    })).toBe("Procurement Review");
    expect(reconciledEcrWorkflowState({
      name: "1j3b9i4moj",
      select_pxfp: "Implementation",
      rfq: "RFQ-00001",
    })).toBe("RFQ");
  });

  it.each([
    ["Engineering Manager Approval", "Engineering Review"],
    ["Under Review", "Engineering Review"],
    ["Procurement.team Review", "Procurement Review"],
    ["Operations Review", "Procurement Review"],
    ["Purchase Requisition", "Procurement Review"],
    ["Supplier Selection", "Procurement Review"],
    ["Validation", "Procurement Review"],
  ])("maps legacy nonterminal %s to %s", (select_pxfp, expected) => {
    expect(reconciledEcrWorkflowState({ select_pxfp, rfq: "" })).toBe(expected);
  });

  it.each([
    ["Sent Back", "Sent Back"],
    ["Needs Revision", "Sent Back"],
    ["Closed", "Closed"],
    ["Rejected", "Rejected"],
    ["Cancelled", "Cancelled"],
  ])("preserves non-actionable legacy state %s as %s", (select_pxfp, expected) => {
    expect(reconciledEcrWorkflowState({ select_pxfp, rfq: "RFQ-00001" })).toBe(expected);
  });

  it("trusts RFQ Pending only after persisted Procurement Team approval", () => {
    expect(reconciledEcrWorkflowState({
      select_pxfp: "RFQ Pending",
      approval_requirements: [{ approval_role: "Procurement.team", status: "Approved" }],
    })).toBe("RFQ Pending");
    expect(reconciledEcrWorkflowState({
      select_pxfp: "RFQ Pending",
      approval_requirements: [{ approval_role: "Engineering Manager", status: "Approved" }],
    })).toBe("Procurement Review");
  });

  it("canonicalizes punctuated task roles and retains exactly one current-stage task", () => {
    expect(canonicalEcrApprovalRole("Procurement.team")).toBe("Procurement Team");
    const rows = reconcileApprovalTasks({
      select_pxfp: "Procurement.team Review",
      requesting_department: "Engineering",
      approval_requirements: [
        { approval_role: "Engineering.manager", status: "Approved", required: 1 },
        { name: "TEAM-TASK", approval_role: "Procurement.team", status: "pending", required: 1 },
        { name: "STALE-MANAGER", approval_role: "Procurement Manager", status: "Pending", required: 1 },
      ],
    });
    expect(rows.filter((row) => row.status === "Pending")).toEqual([
      expect.objectContaining({
        name: "TEAM-TASK",
        approval_role: "Procurement Team",
        required: 1,
      }),
    ]);
    expect(rows).toContainEqual(expect.objectContaining({
      approval_role: "Engineering Manager",
      status: "Approved",
    }));
  });

  it("derives the live Procurement task repair but requires a trusted docstatus patch", () => {
    const live = {
      select_pxfp: "Procurement",
      docstatus: 1,
      approval_requirements: [
        { approval_role: "Engineering Manager", status: "Approved", required: 1 },
      ],
    };
    const rows = reconcileApprovalTasks(live);
    expect(reconciledEcrWorkflowState(live)).toBe("Procurement Review");
    expect(expectedEcrWorkflowDocstatus(live)).toBe(0);
    expect(rows.filter((row) => row.status === "Pending")).toEqual([
      expect.objectContaining({ approval_role: "Procurement Team", required: 1 }),
    ]);
  });

  it("keeps every reversible review stage at docstatus 0 and submits only RFQ", () => {
    expect(() => validateEcrDocstatusReconciliation([
      { name: "DRAFT", select_pxfp: "Draft", docstatus: 0 },
      { name: "ENG", select_pxfp: "Engineering Review", docstatus: 0 },
      { name: "PROC", select_pxfp: "Procurement Review", docstatus: 0 },
      {
        name: "MANAGER",
        select_pxfp: "RFQ Pending",
        docstatus: 0,
        approval_requirements: [{ approval_role: "Procurement Team", status: "Approved" }],
      },
      { name: "RFQ", select_pxfp: "RFQ", rfq: "RFQ-1", docstatus: 1 },
      { name: "REJECTED", select_pxfp: "Rejected", docstatus: 0 },
    ])).not.toThrow();
  });

  it("rejects submitted legacy review rows until a trusted patch canonicalizes docstatus", () => {
    expect(() => validateEcrDocstatusReconciliation([{
      name: "LEGACY-ENG",
      select_pxfp: "Engineering Review",
      docstatus: 1,
    }])).toThrow(/trusted server-side data patch/i);
    const legacyProcurement = {
      name: "LEGACY-PROC",
      select_pxfp: "Procurement",
      docstatus: 1,
    };
    expect(reconciledEcrWorkflowState(legacyProcurement)).toBe("Procurement Review");
    expect(expectedEcrWorkflowDocstatus(legacyProcurement)).toBe(0);
    expect(() => validateEcrDocstatusReconciliation([legacyProcurement]))
      .toThrow(/trusted server-side data patch/i);
  });

  it.each(["Draft", "Rejected"])(
    "rejects submitted legacy Procurement outcomes at %s until patched",
    (targetState) => {
      const legacy = {
        name: `LEGACY-${targetState.toUpperCase()}`,
        select_pxfp: targetState,
        docstatus: 1,
      };
      expect(expectedEcrWorkflowDocstatus(legacy, targetState)).toBe(0);
      expect(() => validateEcrDocstatusReconciliation([legacy]))
        .toThrow(/trusted server-side data patch/i);
    },
  );

  it("preserves the public number for the critical opaque legacy record", () => {
    expect(stableLegacyEcrNumber("1j3b9i4moj")).toBe("ECR-2026-85517");
    expect(reserveUniqueEcrNumber("1j3b9i4moj", new Set()))
      .toBe("ECR-2026-85517");
  });

  it("keeps the rare legacy 100000 value outside the new 100001+ band", () => {
    expect(isReservedNewEcrNumber("ECR-2026-100000")).toBe(false);
    expect(isReservedNewEcrNumber("ECR-2026-100001")).toBe(true);
  });

  it("derives the counter floor only from current-year new-series document names", () => {
    expect(maxNewEcrSeriesCounter([
      { name: "ECR-2026-100001" },
      { name: "ECR-2026-100087" },
      { name: "ECR-2025-199999" },
      { name: "opaque", ecr_number: "ECR-2026-199999" },
    ], 2026)).toBe(87);
  });

  it("fails before trying to REST-edit cancelled records that need reconciliation", () => {
    expect(() => validateCancelledEcrReconciliation([{
      name: "ECR-2026-00002",
      docstatus: 2,
      ecr_number: "",
      approval_requirements: [{ status: "Pending" }],
    }])).toThrow(/trusted server-side data patch/i);
    expect(() => validateCancelledEcrReconciliation([{
      name: "ECR-2026-00003",
      docstatus: 2,
      ecr_number: "ECR-2026-00003",
      approval_requirements: [{ status: "Rejected" }],
    }])).not.toThrow();
  });

  it("accepts unambiguous known-state records", () => {
    expect(() => validateExistingEcrRows([
      { name: "opaque", ecr_number: "ECR-2026-85517", select_pxfp: "Engineering Review" },
      { name: "ECR-2026-100001", ecr_number: "ECR-2026-100001", select_pxfp: "Draft" },
      { name: "punctuated", ecr_number: "ECR-2026-85518", select_pxfp: "Procurement.team Review" },
    ], states)).not.toThrow();
  });

  it("rejects a persisted workflow-state/docstatus mismatch when a schema is supplied", () => {
    expect(() => validateExistingEcrRows([{
      name: "opaque",
      ecr_number: "ECR-2026-85517",
      select_pxfp: "Engineering Review",
      docstatus: 0,
    }], states, { "Engineering Review": 1 })).toThrow(/requires 1/i);
  });

  it.each([
    [[
      { name: "one", ecr_number: "ECR-2026-85517", select_pxfp: "Draft" },
      { name: "two", ecr_number: "ecr-2026-85517", select_pxfp: "Closed" },
    ], /duplicated/i],
    [[{ name: "one", ecr_number: "", select_pxfp: "Unknown" }], /unsupported workflow state/i],
    [[
      { name: "opaque", ecr_number: "ECR-2026-100001", select_pxfp: "Draft" },
    ], /reserved new-series/i],
    [[
      { name: "opaque", ecr_number: "ECR-2026-85517", select_pxfp: "Draft" },
      { name: "ECR-2026-85517", ecr_number: "", select_pxfp: "Draft" },
    ], /collides with document name/i],
  ])("rejects unsafe persisted data %#", (rows, expected) => {
    expect(() => validateExistingEcrRows(rows, states)).toThrow(expected);
  });
});
