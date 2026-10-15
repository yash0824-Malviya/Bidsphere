import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyECRBusinessCasePayload, type ECRBusinessCase, type ECRBusinessCaseAggregate } from "../../types/ecrBusinessCase";
import type { EngineeringChangeRequest } from "../../types/erpnext";

type Action = "approve" | "send_back" | "reject";
type Mutation = {
  mutationFn: (action?: Action) => Promise<ECRBusinessCaseAggregate>;
  onSuccess: (result: ECRBusinessCaseAggregate, action?: Action) => void;
  onError: (error: Error) => void;
};
const harness = vi.hoisted(() => ({
  captureState: false, cursor: 0, state: [] as unknown[], mutations: [] as Mutation[],
  pending: false, request: Promise.resolve(), post: vi.fn(), get: vi.fn(), genericWorkflow: vi.fn(),
  qc: { setQueryData: vi.fn(), invalidateQueries: vi.fn(async () => undefined) },
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => {
    if (!harness.captureState) return actual.useState(initial);
    const slot = harness.cursor++;
    if (!(slot in harness.state)) harness.state[slot] = initial;
    return [harness.state[slot], (value: unknown) => { harness.state[slot] = value; }];
  } };
});
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => harness.qc,
  useMutation: (options: Mutation) => {
    const index = harness.mutations.push(options) - 1;
    return { isPending: index === 0 && harness.pending, mutate: (action?: Action) => {
      harness.request = Promise.resolve().then(() => options.mutationFn(action))
        .then((result) => options.onSuccess(result, action), (error: Error) => options.onError(error));
    } };
  },
}));
vi.mock("../../api/erpnext", () => ({ apiPost: harness.post, apiGet: harness.get, withoutNetworkRetry: () => ({ retry: false }) }));
vi.mock("../../api/ecr", () => ({
  applyECRWorkflowAction: harness.genericWorkflow,
  resolveECRName: async (name: string) => name,
  extractECRErrorMessage: (error: Error) => error.message,
}));
vi.mock("../../api/notifications", () => ({ createNotification: vi.fn(), upsertNotification: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn() } }));
import ECRBusinessCaseReviewPanel from "./ECRBusinessCaseReviewPanel";

let ecr: EngineeringChangeRequest;
let businessCase: ECRBusinessCase;
function renderPanel(options: Partial<Parameters<typeof ECRBusinessCaseReviewPanel>[0]> = {}) {
  harness.cursor = 0;
  harness.mutations = [];
  harness.captureState = true;
  let tree: ReactNode;
  try { tree = ECRBusinessCaseReviewPanel({ ecr, businessCase, role: "finance", queryName: "ECR-2026-100010", ...options }); }
  finally { harness.captureState = false; }
  return { tree, html: renderToStaticMarkup(<MemoryRouter>{tree}</MemoryRouter>) };
}
type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void; disabled?: boolean }>;
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
function button(tree: ReactNode, label: string) {
  const found = elements(tree).find((element) => element.type === "button" && textOf(element) === label);
  expect(found, `button ${label}`).toBeDefined();
  return found!;
}
function enterComment(value: string) {
  const view = renderPanel();
  elements(view.tree).find((element) => element.type === "textarea")!.props.onChange!({ target: { value } });
}
function nextAggregate(): ECRBusinessCaseAggregate {
  return {
    ecr: { ...ecr, select_pxfp: "Procurement BC Review", modified: "2026-09-15 15:01:00", approval_requirements: [
      { name: "finance-task", approval_role: "Finance Manager", status: "Approved", required: 1 },
      { name: "procurement-task", approval_role: "Procurement Manager", status: "Pending", required: 1 },
    ] },
    businessCase: { ...businessCase, status: "Procurement BC Review", finance_status: "Approved" },
  };
}

describe("ECR Business Case review controls", () => {
  beforeEach(() => {
    vi.clearAllMocks(); harness.state = []; harness.pending = false; harness.request = Promise.resolve();
    ecr = { name: "internal-ecr-100010", ecr_number: "ECR-2026-100010", ecr_workflow_version: "extended_v1", docstatus: 0,
      ecr_title: "Improve latch durability", priority: "High", requesting_department: "Engineering", plant: "Plant 1",
      target_implementation_date: "2026-10-01", chnage_description: "Improve latch", reason_for_change: "Durability",
      select_pxfp: "Finance Review", modified: "2026-09-15 15:00:00", cost_impact: 1, quality_impact: 1,
      approval_requirements: [{ name: "finance-task", approval_role: "Finance Manager", status: "Pending", required: 1 }] };
    businessCase = { ...emptyECRBusinessCasePayload(), name: "BC-100010", business_case_id: "BC-100010", ecr_reference: ecr.name,
      status: "Finance Review", finance_status: "Pending", procurement_status: "Pending", quality_status: "Pending",
      current_cost: 100, proposed_cost: 80, implementation_cost: 1000, one_time_cost: 300, recurring_cost: 25, annual_volume: 200,
      expected_annual_savings: 4000, roi: 300, payback_period: 3, budget_impact: "Fits the approved tooling budget",
      financial_risk: "Volume may decline", business_risk: "Supply continuity", why_required: "Reduce machining cost",
      problem_statement: "High recurring scrap", expected_benefits: "Lower piece cost", created_by: "engineer@example.com",
      creation: "2026-09-15", modified: "2026-09-15" };
    harness.post.mockResolvedValue(nextAggregate());
  });

  it("shows Finance decisions with saved financial facts and read-only justification", () => {
    const view = renderPanel();
    expect(button(view.tree, "Approve Business Case").props.disabled).toBe(false);
    expect(button(view.tree, "Send Back").props.disabled).toBe(true);
    expect(button(view.tree, "Reject").props.disabled).toBe(true);
    for (const label of ["Current unit cost", "Proposed unit cost", "Implementation cost", "Other one-time cost", "Recurring cost", "Annual volume", "Annual savings", "ROI", "Payback period", "Budget impact", "Financial risk"]) expect(view.html).toContain(label);
    for (const value of ["4,000", "300%", "3 months", businessCase.budget_impact, businessCase.financial_risk, businessCase.problem_statement]) expect(view.html).toContain(value);
    expect(view.html).toContain('/ecr/ECR-2026-100010/business-case');
    expect(elements(view.tree).filter((element) => element.type === "input")).toHaveLength(0);
    expect(elements(view.tree).filter((element) => element.type === "textarea")).toHaveLength(1);
  });

  it.each(["engineer", "engineering", "procurement", "procurement_team", "quality", "program_manager", "admin", "Finance Manager", undefined])("does not expose Finance decisions to role %s", (role) => {
    expect(renderPanel({ role }).html).toBe("");
  });

  it.each(["approve", "send_back", "reject"] as const)("routes %s through the dedicated endpoint with revision and reviewer comment", async (action) => {
    enterComment("  Financial review evidence  ");
    const view = renderPanel();
    const label = action === "approve" ? "Approve Business Case" : action === "send_back" ? "Send Back" : "Reject";
    expect(button(view.tree, label).props.disabled).toBe(false);
    button(view.tree, label).props.onClick!();
    await harness.request;
    expect(harness.post).toHaveBeenCalledExactlyOnceWith("/api/ecr-business-case", {
      ecr_name: ecr.name, expected_modified: ecr.modified, action, role: "finance", comment: "Financial review evidence",
    }, { retry: false });
    expect(harness.genericWorkflow).not.toHaveBeenCalled();
    const payload = harness.post.mock.calls[0][1];
    expect(payload).not.toHaveProperty("payload");
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("finance_status");
  });

  it.each(["send_back", "reject"] as const)("requires a comment for %s even if the mutation is invoked directly", async (action) => {
    enterComment("   "); renderPanel();
    await expect(Promise.resolve().then(() => harness.mutations[0].mutationFn(action))).rejects.toThrow("A review comment is required");
    expect(harness.post).not.toHaveBeenCalled();
  });

  it("allows Finance approval without an optional comment", async () => {
    const view = renderPanel(); button(view.tree, "Approve Business Case").props.onClick!(); await harness.request;
    expect(harness.post.mock.calls[0][1]).toMatchObject({ action: "approve", comment: "", role: "finance" });
  });

  it.each(["busy", "disabled", "stale"])("disables every decision while %s", async (mode) => {
    enterComment("Reviewed");
    if (mode === "busy") harness.pending = true;
    if (mode === "stale") ecr = { ...ecr, modified: "2026-09-15 16:00:00" };
    const view = renderPanel({ disabled: mode === "disabled" });
    for (const label of ["Approve Business Case", "Send Back", "Reject"]) expect(button(view.tree, label).props.disabled).toBe(true);
    if (mode === "stale" || mode === "disabled") await expect(Promise.resolve().then(() => harness.mutations[0].mutationFn("approve"))).rejects.toThrow("Reload the current Business Case");
    expect(harness.post).not.toHaveBeenCalled();
  });

  it("retains the comment and saved financial context after an API error", async () => {
    const before = structuredClone(businessCase);
    harness.post.mockRejectedValueOnce(new Error("The ECR has changed. Reload before reviewing."));
    enterComment("Need revised forecast");
    button(renderPanel().tree, "Send Back").props.onClick!(); await harness.request;
    const failed = renderPanel();
    expect(failed.html).toContain("The ECR has changed. Reload before reviewing.");
    expect(failed.html).toContain("Need revised forecast");
    expect(failed.html).toContain(businessCase.budget_impact);
    expect(failed.html).toContain(businessCase.financial_risk);
    expect(businessCase).toEqual(before);
    expect(harness.qc.setQueryData).not.toHaveBeenCalled();
  });

  it("reloads a stale review before approving the new saved revision", async () => {
    enterComment("Checked the saved forecast");
    ecr = { ...ecr, modified: "2026-09-15 16:00:00" };
    harness.get.mockResolvedValueOnce({ ecr, businessCase });
    const stale = renderPanel();
    expect(button(stale.tree, "Approve Business Case").props.disabled).toBe(true);
    button(stale.tree, "Reload saved Business Case").props.onClick!(); await harness.request;
    expect(harness.get).toHaveBeenCalledExactlyOnceWith(`/api/ecr-business-case?ecr=${ecr.name}`);
    const refreshed = renderPanel();
    expect(button(refreshed.tree, "Approve Business Case").props.disabled).toBe(false);
    expect(refreshed.html).toContain("Checked the saved forecast");
    button(refreshed.tree, "Approve Business Case").props.onClick!(); await harness.request;
    expect(harness.post.mock.calls[0][1]).toMatchObject({ expected_modified: "2026-09-15 16:00:00", action: "approve" });
  });

  it("caches the returned next-stage document and refreshes counters, tasks and history", async () => {
    const result = nextAggregate(); const onSuccess = vi.fn(); harness.post.mockResolvedValueOnce(result);
    const view = renderPanel({ onSuccess }); button(view.tree, "Approve Business Case").props.onClick!(); await harness.request;
    for (const identifier of [ecr.name, ecr.ecr_number!]) {
      expect(harness.qc.setQueryData).toHaveBeenCalledWith(["ecr", identifier], result.ecr);
      expect(harness.qc.setQueryData).toHaveBeenCalledWith(["ecr-business-case", identifier], result);
      expect(harness.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["ecr-comments", identifier] });
    }
    for (const key of ["ecr-list", "ecr-dashboard", "ecr-urgent-dashboard-list", "ecr-badge-counts", "ecr-notifications"]) expect(harness.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: [key] });
    expect(onSuccess).toHaveBeenCalledWith(result);
    expect(renderPanel({ ecr: result.ecr, businessCase: result.businessCase }).html).toBe("");
  });
});
