import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { uploadClmSupplierEvidence } from "./clmSupplierUpload";
import handler from "./clm";
import { issueSupplierAccessToken, type AccessPrincipal } from "./rbacAuth";
import type { ClmRecord } from "../src/types/clm";

const transport = vi.hoisted(() => ({ request: vi.fn(), save: vi.fn(), list: vi.fn(), fields: vi.fn() }));
vi.mock("./clmErp.js", () => ({ clmErpRequest: transport.request, clmResource: (dt: string, name?: string) => `resource/${encodeURIComponent(dt)}${name ? `/${encodeURIComponent(name)}` : ""}`, createClmDependencies: () => ({ save: transport.save }), listClmErp: transport.list, getClmFields: transport.fields }));
const principal: AccessPrincipal = { typ: "supplier", sub: "portal-a@example.test", supplier: "SUP-A", iat: 1, exp: 9999999999999 };
const modified = "2026-09-17 12:00:00.000000";
const fileBytes = Buffer.from("%PDF-1.7 supplier supporting document");
const runtime = { schema: 1, approvals: [], signatures: [], sla: [], version: "VER-1", versions: [{ id: "VER-1", number: "1.0", author: "buyer@example.test", at: modified, comment: "Original", hash: "original-hash", content: { contract_terms: "Original terms" } }], audit: [{ id: "AUDIT-1", action: "negotiate", by: "buyer@example.test", at: modified, previous_status: "Draft", new_status: "Negotiation", comment: "Review" }] };
const contract: ClmRecord = { name: "CON-A", modified, party_type: "Supplier", party_name: "SUP-A", custom_supplier: "SUP-A", custom_contract_status: "Negotiation", contract_terms: "Original terms", custom_clm_data: JSON.stringify(runtime) };
function multipart(options: { content?: Buffer; fields?: Array<[string, string]>; twoFiles?: boolean } = {}) {
  const boundary = "clm-fixture-boundary";
  const entries = options.fields ?? [["doctype", "Contract"], ["docname", "CON-A"], ["is_private", "1"]];
  const parts: Buffer[] = entries.map(([name, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  for (let index = 0; index < (options.twoFiles ? 2 : 1); index++) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evidence.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), options.content ?? fileBytes, Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { bytes: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}
function request(body: ReturnType<typeof multipart> = multipart(), stream = false): VercelRequest {
  const req = { method: "POST", headers: { "content-type": body.contentType }, body: stream ? undefined : body.bytes,
    async *[Symbol.asyncIterator]() { yield body.bytes.subarray(0, 20); yield body.bytes.subarray(20); },
  }; return req as unknown as VercelRequest;
}
function fixture(options: { contract?: ClmRecord; file?: Partial<ClmRecord>; content?: Buffer; storedContent?: Buffer; uploadStatus?: number; missingId?: boolean; saveError?: Error } = {}) {
  const content = options.content ?? fileBytes;
  const record = structuredClone(options.contract ?? contract);
  const file = { name: "FILE-UPLOAD", file_url: "/private/files/evidence.pdf", file_name: "evidence.pdf", attached_to_doctype: "Contract", attached_to_name: "CON-A", is_private: 1, file_size: content.length, content_hash: createHash("md5").update(content).digest("hex"), ...options.file };
  transport.request.mockImplementation(async (method: string, path: string) => {
    if (method === "GET" && path === "resource/Contract/CON-A") return structuredClone(record);
    if (method === "GET" && path === "resource/File/FILE-UPLOAD") return structuredClone(file);
    throw new Error(`Unexpected fixture request ${method} ${path}`);
  });
  transport.save.mockImplementation(async (_doctype: string, doc: ClmRecord) => { if (options.saveError) throw options.saveError; return { ...structuredClone(doc), modified: "2026-09-17 12:01:00.000000" }; });
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input)); if (url.origin !== "https://clm-upload.test") throw new Error("Non-fixture upload request");
    if (url.pathname === "/api/method/upload_file" && init?.method === "POST") return new Response(JSON.stringify({ message: options.missingId ? {} : { name: "FILE-UPLOAD" } }), { status: options.uploadStatus ?? 200, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/api/resource/File/FILE-UPLOAD") return new Response(JSON.stringify({ data: file }), { headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/private/files/evidence.pdf" || url.pathname.includes("download_file")) return new Response(options.storedContent ?? content, { headers: { "Content-Type": "application/pdf" } });
    throw new Error(`Unexpected fixture upload readback ${url.pathname}`);
  });
  return { fetchMock, record, file };
}
async function endpoint(req: VercelRequest, accessToken?: string, query: Record<string, unknown> = {}) {
  req.query = { view: "supplier_upload", name: "CON-A", expected_modified: modified, ...query } as VercelRequest["query"];
  if (accessToken) req.headers["x-bidsphere-access-token"] = accessToken;
  const res = { status: vi.fn(), json: vi.fn(), send: vi.fn(), end: vi.fn(), setHeader: vi.fn() }; res.status.mockReturnValue(res);
  await handler(req, res as unknown as VercelResponse); return res;
}

describe("supplier negotiation supporting-document upload", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("BIDSPHERE_SESSION_SECRET", "fixture-only-supplier-upload-secret");
    vi.stubEnv("ERPNEXT_URL", "https://clm-upload.test"); vi.stubEnv("ERP_API_KEY", "fixture-key"); vi.stubEnv("ERP_API_SECRET", "fixture-secret");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it.each([false, true])("records service-owned upload provenance and preserves all prior versions (stream=%s)", async stream => {
    const { fetchMock, record } = fixture(); const before = structuredClone(record);
    const result = await uploadClmSupplierEvidence(request(multipart(), stream), principal, "CON-A", modified);
    expect(result).toMatchObject({ file_id: "FILE-UPLOAD", file_url: "/private/files/evidence.pdf", file_name: "evidence.pdf", supplier: "SUP-A", by: principal.sub, modified: "2026-09-17 12:01:00.000000", sha256: createHash("sha256").update(fileBytes).digest("hex") });
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect([...form.keys()].sort()).toEqual(["docname", "doctype", "file", "is_private"]);
    expect(form.get("is_private")).toBe("1"); expect(form.get("doctype")).toBe("Contract"); expect(form.get("docname")).toBe("CON-A");
    expect(transport.save).toHaveBeenCalledTimes(1); const saved = transport.save.mock.calls[0][1]; const data = JSON.parse(saved.custom_clm_data);
    expect(data.versions).toEqual(runtime.versions); expect(data.audit.slice(0, -1)).toEqual(runtime.audit);
    expect(data.audit.at(-1)).toMatchObject({ action: "supplier_supporting_document_uploaded", by: principal.sub, previous_status: "Negotiation", new_status: "Negotiation", version: "VER-1" });
    expect(data.supplier_uploads).toHaveLength(1); expect(data.supplier_uploads[0].supplier).toBe("SUP-A"); expect(saved.modified).toBe(modified); expect(saved.contract_terms).toBe("Original terms"); expect(record).toEqual(before);
  });

  it("authenticates before any ERP request or multipart consumption", async () => {
    const { fetchMock } = fixture(); const res = await endpoint(request());
    expect(res.status).toHaveBeenCalledWith(401); expect(transport.request).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    const internal: AccessPrincipal = { typ: "internal", role: "admin", sub: "admin@example.test", email: "admin@example.test", iat: 1, exp: 9999999999999 };
    await expect(uploadClmSupplierEvidence(request(), internal, "CON-A", modified)).rejects.toMatchObject({ status: 403 }); expect(transport.request).not.toHaveBeenCalled();
  });

  it("denies another supplier before disclosing revision/format validation", async () => {
    const { fetchMock } = fixture(); const badBody = { ...request(), body: { forged: true } } as unknown as VercelRequest;
    await expect(uploadClmSupplierEvidence(badBody, { ...principal, supplier: "SUP-B" } as AccessPrincipal, "CON-A", "old-revision")).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled(); expect(transport.save).not.toHaveBeenCalled();
  });

  it("denies stale/missing revisions, other stages and locked contracts without uploading", async () => {
    let f = fixture(); await expect(uploadClmSupplierEvidence(request(), principal, "CON-A", "stale")).rejects.toMatchObject({ status: 409 });
    await expect(uploadClmSupplierEvidence(request(), principal, "CON-A", "")).rejects.toMatchObject({ status: 409 }); expect(f.fetchMock).not.toHaveBeenCalled();
    vi.restoreAllMocks(); f = fixture({ contract: { ...contract, custom_contract_status: "Pending Signature" } }); await expect(uploadClmSupplierEvidence(request(), principal, "CON-A", modified)).rejects.toMatchObject({ status: 403 }); expect(f.fetchMock).not.toHaveBeenCalled();
    vi.restoreAllMocks(); f = fixture({ contract: { ...contract, custom_final_version_locked: 1 } }); await expect(uploadClmSupplierEvidence(request(), principal, "CON-A", modified)).rejects.toMatchObject({ status: 403 }); expect(f.fetchMock).not.toHaveBeenCalled(); expect(transport.save).not.toHaveBeenCalled();
  });

  it("validates saved lifecycle evidence before creating a private File", async () => {
    const { fetchMock } = fixture({ contract: { ...contract, custom_clm_data: "{invalid-evidence" } });
    await expect(uploadClmSupplierEvidence(request(), principal, "CON-A", modified)).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).not.toHaveBeenCalled(); expect(transport.save).not.toHaveBeenCalled();
  });

  it.each([
    [["doctype", "Contract"], ["docname", "CON-B"], ["is_private", "1"]],
    [["doctype", "RFP"], ["docname", "CON-A"], ["is_private", "1"]],
    [["doctype", "Contract"], ["docname", "CON-A"], ["is_private", "0"]],
    [["doctype", "Contract"], ["docname", "CON-A"], ["is_private", "1"], ["fieldname", "custom_contract_document"]],
  ].map(fields => ({ fields })))("rejects altered parent/privacy/field metadata %j", async ({ fields }) => {
    const { fetchMock } = fixture(); await expect(uploadClmSupplierEvidence(request(multipart({ fields: fields as Array<[string, string]> })), principal, "CON-A", modified)).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled(); expect(transport.save).not.toHaveBeenCalled();
  });

  it.each(["custom_clm_data", "supplier_uploads", "supplier", "by", "sha256"])("rejects client-forged %s receipt metadata", async key => {
    const { fetchMock } = fixture(); const body = multipart({ fields: [["doctype", "Contract"], ["docname", "CON-A"], ["is_private", "1"], [key, "forged"]] });
    await expect(uploadClmSupplierEvidence(request(body), principal, "CON-A", modified)).rejects.toMatchObject({ status: 400 }); expect(fetchMock).not.toHaveBeenCalled(); expect(transport.save).not.toHaveBeenCalled();
  });

  it("rejects duplicate file/form parts and malformed bodies without an upload", async () => {
    const { fetchMock } = fixture();
    await expect(uploadClmSupplierEvidence(request(multipart({ twoFiles: true })), principal, "CON-A", modified)).rejects.toMatchObject({ status: 400 });
    const duplicate = multipart({ fields: [["doctype", "Contract"], ["docname", "CON-A"], ["docname", "CON-B"], ["is_private", "1"]] });
    await expect(uploadClmSupplierEvidence(request(duplicate), principal, "CON-A", modified)).rejects.toMatchObject({ status: 400 });
    const bad = request(); bad.body = { file: "pretend-file" }; await expect(uploadClmSupplierEvidence(bad, principal, "CON-A", modified)).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled(); expect(transport.save).not.toHaveBeenCalled();
  });

  it("enforces the 25 MB file limit even when multipart overhead remains below 26 MB", async () => {
    const { fetchMock } = fixture(); const body = multipart({ content: Buffer.alloc(25 * 1024 * 1024 + 1, 65) });
    await expect(uploadClmSupplierEvidence(request(body), principal, "CON-A", modified)).rejects.toMatchObject({ status: 413 }); expect(fetchMock).not.toHaveBeenCalled(); expect(transport.save).not.toHaveBeenCalled();
  });

  it.each([
    { is_private: 0 }, { attached_to_name: "CON-B" }, { attached_to_doctype: "Supplier Quotation" }, { file_url: "/files/public.pdf" },
    { name: "FILE-OTHER" }, { is_folder: 1 },
  ])("refuses unverified ERP File metadata %j before storing a receipt", async file => {
    fixture({ file }); await expect(uploadClmSupplierEvidence(request(), principal, "CON-A", modified)).rejects.toMatchObject({ status: 502 }); expect(transport.save).not.toHaveBeenCalled();
  });

  it("compares actual stored bytes before recording the SHA-256 receipt", async () => {
    fixture({ storedContent: Buffer.from("%PDF-1.7 different stored content") });
    await expect(uploadClmSupplierEvidence(request(), principal, "CON-A", modified)).rejects.toMatchObject({ status: 502 }); expect(transport.save).not.toHaveBeenCalled();
  });

  it("does not persist a receipt after an unconfirmed upload or optimistic save conflict", async () => {
    fixture({ missingId: true }); await expect(uploadClmSupplierEvidence(request(), principal, "CON-A", modified)).rejects.toMatchObject({ status: 502 }); expect(transport.save).not.toHaveBeenCalled();
    vi.restoreAllMocks(); const f = fixture({ saveError: Object.assign(new Error("Record changed"), { status: 409 }) });
    await expect(uploadClmSupplierEvidence(request(), principal, "CON-A", modified)).rejects.toMatchObject({ status: 409 });
    expect(f.record.custom_clm_data).toBe(contract.custom_clm_data); expect(f.fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1); expect(transport.save).toHaveBeenCalledTimes(1);
  });

  it("preserves 400/413 upload errors through the authenticated endpoint", async () => {
    fixture(); const accessToken = issueSupplierAccessToken({ supplier: "SUP-A" });
    let res = await endpoint(request(multipart({ twoFiles: true })), accessToken); expect(res.status).toHaveBeenCalledWith(400);
    const oversized = request({ bytes: Buffer.alloc(26 * 1024 * 1024 + 1), contentType: "multipart/form-data; boundary=fixture" });
    res = await endpoint(oversized, accessToken); expect(res.status).toHaveBeenCalledWith(413); expect(transport.save).not.toHaveBeenCalled();
  });
});
