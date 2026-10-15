import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./clm";
import { applyClmAction, canReadClm, parseClmData, toClmAggregate, type ClmDeps } from "./clmCore";
import { issueInternalAccessToken, type AccessPrincipal, type AppRole } from "./rbacAuth";
import type { ClmRecord } from "../src/types/clm";

const principal = (role: AppRole): AccessPrincipal => ({ typ: "internal", role, email: `${role}@test.invalid`, sub: `${role}@test.invalid`, iat: 1, exp: Number.MAX_SAFE_INTEGER });
function request(): ClmRecord {
  const data = parseClmData(null);
  data.rfq_source = { rfq: "PUR-RFQ-2026-00094", award: "AWARD-94", supplier: "FEMSA", quotation: "SQ-94", contract_required: true };
  data.rfq_request_workflow = { version: 1, phase: "procurement_team", assigned_role: "procurement_team" };
  data.approvals = [{ id: "TEAM-94", role: "procurement_team", stage: 0, rule: "RFQ CLM request", status: "Pending" }];
  return { name: "CR-94", modified: "r1", request_status: "Draft", approval_status: "Pending", custom_rfq: "PUR-RFQ-2026-00094", supplier: "FEMSA", custom_clm_data: JSON.stringify(data) };
}
function initialRequest(): ClmRecord {
  const data = parseClmData(null);
  data.rfq_source = { rfq: "RFQ-NEW", stage: "rfq_created", contract_required: true };
  data.rfq_request_workflow = { version: 1, phase: "procurement_team", assigned_role: "procurement_team", status: "Pending", current_stage: "Procurement" };
  data.approvals = [{ id: "TEAM-NEW", role: "procurement_team", stage: 0, rule: "RFQ Contract Request", status: "Pending" }];
  data.audit = [{ id: "CREATE-NEW", action: "create", by: "procurement@test.invalid", role: "procurement", at: "2026-09-24 10:00:00", previous_status: "", new_status: "Pending", comment: "Created from saved RFQ" }];
  return { name: "CR-NEW", modified: "r1", request_status: "Pending Review", approval_status: "Pending", custom_rfq: "RFQ-NEW", custom_clm_data: JSON.stringify(data) };
}
function awardedRequest(): ClmRecord {
  const record = initialRequest(), data = parseClmData(record.custom_clm_data);
  data.rfq_source = { rfq: "RFQ-AWARDED", stage: "rfq_awarded", award: "LDC-AWARDED", quotation: "SQ-AWARDED", supplier: "FEMSA", amount: 48500, currency: "USD", company: "Netlink", contract_required: true };
  return { ...record, name: "CR-AWARDED", custom_rfq: "RFQ-AWARDED", supplier: "FEMSA", custom_supplier_quotation: "SQ-AWARDED", contract_value: 48500, currency: "USD", company: "Netlink", custom_clm_data: JSON.stringify(data) };
}

describe("persisted RFQ initial Contract Request assignment", () => {
  it("offers atomic Contract creation to Procurement Manager and Team, with downstream roles still excluded", () => {
    const record = request();
    for (const role of ["procurement", "procurement_team"] as AppRole[]) {
      expect(canReadClm(principal(role), "Contract Request", record)).toBe(true);
      expect(toClmAggregate(principal(role), "Contract Request", record).actions).toEqual([{ action: "create_contract", label: "Create Contract" }]);
    }
    for (const role of ["admin", "legal", "finance", "engineering", "program_manager", "warehouse"] as AppRole[]) {
      expect(canReadClm(principal(role), "Contract Request", record)).toBe(false);
      expect(toClmAggregate(principal(role), "Contract Request", record).actions).toEqual([]);
    }
  });
  it("rejects generic processing without creating a partial Contract or advancing the request", async () => {
    const record = request();
    const deps: ClmDeps = { load: vi.fn(async () => record), list: vi.fn(async () => []), create: vi.fn(), save: vi.fn(), now: () => "2026-09-23 10:00:00" };
    await expect(applyClmAction({ doctype: "Contract Request", name: record.name, expected_modified: "r1", action: "create_contract" }, principal("procurement_team"), deps)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("RFQ award transaction") });
    for (const action of ["save", "submit", "approve"] as const) {
      await expect(applyClmAction({ doctype: "Contract Request", name: record.name, expected_modified: "r1", action }, principal("procurement_team"), deps)).rejects.toMatchObject({ status: 403 });
    }
    expect(deps.create).not.toHaveBeenCalled(); expect(deps.save).not.toHaveBeenCalled();
  });
  it("keeps standalone Manager validation and legacy request behavior", () => {
    const standalone = { name: "CR-OLD", request_status: "Pending Review" };
    expect(canReadClm(principal("procurement"), "Contract Request", standalone)).toBe(true);
    expect(toClmAggregate(principal("procurement"), "Contract Request", standalone).actions.map(row => row.action)).toEqual(["approve", "reject", "send_back"]);
    const legacy = { ...standalone, custom_rfq: "RFQ-OLD", request_status: "Draft" };
    expect(canReadClm(principal("procurement"), "Contract Request", legacy)).toBe(true);
    expect(toClmAggregate(principal("procurement_team"), "Contract Request", legacy).actions.map(row => row.action)).toEqual(["save", "submit"]);
    expect(canReadClm(principal("procurement"), "Contract Request", { ...legacy, custom_clm_data: "{invalid" })).toBe(true);
  });
  it.each([
    ["unsupported version", { version: 2, phase: "procurement_team", assigned_role: "procurement_team" }],
    ["wrong role", { version: 1, phase: "procurement_team", assigned_role: "procurement" }],
    ["noncanonical phase", { version: 1, phase: " procurement_team ", assigned_role: "procurement_team" }],
    ["missing phase", { version: 1, assigned_role: "procurement_team" }],
    ["empty marker", null],
  ])("does not fall back to Manager access for an explicitly routed request with %s", (_label, route) => {
    const record = request(), data = JSON.parse(String(record.custom_clm_data));
    data.rfq_request_workflow = route;
    for (const raw of [data, JSON.stringify(data)]) {
      const malformed = { ...record, custom_clm_data: raw };
      for (const role of ["procurement", "procurement_team", "admin", "legal", "finance"] as AppRole[]) {
        expect(canReadClm(principal(role), "Contract Request", malformed)).toBe(false);
      }
    }
  });
  it("does not fall back to Manager access when explicitly routed request evidence cannot be parsed", () => {
    const record = request(), data = JSON.parse(String(record.custom_clm_data));
    data.approvals[0].status = "Completed";
    expect(canReadClm(principal("procurement"), "Contract Request", { ...record, custom_clm_data: JSON.stringify(data) })).toBe(false);
    delete data.approvals;
    expect(canReadClm(principal("procurement"), "Contract Request", { ...record, custom_clm_data: JSON.stringify(data) })).toBe(false);
  });
  it("never grants an action for a mismatched or already converted request", () => {
    const record = request();
    expect(toClmAggregate(principal("procurement_team"), "Contract Request", { ...record, custom_rfq: "OTHER" }).actions).toEqual([]);
    const data = parseClmData(record.custom_clm_data);
    data.contract = "CON-94";
    data.rfq_request_workflow = { version: 1, phase: "contract_created", assigned_role: "procurement_team" };
    const converted = { ...record, request_status: "Completed", custom_clm_data: JSON.stringify(data) };
    expect(toClmAggregate(principal("procurement_team"), "Contract Request", converted).actions).toEqual([]);
  });
  it("does not override a named user or offer actions for an unsupported role-queue assignment", () => {
    const record = request(), data = parseClmData(record.custom_clm_data);
    data.approvals[0].user = "assigned-team@test.invalid";
    const assignedRecord = { ...record, custom_clm_data: JSON.stringify(data) };
    expect(canReadClm(principal("procurement_team"), "Contract Request", assignedRecord)).toBe(false);
    expect(toClmAggregate(principal("procurement_team"), "Contract Request", assignedRecord).actions).toEqual([]);
    const who = { ...principal("procurement_team"), email: "assigned-team@test.invalid" } as AccessPrincipal;
    expect(canReadClm(who, "Contract Request", assignedRecord)).toBe(true);
    expect(toClmAggregate(who, "Contract Request", assignedRecord).actions).toEqual([]);
  });
});

describe("ERP-backed Contract Request queue membership", () => {
  beforeEach(() => { vi.stubEnv("BIDSPHERE_SESSION_SECRET", "rfq-request-routing-fixture-secret"); vi.stubEnv("ERPNEXT_URL", "https://request-queue.test"); vi.stubEnv("ERP_API_KEY", "fixture"); vi.stubEnv("ERP_API_SECRET", "fixture"); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it("returns saved award requests to Manager and Team, hides pre-award requests and excludes Legal/Finance", async () => {
    const records = [request(), initialRequest(), awardedRequest(), { name: "CR-STANDALONE", request_status: "Pending Review" }];
    const sources: Record<string, ClmRecord> = {
      "Request for Quotation/RFQ-NEW": { name: "RFQ-NEW", docstatus: 1, status: "Open", contract_required: "Yes" },
      "Request for Quotation/RFQ-AWARDED": { name: "RFQ-AWARDED", docstatus: 1, status: "Open", contract_required: "Yes" },
      "Legal Document Review/LDC-AWARDED": { name: "LDC-AWARDED", rfq_name: "RFQ-AWARDED", sq_name: "SQ-AWARDED", supplier: "FEMSA", grand_total: 48500 },
      "Supplier Quotation/SQ-AWARDED": { name: "SQ-AWARDED", docstatus: 1, supplier: "FEMSA", grand_total: 50000, items: [{ request_for_quotation: "RFQ-AWARDED" }] },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = new URL(String(input));
      const source = sources[decodeURIComponent(url.pathname).replace("/api/resource/", "")];
      if (url.origin === "https://request-queue.test" && source) return new Response(JSON.stringify({ data: source }), { status: 200 });
      if (url.origin !== "https://request-queue.test" || decodeURIComponent(url.pathname) !== "/api/resource/Contract Request") throw new Error(`Unexpected fixture route ${url.pathname}`);
      return new Response(JSON.stringify({ data: records }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    for (const [role, names] of [["procurement_team", ["CR-94", "CR-AWARDED", "CR-STANDALONE"]], ["procurement", ["CR-94", "CR-AWARDED", "CR-STANDALONE"]], ["legal", []], ["finance", []]] as Array<[AppRole, string[]]>) {
      const identity = principal(role);
      const token = issueInternalAccessToken({ role, sub: identity.sub, email: `${role}@test.invalid` });
      const req = { method: "GET", headers: { "x-bidsphere-access-token": token }, query: { view: "list", doctype: "Contract Request" } } as unknown as VercelRequest;
      const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() }; res.status.mockReturnValue(res);
      await handler(req, res as unknown as VercelResponse);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].data.records.map((row: ClmRecord) => row.name)).toEqual(names);
      if (["procurement", "procurement_team"].includes(role)) {
        const awarded = res.json.mock.calls[0][0].data.records.find((row: ClmRecord) => row.name === "CR-AWARDED");
        expect(awarded).toMatchObject({ custom_rfq: "RFQ-AWARDED", supplier: "FEMSA", custom_supplier_quotation: "SQ-AWARDED", contract_value: 48500 });
        expect(JSON.parse(awarded.custom_clm_data).rfq_source).toMatchObject({ stage: "rfq_awarded", award: "LDC-AWARDED" });
        expect(JSON.parse(awarded.custom_clm_data).rfq_request_workflow).toMatchObject({ assigned_role: "procurement_team", status: "Pending", current_stage: "Procurement" });
      }
    }
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
  it("excludes a historical Draft-origin Request from both active Procurement queues without mutating its record", async () => {
    const record = initialRequest();
    const original = structuredClone(record);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = decodeURIComponent(new URL(String(input)).pathname);
      const data = path === "/api/resource/Contract Request" ? [record] : path === "/api/resource/Request for Quotation/RFQ-NEW" ? { name: "RFQ-NEW", docstatus: 0, status: "Draft" } : undefined;
      if (!data) throw new Error(`Unexpected fixture route ${path}`);
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    for (const role of ["procurement_team", "procurement"] as AppRole[]) {
      const token = issueInternalAccessToken({ role, sub: `${role}@test.invalid` });
      const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() }; res.status.mockReturnValue(res);
      await handler({ method: "GET", headers: { "x-bidsphere-access-token": token }, query: { view: "list", doctype: "Contract Request" } } as unknown as VercelRequest, res as unknown as VercelResponse);
      expect(res.status).toHaveBeenCalledWith(200);
      const rows = res.json.mock.calls[0][0].data.records;
      expect(rows).toEqual([]);
    }
    expect(record).toEqual(original);
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
});
