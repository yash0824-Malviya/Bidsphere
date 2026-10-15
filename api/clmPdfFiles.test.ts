import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./clm";
import { issueInternalAccessToken, issueSupplierAccessToken, type AppRole } from "./rbacAuth";
import { parseClmData } from "./clmCore";
import type { ClmRecord } from "../src/types/clm";

const bytes = (id: string) => Buffer.from(`%PDF-1.7\nImmutable ${id} PDF`);
const file = (id: string) => ({ file_id: id, file_url: `/private/files/${id}.pdf`, hash: createHash("sha256").update(bytes(id)).digest("hex") });
function fixture(options: { wrongParent?: boolean; tampered?: boolean; staleSignature?: boolean; draft?: boolean } = {}) {
  const data = parseClmData(null);
  data.versions = [{ id: "revision-1", number: "1.0", author: "team@example.test", at: "2026-09-27 10:00:00", hash: "snapshot", comment: "Original", content: {} }];
  const receipt = (id: string, version: string) => ({ ...file(id), version, party: "inteva" as const, by: "legal@example.test", at: "2026-09-28 11:00:00", typed_name: "Legal Signer" });
  data.locked_file = file("ORIGINAL");
  data.signatures = [receipt("SIGNED", options.staleSignature ? "1.0" : "2.0")];
  data.review_history = [{ version: "revision-1", locked_file: file("OLD-ORIGINAL"), signatures: [receipt("OLD-SIGNED", "1.0")] }];
  if (options.draft) { data.signatures = []; delete data.locked_file; }
  const record: ClmRecord = { name: "CON-PDF", party_type: "Supplier", party_name: "SUP-A", custom_supplier: "SUP-A", custom_inteva_signatory: "legal@example.test", custom_current_version: "2.0", custom_contract_status: "Pending Signature", custom_final_version_locked: options.draft ? 0 : 1, custom_executed_contract: file("SIGNED").file_url, custom_clm_data: JSON.stringify(data) };
  const records: Record<string, ClmRecord> = { "Contract/CON-PDF": record };
  for (const id of ["ORIGINAL", "SIGNED", "OLD-ORIGINAL", "OLD-SIGNED"]) records[`File/${id}`] = { name: id, attached_to_doctype: "Contract", attached_to_name: options.wrongParent ? "CON-OTHER" : "CON-PDF", is_private: 1, is_folder: 0, file_name: `${id}.pdf`, file_url: file(id).file_url };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://clm-pdf.test" || init?.method && init.method !== "GET") throw new Error("Unexpected fixture request or business write");
    const path = decodeURIComponent(url.pathname).replace(/^\/api\//, "");
    if (path.startsWith("resource/")) {
      const key = path.slice(9);
      if (records[key]) return new Response(JSON.stringify({ data: records[key] }), { headers: { "Content-Type": "application/json" } });
      if (key === "File") return new Response(JSON.stringify({ data: Object.values(records).filter(row => row.is_private) }), { headers: { "Content-Type": "application/json" } });
      throw new Error(`Unexpected fixture record ${key}`);
    }
    if (path.includes("download_file") || path.includes("/private/files/")) {
      const candidate = url.searchParams.get("file_url") || url.pathname;
      const id = Object.keys(records).filter(key => key.startsWith("File/")).map(key => key.slice(5)).find(id => candidate.endsWith(`/${id}.pdf`));
      if (!id) throw new Error(`Unknown file download ${candidate}`);
      return new Response(bytes(options.tampered ? "TAMPERED" : id), { headers: { "Content-Type": "application/pdf" } });
    }
    throw new Error(`Unexpected fixture path ${path}`);
  });
  return { data, record, fetchMock, downloads: () => fetchMock.mock.calls.filter(([url]) => /download_file|\/private\/files\//.test(String(url))) };
}
const token = (role: AppRole = "legal") => issueInternalAccessToken({ role, sub: `${role}@example.test`, email: `${role}@example.test` });
async function call(query: Record<string, string>, accessToken = token()) {
  const req = { method: "GET", headers: { "x-bidsphere-access-token": accessToken }, query: { view: "file", doctype: "Contract", name: "CON-PDF", ...query } } as unknown as VercelRequest;
  const res = { status: vi.fn(), json: vi.fn(), send: vi.fn(), setHeader: vi.fn() }; res.status.mockReturnValue(res);
  await handler(req, res as unknown as VercelResponse); return res;
}
describe("versioned Contract PDF preview and download", () => {
  beforeEach(() => { vi.stubEnv("BIDSPHERE_SESSION_SECRET", "contract-pdf-fixture-secret"); vi.stubEnv("ERPNEXT_URL", "https://clm-pdf.test"); vi.stubEnv("ERP_API_KEY", "fixture-key"); vi.stubEnv("ERP_API_SECRET", "fixture-secret"); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it("serves current PDF and explicit E-Sign file ID as identical immutable bytes", async () => {
    const f = fixture(), before = JSON.stringify(f.record);
    const current = await call({ fieldname: "current_pdf" }), signing = await call({ file_id: "SIGNED" });
    expect(current.status).toHaveBeenCalledWith(200); expect(signing.status).toHaveBeenCalledWith(200);
    expect(current.send).toHaveBeenCalledWith(bytes("SIGNED")); expect(signing.send).toHaveBeenCalledWith(bytes("SIGNED"));
    expect(current.setHeader).toHaveBeenCalledWith("X-Contract-Version", "2.0");
    expect(current.setHeader).toHaveBeenCalledWith("X-Contract-Pdf-SHA256", file("SIGNED").hash);
    expect(current.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
    expect(current.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(JSON.stringify(f.record)).toBe(before);
  });
  it("keeps the unsigned original separately accessible without changing the current selection", async () => {
    fixture(); const original = await call({ fieldname: "locked_file" });
    expect(original.status).toHaveBeenCalledWith(200); expect(original.send).toHaveBeenCalledWith(bytes("ORIGINAL"));
  });
  it.each(["ORIGINAL", "OLD-SIGNED", "OLD-ORIGINAL", "ARBITRARY"])("does not let an explicit %s File ID override current_pdf", async fileId => {
    const f = fixture(); const res = await call({ fieldname: "current_pdf", file_id: fileId });
    expect(res.status).toHaveBeenCalledWith(409); expect(res.json.mock.calls[0][0].message).toContain("not the current Contract PDF");
    expect(f.downloads()).toEqual([]);
  });
  it("accepts an explicit current File ID only when it matches the authoritative current document", async () => {
    fixture(); const res = await call({ fieldname: "current_pdf", file_id: "SIGNED" });
    expect(res.status).toHaveBeenCalledWith(200); expect(res.send).toHaveBeenCalledWith(bytes("SIGNED"));
  });
  it("rejects a stale UI version before serving a differently versioned current document", async () => {
    const f = fixture(); const res = await call({ fieldname: "current_pdf", expected_version: "1.0" });
    expect(res.status).toHaveBeenCalledWith(409); expect(res.json.mock.calls[0][0].message).toContain("version changed");
    expect(f.downloads()).toEqual([]);
    expect((await call({ fieldname: "current_pdf", expected_version: "2.0" })).status).toHaveBeenCalledWith(200);
  });
  it.each(["OLD-SIGNED", "OLD-ORIGINAL"])("preserves authorized historical %s access after revision", async fileId => {
    fixture(); const res = await call({ file_id: fileId });
    expect(res.status).toHaveBeenCalledWith(200); expect(res.send).toHaveBeenCalledWith(bytes(fileId));
    expect(res.setHeader).toHaveBeenCalledWith("X-Contract-Version", "1.0");
  });
  it("does not give suppliers new historical PDF access", async () => {
    const f = fixture(); const res = await call({ file_id: "OLD-SIGNED" }, issueSupplierAccessToken({ supplier: "SUP-A" }));
    expect(res.status).toHaveBeenCalledWith(403); expect(f.downloads()).toEqual([]);
  });
  it("preserves assigned supplier access to the current PDF", async () => {
    fixture(); const res = await call({ fieldname: "current_pdf" }, issueSupplierAccessToken({ supplier: "SUP-A" }));
    expect(res.status).toHaveBeenCalledWith(200); expect(res.send).toHaveBeenCalledWith(bytes("SIGNED"));
  });
  it.each(["current_pdf", "locked_file"])("rejects changed bytes from %s before returning a PDF", async fieldname => {
    fixture({ tampered: true }); const res = await call({ fieldname });
    expect(res.status).toHaveBeenCalledWith(409); expect(res.send).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].message).toContain("integrity check");
  });
  it("also validates archived signature hashes", async () => {
    fixture({ tampered: true }); const res = await call({ file_id: "OLD-SIGNED" });
    expect(res.status).toHaveBeenCalledWith(409); expect(res.send).not.toHaveBeenCalled();
  });
  it("rejects wrong Contract ownership before downloading", async () => {
    const f = fixture({ wrongParent: true }); const res = await call({ fieldname: "current_pdf" });
    expect(res.status).toHaveBeenCalledWith(403); expect(f.downloads()).toEqual([]);
  });
  it("rejects stale signature versions without falling back to the unsigned PDF", async () => {
    const f = fixture({ staleSignature: true }); const res = await call({ fieldname: "current_pdf" });
    expect(res.status).toHaveBeenCalledWith(409); expect(f.downloads()).toEqual([]);
  });
  it("does not synthesize a PDF for a draft without locked evidence", async () => {
    const f = fixture({ draft: true }); const res = await call({ fieldname: "current_pdf" });
    expect(res.status).toHaveBeenCalledWith(404); expect(f.downloads()).toEqual([]);
  });
  it("keeps unrelated users and arbitrary File IDs denied", async () => {
    const f = fixture();
    expect((await call({ fieldname: "current_pdf" }, issueSupplierAccessToken({ supplier: "SUP-B" }))).status).toHaveBeenCalledWith(403);
    expect((await call({ file_id: "ARBITRARY" })).status).toHaveBeenCalledWith(403);
    expect(f.downloads()).toEqual([]);
  });
});
