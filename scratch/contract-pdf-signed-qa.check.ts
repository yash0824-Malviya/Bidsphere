import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { burnTypedSignatureIntoPdf } from "../src/utils/legalPdfSignature";
import { generateClmContractPdf } from "../api/clmContractPdf";
import type { ClmRecord, ClmSignature } from "../src/types/clm";

test("renders synthetic signed certificate for visual QA only", async () => {
  const signatures: ClmSignature[] = [
    { party: "inteva", by: "legal@example.test", at: "2026-09-28 10:00:00", version: "1.0", hash: "a".repeat(64), file_id: "FIXTURE-LEGAL-FILE", file_url: "/private/files/fixture-legal.pdf", typed_name: "A. Legal", full_legal_name: "Alex Legal Reviewer", role: "legal", signature_method: "typed", signature_adopted: true },
    { party: "supplier", by: "supplier@example.test", at: "2026-09-28 11:00:00", version: "1.0", hash: "b".repeat(64), file_id: "FIXTURE-SUPPLIER-FILE", file_url: "/private/files/fixture-supplier.pdf", typed_name: "Sam Supplier", full_legal_name: "Sam Supplier Representative" },
  ];
  const record: ClmRecord = {
    name: "CON-QA-SIGNED-FIXTURE", party_name: "Example Components Ltd", custom_supplier: "QA-SUPPLIER",
    custom_rfq: "QA-RFQ-104", custom_supplier_quotation: "QA-QUOTE-273", custom_contract_type: "Supply / Procurement Contract",
    custom_contract_title: "Synthetic layout fixture for procurement components. This is not a real contract.",
    custom_contract_value: 4500, custom_currency: "USD", custom_current_version: "1.0",
    start_date: "2026-09-25", end_date: "2026-10-25", custom_inteva_signatory: "legal@example.test",
    custom_contract_status: "Pending Finance", custom_esign_status: "Completed",
    contract_terms: "Synthetic visual QA content only. Use the approved specification for the components included in the award.",
    custom_clm_data: JSON.stringify({ schema: 1, signatures, approvals: [], versions: [], audit: [], sla: [] }),
  };
  const result = await generateClmContractPdf(record, {
    company: "Netlink", department: "Production", supplierName: "Example Components Ltd", rfqTitle: "Procurement components - QA fixture",
    awardId: "QA-AWARD-27", awardValue: 4500, awardCurrency: "USD", rfqValidTill: "2026-10-02",
    items: [{ item: "Example steel component", qty: 100, uom: "Kg" }, { item: "Example galvanized component", qty: 80, uom: "Kg" }],
    documents: [{ name: "fixture-specification.pdf", reference: "Request for Quotation: QA-RFQ-104" }],
  });
  const pdf = await PDFDocument.load(result.bytes);
  expect(result.signature_page).toBe(pdf.getPageCount());
  await mkdir("tmp/pdfs", { recursive: true });
  await writeFile("tmp/pdfs/synthetic-signed-contract-qa.pdf", result.bytes);
  console.log(JSON.stringify({ fixture: true, pages: pdf.getPageCount(), signature_page: result.signature_page }));
});

test("renders the existing signature overlay on the generated template using test-only signers", async () => {
  const record: ClmRecord = {
    name: "CON-PRESENTATION-TEST", party_name: "Example QA Supplier", custom_contract_title: "Layout test only - not a real Contract or signature.",
    custom_contract_type: "Supply / Procurement Contract", custom_contract_value: 100, custom_currency: "USD", custom_current_version: "1.0",
    custom_contract_status: "Pending Signature", custom_rfq: "RFQ-PRESENTATION-TEST", custom_inteva_signatory: "reviewer@example.test",
    start_date: "2026-09-01", end_date: "2026-10-01", contract_terms: "Synthetic presentation fixture only.",
  };
  const generated = await generateClmContractPdf(record, { company: "Netlink", supplierName: "Example QA Supplier", items: [], documents: [] }, { forSigning: true });
  const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const before = hash(generated.bytes);
  const fonts = async (pdf: PDFDocument) => {
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(await readFile(new URL("../public/fonts/Roboto-Regular.ttf", import.meta.url)), { subset: true });
    return { signature: font, regular: font };
  };
  const placement = { page: generated.signature_page, xNorm: .73, yNorm: .88, widthNorm: .4, heightNorm: .11 };
  const legal = await burnTypedSignatureIntoPdf(Uint8Array.from(generated.bytes).buffer, "QA Legal Signer", "Legal Manager | SIGNED | v1.0", new Date("2026-09-29T10:00:00Z"), placement, fonts);
  const legalHash = hash(legal);
  const signed = await burnTypedSignatureIntoPdf(Uint8Array.from(legal).buffer, "QA Supplier Signer", "SUPPLIER SIGNED | v1.0", new Date("2026-09-29T11:00:00Z"), { ...placement, xNorm: .27 }, fonts);
  expect(hash(generated.bytes)).toBe(before);
  expect(hash(legal)).toBe(legalHash);
  expect((await PDFDocument.load(signed)).getPageCount()).toBe(generated.signature_page);
  await mkdir("tmp/pdfs", { recursive: true });
  await writeFile("tmp/pdfs/contract-actual-overlay-qa.pdf", signed);
});
