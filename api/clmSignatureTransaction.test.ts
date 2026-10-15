import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { applyClmAction, clmSnapshotHash, parseClmData, type ClmDeps } from "./clmCore";
import { lockClmContract, signClmContract, readClmPdf } from "./clmSignature";
import { clmNow } from "./clmTime";
import { assertClmSupplierPoReady } from "./clmSupplierPoWorkflow";
import { clmErpRequest } from "./clmErp";
import type { AccessPrincipal } from "./rbacAuth";
import type { ClmRecord } from "../src/types/clm";

vi.mock("./authSession.js", () => ({ readErpAuthConfig: () => ({ baseUrl: "https://erp.fixture.invalid", key: "fixture-key", secret: "fixture-secret" }) }));
vi.mock("./clmErp.js", () => ({ clmErpRequest: vi.fn(), clmResource: (dt: string, name: string) => `resource/${encodeURIComponent(dt)}/${encodeURIComponent(name)}` }));

const legal: AccessPrincipal = { typ: "internal", role: "legal", sub: "legal@example.test", email: "legal@example.test", iat: 1, exp: Number.MAX_SAFE_INTEGER };
const supplier: AccessPrincipal = { typ: "supplier", supplier: "SUP-1", sub: "supplier-person", iat: 1, exp: Number.MAX_SAFE_INTEGER };
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });

async function pdfPageText(bytes: Uint8Array, pageIndex: number, decoded = false) {
  const pdf = await PDFDocument.load(bytes);
  const contents = pdf.getPage(pageIndex).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map(ref => pdf.context.lookup(ref)) : [contents];
  const raw = streams.filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
    .map(stream => Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")).join("\n");
  if (!decoded) return raw;
  const fonts = pdf.getPage(pageIndex).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
  const maps = new Map<string, Map<string, string>>();
  for (const [name, ref] of fonts.entries()) {
    const mapping = pdf.context.lookup(ref, PDFDict).lookup(PDFName.of("ToUnicode")), characters = new Map<string, string>();
    if (mapping instanceof PDFRawStream) {
      const cmap = Buffer.from(decodePDFRawStream(mapping).decode()).toString("latin1");
      const entries = /beginbfchar([\s\S]*?)endbfchar/.exec(cmap)?.[1] || "";
      for (const match of entries.matchAll(/<([a-f0-9]+)>\s*<([a-f0-9]+)>/gi)) characters.set(match[1].toUpperCase(), Buffer.from(match[2], "hex").swap16().toString("utf16le"));
    }
    maps.set(name.asString().slice(1), characters);
  }
  return [...raw.matchAll(/BT\s+([\s\S]*?)ET/g)].map(block => {
    const name = /\/([^\s]+)\s+[\d.]+\s+Tf/.exec(block[1])?.[1], word = /<([a-f0-9]+)>\s*Tj/i.exec(block[1])?.[1];
    if (!word || !name) return "";
    const characters = maps.get(name);
    return characters?.size ? (word.match(/.{4}/g) || []).map(code => characters.get(code.toUpperCase()) || "�").join("") : Buffer.from(word, "hex").toString("latin1");
  }).join("\n");
}

/** Real locking/signing and action code; only the external ERP transport is replaced. */
async function fixture() {
  const files = new Map<string, ClmRecord>();
  const bodies = new Map<string, Uint8Array>();
  const events: string[] = [];
  const failures = { upload: false, save: false };
  let revision = 1;
  let stored: ClmRecord = {
    name: "CON-1", modified: String(revision), party_type: "Supplier", party_name: "SUP-1", custom_supplier: "SUP-1",
    custom_contract_title: "Approved supply agreement", custom_contract_type: "Supply", custom_contract_value: 4500, custom_currency: "USD",
    contract_terms: "Deliver the approved conforming parts.", start_date: "2026-01-01", end_date: "2026-12-31",
    custom_inteva_signatory: "legal@example.test", custom_current_version: "1.0", custom_final_version_locked: 1,
    custom_contract_status: "Pending Signature", custom_esign_status: "Pending Supplier", custom_approval_status: "Approved",
    custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1",
  };
  const source: Record<string, ClmRecord> = {
    "Purchase Order/PO-1": { name: "PO-1", docstatus: 1, status: "To Receive and Bill", supplier: "SUP-1", company: "Netlink", currency: "USD", grand_total: 4500, custom_clm_contract: "CON-1", custom_clm_rfq: "RFQ-1", custom_clm_award: "AWARD-1", items: [{ item_code: "PART-1", supplier_quotation: "SQ-1" }] },
    "Request for Quotation/RFQ-1": { name: "RFQ-1", company: "Netlink", contract_required: "Yes", custom_approval_data: JSON.stringify({ contract_decision: { decision: "Yes", contract: "CON-1", award: "AWARD-1", supplier: "SUP-1", quotation: "SQ-1" } }) },
    "Legal Document Review/AWARD-1": { name: "AWARD-1", rfq_name: "RFQ-1", supplier: "SUP-1", sq_name: "SQ-1" },
    "Supplier Quotation/SQ-1": { name: "SQ-1", supplier: "SUP-1", company: "Netlink", items: [{ item_code: "PART-1", request_for_quotation: "RFQ-1" }] },
  };
  const get = () => structuredClone(stored);
  vi.mocked(clmErpRequest).mockImplementation(async (method, path) => {
    if (method !== "GET") throw new Error(`Unexpected ERP write ${method} ${path}`);
    if (path === "resource/Contract/CON-1") { events.push("contract-concurrency-read"); return get(); }
    // The PDF reads linked presentation context before locking; no sourcing
    // record is written or substituted for the Contract concurrency read.
    if (path === "resource/Request%20for%20Quotation/RFQ-1") return { name: "RFQ-1", company: "Netlink", title: "Approved supply procurement", items: [{ name: "RFQ-ITEM-1", item_code: "PART-1" }] };
    if (path === "resource/Supplier%20Quotation/SQ-1") return { name: "SQ-1", company: "Netlink", supplier: "SUP-1", request_for_quotation: "RFQ-1", items: [{ item_code: "PART-1", item_name: "Approved conforming part", qty: 100, uom: "Nos", request_for_quotation: "RFQ-1", request_for_quotation_item: "RFQ-ITEM-1" }] };
    if (path === "resource/Supplier/SUP-1") return { name: "SUP-1", supplier_name: "Fixture supplier" };
    throw new Error(`Unexpected ERP request ${method} ${path}`);
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input)), path = decodeURIComponent(url.pathname);
    if (path === "/api/method/upload_file") {
      if (failures.upload) return json({ message: "Fixture upload failure" }, 503);
      const form = init?.body as FormData, upload = form.get("file") as File;
      const bytes = new Uint8Array(await upload.arrayBuffer()), name = `FILE-${files.size + 1}`;
      const file: ClmRecord = { name, file_url: `/private/files/${name}.pdf`, file_name: upload.name, is_private: Number(form.get("is_private")), attached_to_doctype: form.get("doctype"), attached_to_name: form.get("docname") };
      files.set(name, file); bodies.set(String(file.file_url), bytes); events.push(`upload:${name}`);
      return new Response(JSON.stringify({ message: file }), { headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/resource/File") {
      const filters = JSON.parse(url.searchParams.get("filters") || "[]") as Array<[string, string, unknown]>;
      return json([...files.values()].filter(row => filters.every(([field, op, value]) => op !== "=" || row[field] === value)));
    }
    if (path.startsWith("/api/resource/File/")) {
      const row = files.get(path.slice("/api/resource/File/".length)); return json(row || {}, row ? 200 : 404);
    }
    if (path.startsWith("/private/files/") || path === "/api/method/frappe.utils.file_manager.download_file") {
      const fileUrl = path.startsWith("/private/files/") ? path : url.searchParams.get("file_url") || "";
      const bytes = bodies.get(fileUrl); events.push(`pdf-read:${fileUrl}`);
      return new Response(bytes ? Uint8Array.from(bytes).buffer : "Missing", { status: bytes ? 200 : 404, headers: { "Content-Type": "application/pdf" } });
    }
    throw new Error(`Unexpected PDF transport request ${path}`);
  });

  const data = parseClmData(null);
  data.version = "1.0";
  data.rfq_source = { rfq: "RFQ-1", award: "AWARD-1", quotation: "SQ-1", supplier: "SUP-1", contract_required: true };
  data.rfq_workflow = { version: 1, phase: "signature" };
  data.approvals = [{ id: "LEGAL-1", role: "legal", stage: 0, rule: "RFQ Legal Review", status: "Approved", by: "legal@example.test", at: "2026-09-28 09:00:00" }];
  data.locked_hash = clmSnapshotHash("Contract", stored);
  data.locked_file = await lockClmContract({ ...stored, custom_final_version_locked: 0 });
  stored.custom_clm_data = JSON.stringify(data);
  events.length = 0;

  const deps: ClmDeps = {
    load: vi.fn(async (dt, name) => {
      if (dt === "Contract" && name === "CON-1") { events.push("contract-read"); return get(); }
      if (dt === "User" && name === "legal@example.test") return { name, enabled: 1, roles: [{ role: "Legal Manager" }] };
      if (source[`${dt}/${name}`]) return structuredClone(source[`${dt}/${name}`]);
      throw new Error(`Unexpected document read ${dt}/${name}`);
    }),
    list: vi.fn(async () => []), create: vi.fn(async () => { throw new Error("Signing must not create a Contract"); }),
    save: vi.fn(async (dt, record) => {
      if (dt !== "Contract" || record.name !== "CON-1" || record.modified !== stored.modified) throw new Error("Unexpected or concurrent save");
      if (failures.save) throw new Error("ERP Contract save failed");
      stored = structuredClone({ ...record, modified: String(++revision) }); events.push("contract-saved"); return get();
    }),
    now: () => clmNow(), sign: signClmContract, verifyPdf: readClmPdf,
    notify: vi.fn(async (_dt, record, _action, approvals) => {
      // A notification cannot observe an uncommitted receipt or workflow phase.
      expect(record).toEqual(get());
      if (approvals.some(row => row.role === "finance" && row.status === "Pending")) {
        expect(parseClmData(get().custom_clm_data).signatures).toContainEqual(expect.objectContaining({ party: "inteva", role: "legal", by: "legal@example.test" }));
        expect(get().custom_contract_status).toBe("Pending Finance"); events.push("finance-notified");
      }
    }),
  };
  const sign = (actor: AccessPrincipal) => applyClmAction({ doctype: "Contract", name: "CON-1", expected_modified: get().modified, action: "sign", comment: actor.typ === "internal" ? "  Reviewed and authorized for electronic signature.  " : "", payload: actor.typ === "supplier" ? { full_legal_name: "Supplier Alice", signer_email: "alice@supplier.test", signature: { method: "typed", value: "Supplier Alice", adopted: true }, consent: true, request_id: "supplier-sign-1" } : { full_legal_name: "Robert Legal Reviewer", signature: { method: "typed", value: "Legal Bob", adopted: true }, consent: true } }, actor, deps);
  // This suite exercises real acceptance/signing and PDF bytes after the saved
  // internal handoff. PO creation has its own full lifecycle integration suite.
  const handoff = () => {
    const current = parseClmData(stored.custom_clm_data);
    current.approvals = current.approvals.filter(row => row.role !== "finance");
    current.approvals.push({ id: "FINANCE-1", role: "finance", stage: 1, rule: "Finance", status: "Approved", by: "finance@example.test", at: clmNow() });
    current.rfq_context = { rfq_id: "RFQ-1", award_id: "AWARD-1", supplier_id: "SUP-1", quotation_id: "SQ-1", contract_required: "Yes" };
    current.procurement_completion = { purchase_order: "PO-1", by: "team@example.test", role: "procurement_team", at: clmNow(), rfq: "RFQ-1", award: "AWARD-1", quotation: "SQ-1", supplier: "SUP-1" };
    current.rfq_workflow = { version: 1, phase: "completed" };
    stored = { ...stored, modified: String(++revision), custom_contract_status: "Active", custom_clm_data: JSON.stringify(current) };
  };
  const accept = () => {
    const document = parseClmData(stored.custom_clm_data).signatures.find(row => row.party === "inteva")!;
    return applyClmAction({ doctype: "Contract", name: "CON-1", expected_modified: get().modified, action: "supplier_accept", payload: { consent: true, expected_version: "1.0", document_file_id: document.file_id, document_hash: document.hash, request_id: "supplier-accept-1" } }, supplier, deps);
  };
  return { get, sign, handoff, accept, deps, files, bodies, events, failures, locked: data.locked_file };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
  vi.mocked(clmErpRequest).mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("RFQ signature transaction with real PDF evidence", () => {
  it("preserves Legal and Finance while supplier acceptance precedes the real countersignature", async () => {
    const f = await fixture(), lockedBytes = f.bodies.get(f.locked.file_url)!;
    await expect(f.sign(supplier)).rejects.toThrow("not available");
    await f.sign(legal);
    const legalData = parseClmData(f.get().custom_clm_data), legalReceipt = legalData.signatures[0];
    expect(legalData.rfq_workflow?.phase).toBe("finance_review");
    expect(f.events.indexOf("contract-saved")).toBeLessThan(f.events.indexOf("finance-notified"));
    f.handoff();
    await expect(f.sign(supplier)).rejects.toThrow("not available");
    const original = f.get(), before = parseClmData(original.custom_clm_data);
    const accepted = await f.accept();
    expect(accepted.supplier_workflow).toMatchObject({ acceptance_status: "Accepted", can_sign_contract: true, can_accept_po: false });
    expect(accepted.actions).toContainEqual(expect.objectContaining({ action: "sign" }));
    expect(accepted.signature_workflow).toMatchObject({ can_sign: true, supplier_status: "Pending", legal_status: "Signed", document_file_id: legalReceipt.file_id });
    await expect(assertClmSupplierPoReady(supplier, "PO-1", { load: f.deps.load, verifyPdf: readClmPdf })).rejects.toThrow("E-Signature");
    const afterAcceptance = parseClmData(f.get().custom_clm_data);
    const result = await f.sign(supplier), saved = f.get(), completed = parseClmData(saved.custom_clm_data), receipt = completed.signatures.at(-1)!;
    expect(result.supplier_workflow).toMatchObject({ acceptance_status: "Accepted", signature_status: "Signed", can_accept_po: true });
    expect(result.signature_workflow).toMatchObject({ can_sign: false, supplier_status: "Signed", legal_status: "Signed", document_file_id: receipt.file_id });
    expect(completed.signatures).toHaveLength(2); expect(completed.signatures[0]).toEqual(legalReceipt);
    expect(receipt).toMatchObject({ party: "supplier", full_legal_name: "Supplier Alice", signer_email: "alice@supplier.test", version: "1.0", acceptance_id: afterAcceptance.supplier_po_acceptance!.id, source_hash: legalReceipt.hash });
    expect(completed.approvals).toEqual(before.approvals); expect(completed.procurement_completion).toEqual(before.procurement_completion);
    expect(completed.rfq_workflow).toEqual(before.rfq_workflow); expect(saved.custom_contract_status).toBe("Active");
    expect(completed.audit.slice(0, before.audit.length)).toEqual(before.audit);
    expect(completed.audit.filter(row => row.action === "e_signed")).toContainEqual(expect.objectContaining({ contract_id: "CON-1", signature_status: "Signed", signature_party: "supplier" }));
    expect(completed.audit.filter(row => row.action === "finance_review_started")).toHaveLength(1);
    const finalBytes = f.bodies.get(receipt.file_url)!;
    expect(receipt.hash).toBe(digest(finalBytes)); expect(receipt.file_id).not.toBe(legalReceipt.file_id);
    expect(f.files.get(receipt.file_id)).toMatchObject({ is_private: 1, attached_to_doctype: "Contract", attached_to_name: "CON-1" });
    expect(await pdfPageText(finalBytes, 0)).toBe(await pdfPageText(lockedBytes, 0));
    expect(f.bodies.get(f.locked.file_url)).toEqual(lockedBytes);
    expect(digest(f.bodies.get(legalReceipt.file_url)!)).toBe(legalReceipt.hash);
    const signatures = await pdfPageText(finalBytes, f.locked.signature_page! - 1, true);
    for (const name of ["Supplier Alice", "Legal Bob"]) expect(signatures).toContain(name);
    expect(signatures).toContain("SUPPLIER SIGNED | v1.0");
    expect(signatures).toContain("Legal Manager | SIGNED | v1.0");
    await expect(assertClmSupplierPoReady(supplier, "PO-1", { load: f.deps.load, verifyPdf: readClmPdf })).resolves.toMatchObject({ supplierSignedAt: receipt.at });
    expect(f.deps.create).not.toHaveBeenCalled();
  });

  it.each(["upload", "save"] as const)("keeps the supplier unsigned when countersignature %s fails", async failure => {
    const f = await fixture(); await f.sign(legal); f.handoff(); await f.accept();
    const before = f.get(); f.failures[failure] = true; vi.mocked(f.deps.notify!).mockClear();
    await expect(f.sign(supplier)).rejects.toThrow(failure === "upload" ? "could not be stored privately" : "ERP Contract save failed");
    expect(f.get()).toEqual(before); expect(f.deps.notify).not.toHaveBeenCalled();
    await expect(assertClmSupplierPoReady(supplier, "PO-1", { load: f.deps.load, verifyPdf: readClmPdf })).rejects.toThrow();
  });

  it.each(["upload", "save"] as const)("does not advance or notify Finance when the Legal signature %s fails", async failure => {
    const f = await fixture();
    const before = f.get(); f.failures[failure] = true; f.events.length = 0; vi.mocked(f.deps.notify!).mockClear();
    await expect(f.sign(legal)).rejects.toThrow(failure === "upload" ? "could not be stored privately" : "ERP Contract save failed");
    expect(await f.deps.load("Contract", "CON-1")).toEqual(before);
    expect(parseClmData(f.get().custom_clm_data).rfq_workflow?.phase).toBe("signature");
    expect(f.deps.notify).not.toHaveBeenCalled(); expect(f.events).not.toContain("finance-notified");
  });
});
