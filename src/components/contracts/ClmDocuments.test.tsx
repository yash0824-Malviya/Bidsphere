import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ClmDocuments, { contractSourceDocuments, historicalContractDocuments } from "./ClmDocuments";
import type { ClmSignature } from "../../types/clm";

const source = { file_id: "TERMS", file_name: "supplier terms.pdf", source_doctype: "Supplier Quotation", source_name: "SQ-93", source_path: "https://untrusted.test/terms.pdf" };
const record = { name: "CON-93", custom_rfq: "RFQ-93", custom_clm_data: JSON.stringify({ source_documents: [source] }) };
describe("RFQ source evidence in Contract Documents", () => {
  it("shows inherited source documents with Contract-scoped preview and download controls", () => {
    const html = renderToStaticMarkup(<ClmDocuments doctype="Contract" record={record} fields={[]} />);
    expect(html).toContain("RFQ award supporting document"); expect(html).toContain("supplier terms.pdf");
    expect(html).toContain("Preview"); expect(html).toContain("Download"); expect(html).not.toContain("untrusted.test"); expect(html).not.toContain("No documents are attached");
  });
  it("does not reveal internal source evidence when runtime data is absent from a supplier projection", () => {
    expect(contractSourceDocuments({ name: "CON-93", custom_rfq: "RFQ-93" })).toEqual([]);
    expect(contractSourceDocuments({ ...record, custom_clm_data: "invalid" })).toEqual([]);
  });
  const receipt: ClmSignature = { party: "inteva", role: "legal", by: "legal@example.test", typed_name: "Legal Reviewer", at: "2026-09-28 12:00:00", version: "1.0", file_id: "SIGNED-PDF", file_url: "https://untrusted.test/signed-contract.pdf", hash: "a".repeat(64) };
  it("shows the original and persisted signed document with signer, time and protected controls", () => {
    const html = renderToStaticMarkup(<ClmDocuments doctype="Contract" record={{ ...record, custom_final_version_locked: 1 }} fields={[]} signatures={[receipt]} />);
    for (const value of ["Original Contract", "Signed Contract — Legal Manager", "Status:", ">Signed</dd>", "Signed By:", "Legal Reviewer", "legal@example.test", "Signed At:", "2026-09-28 12:00:00", ">View</button>", ">Download</button>"]) expect(html).toContain(value);
    expect(html).toMatch(/Status: <span[^>]*>Original<\/span>/);
    expect(html).not.toContain("untrusted.test");
    expect(html).toContain("Current Contract PDF"); expect(html).toContain("View Contract PDF");
    expect(html).toContain("Authoritative version 1.0");
  });
  it("does not advertise an authoritative generated PDF on a draft without locked evidence", () => {
    const html = renderToStaticMarkup(<ClmDocuments doctype="Contract" record={{ name: "CON-DRAFT", custom_current_version: "2.0" }} fields={[]} />);
    expect(html).not.toContain("View Contract PDF"); expect(html).not.toContain("Original Contract");
    expect(html).toContain("No documents are attached");
  });
  it("displays the captured legal identity separately from the typed signature text while retaining the authenticated signer", () => {
    const html = renderToStaticMarkup(<ClmDocuments doctype="Contract" record={record} fields={[]} signatures={[{ ...receipt, full_legal_name: "Robert Legal Reviewer", typed_name: "R. L. Reviewer", signature_method: "typed", signature_adopted: true }]} />);
    expect(html).toContain("Legal Manager · Robert Legal Reviewer (legal@example.test)");
    expect(html).not.toContain("R. L. Reviewer"); expect(html).toContain("2026-09-28 12:00:00");
    expect(html).toContain(">View</button>"); expect(html).toContain(">Download</button>");
  });
  it("provides compact signed Contract controls without unrelated source attachments", () => {
    const html = renderToStaticMarkup(<ClmDocuments doctype="Contract" record={record} fields={[]} signatures={[receipt]} signedOnly />);
    expect(html).toContain("Signed Document: Available"); expect(html).toContain("View Signed Contract"); expect(html).toContain("Download");
    expect(html).not.toContain("supplier terms.pdf"); expect(html).not.toContain("Original Contract");
  });
  it("preserves Company signer naming for standalone non-Legal receipts", () => {
    const html = renderToStaticMarkup(<ClmDocuments doctype="Contract" record={{ name: "CON-STANDALONE" }} fields={[]} signatures={[{ ...receipt, role: "procurement" }]} />);
    expect(html).toContain("Signed Contract — Company"); expect(html).not.toContain("Legal Manager");
  });
  it("keeps archived original and signed versions explicitly historical without implying the current version is signed", () => {
    const saved = { ...record, custom_current_version: "2.0", custom_final_version_locked: 0, custom_clm_data: JSON.stringify({ versions: [{ id: "revision-1", number: "1.0", author: "team@example.test", at: "2026-09-27 10:00:00" }], signatures: [], review_history: [{ version: "revision-1", locked_file: { file_id: "OLD-ORIGINAL", file_url: "/private/files/old.pdf" }, signatures: [receipt] }] }) };
    const html = renderToStaticMarkup(<ClmDocuments doctype="Contract" record={saved} fields={[]} />);
    expect(html).toContain("Historical Original Contract — Version 1.0"); expect(html).toContain("Historical Signed Contract — Version 1.0");
    expect(html).toContain("Legal Reviewer"); expect(html).not.toContain("untrusted.test"); expect(html).not.toContain("View Contract PDF");
    const compact = renderToStaticMarkup(<ClmDocuments doctype="Contract" record={saved} fields={[]} signedOnly />);
    expect(compact).not.toContain("Signed Document: Available"); expect(compact).not.toContain("Historical");
    expect(historicalContractDocuments({ name: "CON-SUPPLIER-PROJECTION" })).toEqual([]);
  });
});
