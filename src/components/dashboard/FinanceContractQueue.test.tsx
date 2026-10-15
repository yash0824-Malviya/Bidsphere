import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import FinanceContractQueue from "./FinanceContractQueue";
import type { ClmRecord } from "../../api/clm";

vi.mock("../../api/clm", () => ({ clmRecordRoute: (_doctype: string, name: string) => `/contracts/${encodeURIComponent(name)}` }));
function row(name: string, phase = "finance_review", status = "Pending Finance"): ClmRecord {
  return { name, custom_supplier: "Atlantic Precision Manufacturing", custom_rfq: "RFQ-104", custom_contract_status: status, custom_current_version: "1.0", custom_clm_data: JSON.stringify({
    rfq_workflow: { version: 1, phase }, rfq_source: { award: "AWARD-27" },
    signatures: [{ party: "inteva", version: "1.0", file_id: "SIGNED-LEGAL" }],
  }) };
}
const render = (records: ClmRecord[], error?: unknown, loading = false) => renderToStaticMarkup(<MemoryRouter><FinanceContractQueue records={records} loading={loading} error={error} /></MemoryRouter>);

describe("Finance contract queue from persisted CLM state", () => {
  it("includes the Finance handoff while supplier signature is pending and links to the same Contract", () => {
    const saved = row("CON-2026-00001"), before = structuredClone(saved);
    const html = render([saved]);
    expect(html).toContain('tabular-nums">1</span>');
    for (const value of ["CON-2026-00001", "Atlantic Precision Manufacturing", "RFQ: RFQ-104", "Award: AWARD-27", "Pending Finance Approval", "Responsible: Finance Manager"]) expect(html).toContain(value);
    expect(html).toContain('href="/contracts/CON-2026-00001"');
    expect(html).toContain("Review Contract");
    expect(html).not.toContain("<button");
    expect(saved).toEqual(before);
  });
  it("does not invent a Finance task from a Legal signature before the saved phase transitions", () => {
    const html = render([row("CON-SIGNATURE", "signature", "Pending Signature"), row("CON-LEGAL", "legal_review", "Pending Legal"), row("CON-PO", "procurement", "Executed"), row("CON-STALE", "finance_review", "Pending Signature"), { ...row("CON-STANDALONE"), custom_rfq: "" }]);
    expect(html).toContain('tabular-nums">0</span>');
    expect(html).toContain("No contracts are awaiting Finance Approval.");
    for (const name of ["CON-SIGNATURE", "CON-LEGAL", "CON-PO", "CON-STALE", "CON-STANDALONE"]) expect(html).not.toContain(name);
  });
  it("excludes cancelled and termination-paused records", () => {
    const cancelled = { ...row("CON-CANCELLED"), docstatus: 2 };
    const terminated = row("CON-TERMINATION"); const data = JSON.parse(String(terminated.custom_clm_data));
    data.termination = { reason: "Termination under review" }; terminated.custom_clm_data = JSON.stringify(data);
    expect(render([cancelled, terminated])).toContain('tabular-nums">0</span>');
  });
  it("shows service failures and loading without falsely reporting an empty queue", () => {
    const error = render([], new Error("ERPNext unavailable"));
    expect(error).toContain('role="alert"'); expect(error).toContain("ERPNext unavailable");
    expect(error).not.toContain("No contracts are awaiting"); expect(error).toContain('tabular-nums">—</span>');
    const loading = render([], undefined, true);
    expect(loading).toContain("Loading contracts awaiting"); expect(loading).not.toContain("No contracts are awaiting");
  });
});
