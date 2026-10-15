import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createClmPurchaseOrderDependencies } from "./clmPurchaseOrderErp";
import { clmErpRequest } from "./clmErp";
import { fetchErpFile } from "./fileProxyCore";
import { rfqClmFinanceApproved } from "./clmCore";

vi.mock("./authSession.js", () => ({ readErpAuthConfig: () => ({ baseUrl: "https://erp.test.invalid", key: "test-key", secret: "test-secret" }) }));
vi.mock("./clmCore.js", async importOriginal => ({ ...await importOriginal<object>(), rfqClmFinanceApproved: vi.fn(() => true) }));
vi.mock("./clmErp.js", () => ({ clmErpRequest: vi.fn(), listClmErp: vi.fn(async () => []), createClmDependencies: () => ({ load: vi.fn(), list: vi.fn(), save: vi.fn(), create: vi.fn(), now: () => "2026-09-29 12:00:00" }) }));
vi.mock("./fileProxyCore.js", async importOriginal => ({ ...await importOriginal<object>(), fetchErpFile: vi.fn() }));
const locked = Buffer.from("%PDF-approved original"), signed = Buffer.from("%PDF-actual signed document"), digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const record = { name: "CON-1", custom_clm_data: JSON.stringify({ schema: 1, approvals: [], versions: [], audit: [], sla: [],
  locked_file: { file_id: "LOCKED", file_url: "/private/files/original.pdf", hash: digest(locked) }, signatures: [{ file_id: "SIGNED", file_url: "/private/files/signed.pdf", hash: digest(signed), party: "inteva", version: "1.0" }] }) };
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(rfqClmFinanceApproved).mockReturnValue(true);
  vi.mocked(fetchErpFile).mockImplementation(async input => {
    await input.authorizeFile!({ name: input.fileId, attached_to_doctype: "Contract", attached_to_name: "CON-1", file_url: input.filePath, is_private: 1 });
    return { ok: true, buffer: input.fileId === "LOCKED" ? locked : signed, contentType: "application/pdf" } as Awaited<ReturnType<typeof fetchErpFile>>;
  });
});
describe("CLM PO ERP adapter", () => {
  it("uses existing standard PO save and submit while retaining permanent source fields", async () => {
    const deps = createClmPurchaseOrderDependencies(), doc = { name: "PO-1", currency: "USD", custom_clm_contract: "CON-1", custom_clm_creation_key: "key", payment_terms_template: "Net 30", items: [{ supplier_quotation: "SQ-1", qty: 20, rate: 25 }] };
    await deps.createOrder(doc); await deps.submitOrder(doc);
    expect(clmErpRequest).toHaveBeenNthCalledWith(1, "POST", "method/frappe.client.save", { doc: { ...doc, doctype: "Purchase Order" } });
    expect(clmErpRequest).toHaveBeenNthCalledWith(2, "POST", "method/frappe.client.submit", { doc: { ...doc, doctype: "Purchase Order" } });
  });
  it("independently verifies original and signed PDF bytes before procurement", async () => {
    await createClmPurchaseOrderDependencies().verifyIntegrity(record);
    expect(fetchErpFile).toHaveBeenCalledTimes(2); expect(fetchErpFile).toHaveBeenNthCalledWith(2, expect.objectContaining({ fileId: "SIGNED", filePath: "/private/files/signed.pdf" }));
  });
  it("rejects a changed signature file despite valid-looking saved signature metadata", async () => {
    vi.mocked(fetchErpFile).mockResolvedValue({ ok: true, buffer: Buffer.from("%PDF-modified"), contentType: "application/pdf" } as Awaited<ReturnType<typeof fetchErpFile>>);
    await expect(createClmPurchaseOrderDependencies().verifyIntegrity(record)).rejects.toThrow("immutable signed Contract PDF");
  });
  it("rejects a private PDF attached to a different Contract", async () => {
    vi.mocked(fetchErpFile).mockImplementation(async input => {
      await input.authorizeFile!({ name: input.fileId, attached_to_doctype: "Contract", attached_to_name: "OTHER", file_url: input.filePath, is_private: 1 });
      throw new Error("Unexpected authorization success");
    });
    await expect(createClmPurchaseOrderDependencies().verifyIntegrity(record)).rejects.toThrow("not attached");
  });
  it("does not accept files as a substitute for persisted Finance approval", async () => {
    vi.mocked(rfqClmFinanceApproved).mockReturnValue(false);
    await expect(createClmPurchaseOrderDependencies().verifyIntegrity(record)).rejects.toThrow("Finance approval"); expect(fetchErpFile).not.toHaveBeenCalled();
  });
});
