import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
vi.mock("../../components/contracts/ClmRecordWorkspace", () => ({ default: ({ doctype, name }: { doctype: string; name: string }) => <div data-doctype={doctype} data-name={name}>Record detail</div> }));
import ContractDetailPage from "./ContractDetailPage";
function render(recordType: string) { return renderToStaticMarkup(<MemoryRouter initialEntries={[`/contracts/records/${encodeURIComponent(recordType)}/RELATED-1`]}><Routes><Route path="/contracts/records/:recordType/:name" element={<ContractDetailPage />} /></Routes></MemoryRouter>); }
describe("CLM related-record routes", () => {
  it("opens the canonical Request route with the exact Request ID", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/contract-requests/CTRQ-2026-0002"]}><Routes><Route path="/contract-requests/:name" element={<ContractDetailPage doctype="Contract Request" />} /></Routes></MemoryRouter>);
    expect(html).toContain('data-doctype="Contract Request"'); expect(html).toContain('data-name="CTRQ-2026-0002"');
    expect(html).toContain('href="/contract-requests"'); expect(html).not.toContain('data-doctype="Contract"');
  });
  it.each(["Contract Risk", "Contract Obligation", "Contract Milestone", "Contract Renewal", "Contract Amendment"])("loads the existing %s record", doctype => {
    const html = render(doctype); expect(html).toContain(`data-doctype="${doctype}"`); expect(html).toContain('data-name="RELATED-1"');
  });
  it.each(["User", "Contract Approval Matrix", "Purchase Order"])("does not turn the related route into arbitrary %s access", doctype => {
    const html = render(doctype); expect(html).toContain("Unsupported contract record type"); expect(html).not.toContain("Record detail");
  });
});
