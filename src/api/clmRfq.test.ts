import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("./erpnext", () => ({ apiGet: mocks.get, apiPost: mocks.post, withoutNetworkRetry: () => ({ _disableNetworkRetry: true }) }));
vi.mock("../utils/accessToken", () => ({ readErpProxyAccessToken: () => "staff-token", readSupplierAccessToken: () => "" }));
import { createRfqContractRequest, submitRfqClmRequest, retryInitialRfqClmRequest, decideRfqContractRequirement, getRfqClmSummary } from "./clm";

function routedRequest(created = true) {
  return { created, request: { doctype: "Contract Request", record: { name: "CR-1", custom_rfq: "RFQ-1", request_status: "Draft", custom_clm_data: JSON.stringify({ rfq_source: { rfq: "RFQ-1", award: "AWARD-1" }, rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team" }, approvals: [{ role: "procurement_team", stage: 0, status: "Pending" }] }) } }, summary: { rfq: { name: "RFQ-1" }, request: { name: "CR-1", assigned_role: "procurement_team", current_stage: "Pending Procurement Team" }, decision: "Yes", contract_required: "Yes" } };
}
function successfulResult(operation: string) {
  if (operation === "request") return routedRequest();
  if (operation === "No") return { created: false, summary: { rfq: { name: "RFQ-1" }, decision: "No", contract_required: "No" } };
  return { created: true, request: { record: { name: "CR-1" } }, contract: { doctype: "Contract", record: { name: "CON-1", custom_rfq: "RFQ-1", custom_contract_status: "Pending Legal" }, approvals: [{ role: "legal", stage: 0, status: "Pending" }] }, summary: { rfq: { name: "RFQ-1" }, request: { name: "CR-1" }, contract: { name: "CON-1" }, decision: "Yes", contract_required: "Yes" } };
}
function callOperation(operation: string) {
  const input = { rfq: "RFQ-1", expected_modified: "revision", payload: {} };
  return operation === "request" ? submitRfqClmRequest(input) : operation === "create_contract" ? createRfqContractRequest(input) : decideRfqContractRequirement({ rfq: input.rfq, expected_modified: input.expected_modified, decision: "No" });
}

describe("RFQ to existing CLM client", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
  it("loads authenticated RFQ context without mutating RFQ or creating CLM", async () => {
    const data = { rfq: { name: "RFQ-1", modified: "revision" }, contract_required: "No", can_create: false, status: "Not Required" };
    mocks.get.mockResolvedValue({ data });
    expect(await getRfqClmSummary("RFQ-1")).toEqual(data);
    expect(mocks.get).toHaveBeenCalledWith("/api/clm", { params: { view: "rfq_contract", rfq: "RFQ-1" } });
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("rejects context for another RFQ", async () => {
    mocks.get.mockResolvedValue({ rfq: { name: "RFQ-other" } });
    await expect(getRfqClmSummary("RFQ-1")).rejects.toThrow("incomplete RFQ source");
  });
  it.each(["request", "create_contract", "No"])("reads the preserved HTTP success envelope for %s", async operation => {
    const result = successfulResult(operation); mocks.post.mockResolvedValue({ status: 200, data: { data: result } });
    expect(await callOperation(operation)).toEqual(result);
    expect(mocks.post.mock.calls[0][2]).toEqual({ _disableNetworkRetry: true, _preserveResponse: true });
  });
  it.each(["request", "create_contract", "No"].flatMap(operation => ["success", "error"].flatMap(marker => ["outer", "inner"].map(level => ({ operation, marker, level })))))("rejects HTTP 200 logical failure for $operation with $marker at $level despite plausible persistence data", async ({ operation, marker, level }) => {
    const result = successfulResult(operation), message = "ERPNext did not commit the RFQ CLM transaction. Refresh its saved decision before retrying.";
    const failure = { ...(marker === "success" ? { success: false } : { error: "transaction_failed" }), message };
    const envelope = level === "outer" ? { ...failure, data: result } : { data: { ...result, ...failure } };
    mocks.post.mockResolvedValue({ status: 200, data: envelope });
    await expect(callOperation(operation)).rejects.toThrow(message);
    expect(mocks.post).toHaveBeenCalledOnce(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it("rejects a non-string logical error without rendering its internal object", async () => {
    mocks.post.mockResolvedValue({ status: 200, data: { ...successfulResult("request"), error: { internal: "backend exception details" } } });
    await expect(callOperation("request")).rejects.toThrow("ERPNext reported that the RFQ CLM transaction failed");
  });
  it.each([true, false])("records a separate request-only Yes operation and validates persisted Team routing with created=%s", async created => {
    const result = routedRequest(created); mocks.post.mockResolvedValue({ data: result });
    const input = { rfq: "RFQ-1", expected_modified: "revision", payload: { contract_type: "Supply / Procurement Contract", contract_purpose: "Supply parts", contract_start_date: "2026-10-01", contract_end_date: "2026-11-01" } };
    expect(await submitRfqClmRequest(input)).toEqual(result);
    expect(mocks.post).toHaveBeenCalledWith("/api/clm?view=rfq_contract", { ...input, decision: "Yes", operation: "request" }, { _disableNetworkRetry: true, _preserveResponse: true });
  });
  it("confirms an initial RFQ-only request using its persisted Procurement stage", async () => {
    const result = routedRequest(), data = JSON.parse(result.request.record.custom_clm_data);
    data.rfq_source = { rfq: "RFQ-1", stage: "rfq_created", contract_required: true };
    Object.assign(data.rfq_request_workflow, { status: "Pending", current_stage: "Procurement" });
    result.request.record.request_status = "Pending Review";
    result.request.record.custom_clm_data = JSON.stringify(data);
    result.summary.request.current_stage = "Procurement";
    mocks.post.mockResolvedValue(result);
    expect(await submitRfqClmRequest({ rfq: "RFQ-1", expected_modified: "revision", payload: {} })).toEqual(result);
    result.summary.request.current_stage = "Legal Review"; mocks.post.mockResolvedValue(result);
    await expect(submitRfqClmRequest({ rfq: "RFQ-1", expected_modified: "revision", payload: {} })).rejects.toThrow("persisted Procurement Team assignment");
  });
  it("retries only the saved RFQ initial request without an award, new RFQ or Contract payload", async () => {
    const result = routedRequest(false); mocks.post.mockResolvedValue({ status: 200, data: { data: result } });
    expect(await retryInitialRfqClmRequest("RFQ-1")).toEqual(result);
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith("/api/clm?view=rfq_initial_request", { rfq: "RFQ-1" }, { _disableNetworkRetry: true, _preserveResponse: true });
  });
  it.each(["missing request", "wrong role", "wrong RFQ", "logical failure"])("does not falsely confirm initial request recovery with %s", async problem => {
    const result: any = routedRequest();
    if (problem === "missing request") delete result.request;
    if (problem === "wrong role") result.summary.request.assigned_role = "procurement";
    if (problem === "wrong RFQ") result.summary.rfq.name = "OTHER";
    if (problem === "logical failure") Object.assign(result, { success: false, message: "Request was not persisted" });
    mocks.post.mockResolvedValue({ status: 200, data: { data: result } });
    await expect(retryInitialRfqClmRequest("RFQ-1")).rejects.toThrow();
    expect(mocks.post).toHaveBeenCalledOnce(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it("preserves initial request recovery errors and excludes supplier sessions", async () => {
    const error = new Error("Contract Request schema requires supplier before persistence"); mocks.post.mockRejectedValueOnce(error);
    await expect(retryInitialRfqClmRequest("RFQ-1")).rejects.toBe(error);
    await expect(retryInitialRfqClmRequest(" ")).rejects.toThrow("Select the saved RFQ");
    vi.stubGlobal("window", { location: { pathname: "/supplier/rfq/RFQ-1" } });
    await expect(retryInitialRfqClmRequest("RFQ-1")).rejects.toThrow("authorized RFQ creator");
    expect(mocks.post).toHaveBeenCalledOnce();
  });
  it.each([undefined, null, "false"])("does not mistake a missing or malformed transaction result for an idempotent Request success: %j", async created => {
    mocks.post.mockResolvedValue({ ...routedRequest(), created });
    await expect(submitRfqClmRequest({ rfq: "RFQ-1", expected_modified: "revision", payload: {} })).rejects.toThrow("did not confirm the saved CLM Request");
  });
  it.each([undefined, null, "false"])("does not mistake a missing or malformed transaction result for an idempotent Contract success: %j", async created => {
    mocks.post.mockResolvedValue({ created, request: { record: { name: "CR-1" } }, contract: { doctype: "Contract", record: { name: "CON-1", custom_rfq: "RFQ-1", custom_contract_status: "Pending Legal" }, approvals: [{ role: "legal", stage: 0, status: "Pending" }] }, summary: { rfq: { name: "RFQ-1" }, request: { name: "CR-1" }, contract: { name: "CON-1" }, decision: "Yes", contract_required: "Yes" } });
    await expect(createRfqContractRequest({ rfq: "RFQ-1", expected_modified: "revision", payload: {} })).rejects.toThrow("did not confirm the saved Contract Request");
  });
  it.each(["request", "create_contract", "No"])("preserves the actionable server error without fallback or automatic retry for %s", async operation => {
    const error = { message: "Request failed with status code 503", response: { status: 503, data: { message: "Deploy bidsphere_workflows on the active ERPNext site before recording the CLM decision." } } };
    mocks.post.mockRejectedValueOnce(error);
    const input = { rfq: "RFQ-1", expected_modified: "revision", payload: {} };
    const action = operation === "request" ? submitRfqClmRequest(input) : operation === "create_contract" ? createRfqContractRequest(input) : decideRfqContractRequirement({ rfq: input.rfq, expected_modified: input.expected_modified, decision: "No" });
    await expect(action).rejects.toBe(error);
    expect(mocks.post).toHaveBeenCalledOnce(); expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.post.mock.calls[0][2]).toEqual({ _disableNetworkRetry: true, _preserveResponse: true });
  });
  it.each(["role", "stage", "approval", "source"])("rejects unconfirmed Procurement Team routing: %s", async problem => {
    const result = routedRequest(), data = JSON.parse(result.request.record.custom_clm_data);
    if (problem === "role") data.rfq_request_workflow.assigned_role = "procurement";
    if (problem === "stage") result.summary.request.current_stage = "Legal Review";
    if (problem === "approval") data.approvals = [];
    if (problem === "source") data.rfq_source.rfq = "RFQ-other";
    result.request.record.custom_clm_data = JSON.stringify(data); mocks.post.mockResolvedValue(result);
    await expect(submitRfqClmRequest({ rfq: "RFQ-1", expected_modified: "revision", payload: {} })).rejects.toThrow("persisted Procurement Team assignment");
  });
  it("does not accept Contract creation or another request identity during the request-only step", async () => {
    mocks.post.mockResolvedValue({ ...routedRequest(), contract: { record: { name: "CON-1" } } });
    await expect(submitRfqClmRequest({ rfq: "RFQ-1", expected_modified: "revision", payload: {} })).rejects.toThrow("saved CLM Request");
    const result = routedRequest(); result.summary.request.name = "CR-other"; mocks.post.mockResolvedValue(result);
    await expect(submitRfqClmRequest({ rfq: "RFQ-1", expected_modified: "revision", payload: {} })).rejects.toThrow("saved CLM Request");
  });
  it("blocks missing request revisions and supplier sessions before posting", async () => {
    await expect(submitRfqClmRequest({ rfq: "RFQ-1", expected_modified: "", payload: {} })).rejects.toThrow("Refresh this RFQ");
    vi.stubGlobal("window", { location: { pathname: "/supplier/rfq/RFQ-1" } });
    await expect(submitRfqClmRequest({ rfq: "RFQ-1", expected_modified: "revision", payload: {} })).rejects.toThrow("authorized Procurement Team");
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each([true, false])("accepts created=%s and preserves exact revision and user values without automatic retries", async created => {
    const data = { created, request: { record: { name: "CR-1" } }, contract: { doctype: "Contract", record: { name: "CON-1", custom_rfq: "RFQ-1", custom_contract_status: "Pending Legal" }, approvals: [{ role: "legal", stage: 0, status: "Pending" }] }, summary: { rfq: { name: "RFQ-1" }, request: { name: "CR-1" }, contract: { name: "CON-1", status: "Pending Legal" }, decision: "Yes", contract_required: "Yes" } };
    mocks.post.mockResolvedValue({ data });
    const input = { rfq: "RFQ-1", expected_modified: "revision-2", payload: { contract_type: "Supplier Agreement", contract_purpose: "Production tooling", estimated_contract_value: 0 }, contract_fields: { custom_risk_level: "Medium", custom_inteva_signatory: "legal@example.test" } };
    expect(await createRfqContractRequest(input)).toEqual(data);
    expect(mocks.post).toHaveBeenCalledWith("/api/clm?view=rfq_contract", { ...input, decision: "Yes", operation: "create_contract" }, { _disableNetworkRetry: true, _preserveResponse: true });
  });
  it("rejects an idempotent legacy Request-only response instead of claiming a Contract was created", async () => {
    const data = { created: false, request: { record: { name: "CR-1" } }, summary: { rfq: { name: "RFQ-1" }, request: { name: "CR-1" }, decision: "Yes", contract_required: "Yes" } };
    mocks.post.mockResolvedValue({ data });
    await expect(createRfqContractRequest({ rfq: "RFQ-1", expected_modified: "revision", payload: {} })).rejects.toThrow("A Contract Request alone does not complete CLM creation");
  });
  it.each([true, false])("rejects an incomplete Contract recovery as success even with plausible persisted data and created=%s", async created => {
    const result = successfulResult("create_contract");
    mocks.post.mockResolvedValue({ ...result, created, summary: { ...result.summary, recovery_required: true } });
    await expect(createRfqContractRequest({ rfq: "RFQ-1", expected_modified: "revision", payload: {} })).rejects.toThrow("Contract creation is not complete");
  });
  it("does not report a new Draft without a Legal assignment as successful creation", async () => {
    mocks.post.mockResolvedValue({ created: true, request: { record: { name: "CR-1" } }, contract: { doctype: "Contract", record: { name: "CON-1", custom_rfq: "RFQ-1", custom_contract_status: "Draft" }, approvals: [] }, summary: { rfq: { name: "RFQ-1" }, request: { name: "CR-1" }, contract: { name: "CON-1" }, decision: "Yes", contract_required: "Yes" } });
    await expect(createRfqContractRequest({ rfq: "RFQ-1", expected_modified: "revision", payload: {} })).rejects.toThrow("Legal Review assignment");
  });
  it.each([
    undefined,
    { doctype: "Contract Request", record: { name: "CON-1", custom_rfq: "RFQ-1" } },
    { doctype: "Contract", record: { custom_rfq: "RFQ-1" } },
    { doctype: "Contract", record: { name: "CON-other", custom_rfq: "RFQ-1" } },
    { doctype: "Contract", record: { name: "CON-1", custom_rfq: "RFQ-other" } },
    { doctype: "Contract", record: { name: "CON-1" } },
  ])("rejects a new award response without a matching persisted RFQ Contract: %j", async contract => {
    mocks.post.mockResolvedValue({ created: true, request: { record: { name: "CR-1" } }, contract, summary: { rfq: { name: "RFQ-1" }, request: { name: "CR-1" }, contract: { name: "CON-1" }, decision: "Yes", contract_required: "Yes" } });
    await expect(createRfqContractRequest({ rfq: "RFQ-1", expected_modified: "revision", payload: {} })).rejects.toThrow("did not confirm the RFQ-linked Contract");
  });
  it("does not accept a returned Contract absent from the committed RFQ summary", async () => {
    mocks.post.mockResolvedValue({ created: false, request: { record: { name: "CR-1" } }, contract: { doctype: "Contract", record: { name: "CON-1", custom_rfq: "RFQ-1" } }, summary: { rfq: { name: "RFQ-1" }, request: { name: "CR-1" }, decision: "Yes", contract_required: "Yes" } });
    await expect(createRfqContractRequest({ rfq: "RFQ-1", expected_modified: "revision", payload: {} })).rejects.toThrow("did not confirm the RFQ-linked Contract");
  });
  it("blocks missing revisions before writing", async () => {
    await expect(createRfqContractRequest({ rfq: "RFQ-1", expected_modified: "", payload: {} })).rejects.toThrow("Refresh this RFQ");
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("does not accept a partial or mismatched create response", async () => {
    mocks.post.mockResolvedValue({ created: true, request: { record: { name: "CR-1" } }, summary: { rfq: { name: "RFQ-other" }, request: { name: "CR-1" } } });
    await expect(createRfqContractRequest({ rfq: "RFQ-1", expected_modified: "revision", payload: {} })).rejects.toThrow("did not confirm");
  });
  it("never uses a staff token to create through the supplier portal", async () => {
    vi.stubGlobal("window", { location: { pathname: "/supplier/rfq/RFQ-1" } });
    await expect(createRfqContractRequest({ rfq: "RFQ-1", expected_modified: "revision", payload: {} })).rejects.toThrow("authorized Procurement");
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("saves No explicitly without a creation payload or automatic retry", async () => {
    const input = { rfq: "RFQ-1", expected_modified: "revision", decision: "No" as const };
    const data = { created: false, summary: { rfq: { name: "RFQ-1" }, decision: "No", contract_required: "No" } };
    mocks.post.mockResolvedValue({ data });
    expect(await decideRfqContractRequirement(input)).toEqual(data);
    expect(mocks.post).toHaveBeenCalledWith("/api/clm?view=rfq_contract", input, { _disableNetworkRetry: true, _preserveResponse: true });
  });
  it.each([
    { decision: "Pending", contract_required: "No" },
    { decision: "No", contract_required: "Yes" },
    { decision: "No", contract_required: "No", request: { name: "CR-1" } },
    { decision: "No", contract_required: "No", contract: { name: "C-1" } },
  ])("rejects an inconsistent No response: %j", summary => {
    mocks.post.mockResolvedValue({ created: false, summary: { rfq: { name: "RFQ-1" }, ...summary } });
    return expect(decideRfqContractRequirement({ rfq: "RFQ-1", expected_modified: "revision", decision: "No" })).rejects.toThrow("did not confirm");
  });
  it("rejects a No decision that unexpectedly created a Contract outside its summary", async () => {
    mocks.post.mockResolvedValue({ created: false, contract: { doctype: "Contract", record: { name: "CON-1", custom_rfq: "RFQ-1" } }, summary: { rfq: { name: "RFQ-1" }, decision: "No", contract_required: "No" } });
    await expect(decideRfqContractRequirement({ rfq: "RFQ-1", expected_modified: "revision", decision: "No" })).rejects.toThrow("did not confirm");
  });
  it("blocks supplier decisions and missing No revisions before writing", async () => {
    await expect(decideRfqContractRequirement({ rfq: "RFQ-1", expected_modified: "", decision: "No" })).rejects.toThrow("Refresh this RFQ");
    vi.stubGlobal("window", { location: { pathname: "/supplier/rfq/RFQ-1" } });
    await expect(decideRfqContractRequirement({ rfq: "RFQ-1", expected_modified: "revision", decision: "No" })).rejects.toThrow("authorized Procurement");
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
