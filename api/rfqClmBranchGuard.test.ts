import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertRfqClmBranchRequest, type RfqClmBranchDependencies } from "./rfqClmBranchGuard";
import type { AccessPrincipal } from "./rbacAuth";

const principal: AccessPrincipal = { typ: "internal", sub: "buyer@test.example", email: "buyer@test.example", role: "procurement", iat: 0, exp: 99999999999 };
const decision = { decision: "Yes", request: "CR-1", by: "buyer@test.example", at: "2026-09-18 10:00:00" };
let current: Record<string, unknown>;
let deps: RfqClmBranchDependencies;
const check = (apiPath: string, body: unknown, method = "POST", actor = principal) => assertRfqClmBranchRequest({ apiPath, method, body, principal: actor }, deps);
beforeEach(() => {
  current = { name: "RFQ-1", contract_required: "Yes", custom_selected_supplier: "SUP-1", custom_approval_data: JSON.stringify({ rfq: "RFQ-1", selected_supplier: "SUP-1", contract_decision: decision }) };
  deps = { loadDocument: vi.fn(async () => structuredClone(current)), assertClmReady: vi.fn(async () => undefined) };
});

describe("RFQ contract branch generic mutation guard", () => {
  it.each([
    ["resource/Request%20for%20Quotation/RFQ-1", { contract_required: "No" }, "PUT"],
    ["method/frappe.client.save", { doc: { doctype: "Request for Quotation", name: "RFQ-1", contract_required: "No" } }, "POST"],
    ["method/frappe.client.save", { doc: JSON.stringify({ doctype: "Request for Quotation", name: "RFQ-1", contract_required: "No" }) }, "POST"],
    ["method/frappe.client.set_value", { doctype: "Request for Quotation", name: "RFQ-1", fieldname: "contract_required", value: "No" }, "POST"],
    ["method/frappe.client.set_value", { dt: "Request for Quotation", name: "RFQ-1", fieldname: JSON.stringify({ contract_required: "No" }) }, "POST"],
    ["method/frappe.client.set_value", { doctype: "Request for Quotation", name: "RFQ-1", fieldname: '["contract_required"]', value: '["No"]' }, "POST"],
  ])("blocks changing awarded RFQ requirement through %s", async (path, body, method) => {
    await expect(check(path as string, body, method as string)).rejects.toThrow(/contract decision action/);
    expect(deps.assertClmReady).not.toHaveBeenCalled();
  });

  it("guards mutation RPCs encoded in GET query arguments", async () => {
    await expect(assertRfqClmBranchRequest({ apiPath: "method/frappe.client.set_value", method: "GET", principal, query: { doctype: "Request for Quotation", name: "RFQ-1", fieldname: "contract_required", value: "No" } }, deps)).rejects.toThrow(/contract decision action/);
  });

  it.each([undefined, null, "", {}, { ...decision, decision: "No" }, { ...decision, request: "CR-OTHER" }])("prevents clearing or changing the saved decision (%j)", async value => {
    const data = value === undefined ? { rfq: "RFQ-1" } : { rfq: "RFQ-1", contract_decision: value };
    await expect(check("resource/Request for Quotation/RFQ-1", { custom_approval_data: JSON.stringify(data) }, "PUT")).rejects.toThrow(/cannot be changed or removed/);
  });

  it("prevents injecting a decision on an existing pending RFQ", async () => {
    current.custom_approval_data = JSON.stringify({ selected_supplier: "SUP-1" });
    await expect(check("method/frappe.client.save", { doc: { doctype: "Request for Quotation", name: "RFQ-1", custom_approval_data: { contract_decision: decision } } })).rejects.toThrow(/cannot be changed or removed/);
  });

  it("preserves ordinary approval metadata updates with the exact saved decision", async () => {
    await check("resource/Request for Quotation/RFQ-1", { contract_required: "Yes", custom_approval_data: { rfq: "RFQ-1", selected_supplier: "SUP-1", finance_status: "Approved", contract_decision: { at: decision.at, by: decision.by, request: decision.request, decision: decision.decision } } }, "PUT");
    expect(deps.assertClmReady).not.toHaveBeenCalled();
  });

  it("does not touch partial RFQ updates unrelated to the contract branch", async () => {
    await check("resource/Request for Quotation/RFQ-1", { custom_legal_status: "Approved", custom_workflow_step: "Pending Finance Review" }, "PUT");
    expect(deps.loadDocument).not.toHaveBeenCalled();
    expect(deps.assertClmReady).not.toHaveBeenCalled();
  });

  it.each(["Yes", "No"])("preserves the creation flag %s and pre-award edits", async contract_required => {
    await check("resource/Request for Quotation", { contract_required });
    await check("method/frappe.client.insert", { doc: JSON.stringify({ doctype: "Request for Quotation", contract_required }) });
    current = { name: "RFQ-1", contract_required: "No", custom_approval_data: "" };
    await check("resource/Request for Quotation/RFQ-1", { contract_required }, "PUT");
    expect(deps.assertClmReady).not.toHaveBeenCalled();
  });

  it("allows a saved choice on a Draft RFQ whose old pre-award Request is invalidated", async () => {
    current = { name: "RFQ-1", docstatus: 0, contract_required: "No", custom_approval_data: JSON.stringify({ clm_initial_request: { version: 1, phase: "awaiting_award", request: "OLD", status: "Invalidated" } }) };
    await check("resource/Request for Quotation/RFQ-1", { contract_required: "Yes" }, "PUT");
    expect(deps.assertClmReady).not.toHaveBeenCalled();
    expect(JSON.parse(String(current.custom_approval_data)).clm_initial_request.status).toBe("Invalidated");
  });

  it.each([
    { custom_workflow_step: "Completed" }, { custom_workflow_step: "PO Created" }, { status: "Completed" },
    { workflow_state: "PO Created" }, { custom_approval_data: { contract_decision: decision, workflow_step: "Completed" } },
  ])("checks authoritative CLM readiness before completion %j", async body => {
    deps.assertClmReady = vi.fn(async () => { throw new Error("Contract decision pending or contract not executed"); });
    await expect(check("resource/Request for Quotation/RFQ-1", body, "PUT")).rejects.toThrow(/not executed/);
    expect(deps.assertClmReady).toHaveBeenCalledExactlyOnceWith("RFQ-1");
  });

  it.each(["No", "Yes"])("allows completion only when the authoritative %s branch is ready", async contract_required => {
    current.contract_required = contract_required;
    await check("resource/Request for Quotation/RFQ-1", { custom_workflow_step: "Completed" }, "PUT");
    expect(deps.assertClmReady).toHaveBeenCalledExactlyOnceWith("RFQ-1");
  });

  it("checks awarded opaque workflow transitions and submission of a completed snapshot", async () => {
    await check("method/frappe.model.workflow.apply_workflow", { doc: { doctype: "Request for Quotation", name: "RFQ-1" }, action: "Complete" });
    await check("method/frappe.client.submit", { doc: { doctype: "Request for Quotation", name: "RFQ-1", status: "Completed" } });
    expect(deps.assertClmReady).toHaveBeenCalledTimes(2);
  });

  it("permits an unchanged historical terminal snapshot only after the core verifies its existing PO and absence of CLM", async () => {
    current = { name: "RFQ-1", contract_required: "No", status: "Completed", custom_workflow_step: "PO Created", custom_approval_data: JSON.stringify({ workflow_step: "PO Created", selected_supplier: "SUP-1" }) };
    await check("method/frappe.client.save", { doc: { ...current, doctype: "Request for Quotation", title: "Updated title" } });
    expect(deps.assertClmReady).toHaveBeenCalledExactlyOnceWith("RFQ-1", { allowHistoricalOrder: true });
    deps.assertClmReady = vi.fn(async () => { throw new Error("Linked CLM is not executed"); });
    await expect(check("method/frappe.client.save", { doc: { ...current, doctype: "Request for Quotation" } })).rejects.toThrow("Linked CLM is not executed");
  });

  it("does not grant a historical exception when newly entering or changing a terminal state", async () => {
    current.status = "Submitted";
    current.custom_workflow_step = "Completed";
    await check("resource/Request for Quotation/RFQ-1", { status: "Completed", custom_workflow_step: "Completed" }, "PUT");
    expect(deps.assertClmReady).toHaveBeenCalledExactlyOnceWith("RFQ-1");
    vi.mocked(deps.assertClmReady).mockClear();
    await check("resource/Request for Quotation/RFQ-1", { custom_workflow_step: "PO Created" }, "PUT");
    expect(deps.assertClmReady).toHaveBeenCalledExactlyOnceWith("RFQ-1");
  });

  it.each(["procurement", "procurement_team", "admin"] as const)("allows existing generic RFQ permission for %s without a decision override", async role => {
    await check("resource/Request for Quotation/RFQ-1", { title: "An RFQ" }, "PUT", { ...principal, role });
    await expect(check("resource/Request for Quotation/RFQ-1", { contract_required: "No" }, "PUT", { ...principal, role })).rejects.toThrow(/contract decision action/);
  });

  it.each(["finance", "finance_executive", "legal", "engineer", "engineering", "program_manager", "quality", "department", "warehouse", "manufacturing", "executive", "operations"] as const)("denies generic RFQ writes by %s", async role => {
    await expect(check("resource/Request for Quotation/RFQ-1", { title: "An RFQ" }, "PUT", { ...principal, role })).rejects.toThrow(/Access denied/);
    expect(deps.loadDocument).not.toHaveBeenCalled();
  });

  it("denies supplier writes without looking up the RFQ", async () => {
    const supplier: AccessPrincipal = { typ: "supplier", sub: "supplier", supplier: "SUP-1", iat: 0, exp: 99999999999 };
    await expect(check("resource/Request for Quotation/RFQ-1", { contract_required: "No" }, "PUT", supplier)).rejects.toThrow(/authorized procurement/);
    expect(deps.loadDocument).not.toHaveBeenCalled();
  });

  it.each([
    { custom_approval_data: { contract_decision: decision } }, { status: "Completed" },
  ])("cannot create a pre-decided or completed RFQ (%j)", async body => {
    await expect(check("resource/Request for Quotation", body)).rejects.toThrow(/Save the RFQ award/);
  });

  it("rejects opaque wrappers, bulk RFQs and invalid JSON evidence", async () => {
    const doc = { doctype: "Request for Quotation", name: "RFQ-1", contract_required: "No" };
    await expect(check("resource/Request for Quotation/RFQ-1", { data: doc }, "PUT")).rejects.toThrow(/Wrapped/);
    await expect(check("method/frappe.client.save", { docs: [doc, doc] })).rejects.toThrow(/Bulk/);
    await expect(check("resource/Request for Quotation/RFQ-1", { custom_approval_data: "bad JSON" }, "PUT")).rejects.toThrow(/Invalid RFQ approval data/);
  });

  it("leaves reads, cancellation and unrelated workflows unchanged", async () => {
    await check("resource/Request for Quotation/RFQ-1", undefined, "GET");
    await check("method/frappe.client.get", { doctype: "Request for Quotation", name: "RFQ-1" });
    await check("resource/Request for Quotation/RFQ-1", undefined, "DELETE");
    await check("method/frappe.client.cancel", { doc: { doctype: "Request for Quotation", name: "RFQ-1" } });
    await check("method/frappe.client.save", { doc: { doctype: "Business Case", status: "Completed" } });
    expect(deps.loadDocument).not.toHaveBeenCalled();
    expect(deps.assertClmReady).not.toHaveBeenCalled();
  });

  describe.each(["clm_initial_request", "clm_rest_operation"])("server-owned %s", field => {
    const intent = { version: 1, phase: "saving", pending_document: { custom_rfq: "RFQ-1", contract_type: "Other" } };
    const args = (data: unknown) => ({ doctype: "Request for Quotation", name: "RFQ-1", custom_approval_data: data });
    beforeEach(() => { current = { name: "RFQ-1", contract_required: "Yes", custom_approval_data: JSON.stringify({ [field]: intent }) }; });

    it.each([undefined, null, "", {}, { ...intent, phase: "complete" }, { ...intent, pending_document: { custom_rfq: "OTHER" } }])("blocks deletion or change of durable intent: %j", async replacement => {
      const data = replacement === undefined ? { workflow_step: "Supplier Invitation" } : { [field]: replacement };
      await expect(check("resource/Request for Quotation/RFQ-1", { custom_approval_data: data }, "PUT")).rejects.toThrow(/assignment and recovery state cannot be changed or removed/);
    });

    it.each(["resource", "save", "set_value_scalar", "set_value_map", "set_value_array", "query"])("blocks a forged intent through %s", async path => {
      current.custom_approval_data = "{}";
      const data = { [field]: intent };
      const operation = path === "resource" ? () => check("resource/Request for Quotation/RFQ-1", { custom_approval_data: data }, "PUT")
        : path === "save" ? () => check("method/frappe.client.save", { doc: JSON.stringify(args(data)) })
        : path === "query" ? () => assertRfqClmBranchRequest({ apiPath: "method/frappe.client.save", method: "GET", principal, query: { doc: JSON.stringify(args(data)) } }, deps)
        : () => check("method/frappe.client.set_value", { doctype: "Request for Quotation", name: "RFQ-1", ...(path === "set_value_scalar" ? { fieldname: "custom_approval_data", value: JSON.stringify(data) } : path === "set_value_map" ? { fieldname: JSON.stringify({ custom_approval_data: data }) } : { fieldname: '["custom_approval_data"]', value: JSON.stringify([JSON.stringify(data)]) }) });
      await expect(operation()).rejects.toThrow(/assignment and recovery state cannot be changed or removed/);
    });

    it.each(["resource", "save", "insert"])("rejects browser-authored intent on new RFQ %s", async path => {
      const doc = { doctype: "Request for Quotation", contract_required: "Yes", custom_approval_data: { [field]: intent } };
      await expect(path === "resource" ? check("resource/Request for Quotation", doc) : check(`method/frappe.client.${path}`, { doc })).rejects.toThrow(/must be recorded by the secured Contract Request action/);
      expect(deps.loadDocument).not.toHaveBeenCalled();
    });

    it("preserves legitimate metadata edits and exact saved intent despite key order", async () => {
      await check("method/frappe.client.save", { doc: args({ workflow_step: "Supplier Invitation", [field]: { pending_document: { contract_type: "Other", custom_rfq: "RFQ-1" }, phase: "saving", version: 1 } }) });
      await check("resource/Request for Quotation/RFQ-1", { message_for_supplier: "Updated sourcing terms" }, "PUT");
      expect(deps.assertClmReady).not.toHaveBeenCalled();
    });
  });

  it.each([
    { version: 1, phase: "saving", pending_document: { custom_rfq: "RFQ-1" } },
    { version: 1, phase: "complete", request: "CR-1" },
  ])("blocks Yes→No before writing when an initial Request operation exists: %j", async state => {
    current = { name: "RFQ-1", contract_required: "Yes", custom_approval_data: JSON.stringify({ clm_initial_request: state }) };
    for (const [path, body, method] of [
      ["resource/Request for Quotation/RFQ-1", { contract_required: "No" }, "PUT"],
      ["method/frappe.client.save", { doc: { doctype: "Request for Quotation", name: "RFQ-1", contract_required: "No" } }, "POST"],
      ["method/frappe.client.set_value", { doctype: "Request for Quotation", name: "RFQ-1", fieldname: "contract_required", value: "No" }, "POST"],
    ] as const) await expect(check(path, body, method)).rejects.toThrow(/saved Contract Request operation/);
    await check("resource/Request for Quotation/RFQ-1", { contract_required: "Yes" }, "PUT");
    expect(deps.assertClmReady).not.toHaveBeenCalled();
  });
});
