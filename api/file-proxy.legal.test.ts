import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./file-proxy";
import { issueInternalAccessToken, issueSupplierAccessToken, type AppRole } from "./rbacAuth";

const path = "/private/files/contract.pdf";
const review = { name: "LDR-1", sq_name: "SQ-1", owner: "Administrator", procurement_manager: "buyer@example.test", review_status: "Pending", workflow_state: "Pending Review", terms_file_url: path };
const file = { name: "FILE-1", file_url: path, is_private: 1, attached_to_doctype: "Supplier Quotation", attached_to_name: "SQ-1", attached_to_field: "custom_terms__condition" };
const quotation = { name: "SQ-1", owner: "Administrator", supplier: "SUP-1" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });
const token = (role: AppRole, email = "person@example.test") => issueInternalAccessToken({ sub: email, email, role });

function mockErp(options: { missingFile?: boolean; missingReview?: boolean; missingBytes?: boolean; oldFile?: boolean } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    const url = new URL(String(input));
    const route = decodeURIComponent(url.pathname);
    if (route === "/api/resource/Legal Document Review/LDR-1") return json(review, options.missingReview ? 404 : 200);
    if (route === "/api/resource/Supplier Quotation/SQ-1") return json(quotation);
    if (route === "/api/resource/Supplier Quotation/SQ-OLD") return json({ ...quotation, name: "SQ-OLD" });
    if (route === "/api/resource/Legal Document Review") {
      const filters = JSON.parse(url.searchParams.get("filters") || "[]") as string[][];
      return json(filters.some(f => f[0] === "sq_name" && f[2] === "SQ-OLD") ? [] : [{ name: review.name }]);
    }
    if (route === "/api/resource/File/FILE-1") return json(options.oldFile ? { ...file, attached_to_name: "SQ-OLD", attached_to_field: null } : file);
    if (route === "/api/resource/File") {
      const filters = JSON.parse(url.searchParams.get("filters") || "[]") as string[][];
      if (options.missingFile || filters.some(f => f[2] === "Legal Document Review")) return json([]);
      return json([file, { ...file, name: "FILE-2", attached_to_field: null }]);
    }
    if (route === path || route.includes("download_file")) return options.missingBytes
      ? new Response("Not Found", { status: 404 })
      : new Response("%PDF-1.7 secure test bytes", { headers: { "Content-Type": "application/pdf" } });
    throw new Error(`Unexpected test route: ${route}`);
  });
}

async function call(accessToken?: string, query: Record<string, string | string[]> = {}, scoped = true, method = "GET") {
  const req = { method, headers: accessToken ? { "x-bidsphere-access-token": accessToken } : {}, query: { path, ...(scoped ? { legal_review: "LDR-1", document_key: "terms" } : {}), ...query } } as unknown as VercelRequest;
  const res = { status: vi.fn(), json: vi.fn(), send: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  await handler(req, res as unknown as VercelResponse);
  return res;
}

describe("authenticated CLM file endpoint (isolated test sessions and ERP fixtures)", () => {
  beforeEach(() => {
    vi.stubEnv("BIDSPHERE_SESSION_SECRET", "legal-file-test-only-secret");
    vi.stubEnv("ERPNEXT_URL", "https://erp.test");
    vi.stubEnv("ERP_API_KEY", "test-key");
    vi.stubEnv("ERP_API_SECRET", "test-secret");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it.each(["legal", "admin"] as AppRole[])("returns private PDF bytes for %s with duplicate File URLs", async role => {
    mockErp();
    const res = await call(token(role));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(Buffer.from("%PDF-1.7 secure test bytes"));
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
  });
  it("preserves assigned procurement access via scoped and explicit File-ID routes", async () => {
    mockErp();
    for (const scoped of [true, false]) {
      const res = await call(token("procurement", "buyer@example.test"), { file_id: file.name }, scoped);
      expect(res.status).toHaveBeenCalledWith(200);
    }
  });
  it.each(["department", "warehouse", "procurement"] as AppRole[])("returns 403 and never fetches bytes for unassigned %s", async role => {
    const fetchMock = mockErp();
    for (const scoped of [true, false]) {
      const res = await call(token(role), { file_id: file.name }, scoped);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, status: 403, message: "You do not have permission to view this document." }));
    }
    expect(fetchMock.mock.calls.some(([url]) => new URL(String(url)).pathname.startsWith("/private/files/"))).toBe(false);
  });
  it("denies supplier access even when its supplier owns the quotation", async () => {
    mockErp();
    const accessToken = issueSupplierAccessToken({ supplier: "SUP-1" });
    for (const scoped of [true, false]) expect((await call(accessToken, { file_id: file.name }, scoped)).status).toHaveBeenCalledWith(403);
  });
  it("denies an alternate historical File ID for the same protected bytes", async () => {
    mockErp({ oldFile: true });
    expect((await call(token("department"), { file_id: file.name }, false)).status).toHaveBeenCalledWith(403);
  });
  it("rejects anonymous and invalid-token requests before any ERP request", async () => {
    const fetchMock = mockErp();
    for (const accessToken of [undefined, "invalid"]) expect((await call(accessToken)).status).toHaveBeenCalledWith(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["missingFile", "missingReview", "missingBytes"])("returns a real 404 for %s", async kind => {
    mockErp({ [kind]: true });
    const res = await call(token("legal"));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 404, message: "Document not found." }));
    expect(res.send).not.toHaveBeenCalled();
  });
  it("keeps ambiguous unscoped URL requests denied", async () => {
    mockErp();
    expect((await call(token("legal"), {}, false)).status).toHaveBeenCalledWith(403);
  });
  it("rejects substituted paths and duplicate parent parameters", async () => {
    mockErp();
    expect((await call(token("legal"), { path: "/private/files/other.pdf" })).status).toHaveBeenCalledWith(403);
    expect((await call(token("legal"), { legal_review: ["LDR-1", "LDR-2"] })).status).toHaveBeenCalledWith(400);
  });
  it("supports authenticated HEAD without sending document bytes", async () => {
    mockErp();
    const res = await call(token("legal"), {}, true, "HEAD");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.end).toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });
});
