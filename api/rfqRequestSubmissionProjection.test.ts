import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ClmRecord } from "../src/types/clm";
import handler from "./clm";
import { ClmError, parseClmData } from "./clmCore";
import { issueInternalAccessToken, type AppRole } from "./rbacAuth";
import { projectRfqRequestSubmission } from "./rfqRequestSubmissionProjection";

const at = "2026-09-25T08:00:00.000Z";
const requester = "procurement@example.test";

function request(name: string, stage = "rfq_awarded"): ClmRecord {
  const awarded = stage === "rfq_awarded";
  const rfq = `RFQ-${name}`;
  const source: ClmRecord = { stage, rfq, company: "Netlink", contract_required: true, prepared: false,
    ...(awarded ? { award: `LDC-${name}`, supplier: "SUP-1", quotation: `SQ-${name}`, amount: 48500, currency: "USD" } : {}) };
  return { name, docstatus: 0, modified: "request-r1", custom_rfq: rfq, request_status: "Draft", company: "Netlink", department: "Production",
    requester, request_date: "2026-09-25", contract_purpose: `Supply for ${rfq}`, description: "Awarded procurement",
    supplier: awarded ? "SUP-1" : "", custom_supplier_quotation: awarded ? `SQ-${name}` : "", contract_value: awarded ? 48500 : 0,
    currency: "USD", estimated_contract_value: 0,
    custom_clm_data: JSON.stringify({ schema: 1, versions: [], signatures: [], sla: [],
      approvals: [{ id: "TEAM", role: "procurement_team", stage: 0, status: "Pending", rule: "RFQ Contract Request: Procurement preparation" }],
      audit: [
        { id: "CREATE", action: "create", by: requester, role: "procurement", at, previous_status: "", new_status: "Pending", comment: "Saved Request", reference_id: rfq },
        { id: "ASSIGNED", action: "procurement_team_assigned", by: requester, role: "procurement", at, previous_status: "Draft", new_status: "Pending", comment: "Assigned to Procurement", reference_id: awarded ? `LDC-${name}` : rfq },
      ], rfq_source: source,
      rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team", status: "Pending", current_stage: "Procurement" },
      rfq_request_draft: { version: 1, by: requester, role: "procurement", at, values: { estimated_contract_value: "" } },
    }),
  };
}

function sourceRecords(record: ClmRecord, rfqPatch: ClmRecord = {}): Record<string, ClmRecord> {
  const rfq = String(record.custom_rfq);
  return {
    [`Request for Quotation/${rfq}`]: { name: rfq, docstatus: 1, status: "Submitted", contract_required: "Yes", company: "Netlink", ...rfqPatch },
    [`Legal Document Review/LDC-${record.name}`]: { name: `LDC-${record.name}`, rfq_name: rfq, sq_name: `SQ-${record.name}`, supplier: "SUP-1", company: "Netlink", grand_total: 48500 },
    [`Supplier Quotation/SQ-${record.name}`]: { name: `SQ-${record.name}`, docstatus: 1, supplier: "SUP-1", company: "Netlink", grand_total: 50000, currency: "USD", items: [{ request_for_quotation: rfq }] },
    "Supplier/SUP-1": { name: "SUP-1", supplier_name: "Supplier One", disabled: 0 },
  };
}
const loader = (records: Record<string, ClmRecord>) => vi.fn(async (doctype: string, name: string) => {
  const record = records[`${doctype}/${name}`];
  if (!record) throw new ClmError("Not found", 404);
  return structuredClone(record);
});

describe("RFQ Request active-queue projection", () => {
  it.each([0, 1])("invalidates a historical pre-award Request even when RFQ docstatus is %i, without altering its stored history", async docstatus => {
    const saved = request("PREAWARD", "rfq_created"), snapshot = structuredClone(saved);
    const load = loader(sourceRecords(saved, { docstatus }));
    const projected = await projectRfqRequestSubmission(saved, load);
    expect(projected.request_status).toBe("Cancelled");
    expect(parseClmData(projected.custom_clm_data).rfq_request_workflow).toMatchObject({ phase: "awaiting_supplier_award", status: "Invalidated", current_stage: "Awaiting Supplier Award" });
    expect(parseClmData(projected.custom_clm_data).audit).toEqual(parseClmData(snapshot.custom_clm_data).audit);
    expect(saved).toEqual(snapshot);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retains a verified saved award and its negotiated final value instead of using the quotation total", async () => {
    const saved = request("AWARDED");
    const load = loader(sourceRecords(saved));
    expect(await projectRfqRequestSubmission(saved, load)).toBe(saved);
    expect(saved.contract_value).toBe(48500);
    expect(load).toHaveBeenCalledWith("Legal Document Review", "LDC-AWARDED");
    expect(load).toHaveBeenCalledWith("Supplier Quotation", "SQ-AWARDED");
  });

  it.each([
    ["LDC supplier differs", "Legal Document Review/LDC-BAD", { supplier: "ANOTHER-SUPPLIER" }],
    ["LDC RFQ differs", "Legal Document Review/LDC-BAD", { rfq_name: "ANOTHER-RFQ" }],
    ["LDC quotation differs", "Legal Document Review/LDC-BAD", { sq_name: "ANOTHER-SQ" }],
    ["LDC was cancelled", "Legal Document Review/LDC-BAD", { docstatus: 2 }],
    ["quotation is unsubmitted", "Supplier Quotation/SQ-BAD", { docstatus: 0 }],
    ["quotation belongs to another RFQ", "Supplier Quotation/SQ-BAD", { items: [{ request_for_quotation: "ANOTHER-RFQ" }] }],
    ["RFQ is unsubmitted", "Request for Quotation/RFQ-BAD", { docstatus: 0 }],
    ["RFQ decision is No", "Request for Quotation/RFQ-BAD", { contract_required: "No" }],
  ] as const)("removes invalid source evidence from the active queue: %s", async (_label, key, patch) => {
    const saved = request("BAD"), records = sourceRecords(saved);
    records[key] = { ...records[key], ...patch };
    expect((await projectRfqRequestSubmission(saved, loader(records))).request_status).toBe("Cancelled");
  });

  it("invalidates a missing award but propagates ERP availability failures", async () => {
    const saved = request("MISSING"), records = sourceRecords(saved);
    delete records["Legal Document Review/LDC-MISSING"];
    expect((await projectRfqRequestSubmission(saved, loader(records))).request_status).toBe("Cancelled");
    const load = loader(sourceRecords(saved));
    load.mockImplementation(async doctype => { if (doctype === "Legal Document Review") throw new ClmError("ERPNext unavailable", 503); return records[`Request for Quotation/${saved.custom_rfq}`]; });
    await expect(projectRfqRequestSubmission(saved, load)).rejects.toMatchObject({ status: 503 });
  });

  it("accepts a legacy quoted supplier display only when it is not another real Supplier DocName", async () => {
    const saved = request("QUOTED"), records = sourceRecords(saved);
    records["Legal Document Review/LDC-QUOTED"].supplier = '"SUP-1"';
    const load = loader(records);
    expect(await projectRfqRequestSubmission(saved, load)).toBe(saved);
    expect(load).toHaveBeenCalledWith("Supplier", '"SUP-1"');
    records['Supplier/"SUP-1"'] = { name: '"SUP-1"', supplier_name: "Different supplier" };
    expect((await projectRfqRequestSubmission(saved, loader(records))).request_status).toBe("Cancelled");
  });

  it("leaves a Contract already created from the Request untouched", async () => {
    const saved = { ...request("LINKED"), custom_contract: "CON-LINKED" };
    const load = loader({});
    expect(await projectRfqRequestSubmission(saved, load)).toBe(saved);
    expect(load).not.toHaveBeenCalled();
  });
});

function erpFixture(rows: ClmRecord[], overrides: Record<string, ClmRecord> = {}) {
  const records = Object.assign({}, ...rows.map(row => ({ [`Contract Request/${row.name}`]: row, ...sourceRecords(row) })), overrides) as Record<string, ClmRecord>;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://rfq-request-projection.test") throw new Error("Unexpected network outside the fixture");
    if (init?.method && !["GET", "HEAD"].includes(init.method)) throw new Error("Request projection attempted an ERP mutation");
    const route = decodeURIComponent(url.pathname).replace(/^\/api\/resource\//, "");
    let data: unknown;
    if (route.startsWith("DocType/")) data = { name: route.slice(8), fields: [
      { fieldname: "custom_clm_data", fieldtype: "Long Text", read_only: 1 },
      { fieldname: "estimated_contract_value", fieldtype: "Currency" },
      { fieldname: "supplier", fieldtype: "Link", options: "Supplier" },
    ] };
    else if (route === "Contract Request") data = rows;
    else if (!route.includes("/")) data = [];
    else data = records[route];
    return new Response(JSON.stringify({ data: data ?? {} }), { status: data === undefined ? 404 : 200, headers: { "Content-Type": "application/json" } });
  });
  return { records, fetchMock };
}
async function get(role: AppRole, view: "list" | "detail", name?: string) {
  const access = issueInternalAccessToken({ role, sub: `${role}@example.test`, email: `${role}@example.test` });
  const req = { method: "GET", headers: { "x-bidsphere-access-token": access }, query: { view, doctype: "Contract Request", ...(name ? { name } : {}) } } as unknown as VercelRequest;
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn(), send: vi.fn(), end: vi.fn() };
  res.status.mockReturnValue(res);
  await handler(req, res as unknown as VercelResponse);
  return { res, body: res.json.mock.calls[0]?.[0] };
}

describe("GET /api/clm Contract Request list and detail with native ERP fixtures", () => {
  beforeEach(() => {
    vi.stubEnv("BIDSPHERE_SESSION_SECRET", "projection-test-only-session-secret");
    vi.stubEnv("ERPNEXT_URL", "https://rfq-request-projection.test");
    vi.stubEnv("ERP_API_KEY", "fixture-key"); vi.stubEnv("ERP_API_SECRET", "fixture-secret");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it.each(["procurement", "procurement_team"] as AppRole[])("%s sees only saved awarded Requests in its active queue, while historical details remain readable", async role => {
    const draft = request("OLD-DRAFT", "rfq_created"), submitted = request("OLD-SUBMITTED", "rfq_created"), awarded = request("VALID");
    const snapshots = structuredClone([draft, submitted, awarded]);
    const fixture = erpFixture([draft, submitted, awarded], { [`Request for Quotation/${draft.custom_rfq}`]: { name: draft.custom_rfq, docstatus: 0, contract_required: "Yes", company: "Netlink" } });
    const list = await get(role, "list");
    expect(list.res.status).toHaveBeenCalledWith(200);
    expect(list.body.data.records.map((row: ClmRecord) => row.name)).toEqual(["VALID"]);
    for (const saved of [draft, submitted]) {
      const detail = await get(role, "detail", saved.name);
      expect(detail.res.status).toHaveBeenCalledWith(200);
      expect(detail.body.data.record.request_status).toBe("Cancelled");
      expect(detail.body.data.rfq_request_draft_editable).toBe(false);
      expect(detail.body.data.actions).toEqual([]);
      expect(detail.body.data.audit).toEqual(parseClmData(saved.custom_clm_data).audit);
    }
    expect([draft, submitted, awarded]).toEqual(snapshots);
    expect(fixture.fetchMock.mock.calls.every(([, init]) => !init?.method || ["GET", "HEAD"].includes(init.method))).toBe(true);
  });

  it.each(["procurement", "procurement_team"] as AppRole[])("%s gets the actual award identity and a blank unknown estimate on Request detail", async role => {
    const awarded = request("DETAIL");
    erpFixture([awarded]);
    const detail = await get(role, "detail", awarded.name);
    expect(detail.res.status).toHaveBeenCalledWith(200);
    expect(detail.body.data.record).toMatchObject({ custom_rfq: "RFQ-DETAIL", supplier: "SUP-1", custom_supplier_quotation: "SQ-DETAIL", contract_value: 48500, currency: "USD", estimated_contract_value: "" });
    expect(parseClmData(detail.body.data.record.custom_clm_data).rfq_source).toMatchObject({ stage: "rfq_awarded", award: "LDC-DETAIL", supplier: "SUP-1", quotation: "SQ-DETAIL", amount: 48500 });
    expect(detail.body.data.rfq_request_draft_editable).toBe(true);
    expect(awarded.estimated_contract_value).toBe(0);
  });
});
