import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueSupplierAccessToken } from "../../api/rbacAuth";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), supplierToken: vi.fn(() => "") }));
vi.mock("./erpnext", () => ({ apiGet: mocks.get, apiPost: mocks.post, withoutNetworkRetry: () => ({}) }));
vi.mock("../utils/accessToken", () => ({ readErpProxyAccessToken: () => "staff-token", readSupplierAccessToken: mocks.supplierToken }));
import { getClmDocumentBlob, getPurchaseOrderContract, verifyPurchaseOrderContractAcceptance } from "./clm";

const contract = {
  name: "CON-2026-00001", status: "Active", value: 4500, currency: "USD", start_date: "2026-09-25", end_date: "2026-10-25",
  supplier_id: "SUP-ATLANTIC", supplier_name: "Atlantic Precision Manufacturing",
  rfq: "PUR-RFQ-2026-00104", award: "LDC2026-00027", quotation: "PUR-SQTN-2026-00273", current_version: "1.0", pdf_available: true,
  signature_workflow: { supplier_status: "Pending", legal_status: "Signed", can_sign: true, can_review: true }, actions: [{ action: "sign", label: "Sign" }],
};
const saved = { purchase_order: "PUR-ORD-2026-00028", contract };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("BIDSPHERE_SESSION_SECRET", "po-contract-client-test-only-session-secret"); mocks.supplierToken.mockReturnValue(""); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Purchase Order Contract read API", () => {
  it.each([undefined, { can_accept_po: false }, { can_accept_po: false, acceptance_status: "Accepted", signature_status: "Pending" }])("rejects PO acceptance until freshly fetched Contract evidence authorizes it", async supplier_workflow => {
    mocks.get.mockResolvedValue({ ...saved, contract: { ...contract, supplier_workflow } });
    await expect(verifyPurchaseOrderContractAcceptance(saved.purchase_order)).rejects.toThrow("Accept and sign");
    expect(mocks.get).toHaveBeenCalledOnce(); expect(mocks.post).not.toHaveBeenCalled();
  });
  it("allows the existing PO acceptance to continue only after a fresh ready response, without accepting automatically", async () => {
    const result = { ...saved, contract: { ...contract, supplier_workflow: { can_accept_po: true, acceptance_status: "Accepted", signature_status: "Signed" } } };
    mocks.get.mockResolvedValue(result);
    expect(await verifyPurchaseOrderContractAcceptance(saved.purchase_order)).toEqual(result);
    expect(mocks.get).toHaveBeenCalledOnce(); expect(mocks.post).not.toHaveBeenCalled();
  });
  it("preserves the normal no-Contract PO flow", async () => {
    mocks.get.mockResolvedValue({ ...saved, contract: null });
    expect((await verifyPurchaseOrderContractAcceptance(saved.purchase_order)).contract).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("fails closed on an unavailable Contract preflight instead of using stale allowed state", async () => {
    mocks.get.mockRejectedValue(new Error("ERPNext is unavailable"));
    await expect(verifyPurchaseOrderContractAcceptance(saved.purchase_order)).rejects.toThrow("ERPNext is unavailable");
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("reads the persisted PO relationship from the backend without creating or updating a Contract", async () => {
    mocks.get.mockResolvedValue({ data: saved });
    expect(await getPurchaseOrderContract(saved.purchase_order)).toEqual(saved);
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith("/api/clm", { params: { view: "purchase_order_contract", name: saved.purchase_order } });
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("accepts an explicit null link without manufacturing Contract data", async () => {
    mocks.get.mockResolvedValue({ ...saved, contract: null });
    expect((await getPurchaseOrderContract(saved.purchase_order)).contract).toBeNull();
  });
  it.each([
    {}, { ...saved, purchase_order: "PO-OTHER" }, { purchase_order: saved.purchase_order },
    { ...saved, contract: { ...contract, name: "" } },
    { ...saved, contract: { ...contract, rfq: "" } },
    { ...saved, contract: { ...contract, award: "" } },
    { ...saved, contract: { ...contract, value: NaN } },
    { ...saved, contract: { ...contract, signature_workflow: {} } },
    { ...saved, contract: { ...contract, actions: [null] } },
    { success: false, message: "Linked Contract does not belong to this Award." },
  ])("rejects a wrong or incomplete server linkage instead of displaying misleading Contract information", async result => {
    mocks.get.mockResolvedValue(result);
    await expect(getPurchaseOrderContract(saved.purchase_order)).rejects.toThrow("verified Contract link");
  });
  it("preserves an actionable backend validation failure", async () => {
    mocks.get.mockRejectedValue(new Error("The Contract supplier does not match this Purchase Order."));
    await expect(getPurchaseOrderContract(saved.purchase_order)).rejects.toThrow("supplier does not match");
  });
  it("binds PO Contract preview to both the authoritative file receipt and version", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    await getClmDocumentBlob("Contract", contract.name, "current_pdf", "signed-file-1", "1.0");
    const url = new URL(fetchMock.mock.calls[0][0], "https://app.test");
    expect(url.searchParams.get("fieldname")).toBe("current_pdf"); expect(url.searchParams.get("file_id")).toBe("signed-file-1"); expect(url.searchParams.get("expected_version")).toBe("1.0");
    expect(url.searchParams.has("token")).toBe(false);
  });
  it("uses the supplier credential and private cache controls from the Supplier Portal", async () => {
    vi.stubGlobal("window", { location: { pathname: "/supplier/po/PUR-ORD-2026-00028" } });
    const token = issueSupplierAccessToken({ supplier: "SUP-1" });
    expect(token.split(".")).toHaveLength(2);
    mocks.supplierToken.mockReturnValue(token);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: saved }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getPurchaseOrderContract(saved.purchase_order)).toEqual(saved);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/clm?view=purchase_order_contract&name=PUR-ORD-2026-00028", expect.objectContaining({ method: "GET", cache: "no-store", credentials: "omit", headers: { "X-Bidsphere-Access-Token": token } }));
  });
  it("never falls back to a staff credential when the supplier session is missing", async () => {
    vi.stubGlobal("window", { location: { pathname: "/supplier/po/PUR-ORD-2026-00028" } });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(getPurchaseOrderContract(saved.purchase_order)).rejects.toThrow("supplier session has expired");
    expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each(["broken-token", "invalid.signature", ".signature", `${Buffer.from(JSON.stringify({ typ: "supplier" })).toString("base64url")}.`, `header.${Buffer.from(JSON.stringify({ typ: "supplier" })).toString("base64url")}.signature`])("rejects unsupported or malformed token encoding before making a portal request", async token => {
    vi.stubGlobal("window", { location: { pathname: "/supplier/po/PUR-ORD-2026-00028" } });
    mocks.supplierToken.mockReturnValue(token); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(getPurchaseOrderContract(saved.purchase_order)).rejects.toThrow("supplier session has expired");
    expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
  });
});
