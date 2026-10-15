import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./clm";
import { issueInternalAccessToken, issueSupplierAccessToken, type AppRole } from "./rbacAuth";
import type { ClmRecord } from "../src/types/clm";

const bytes = Buffer.from("%PDF-1.7\nVerified RFQ supporting document");
const sourceFile = { name: "TERMS", attached_to_doctype: "Supplier Quotation", attached_to_name: "SQ-93", file_url: "/private/files/terms.pdf", file_name: "terms.pdf", is_private: 1, is_folder: 0 };
const source = { file_id: "TERMS", file_name: "terms.pdf", source_doctype: "Supplier Quotation", source_name: "SQ-93", source_path: "/sourcing/rfq/RFQ-93" };
const runtime = { schema: 1, approvals: [{ id: "LEGAL", role: "legal", stage: 0, status: "Pending", rule: "RFQ" }], audit: [], signatures: [], versions: [], sla: [], rfq_source: { rfq: "RFQ-93", quotation: "SQ-93", legal_review: "AWARD-93", supplier: "SUP-A", contract_required: true }, rfq_workflow: { version: 1, phase: "legal_review" }, source_documents: [source] };
const contract = { name: "CON-93", party_type: "Supplier", party_name: "SUP-A", custom_supplier: "SUP-A", custom_rfq: "RFQ-93", custom_supplier_quotation: "SQ-93", custom_contract_status: "Pending Legal", custom_clm_data: JSON.stringify(runtime) };
const token = (role: AppRole) => issueInternalAccessToken({ role, sub: `${role}@example.test`, email: `${role}@example.test` });
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });

function fixture(options: { contract?: ClmRecord; quotation?: ClmRecord; sourceFile?: ClmRecord; listedFile?: ClmRecord; award?: ClmRecord; sourceRecords?: Record<string, ClmRecord> } = {}) {
  const award = options.award || { name: "AWARD-93", rfq_name: "RFQ-93", sq_name: "SQ-93" };
  const listedFile = options.listedFile || sourceFile;
  const records: Record<string, ClmRecord> = {
    "Contract/CON-93": options.contract || contract,
    "Request for Quotation/RFQ-93": { name: "RFQ-93", items: [] },
    "Supplier Quotation/SQ-93": options.quotation || { name: "SQ-93", supplier: "SUP-A", items: [{ request_for_quotation: "RFQ-93" }], custom_terms__condition: sourceFile.file_url },
    "Supplier/SUP-A": { name: "SUP-A" }, [`Legal Document Review/${award.name}`]: award,
    "File/TERMS": options.sourceFile || sourceFile,
    ...options.sourceRecords,
  };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://clm-source.test" || init?.method && init.method !== "GET") throw new Error("Unexpected fixture request or business write");
    const path = decodeURIComponent(url.pathname).replace(/^\/api\//, "");
    if (path.startsWith("resource/")) {
      const key = path.slice(9);
      if (records[key]) return json(records[key]);
      const filters = JSON.parse(url.searchParams.get("filters") || "[]") as Array<[string, string, unknown]>;
      const rows = key === "File" ? [listedFile] : key === "Legal Document Review" ? [award] : [];
      return json(rows.filter(row => filters.every(([field, op, value]) => op !== "=" || (row as ClmRecord)[field] === value)));
    }
    if (path.includes("download_file") || path === "/private/files/terms.pdf") return new Response(bytes, { headers: { "Content-Type": "application/pdf" } });
    throw new Error(`Unexpected fixture path ${path}`);
  });
  return { fetchMock, downloads: () => fetchMock.mock.calls.filter(([url]) => /download_file|\/private\/files\//.test(String(url))) };
}
async function call(accessToken: string, fileId = "TERMS", view = "file") {
  const req = { method: "GET", headers: { "x-bidsphere-access-token": accessToken }, query: { view, doctype: "Contract", name: "CON-93", file_id: fileId } } as unknown as VercelRequest;
  const res = { status: vi.fn(), json: vi.fn(), send: vi.fn(), setHeader: vi.fn() }; res.status.mockReturnValue(res);
  await handler(req, res as unknown as VercelResponse); return res;
}

describe("Contract-scoped RFQ supporting document access", () => {
  beforeEach(() => {
    vi.stubEnv("BIDSPHERE_SESSION_SECRET", "rfq-source-fixture-secret");
    vi.stubEnv("ERPNEXT_URL", "https://clm-source.test"); vi.stubEnv("ERP_API_KEY", "fixture-key"); vi.stubEnv("ERP_API_SECRET", "fixture-secret");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("serves the saved, currently verified supplier supporting PDF to its assigned Legal reviewer", async () => {
    const f = fixture(); const res = await call(token("legal"));
    expect(res.status).toHaveBeenCalledWith(200); expect(res.send).toHaveBeenCalledWith(bytes);
    expect(f.downloads()).toHaveLength(1); expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
  it("does not fetch source records for a reviewer who is not assigned to the Contract", async () => {
    const f = fixture(); const res = await call(token("engineering"));
    expect(res.status).toHaveBeenCalledWith(403); expect(f.fetchMock).toHaveBeenCalledTimes(1); expect(f.downloads()).toEqual([]);
  });
  it("keeps internal source evidence unavailable to a supplier even when the supplier may read the Contract", async () => {
    const f = fixture({ contract: { ...contract, custom_contract_status: "Pending Signature" } });
    const res = await call(issueSupplierAccessToken({ supplier: "SUP-A" }));
    expect(res.status).toHaveBeenCalledWith(403); expect(f.fetchMock).toHaveBeenCalledTimes(1); expect(f.downloads()).toEqual([]);
  });
  it("rejects a file that was not recorded as this Contract's source evidence", async () => {
    const f = fixture({ contract: { ...contract, custom_clm_data: JSON.stringify({ ...runtime, source_documents: [] }) } });
    expect((await call(token("legal"))).status).toHaveBeenCalledWith(403); expect(f.downloads()).toEqual([]);
  });
  it("rejects arbitrary file IDs and stale or unrelated procurement source references", async () => {
    const f = fixture(); expect((await call(token("legal"), "ARBITRARY")).status).toHaveBeenCalledWith(403); expect(f.downloads()).toEqual([]);
  });
  it.each(["supplier", "rfq", "slot"])("rejects changed source provenance (%s) before downloading bytes", async mismatch => {
    const quotation = { name: "SQ-93", supplier: mismatch === "supplier" ? "SUP-B" : "SUP-A", items: [{ request_for_quotation: mismatch === "rfq" ? "RFQ-OTHER" : "RFQ-93" }], custom_terms__condition: mismatch === "slot" ? "/private/files/replaced.pdf" : sourceFile.file_url };
    const f = fixture({ quotation }); expect((await call(token("legal"))).status).toHaveBeenCalledWith(403); expect(f.downloads()).toEqual([]);
  });
  it.each(["parent", "path"])("rejects a File changed after the verified source list (%s)", async mismatch => {
    const f = fixture({ sourceFile: { ...sourceFile, ...(mismatch === "parent" ? { attached_to_name: "SQ-OTHER" } : { file_url: "/private/files/secret.pdf" }) } });
    expect((await call(token("legal"))).status).toHaveBeenCalledWith(403); expect(f.downloads()).toEqual([]);
  });

  it("denies the RFQ 91 PDF on RFQ 95 even when its ID was saved on the Contract and occupies the winning quotation slot", async () => {
    const rfq = "PUR-RFQ-2026-00095", quotation = "PUR-SQTN-2026-00270", award = "LDC2026-00026";
    const supplier = '"Blue Ridge Manufacturing Inc"';
    const wrongFile = { ...sourceFile, attached_to_name: quotation,
      file_name: "RFQ_PUR-RFQ-2026-00091.pdf", file_url: "/private/files/RFQ_PUR-RFQ-2026-00091.pdf" };
    const f = fixture({
      contract: { ...contract, party_name: supplier, custom_supplier: supplier,
        custom_rfq: rfq, custom_supplier_quotation: quotation,
        custom_clm_data: JSON.stringify({ ...runtime,
          rfq_source: { rfq, quotation, legal_review: award, supplier, contract_required: true },
          source_documents: [{ ...source, file_name: wrongFile.file_name, source_name: quotation, source_path: `/sourcing/rfq/${rfq}` }],
        }),
      },
      sourceFile: wrongFile, listedFile: wrongFile,
      award: { name: award, rfq_name: rfq, sq_name: quotation, supplier },
      sourceRecords: {
        [`Request for Quotation/${rfq}`]: { name: rfq, items: [] },
        [`Supplier Quotation/${quotation}`]: { name: quotation, supplier, items: [{ request_for_quotation: rfq }], custom_terms__condition: wrongFile.file_url },
        [`Supplier/${supplier}`]: { name: supplier },
      },
    });
    const res = await call(token("legal"));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(f.downloads()).toEqual([]);
    expect(f.fetchMock.mock.calls.some(([input]) => {
      const url = new URL(String(input));
      return decodeURIComponent(url.pathname) === "/api/resource/File" && JSON.stringify(JSON.parse(url.searchParams.get("filters") || "[]")).includes(quotation);
    })).toBe(true);
  });

  it.each(["procurement", "admin", "legal"] as AppRole[])("does not offer %s new related-record actions on the RFQ Contract", async role => {
    fixture(); const res = await call(token(role), "", "detail");
    expect(res.status).toHaveBeenCalledWith(200); expect(res.json.mock.calls[0][0].data.allowed_related).toEqual([]);
  });
  it("offers related RFQ Contract records to Procurement Team and preserves standalone Manager behavior", async () => {
    fixture({ contract: { ...contract, custom_contract_status: "Draft", custom_clm_data: JSON.stringify({ ...runtime, approvals: [], rfq_workflow: { version: 1, phase: "draft" } }) } }); const team = await call(token("procurement_team"), "", "detail");
    expect(team.json.mock.calls[0][0].data.allowed_related).toContain("Contract Milestone");
    vi.restoreAllMocks(); fixture({ contract: { ...contract, custom_rfq: "", custom_clm_data: JSON.stringify({ ...runtime, rfq_workflow: undefined, rfq_source: undefined }) } });
    const manager = await call(token("procurement"), "", "detail");
    expect(manager.json.mock.calls[0][0].data.allowed_related).toContain("Contract Milestone");
  });
  it.each(["Pending Legal", "Pending Signature", "Pending Finance"])("keeps Team related-record creation inactive during %s", async status => {
    fixture({ contract: { ...contract, custom_contract_status: status } });
    const res = await call(token("procurement_team"), "", "detail");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.allowed_related).toEqual([]);
  });
});
