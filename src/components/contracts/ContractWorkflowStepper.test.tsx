import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ContractWorkflowStepper, {
  CONTRACT_WORKFLOW_STEPS,
  determineActiveStep,
} from "./ContractWorkflowStepper";

describe("ContractWorkflowStepper", () => {
  it("defines all 11 required lifecycle steps in exact sequential order", () => {
    expect(CONTRACT_WORKFLOW_STEPS).toHaveLength(11);
    expect(CONTRACT_WORKFLOW_STEPS.map(s => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(CONTRACT_WORKFLOW_STEPS[0].title).toBe("1. RFQ Award");
    expect(CONTRACT_WORKFLOW_STEPS[1].title).toBe("2. Contract Request");
    expect(CONTRACT_WORKFLOW_STEPS[2].title).toBe("3. Procurement Details");
    expect(CONTRACT_WORKFLOW_STEPS[3].title).toBe("4. Create Contract");
    expect(CONTRACT_WORKFLOW_STEPS[4].title).toBe("5. Legal Review");
    expect(CONTRACT_WORKFLOW_STEPS[5].title).toBe("6. Legal Approval");
    expect(CONTRACT_WORKFLOW_STEPS[6].title).toBe("7. E-Signature");
    expect(CONTRACT_WORKFLOW_STEPS[7].title).toBe("8. Finance Approval");
    expect(CONTRACT_WORKFLOW_STEPS[8].title).toBe("9. Purchase Order");
    expect(CONTRACT_WORKFLOW_STEPS[9].title).toBe("10. Supplier Acceptance");
    expect(CONTRACT_WORKFLOW_STEPS[10].title).toBe("11. Contract Completed");
  });

  it("calculates Step 3 as current when contract has not been created yet", () => {
    const { activeStep, stepStates } = determineActiveStep(false);
    expect(activeStep).toBe(3);
    expect(stepStates[1]).toBe("completed");
    expect(stepStates[2]).toBe("completed");
    expect(stepStates[3]).toBe("current");
    expect(stepStates[4]).toBe("upcoming");
    expect(stepStates[5]).toBe("upcoming");
    expect(stepStates[11]).toBe("upcoming");
  });

  it("calculates Step 5 as current when contract is created and in legal review", () => {
    const { activeStep, stepStates } = determineActiveStep(true, "legal_review");
    expect(activeStep).toBe(5);
    expect(stepStates[1]).toBe("completed");
    expect(stepStates[2]).toBe("completed");
    expect(stepStates[3]).toBe("completed");
    expect(stepStates[4]).toBe("completed");
    expect(stepStates[5]).toBe("current");
    expect(stepStates[6]).toBe("upcoming");
  });

  it("calculates Step 7 when contract is in signature phase", () => {
    const { activeStep, stepStates } = determineActiveStep(true, "signature");
    expect(activeStep).toBe(7);
    expect(stepStates[5]).toBe("completed");
    expect(stepStates[6]).toBe("completed");
    expect(stepStates[7]).toBe("current");
    expect(stepStates[8]).toBe("upcoming");
  });

  it("calculates Step 8 when contract is in finance_review phase", () => {
    const { activeStep, stepStates } = determineActiveStep(true, "finance_review");
    expect(activeStep).toBe(8);
    expect(stepStates[7]).toBe("completed");
    expect(stepStates[8]).toBe("current");
    expect(stepStates[9]).toBe("upcoming");
  });

  it("calculates Step 9 when contract is in procurement phase", () => {
    const { activeStep, stepStates } = determineActiveStep(true, "procurement");
    expect(activeStep).toBe(9);
    expect(stepStates[8]).toBe("completed");
    expect(stepStates[9]).toBe("current");
    expect(stepStates[10]).toBe("upcoming");
  });

  it("calculates Step 10 when awaiting supplier acceptance", () => {
    const { activeStep, stepStates } = determineActiveStep(true, undefined, "Pending Supplier Acceptance");
    expect(activeStep).toBe(10);
    expect(stepStates[9]).toBe("completed");
    expect(stepStates[10]).toBe("current");
    expect(stepStates[11]).toBe("upcoming");
  });

  it("calculates Step 11 as completed when contract is completed", () => {
    const { activeStep, stepStates } = determineActiveStep(true, "completed");
    expect(activeStep).toBe(11);
    expect(stepStates[10]).toBe("completed");
    expect(stepStates[11]).toBe("completed");
  });

  it("renders static markup with all step titles and role labels", () => {
    const html = renderToStaticMarkup(<ContractWorkflowStepper contractCreated={false} />);
    expect(html).toContain("11-Step Process");
    expect(html).toContain("RFQ Award");
    expect(html).toContain("Contract Request");
    expect(html).toContain("Procurement Details");
    expect(html).toContain("Create Contract");
    expect(html).toContain("Legal Review");
    expect(html).toContain("Legal Approval");
    expect(html).toContain("Supplier Acceptance");
    expect(html).toContain("E-Signature");
    expect(html).toContain("Finance Approval");
    expect(html).toContain("Purchase Order");
    expect(html).toContain("Completed");
    expect(html).toContain("Procurement Team");
    expect(html).toContain("Legal Team");
    expect(html).toContain("Winning Supplier");
    expect(html).toContain("Finance Team");
  });
});
