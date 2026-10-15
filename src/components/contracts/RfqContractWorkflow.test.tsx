import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RfqContractWorkflow, { rfqContractPhase } from "./RfqContractWorkflow";
import { contractKpis } from "../../pages/contracts/ContractsPage";

const record = (phase: string) => ({ name: "CON-93", custom_rfq: "RFQ-93", custom_clm_data: JSON.stringify({ rfq_source: { contract_required: true }, rfq_workflow: { version: 1, phase } }) });
describe("RFQ contract sequential ownership presentation", () => {
  it.each([["draft", "Procurement Team"], ["legal_review", "Legal Manager"], ["signature", "Legal Manager"], ["finance_review", "Finance Manager"], ["procurement", "Procurement Team"], ["rejected", "Procurement Team"]])("shows %s ownership without manufacturing actions", (phase, owner) => {
    const html = renderToStaticMarkup(<RfqContractWorkflow record={record(phase)} />);
    expect(html).toMatch(new RegExp(`Current responsibility</dt><dd[^>]*>${owner}</dd>`));
    expect(html).not.toContain("<button"); expect(html).not.toContain("Procurement Manager");
  });
  it("renders a compact complete route with one CURRENT and one NEXT marker at signatures", () => {
    const html = renderToStaticMarkup(<RfqContractWorkflow record={record("signature")} />);
    expect(html).toContain("Pending Signatures"); expect(html).toContain("Responsible: Finance Manager");
    expect(html).toContain('data-phase="draft" data-state="completed"');
    expect(html).toContain('data-phase="legal_review" data-state="completed"');
    expect(html).toContain('data-phase="signature" data-state="current" aria-current="step"');
    expect(html).toContain('data-phase="finance_review" data-state="next"');
    expect(html).toContain('data-phase="procurement" data-state="upcoming"');
    expect(html).toContain('data-phase="completed" data-state="upcoming"');
    expect(html.match(/>CURRENT</g)).toHaveLength(1); expect(html.match(/>NEXT</g)).toHaveLength(1);
    expect(html).toContain('aria-live="polite"'); expect(html).not.toContain("min-w-[");
  });
  it("moves the highlight through Finance, Procurement and Completed when the saved record changes", () => {
    for (const [phase, status, next] of [["finance_review", "Pending Finance Approval", "procurement"], ["procurement", "Pending Procurement Finalization", "completed"], ["completed", "Completed", ""]]) {
      const html = renderToStaticMarkup(<RfqContractWorkflow record={record(phase)} />);
      expect(html).toContain(status); expect(html).toContain(`data-phase="${phase}" data-state="current" aria-current="step"`);
      if (next) expect(html).toContain(`data-phase="${next}" data-state="next"`);
      else { expect(html).not.toContain(">NEXT<"); expect(html).toContain("No further stages"); expect(html).toContain("None / Completed"); }
    }
  });
  it("keeps standalone contracts and unversioned evidence on the existing presentation", () => {
    expect(renderToStaticMarkup(<RfqContractWorkflow record={{ name: "CON-1" }} />)).toBe("");
    expect(rfqContractPhase({ ...record("draft"), custom_rfq: "" })).toBeUndefined();
    expect(rfqContractPhase({ ...record("draft"), custom_clm_data: "{" })).toBeUndefined();
    expect(rfqContractPhase(record("invalid"))).toBeUndefined();
    expect(rfqContractPhase({ ...record("draft"), custom_clm_data: JSON.stringify({ rfq_source: { contract_required: false }, rfq_workflow: { version: 1, phase: "draft" } }) })).toBe("draft");
    expect(rfqContractPhase({ name: "CON-OLD", custom_rfq: "RFQ-OLD", custom_contract_status: "Under Review" })).toBe("legal_review");
  });
  it("counts Pending Legal and Pending Finance in review metrics and preserves existing statuses", () => {
    const rows = ["Draft", "Under Review", "Pending Approval", "Pending Legal", "Pending Finance", "Pending Signature", "Active"].map(custom_contract_status => ({ name: custom_contract_status, custom_contract_status }));
    const metrics = Object.fromEntries(contractKpis(rows));
    expect(metrics["Pending review / approval"]).toBe(4);
    expect(metrics["Draft"]).toBe(1); expect(metrics["Pending signatures"]).toBe(1); expect(metrics["Active"]).toBe(1);
  });
});
