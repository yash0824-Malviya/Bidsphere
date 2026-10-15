import { describe, expect, it, vi } from "vitest";
import { applyEcrBusinessCaseActionCore, fetchEcrBusinessCaseCore, type EcrBusinessCaseInput } from "./ecrBusinessCaseCore";
import { applyEcrWorkflowActionCore, EcrWorkflowError, type EcrWorkflowDocument, type EcrWorkflowDependencies, type InternalEcrPrincipal } from "./ecrWorkflowCore";
import { getEcrWorkflowTransition } from "./ecrWorkflowPolicy";

function principal(role: InternalEcrPrincipal["role"] = "engineer"): InternalEcrPrincipal {
  return { typ: "internal", role, email: `${role}@test.com`, sub: `${role}@test.com`, iat: 1, exp: 9999999999 };
}
const payload = {
  why_required: "Reduce defects", problem_statement: "Latch failures", expected_benefits: "Improve durability",
  budget_impact: "Approved budget", business_risk: "Low", financial_risk: "Low", supplier_risk: "Low", quality_risk: "Low",
  current_cost: 10, proposed_cost: 6, implementation_cost: 1000, annual_volume: 1000,
};
function memory(extra: Partial<EcrWorkflowDocument> = {}) {
  let stored: EcrWorkflowDocument = {
    name: "ECR-1", ecr_number: "ECR-1001", modified: "1", docstatus: 0,
    ecr_workflow_version: "extended_v1", ecr_owner: "engineer@test.com", owner: "engineer@test.com",
    select_pxfp: "Technical Approved", status: "Technical Approved", cost_impact: 1, quality_impact: 1,
    supplier_response_required: "No", procurement_reference_type: "None",
    approval_requirements: [{ name: "TASK-1", approval_role: "Engineer", required: 1, status: "Pending" }], ...extra,
  };
  const deps: EcrWorkflowDependencies = {
    loadEcr: vi.fn(async () => structuredClone(stored)), loadProcurementDocument: vi.fn(),
    commitWorkflowDocument: vi.fn(async (doc) => {
      if (doc.modified !== stored.modified) throw new EcrWorkflowError("Concurrent update", 409, "conflict");
      for (const [index, row] of (doc.approval_requirements ?? []).entries()) {
        if (!["Pending", "Approved", "Rejected", "Sent Back"].includes(String(row.status))) {
          throw new Error(`Row #${index + 1}: Status cannot be '${row.status}'. It should be one of 'Pending', 'Approved', 'Rejected', 'Sent Back'.`);
        }
      }
      const names = (doc.approval_requirements ?? []).map((row) => row.name).filter(Boolean);
      if (new Set(names).size !== names.length) throw new Error("Duplicate child row identity");
      stored = { ...structuredClone(doc), modified: String(Number(stored.modified) + 1) };
      stored.approval_requirements = (stored.approval_requirements ?? []).map((row, i) => ({ ...row, name: row.name ?? `TASK-${stored.modified}-${i}` }));
      return structuredClone(stored);
    }),
    addTimelineComment: vi.fn(async () => undefined), now: () => "2026-09-15 10:00:00",
  };
  return {
    deps, read: () => structuredClone(stored),
    act: (action: string, role: InternalEcrPrincipal["role"] = "engineer", extra: Partial<EcrBusinessCaseInput> = {}) => applyEcrBusinessCaseActionCore({ ecr_name: stored.name, action, principal: principal(role), expected_modified: stored.modified, ...extra }, deps),
    workflow: (action: string, role: InternalEcrPrincipal["role"], extra: Record<string, unknown> = {}) => applyEcrWorkflowActionCore({ name: stored.name, action, principal: principal(role), expected_modified: stored.modified, ...extra }, deps),
  };
}
async function approveBusinessCase(m: ReturnType<typeof memory>) {
  await m.act("submit", "engineer", { payload });
  if (m.read().cost_impact === 1) await m.act("approve", "finance");
  await m.act("approve", "procurement");
  if (m.read().quality_impact === 1) await m.act("approve", "quality");
}
async function finalApprove(m: ReturnType<typeof memory>) {
  await approveBusinessCase(m);
  await m.workflow("Start Final Review", "program_manager");
  await m.workflow("Approve ECR", "program_manager", { reviewFields: { "Final Decision Rationale": "Safe and beneficial" } });
}

describe("ECR Business Case atomic workflow", () => {
  it("saves deterministic linkage, derives financials, and preserves the preparation task", async () => {
    const m = memory();
    const saved = await m.act("save", "engineer", { payload });
    expect(saved.businessCase).toMatchObject({ name: "BC-ECR-1001", ecr_reference: "ECR-1", status: "Draft", expected_annual_savings: 4000, roi: 300, payback_period: 3 });
    expect(saved.ecr.approval_requirements).toHaveLength(1);
    expect(saved.ecr.approval_requirements?.[0].status).toBe("Pending");
    expect(saved.businessCase?.history).toHaveLength(1);
  });

  it("handles zero investment and zero or negative savings without infinity", async () => {
    const m = memory();
    const saved = await m.act("save", "engineer", { payload: { ...payload, current_cost: 0, proposed_cost: 6, implementation_cost: 0 } });
    expect(saved.businessCase).toMatchObject({ expected_annual_savings: -6000, roi: null, payback_period: null });
  });

  it.each([NaN, Infinity, -1, "10"])("rejects invalid numeric input %s", async (current_cost) => {
    const m = memory();
    await expect(m.act("save", "engineer", { payload: { ...payload, current_cost } })).rejects.toMatchObject({ status: 422 });
    expect(m.deps.commitWorkflowDocument).not.toHaveBeenCalled();
  });

  it("rejects browser-written approvals and calculated fields", async () => {
    const m = memory();
    for (const field of ["status", "finance_status", "roi", "history", "ecr_reference"]) {
      await expect(m.act("save", "engineer", { payload: { [field]: "forged" } })).rejects.toMatchObject({ status: 422 });
    }
  });

  it("requires owner engineering access and blocks supplier reads", async () => {
    const m = memory();
    await expect(m.act("save", "engineer", { principal: { ...principal(), sub: "other@test.com", email: "other@test.com" } })).rejects.toMatchObject({ status: 403 });
    await expect(m.act("save", "admin")).rejects.toMatchObject({ status: 403 });
    await expect(fetchEcrBusinessCaseCore({ ecr_name: "ECR-1", principal: { typ: "supplier" } as InternalEcrPrincipal }, m.deps)).rejects.toMatchObject({ status: 403 });
    await expect(fetchEcrBusinessCaseCore({ ecr_name: "ECR-1", principal: principal("finance") }, m.deps)).resolves.toMatchObject({ businessCase: null });
  });

  it("requires technical approval and complete content before submission", async () => {
    const m = memory();
    await expect(m.act("submit", "engineer", { payload: {} })).rejects.toMatchObject({ status: 422, fieldErrors: { why_required: expect.any(String) } });
    await expect(memory({ select_pxfp: "Draft" }).act("save", "engineer", { payload })).rejects.toMatchObject({ status: 409 });
  });

  it.each([[0, 0], [0, 1], [1, 0], [1, 1]])("submits with valid approval rows and conditional review states cost=%s quality=%s", async (cost_impact, quality_impact) => {
    const technicalApproval = { name: "TECH-APPROVED", approval_role: "Engineering Manager", required: 1, status: "Approved", comments: "Technical assessment accepted" };
    const m = memory({
      cost_impact, quality_impact,
      approval_requirements: [technicalApproval, { name: "BC-PREP", approval_role: "Engineer", required: 1, status: "Pending" }],
    });
    await m.act("save", "engineer", { payload });
    const submitted = await m.act("submit");
    expect(submitted.businessCase).toMatchObject({
      finance_status: cost_impact ? "Pending" : "Not Required",
      procurement_status: "Pending",
      quality_status: quality_impact ? "Pending" : "Not Required",
    });
    expect(submitted.ecr.select_pxfp).toBe(cost_impact ? "Finance Review" : "Procurement BC Review");
    expect(submitted.ecr.approval_requirements).toEqual([
      technicalApproval,
      expect.objectContaining({ approval_role: cost_impact ? "Finance Manager" : "Procurement Manager", status: "Pending" }),
    ]);
    expect(submitted.businessCase?.history).toEqual([
      expect.objectContaining({ action: "save", actor: "engineer@test.com", to_status: "Draft" }),
      expect.objectContaining({ action: "submit", actor: "engineer@test.com", from_status: "Draft", to_status: submitted.ecr.select_pxfp }),
    ]);
    expect(m.deps.addTimelineComment).toHaveBeenLastCalledWith("ECR-1", "Business Case submit");
    const refetched = await fetchEcrBusinessCaseCore({ ecr_name: "ECR-1", principal: principal() }, m.deps);
    expect(refetched).toEqual(submitted);
  });

  it.each([
    ["finance", "Finance Manager", "finance_status"],
    ["procurement", "Procurement Manager", "procurement_status"],
    ["quality", "Quality Manager", "quality_status"],
  ] as const)("records each supported review outcome for %s without changing earlier approvals", async (role, approvalRole, statusField) => {
    for (const [action, outcome] of [["approve", "Approved"], ["reject", "Rejected"], ["send_back", "Sent Back"]] as const) {
      const m = memory();
      await m.act("submit", "engineer", { payload });
      if (role !== "finance") await m.act("approve", "finance", { comment: "Finance accepted" });
      if (role === "quality") await m.act("approve", "procurement", { comment: "Procurement accepted" });
      const before = m.read();
      const priorDecisions = before.approval_requirements?.filter((row) => row.status !== "Pending") ?? [];
      expect(before.approval_requirements?.filter((row) => row.status === "Pending")).toEqual([
        expect.objectContaining({ approval_role: approvalRole }),
      ]);
      expect(JSON.parse(before.ecr_business_case!)[statusField]).toBe("Pending");
      const comment = `${role} ${outcome} rationale`;
      const result = await m.act(action, role, { comment });
      expect(result.businessCase?.[statusField]).toBe(outcome);
      expect(result.businessCase).toMatchObject({
        [`${role}_comment`]: comment,
        [`${role}_approved_by`]: `${role}@test.com`,
        [`${role}_approved_date`]: "2026-09-15 10:00:00",
        ...payload, expected_annual_savings: 4000, roi: 300, payback_period: 3,
      });
      expect(result.ecr.approval_requirements).toEqual(expect.arrayContaining([
        ...priorDecisions,
        expect.objectContaining({ approval_role: approvalRole, status: outcome, approver: `${role}@test.com`, comments: expect.stringContaining(comment), approval_date: "2026-09-15 10:00:00" }),
      ]));
      const history = result.businessCase?.history as Array<Record<string, unknown>>;
      expect(history).toHaveLength((JSON.parse(before.ecr_business_case!).history as unknown[]).length + 1);
      expect(history.at(-1)).toMatchObject({ action, role, actor: `${role}@test.com`, comment, from_status: before.select_pxfp, to_status: result.businessCase?.status });
      expect(m.deps.addTimelineComment).toHaveBeenLastCalledWith("ECR-1", `Business Case ${action}\n${comment}`);
      expect(result.businessCase?.status === "Approved").toBe(action === "approve" && role === "quality");
      const pending = result.ecr.approval_requirements?.filter((row) => row.status === "Pending") ?? [];
      if (action === "reject") expect(pending).toHaveLength(0);
      else expect(pending).toEqual([expect.objectContaining({ approval_role: action === "send_back" ? "Engineer" : role === "finance" ? "Procurement Manager" : role === "procurement" ? "Quality Manager" : "Program Manager" })]);
      expect(await fetchEcrBusinessCaseCore({ ecr_name: "ECR-1", principal: principal(role) }, m.deps)).toEqual(result);
    }
  });

  it.each(["admin", "engineer", "engineering", "operations", "quality", "program_manager", "procurement", "procurement_team"] as const)("blocks every Finance Review decision for the %s role", async (role) => {
    const m = memory();
    await m.act("submit", "engineer", { payload });
    const before = m.read();
    for (const action of ["approve", "send_back", "reject"]) {
      await expect(m.act(action, role, { role: "finance", comment: "Attempted finance review" })).rejects.toMatchObject({ status: 403 });
      await expect(m.act(action, role, { comment: "Attempted finance review" })).rejects.toMatchObject({ status: 403 });
    }
    expect(m.read()).toEqual(before);
    expect(m.deps.commitWorkflowDocument).toHaveBeenCalledTimes(1);
    expect(m.deps.addTimelineComment).toHaveBeenCalledTimes(1);
  });

  it.each(["budget_impact", "financial_risk"])("requires %s before the owner can send financial data for Finance review", async (field) => {
    const m = memory();
    await expect(m.act("submit", "engineer", { payload: { ...payload, [field]: "  " } })).rejects.toMatchObject({ status: 422, fieldErrors: { [field]: expect.any(String) } });
    expect(m.deps.commitWorkflowDocument).not.toHaveBeenCalled();
  });

  it.each(["current_cost", "proposed_cost", "implementation_cost", "one_time_cost", "recurring_cost", "annual_volume"])("validates %s at submission while preserving legitimate zero values", async (field) => {
    const m = memory();
    for (const value of [-1, Infinity, NaN, "10"]) {
      await expect(m.act("submit", "engineer", { payload: { ...payload, [field]: value } })).rejects.toMatchObject({ status: 422 });
    }
    expect(m.deps.commitWorkflowDocument).not.toHaveBeenCalled();
    const submitted = await m.act("submit", "engineer", { payload: { ...payload, [field]: 0 } });
    expect(submitted.businessCase?.[field]).toBe(0);
    expect(submitted.businessCase?.finance_status).toBe("Pending");
  });

  it.each(["approve", "send_back", "reject"])("rejects %s with an absent or stale Finance Review revision without writing", async (action) => {
    const m = memory();
    await m.act("submit", "engineer", { payload });
    const before = m.read();
    for (const expected_modified of [undefined, "", "old"]) {
      await expect(m.act(action, "finance", { expected_modified, comment: "Finance rationale" })).rejects.toMatchObject({ status: 409 });
    }
    expect(m.read()).toEqual(before);
    expect(m.deps.commitWorkflowDocument).toHaveBeenCalledTimes(1);
    expect(m.deps.addTimelineComment).toHaveBeenCalledTimes(1);
  });

  it("rejects Finance decisions when its required current task is missing, duplicated, or assigned to another role", async () => {
    const submitted = memory();
    await submitted.act("submit", "engineer", { payload });
    const financeTask = { approval_role: "Finance Manager", status: "Pending", required: 1 };
    for (const rows of [
      [],
      [{ ...financeTask, approval_role: "Procurement Manager" }],
      [financeTask, { ...financeTask }],
      [{ ...financeTask, required: 0 }],
      [{ ...financeTask, status: "Approved" }],
    ]) {
      const m = memory({ ...submitted.read(), approval_requirements: rows });
      for (const action of ["approve", "send_back", "reject"]) {
        await expect(m.act(action, "finance", { comment: "Finance rationale" })).rejects.toMatchObject({ status: 409 });
      }
      expect(m.deps.commitWorkflowDocument).not.toHaveBeenCalled();
      expect(m.deps.addTimelineComment).not.toHaveBeenCalled();
    }
  });

  it.each(["send_back", "reject"])("requires a meaningful Finance comment for %s and preserves the pending task on validation failure", async (action) => {
    const m = memory();
    await m.act("submit", "engineer", { payload });
    const before = m.read();
    await expect(m.act(action, "finance", { comment: "  \n " })).rejects.toMatchObject({ status: 422 });
    expect(m.read()).toEqual(before);
    expect(m.deps.commitWorkflowDocument).toHaveBeenCalledTimes(1);
  });

  it.each(["current_cost", "proposed_cost", "implementation_cost", "one_time_cost", "recurring_cost", "annual_volume"])("blocks Finance approval when stored %s is missing or invalid", async (field) => {
    const original = memory();
    await original.act("submit", "engineer", { payload });
    const submitted = original.read();
    for (const value of [undefined, null, -1, "10", 1e12 + 1]) {
      const corrupt = { ...JSON.parse(submitted.ecr_business_case!), [field]: value };
      const m = memory({ ...submitted, ecr_business_case: JSON.stringify(corrupt) });
      await expect(m.act("approve", "finance", { comment: "Finance review" })).rejects.toMatchObject({ status: 422 });
      expect(m.deps.commitWorkflowDocument).not.toHaveBeenCalled();
      expect(m.deps.addTimelineComment).not.toHaveBeenCalled();
      expect(m.read().approval_requirements?.filter((row) => row.status === "Pending")).toEqual([
        expect.objectContaining({ approval_role: "Finance Manager" }),
      ]);
    }
  });

  it.each(["budget_impact", "financial_risk"])("blocks Finance approval when stored %s is absent or malformed", async (field) => {
    const original = memory();
    await original.act("submit", "engineer", { payload });
    const submitted = original.read();
    for (const value of [undefined, null, "", "  \n ", 123, "x".repeat(4001)]) {
      const corrupt = { ...JSON.parse(submitted.ecr_business_case!), [field]: value };
      const m = memory({ ...submitted, ecr_business_case: JSON.stringify(corrupt) });
      await expect(m.act("approve", "finance", { comment: "Finance review" })).rejects.toMatchObject({ status: 422 });
      expect(m.deps.commitWorkflowDocument).not.toHaveBeenCalled();
      expect(m.deps.addTimelineComment).not.toHaveBeenCalled();
    }
  });

  it.each(["send_back", "reject"])("allows Finance to %s malformed financial content so it can be corrected or declined", async (action) => {
    const original = memory();
    await original.act("submit", "engineer", { payload });
    const submitted = original.read();
    const corrupt = { ...JSON.parse(submitted.ecr_business_case!), current_cost: -1, proposed_cost: null, budget_impact: "", financial_risk: null };
    const m = memory({ ...submitted, ecr_business_case: JSON.stringify(corrupt) });
    const result = await m.act(action, "finance", { comment: "Financial information is incomplete" });
    expect(result.businessCase).toMatchObject({ current_cost: -1, proposed_cost: null, budget_impact: "", financial_risk: null, finance_status: action === "send_back" ? "Sent Back" : "Rejected" });
    expect(result.ecr.select_pxfp).toBe(action === "send_back" ? "Technical Approved" : "Rejected");
  });

  it("allows Finance approval with zero financial amounts and inapplicable ratio values", async () => {
    const m = memory();
    await m.act("submit", "engineer", { payload: { ...payload, current_cost: 0, proposed_cost: 0, implementation_cost: 0, one_time_cost: 0, recurring_cost: 0, annual_volume: 0 } });
    const approved = await m.act("approve", "finance", { comment: "No financial impact beyond the approved scope" });
    expect(approved.businessCase).toMatchObject({ finance_status: "Approved", expected_annual_savings: 0, roi: null, payback_period: null });
    expect(approved.ecr.select_pxfp).toBe("Procurement BC Review");
  });

  it("runs finance, mandatory procurement, quality, then final review with one active task", async () => {
    const m = memory();
    await m.act("submit", "engineer", { payload });
    await expect(m.act("approve", "procurement")).rejects.toMatchObject({ status: 403 });
    await m.act("approve", "finance", { comment: "Budget verified" });
    await m.act("approve", "procurement", { rfq_required: "Yes", rfq_decision_reason: "Compete sourcing" });
    expect(m.read().rfq_required).toBeUndefined();
    const approved = await m.act("approve", "quality");
    expect(approved.businessCase).toMatchObject({ status: "Approved", finance_status: "Approved", procurement_status: "Approved", quality_status: "Approved", rfq_required: "Yes" });
    expect(approved.ecr.select_pxfp).toBe("Business Case Approved");
    expect(approved.ecr.approval_requirements?.filter((row) => row.status === "Pending")).toEqual([expect.objectContaining({ approval_role: "Program Manager" })]);
    await m.workflow("Start Final Review", "program_manager");
    expect(m.read().approval_requirements?.filter((row) => row.status === "Pending")).toHaveLength(1);
    await m.workflow("Approve ECR", "program_manager", { reviewFields: { "Final Decision Rationale": "Accept" } });
    expect(m.read().select_pxfp).toBe("ECR Approved");
  });

  it.each([[0, 0], [0, 1], [1, 0]])("skips only reviews disabled by impact flags cost=%s quality=%s", async (cost_impact, quality_impact) => {
    const m = memory({ cost_impact, quality_impact });
    await approveBusinessCase(m);
    const bc = JSON.parse(m.read().ecr_business_case!);
    expect(bc.finance_status).toBe(cost_impact ? "Approved" : "Not Required");
    expect(bc.quality_status).toBe(quality_impact ? "Approved" : "Not Required");
    expect(bc.procurement_status).toBe("Approved");
    expect(m.read().select_pxfp).toBe("Business Case Approved");
  });

  it("preserves entered content and review history on sendback and resets approvals on resubmission", async () => {
    const m = memory();
    await m.act("submit", "engineer", { payload });
    await m.act("approve", "finance");
    await m.act("send_back", "procurement", { comment: "Revise supplier assumptions" });
    const returned = await m.act("save", "engineer", { payload: { budget_impact: "Updated assumptions" } });
    expect(returned.businessCase?.problem_statement).toBe(payload.problem_statement);
    const resubmitted = await m.act("submit");
    expect(resubmitted.businessCase).toMatchObject({ finance_status: "Pending", procurement_status: "Pending" });
    expect(resubmitted.businessCase?.history).toHaveLength(5);
    expect(resubmitted.ecr.approval_requirements).toEqual(expect.arrayContaining([expect.objectContaining({ status: "Sent Back", comments: expect.stringContaining("Revise supplier") })]));
  });

  it("returns final review to editable Business Case and requires all approvals again", async () => {
    const m = memory();
    await approveBusinessCase(m);
    await m.workflow("Start Final Review", "program_manager");
    await m.workflow("Send Back ECR", "program_manager", { comment: "Revise risk assessment" });
    expect(JSON.parse(m.read().ecr_business_case!).status).toBe("Sent Back");
    await m.act("submit");
    expect(m.read().select_pxfp).toBe("Finance Review");
  });

  it("requires rejection reasons, preserves rejected content, and blocks subsequent edits", async () => {
    const m = memory();
    await m.act("submit", "engineer", { payload });
    await expect(m.act("reject", "finance")).rejects.toMatchObject({ status: 422 });
    const rejected = await m.act("reject", "finance", { comment: "Budget unavailable" });
    expect(rejected.businessCase).toMatchObject({ status: "Rejected", problem_statement: payload.problem_statement });
    expect(rejected.ecr.approval_requirements?.some((row) => row.status === "Pending")).toBe(false);
    await expect(m.act("save")).rejects.toMatchObject({ status: 409 });
  });

  it("rejects stale saves, conflicting concurrent approvals, spoofed review role and reviewer edits", async () => {
    const m = memory();
    await expect(m.act("save", "engineer", { expected_modified: "old" })).rejects.toMatchObject({ status: 409 });
    await m.act("submit", "engineer", { payload });
    await expect(m.act("approve", "finance", { role: "procurement" })).rejects.toMatchObject({ status: 403 });
    await expect(m.act("approve", "finance", { payload })).rejects.toMatchObject({ status: 403 });
    const outcomes = await Promise.allSettled([m.act("approve", "finance"), m.act("approve", "finance")]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("blocks unrelated attachments and accepts only parent-linked uploads", async () => {
    const m = memory({ supporting_documents: "/private/files/ecr.pdf" });
    await expect(m.act("save", "engineer", { payload: { supporting_documents: [{ file_name: "secret", file_url: "/private/files/other.pdf" }] } })).rejects.toMatchObject({ status: 422 });
    await expect(m.act("save", "engineer", { payload: { supporting_documents: [{ file_name: "ecr.pdf", file_url: "/private/files/ecr.pdf" }] } })).resolves.toMatchObject({ businessCase: { supporting_documents: [{ file_name: "ecr.pdf", file_url: "/private/files/ecr.pdf" }] } });
  });

  it("fails closed when ERP drops the Business Case instead of atomically persisting it", async () => {
    const m = memory();
    m.deps.commitWorkflowDocument = vi.fn(async (ecr) => ({ ...ecr, ecr_business_case: undefined }));
    await expect(m.act("save", "engineer", { payload })).rejects.toMatchObject({ status: 409 });
  });

  it("never changes legacy workflow behavior and prevents generic Business Case approval bypasses", async () => {
    expect(getEcrWorkflowTransition("Engineering Review", "Approve")?.nextStatus).toBe("Procurement Review");
    expect(getEcrWorkflowTransition("Engineering Review", "Approve", "extended_v1")?.nextStatus).toBe("Technical Approved");
    await expect(memory({ ecr_workflow_version: undefined }).act("save")).rejects.toMatchObject({ status: 409 });
    const m = memory();
    await expect(m.workflow("Submit Business Case", "engineer")).rejects.toMatchObject({ status: 409 });
    await m.act("submit", "engineer", { payload });
    await expect(m.workflow("Approve Finance", "finance")).rejects.toMatchObject({ status: 409 });
  });

  it("blocks final approval without approved Business Case and direct RFQ shortcuts", async () => {
    const m = memory({ select_pxfp: "Final ECR Approval", approval_requirements: [{ approval_role: "Program Manager", required: 1, status: "Pending" }] });
    await expect(m.workflow("Approve ECR", "program_manager", { reviewFields: { "Final Decision Rationale": "forged" } })).rejects.toMatchObject({ status: 409 });
    await expect(memory({ select_pxfp: "ECR Approved" }).workflow("Create RFQ from ECR", "procurement")).rejects.toMatchObject({ status: 409 });
  });

  it("records no RFQ with reason and closes without any RFQ task or procurement write", async () => {
    const m = memory();
    await finalApprove(m);
    await expect(m.workflow("Record Procurement Decision", "procurement", { reviewFields: { "RFQ Required": "No" } })).rejects.toMatchObject({ status: 400 });
    await m.workflow("Record Procurement Decision", "procurement", { reviewFields: { "RFQ Required": "No", "Decision Reason": "Internal process change" } });
    expect(m.read()).toMatchObject({ select_pxfp: "Closed", docstatus: 1, rfq_required: "No", rfq_decision_reason: "Internal process change" });
    expect(m.read().approval_requirements?.some((row) => row.status === "Pending")).toBe(false);
    expect(m.deps.loadProcurementDocument).not.toHaveBeenCalled();
  });

  it("requires sourcing prerequisites for Yes and offers a full re-review correction path", async () => {
    const m = memory();
    await finalApprove(m);
    await expect(m.workflow("Record Procurement Decision", "procurement", { reviewFields: { "RFQ Required": "Yes", "Decision Reason": "Need bids" } })).rejects.toMatchObject({ status: 422 });
    await m.workflow("Request Sourcing Revision", "procurement", { comment: "Add supplier and set supplier required" });
    expect(m.read()).toMatchObject({ select_pxfp: "Draft", rfq_required: "" });
    expect(JSON.parse(m.read().ecr_business_case!).status).toBe("Sent Back");
    await m.workflow("Submit ECR", "engineer");
    expect(m.read().select_pxfp).toBe("Engineering Review");
  });
});
