import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from "pdf-lib";
import { CONTRACT_PDF_TEMPLATE_VERSION } from "./clmContractPdf";
import { lockClmContract, readClmPdf, signClmContract, type ClmLockedFile } from "./clmSignature";
import { ClmError, clmSnapshotHash, parseClmData } from "./clmCore";
import { clmErpRequest } from "./clmErp";
import type { ClmRecord } from "../src/types/clm";
import type { AccessPrincipal } from "./rbacAuth";

vi.mock("./authSession.js", () => ({ readErpAuthConfig: () => ({ baseUrl: "https://erp.fixture.invalid", key: "fixture-key", secret: "fixture-secret" }) }));
vi.mock("./clmErp.js", () => ({ clmErpRequest: vi.fn(), clmResource: (dt: string, name: string) => `resource/${encodeURIComponent(dt)}/${encodeURIComponent(name)}` }));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const supplier: AccessPrincipal = { typ: "supplier", supplier: "SUP-1", sub: "supplier-person", exp: Number.MAX_SAFE_INTEGER, iat: 1 };
const signatory: AccessPrincipal = { typ: "internal", role: "program_manager", sub: "signer@example.test", email: "signer@example.test", exp: Number.MAX_SAFE_INTEGER, iat: 1 };
const legalSignature = () => ({ full_legal_name: "Robert Legal Reviewer", signature: { method: "typed", value: "Legal Bob", adopted: true }, consent: true });
let files: ClmRecord[];
let bodies: Map<string, Uint8Array>;
let requests: Array<{ url: string; method: string }>;
let uploads: Array<{ file: ClmRecord; bytes: Uint8Array; private: string | null; parent: string | null }>;
let mime: string;
let uploadStatus: number;
let corruptUpload: boolean;
let wrongUploadParent: boolean;
let publicUpload: boolean;
let contract: ClmRecord;

const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });
async function createPdf(label = "Original contractual terms", pageCount = 1) {
  const doc = await PDFDocument.create();
  for (let page = 0; page < pageCount; page += 1) doc.addPage([595, 842]).drawText(`${label} ${page + 1}`);
  return doc.save({ useObjectStreams: false });
}
function seedFile(name: string, bytes: Uint8Array, extra: ClmRecord = {}) {
  const file: ClmRecord = { name, file_url: `/private/files/${name}.pdf`, file_name: `${name}.pdf`, is_private: 1, attached_to_doctype: "Contract", attached_to_name: "CON-1", ...extra };
  files.push(file); bodies.set(String(file.file_url), bytes); return file;
}
async function locked() {
  const data = parseClmData(null);
  data.approvals = [{ id: "A-1", role: "legal", stage: 0, rule: "RULE-1", status: "Approved", by: "legal@example.test", at: "2026-09-17 10:00:00" }];
  data.version = "VERSION-1";
  data.locked_hash = clmSnapshotHash("Contract", contract);
  const evidence = await lockClmContract(contract); data.locked_file = evidence;
  contract.custom_clm_data = JSON.stringify(data);
  contract.custom_final_version_locked = 1;
  vi.mocked(clmErpRequest).mockResolvedValue(contract);
  return evidence;
}
function rewriteData(update: (data: ReturnType<typeof parseClmData>) => void) {
  const data = parseClmData(contract.custom_clm_data); update(data); contract.custom_clm_data = JSON.stringify(data);
}
async function contentStreams(bytes: Uint8Array, pageIndex: number) {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(pageIndex).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map(ref => doc.context.lookup(ref)).filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream) : contents instanceof PDFRawStream ? [contents] : [];
  return streams.map(stream => Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")).join("\n");
}
async function pageText(bytes: Uint8Array, pageIndex: number) {
  const doc = await PDFDocument.load(bytes), fonts = doc.getPage(pageIndex).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
  const maps = new Map<string, Map<string, string>>();
  for (const [name, ref] of fonts.entries()) {
    const mapping = doc.context.lookup(ref, PDFDict).lookup(PDFName.of("ToUnicode")), characters = new Map<string, string>();
    if (mapping instanceof PDFRawStream) {
      const cmap = Buffer.from(decodePDFRawStream(mapping).decode()).toString("latin1");
      const entries = /beginbfchar([\s\S]*?)endbfchar/.exec(cmap)?.[1] || "";
      for (const match of entries.matchAll(/<([a-f0-9]+)>\s*<([a-f0-9]+)>/gi)) characters.set(match[1].toUpperCase(), Buffer.from(match[2], "hex").swap16().toString("utf16le"));
    }
    maps.set(name.asString().slice(1), characters);
  }
  return [...(await contentStreams(bytes, pageIndex)).matchAll(/BT\s+([\s\S]*?)ET/g)].map(block => {
    const name = /\/([^\s]+)\s+[\d.]+\s+Tf/.exec(block[1])?.[1], word = /<([a-f0-9]+)>\s*Tj/i.exec(block[1])?.[1];
    if (!word || !name) return "";
    const characters = maps.get(name);
    return characters?.size ? (word.match(/.{4}/g) || []).map(code => characters.get(code.toUpperCase()) || "�").join("") : Buffer.from(word, "hex").toString("latin1");
  }).join("\n");
}

beforeEach(() => {
  files = []; bodies = new Map(); requests = []; uploads = []; mime = "application/pdf"; uploadStatus = 200; corruptUpload = false; wrongUploadParent = false; publicUpload = false;
  contract = { name: "CON-1", modified: "2026-09-17 10:00:00", party_type: "Supplier", party_name: "SUP-1", custom_supplier: "SUP-1", custom_contract_title: "Supply agreement", custom_current_version: "1.0", custom_contract_value: 250, custom_currency: "USD", contract_terms: "Deliver conforming parts under the approved terms.", start_date: "2026-01-01", end_date: "2026-12-31", custom_inteva_signatory: "signer@example.test", custom_contract_status: "Pending Signature" };
  vi.mocked(clmErpRequest).mockReset();
  vi.mocked(clmErpRequest).mockImplementation(async (method, path) => {
    if (method !== "GET") throw new Error(`Unexpected fixture write ${method} ${path}`);
    if (path === "resource/Contract/CON-1") return contract;
    if (path === "resource/Request%20for%20Quotation/RFQ-1") return { name: "RFQ-1", company: "Netlink", items: [] };
    if (path === "resource/Supplier/SUP-1") return { name: "SUP-1", supplier_name: "Fixture supplier" };
    throw new ClmError("Optional fixture record does not exist.", 404);
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input)); const path = decodeURIComponent(url.pathname); const method = init?.method || "GET";
    requests.push({ url: path, method });
    if (path === "/api/method/upload_file") {
      if (uploadStatus !== 200) return json({ message: "Fixture upload failure" }, uploadStatus);
      const form = init?.body as FormData; const file = form.get("file") as File;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const stored = seedFile(`UPLOADED-${uploads.length + 1}`, corruptUpload ? await createPdf("Tampered after upload") : bytes, { attached_to_name: wrongUploadParent ? "OTHER" : form.get("docname"), is_private: publicUpload ? 0 : Number(form.get("is_private")) });
      uploads.push({ file: stored, bytes, private: form.get("is_private") as string, parent: form.get("docname") as string });
      return new Response(JSON.stringify({ message: stored }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/resource/File") {
      const filters = JSON.parse(url.searchParams.get("filters") || "[]") as Array<[string, string, unknown]>;
      return json(files.filter(row => filters.every(([field, op, value]) => op !== "=" || row[field] === value)));
    }
    if (path.startsWith("/api/resource/File/")) {
      const row = files.find(f => f.name === path.slice("/api/resource/File/".length)); return row ? json(row) : json({}, 404);
    }
    if (path.startsWith("/private/files/") || path === "/api/method/frappe.utils.file_manager.download_file") {
      const value = bodies.get(path.startsWith("/private/files/") ? path : url.searchParams.get("file_url") || "");
      return new Response(value ? Uint8Array.from(value).buffer : "Missing", { status: value ? 200 : 404, headers: { "Content-Type": mime } });
    }
    throw new Error(`Unexpected fixture request ${method} ${path}`);
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("CLM immutable PDF locking", () => {
  it("generates reviewed terms and adds a distinct execution page before private upload/readback", async () => {
    const result = await locked(); const bytes = bodies.get(result.file_url)!;
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1); expect(result.signature_page).toBe(pdf.getPageCount());
    expect(result.hash).toBe(digest(bytes)); expect(uploads[0]).toMatchObject({ private: "1", parent: "CON-1" });
    const pages = await Promise.all(pdf.getPages().map((_, index) => pageText(bytes, index)));
    expect(pages.join("\n")).toContain("Deliver conforming parts");
    expect(await pageText(bytes, result.signature_page! - 1)).toContain("SIGNATURES");
  });
  it("returns the document version, template version and captured source context only after verified upload", async () => {
    contract.custom_rfq = "RFQ-1";
    const result = await locked();
    expect(result).toMatchObject({ version: "1.0", template_version: CONTRACT_PDF_TEMPLATE_VERSION, pdf_context: { company: "Netlink", supplierName: "Fixture supplier", items: [], documents: [] } });
    expect(result.pdf_context?.sourceRecords).toEqual(expect.arrayContaining([{ doctype: "Request for Quotation", name: "RFQ-1" }]));
    expect(result.hash).toBe(digest(bodies.get(result.file_url)!));
    expect(parseClmData(contract.custom_clm_data).locked_file).toEqual(result);
  });
  it.each(["locked file", "signature receipt", "locked flag"])("refuses to regenerate a version with an existing %s before any read or upload", async kind => {
    const result = await locked(), before = Uint8Array.from(bodies.get(result.file_url)!);
    rewriteData(data => {
      if (kind !== "locked file") delete data.locked_file;
      if (kind === "signature receipt") data.signatures.push({ party: "supplier", by: "supplier-person", at: "2026-09-17 10:30:00", version: "1.0", typed_name: "Supplier Alice", file_id: result.file_id, file_url: result.file_url, hash: result.hash });
    });
    contract.custom_final_version_locked = kind === "locked flag" ? 1 : 0;
    requests.length = 0; vi.mocked(clmErpRequest).mockClear();
    const uploadCount = uploads.length, saved = JSON.stringify(contract);
    await expect(lockClmContract(contract)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Create a revised version") });
    expect(requests).toEqual([]); expect(clmErpRequest).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(uploadCount); expect(JSON.stringify(contract)).toBe(saved);
    expect(bodies.get(result.file_url)).toEqual(before);
  });
  it("preserves every original attachment page and appends one execution page", async () => {
    const original = await createPdf("Original third-party contract", 3); const file = seedFile("SOURCE", original);
    contract.custom_contract_document = file.file_url;
    const result = await locked(); const output = bodies.get(result.file_url)!;
    expect((await PDFDocument.load(output)).getPageCount()).toBe(4); expect(result.signature_page).toBe(4);
    expect(result).toMatchObject({ version: "1.0", template_version: CONTRACT_PDF_TEMPLATE_VERSION });
    expect(result.pdf_context).toBeUndefined();
    for (let page = 0; page < 3; page += 1) expect(await contentStreams(output, page)).toBe(await contentStreams(original, page));
    expect(bodies.get(String(file.file_url))).toEqual(original);
  });
  it("verifies bytes re-fetched after upload rather than trusting ERP's success response", async () => {
    corruptUpload = true;
    await expect(locked()).rejects.toThrow("document has changed");
  });
  it.each(["foreign", "public"])("rejects a stored %s artifact", async type => {
    wrongUploadParent = type === "foreign"; publicUpload = type === "public";
    await expect(locked()).rejects.toMatchObject({ status: 403 });
  });
  it("does not return a locked file when upload fails", async () => {
    uploadStatus = 503; await expect(locked()).rejects.toMatchObject({ status: 502 }); expect(uploads).toHaveLength(0);
  });
});

describe("CLM signing authorization and integrity", () => {
  it.each([
    ["legacy name-only payload", { typed_name: "Legal Reviewer", consent: true }],
    ["full name only", { full_legal_name: "Legal Reviewer", consent: true }],
    ["missing full name", { signature: { method: "typed", value: "L. Reviewer", adopted: true }, consent: true }],
    ["unadopted signature", { ...legalSignature(), signature: { method: "typed", value: "L. Reviewer", adopted: false } }],
    ["unsupported method", { ...legalSignature(), signature: { method: "upload", value: "L. Reviewer", adopted: true } }],
    ["blank signature", { ...legalSignature(), signature: { method: "typed", value: "  ", adopted: true } }],
    ["non-text signature", { ...legalSignature(), signature: { method: "typed", value: 123, adopted: true } }],
    ["missing consent", { ...legalSignature(), consent: false }],
  ])("refuses RFQ Legal %s in the PDF service before any file access", async (_label, payload) => {
    contract.custom_rfq = "RFQ-1"; contract.custom_inteva_signatory = "legal@example.test"; await locked();
    rewriteData(data => { data.rfq_workflow = { version: 1, phase: "signature" }; }); requests.length = 0;
    const legal: AccessPrincipal = { ...signatory, role: "legal", sub: "legal@example.test", email: "legal@example.test" };
    const uploadCount = uploads.length;
    await expect(signClmContract(contract, legal, payload as ClmRecord)).rejects.toMatchObject({ status: 422 });
    expect(requests).toEqual([]); expect(uploads).toHaveLength(uploadCount);
  });
  it("requires the persisted RFQ signature phase even when the native status is stale", async () => {
    contract.custom_rfq = "RFQ-1"; await locked();
    rewriteData(data => { data.rfq_workflow = { version: 1, phase: "finance_review" }; }); requests.length = 0;
    await expect(signClmContract(contract, supplier, { typed_name: "Supplier", consent: true })).rejects.toMatchObject({ status: 409 });
    expect(requests).toEqual([]);
  });
  it("stores real RFQ supplier and designated Legal signatures on the same PDF", async () => {
    contract.custom_rfq = "RFQ-1"; contract.custom_inteva_signatory = "legal@example.test"; await locked();
    rewriteData(data => { data.rfq_workflow = { version: 1, phase: "signature" }; });
    const legal: AccessPrincipal = { ...signatory, role: "legal", sub: "legal@example.test", email: "legal@example.test" };
    const supplierReceipt = await signClmContract(contract, supplier, { typed_name: "Supplier Alice", consent: true });
    rewriteData(data => { data.signatures.push(supplierReceipt); });
    const before = uploads.length;
    await expect(signClmContract(contract, { ...legal, role: "finance" }, { typed_name: "Wrong role", consent: true })).rejects.toMatchObject({ status: 403 });
    expect(uploads).toHaveLength(before);
    const receipt = await signClmContract(contract, legal, legalSignature());
    const stored = bodies.get(receipt.file_url)!;
    expect(receipt).toMatchObject({ party: "inteva", role: "legal", by: "legal@example.test", version: "1.0", hash: digest(stored), full_legal_name: "Robert Legal Reviewer", typed_name: "Legal Bob", signature_method: "typed", signature_adopted: true });
    expect(uploads.at(-1)).toMatchObject({ private: "1", parent: "CON-1", file: { attached_to_name: "CON-1" } });
    const text = await pageText(stored, (parseClmData(contract.custom_clm_data).locked_file as ClmLockedFile).signature_page! - 1);
    expect(text).toContain("Supplier Alice");
    expect(text).toContain("Legal Bob");
    const roleLabel = "Legal Manager | SIGNED | v1.0";
    expect(text).toContain(roleLabel);
    const signedPdf = await PDFDocument.load(stored), labelFont = await signedPdf.embedFont(StandardFonts.Helvetica);
    expect(labelFont.widthOfTextAtSize(roleLabel, 8)).toBeLessThan(signedPdf.getPages().at(-1)!.getWidth() * 0.4 - 28);
    const fonts = signedPdf.getPages().at(-1)!.node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    for (const [, ref] of fonts.entries()) {
      const font = signedPdf.context.lookup(ref, PDFDict);
      expect(font.lookup(PDFName.of("Subtype"))).toBe(PDFName.of("Type0"));
      const descendant = font.lookup(PDFName.of("DescendantFonts"), PDFArray).lookup(0, PDFDict);
      expect(descendant.lookup(PDFName.of("FontDescriptor"), PDFDict).lookup(PDFName.of("FontFile2"))).toBeInstanceOf(PDFRawStream);
    }
    expect(text).not.toContain("Inteva authorized signatory");
    expect(text).not.toContain("Robert Legal Reviewer");
  });
  it("stores Legal-first RFQ signing and countersigns its private PDF with the supplier signature", async () => {
    contract.custom_rfq = "RFQ-1"; contract.custom_inteva_signatory = "legal@example.test";
    const evidence = await locked(), original = bodies.get(evidence.file_url)!;
    rewriteData(data => { data.rfq_workflow = { version: 1, phase: "signature" }; });
    const legal: AccessPrincipal = { ...signatory, role: "legal", sub: "legal@example.test", email: "legal@example.test" };
    const first = await signClmContract(contract, legal, legalSignature());
    rewriteData(data => { data.signatures.push(first); });
    const second = await signClmContract(contract, supplier, { typed_name: "Supplier Alice", consent: true });
    const bytes = bodies.get(second.file_url)!;
    expect(first).toMatchObject({ party: "inteva", role: "legal", by: "legal@example.test" });
    expect(second).toMatchObject({ party: "supplier", by: "supplier-person", hash: digest(bytes) });
    expect(second.file_id).not.toBe(first.file_id); expect(second.hash).not.toBe(first.hash);
    const text = await pageText(bytes, evidence.signature_page! - 1);
    expect(text).toContain("Legal Bob");
    expect(text).toContain("Supplier Alice");
    expect(await contentStreams(bytes, 0)).toBe(await contentStreams(original, 0));
    expect(uploads.at(-1)).toMatchObject({ private: "1", parent: "CON-1" });
  });
  it("signs supplier first, then Inteva on the same final page while preserving both signatures and source terms", async () => {
    const evidence = await locked(); const original = bodies.get(evidence.file_url)!;
    const first = await signClmContract(contract, supplier, { typed_name: "Supplier Alice", consent: true });
    rewriteData(data => { data.signatures.push(first); });
    const second = await signClmContract(contract, signatory, { typed_name: "Inteva Bob", consent: true });
    const bytes = bodies.get(second.file_url)!; const text = await pageText(bytes, evidence.signature_page! - 1);
    expect(text).toContain("Supplier Alice");
    expect(text).toContain("Inteva Bob");
    expect(await contentStreams(bytes, 0)).toBe(await contentStreams(original, 0));
    expect(second).toMatchObject({ party: "inteva", by: "signer@example.test", version: "1.0" });
    expect(first).toMatchObject({ party: "supplier", by: "supplier-person", version: "1.0" });
    expect(second.hash).toBe(digest(bytes)); expect(first.hash).not.toBe(second.hash);
  });
  it("rejects changed approved content before fetching or uploading signing bytes", async () => {
    await locked(); requests.length = 0; contract.contract_terms = "Substituted content";
    await expect(signClmContract(contract, supplier, { typed_name: "Supplier", consent: true })).rejects.toThrow("version changed");
    expect(requests).toEqual([]);
  });
  it("rejects cross-supplier signing before file access", async () => {
    await locked(); requests.length = 0;
    await expect(signClmContract(contract, { ...supplier, supplier: "OTHER" }, { typed_name: "Other", consent: true })).rejects.toMatchObject({ status: 403 });
    expect(requests).toEqual([]);
  });
  it("accepts existing quoted supplier identifiers without granting another supplier", async () => {
    contract.party_name = '"SUP-1"'; contract.custom_supplier = '"SUP-1"'; await locked();
    expect((await signClmContract(contract, supplier, { typed_name: "Supplier", consent: true })).party).toBe("supplier");
  });
  it("requires explicit consent and a typed name", async () => {
    await locked();
    await expect(signClmContract(contract, supplier, { typed_name: "Supplier" })).rejects.toThrow("confirm your intent");
    await expect(signClmContract(contract, supplier, { typed_name: "", consent: true })).rejects.toThrow("confirm your intent");
  });
  it.each(["保留原签名", "W".repeat(160)])("does not upload or persist an unsupported or oversized Contract signature: %s", async name => {
    await locked(); const before = JSON.stringify(contract), count = uploads.length;
    requests.length = 0;
    await expect(signClmContract(contract, supplier, { typed_name: name, consent: true })).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/cannot render|does not fit/) });
    expect(uploads).toHaveLength(count); expect(JSON.stringify(contract)).toBe(before);
    expect(requests.every(row => row.method === "GET")).toBe(true);
    expect(parseClmData(contract.custom_clm_data).signatures).toEqual([]);
  });
  it("requires supplier-before-Inteva and the specifically configured Inteva signer", async () => {
    await locked();
    await expect(signClmContract(contract, signatory, { typed_name: "Inteva", consent: true })).rejects.toThrow("supplier must sign");
    const first = await signClmContract(contract, supplier, { typed_name: "Supplier", consent: true }); rewriteData(data => { data.signatures.push(first); });
    await expect(signClmContract(contract, { ...signatory, sub: "other@example.test", email: "other@example.test" }, { typed_name: "Other", consent: true })).rejects.toMatchObject({ status: 403 });
  });
  it("rejects signing outside Pending Signature and duplicate party signatures", async () => {
    await locked(); contract.custom_contract_status = "Approved";
    await expect(signClmContract(contract, supplier, { typed_name: "Supplier", consent: true })).rejects.toThrow("not awaiting signatures");
    contract.custom_contract_status = "Pending Signature"; const first = await signClmContract(contract, supplier, { typed_name: "Supplier", consent: true }); rewriteData(data => { data.signatures.push(first); });
    await expect(signClmContract(contract, supplier, { typed_name: "Supplier", consent: true })).rejects.toThrow("already signed");
  });
  it("requires every configured approval and final lock", async () => {
    await locked(); rewriteData(data => { data.approvals[0].status = "Pending"; });
    await expect(signClmContract(contract, supplier, { typed_name: "Supplier", consent: true })).rejects.toThrow("All required approvals");
  });
  it("refuses to countersign supplier evidence belonging to an older Contract version", async () => {
    await locked(); const first = await signClmContract(contract, supplier, { typed_name: "Supplier", consent: true });
    rewriteData(data => { data.signatures.push({ ...first, version: "0.9" }); });
    const count = uploads.length;
    await expect(signClmContract(contract, signatory, { typed_name: "Inteva", consent: true })).rejects.toThrow("does not match");
    expect(uploads).toHaveLength(count);
  });
  it.each([0, -1, "past the last page", 999, 1.5])("rejects signature page %s instead of silently clamping", async value => {
    const evidence = await locked(); const before = uploads.length;
    const page = typeof value === "string" ? evidence.signature_page! + 1 : value;
    await expect(signClmContract(contract, supplier, { typed_name: "Supplier", consent: true, signature_page: page })).rejects.toThrow("valid signature position");
    expect(uploads).toHaveLength(before);
  });
  it("rejects placement on content pages, overlapping the other party, or empty boxes", async () => {
    const evidence = await locked();
    const base = { page: evidence.signature_page, xNorm: 0.27, yNorm: 0.88, widthNorm: 0.4, heightNorm: 0.11 };
    for (const placement of [{ ...base, page: 1 }, { ...base, xNorm: 0.73 }, { ...base, widthNorm: 0 }, { ...base, yNorm: 0.5 }]) {
      await expect(signClmContract(contract, supplier, { typed_name: "Supplier", consent: true, placement })).rejects.toThrow();
    }
    expect(uploads).toHaveLength(1);
  });
  it("rejects changed source bytes and a changed parent before rendering", async () => {
    const evidence = await locked();
    bodies.set(evidence.file_url, await createPdf("New bytes at same URL"));
    await expect(signClmContract(contract, supplier, { typed_name: "Supplier", consent: true })).rejects.toThrow("document has changed");
    files.find(f => f.name === evidence.file_id)!.attached_to_name = "OTHER";
    await expect(signClmContract(contract, supplier, { typed_name: "Supplier", consent: true })).rejects.toMatchObject({ status: 403 });
  });
  it("rejects a record changed during rendering/upload and never returns a signature receipt", async () => {
    await locked(); vi.mocked(clmErpRequest).mockResolvedValue({ ...contract, modified: "newer" });
    await expect(signClmContract(contract, supplier, { typed_name: "Supplier", consent: true })).rejects.toMatchObject({ status: 409 });
    expect(parseClmData(contract.custom_clm_data).signatures).toEqual([]);
  });
});

describe("CLM PDF validation", () => {
  it("rejects a PNG masquerading as a PDF", async () => {
    const file = seedFile("IMAGE", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    mime = "image/png";
    await expect(readClmPdf(contract, { file_id: String(file.name), file_url: String(file.file_url) })).rejects.toThrow("valid PDF");
  });
  it("rejects syntactically corrupt PDF bytes even when magic and MIME claim PDF", async () => {
    const file = seedFile("BROKEN", new TextEncoder().encode("%PDF-1.7\nThis is not a PDF document."));
    await expect(readClmPdf(contract, { file_id: String(file.name), file_url: String(file.file_url) })).rejects.toThrow("invalid or encrypted");
  });
  it("rejects missing evidence File IDs and mismatched File paths", async () => {
    const evidence: ClmLockedFile = await locked();
    await expect(readClmPdf(contract, { ...evidence, file_id: "MISSING" })).rejects.toMatchObject({ status: 404 });
    await expect(readClmPdf(contract, { ...evidence, file_url: "/private/files/substituted.pdf" })).rejects.toMatchObject({ status: 403 });
  });
});
