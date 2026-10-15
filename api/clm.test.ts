import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./clm";
import { issueInternalAccessToken, issueSupplierAccessToken, type AppRole } from "./rbacAuth";
import type { ClmRecord } from "../src/types/clm";
import { createHash } from "node:crypto";

const modified = "2026-09-17 12:00:00.000000";
const runtime = { schema: 1, approvals: [{ id: "approval-finance", role: "finance", stage: 0, status: "Pending", rule: "POLICY" }], versions: [], audit: [{ id: "AUDIT", action: "save", comment: "Internal commercial concern", by: "buyer@example.test", at: modified, previous_status: "Draft", new_status: "Negotiation" }], signatures: [], sla: [] };
const contract: ClmRecord = { name: "CON-A", modified, party_type: "Supplier", party_name: "SUP-A", custom_supplier: "SUP-A", custom_contract_status: "Negotiation", custom_contract_title: "Supply agreement", custom_contract_type: "NDA", custom_currency: "USD", custom_contract_value: 20, contract_terms: "Agreed supplier terms", custom_contract_document: "/private/files/contract-a.pdf", custom_approval_comments: "Internal approval comments", internal_note: "Internal note", custom_clm_data: JSON.stringify(runtime) };
const file = { name: "FILE-A", attached_to_doctype: "Contract", attached_to_name: "CON-A", file_url: "/private/files/contract-a.pdf", is_private: 1 };
const pdf = Buffer.from("%PDF-1.7\nFixture-only PDF bytes");
const token = (role: AppRole, email = `${role}@example.test`) => issueInternalAccessToken({ role, sub: email, email });
const supplierToken = (supplier = "SUP-A") => issueSupplierAccessToken({ supplier });
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });

function fixture(options: { records?: Record<string, ClmRecord | null>; files?: ClmRecord[]; list?: ClmRecord[]; collections?: Record<string, ClmRecord[]>; failure?: boolean } = {}) {
  const records: Record<string, ClmRecord | null> = { "Contract/CON-A": contract, "File/FILE-A": file, "Supplier/SUP-A": { name: "SUP-A", disabled: 0 }, ...options.records };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://clm-erp.test") throw new Error("Test attempted a non-fixture network request.");
    if (options.failure) throw new Error("private-key=must-not-be-revealed internal database exception");
    const route = decodeURIComponent(url.pathname).replace(/^\/api\//, "");
    if (route.startsWith("resource/DocType/")) return json({ name: route.slice(17), fields: [
      { fieldname: "custom_contract_title", fieldtype: "Data" },
      { fieldname: "custom_contract_document", fieldtype: "Attach" },
      { fieldname: "internal_document", fieldtype: "Attach" },
      { fieldname: "custom_clm_data", fieldtype: "Long Text", read_only: 1 },
      { fieldname: "custom_approval_status", fieldtype: "Select" },
      { fieldname: "custom_final_version_locked", fieldtype: "Check" },
    ] });
    if (route === "resource/Custom Field" || route === "resource/Property Setter" || route === "resource/Has Role") return json([]);
    if (route.startsWith("resource/") && options.collections?.[route.slice(9)]) {
      const filters = JSON.parse(url.searchParams.get("filters") || "[]") as Array<[string, string, unknown]>;
      return json(options.collections[route.slice(9)].filter(row => filters.every(([field, op, value]) => op !== "=" || row[field] === value)));
    }
    if (route === "resource/File") return json(options.files ?? [records["File/FILE-A"]]);
    if (route.startsWith("resource/")) {
      const key = route.slice("resource/".length);
      if (!key.includes("/")) return json(key === "Contract" ? options.list ?? [records["Contract/CON-A"]] : []);
      return json(records[key] ?? {}, records[key] ? 200 : 404);
    }
    if (route.includes("download_file") || route === "/private/files/contract-a.pdf") return new Response(pdf, { headers: { "Content-Type": "application/pdf" } });
    throw new Error(`Unexpected fixture-only route: ${route} (${init?.method || "GET"})`);
  });
  return { fetchMock, mutations: () => fetchMock.mock.calls.filter(([, init]) => ![undefined, "GET", "HEAD"].includes(init?.method)), bytes: () => fetchMock.mock.calls.filter(([input]) => /download_file|\/private\/files\//.test(new URL(String(input)).pathname)) };
}
async function call(accessToken?: string, query: Record<string, unknown> = {}, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const req = { method, headers: accessToken ? { "x-bidsphere-access-token": accessToken } : {}, query, body } as unknown as VercelRequest;
  const res = { status: vi.fn(), json: vi.fn(), send: vi.fn(), end: vi.fn(), setHeader: vi.fn() }; res.status.mockReturnValue(res);
  await handler(req, res as unknown as VercelResponse); return res;
}
const payload = (res: Awaited<ReturnType<typeof call>>) => res.json.mock.calls[0]?.[0];

describe("CLM authenticated endpoint using real policy and fixture ERP only", () => {
  beforeEach(() => {
    vi.stubEnv("BIDSPHERE_SESSION_SECRET", "clm-test-only-session-secret");
    vi.stubEnv("ERPNEXT_URL", "https://clm-erp.test"); vi.stubEnv("ERP_API_KEY", "fixture-key"); vi.stubEnv("ERP_API_SECRET", "fixture-secret");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("authenticates the Purchase Order Contract view before ERP reads and returns an honest unlinked result", async () => {
    const f = fixture({ records: { "Purchase Order/PO-A": { name: "PO-A", supplier: "SUP-A", docstatus: 1, status: "To Receive and Bill" } } });
    expect((await call(undefined, { view: "purchase_order_contract", name: "PO-A" })).status).toHaveBeenCalledWith(401);
    expect(f.fetchMock).not.toHaveBeenCalled();
    const own = await call(supplierToken(), { view: "purchase_order_contract", name: "PO-A" });
    expect(own.status).toHaveBeenCalledWith(200); expect(payload(own).data).toEqual({ purchase_order: "PO-A", contract: null });
    expect((await call(supplierToken("SUP-B"), { view: "purchase_order_contract", name: "PO-A" })).status).toHaveBeenCalledWith(403);
    expect(f.mutations()).toEqual([]);
  });

  it("serves the linked supplier Contract and downloads that exact authoritative version through existing file security", async () => {
    const hash = createHash("sha256").update(pdf).digest("hex");
    const saved = { ...contract, custom_contract_status: "Active", custom_rfq: "RFQ-A", custom_supplier_quotation: "SQ-A", custom_current_version: "1.0", custom_clm_data: JSON.stringify({ ...runtime,
      rfq_workflow: { version: 1, phase: "completed" }, rfq_context: { rfq_id: "RFQ-A", award_id: "AWARD-A", supplier_id: "SUP-A", quotation_id: "SQ-A", contract_required: "Yes" },
      locked_file: { file_id: "FILE-A", file_url: file.file_url, version: "1.0", hash },
    }) };
    const f = fixture({ records: {
      "Contract/CON-A": saved,
      "Purchase Order/PO-A": { name: "PO-A", supplier: "SUP-A", company: "COMPANY", docstatus: 1, status: "To Receive and Bill", custom_clm_contract: "CON-A", custom_clm_rfq: "RFQ-A", custom_clm_award: "AWARD-A", items: [{ item_code: "STEEL", supplier_quotation: "SQ-A" }] },
      "Request for Quotation/RFQ-A": { name: "RFQ-A", company: "COMPANY", contract_required: "Yes", custom_approval_data: JSON.stringify({ contract_decision: { decision: "Yes", contract: "CON-A", award: "AWARD-A", supplier: "SUP-A", quotation: "SQ-A" } }) },
      "Legal Document Review/AWARD-A": { name: "AWARD-A", rfq_name: "RFQ-A", sq_name: "SQ-A", supplier: "SUP-A" },
      "Supplier Quotation/SQ-A": { name: "SQ-A", supplier: "SUP-A", company: "COMPANY", items: [{ item_code: "STEEL", request_for_quotation: "RFQ-A" }] },
    } });
    const summary = await call(supplierToken(), { view: "purchase_order_contract", name: "PO-A" });
    expect(summary.status).toHaveBeenCalledWith(200); expect(payload(summary).data.contract).toMatchObject({ name: "CON-A", status: "Active", pdf_available: true, current_version: "1.0", pdf: { file_id: "FILE-A", hash } });
    expect(JSON.stringify(payload(summary))).not.toContain("Internal commercial concern");
    const downloaded = await call(supplierToken(), { view: "file", name: "CON-A", fieldname: "current_pdf", expected_version: "1.0" });
    expect(downloaded.status).toHaveBeenCalledWith(200); expect(downloaded.send).toHaveBeenCalledWith(pdf);
    expect(downloaded.setHeader).toHaveBeenCalledWith("X-Contract-Pdf-SHA256", hash);
    expect((await call(supplierToken(), { view: "file", name: "CON-A", fieldname: "current_pdf", expected_version: "2.0" })).status).toHaveBeenCalledWith(409);
    expect((await call(supplierToken("SUP-B"), { view: "file", name: "CON-A", fieldname: "current_pdf", expected_version: "1.0" })).status).toHaveBeenCalledWith(403);
    expect(f.mutations()).toEqual([]);
  });

  it.each([
    { docstatus: 0, status: "Draft", custom_approval_data: "{}" },
    { docstatus: 1, status: "Submitted", custom_approval_data: "{}" },
    { docstatus: 1, status: "Submitted", custom_approval_data: JSON.stringify({ clm_initial_request: { version: 1, phase: "complete", request: "OLD" } }) },
  ])("does not let the old Request-retry API become an alternate creation trigger: %j", async state => {
    const f = fixture({ records: { "Request for Quotation/RFQ-RETRY": { name: "RFQ-RETRY", contract_required: "Yes", ...state } } });
    const res = await call(token("procurement_team"), { view: "rfq_initial_request" }, { rfq: "RFQ-RETRY" });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(payload(res).message).toContain("only after a saved supplier award");
    expect(f.mutations()).toEqual([]);
  });

  it("serves a legacy RFQ Contract summary through the existing authenticated endpoint", async () => {
    const f = fixture({ records: { "Request for Quotation/RFQ-LEGACY": { name: "RFQ-LEGACY", modified: "r1", status: "Submitted" } }, list: [] });
    const res = await call(token("procurement"), { view: "rfq_contract", rfq: "RFQ-LEGACY" });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload(res).data).toMatchObject({ rfq: { name: "RFQ-LEGACY", modified: "r1" }, contract_required: "No", decision: "Pending", can_create: false, can_decide: false });
    expect(f.mutations()).toEqual([]);
  });

  it("prefills the initial Team CLM request while Contract creation is still unavailable", async () => {
    const f = fixture({ list: [], records: {
      "Request for Quotation/RFQ-1": { name: "RFQ-1", modified: "r1", status: "Submitted", docstatus: 1, contract_required: "Yes", company: "COMPANY", title: "Awarded material" },
      "Legal Document Review/AWARD-1": { name: "AWARD-1", rfq_name: "RFQ-1", sq_name: "SQ-1", supplier: "SUP-A", company: "COMPANY", grand_total: 2500 },
      "Supplier Quotation/SQ-1": { name: "SQ-1", modified: "q1", supplier: "SUP-A", company: "COMPANY", currency: "USD", grand_total: 2500, docstatus: 1, items: [{ request_for_quotation: "RFQ-1" }] },
    }, collections: { "Legal Document Review": [{ name: "AWARD-1", rfq_name: "RFQ-1" }] } });
    const accessToken = token("procurement_team");
    const summary = await call(accessToken, { view: "rfq_contract", rfq: "RFQ-1" });
    expect(summary.status).toHaveBeenCalledWith(200);
    expect(payload(summary).data).toMatchObject({ decision: "Pending", can_request: true, can_create: false });
    const res = await call(accessToken, { view: "prefill", doctype: "Contract Request", source_doctype: "Request for Quotation", source_name: "RFQ-1" });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload(res).data.payload).toMatchObject({ custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1", supplier: "SUP-A", contract_value: 2500, contract_purpose: "Procurement of goods/services from SUP-A under RFQ RFQ-1." });
    const manager = await call(token("procurement"), { view: "prefill", doctype: "Contract Request", source_doctype: "Request for Quotation", source_name: "RFQ-1" });
    expect(manager.status).toHaveBeenCalledWith(200);
    expect(payload(manager).data.payload).toMatchObject({ custom_rfq: "RFQ-1", supplier: "SUP-A", custom_supplier_quotation: "SQ-1", contract_value: 2500 });
    expect(f.mutations()).toEqual([]);
  });

  it("returns the same persisted RFQ Contract to Contracts and grants Finance read-only access during Legal review", async () => {
    const data = { ...runtime, approvals: [{ id: "LEGAL", role: "legal", stage: 0, status: "Pending", rule: "RFQ" }], rfq_workflow: { version: 1, phase: "legal_review" } };
    const saved = { ...contract, custom_rfq: "RFQ-1", custom_contract_status: "Pending Legal", custom_clm_data: JSON.stringify(data) };
    const f = fixture({ list: [saved], records: { "Contract/CON-A": saved } });
    for (const role of ["legal", "finance", "procurement_team"] as AppRole[]) {
      const res = await call(token(role), { view: "list", doctype: "Contract" });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload(res).data.records.map((row: ClmRecord) => row.name)).toEqual(["CON-A"]);
    }
    const financeDetail = await call(token("finance"), { view: "detail", name: "CON-A" });
    expect(financeDetail.status).toHaveBeenCalledWith(200);
    expect(payload(financeDetail).data.record.name).toBe("CON-A");
    expect(payload(financeDetail).data.actions).toEqual([]);
    const approval = await call(token("finance"), {}, { doctype: "Contract", name: "CON-A", expected_modified: modified, action: "approve" });
    expect(approval.status).toHaveBeenCalledWith(403); expect(f.mutations()).toEqual([]);
  });

  it("authorizes Legal-first signing through Contract Detail while enforcing consent and reviewer identity", async () => {
    const data = { ...runtime, approvals: [{ id: "LEGAL", role: "legal", stage: 0, status: "Approved", rule: "RFQ", by: "legal@example.test" }], rfq_workflow: { version: 1, phase: "signature" }, locked_file: { file_id: "FILE-A", file_url: file.file_url, hash: "a".repeat(64) } };
    const saved = { ...contract, custom_rfq: "RFQ-1", custom_contract_status: "Pending Signature", custom_esign_status: "Pending Supplier", custom_inteva_signatory: "legal@example.test", custom_final_version_locked: 1, custom_clm_data: JSON.stringify(data) };
    const f = fixture({ records: { "Contract/CON-A": saved } });
    const res = await call(token("legal"), { view: "detail", name: "CON-A" });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload(res).data.signature_workflow).toMatchObject({ supplier_status: "Pending", legal_status: "Pending", is_legal_signatory: true, can_sign: true, can_review: true, can_request_signatures: false, document_file_id: "FILE-A" });
    expect(payload(res).data.signature_workflow.blocked_reason).toBeUndefined();
    expect(payload(res).data.actions).toContainEqual(expect.objectContaining({ action: "sign" }));
    const sign = await call(token("legal"), {}, { doctype: "Contract", name: "CON-A", expected_modified: modified, action: "sign", payload: { typed_name: "Legal", consent: false } });
    expect(sign.status).toHaveBeenCalledWith(422);
    const nameOnly = await call(token("legal"), {}, { doctype: "Contract", name: "CON-A", expected_modified: modified, action: "sign", payload: { full_legal_name: "Legal Reviewer", consent: true } });
    expect(nameOnly.status).toHaveBeenCalledWith(422);
    expect(payload(nameOnly).message).toContain("separate typed signature");
    const manager = await call(token("procurement"), { view: "detail", name: "CON-A" });
    expect(payload(manager).data.signature_workflow).toMatchObject({ is_legal_signatory: false, can_review: false, can_sign: false, can_request_signatures: false });
    for (const role of ["procurement", "procurement_team", "finance", "department"] as const) {
      const denied = await call(token(role), {}, { doctype: "Contract", name: "CON-A", expected_modified: modified, action: "sign", payload: { typed_name: "Unauthorized signer", consent: true } });
      expect(denied.status, `${role} must not perform Legal's signature`).toHaveBeenCalledWith(403);
    }
    expect(f.mutations()).toEqual([]);
  });

  it.each([undefined, "invalid-token"])("authenticates RFQ initiation before accessing ERP for %s", async accessToken => {
    const f = fixture(); const res = await call(accessToken, { view: "rfq_contract" }, { rfq: "RFQ-1", expected_modified: "r1", payload: {} });
    expect(res.status).toHaveBeenCalledWith(401); expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it.each(["admin", "legal", "finance", "engineer"] as AppRole[])("denies %s RFQ Contract initiation without ERP writes", async role => {
    const f = fixture(); const res = await call(token(role), { view: "rfq_contract" }, { rfq: "RFQ-1", expected_modified: "r1", payload: {} });
    expect(res.status).toHaveBeenCalledWith(403); expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it("does not expose RFQ Contract summaries to suppliers", async () => {
    const f = fixture(); const res = await call(supplierToken(), { view: "rfq_contract", rfq: "RFQ-1" });
    expect(res.status).toHaveBeenCalledWith(403); expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects ambiguous RFQ query keys and forged endpoint control fields", async () => {
    const f = fixture();
    const ambiguous = await call(token("procurement"), { view: "rfq_contract", rfq: ["RFQ-1", "RFQ-2"] });
    expect(ambiguous.status).toHaveBeenCalledWith(400);
    const forged = await call(token("procurement"), { view: "rfq_contract" }, { rfq: "RFQ-1", request_status: "Approved" });
    expect(forged.status).toHaveBeenCalledWith(400); expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unknown RFQ routing operations before any ERP read or write", async () => {
    const f = fixture();
    const res = await call(token("procurement_team"), { view: "rfq_contract" }, { rfq: "RFQ-1", expected_modified: "r1", decision: "Yes", operation: "approve_for_manager" });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it("blocks generic Contract Request saves from bypassing the RFQ award gate", async () => {
    const f = fixture(); const res = await call(token("procurement"), {}, { doctype: "Contract Request", action: "save", payload: { custom_rfq: "RFQ-1", supplier: "SUP-A" } });
    expect(res.status).toHaveBeenCalledWith(403); expect(payload(res).message).toContain("from its RFQ"); expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it("logs only a safe status and message for RFQ creation failures without changing the error response", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fixture({ failure: true });
    const res = await call(token("procurement_team"), { view: "rfq_contract" }, { rfq: "RFQ-CONFIDENTIAL", expected_modified: "r1", payload: { description: "private contract terms", supporting_document: "/private/files/secret.pdf" } });
    expect(res.status).toHaveBeenCalledWith(503);
    expect(payload(res)).toEqual({ success: false, message: "ERPNext could not be reached. Check the ERP connection, then refresh the RFQ or Contract before retrying." });
    expect(log).toHaveBeenCalledExactlyOnceWith("[rfq-clm] Contract Request creation failed", { status: 503, message: "RFQ Contract Request prerequisites are unavailable." });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-key|RFQ-CONFIDENTIAL|private contract terms|secret\.pdf|fixture-key|fixture-secret/);
  });

  it.each([
    ["ERPNext did not persist the Procurement Team request assignment. Apply the CLM schema migration.", "ERPNext did not persist the Procurement Team request assignment. Apply the CLM schema migration."],
    ["Traceback (most recent call last): password=private-value Authorization: token fixture-key:fixture-secret", "ERPNext rejected the Contract action. Check the required fields and current workflow stage; ask an administrator to inspect the ERP error log if it continues."],
  ])("returns a safe actionable ERP failure through the authenticated RFQ endpoint", async (upstream, expected) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = fixture();
    f.fetchMock.mockImplementation(async () => new Response(JSON.stringify({ _server_messages: JSON.stringify([JSON.stringify({ message: upstream })]) }), { status: 417 }));
    const res = await call(token("procurement_team"), { view: "rfq_contract" }, { rfq: "RFQ-1", expected_modified: "r1", decision: "Yes", operation: "request", payload: {} });
    expect(res.status).toHaveBeenCalledWith(417);
    expect(payload(res)).toEqual({ success: false, message: expected });
    expect(JSON.stringify([payload(res), log.mock.calls])).not.toMatch(/Traceback|private-value|fixture-key|fixture-secret/);
    expect(f.mutations()).toEqual([]);
  });

  it("does not add logging for other Contract endpoint failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fixture({ failure: true });
    await call(token("procurement"), { view: "detail", name: "CON-A" });
    await call(token("procurement"), {}, { doctype: "Contract Request", action: "save", payload: { custom_rfq: "RFQ-1" } });
    expect(log).not.toHaveBeenCalled();
  });

  it.each([undefined, "invalid-token"])("returns 401 before any ERP access for %s", async accessToken => {
    const f = fixture(); const res = await call(accessToken, { view: "detail", doctype: "Contract", name: "CON-A" });
    expect(res.status).toHaveBeenCalledWith(401); expect(f.fetchMock).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("does not accept an access token from the URL", async () => {
    const f = fixture(); const res = await call(undefined, { access_token: token("admin"), view: "metadata" });
    expect(res.status).toHaveBeenCalledWith(401); expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it("denies another supplier and an unrouted internal reviewer", async () => {
    const f = fixture();
    for (const accessToken of [supplierToken("SUP-B"), token("legal"), token("department")]) expect((await call(accessToken, { view: "detail", name: "CON-A" })).status).toHaveBeenCalledWith(403);
    expect(f.bytes()).toEqual([]); expect(f.mutations()).toEqual([]);
  });

  it("returns only supplier-facing Contract data and hides internal approvals/audit", async () => {
    fixture(); const res = await call(supplierToken(), { view: "detail", name: "CON-A" });
    expect(res.status).toHaveBeenCalledWith(200); const data = payload(res).data;
    expect(data.record.contract_terms).toBe(contract.contract_terms); expect(data.record.custom_approval_comments).toBeUndefined(); expect(data.record.internal_note).toBeUndefined(); expect(data.record.custom_clm_data).toBeUndefined();
    expect(data.approvals).toEqual([]); expect(data.audit).toEqual([]); expect(data.allowed_related).toEqual([]);
    expect(data.actions.map((row: { action: string }) => row.action)).toEqual(["supplier_accept", "supplier_redline"]);
  });

  it.each(["Contract", "Contract Request"])("projects only verified saved RFQ award files on existing %s detail without writes", async doctype => {
    const source = { rfq: "RFQ-1", quotation: "SQ-1", legal_review: "LDR-1", supplier: "SUP-A", contract_required: true };
    const documents = [
      { file_id: "TERMS", file_name: "terms.pdf", source_doctype: "Supplier Quotation", source_name: "SQ-1", source_path: "/sourcing/rfq/RFQ-1" },
      { file_id: "REPORT", file_name: "Payments_Report.pdf", source_doctype: "Supplier Quotation", source_name: "SQ-1", source_path: "/sourcing/rfq/RFQ-1" },
    ];
    const savedRuntime = { ...runtime, rfq_source: source, source_documents: documents };
    const saved = { ...contract, supplier: "SUP-A", custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1", custom_clm_data: JSON.stringify(savedRuntime) };
    const f = fixture({ records: {
      [`${doctype}/CON-A`]: saved,
      "Request for Quotation/RFQ-1": { name: "RFQ-1" },
      "Supplier Quotation/SQ-1": { name: "SQ-1", supplier: "SUP-A", items: [{ request_for_quotation: "RFQ-1" }], custom_terms__condition: "/private/files/terms.pdf", custom_warenty_certificate: "/private/files/Payments_Report.pdf" },
      "Legal Document Review/LDR-1": { name: "LDR-1", rfq_name: "RFQ-1", sq_name: "SQ-1" },
    }, collections: {
      "Legal Document Review": [{ name: "LDR-1", rfq_name: "RFQ-1" }],
      File: documents.map(row => ({ name: row.file_id, file_name: row.file_name, file_url: `/private/files/${row.file_name}`, attached_to_doctype: row.source_doctype, attached_to_name: row.source_name, is_folder: 0 })),
    } });
    const res = await call(token("procurement"), { view: "detail", doctype, name: "CON-A" });
    expect(res.status).toHaveBeenCalledWith(200);
    const data = payload(res).data;
    expect(JSON.parse(data.record.custom_clm_data).source_documents).toEqual([documents[0]]);
    expect(JSON.parse(data.record.custom_clm_data).rfq_source).toEqual(source);
    expect(data.audit).toEqual(runtime.audit); expect(data.approvals).toEqual(runtime.approvals);
    expect(data.warnings.join(" ")).toContain("payment, invoice or banking report");
    expect(saved.custom_clm_data).toBe(JSON.stringify(savedRuntime)); expect(f.mutations()).toEqual([]);
  });

  it("keeps authorized Contract history available while omitting unverified source references", async () => {
    const savedRuntime = { ...runtime, rfq_source: { rfq: "RFQ-1", quotation: "SQ-1" }, source_documents: [{ file_id: "UNVERIFIED", file_name: "secret.pdf", source_doctype: "Supplier Quotation", source_name: "SQ-1" }] };
    const f = fixture({ records: { "Contract/CON-A": { ...contract, custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1", custom_clm_data: JSON.stringify(savedRuntime) } } });
    const res = await call(token("finance"), { view: "detail", name: "CON-A" });
    expect(res.status).toHaveBeenCalledWith(200); const data = payload(res).data;
    expect(JSON.parse(data.record.custom_clm_data).source_documents).toEqual([]);
    expect(data.audit).toEqual(runtime.audit); expect(data.approvals).toEqual(runtime.approvals);
    expect(data.warnings).toContain("Saved supporting documents are hidden because their RFQ award source could not be verified.");
    expect(f.mutations()).toEqual([]);
  });

  it("keeps a legacy Contract Request readable when its optional source evidence is malformed", async () => {
    const f = fixture({ records: { "Contract Request/CR-A": { name: "CR-A", custom_rfq: "RFQ-1", custom_clm_data: "{invalid" } } });
    const res = await call(token("procurement"), { view: "detail", doctype: "Contract Request", name: "CR-A" });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload(res).data.record.custom_clm_data).toBe("");
    expect(payload(res).data.warnings.join(" ")).toContain("saved lifecycle evidence is invalid");
    expect(f.mutations()).toEqual([]);
  });

  it("does not load internal RFQ source documents before authorization or for a supplier read", async () => {
    const f = fixture({ records: { "Contract/CON-A": { ...contract, custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1", custom_clm_data: JSON.stringify({ ...runtime, source_documents: [{ file_id: "INTERNAL" }] }) } } });
    const denied = await call(token("legal"), { view: "detail", name: "CON-A" });
    expect(denied.status).toHaveBeenCalledWith(403);
    const supplier = await call(supplierToken(), { view: "detail", name: "CON-A" });
    expect(supplier.status).toHaveBeenCalledWith(200); expect(payload(supplier).data.record.custom_clm_data).toBeUndefined();
    expect(f.fetchMock.mock.calls.some(([url]) => /Request%20for%20Quotation|Supplier%20Quotation|Legal%20Document%20Review/.test(String(url)))).toBe(false);
  });

  it("filters lists by ownership or generated reviewer assignments", async () => {
    fixture({ list: [contract, { ...contract, name: "CON-B", party_name: "SUP-B", custom_supplier: "SUP-B", custom_clm_data: JSON.stringify({ ...runtime, approvals: [] }) }] });
    for (const accessToken of [supplierToken(), token("finance")]) {
      const res = await call(accessToken); expect(res.status).toHaveBeenCalledWith(200);
      expect(payload(res).data.records.map((row: ClmRecord) => row.name)).toEqual(["CON-A"]);
    }
  });

  it("returns only supplier-visible schema and no create/edit permissions", async () => {
    fixture(); const res = await call(supplierToken(), { view: "metadata" });
    const data = payload(res).data;
    expect(data.editableFields).toEqual({}); expect(data.allowedCreate).toEqual([]);
    expect(data.fields.Contract.map((field: { fieldname: string }) => field.fieldname)).toContain("custom_contract_document");
    expect(data.fields.Contract.map((field: { fieldname: string }) => field.fieldname)).not.toContain("internal_document");
    expect(data.fields.Contract.map((field: { fieldname: string }) => field.fieldname)).not.toContain("custom_clm_data");
  });

  it("excludes workflow and signing evidence from editable metadata", async () => {
    fixture(); const res = await call(token("procurement_team"), { view: "metadata" }); const data = payload(res).data;
    expect(res.status).toHaveBeenCalledWith(200); expect(data.editableFields.Contract).toContain("custom_contract_title");
    expect(data.editableFields.Contract).not.toContain("custom_clm_data"); expect(data.editableFields.Contract).not.toContain("custom_final_version_locked"); expect(data.editableFields.Contract).not.toContain("custom_approval_status");
    expect(data.allowedCreate).not.toContain("Contract Approval Matrix");
  });

  it.each([
    { view: ["detail", "file"] }, { view: "detail", doctype: ["Contract", "Contract Request"] }, { view: "detail", name: ["CON-A", "CON-B"] }, { view: "lookup", doctype: "User", query: ["a", "b"] }, { view: "invalid" }, { doctype: "User" },
  ])("rejects malformed/unsupported query %j", async query => {
    const f = fixture(); const res = await call(token("procurement"), query);
    expect(res.status).toHaveBeenCalledWith(400); expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it.each(["{not-json", [], 42, { doctype: "User", action: "save" }])("rejects malformed body %j", async body => {
    const f = fixture(); const res = await call(token("procurement"), {}, body);
    expect(res.status).toHaveBeenCalledWith(400); expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it("denies supplier procurement lookup and prefill before source reads", async () => {
    const f = fixture();
    expect((await call(supplierToken(), { view: "lookup", doctype: "Supplier" })).status).toHaveBeenCalledWith(403);
    expect((await call(supplierToken(), { view: "prefill", source_doctype: "Purchase Order", source_name: "PO-A" })).status).toHaveBeenCalledWith(403);
    expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it("serves authorized private PDF bytes with the actual MIME type", async () => {
    const f = fixture(); const res = await call(supplierToken(), { view: "file", name: "CON-A", fieldname: "custom_contract_document" });
    expect(res.status).toHaveBeenCalledWith(200); expect(res.send).toHaveBeenCalledWith(pdf); expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf"); expect(f.bytes()).toHaveLength(1);
  });

  it("denies tampered File IDs and cross-parent attachments before serving bytes", async () => {
    const f = fixture({ files: [{ ...file, attached_to_name: "CON-B" }] });
    expect((await call(supplierToken(), { view: "file", name: "CON-A", fieldname: "custom_contract_document", file_id: "FILE-OTHER" })).status).toHaveBeenCalledWith(403);
    expect((await call(supplierToken(), { view: "file", name: "CON-A", fieldname: "custom_contract_document" })).status).toHaveBeenCalledWith(403);
    expect(f.bytes()).toEqual([]);
  });

  it("denies private internal Attach fields to suppliers", async () => {
    const f = fixture({ records: { "Contract/CON-A": { ...contract, internal_document: "/private/files/internal.pdf" } }, files: [{ ...file, file_url: "/private/files/internal.pdf" }] });
    const res = await call(supplierToken(), { view: "file", name: "CON-A", fieldname: "internal_document" });
    expect(res.status).toHaveBeenCalledWith(403); expect(f.bytes()).toEqual([]);
  });

  it("returns 404 for missing records and safe actionable 503 for ERP connection failures", async () => {
    fixture({ records: { "Contract/CON-A": null } }); expect((await call(token("procurement"), { view: "detail", name: "CON-A" })).status).toHaveBeenCalledWith(404);
    vi.restoreAllMocks(); fixture({ failure: true }); const res = await call(token("procurement"), { view: "detail", name: "CON-A" });
    expect(res.status).toHaveBeenCalledWith(503); expect(JSON.stringify(payload(res))).not.toContain("private-key"); expect(payload(res).message).toBe("ERPNext could not be reached. Check the ERP connection, then refresh the RFQ or Contract before retrying.");
  });

  it("rejects forged workflow values and locked content updates without ERP mutations", async () => {
    const f = fixture({ records: { "Contract/CON-A": { ...contract, custom_contract_status: "Draft" } } });
    let res = await call(token("procurement"), {}, { doctype: "Contract", name: "CON-A", action: "save", expected_modified: modified, payload: { custom_approval_status: "Approved", custom_clm_data: "forged" } });
    expect(res.status).toHaveBeenCalledWith(403); expect(f.mutations()).toEqual([]);
    vi.restoreAllMocks(); const locked = fixture({ records: { "Contract/CON-A": { ...contract, custom_contract_status: "Approved", custom_final_version_locked: 1 } } });
    res = await call(token("procurement"), {}, { doctype: "Contract", name: "CON-A", action: "save", expected_modified: modified, payload: { contract_terms: "Replaced after approval" } });
    expect(res.status).toHaveBeenCalledWith(403); expect(locked.mutations()).toEqual([]);
  });

  it("rejects approval by an internal role absent from the generated route", async () => {
    const f = fixture({ records: { "Contract/CON-A": { ...contract, custom_contract_status: "Under Review" } } });
    const res = await call(token("legal"), {}, { doctype: "Contract", name: "CON-A", action: "approve", expected_modified: modified });
    expect(res.status).toHaveBeenCalledWith(403); expect(f.mutations()).toEqual([]);
  });

  it("requires both the configured reviewer role and the explicitly assigned user", async () => {
    const namedRoute = { ...runtime, approvals: [{ ...runtime.approvals[0], user: "named-reviewer@example.test" }] };
    const f = fixture({ records: { "Contract/CON-A": { ...contract, custom_contract_status: "Under Review", custom_clm_data: JSON.stringify(namedRoute) } } });
    const res = await call(token("department", "named-reviewer@example.test"), { view: "detail", name: "CON-A" });
    expect(res.status).toHaveBeenCalledWith(403); expect(f.mutations()).toEqual([]);
    const finance = await call(token("finance", "named-reviewer@example.test"), { view: "detail", name: "CON-A" });
    expect(finance.status).toHaveBeenCalledWith(200); expect(payload(finance).data.actions.some((row: { action: string }) => row.action === "approve")).toBe(true);
  });
});
