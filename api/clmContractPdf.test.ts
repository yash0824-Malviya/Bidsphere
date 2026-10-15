import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { CONTRACT_PDF_TEMPLATE_VERSION, contractPdfDate, contractPdfDuration, contractPdfSignatures, contractPdfStatus, contractPdfText, generateClmContractPdf } from "./clmContractPdf";
import type { ContractPdfContext } from "./clmContractPdfData";
import type { ClmRecord, ClmSignature } from "../src/types/clm";

const base = (): ClmRecord => ({
  name: "CON-QA-104", party_name: "Fixture Manufacturing", custom_supplier: "SUP-QA-1",
  custom_contract_title: "Procurement of precision components under the approved supplier award.",
  custom_contract_type: "Supply / Procurement Contract", custom_contract_value: 4500, custom_currency: "USD",
  custom_rfq: "RFQ-QA-104", custom_supplier_quotation: "QUOTATION-QA-273", custom_current_version: "2.0",
  custom_contract_status: "Pending Signature", start_date: "2026-09-25", end_date: "2026-10-25",
  custom_inteva_signatory: "legal@example.test", contract_terms: "Supply only the parts identified in the approved award.",
});
const context = (): ContractPdfContext => ({
  company: "Netlink", department: "Production", supplierName: "Fixture Manufacturing", awardId: "AWARD-QA-27",
  awardValue: 4500, awardCurrency: "USD", rfqTitle: "Production components", rfqValidTill: "2026-10-02",
  items: [{ item: "Precision steel component", qty: 100, uom: "Kg" }, { item: "Galvanized component", qty: 80, uom: "Kg" }],
  documents: [{ name: "Approved technical drawing.pdf", reference: "Request for Quotation: RFQ-QA-104" }],
});
const receipt = (party: ClmSignature["party"], extra: Partial<ClmSignature> = {}): ClmSignature => ({
  party, by: party === "supplier" ? "supplier@example.test" : "legal@example.test", at: "2026-09-28 10:30:00", version: "2.0",
  hash: "a".repeat(64), file_id: `FILE-${party}`, file_url: `/private/files/${party}.pdf`,
  typed_name: party === "supplier" ? "Supplier Representative" : "Legal Representative", ...(party === "inteva" ? { role: "legal" } : {}), ...extra,
});
function withSignatures(rows: unknown[], extra: ClmRecord = {}): ClmRecord {
  return { ...base(), ...extra, custom_clm_data: JSON.stringify({ schema: 1, approvals: [], versions: [], audit: [], sla: [], signatures: rows }) };
}
function streams(pdf: PDFDocument, index: number): string {
  const contents = pdf.getPage(index).node.Contents();
  const rows = contents instanceof PDFArray ? contents.asArray().map(ref => pdf.context.lookup(ref)) : [contents];
  return rows.filter((row): row is PDFRawStream => row instanceof PDFRawStream)
    .map(row => Buffer.from(decodePDFRawStream(row).decode()).toString("latin1")).join("\n");
}
const fontMaps = new WeakMap<PDFDocument, Map<string, Map<string, string>>>();
function decodedText(pdf: PDFDocument, index: number, block: string): string {
  const word = /<([a-f0-9]+)>\s*Tj/i.exec(block), name = /\/([^\s]+)\s+[\d.]+\s+Tf/.exec(block)?.[1];
  if (!word || !name) return "";
  let cache = fontMaps.get(pdf); if (!cache) { cache = new Map(); fontMaps.set(pdf, cache); }
  let characters = cache.get(name);
  if (!characters) {
    characters = new Map();
    const font = pdf.getPage(index).node.Resources()?.lookup(PDFName.of("Font"), PDFDict).lookup(PDFName.of(name), PDFDict);
    const mapping = font?.lookup(PDFName.of("ToUnicode"));
    if (mapping instanceof PDFRawStream) {
      const cmap = Buffer.from(decodePDFRawStream(mapping).decode()).toString("latin1");
      const entries = /beginbfchar([\s\S]*?)endbfchar/.exec(cmap)?.[1] || "";
      for (const match of entries.matchAll(/<([a-f0-9]+)>\s*<([a-f0-9]+)>/gi)) {
        const encoded = Buffer.from(match[2], "hex");
        characters.set(match[1].toUpperCase(), encoded.swap16().toString("utf16le"));
      }
    }
    cache.set(name, characters);
  }
  return characters.size ? (word[1].match(/.{4}/g) || []).map(code => characters!.get(code.toUpperCase()) || "�").join("") : Buffer.from(word[1], "hex").toString("latin1");
}
function lines(pdf: PDFDocument, index: number): string[] {
  return [...streams(pdf, index).matchAll(/BT\s+([\s\S]*?)ET/g)].map(block => decodedText(pdf, index, block[1]));
}
const allText = (pdf: PDFDocument) => pdf.getPages().flatMap((_, index) => lines(pdf, index)).join("\n");
function positionedLines(pdf: PDFDocument, index: number): Array<{ value: string; y: number }> {
  return [...streams(pdf, index).matchAll(/BT\s+([\s\S]*?)ET/g)].flatMap(block => {
    const position = /1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/.exec(block[1]), word = /<([a-f0-9]+)>\s*Tj/i.exec(block[1]);
    return position && word ? [{ value: decodedText(pdf, index, block[1]), y: Number(position[2]) }] : [];
  });
}

describe("corporate Contract PDF presentation", () => {
  it("preserves numbered legal clauses including rich-text ordered list numbering", () => {
    const source = '<p>Existing terms:</p><ol start="4"><li>Use the approved drawing.</li><li value="9">Payment after inspection.<ul><li>Keep evidence.</li></ul></li></ol><p>12. Existing typed clause.</p>';
    const text = contractPdfText(source);
    for (const clause of ["4. Use the approved drawing.", "9. Payment after inspection.", "- Keep evidence.", "12. Existing typed clause."]) expect(text).toContain(clause);
    expect(text).not.toContain("<");
    expect(contractPdfText('<ol type="a" start="26"><li>Keep alpha.</li><li>Next alpha.</li></ol>')).toContain("aa. Next alpha.");
    expect(contractPdfText('<ol type="I" reversed><li>First.</li><li>Second.<ul><li>Nested bullet.</li></ul></li><li>Last.</li></ol>')).toContain("III. First.");
    expect(contractPdfText('<ol type="i" start="4" reversed><li>First.</li><li>Last.</li></ol>')).toContain("iii. Last.");
  });

  it("separates source scope, commercial fields and legal terms while omitting missing fields", async () => {
    const record = { ...base(), custom_payment_terms: "Net 30", custom_payment_terms_description: "Payment after accepted delivery.", custom_auto_renewal: 0, custom_renewal_notice_days: 60 };
    const source = { ...context(), rfqScope: "Provide only the RFQ's specified materials.", documents: [{ name: "Approved scope.pdf", reference: "Contract: CON-QA-104", documentType: "PDF", uploadedAt: "2026-09-27 12:15:00" }] };
    const pdf = await PDFDocument.load((await generateClmContractPdf(record, source)).bytes), text = allText(pdf).replace(/\s+/g, " ");
    for (const value of ["CONTRACT SUMMARY", "PROCUREMENT & AWARD DETAILS", "SCOPE OF CONTRACT", source.rfqScope, "COMMERCIAL TERMS", "CONTRACT TERMS", "USD 4,500.00", "PAYMENT TERMS Net 30", "AUTO RENEWAL No", "RENEWAL NOTICE (DAYS) 60", "Payment after accepted delivery.", "Approved scope.pdf", "27 September 2026"]) expect(text).toContain(value);
    expect(text.indexOf("COMMERCIAL TERMS")).toBeLessThan(text.indexOf("CONTRACT TERMS"));
    expect(text).not.toContain("Incentives"); expect(text).not.toContain("Penalties");
  });

  it("retains escaped legal comparisons and placeholders after paragraph formatting", async () => {
    const record = { ...base(), contract_terms: '<p>Accept only quantities &lt; 10 and pressure &gt; 5.</p><p>Keep literal &lt;b&gt; placeholders &lt;/b&gt;.</p>' };
    const text = allText(await PDFDocument.load((await generateClmContractPdf(record, context())).bytes));
    expect(text).toContain("Accept only quantities < 10 and pressure > 5.");
    expect(text).toContain("Keep literal <b> placeholders </b>.");
  });

  it("retains escaped comparisons and literal placeholders in awarded-item descriptions", async () => {
    const source = { ...context(), items: [{ item: "Specified component", qty: 10, uom: "Nos", description: "<p>Diameter &lt; 10 and pressure &gt; 5.</p><p>Keep &lt;b&gt; literal &lt;/b&gt;.</p>" }] };
    const text = allText(await PDFDocument.load((await generateClmContractPdf(base(), source)).bytes)).replace(/\s+/g, " ");
    expect(text).toContain("Diameter < 10 and pressure > 5.");
    expect(text).toContain("Keep <b> literal </b>.");
  });

  it("preserves nested legal list indentation and source clause numbering", async () => {
    const record = { ...base(), contract_terms: '<ol start="9"><li>Parent clause.<ol type="a"><li>Nested clause.<ol type="i"><li>Deeper clause.</li></ol></li></ol></li><li>Next parent clause.</li></ol>' };
    const text = allText(await PDFDocument.load((await generateClmContractPdf(record, context())).bytes));
    for (const clause of ["9. Parent clause.", "  a. Nested clause.", "    i. Deeper clause.", "10. Next parent clause."]) expect(text).toContain(clause);
  });

  it.each([true, false])("numbers only visible generated sections and labels saved workflow status at issue (description: %s)", async hasDescription => {
    const record = { ...base(), custom_rfq: "", custom_supplier_quotation: "", custom_contract_status: "Pending Legal", custom_contract_title: hasDescription ? "Existing standalone contract description." : "", contract_terms: hasDescription ? "12. Retain this legal clause number." : "" };
    const pdf = await PDFDocument.load((await generateClmContractPdf(record, { items: [], documents: [] }, { forSigning: true })).bytes);
    const rendered = pdf.getPages().flatMap((_, index) => lines(pdf, index));
    const sections = ["CONTRACT SUMMARY", ...(hasDescription ? ["SCOPE OF CONTRACT"] : []), "COMMERCIAL TERMS", ...(hasDescription ? ["CONTRACT TERMS"] : []), "DOCUMENT CONTROL AND AUDIT", "SIGNATURES"];
    sections.forEach((title, index) => expect(rendered[rendered.indexOf(title) - 1]).toBe(`${index + 1}.`));
    expect(rendered).toContain("CONTRACT STATUS AT ISSUE");
    expect(rendered).toContain("Pending Legal");
    if (hasDescription) {
      const scope = rendered.indexOf("SCOPE OF CONTRACT"), commercial = rendered.indexOf("COMMERCIAL TERMS");
      expect(rendered.slice(scope, commercial)).toEqual(expect.arrayContaining(["CONTRACT DESCRIPTION", record.custom_contract_title]));
      expect(rendered).toContain("12. Retain this legal clause number.");
    } else expect(rendered).not.toContain("SCOPE OF CONTRACT");
    expect(rendered).not.toContain("PROCUREMENT & AWARD DETAILS");
    expect(rendered).not.toContain("SUPPORTING DOCUMENTS");
  });

  it("keeps the Contract Terms heading with the first legal paragraph", async () => {
    const record = { ...base(), custom_rfq: "", custom_supplier_quotation: "", contract_terms: "This is an approved legal obligation that must remain with its section heading. ".repeat(12) };
    const pdf = await PDFDocument.load((await generateClmContractPdf(record, { items: [], documents: [] })).bytes);
    const page = pdf.getPages().map((_, index) => lines(pdf, index)).find(text => text.includes("CONTRACT TERMS"))!;
    expect(page.some(line => line.startsWith("This is an approved legal obligation"))).toBe(true);
  });

  it.each([20, 40, 100])( "keeps the scope heading with the first lines of a %i-sentence scope", async count => {
    const source = { ...context(), rfqScope: "SCOPECLAUSE requires the supplier to meet the approved delivery and quality requirements. ".repeat(count) };
    const pdf = await PDFDocument.load((await generateClmContractPdf(base(), source)).bytes);
    const pages = pdf.getPages().map((_, index) => lines(pdf, index));
    const headingPage = pages.find(text => text.includes("SCOPE OF CONTRACT"))!;
    expect(headingPage).toContain("CONTRACT DESCRIPTION");
    expect(headingPage.some(line => line.startsWith("Procurement of precision components"))).toBe(true);
    const rfqPage = pages.find(text => text.includes("RFQ SCOPE"))!;
    expect(rfqPage.some(line => line.startsWith("SCOPECLAUSE"))).toBe(true);
  });

  it.each([12, 100])("keeps a long standalone description with its Scope heading (%i sentences)", async count => {
    const record = { ...base(), custom_rfq: "", custom_supplier_quotation: "", custom_contract_title: "SAVEDDESCRIPTION specifies the approved delivery obligations. ".repeat(count) };
    const pdf = await PDFDocument.load((await generateClmContractPdf(record, { items: [], documents: [] })).bytes);
    const scopePage = pdf.getPages().map((_, index) => lines(pdf, index)).find(text => text.includes("SCOPE OF CONTRACT"))!;
    expect(scopePage).toContain("CONTRACT DESCRIPTION");
    expect(scopePage.some(line => line.startsWith("SAVEDDESCRIPTION"))).toBe(true);
  });

  it("keeps each ordinary signature receipt and its document hash on the same page", async () => {
    const record = withSignatures([receipt("inteva"), receipt("supplier")]);
    const pdf = await PDFDocument.load((await generateClmContractPdf(record, context())).bytes);
    for (const party of ["supplier", "inteva"]) {
      const page = pdf.getPages().map((_, index) => lines(pdf, index)).find(text => text.includes(party === "supplier" ? "SUPPLIER SIGNED" : "COMPANY SIGNED"))!;
      expect(page).toContain(`Signed document: FILE-${party}`);
      expect(page.join(" ")).toContain(`Document SHA-256: ${"a".repeat(64)}`);
    }
  });

  it("keeps pending signature headings and long saved roles with their party blocks", async () => {
    const record = withSignatures([receipt("supplier", { signatory_role: "Senior Authorized Procurement and Commercial Signatory ".repeat(3) })]);
    const output = await generateClmContractPdf(record, context(), { forSigning: true });
    const pdf = await PDFDocument.load(output.bytes);
    const last = positionedLines(pdf, output.signature_page - 1);
    for (const row of last.filter(line => /Status at issue:|Date:/.test(line.value))) expect(row.y).toBeGreaterThan(167);
    const unsigned = await PDFDocument.load((await generateClmContractPdf(base(), context(), { forSigning: true })).bytes);
    const headingPage = unsigned.getPages().map((_, index) => lines(unsigned, index)).find(text => text.includes("SIGNATURES"))!;
    expect(headingPage).toEqual(expect.arrayContaining(["FOR SUPPLIER", "FOR NETLINK"]));
  });

  it("shows only saved signature identity and evidence without claiming digital verification", async () => {
    const saved = receipt("supplier", { signatory_role: "Supplier Director", signer_email: "director@example.test" });
    const text = allText(await PDFDocument.load((await generateClmContractPdf(withSignatures([saved]), context())).bytes)).replace(/\s+/g, " ");
    for (const actual of ["Supplier Director", "director@example.test", "Supplier Representative", "FILE-supplier", "2026-09-28 10:30:00"]) expect(text).toContain(actual);
    expect(text).not.toMatch(/digitally verified|signature is valid/i);
  });

  it("right aligns quantities and monetary amounts inside their table cells", async () => {
    const pdf = await PDFDocument.load((await generateClmContractPdf(base(), context())).bytes);
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(await readFile(new URL("../public/fonts/Roboto-Regular.ttf", import.meta.url)));
    const ends: Array<{ text: string; end: number }> = [];
    for (let index = 0; index < pdf.getPageCount(); index++) for (const match of streams(pdf, index).matchAll(/BT\s+([\s\S]*?)ET/g)) {
      const text = decodedText(pdf, index, match[1]);
      const at = /1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/.exec(match[1]);
      if (at && ["100", "80", "USD 4,500.00"].includes(text)) ends.push({ text, end: Number(at[1]) + font.widthOfTextAtSize(text, 10) });
    }
    expect(ends.find(row => row.text === "100")!.end).toBeCloseTo(ends.find(row => row.text === "80")!.end, 4);
    expect(ends.some(row => row.text === "USD 4,500.00" && Math.abs(row.end - (595.28 - 56.7 - 9)) < .01)).toBe(true);
  });
  it("renders real A4 pages with official logo, contract references and correct page totals on every page", async () => {
    const { bytes, signature_page } = await generateClmContractPdf(base(), context());
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe("%PDF");
    const pdf = await PDFDocument.load(bytes), png = await readFile(new URL("../public/netlink-logo-transparent.png", import.meta.url));
    expect(signature_page).toBe(pdf.getPageCount());
    expect(pdf.getTitle()).toBe("Procurement Contract - CON-QA-104");
    for (let index = 0; index < pdf.getPageCount(); index++) {
      const page = pdf.getPage(index), text = lines(pdf, index), resources = page.node.Resources();
      expect(page.getWidth()).toBeCloseTo(595.28, 2); expect(page.getHeight()).toBeCloseTo(841.89, 2);
      expect(text).toEqual(expect.arrayContaining(["NETLINK", "PROCUREMENT", "CONTRACT AGREEMENT", "Netlink · BidSphere", "CON-QA-104", "Version 2.0", "CONFIDENTIAL - PROCUREMENT DOCUMENT", `Page ${index + 1} of ${pdf.getPageCount()}`]));
      const images = resources?.lookup(PDFName.of("XObject"), PDFDict);
      expect(images).toBeDefined();
      const image = images!.entries().map(([, ref]) => pdf.context.lookup(ref)).find(value => value instanceof PDFRawStream && value.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) as PDFRawStream;
      expect(image).toBeDefined();
      expect(image.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber()).toBe(png.readUInt32BE(16));
      expect(image.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber()).toBe(png.readUInt32BE(20));
    }
    const text = allText(pdf);
    for (const value of ["Fixture Manufacturing", "RFQ-QA-104", "AWARD-QA-27", "QUOTATION-QA-273", "USD 4,500", "25 September 2026", "25 October 2026", "30 days (between start and end dates)", "Precision steel component", "Galvanized component", "100", "80", "Kg", "Approved technical drawing.pdf"]) expect(text).toContain(value);
    expect(text).toContain("8."); expect(text).toContain("SIGNATURES");
  });

  it("uses latest supplied persisted values and does not mutate Contract or source context", async () => {
    const record = base(), source = context(), before = structuredClone({ record, source });
    const first = allText(await PDFDocument.load((await generateClmContractPdf(record, source)).bytes));
    expect({ record, source }).toEqual(before);
    record.custom_contract_value = 6234; record.end_date = "2026-11-25"; source.items[0].qty = 112;
    const second = allText(await PDFDocument.load((await generateClmContractPdf(record, source)).bytes));
    expect(first).toContain("USD 4,500"); expect(second).toContain("USD 6,234");
    expect(second).toContain("25 November 2026"); expect(second).toContain("112");
  });

  it("embeds the repository font, uses exact brand colors, and keeps contractual body text at 10.5pt", async () => {
    const pdf = await PDFDocument.load((await generateClmContractPdf(base(), context())).bytes);
    let bodySize: number | undefined;
    const colors: number[][] = [];
    for (let index = 0; index < pdf.getPageCount(); index++) {
      const fonts = pdf.getPage(index).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
      for (const [, ref] of fonts.entries()) {
        const font = pdf.context.lookup(ref, PDFDict);
        expect(font.lookup(PDFName.of("Subtype"))).toBe(PDFName.of("Type0"));
        expect(font.lookup(PDFName.of("ToUnicode"))).toBeInstanceOf(PDFRawStream);
        const descendant = font.lookup(PDFName.of("DescendantFonts"), PDFArray).lookup(0, PDFDict);
        const descriptor = descendant.lookup(PDFName.of("FontDescriptor"), PDFDict);
        expect(descriptor.lookup(PDFName.of("FontFile2"))).toBeInstanceOf(PDFRawStream);
        expect(String(font.lookup(PDFName.of("BaseFont")))).toContain("Roboto");
      }
      const content = streams(pdf, index);
      colors.push(...[...content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)].map(match => match.slice(1).map(Number)));
      for (const block of content.matchAll(/BT\s+([\s\S]*?)ET/g)) {
        if (decodedText(pdf, index, block[1]).includes("Supply only the parts")) bodySize = Number(/\/[^\s]+\s+([\d.]+)\s+Tf/.exec(block[1])?.[1]);
      }
    }
    for (const color of [[15, 27, 54], [20, 108, 232]]) expect(colors.some(actual => actual.every((value, i) => Math.abs(value - color[i] / 255) < 1e-12))).toBe(true);
    expect(bodySize).toBe(10.5);
    expect(allText(pdf)).toContain(CONTRACT_PDF_TEMPLATE_VERSION);
    const unicode = await generateClmContractPdf({ ...base(), custom_contract_title: "Pièces usinées — qualité vérifiée" }, context());
    expect(allText(await PDFDocument.load(unicode.bytes))).toContain("Pièces usinées - qualité vérifiée");
  });

  it("attributes item scope to the winning quotation and renders only saved technical terms", async () => {
    const record = { ...base(), custom_quality_requirements: "Inspect against drawing REV-C.", custom_part_numbers: "STEEL-104", custom_program_name: "Program Alpha" };
    const source: ContractPdfContext = { ...context(), itemSource: { doctype: "Supplier Quotation", name: "QUOTATION-QA-273" }, items: [{ item: "Precision steel component", itemCode: "STEEL-104", description: "Approved dimensional scope 12 × 25 mm", qty: 100, uom: "Kg" }] };
    const text = allText(await PDFDocument.load((await generateClmContractPdf(record, source)).bytes));
    for (const value of ["Item scope: winning Supplier Quotation QUOTATION-QA-273.", "Item code: STEEL-104", "Approved dimensional scope 12 × 25 mm", "TECHNICAL AND PERFORMANCE TERMS", "Inspect against drawing REV-C.", "Program Alpha"]) expect(text.replace(/\s+/g, " ")).toContain(value);
    for (const invented of ["Unit price", "Line total", "Warranty", "technical requirements not supplied"]) expect(text).not.toContain(invented);
  });

  it("prints saved audit and receipt metadata without carrying a prior version signature into a new version", async () => {
    const data = { schema: 1, versions: [], sla: [], signatures: [receipt("inteva", { request_id: "SIGN-REQ-72" })], locked_hash: "b".repeat(64), approvals: [{ role: "legal", status: "Approved", by: "reviewer@example.test", at: "2026-09-27 12:30:00" }], audit: [{ action: "E-Signature Completed", by: "legal@example.test", at: "2026-09-28 10:30:00", version: "2.0", role: "legal" }] };
    const record = { ...base(), creation: "2026-09-26 09:00:00", owner: "procurement@example.test", modified: "2026-09-28 10:30:00", modified_by: "legal@example.test", custom_clm_data: JSON.stringify(data) };
    const source = { ...context(), sourceRecords: [{ doctype: "Legal Document Review", name: "AWARD-QA-27", modified: "2026-09-26 08:00:00" }] };
    const signedText = allText(await PDFDocument.load((await generateClmContractPdf(record, source)).bytes));
    for (const value of ["DOCUMENT CONTROL AND AUDIT", "procurement@example.test", "reviewer@example.test", "E-Signature Completed", "FILE-inteva", "SIGN-REQ-72", "2026-09-26 08:00:00"]) expect(signedText).toContain(value);
    expect(signedText.replace(/\s/g, "")).toContain("a".repeat(64));
    expect(signedText.replace(/\s/g, "")).toContain("b".repeat(64));
    const nextVersion = { ...record, custom_current_version: "3.0", custom_clm_data: JSON.stringify({ ...data, approvals: [], locked_hash: undefined }) };
    const pending = allText(await PDFDocument.load((await generateClmContractPdf(nextVersion, source, { forSigning: true })).bytes));
    expect(pending).toContain("Version 3.0"); expect(pending).toContain("AT ISSUE: ISSUED FOR SIGNATURE");
    expect(pending.match(/Status at issue: PENDING/g)).toHaveLength(2);
    for (const stale of ["FILE-inteva", "SIGN-REQ-72", "Electronic Signature Record", "E-Signature Completed", "Status at issue: SIGNED"]) expect(pending).not.toContain(stale);
  });

  it("renders only configured clauses and linked documents, without inventing legal obligations", async () => {
    const record = base(); record.contract_terms = "<p>Use the agreed specification &amp; inspection criteria.</p><script>private script</script>";
    record.custom_delivery_terms = "Delivery after written release.";
    const source = { ...context(), documents: [] };
    const text = allText(await PDFDocument.load((await generateClmContractPdf(record, source)).bytes));
    expect(text).toContain("CONTRACT TERMS"); expect(text).toContain("Delivery requirements");
    expect(text).not.toContain("7A."); expect(text).toContain("DOCUMENT CONTROL AND AUDIT");
    expect(text).toContain("Use the agreed specification & inspection criteria."); expect(text).toContain("Delivery after written release.");
    for (const absent of ["private script", "Confidentiality", "Dispute Resolution", "Warranty", "SUPPORTING DOCUMENTS", "Approved technical drawing.pdf", "Liability"]) expect(text).not.toContain(absent);
  });

  it("keeps long terms, identifiers and table rows without horizontal clipping, and repeats table headers", async () => {
    const record = base(), source = context();
    const identifier = `TRACE-${"X".repeat(1200)}-END`;
    record.contract_terms = `${Array.from({ length: 85 }, (_, i) => `Clause ${i + 1}: Preserve the configured specification and agreed commercial requirements.`).join("\n")}\n${identifier}`;
    source.items = Array.from({ length: 78 }, (_, index) => ({ item: `Awarded component ${index + 1}`, qty: index + 1, uom: "Kg" }));
    source.documents = [{ name: `Evidence-${"z".repeat(1800)}.pdf`, reference: "Contract: CON-QA-104" }];
    const pdf = await PDFDocument.load((await generateClmContractPdf(record, source)).bytes), text = allText(pdf);
    const renderedLines = pdf.getPages().flatMap((_, index) => lines(pdf, index));
    expect(text).toContain("Clause 85:");
    expect(renderedLines.filter(line => /^(?:TRACE-)?X+(?:-END)?$/.test(line)).join("")).toBe(identifier);
    expect(renderedLines.filter(line => /^(?:Evidence-)?z+(?:\.pdf)?$/.test(line)).join("")).toBe(source.documents[0].name);
    pdf.registerFontkit(fontkit);
    const regular = await pdf.embedFont(await readFile(new URL("../public/fonts/Roboto-Regular.ttf", import.meta.url)));
    const itemPages = pdf.getPages().map((_, index) => lines(pdf, index)).filter(page => page.some(line => /^Awarded component \d+$/.test(line)));
    expect(itemPages.length).toBeGreaterThan(2);
    for (const page of itemPages) expect(page).toEqual(expect.arrayContaining(["ITEM", "QUANTITY", "UOM"]));
    for (const item of source.items) expect(text).toContain(item.item);
    for (let index = 0; index < pdf.getPageCount(); index++) {
      for (const block of streams(pdf, index).matchAll(/BT\s+([\s\S]*?)ET/g)) {
        const size = /\/[^\s]+\s+([\d.]+)\s+Tf/.exec(block[1]), position = /1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/.exec(block[1]), word = /<([a-f0-9]+)>\s*Tj/i.exec(block[1]);
        if (!size || !position || !word) continue;
        const value = decodedText(pdf, index, block[1]), font = regular;
        expect(Number(position[1])).toBeGreaterThanOrEqual(40);
        expect(Number(position[1]) + font.widthOfTextAtSize(value, Number(size[1]))).toBeLessThanOrEqual(555);
        expect(Number(position[2])).toBeGreaterThanOrEqual(25); expect(Number(position[2])).toBeLessThan(817);
      }
    }
  }, 30_000);

  it("fails clearly for unsupported glyphs rather than silently replacing contractual text", async () => {
    await expect(generateClmContractPdf({ ...base(), contract_terms: "保留原条款" }, context())).rejects.toThrow("embedded Contract font cannot render this text");
  });

  it.each(["unsigned", "partially signed", "fully signed"])("keeps very long %s party identities above the footer and reserved signature boxes", async state => {
    const supplier = `SUPPLIERIDENTITY-${"S".repeat(1000)}-END`, legal = `LEGALIDENTITY-${"L".repeat(1000)}-END`;
    const supplierSigner = `SUPPLIERSIGNER-${"A".repeat(1000)}-END`, email = `reviewer-${"e".repeat(500)}@example.test`;
    const receipts = state === "unsigned" ? [] : [receipt("inteva", { full_legal_name: legal, by: email })];
    if (state === "fully signed") receipts.push(receipt("supplier", { full_legal_name: supplierSigner }));
    const record = withSignatures(receipts, { custom_inteva_signatory: email, party_name: supplier, custom_supplier: supplier });
    const source = { ...context(), supplierName: supplier };
    const output = await generateClmContractPdf(record, source, { forSigning: state === "unsigned" });
    const pdf = await PDFDocument.load(output.bytes), renderedLines = pdf.getPages().flatMap((_, index) => lines(pdf, index));
    // Names may wrap and repeat across contract sections, but must survive in full.
    expect(renderedLines.filter(line => /^(?:SUPPLIERIDENTITY-)?S+(?:-END)?$/.test(line)).join("")).toContain(supplier);
    if (receipts.length) expect(renderedLines.filter(line => /^(?:LEGALIDENTITY-)?L+(?:-END)?$/.test(line)).join("")).toContain(legal);
    if (state === "fully signed") expect(renderedLines.filter(line => /^(?:SUPPLIERSIGNER-)?A+(?:-END)?$/.test(line)).join("")).toContain(supplierSigner);
    for (let index = 0; index < pdf.getPageCount(); index++) {
      const text = positionedLines(pdf, index);
      const belowContent = text.filter(line => line.y < 44);
      expect(belowContent.map(line => line.value)).toEqual(["Netlink · BidSphere", "CONFIDENTIAL - PROCUREMENT DOCUMENT", `Page ${index + 1} of ${pdf.getPageCount()}`]);
      expect(text.every(line => line.y >= 25)).toBe(true);
    }
    const signingPage = positionedLines(pdf, output.signature_page - 1);
    if (state !== "fully signed") expect(signingPage.filter(line => line.y >= 44 && line.y < 150)).toEqual([]);
    else expect(signingPage.map(line => line.value)).not.toContain("Signature");
    if (state !== "fully signed") expect(signingPage.map(line => line.value)).toEqual(expect.arrayContaining(["FOR SUPPLIER", "FOR NETLINK"]));
    else expect(renderedLines).toEqual(expect.arrayContaining(["SUPPLIER SIGNED", "COMPANY SIGNED", "RECORDED TYPED SIGNATURE"]));
  }, 30_000);
});

describe("Contract dates and persisted signature presentation", () => {
  it("calculates duration from actual dates across leap days without inventing invalid dates", () => {
    expect(contractPdfDuration("2024-02-28", "2024-03-01")).toBe("2 days (between start and end dates)");
    expect(contractPdfDuration("2026-09-25", "2026-09-26")).toBe("1 day (between start and end dates)");
    expect(contractPdfDuration("2026-09-25", "2026-09-25")).toBe("0 days (between start and end dates)");
    expect(contractPdfDuration("2026-10-25", "2026-09-25")).toBe("");
    expect(contractPdfDuration("2026-02-30", "2026-03-01")).toBe("");
    expect(contractPdfDate("2026-02-30")).toBe("2026-02-30"); expect(contractPdfDate("2026-09-25")).toBe("25 September 2026");
  });

  it("requires current-version private signature evidence and never infers signing from a status label", () => {
    const bad = [receipt("supplier", { version: "1.0" }), receipt("inteva", { file_id: "" }), receipt("inteva", { file_url: "/files/public.pdf" }), receipt("inteva", { hash: "invalid" }), receipt("inteva", { by: "" })];
    const record = withSignatures(bad, { custom_contract_status: "Executed", custom_esign_status: "Completed" });
    expect(contractPdfSignatures(record)).toEqual([]); expect(contractPdfStatus(record)).toBe("PENDING SIGNATURE");
    expect(contractPdfStatus({ ...record, custom_contract_status: "Draft" })).toBe("DRAFT / PENDING SIGNATURE");
    expect(contractPdfStatus(record, true)).toBe("ISSUED FOR SIGNATURE");
  });

  it("distinguishes unsigned, partially signed and both signed without stale draft status", async () => {
    const unsigned = base(), partial = withSignatures([receipt("inteva")]), signed = withSignatures([receipt("inteva"), receipt("supplier")], { custom_contract_status: "Pending Finance", custom_esign_status: "Completed" });
    expect(contractPdfStatus(partial)).toBe("PARTIALLY SIGNED / PENDING SIGNATURE"); expect(contractPdfStatus(signed)).toBe("SIGNED");
    const unsignedText = allText(await PDFDocument.load((await generateClmContractPdf(unsigned, context())).bytes));
    const partialText = allText(await PDFDocument.load((await generateClmContractPdf(partial, context())).bytes));
    const signedText = allText(await PDFDocument.load((await generateClmContractPdf(signed, context())).bytes));
    expect(unsignedText).not.toContain("Electronic Signature Record");
    expect(partialText).toContain("Electronic Signature Record"); expect(partialText).toContain("Legal Representative"); expect(partialText).toContain("2026-09-28 10:30:00"); expect(partialText).toContain("PENDING");
    expect(signedText).toContain("Supplier Representative"); expect(signedText).toContain("Legal Representative");
    expect(signedText).not.toContain("DRAFT"); expect(signedText).not.toContain("PENDING");
  });
});
