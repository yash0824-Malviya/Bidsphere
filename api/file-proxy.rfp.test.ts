import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./file-proxy";
import { issueInternalAccessToken, issueSupplierAccessToken, type AppRole } from "./rbacAuth";

type Doc = Record<string, unknown>;
const path = "/private/files/technical-proposal.pdf";
const file = { name: "FILE-RESPONSE", file_url: path, is_private: 1, attached_to_doctype: "RFP Response", attached_to_name: "RESPONSE-A" };
const attachment = { document_id: "technical", doc_type: "Technical Proposal", file: { file_id: file.name, file_url: path } };
const response = { name: "RESPONSE-A", rfp: "RFP-1", supplier: "SUP-A", documents_json: JSON.stringify([attachment]) };
const rfp = { name: "RFP-1", suppliers: [{ supplier: "SUP-A" }, { supplier: "SUP-B" }] };
const token = (role: AppRole) => issueInternalAccessToken({ role, sub: "reviewer@example.test", email: "reviewer@example.test" });
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });
const content = [
  { label: "PDF", path, mime: "application/pdf", bytes: Buffer.from("%PDF-1.7 isolated test bytes") },
  { label: "PNG", path: "/private/files/diagram.png", mime: "image/png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { label: "JPEG", path: "/private/files/diagram.jpeg", mime: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) },
];

function mockErp(options: {
  content?: typeof content[number];
  records?: Record<string, Doc | null>;
  fileRows?: Doc[];
  missingBytes?: boolean;
} = {}) {
  const media = options.content ?? content[0]!;
  const selectedFile = { ...file, file_url: media.path };
  const selectedAttachment = { ...attachment, file: { ...attachment.file, file_url: media.path } };
  const records: Record<string, Doc | null> = {
    "/api/resource/RFP/RFP-1": rfp,
    "/api/resource/RFP Response/RESPONSE-A": { ...response, documents_json: JSON.stringify([selectedAttachment]) },
    "/api/resource/File/FILE-RESPONSE": selectedFile,
    "/api/resource/File/FILE-OTHER": { ...selectedFile, name: "FILE-OTHER", attached_to_name: "RESPONSE-B" },
    "/api/resource/RFP Response/RESPONSE-B": { ...response, name: "RESPONSE-B", supplier: "SUP-B", documents_json: JSON.stringify([{ ...selectedAttachment, file: { ...selectedAttachment.file, file_id: "FILE-OTHER" } }]) },
    ...options.records,
  };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://erp.test") throw new Error("Test attempted a non-fixture network request.");
    const route = decodeURIComponent(url.pathname);
    if (route === "/api/resource/File") {
      // The prior failure: the same path belongs to multiple persisted File
      // records. A scoped response must resolve its stored ID, not this list.
      return json(options.fileRows ?? [selectedFile, records["/api/resource/File/FILE-OTHER"]]);
    }
    if (route.startsWith("/api/resource/")) {
      const record = records[route];
      return json(record ?? {}, record ? 200 : 404);
    }
    if (route === media.path || route.includes("download_file")) {
      if (options.missingBytes) return new Response("Not Found", { status: 404 });
      return new Response(init?.method === "HEAD" ? null : media.bytes, { headers: { "Content-Type": media.mime } });
    }
    throw new Error(`Unexpected fixture route: ${route}`);
  });
  const byteCalls = () => fetchMock.mock.calls.filter(([input]) => {
    const route = new URL(String(input)).pathname;
    return route.startsWith("/private/files/") || route.includes("download_file");
  });
  return { fetchMock, byteCalls, media };
}

async function call(accessToken?: string, query: Record<string, string | string[]> = {}, scoped = true, method = "GET") {
  const req = {
    method,
    headers: accessToken ? { "x-bidsphere-access-token": accessToken } : {},
    query: { path, ...(scoped ? { rfp: rfp.name, rfp_response: response.name, response_document: attachment.document_id } : {}), ...query },
  } as unknown as VercelRequest;
  const res = { status: vi.fn(), json: vi.fn(), send: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  await handler(req, res as unknown as VercelResponse);
  return res;
}

describe("authenticated RFP response preview/download endpoint (fixture ERP only)", () => {
  beforeEach(() => {
    vi.stubEnv("BIDSPHERE_SESSION_SECRET", "rfp-file-test-only-secret");
    vi.stubEnv("ERPNEXT_URL", "https://erp.test");
    vi.stubEnv("ERP_API_KEY", "test-key");
    vi.stubEnv("ERP_API_SECRET", "test-secret");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it.each(["procurement", "admin"] as AppRole[])("uses the exact saved File ID for %s with duplicate file paths", async role => {
    const { fetchMock, media, byteCalls } = mockErp();
    const res = await call(token(role));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(media.bytes);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(byteCalls()).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => new URL(String(url)).pathname === "/api/resource/File")).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => new URL(String(url)).pathname === "/api/resource/File/FILE-OTHER")).toBe(false);
  });

  it.each(content)("preserves $label content type for GET and HEAD", async media => {
    const fixture = mockErp({ content: media });
    const accessToken = token("procurement");
    const get = await call(accessToken, { path: media.path });
    expect(get.status).toHaveBeenCalledWith(200);
    expect(get.send).toHaveBeenCalledWith(media.bytes);
    expect(get.setHeader).toHaveBeenCalledWith("Content-Type", media.mime);
    const head = await call(accessToken, { path: media.path }, true, "HEAD");
    expect(head.status).toHaveBeenCalledWith(200);
    expect(head.setHeader).toHaveBeenCalledWith("Content-Type", media.mime);
    expect(head.end).toHaveBeenCalled();
    expect(head.send).not.toHaveBeenCalled();
    expect(fixture.byteCalls().map(([, init]) => init?.method)).toEqual(["GET", "HEAD"]);
  });

  it.each(["procurement_team", "finance", "legal", "department"] as AppRole[])("keeps %s denied for both scoped and generic File routes", async role => {
    const { byteCalls } = mockErp();
    for (const scoped of [true, false]) {
      const res = await call(token(role), { file_id: file.name }, scoped);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 403, message: "You do not have permission to view this document." }));
      expect(res.send).not.toHaveBeenCalled();
    }
    expect(byteCalls()).toHaveLength(0);
  });

  it("permits only an invited supplier's own response on both access paths", async () => {
    const { byteCalls } = mockErp();
    for (const scoped of [true, false]) {
      expect((await call(issueSupplierAccessToken({ supplier: "SUP-A" }), { file_id: file.name }, scoped)).status).toHaveBeenCalledWith(200);
      const rejected = await call(issueSupplierAccessToken({ supplier: "SUP-B" }), { file_id: file.name }, scoped);
      expect(rejected.status).toHaveBeenCalledWith(403);
      expect(rejected.send).not.toHaveBeenCalled();
    }
    expect(byteCalls()).toHaveLength(2);
  });

  it("denies suppliers who no longer have an RFP invitation", async () => {
    const { byteCalls } = mockErp({ records: { "/api/resource/RFP/RFP-1": { ...rfp, suppliers: [{ supplier: "SUP-B" }] } } });
    expect((await call(issueSupplierAccessToken({ supplier: "SUP-A" }))).status).toHaveBeenCalledWith(403);
    expect(byteCalls()).toHaveLength(0);
  });

  it("returns 401 before any ERP request for anonymous or invalid sessions", async () => {
    const { fetchMock } = mockErp();
    for (const accessToken of [undefined, "invalid-test-token"]) {
      const res = await call(accessToken);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).not.toHaveBeenCalled();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { file_id: "FILE-OTHER" },
    { path: "/private/files/other.pdf" },
    { response_document: "internal-notes" },
    { rfp: "RFP-OTHER" },
    { rfp_response: "RESPONSE-B", file_id: file.name },
  ])("denies substituted document context %j without fetching bytes", async tampering => {
    const { byteCalls } = mockErp();
    const res = await call(token("procurement"), tampering);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).not.toHaveBeenCalled();
    expect(byteCalls()).toHaveLength(0);
  });

  it("cannot bypass supplier ownership by changing both response and File IDs", async () => {
    const { byteCalls } = mockErp();
    const res = await call(issueSupplierAccessToken({ supplier: "SUP-A" }), { rfp_response: "RESPONSE-B", file_id: "FILE-OTHER" });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(byteCalls()).toHaveLength(0);
  });

  it.each(["path", "rfp", "rfp_response", "response_document", "file_id"])("rejects duplicate %s query values before ERP access", async key => {
    const { fetchMock } = mockErp();
    const res = await call(token("procurement"), { [key]: ["one", "two"] });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["legal_review", "document_key", "rfq", "erp_supplier_id"])("rejects competing %s authorization context before ERP access", async key => {
    const { fetchMock } = mockErp();
    const res = await call(token("procurement"), { [key]: "OTHER" });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["/api/resource/RFP/RFP-1", "/api/resource/RFP Response/RESPONSE-A", "/api/resource/File/FILE-RESPONSE"])("returns 404 for missing %s", async key => {
    const { byteCalls } = mockErp({ records: { [key]: null } });
    const res = await call(token("procurement"));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 404, message: "Document not found." }));
    expect(byteCalls()).toHaveLength(0);
  });

  it("returns 404 when authenticated metadata exists but stored bytes are missing", async () => {
    mockErp({ missingBytes: true });
    const res = await call(token("procurement"));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("keeps ambiguous unscoped path lookup denied", async () => {
    const { byteCalls } = mockErp();
    expect((await call(token("procurement"), {}, false)).status).toHaveBeenCalledWith(403);
    expect(byteCalls()).toHaveLength(0);
  });

  it("keeps legacy responses without file_id readable through a unique authorized path", async () => {
    const withoutId = { ...attachment, file: { file_url: path } };
    const { fetchMock, byteCalls, media } = mockErp({
      records: { "/api/resource/RFP Response/RESPONSE-A": { ...response, documents_json: JSON.stringify([withoutId]) } },
      fileRows: [file],
    });
    const res = await call(token("procurement"));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(media.bytes);
    expect(byteCalls()).toHaveLength(1);
    const lookup = fetchMock.mock.calls.find(([input]) => new URL(String(input)).pathname === "/api/resource/File");
    expect(lookup).toBeDefined();
    expect(JSON.parse(new URL(String(lookup![0])).searchParams.get("filters")!)).toEqual([["file_url", "=", path]]);
  });

  it.each([
    { label: "duplicate paths", rows: [file, { ...file, name: "FILE-OTHER", attached_to_name: "RESPONSE-B" }], status: 403 },
    { label: "wrong response parent", rows: [{ ...file, attached_to_name: "RESPONSE-B" }], status: 403 },
    { label: "missing File", rows: [], status: 404 },
  ])("denies legacy fallback for $label without fetching bytes", async ({ rows, status }) => {
    const withoutId = { ...attachment, file: { file_url: path } };
    const { byteCalls } = mockErp({
      records: { "/api/resource/RFP Response/RESPONSE-A": { ...response, documents_json: JSON.stringify([withoutId]) } },
      fileRows: rows,
    });
    const res = await call(token("procurement"));
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.send).not.toHaveBeenCalled();
    expect(byteCalls()).toHaveLength(0);
  });
});
