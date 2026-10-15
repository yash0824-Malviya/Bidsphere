import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import PendingClmRequestsCard from "./PendingClmRequestsCard";
import type { ClmRecord } from "../../api/clm";

vi.mock("../../api/clm", () => ({ clmRecordRoute: (_doctype: string, name: string) => `/contract-requests/${encodeURIComponent(name)}` }));
function row(name: string, phase = "procurement_team"): ClmRecord {
  return { name, supplier: "FEMSA", contract_value: 2600, currency: "USD", custom_rfq: "PUR-RFQ-2026-00094", request_status: phase === "contract_created" ? "Completed" : "Draft", custom_clm_data: JSON.stringify({
    schema: 1, approvals: [{ role: "procurement_team", stage: 0, status: "Pending" }],
    rfq_source: { rfq: "PUR-RFQ-2026-00094", award: "AWARD-94" }, rfq_request_workflow: { version: 1, phase, assigned_role: "procurement_team" },
  }) };
}
const render = (records: ClmRecord[], error?: unknown) => renderToStaticMarkup(<MemoryRouter><PendingClmRequestsCard records={records} error={error} /></MemoryRouter>);
describe("Procurement Team pending CLM dashboard actions", () => {
  it("counts persisted Team requests and links to the actual request record", () => {
    const html = render([row("CR-94"), row("CR-CONVERTED", "contract_created"), { name: "CR-UNASSIGNED", custom_rfq: "RFQ-OTHER", request_status: "Draft" }]);
    expect(html).toContain("Pending CLM Requests"); expect(html).toContain('tabular-nums">1</span>');
    expect(html).toContain('href="/contract-requests/CR-94"'); expect(html).toContain("Review &amp; Create Contract");
    expect(html).toContain("Pending Procurement Team"); expect(html).toContain("FEMSA");
    expect(html).toContain("Award: AWARD-94"); expect(html).toContain("Award Value: USD 2,600"); expect(html).toContain("Contract Request: CR-94"); expect(html).toContain("Current Stage: Pending Procurement Team");
    expect(html).not.toContain("CR-CONVERTED"); expect(html).not.toContain("CR-UNASSIGNED");
  });
  it("preserves a zero award and does not invent missing award amounts", () => {
    expect(render([{ ...row("CR-ZERO"), contract_value: 0 }])).toContain("Award Value: USD 0");
    for (const contract_value of [undefined, "", "invalid"]) expect(render([{ ...row("CR-MISSING"), contract_value }])).toContain("Award Value: —");
  });
  it("shows a backend failure without reporting a false empty queue", () => {
    const html = render([], new Error("ERPNext is unavailable. Retry after reconnecting."));
    expect(html).toContain('role="alert"'); expect(html).toContain("ERPNext is unavailable");
    expect(html).not.toContain("No CLM requests"); expect(html).toContain('tabular-nums">—</span>');
  });
  it("counts an initial RFQ request before supplier selection using its persisted Team assignment", () => {
    const request = { name: "CR-NEW", custom_rfq: "RFQ-NEW", department: "Production", requester: "buyer@example.test", request_status: "Pending Review", contract_value: 0, currency: "USD", custom_clm_data: JSON.stringify({
      rfq_source: { rfq: "RFQ-NEW", stage: "rfq_created", contract_required: true },
      rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team", status: "Pending", current_stage: "Procurement" },
      approvals: [{ role: "procurement_team", stage: 0, status: "Pending" }],
    }) };
    const html = render([request]);
    expect(html).toContain('tabular-nums">1</span>'); expect(html).toContain('href="/contract-requests/CR-NEW"');
    expect(html).toContain("Current Stage: Procurement"); expect(html).toContain("Award: Pending"); expect(html).toContain("Award Value: —");
    for (const value of ["Not yet awarded", "Department: Production", "Requester: buyer@example.test", "Contract Required: Yes", "Status: Pending", "Open request"]) expect(html).toContain(value);
    expect(html).not.toContain("Review &amp; Create Contract");
    expect(html).not.toContain("Pending Procurement Team"); expect(html).not.toContain("FEMSA"); expect(html).not.toContain("CON-");
    expect(html).not.toContain("USD 0");
  });
});
