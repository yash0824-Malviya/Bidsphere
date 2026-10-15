import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineeringChangeRequest } from "../../types/erpnext";

const harness = vi.hoisted(() => ({ capture: false, cursor: 0, state: [] as unknown[], action: vi.fn() }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useMemo: (factory: () => unknown, dependencies: unknown[]) => harness.capture ? factory() : actual.useMemo(factory, dependencies),
    useState: (initial: unknown) => {
      if (!harness.capture) return actual.useState(initial);
      const index = harness.cursor++;
      if (!(index in harness.state)) harness.state[index] = initial;
      return [harness.state[index], (value: unknown) => {
        harness.state[index] = typeof value === "function" ? value(harness.state[index]) : value;
      }];
    },
  };
});
import ECRApprovalPanel from "./ECRApprovalPanel";

type Element = ReactElement<{
  children?: ReactNode; id?: string; disabled?: boolean; value?: string; required?: boolean; maxLength?: number;
  onClick?: () => void; onChange?: (event: { target: { value: string } }) => void;
}>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement(node) ? textOf((node as Element).props.children) : "";
}
let ecr: EngineeringChangeRequest;
type PanelOptions = Partial<Parameters<typeof ECRApprovalPanel>[0]>;
function renderPanel(options: PanelOptions = {}) {
  harness.cursor = 0; harness.capture = true;
  let tree: ReactNode;
  try {
    tree = ECRApprovalPanel({ role: "program_manager", status: ecr.select_pxfp, ecr,
      approvalRequirements: ecr.approval_requirements, onAction: harness.action, ...options });
  } finally { harness.capture = false; }
  return { tree, html: renderToStaticMarkup(tree) };
}
function button(tree: ReactNode, label: string): Element {
  const found = elements(tree).find((element) => element.type === "button" && textOf(element) === label);
  expect(found, `button ${label}`).toBeDefined(); return found!;
}
function field(tree: ReactNode, id: string): Element {
  const found = elements(tree).find((element) => element.type === "textarea" && element.props.id === id);
  expect(found, `field ${id}`).toBeDefined(); return found!;
}
function enter(id: string, value: string, options: PanelOptions = {}) {
  field(renderPanel(options).tree, id).props.onChange!({ target: { value } });
}
const RATIONALE_ID = "ecr-review-final-decision-rationale";
const COMMENTS_ID = "ecr-review-comments";

describe("Final ECR decision rationale", () => {
  beforeEach(() => {
    vi.clearAllMocks(); harness.state = [];
    ecr = {
      name: "internal-ecr-100010", ecr_number: "ECR-2026-100010", ecr_title: "Latch improvement",
      ecr_owner: "engineer@example.com", priority: "High", requesting_department: "Engineering", plant: "Plant 1",
      target_implementation_date: "2026-10-01", chnage_description: "Strengthen latch", reason_for_change: "Durability",
      ecr_workflow_version: "extended_v1", docstatus: 0, select_pxfp: "Final ECR Approval", modified: "2026-09-15 18:00:00",
      approval_requirements: [{ name: "final-task", approval_role: "Program Manager", required: 1, status: "Pending" }],
    };
  });

  it("renders the dedicated rationale separately from ordinary review comments", () => {
    const view = renderPanel();
    expect(view.html).toContain("Final Decision Rationale *");
    expect(view.html).toContain("Explain the basis for the final ECR decision using the approved Business Case and technical assessment.");
    expect(field(view.tree, RATIONALE_ID).props.maxLength).toBe(2000);
    expect(field(view.tree, COMMENTS_ID).props.maxLength).toBe(4000);
    expect(elements(view.tree).filter((element) => element.type === "textarea")).toHaveLength(2);
    expect(button(view.tree, "Approve ECR").props.disabled).toBe(true);
    expect(button(view.tree, "Reject").props.disabled).toBe(true);
  });

  it.each(["Approve ECR", "Reject"])("does not substitute Review Comments for rationale when taking %s", (action) => {
    enter(COMMENTS_ID, "General review comment");
    enter(RATIONALE_ID, "  \n  ");
    const view = renderPanel(); expect(button(view.tree, action).props.disabled).toBe(true);
    // The handler also validates when called without the browser's disabled-button protection.
    button(view.tree, action).props.onClick!();
    expect(harness.action).not.toHaveBeenCalled();
    expect(renderPanel().html).toContain("Final Decision Rationale is required");
  });

  it.each(["Approve ECR", "Reject"])("passes a dedicated rationale and separate comments when taking %s", (action) => {
    enter(RATIONALE_ID, "  Approved case and technical tests support this decision.  ");
    enter(COMMENTS_ID, "  Release planning note.  ");
    const view = renderPanel(); expect(button(view.tree, action).props.disabled).toBe(false);
    button(view.tree, action).props.onClick!();
    expect(harness.action).toHaveBeenCalledExactlyOnceWith(action, "Release planning note.", {
      "Final Decision Rationale": "Approved case and technical tests support this decision.",
    });
  });

  it("allows approval with a rationale and no optional Review Comments", () => {
    enter(RATIONALE_ID, "Savings and validation evidence justify proceeding.");
    const view = renderPanel(); expect(button(view.tree, "Approve ECR").props.disabled).toBe(false);
    button(view.tree, "Approve ECR").props.onClick!();
    expect(harness.action).toHaveBeenCalledExactlyOnceWith("Approve ECR", "", {
      "Final Decision Rationale": "Savings and validation evidence justify proceeding.",
    });
  });

  it("keeps Reject's existing Review Comments requirement even with rationale present", () => {
    enter(RATIONALE_ID, "Investment is not justified by the forecast.");
    button(renderPanel().tree, "Reject").props.onClick!();
    expect(harness.action).not.toHaveBeenCalled();
    expect(renderPanel().html).toContain("Review Comments are required");
  });

  it("allows Send Back without a rationale while keeping Review Comments required", () => {
    button(renderPanel().tree, "Send Back").props.onClick!();
    expect(harness.action).not.toHaveBeenCalled();
    expect(renderPanel().html).toContain("Review Comments are required");
    enter(COMMENTS_ID, "Revise the financial assumptions.");
    const view = renderPanel(); expect(button(view.tree, "Send Back").props.disabled).toBe(false);
    button(view.tree, "Send Back").props.onClick!();
    expect(harness.action).toHaveBeenCalledExactlyOnceWith("Send Back", "Revise the financial assumptions.", { "Final Decision Rationale": "" });
  });

  it("preserves both entered fields through a failed server response and retry", () => {
    enter(RATIONALE_ID, "Technical validation and the approved budget support approval.");
    enter(COMMENTS_ID, "Coordinate the release date.");
    button(renderPanel().tree, "Approve ECR").props.onClick!();
    const failed = renderPanel({ error: "ERPNext could not save the decision. Please retry." });
    expect(failed.html).toContain("ERPNext could not save the decision. Please retry.");
    expect(field(failed.tree, RATIONALE_ID).props.value).toBe("Technical validation and the approved budget support approval.");
    expect(field(failed.tree, COMMENTS_ID).props.value).toBe("Coordinate the release date.");
    button(failed.tree, "Approve ECR").props.onClick!();
    expect(harness.action).toHaveBeenCalledTimes(2);
    expect(harness.action.mock.calls[1]).toEqual(harness.action.mock.calls[0]);
  });

  it("disables all final decisions while a request is pending", () => {
    enter(RATIONALE_ID, "Approved business and technical evidence."); enter(COMMENTS_ID, "Decision note.");
    const view = renderPanel({ pending: true });
    for (const label of ["Approve ECR", "Reject", "Send Back"]) expect(button(view.tree, label).props.disabled).toBe(true);
  });

  it.each(["finance", "procurement", "quality", "engineering", "engineer"] as const)("does not expose final decisions to %s", (role) => {
    expect(renderPanel({ role }).html).toBe("");
  });

  it("preserves the legacy Engineering assessment and approval payload", () => {
    ecr.ecr_workflow_version = undefined; ecr.select_pxfp = "Engineering Review";
    ecr.approval_requirements = [{ name: "engineering-task", approval_role: "Engineering Manager", required: 1, status: "Pending" }];
    const options: PanelOptions = { role: "engineering" };
    expect(renderPanel(options).html).not.toContain("Final Decision Rationale");
    enter("ecr-review-technical-feasibility", "Feasible with existing process", options);
    enter("ecr-review-engineering-impact", "No interface change", options);
    const view = renderPanel(options); expect(button(view.tree, "Approve").props.disabled).toBe(false);
    button(view.tree, "Approve").props.onClick!();
    expect(harness.action).toHaveBeenCalledExactlyOnceWith("Approve", "", {
      "Technical Feasibility": "Feasible with existing process", "Engineering Impact": "No interface change", "Technical Requirements": "",
    });
  });
});
