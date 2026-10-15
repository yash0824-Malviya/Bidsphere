import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ role: "procurement" }));
vi.mock("../../store/authStore", () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { role: auth.role } }) }));
import ClmSourceTraceability, { RfqSourceDocuments } from "./ClmSourceTraceability";

describe("RFQ Contract Request source traceability", () => {
  beforeEach(() => { auth.role = "procurement"; });
  it("exposes persisted source documents through the existing RFQ page, never a raw attachment URL", () => {
    const record = { name: "CR-1", custom_rfq: "RFQ/1", custom_clm_data: JSON.stringify({ source_documents: [{ file_id: "FILE-1", file_name: "supplier terms.pdf", source_doctype: "Supplier Quotation", source_name: "SQ-1", source_path: "https://untrusted.invalid/private.pdf", file_url: "/private/files/terms.pdf" }] }) };
    const html = renderToStaticMarkup(<MemoryRouter><ClmSourceTraceability record={record} /></MemoryRouter>);
    expect(html).toContain("Source traceability"); expect(html).toContain("supplier terms.pdf"); expect(html).toContain("SQ-1");
    expect(html).toContain("/sourcing/rfq/RFQ%2F1"); expect(html).not.toContain("untrusted.invalid"); expect(html).not.toContain("/private/files");
  });
  it("keeps a legacy RFQ reference accessible when runtime metadata is absent or malformed", () => {
    const html = renderToStaticMarkup(<MemoryRouter><ClmSourceTraceability record={{ name: "CR-1", custom_rfq: "RFQ-1", custom_clm_data: "invalid" }} /></MemoryRouter>);
    expect(html).toContain("/sourcing/rfq/RFQ-1"); expect(html).not.toContain("Source supporting documents");
  });
  it("does not add RFQ sections to unrelated Contract Requests", () => {
    expect(renderToStaticMarkup(<MemoryRouter><ClmSourceTraceability record={{ name: "CR-1" }} /></MemoryRouter>)).toBe("");
  });
  it("gives Procurement Team source links for its RFQ CLM handoff", () => {
    auth.role = "procurement_team";
    const record = { name: "CR-1", custom_rfq: "RFQ-1", custom_clm_data: JSON.stringify({ source_documents: [{ file_id: "FILE-1", file_name: "terms.pdf", source_doctype: "Supplier Quotation", source_name: "SQ-1" }] }) };
    const html = renderToStaticMarkup(<MemoryRouter><ClmSourceTraceability record={record} /></MemoryRouter>);
    expect(html).toContain("RFQ-1"); expect(html).toContain("terms.pdf"); expect(html).toContain("SQ-1"); expect(html).toContain('href="/sourcing/rfq/RFQ-1"');
  });
  it("shows optional saved award context on an initial Request without creating or changing its links", () => {
    auth.role = "procurement_team";
    const record = { name: "CR-INITIAL", custom_rfq: "RFQ-1", custom_clm_data: JSON.stringify({ rfq_source: { rfq: "RFQ-1", stage: "rfq_created", contract_required: true, available_award: { award: "AWARD-1", quotation: "SQ-1", supplier: "Supplier One", currency: "USD", amount: 30, company: "Netlink" } } }) };
    const before = structuredClone(record), html = renderToStaticMarkup(<MemoryRouter><ClmSourceTraceability record={record} /></MemoryRouter>);
    for (const value of ["RFQ-1", "AWARD-1", "SQ-1", "Supplier One", "USD 30", "Netlink"]) expect(html).toContain(value);
    expect(html).toContain('href="/sourcing/rfq/RFQ-1"'); expect(html).not.toContain('href="/contracts/');
    expect(record).toEqual(before);
  });
  it("renders clean rows with document type, source record, status, and Preview/Download actions", () => {
    const docs = [
      {
        file_id: "FILE-SPEC",
        file_name: "RFQ_Specification.pdf",
        document_type: "RFQ Specification",
        source_doctype: "Request for Quotation",
        source_name: "PUR-RFQ-2026-00108",
        file_url: "/private/files/RFQ_Specification.pdf",
        status: "Available",
      },
      {
        file_id: "FILE-MISSING",
        file_name: "Old_Drawing.pdf",
        document_type: "Engineering Drawing",
        source_doctype: "Request for Quotation Item",
        source_name: "ROW-001",
        file_url: "",
        status: "Unavailable",
      },
    ];
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RfqSourceDocuments rfq="PUR-RFQ-2026-00108" documents={docs} />
      </MemoryRouter>
    );
    expect(html).toContain("RFQ_Specification.pdf");
    expect(html).toContain("RFQ Specification");
    expect(html).toContain("PUR-RFQ-2026-00108");
    expect(html).toContain("Available");
    expect(html).toContain("Old_Drawing.pdf");
    expect(html).toContain("Engineering Drawing");
    expect(html).toContain("ROW-001");
    expect(html).toContain("File unavailable");
    expect(html).toContain("Preview");
    expect(html).toContain("Download");
  });
  it("shows the expected empty message when no supporting documents exist", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RfqSourceDocuments
          rfq="PUR-RFQ-2026-00108"
          documents={[]}
          emptyMessage="No supporting documents available for this contract request."
        />
      </MemoryRouter>
    );
    expect(html).toContain("No supporting documents available for this contract request.");
  });
  it("filters out PO documents mislabeled under Supplier Quotation in ClmSourceTraceability", () => {
    const record = {
      name: "CTRQ-2026-0007",
      custom_rfq: "PUR-RFQ-2026-00108",
      custom_clm_data: JSON.stringify({
        source_documents: [
          {
            file_id: "PO-30",
            file_name: "PO_PUR-ORD-2026-00030.pdf",
            source_doctype: "Supplier Quotation",
            source_name: "PUR-SQTN-2026-00288",
          },
        ],
      }),
    };
    const html = renderToStaticMarkup(<MemoryRouter><ClmSourceTraceability record={record} /></MemoryRouter>);
    expect(html).not.toContain("PO_PUR-ORD-2026-00030.pdf");
  });
});

