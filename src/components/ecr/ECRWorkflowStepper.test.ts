import { describe, expect, it } from "vitest";

import { ECR_WORKFLOW_STAGES } from "../../config/ecrRoles";
import { getECRWorkflowActiveIndex } from "./ecrWorkflowPresentation";

describe("ECRWorkflowStepper", () => {
  it("contains exactly the five simplified demo stages", () => {
    expect(ECR_WORKFLOW_STAGES.map((stage) => stage.label)).toEqual([
      "Draft",
      "Engineering Review",
      "Procurement Review",
      "RFQ Pending",
      "RFQ",
    ]);
  });

  it("uses the same canonical stage for status and progress", () => {
    expect(getECRWorkflowActiveIndex("Draft")).toBe(0);
    expect(getECRWorkflowActiveIndex("Engineering Review")).toBe(1);
    expect(getECRWorkflowActiveIndex("Procurement Review")).toBe(2);
    expect(getECRWorkflowActiveIndex("RFQ Pending")).toBe(3);
    // Legacy post-engineering states resume at the Procurement Team gate.
    expect(getECRWorkflowActiveIndex("Approved")).toBe(2);
    expect(getECRWorkflowActiveIndex("Procurement")).toBe(2);
    expect(getECRWorkflowActiveIndex("RFQ")).toBe(4);
    expect(getECRWorkflowActiveIndex("Implementation")).toBe(2);
    expect(getECRWorkflowActiveIndex("Implementation", "RFQ-2026-0042")).toBe(4);
    expect(getECRWorkflowActiveIndex("Rejected")).toBe(-1);
    expect(getECRWorkflowActiveIndex("unrecognized future gate")).toBe(-1);
  });
});
