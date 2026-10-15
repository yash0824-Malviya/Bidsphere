import { describe, expect, it, vi } from "vitest";
import type { ClmRecord } from "../src/types/clm";
import { ClmError, parseClmData } from "./clmCore";
import { loadContractPdfContext } from "./clmContractPdfData";

const RFQ = "PUR-RFQ-2026-00104", QUOTE = "PUR-SQTN-2026-00273", AWARD = "LDC2026-00027";
function fixture() {
  const data = parseClmData(null);
  data.rfq_context = { rfq_id: RFQ, quotation_id: QUOTE, award_id: AWARD, supplier_id: "SUP-1" };
  data.rfq_source = { rfq: RFQ, quotation: QUOTE, award: AWARD, supplier: "SUP-1", company: "Netlink", department: "Production" };
  const contract: ClmRecord = { name: "CON-1", custom_rfq: RFQ, custom_supplier_quotation: QUOTE, custom_supplier: "SUP-1", party_name: "SUP-1", custom_contract_request: "REQ-1", custom_contract_value: 4500, custom_currency: "USD", custom_clm_data: JSON.stringify(data) };
  const records = new Map<string, ClmRecord>([
    [`Request for Quotation/${RFQ}`, { name: RFQ, company: "Netlink", status: "Closed", message_for_supplier: "Title: Procurement RFQ - Production\nValid Till: 2026-10-02\n\nRequested goods", items: [{ name: "RFQI-1", item_code: "STEEL-1", qty: 100, material_request: "MR-1", material_request_item: "MRI-1" }, { name: "RFQI-2", item_code: "UNAWARDED", qty: 90 }] }],
    [`Supplier Quotation/${QUOTE}`, { name: QUOTE, modified: "2026-09-28 10:15:00.000001", supplier: "SUP-1", company: "Netlink", currency: "USD", grand_total: 9999, items: [{ name: "QI-1", request_for_quotation: RFQ, item_name: "Cold Rolled Steel", item_code: "STEEL-1", qty: 100, uom: "Kg" }, { name: "QI-OTHER", request_for_quotation: "OTHER", item_name: "Other RFQ item", qty: 900, uom: "Nos" }] }],
    [`Legal Document Review/${AWARD}`, { name: AWARD, rfq_name: RFQ, sq_name: QUOTE, supplier: "SUP-1", company: "Netlink", grand_total: 4500 }],
    ["Contract Request/REQ-1", { name: "REQ-1", custom_rfq: RFQ, custom_supplier_quotation: QUOTE, supplier: "SUP-1", company: "Netlink", department: "Production - N" }],
    ["Supplier/SUP-1", { name: "SUP-1", supplier_name: "Atlantic Precision Manufacturing." }],
  ]);
  const load = vi.fn(async (dt: string, name: string) => {
    const record = records.get(`${dt}/${name}`);
    if (!record) throw new ClmError("Missing fixture document", 404);
    return structuredClone(record);
  });
  const updateData = (update: (data: ReturnType<typeof parseClmData>) => void) => {
    const stored = parseClmData(contract.custom_clm_data); update(stored); contract.custom_clm_data = JSON.stringify(stored);
  };
  return { contract, records, load, updateData };
}

describe("read-only Contract PDF source enrichment", () => {
  it("reads current exact award links without reevaluating closed sourcing stages or substituting quotation totals", async () => {
    const f = fixture(), before = JSON.stringify(f.contract);
    const result = await loadContractPdfContext(f.contract, f.load);
    expect(result).toMatchObject({ company: "Netlink", department: "Production - N", supplierName: "Atlantic Precision Manufacturing.", awardId: AWARD, awardValue: 4500, awardCurrency: "USD", rfqTitle: "Procurement RFQ - Production", rfqValidTill: "2026-10-02", items: [{ item: "Cold Rolled Steel", qty: 100, uom: "Kg" }], documents: [] });
    expect(JSON.stringify(f.contract)).toBe(before);
    expect(f.load.mock.calls.every(([, name]) => !["UNAWARDED", "OTHER"].includes(name))).toBe(true);
  });
  it("preserves the existing RFQ scope without repeating its parsed title or adding source reads", async () => {
    const f = fixture();
    const scope = "1. Supply the specified components.\n\n2. Preserve the agreed inspection requirements.";
    f.records.get(`Request for Quotation/${RFQ}`)!.message_for_supplier = `Title: Approved RFQ title\nValid Till: 2026-10-02\n\n${scope}`;
    const before = JSON.stringify([...f.records]), result = await loadContractPdfContext(f.contract, f.load);
    expect(result.rfqTitle).toBe("Approved RFQ title");
    expect(result.rfqScope).toBe(scope);
    expect(result.rfqValidTill).toBe("2026-10-02");
    expect(f.load).toHaveBeenCalledTimes(5);
    expect(JSON.stringify([...f.records])).toBe(before);
  });
  it.each([undefined, "", "Title: Header only\nValid Till: 2026-10-02\n\n"])("omits RFQ scope when the saved message has no body: %j", async message => {
    const f = fixture();
    f.records.get(`Request for Quotation/${RFQ}`)!.message_for_supplier = message;
    const result = await loadContractPdfContext(f.contract, f.load);
    expect(result).not.toHaveProperty("rfqScope");
  });
  it("does not silently replace the approved Contract value after the linked award changes", async () => {
    const f = fixture(); await loadContractPdfContext(f.contract, f.load);
    f.records.get(`Legal Document Review/${AWARD}`)!.grand_total = 4600;
    await expect(loadContractPdfContext(f.contract, f.load)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("saved final award") });
    expect(f.contract.custom_contract_value).toBe(4500);
  });
  it.each(["EUR", "", undefined])("rejects a Contract currency %j that cannot be reconciled to the award", async currency => {
    const f = fixture(); f.contract.custom_currency = currency;
    await expect(loadContractPdfContext(f.contract, f.load)).rejects.toThrow("saved final award");
  });
  it.each([undefined, "", "invalid", -1, 4499, 4501])("rejects an invalid or different approved Contract amount %j", async amount => {
    const f = fixture(); f.contract.custom_contract_value = amount;
    await expect(loadContractPdfContext(f.contract, f.load)).rejects.toThrow("saved final award");
  });
  it("captures exact item provenance without inventing final award line prices or terms", async () => {
    const f = fixture(), quotation = f.records.get(`Supplier Quotation/${QUOTE}`)!;
    (quotation.items as ClmRecord[])[0].description = "<p>Steel grade as identified in approved drawing.</p>";
    (quotation.items as ClmRecord[])[0].rate = 99.99;
    (quotation.items as ClmRecord[])[0].amount = 9999;
    quotation.terms = "Quotation-only terms must not be introduced into the Contract.";
    const before = JSON.stringify(f.contract), result = await loadContractPdfContext(f.contract, f.load);
    expect(result.items).toEqual([{ item: "Cold Rolled Steel", itemCode: "STEEL-1", description: "<p>Steel grade as identified in approved drawing.</p>", qty: 100, uom: "Kg", sourceQuotation: QUOTE, sourceQuotationItem: "QI-1" }]);
    expect(result.itemSource).toEqual({ doctype: "Supplier Quotation", name: QUOTE, modified: "2026-09-28 10:15:00.000001" });
    expect(result.sourceRecords).toContainEqual({ doctype: "Supplier Quotation", name: QUOTE, modified: "2026-09-28 10:15:00.000001" });
    expect(result.awardValue).toBe(4500);
    expect(JSON.stringify(result)).not.toContain("9999");
    expect(JSON.stringify(result)).not.toContain("Quotation-only terms");
    expect(JSON.stringify(f.contract)).toBe(before);
  });
  it("creates an independent source snapshot for the newly generated PDF", async () => {
    const f = fixture(), result = await loadContractPdfContext(f.contract, f.load);
    (f.records.get(`Supplier Quotation/${QUOTE}`)!.items as ClmRecord[])[0].qty = 50;
    f.records.get(`Supplier Quotation/${QUOTE}`)!.modified = "2026-09-28 11:15:00.000001";
    const next = await loadContractPdfContext(f.contract, f.load);
    expect(result.items[0].qty).toBe(100);
    expect(result.itemSource?.modified).toBe("2026-09-28 10:15:00.000001");
    expect(next.items[0].qty).toBe(50);
    expect(next.itemSource?.modified).toBe("2026-09-28 11:15:00.000001");
  });
  it.each(["context", "award", "quotation", "request"])("rejects foreign %s linkage rather than presenting another record's data", async target => {
    const f = fixture();
    if (target === "context") f.updateData(data => { data.rfq_context = { ...(data.rfq_context as ClmRecord), rfq_id: "OTHER" }; });
    if (target === "award") f.records.get(`Legal Document Review/${AWARD}`)!.sq_name = "OTHER";
    if (target === "quotation") f.records.get(`Supplier Quotation/${QUOTE}`)!.supplier = "OTHER";
    if (target === "request") f.records.get("Contract Request/REQ-1")!.custom_rfq = "OTHER";
    await expect(loadContractPdfContext(f.contract, f.load)).rejects.toThrow("source records disagree");
  });
  it("does not turn a missing award into the original quotation total", async () => {
    const f = fixture(); f.records.delete(`Legal Document Review/${AWARD}`);
    const result = await loadContractPdfContext(f.contract, f.load);
    expect(result.awardValue).toBeUndefined(); expect(result.awardCurrency).toBeUndefined();
    expect(result.items).toHaveLength(1);
  });
  it("keeps legacy standalone Contracts usable without new RFQ requirements or source reads", async () => {
    const load = vi.fn();
    expect(await loadContractPdfContext({ name: "LEGACY", company: "Netlink", department: "Stores" }, load)).toMatchObject({ company: "Netlink", department: "Stores", items: [], documents: [] });
    expect(load).not.toHaveBeenCalled();
  });
  it("supports parent-linked quotation rows and never fills items from unawarded RFQ quantities", async () => {
    const f = fixture(), quotation = f.records.get(`Supplier Quotation/${QUOTE}`)!;
    quotation.request_for_quotation = RFQ;
    quotation.items = [{ item_code: "STEEL-1", qty: "25.5", uom: "Kg" }, { item_code: "INVALID", uom: "Kg" }];
    expect((await loadContractPdfContext(f.contract, f.load)).items).toEqual([{ item: "STEEL-1", itemCode: "STEEL-1", qty: "25.5", uom: "Kg", sourceQuotation: QUOTE }]);
  });
  it("includes only explicitly linked and verified supporting documents, with duplicate/foreign/payment files omitted", async () => {
    const f = fixture();
    f.updateData(data => {
      data.source_documents = [
        { file_id: "SOURCE", file_name: "Old title.pdf", source_doctype: "Supplier Quotation", source_name: QUOTE },
        { file_id: "DUPLICATE", source_doctype: "Supplier Quotation", source_name: QUOTE },
        { file_id: "FOREIGN", source_doctype: "Request for Quotation", source_name: RFQ },
        { file_id: "WRONG-LABEL", source_doctype: "Request for Quotation", source_name: RFQ },
        { file_id: "PAYMENT", source_doctype: "Request for Quotation", source_name: RFQ },
        { file_id: "UNKNOWN", source_doctype: "Supplier", source_name: "SUP-1" },
        { file_id: "DRAWING", source_doctype: "Material Request Item", source_name: "MRI-1" },
      ];
      data.supplier_documents = [{ file_id: "CONTRACT-EVIDENCE", file_name: "Supplier.pdf", file_url: "/private/files/evidence.pdf" }];
    });
    const file = (id: string, name: string, dt = "Request for Quotation", parent = RFQ, extra: ClmRecord = {}) => f.records.set(`File/${id}`, { name: id, file_name: name, file_url: `/private/files/${name}`, attached_to_doctype: dt, attached_to_name: parent, ...extra });
    file("SOURCE", "Warranty.pdf", "Supplier Quotation", QUOTE, { content_hash: "same-content" });
    file("DUPLICATE", "Warranty-copy.pdf", "Supplier Quotation", QUOTE, { content_hash: "same-content" });
    file("FOREIGN", "Foreign.pdf", "Request for Quotation", "OTHER");
    file("WRONG-LABEL", "PUR-RFQ-2026-00091-Drawing.pdf");
    file("PAYMENT", "Payment-report.pdf");
    file("CONTRACT-EVIDENCE", "evidence.pdf", "Contract", "CON-1");
    file("DRAWING", "Drawing.pdf", "Material Request Item", "MRI-1");
    f.records.set("Material Request/MR-1", { name: "MR-1", items: [{ name: "MRI-1", item_code: "STEEL-1" }] });
    const result = await loadContractPdfContext(f.contract, f.load);
    expect(result.documents).toEqual([
      { name: "Warranty.pdf", reference: `Supplier Quotation: ${QUOTE}` },
      { name: "Drawing.pdf", reference: "Material Request Item: MRI-1" },
      { name: "evidence.pdf", reference: "Contract: CON-1" },
    ]);
    expect(f.load).not.toHaveBeenCalledWith("File", "UNKNOWN");
  });
  it("takes document type and upload timestamp only from the already verified File record", async () => {
    const f = fixture();
    f.updateData(data => { data.supplier_documents = [{ file_id: "EVIDENCE", file_name: "Old title.pdf", file_url: "/private/files/specification.pdf", file_type: "Unverified type", creation: "2025-01-01", at: "2025-02-01" }]; });
    f.records.set("File/EVIDENCE", { name: "EVIDENCE", file_name: "Specification.pdf", file_url: "/private/files/specification.pdf", attached_to_doctype: "Contract", attached_to_name: "CON-1", file_type: "PDF", creation: "2026-09-29 13:00:00.123456" });
    const before = JSON.stringify([...f.records]), result = await loadContractPdfContext(f.contract, f.load);
    expect(result.documents).toEqual([{ name: "Specification.pdf", reference: "Contract: CON-1", documentType: "PDF", uploadedAt: "2026-09-29 13:00:00.123456" }]);
    expect(f.load).toHaveBeenCalledTimes(6);
    expect(f.load).toHaveBeenCalledWith("File", "EVIDENCE");
    expect(JSON.stringify([...f.records])).toBe(before);
  });
  it.each([undefined, "", "   "])("omits unavailable document metadata instead of inferring it from names or attachment evidence: %j", async value => {
    const f = fixture();
    f.updateData(data => { data.supplier_documents = [{ file_id: "EVIDENCE", file_name: "Specification.pdf", file_type: "PDF", uploaded_at: "2026-09-29", at: "2026-09-29" }]; });
    f.records.set("File/EVIDENCE", { name: "EVIDENCE", file_name: "Specification.pdf", file_url: "/private/files/specification.pdf", attached_to_doctype: "Contract", attached_to_name: "CON-1", file_type: value, creation: value, modified: "2026-09-29 13:00:00" });
    const result = await loadContractPdfContext(f.contract, f.load);
    expect(result.documents).toEqual([{ name: "Specification.pdf", reference: "Contract: CON-1" }]);
  });
});
