import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClmRecord } from "../../api/clm";
const data = vi.hoisted(() => ({ records: [] as ClmRecord[], recordsByDoctype: undefined as Record<string, ClmRecord[]> | undefined, error: false, list: vi.fn(), queryFn: undefined as undefined | (() => Promise<unknown>), interval: 0 }));
vi.mock("../../api/clm", async importOriginal => ({ ...await importOriginal<typeof import("../../api/clm")>(), getClmList: data.list, clmViewerKey: () => "current-user" }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: { queryKey: string[]; queryFn: () => Promise<unknown>; refetchInterval?: number }) => {
  if (options.queryKey[1] === "metadata") return { data: { fields: {}, allowedCreate: [] } };
  data.queryFn = options.queryFn; data.interval = options.refetchInterval || 0;
  return { data: { records: data.recordsByDoctype?.[options.queryKey[2]] || data.records }, isLoading: false, isError: data.error, error: new Error("ERP unavailable"), isFetching: false, refetch: vi.fn() };
} }));
import ContractsPage, { contractKpis } from "./ContractsPage";

function contract(phase = "legal_review", status = "Pending Legal"): ClmRecord {
  return { name: "CON-PERSISTED-93", custom_rfq: "PUR-RFQ-2026-00093", custom_supplier: "Apex Fasteners Ltd", custom_contract_title: "Supply agreement", custom_contract_status: status, custom_contract_value: 2500, custom_currency: "USD", start_date: "2026-09-21", end_date: "2026-11-21", custom_clm_data: JSON.stringify({ rfq_source: { legal_review: "LDC2026-00024" }, rfq_workflow: { version: 1, phase } }) };
}
const render = () => renderToStaticMarkup(<MemoryRouter><ContractsPage /></MemoryRouter>);
describe("Contract Lifecycle list reads persisted RFQ Contracts", () => {
  beforeEach(() => { vi.clearAllMocks(); data.records = []; data.recordsByDoctype = undefined; data.error = false; });
  it("uses the backend Contract list and opens its actual persisted reference", async () => {
    data.records = [contract()]; data.list.mockResolvedValue({ records: data.records });
    const html = render(); await data.queryFn?.();
    expect(data.list).toHaveBeenCalledWith("Contract"); expect(data.interval).toBeGreaterThan(0);
    for (const value of ["CON-PERSISTED-93", "PUR-RFQ-2026-00093", "LDC2026-00024", "Apex Fasteners Ltd", "Pending Legal Review", "Legal Review", "Legal Manager", "2026-09-21", "2026-11-21"]) expect(html).toContain(value);
    expect(html).toContain('href="/contracts/CON-PERSISTED-93"'); expect(html).toContain("Current Stage"); expect(html).toContain("Owner");
    expect(html).toContain('class="max-w-full overflow-x-auto" role="region" aria-label="Contracts table"');
    expect(html).toContain("min-w-0 max-w-full overflow-hidden");
  });
  it("does not fabricate a Contract row when the backend list is empty or unavailable", () => {
    expect(render()).toContain("No contracts match this view"); expect(render()).not.toContain("CON-PERSISTED-93");
    data.error = true; expect(render()).toContain('role="alert"'); expect(render()).not.toContain("CON-PERSISTED-93");
    expect(render()).toContain('text-2xl font-bold text-slate-900">—</p>');
    expect(render()).not.toContain('text-2xl font-bold text-slate-900">0</p>');
  });
  it("uses persisted phases for counters while preserving active legal lifecycle after completion", () => {
    const rows = [contract(), contract("signature", "Approved"), contract("finance_review", "Pending Finance"), contract("procurement", "Executed"), contract("completed", "Active")];
    const counts = Object.fromEntries(contractKpis(rows));
    expect(counts).toMatchObject({ "Total contracts": 5, Draft: 0, "Pending review / approval": 2, "Pending signatures": 1, Active: 1, Completed: 1 });
    data.records = [rows[4]]; expect(render()).toContain("Contract: Active"); expect(render()).toContain("Completed");
  });
  it("shows a persisted pending Team Request in its own queue with the exact RFQ and award", async () => {
    data.records = [{ name: "CR-94", request_status: "Draft", contract_purpose: "Supply agreement", supplier: "FEMSA", custom_rfq: "RFQ-94", contract_value: 2600, currency: "USD", custom_clm_data: JSON.stringify({ rfq_source: { rfq: "RFQ-94", award: "AWARD-94" }, rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team" }, approvals: [{ role: "procurement_team", stage: 0, status: "Pending" }] }) }];
    const html = renderToStaticMarkup(<MemoryRouter><ContractsPage doctype="Contract Request" /></MemoryRouter>); await data.queryFn?.();
    expect(data.list).toHaveBeenCalledWith("Contract Request");
    for (const text of ["Pending CLM Requests: 1", "Pending Procurement Team", "Procurement Team", "RFQ-94", "AWARD-94", "Review &amp; Create Contract"]) expect(html).toContain(text);
    expect(html).toContain('href="/contract-requests/CR-94"'); expect(html).not.toContain('href="/contracts/CR-94"'); expect(html).not.toContain("Total contracts");
  });
  it("keeps the request queue separate from the Contracts counter until the backend returns an actual Contract", async () => {
    const request = { name: "CR-95", request_status: "Draft", custom_rfq: "PUR-RFQ-2026-00095", contract_purpose: "RFQ95 supply agreement" };
    data.recordsByDoctype = { "Contract Request": [request], Contract: [] };
    const requests = renderToStaticMarkup(<MemoryRouter><ContractsPage doctype="Contract Request" /></MemoryRouter>); await data.queryFn?.();
    expect(data.list).toHaveBeenLastCalledWith("Contract Request"); expect(requests).toContain('href="/contract-requests/CR-95"');
    const beforeCreation = render(); await data.queryFn?.();
    expect(data.list).toHaveBeenLastCalledWith("Contract"); expect(beforeCreation).not.toContain("CR-95"); expect(beforeCreation).toContain("No contracts match this view");
    const created = { ...contract(), name: "CON-95", custom_rfq: "PUR-RFQ-2026-00095", custom_clm_data: JSON.stringify({ rfq_source: { rfq: "PUR-RFQ-2026-00095", award: "AWARD-95" }, rfq_workflow: { version: 1, phase: "legal_review" } }) };
    data.recordsByDoctype.Contract = [created];
    const afterCreation = render();
    expect(afterCreation).toContain('href="/contracts/CON-95"'); expect(afterCreation).not.toContain('href="/contracts/CR-95"');
    expect(afterCreation).toContain("PUR-RFQ-2026-00095"); expect(afterCreation).toContain("AWARD-95"); expect(afterCreation).toContain("Pending Legal Review");
    expect(Object.fromEntries(contractKpis(data.recordsByDoctype.Contract))["Total contracts"]).toBe(1);
  });
  it("shows a saved RFQ-created Request as Pending in Procurement before award or supplier exist", async () => {
    const request = { name: "CR-NEW-RFQ", custom_rfq: "RFQ-NEW", department: "Production", requester: "buyer@example.test", request_status: "Pending Review", contract_value: 0, currency: "USD", contract_purpose: "Request for production steel", custom_clm_data: JSON.stringify({
      rfq_source: { rfq: "RFQ-NEW", stage: "rfq_created", contract_required: true },
      rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team", status: "Pending", current_stage: "Procurement" },
      approvals: [{ role: "procurement_team", stage: 0, status: "Pending" }],
    }) };
    data.recordsByDoctype = { "Contract Request": [request], Contract: [] };
    const html = renderToStaticMarkup(<MemoryRouter><ContractsPage doctype="Contract Request" /></MemoryRouter>); await data.queryFn?.();
    expect(data.list).toHaveBeenLastCalledWith("Contract Request");
    for (const value of ["Pending CLM Requests: 1", "RFQ-NEW", "Request for production steel", "Procurement Team", "Open request", "Department", "Production", "Requester", "buyer@example.test", "Contract Required", ">Yes</dd>", "Not yet awarded"]) expect(html).toContain(value);
    expect(html).toContain('href="/contract-requests/CR-NEW-RFQ"'); expect(html).toContain('>Pending</span>'); expect(html).toContain('>Procurement</td>');
    expect(html).not.toContain("Pending Procurement Team"); expect(html).not.toContain("Pending Legal Review"); expect(html).not.toContain("AWARD-");
    expect(html).not.toContain("USD 0");
    expect(html).not.toContain("Review &amp; Create Contract");
    expect(render()).toContain("No contracts match this view"); expect(render()).not.toContain("CR-NEW-RFQ");
  });
});
