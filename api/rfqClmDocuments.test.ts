import { describe, expect, it, vi } from "vitest";
import { ClmError, type ClmDeps } from "./clmCore";
import { collectRfqAwardDocuments } from "./rfqClmDocuments";
import type { ClmRecord } from "../src/types/clm";

function fixture() {
  const rfq: ClmRecord = { name: "PUR-RFQ-2026-00093", items: [] };
  const quotation: ClmRecord = { name: "PUR-SQTN-2026-00263", supplier: "Apex Fasteners Ltd", items: [{ request_for_quotation: rfq.name }] };
  const review: ClmRecord = { name: "LDC2026-00024", rfq_name: rfq.name, sq_name: quotation.name, supplier: quotation.supplier };
  const supplier: ClmRecord = { name: String(quotation.supplier) };
  const files: ClmRecord[] = [];
  const records = new Map<string, ClmRecord>();
  const deps: ClmDeps = {
    load: vi.fn(async (dt, name) => { const record = records.get(`${dt}/${name}`); if (!record) throw new ClmError("Not found", 404); return record; }),
    list: vi.fn(async (dt, filters = []) => dt === "File" ? files.filter(file => filters.every(raw => {
      const [field, , value] = raw as string[];
      return file[field] === value;
    })) : []),
    create: vi.fn(), save: vi.fn(), now: () => "2026-09-21 12:00:00",
  };
  const file = (id: string, doctype: string, name: unknown, path: string, patch: ClmRecord = {}) => {
    files.push({ name: id, file_name: path.split("/").at(-1), file_url: path, attached_to_doctype: doctype, attached_to_name: name, is_folder: 0, ...patch });
  };
  return { rfq, quotation, review, supplier, files, records, deps, file, collect: () => collectRfqAwardDocuments({ rfq, quotation, review, supplier }, deps) };
}

describe("RFQ award supporting document provenance", () => {
  it("collects current RFQ engineering, winning supplier and award documents without copying them", async () => {
    const m = fixture();
    m.rfq.custom_2d_drawing = "/private/files/drawing.pdf";
    m.quotation.custom_terms__condition = "/private/files/terms.pdf";
    m.review.esign_signed_file_url = "/private/files/approved-terms.pdf";
    m.file("RFQ-FILE", "Request for Quotation", m.rfq.name, String(m.rfq.custom_2d_drawing));
    m.file("SQ-FILE", "Supplier Quotation", m.quotation.name, String(m.quotation.custom_terms__condition));
    m.file("AWARD-FILE", "Legal Document Review", m.review.name, String(m.review.esign_signed_file_url));
    const result = await m.collect();
    expect(result.documents.map(row => row.file_id)).toEqual(["RFQ-FILE", "SQ-FILE", "AWARD-FILE"]);
    expect(result.documents[1]).toMatchObject({ source_doctype: "Supplier Quotation", source_name: m.quotation.name, source_path: `/sourcing/rfq/${m.rfq.name}` });
    expect(result.warnings).toEqual([]);
    expect(m.deps.create).not.toHaveBeenCalled(); expect(m.deps.save).not.toHaveBeenCalled();
  });

  it("omits the actual RFQ 93 wrong RFQ 91 PDF and payment report despite occupied attachment slots", async () => {
    const m = fixture();
    m.quotation.custom_terms__condition = m.quotation.custom_insurance_certificate = "/private/files/RFQ_PUR-RFQ-2026-00091.pdf";
    m.quotation.custom_warenty_certificate = "/private/files/Payments_Report_2026-06-07 (1).pdf";
    m.review.terms_file_url = m.review.insurance_file_url = m.quotation.custom_terms__condition;
    m.review.warranty_file_url = m.quotation.custom_warenty_certificate;
    for (let index = 0; index < 4; index++) m.file(`WRONG-RFQ-${index}`, "Supplier Quotation", m.quotation.name, String(m.quotation.custom_terms__condition), { attached_to_field: index % 2 ? "custom_terms__condition" : null, content_hash: "same-rfq-bytes" });
    for (let index = 0; index < 2; index++) m.file(`PAYMENTS-${index}`, "Supplier Quotation", m.quotation.name, String(m.quotation.custom_warenty_certificate), { attached_to_field: index ? "custom_warenty_certificate" : null, content_hash: `different-hash-${index}` });
    const result = await m.collect();
    expect(result.documents).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(" ")).toMatch(/another RFQ/);
    expect(result.warnings.join(" ")).toMatch(/payment, invoice or banking report/);
  });

  it("keeps RFQ 95 evidence while excluding RFQ 91 and payment reports without changing source records", async () => {
    const m = fixture();
    m.rfq.name = "PUR-RFQ-2026-00095";
    m.quotation.name = "PUR-SQTN-2026-00270";
    m.quotation.supplier = m.supplier.name = '"Blue Ridge Manufacturing Inc"';
    m.quotation.items = [{ request_for_quotation: m.rfq.name }];
    m.review.name = "LDC2026-00026";
    m.review.rfq_name = m.rfq.name;
    m.review.sq_name = m.quotation.name;
    m.review.supplier = m.quotation.supplier;
    m.quotation.custom_terms__condition = "/private/files/RFQ_PUR-RFQ-2026-00091.pdf";
    m.quotation.custom_warenty_certificate = "/private/files/specification_PUR-RFQ-2026-00095_PUR-SQTN-2026-00270.pdf";
    m.quotation.custom_insurance_certificate = "/private/files/Payments_Report_2026-06-07.pdf";
    m.file("FOREIGN-RFQ", "Supplier Quotation", m.quotation.name, String(m.quotation.custom_terms__condition));
    m.file("CURRENT-EVIDENCE", "Supplier Quotation", m.quotation.name, String(m.quotation.custom_warenty_certificate));
    m.file("PAYMENT-REPORT", "Supplier Quotation", m.quotation.name, String(m.quotation.custom_insurance_certificate));
    const before = JSON.stringify([m.rfq, m.quotation, m.review, m.supplier, m.files]);

    const result = await m.collect();

    expect(result.documents).toEqual([expect.objectContaining({
      file_id: "CURRENT-EVIDENCE", source_doctype: "Supplier Quotation",
      source_name: "PUR-SQTN-2026-00270", source_path: "/sourcing/rfq/PUR-RFQ-2026-00095",
    })]);
    expect(Object.keys(result.filePaths)).toEqual(["CURRENT-EVIDENCE"]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(" ")).toMatch(/another RFQ/);
    expect(result.warnings.join(" ")).toMatch(/payment, invoice or banking report/);
    expect(JSON.stringify([m.rfq, m.quotation, m.review, m.supplier, m.files])).toBe(before);
    expect(m.deps.create).not.toHaveBeenCalled();
    expect(m.deps.save).not.toHaveBeenCalled();
  });

  it("deduplicates equivalent files by canonical URL and content hash across verified source parents", async () => {
    const m = fixture();
    m.rfq.custom_engineering_attachments = JSON.stringify([{ fileUrl: "/private/files/same document.pdf" }]);
    m.quotation.custom_terms__condition = "/private/files/same%20document.pdf";
    m.quotation.custom_insurance_certificate = "/private/files/copy.pdf";
    m.file("ORIGINAL", "Request for Quotation", m.rfq.name, "/private/files/same document.pdf", { content_hash: "same-content" });
    m.file("URL-COPY", "Supplier Quotation", m.quotation.name, "/private/files/same%20document.pdf", { content_hash: "same-content" });
    m.file("HASH-COPY", "Supplier Quotation", m.quotation.name, "/private/files/copy.pdf", { content_hash: "same-content" });
    expect((await m.collect()).documents.map(row => row.file_id)).toEqual(["ORIGINAL"]);
  });

  it("follows only exact submitted Material Request rows preserved by RFQ item lineage", async () => {
    const m = fixture();
    m.rfq.items = [{ name: "RFQ-ITEM", item_code: "STEEL", material_request: "MR-1", material_request_item: "MR-ITEM", custom_engineering_attachments: JSON.stringify([{ fileUrl: "/private/files/spec.pdf" }]) }];
    m.records.set("Material Request/MR-1", { name: "MR-1", docstatus: 1, items: [{ name: "MR-ITEM", item_code: "STEEL", custom_2d_drawing: "/private/files/technical.pdf" }, { name: "OTHER-ITEM", item_code: "BOLT", custom_2d_drawing: "/private/files/unrelated.pdf" }] });
    m.file("SPEC", "Request for Quotation Item", "RFQ-ITEM", "/private/files/spec.pdf");
    m.file("TECH", "Material Request Item", "MR-ITEM", "/private/files/technical.pdf");
    m.file("OTHER", "Material Request Item", "OTHER-ITEM", "/private/files/unrelated.pdf");
    expect((await m.collect()).documents.map(row => row.file_id)).toEqual(["SPEC", "TECH"]);
    expect(m.deps.list).not.toHaveBeenCalledWith("File", expect.arrayContaining([["attached_to_name", "=", "OTHER-ITEM"]]));
  });

  it("does not load other supplier files, other quotations, or unrelated parent attachments", async () => {
    const m = fixture(); m.quotation.custom_terms__condition = "/private/files/terms.pdf";
    m.file("FOREIGN", "Supplier Quotation", "SQ-OTHER", "/private/files/terms.pdf");
    m.file("GLOBAL", "Supplier", m.supplier.name, "/private/files/terms.pdf");
    // Even a faulty list adapter returning unrelated metadata cannot widen scope.
    m.deps.list = vi.fn(async () => m.files);
    expect((await m.collect()).documents).toEqual([]);
    expect(vi.mocked(m.deps.list).mock.calls.every(([dt, filters]) => dt === "File" && !JSON.stringify(filters).includes('"Supplier"'))).toBe(true);
  });

  it("does not infer approval or purpose from an arbitrary filename and omits replaced uploads", async () => {
    const m = fixture(); m.quotation.custom_terms__condition = "/private/files/current.pdf";
    m.file("CURRENT", "Supplier Quotation", m.quotation.name, "/private/files/current.pdf");
    m.file("OLD", "Supplier Quotation", m.quotation.name, "/private/files/old.pdf", { attached_to_field: "custom_terms__condition" });
    m.file("UNKNOWN", "Request for Quotation", m.rfq.name, "/private/files/approved-procurement.pdf");
    const result = await m.collect(); expect(result.documents.map(row => row.file_id)).toEqual(["CURRENT"]);
    expect(result.warnings).toHaveLength(2);
  });

  it("allows payment terms and filenames identifying the current RFQ when source-linked", async () => {
    const m = fixture(); m.quotation.custom_terms__condition = "/private/files/payment_terms_PUR-RFQ-2026-00093.pdf";
    m.file("TERMS", "Supplier Quotation", m.quotation.name, String(m.quotation.custom_terms__condition));
    expect((await m.collect()).documents.map(row => row.file_id)).toEqual(["TERMS"]);
  });

  it.each(["quotation", "supplier", "review"])("rejects inconsistent %s context before listing files", async source => {
    const m = fixture();
    if (source === "quotation") m.quotation.items = [{ request_for_quotation: "RFQ-OTHER" }];
    if (source === "supplier") m.supplier.name = "Other Supplier";
    if (source === "review") m.review.sq_name = "OTHER-SQ";
    await expect(m.collect()).rejects.toMatchObject({ status: 409 }); expect(m.deps.list).not.toHaveBeenCalled();
  });

  it("preserves original source permissions and warns when optional MR provenance is unavailable", async () => {
    const m = fixture(); m.rfq.items = [{ name: "RFQ-ITEM", material_request: "MR-MISSING", material_request_item: "ROW" }];
    const result = await m.collect(); expect(result.documents).toEqual([]); expect(result.warnings).toEqual(["Supporting documents from Material Request MR-MISSING could not be verified."]);
  });

  it("ignores external URLs, folders and malformed engineering metadata", async () => {
    const m = fixture(); m.rfq.custom_engineering_attachments = "invalid JSON"; m.quotation.custom_terms__condition = "https://elsewhere.test/private/files/terms.pdf";
    m.file("EXTERNAL", "Supplier Quotation", m.quotation.name, String(m.quotation.custom_terms__condition));
    m.quotation.custom_warenty_certificate = "/private/files/folder";
    m.file("FOLDER", "Supplier Quotation", m.quotation.name, String(m.quotation.custom_warenty_certificate), { is_folder: 1 });
    expect((await m.collect()).documents).toEqual([]);
  });

  it("excludes Purchase Order PDFs mistakenly attached to a Supplier Quotation when PO is unverified", async () => {
    const m = fixture();
    m.quotation.custom_terms__condition = "/private/files/PO_PUR-ORD-2026-00030.pdf";
    m.quotation.custom_warenty_certificate = "/private/files/PO_PUR-ORD-2026-00027.pdf";
    m.file("PO-30", "Supplier Quotation", m.quotation.name, String(m.quotation.custom_terms__condition));
    m.file("PO-27", "Supplier Quotation", m.quotation.name, String(m.quotation.custom_warenty_certificate));
    const result = await m.collect();
    expect(result.documents).toEqual([]);
    expect(result.warnings.some(w => w.includes("Purchase Order documents cannot be labeled as Supplier Quotation attachments"))).toBe(true);
  });

  it("correctly reclassifies verified Purchase Order attachments under Purchase Order without false exclusion warnings", async () => {
    const m = fixture();
    const po: ClmRecord = {
      name: "PUR-ORD-2026-00030",
      supplier: m.supplier.name,
      custom_supplier_quotation: m.quotation.name,
      status: "Submitted",
      docstatus: 1,
    };
    m.records.set("Purchase Order/PUR-ORD-2026-00030", po);
    m.quotation.custom_terms__condition = "/private/files/PO_PUR-ORD-2026-00030.pdf";
    m.file("PO-30", "Supplier Quotation", m.quotation.name, String(m.quotation.custom_terms__condition));
    const result = await collectRfqAwardDocuments({ rfq: m.rfq, quotation: m.quotation, review: m.review, supplier: m.supplier, po }, m.deps);
    expect(result.warnings).toEqual([]);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      file_id: "PO-30",
      file_name: "PO_PUR-ORD-2026-00030.pdf",
      source_doctype: "Purchase Order",
      source_name: "PUR-ORD-2026-00030",
      document_type: "Purchase Order",
      status: "Available",
    });
  });

  it("resolves specific document types, file_url, and status for valid RFQ award documents", async () => {
    const m = fixture();
    m.quotation.custom_terms__condition = "/private/files/supplier_terms.pdf";
    m.quotation.custom_warenty_certificate = "/private/files/supplier_warranty.pdf";
    m.file("TERMS-1", "Supplier Quotation", m.quotation.name, String(m.quotation.custom_terms__condition), { attached_to_field: "custom_terms__condition" });
    m.file("WAR-1", "Supplier Quotation", m.quotation.name, String(m.quotation.custom_warenty_certificate), { attached_to_field: "custom_warenty_certificate" });
    const result = await m.collect();
    expect(result.documents).toHaveLength(2);
    expect(result.documents[0]).toMatchObject({
      file_id: "TERMS-1",
      file_name: "supplier_terms.pdf",
      file_url: "/private/files/supplier_terms.pdf",
      document_type: "Terms & Conditions",
      source_doctype: "Supplier Quotation",
      source_name: m.quotation.name,
      status: "Available",
    });
    expect(result.documents[1]).toMatchObject({
      file_id: "WAR-1",
      file_name: "supplier_warranty.pdf",
      file_url: "/private/files/supplier_warranty.pdf",
      document_type: "Warranty Certificate",
      source_doctype: "Supplier Quotation",
      source_name: m.quotation.name,
      status: "Available",
    });
  });
});

