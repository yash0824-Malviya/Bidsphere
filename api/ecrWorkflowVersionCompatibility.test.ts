import { describe, expect, it } from "vitest";
import {
  getEcrWorkflowTransition,
  isExtendedEcr,
} from "./ecrWorkflowPolicy";
import {
  getApplicableECRWorkflowStages,
  getECRWorkflowActions,
  getNextApplicableECRStage,
  isExtendedECRWorkflow,
} from "../src/config/ecrRoles";
import type { EngineeringChangeRequest } from "../src/types/erpnext";

const legacyRecords: Array<{ label: string; record: Record<string, unknown> }> = [
  { label: "missing field", record: {} },
  { label: "undefined field", record: { ecr_workflow_version: undefined } },
  { label: "nullable database field", record: { ecr_workflow_version: null } },
  { label: "blank field", record: { ecr_workflow_version: "" } },
  { label: "explicit legacy version", record: { ecr_workflow_version: "legacy" } },
];

describe("optional ECR workflow version compatibility", () => {
  it.each(legacyRecords)("keeps $label on the five-stage workflow in both layers", ({ record }) => {
    // ERP records can contain null even when the frontend's optional field is typed as a string.
    const ecr = record as Partial<EngineeringChangeRequest>;
    expect(isExtendedEcr(record)).toBe(false);
    expect(isExtendedECRWorkflow(ecr)).toBe(false);
    expect(getApplicableECRWorkflowStages(ecr).map(({ id }) => id)).toEqual([
      "Draft", "Engineering Review", "Procurement Review", "RFQ Pending", "RFQ",
    ]);

    for (const [stage, action, nextStage, role] of [
      ["Draft", "Submit ECR", "Engineering Review", "engineer"],
      ["Engineering Review", "Approve", "Procurement Review", "engineering"],
      ["Procurement Review", "Approve", "RFQ Pending", "procurement_team"],
      ["RFQ Pending", "Create RFQ", "RFQ", "procurement"],
    ] as const) {
      expect(getNextApplicableECRStage(stage, action, ecr)).toBe(nextStage);
      expect(getEcrWorkflowTransition(stage, action, record.ecr_workflow_version)).toMatchObject({
        nextStatus: nextStage, roles: [role],
      });
    }

    expect(getECRWorkflowActions("engineering", "Engineering Review", ecr).map(({ label }) => label))
      .toEqual(["Send Back", "Reject", "Approve"]);
    expect(getECRWorkflowActions("procurement_team", "Procurement Review", ecr).map(({ action }) => action))
      .toEqual(["Send Back", "Reject", "Approve"]);
    expect(getECRWorkflowActions("procurement", "RFQ Pending", ecr).map(({ action }) => action))
      .toEqual(["Create RFQ"]);
    expect(getEcrWorkflowTransition("Engineering Review", "Approve Technical", record.ecr_workflow_version)).toBeNull();
    expect(getEcrWorkflowTransition("Final ECR Approval", "Approve ECR", record.ecr_workflow_version)).toBeNull();
  });

  it("uses the established extended_v1 version for technical approval without exposing legacy procurement steps", () => {
    const ecr = { ecr_workflow_version: "extended_v1" };
    expect(isExtendedEcr(ecr)).toBe(true);
    expect(isExtendedECRWorkflow(ecr)).toBe(true);
    expect(getNextApplicableECRStage("Engineering Review", "Approve", ecr)).toBe("Technical Approved");
    expect(getEcrWorkflowTransition("Engineering Review", "Approve", ecr.ecr_workflow_version)).toMatchObject({
      nextStatus: "Technical Approved", roles: ["engineering"],
    });
    expect(getECRWorkflowActions("engineering", "Engineering Review", ecr).map(({ label }) => label))
      .toEqual(["Send Back", "Reject", "Technical Approval"]);
    expect(getECRWorkflowActions("procurement_team", "Procurement Review", ecr)).toEqual([]);
    expect(getECRWorkflowActions("procurement", "RFQ Pending", ecr)).toEqual([]);
    expect(getEcrWorkflowTransition("Procurement Review", "Approve", ecr.ecr_workflow_version)).toBeNull();
    expect(getEcrWorkflowTransition("RFQ Pending", "Create RFQ", ecr.ecr_workflow_version)).toBeNull();
  });
});
