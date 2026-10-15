import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueInternalAccessToken, issueSupplierAccessToken } from "../../api/rbacAuth";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), token: vi.fn(() => "test-session-proof"), supplierToken: vi.fn(() => "") }));
vi.mock("./erpnext", () => ({ apiGet: mocks.get, apiPost: mocks.post, withoutNetworkRetry: () => ({ _disableNetworkRetry: true }) }));
vi.mock("../utils/accessToken", () => ({ readErpProxyAccessToken: mocks.token, readSupplierAccessToken: mocks.supplierToken }));
import { applyClmAction, clmError, clmRecordRoute, clmViewerKey, getClmDetail, getClmDocumentBlob, getClmList, getClmMetadata, lookupClm, prefillClm, uploadClmSupportingDocument, saveRfqRequestDraft } from "./clm";

describe("CLM authenticated service contract", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); vi.stubEnv("BIDSPHERE_SESSION_SECRET", "clm-client-test-only-session-secret"); mocks.token.mockReturnValue("test-session-proof"); mocks.supplierToken.mockReturnValue(""); });
  afterEach(() => vi.unstubAllEnvs());
  it("loads existing Contract and Contract Request records from the CLM endpoint", async () => {
    mocks.get.mockResolvedValue({ data: { records: [{ name: "CON-1" }] } });
    expect(await getClmList()).toEqual({ records: [{ name: "CON-1" }] });
    expect(mocks.get).toHaveBeenCalledWith("/api/clm", { params: { view: "list", doctype: "Contract" } });
    await getClmList("Contract Request");
    expect(mocks.get).toHaveBeenLastCalledWith("/api/clm", { params: { view: "list", doctype: "Contract Request" } });
  });
  it("rejects detail responses for another contract", async () => {
    mocks.get.mockResolvedValue({ record: { name: "CON-other" }, actions: [] });
    await expect(getClmDetail("Contract", "CON-1")).rejects.toThrow("incomplete record");
  });
  it("fetches the existing Request by its own ID without creating or changing any record", async () => {
    const detail = { doctype: "Contract Request", record: { name: "CTRQ-2026-0002", custom_rfq: "PUR-RFQ-2026-00099", request_status: "Pending Review" }, actions: [] };
    mocks.get.mockResolvedValue({ data: detail });
    expect(await getClmDetail("Contract Request", "CTRQ-2026-0002")).toEqual(detail);
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith("/api/clm", { params: { view: "detail", doctype: "Contract Request", name: "CTRQ-2026-0002" } });
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("saves partial terms only through the existing Request draft endpoint", async () => {
    const detail = { doctype: "Contract Request", record: { name: "CTRQ-2026-0002", modified: "saved-revision", contract_type: "", description: "" }, actions: [], rfq_request_draft_editable: true };
    mocks.post.mockResolvedValue({ data: detail });
    const input = { name: "CTRQ-2026-0002", expected_modified: "old-revision", payload: { contract_type: "", description: "" } };
    expect(await saveRfqRequestDraft(input)).toEqual(detail);
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith("/api/clm?view=rfq_request_draft", input, { _disableNetworkRetry: true, _preserveResponse: true });
  });
  it("requires a persisted Request revision before saving its draft", async () => {
    await expect(saveRfqRequestDraft({ name: "CTRQ-2026-0002", expected_modified: "", payload: {} })).rejects.toThrow("Refresh");
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each([
    { data: { doctype: "Contract Request", record: { name: "CTRQ-other", modified: "new" } } },
    { data: { doctype: "Contract", record: { name: "CTRQ-2026-0002", modified: "new" } } },
    { data: { doctype: "Contract Request", record: { name: "CTRQ-2026-0002" } } },
    { success: false, message: "ERPNext draft persistence failed." },
  ])("rejects wrong-record, incomplete and failed draft responses", async response => {
    mocks.post.mockResolvedValue(response);
    await expect(saveRfqRequestDraft({ name: "CTRQ-2026-0002", expected_modified: "old", payload: {} })).rejects.toThrow(/ERPNext/);
  });
  it.each([undefined, {}, { records: null }, { success: false, message: "List unavailable" }])("does not treat an incomplete backend list as zero Contracts: %j", async response => {
    mocks.get.mockResolvedValue(response);
    await expect(getClmList()).rejects.toThrow("did not return the Contract list");
  });
  it("preserves the actionable backend message instead of its generic error category", () => {
    const message = "The RFQ CLM transaction extension is not installed in ERPNext. Deploy bidsphere_workflows before recording this decision; nothing has been advanced.";
    expect(clmError({ response: { data: { error: "service_unavailable", message } }, message: "Request failed with status code 503" })).toBe(message);
    expect(clmError({ response: { data: { error: { code: 503 } } }, message })).toBe(message);
  });
  it("reuses exact metadata fieldnames and server create permissions", async () => {
    const data = { fields: { "Contract Obligation": [{ fieldname: "owne", fieldtype: "Link", options: "User" }] }, allowedCreate: ["Contract Obligation"] };
    mocks.get.mockResolvedValue(data); expect(await getClmMetadata()).toEqual(data);
  });
  it("preserves optimistic concurrency and never automatically retries workflow writes", async () => {
    mocks.post.mockResolvedValue({ data: { doctype: "Contract", record: { name: "CON-1" }, actions: [] } });
    await applyClmAction({ doctype: "Contract", name: "CON-1", action: "approve", expected_modified: "2026-09-17 10:00:00", comment: "Reviewed terms" });
    expect(mocks.post).toHaveBeenCalledWith("/api/clm", { doctype: "Contract", name: "CON-1", action: "approve", expected_modified: "2026-09-17 10:00:00", comment: "Reviewed terms" }, { _disableNetworkRetry: true });
  });
  it("refuses stale writes and incomplete persistence results", async () => {
    await expect(applyClmAction({ doctype: "Contract", name: "CON-1", action: "approve" })).rejects.toThrow("Refresh");
    expect(mocks.post).not.toHaveBeenCalled(); mocks.post.mockResolvedValue({});
    await expect(applyClmAction({ doctype: "Contract Request", action: "save", payload: { contract_purpose: "Testing" } })).rejects.toThrow("did not return a saved record");
  });
  it("sends the independently adopted signature to the existing Contract without creating another record or retrying", async () => {
    const signed = { doctype: "Contract", record: { name: "CON-2026-00001", modified: "saved-revision" }, actions: [] };
    mocks.post.mockResolvedValue({ data: signed });
    const input = { doctype: "Contract", name: "CON-2026-00001", action: "sign", expected_modified: "reviewed-revision", payload: { full_legal_name: "Legal Reviewer", signature: { method: "typed", value: "L. Reviewer", adopted: true }, consent: true, request_id: "sign-attempt" } };
    expect(await applyClmAction(input)).toEqual(signed);
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith("/api/clm", input, { _disableNetworkRetry: true });
  });
  it("rejects signing without an existing Contract and rejects a response for a different record", async () => {
    await expect(applyClmAction({ doctype: "Contract", action: "sign" })).rejects.toThrow("existing Contract");
    expect(mocks.post).not.toHaveBeenCalled();
    mocks.post.mockResolvedValue({ data: { doctype: "Contract", record: { name: "CON-OTHER" }, actions: [] } });
    await expect(applyClmAction({ doctype: "Contract", name: "CON-1", action: "sign", expected_modified: "reviewed-revision" })).rejects.toThrow("does not match this Contract");
  });
  it("loads source data through the authorized endpoint without changing the source", async () => {
    mocks.get.mockResolvedValue({ payload: { custom_rfq: "RFQ-1" } });
    expect(await prefillClm("Contract", "Request for Quotation", "RFQ-1")).toEqual({ custom_rfq: "RFQ-1" });
    expect(mocks.post).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue({ records: [{ name: "SUP-1" }] });
    expect(await lookupClm("Supplier", "Supp")).toEqual([{ name: "SUP-1" }]);
  });
  it("uses authenticated parent-scoped document reads without query-string tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    expect((await getClmDocumentBlob("Contract", "CON-1", "custom_contract_document")).type).toBe("application/pdf");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clm?view=file&doctype=Contract&name=CON-1&fieldname=custom_contract_document");
    expect(url).not.toContain("test-session-proof");
    expect(options).toMatchObject({ credentials: "omit", cache: "no-store", headers: { "X-Bidsphere-Access-Token": "test-session-proof" } });
  });
  it.each([[401, "session has expired"], [403, "permission"], [404, "Document not found"], [500, "Unable to load"]])("maps document HTTP %s safely", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private upstream stack", { status: Number(status) })));
    await expect(getClmDocumentBlob("Contract", "CON-1", "custom_contract_document")).rejects.toThrow(String(message));
  });
  it("binds authoritative PDF preview/download to the displayed version and retains integrity conflict messages", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "The versioned Contract PDF failed its integrity check." }), { status: 409, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await getClmDocumentBlob("Contract", "CON-1", "current_pdf", undefined, "2.0");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/clm?view=file&doctype=Contract&name=CON-1&fieldname=current_pdf&expected_version=2.0");
    await expect(getClmDocumentBlob("Contract", "CON-1", "current_pdf", undefined, "2.0")).rejects.toThrow("integrity check");
  });
  it("keeps cached data isolated after the authenticated identity changes without exposing tokens", () => {
    const first = clmViewerKey(); expect(clmViewerKey()).toBe(first);
    mocks.token.mockReturnValue("another-session-proof"); const second = clmViewerKey();
    expect(second).not.toBe(first); expect(second).not.toContain("session-proof");
    mocks.token.mockReturnValue("test-session-proof"); expect(clmViewerKey()).not.toBe(first);
  });
  it("uses the supplier principal in supplier routes even when a staff token also exists", async () => {
    vi.stubGlobal("window", { location: { pathname: "/supplier/contracts" } });
    const supplierToken = issueSupplierAccessToken({ supplier: "SUP-1" });
    expect(supplierToken.split(".")).toHaveLength(2);
    mocks.supplierToken.mockReturnValue(supplierToken);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { records: [{ name: "CON-1" }] } }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    expect(await getClmList()).toEqual({ records: [{ name: "CON-1" }] });
    expect(fetchMock.mock.calls[0][1].headers["X-Bidsphere-Access-Token"]).toBe(supplierToken);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("rejects staff principal fallback in the supplier workspace", async () => {
    vi.stubGlobal("window", { location: { pathname: "/supplier/contracts" } });
    mocks.supplierToken.mockReturnValue(issueInternalAccessToken({ sub: "staff-1", email: "staff@example.test", role: "procurement" }));
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(getClmList()).rejects.toThrow("supplier session has expired");
    expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it("uploads through the receipt endpoint with the supplier token and exact parent revision", async () => {
    vi.stubGlobal("window", { location: { pathname: "/supplier/contracts/CON-1" } });
    const token = issueSupplierAccessToken({ supplier: "SUP-1" });
    mocks.supplierToken.mockReturnValue(token);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { file_id: "FILE-1", file_url: "/private/files/redline.pdf", file_name: "redline.pdf", modified: "2026-09-17 12:00:01" } }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    const file = new File(["%PDF-1.7"], "redline.pdf", { type: "application/pdf" });
    expect(await uploadClmSupportingDocument(file, "CON-1", "2026-09-17 12:00:00")).toMatchObject({ file_id: "FILE-1", modified: "2026-09-17 12:00:01" });
    const [url, options] = fetchMock.mock.calls[0];
    const request = new URL(url, "https://local.test");
    expect(request.pathname).toBe("/api/clm"); expect(Object.fromEntries(request.searchParams)).toEqual({ view: "supplier_upload", name: "CON-1", expected_modified: "2026-09-17 12:00:00" });
    expect(options.method).toBe("POST"); expect(options.credentials).toBe("omit"); expect(options.headers).toEqual({ "X-Bidsphere-Access-Token": token });
    expect(options.body).toBeInstanceOf(FormData); expect((options.body as FormData).get("file")).toBeInstanceOf(File);
    expect((options.body as FormData).has("fieldname")).toBe(false);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("requires a fresh contract and a confirmed private-file receipt", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); const file = new File(["document"], "redline.pdf");
    await expect(uploadClmSupportingDocument(file, "CON-1", "")).rejects.toThrow("Refresh this contract"); expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { file_id: "FILE-1", file_url: "/private/files/redline.pdf" } }), { status: 200 }));
    await expect(uploadClmSupportingDocument(file, "CON-1", "revision")).rejects.toThrow("did not confirm");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { file_id: "FILE-1", file_url: "/files/public.pdf", modified: "new-revision" } }), { status: 200 }));
    await expect(uploadClmSupportingDocument(file, "CON-1", "revision")).rejects.toThrow("did not confirm");
  });
  it("previews supporting documents by exact File ID through the same contract ACL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    await getClmDocumentBlob("Contract", "CON-1", "", "FILE-1");
    const [url] = fetchMock.mock.calls[0]; expect(Object.fromEntries(new URL(url, "https://local.test").searchParams)).toEqual({ view: "file", doctype: "Contract", name: "CON-1", file_id: "FILE-1" });
  });
  it("submits only the uploaded File IDs with the supplier negotiation response", async () => {
    vi.stubGlobal("window", { location: { pathname: "/supplier/contracts/CON-1" } });
    mocks.supplierToken.mockReturnValue(issueSupplierAccessToken({ supplier: "SUP-1" }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { doctype: "Contract", record: { name: "CON-1", custom_contract_status: "Negotiation" }, actions: [] } }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    await applyClmAction({ doctype: "Contract", name: "CON-1", action: "supplier_redline", expected_modified: "post-upload-revision", payload: { supporting_documents: ["FILE-1"] }, comment: "Proposed commercial changes are attached." });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.expected_modified).toBe("post-upload-revision"); expect(body.payload).toEqual({ supporting_documents: ["FILE-1"] });
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each(["Contract Risk", "Contract Obligation", "Contract Milestone", "Contract Renewal", "Contract Amendment"])("links %s to its authorized detail route rather than configuration", doctype => {
    expect(clmRecordRoute(doctype, "Related record/1")).toBe(`/contracts/records/${encodeURIComponent(doctype)}/Related%20record%2F1`);
  });
  it("keeps settings and primary contract/request routes intact", () => {
    expect(clmRecordRoute("Contract Approval Matrix", "Policy 1")).toBe("/contracts/settings?doctype=Contract+Approval+Matrix&name=Policy+1");
    expect(clmRecordRoute("Contract Request", "CR-1")).toBe("/contract-requests/CR-1");
    expect(clmRecordRoute("Contract", "CON-1")).toBe("/contracts/CON-1");
  });
});
